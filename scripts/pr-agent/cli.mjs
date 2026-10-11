#!/usr/bin/env node
// Entry point shared by the PR workflow and the agent. Run from the repository root.
//
// Agent-facing (the only commands the agent may execute):
//   test       <area> [test files...]                 Vitest in a credential-free environment
//   typecheck  <area>                                 tsc in a credential-free environment
//
// Workflow-facing (results go to --dir, outside the agent's reach in CI):
//   plan        --dir d --base <sha> --head <sha>      classify the PR diff, write plan.json + pr.diff
//   verify      <area> --dir d [--baseline]           typecheck + full suite with coverage
//   decision    --dir d --execution-file f            extract the agent's JSON report
//   guard       --dir d                               check the agent's working-tree edits
//   patch       --dir d [--out f]                     write the guarded files as a patch (default d/tests.patch)
//   check-patch --dir d --patch f                     re-check a patch before it is committed
//   report      --dir d --run-url u --out f [--status s --reason r --sha x]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { extractDecision, finalAgentText } from "./lib/decision.mjs";
import { parseNameStatus, parsePorcelain, patchChanges } from "./lib/git.mjs";
import { checkAgentChanges } from "./lib/guard.mjs";
import { AREAS } from "./lib/paths.mjs";
import { planChanges } from "./lib/plan.mjs";
import { renderReport, summarizeCoverage, summarizeVitest } from "./lib/report.mjs";
import { buildCommand, runCommand } from "./lib/sandbox.mjs";

const repoRoot = process.cwd();
const AGENT_WORKSPACE_DIR = ".pr-agent";
// Paths the workflow or claude-code-action manage themselves (the action restores
// .claude/ from the base branch and parks PR copies in .claude-pr/). They are
// never part of the patch, so the guard does not judge them.
const MANAGED_PATHS = [`${AGENT_WORKSPACE_DIR}/`, ".claude/", ".claude-pr/"];
const MAX_DIFF_BYTES = 400_000;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) positional.push(arg);
    else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) flags[arg.slice(2)] = argv[++index];
    else flags[arg.slice(2)] = "true";
  }
  return { positional, flags };
}

function allowFlags(flags, allowed) {
  const unknown = Object.keys(flags).filter((flag) => !allowed.includes(flag));
  if (unknown.length) throw new Error(`Unknown option(s): ${unknown.map((flag) => `--${flag}`).join(", ")}`);
}

function requireFlag(flags, name) {
  if (!flags[name] || flags[name] === "true") throw new Error(`Missing --${name}`);
  return flags[name];
}

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function setOutputs(outputs) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

function loadPlan(dir) {
  const plan = readJson(path.join(dir, "plan.json"));
  if (!plan) throw new Error(`Missing ${path.join(dir, "plan.json")}`);
  return plan;
}

// ---------------------------------------------------------------- agent-facing

function commandTest({ positional, flags }, action) {
  allowFlags(flags, []);
  const [area, ...files] = positional;
  process.exitCode = runCommand(buildCommand(action, area, files), { repoRoot });
}

// ------------------------------------------------------------- workflow-facing

function commandPlan({ flags }) {
  allowFlags(flags, ["dir", "base", "head"]);
  const dir = requireFlag(flags, "dir");
  const range = `${requireFlag(flags, "base")}...${requireFlag(flags, "head")}`;
  const plan = planChanges(parseNameStatus(git(["diff", "--name-status", "-z", "-M", range])), {
    fileExists: (file) => fs.existsSync(path.join(repoRoot, file)),
  });
  writeJson(path.join(dir, "plan.json"), plan);

  const sources = plan.targets.map((target) => target.source);
  const diff = sources.length ? git(["diff", "-M", range, "--", ...sources]) : "";
  fs.writeFileSync(
    path.join(dir, "pr.diff"),
    diff.length > MAX_DIFF_BYTES ? `${diff.slice(0, MAX_DIFF_BYTES)}\n[diff truncated; read the source files directly]\n` : diff,
  );

  setOutputs({
    needs_tests: plan.needsTests,
    backend: plan.areas.includes("backend"),
    frontend: plan.areas.includes("frontend"),
  });
  console.log(JSON.stringify(plan, null, 2));
}

function vitestPassed(json) {
  return Boolean(json) && json.numTotalTests > 0 && json.numFailedTests === 0 && (json.numFailedTestSuites ?? 0) === 0;
}

function commandVerify({ positional, flags }) {
  allowFlags(flags, ["dir", "baseline"]);
  const dir = path.resolve(requireFlag(flags, "dir"));
  const [area] = positional;
  if (!AREAS.includes(area)) throw new Error(`Unknown area: ${area}`);
  fs.mkdirSync(dir, { recursive: true });

  const coverageSummary = path.join(repoRoot, area, "coverage", "coverage-summary.json");
  const phase = flags.baseline ? "before" : "after";
  const testsJson = path.join(dir, flags.baseline ? `${area}-tests-before.json` : `${area}-tests.json`);
  // The sandboxed run writes into its own scratch folder; only this process
  // writes into --dir, so tests cannot touch plan.json, guard.json or decision.json.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pr-agent-out-"));
  fs.chmodSync(scratch, 0o777);
  const scratchJson = path.join(scratch, "tests.json");

  let typecheckOk = true;
  if (!flags.baseline) {
    typecheckOk = runCommand(buildCommand("typecheck", area), { repoRoot }) === 0;
    fs.writeFileSync(path.join(dir, `${area}-typecheck.txt`), typecheckOk ? "success" : "failure");
  }

  fs.rmSync(coverageSummary, { force: true });
  runCommand(buildCommand("test", area, [], { json: scratchJson, coverage: true }), { repoRoot });
  if (fs.existsSync(scratchJson)) fs.copyFileSync(scratchJson, testsJson);
  if (fs.existsSync(coverageSummary)) fs.copyFileSync(coverageSummary, path.join(dir, `${area}-coverage-${phase}.json`));
  fs.rmSync(scratch, { recursive: true, force: true });

  // Pass/fail comes from the test results, not the exit code: coverage
  // thresholds can fail a run whose tests all passed.
  const testsOk = vitestPassed(readJson(testsJson));
  console.log(`${area} ${phase}: typecheck=${typecheckOk ? "success" : "failure"} tests=${testsOk ? "passed" : "failed"}`);
  if (!flags.baseline && !(typecheckOk && testsOk)) process.exitCode = 1;
}

function commandDecision({ flags }) {
  allowFlags(flags, ["dir", "execution-file"]);
  const dir = requireFlag(flags, "dir");
  const log = readJson(requireFlag(flags, "execution-file"));
  const decision = extractDecision(finalAgentText(log));
  if (decision) writeJson(path.join(dir, "decision.json"), decision);
  setOutputs({ found: Boolean(decision), decision: decision?.decision ?? "missing" });
  console.log(decision ? JSON.stringify(decision, null, 2) : "The agent did not return a valid decision report.");
}

function commandGuard({ flags }) {
  allowFlags(flags, ["dir"]);
  const dir = requireFlag(flags, "dir");
  const plan = loadPlan(dir);
  const changes = parsePorcelain(git(["status", "--porcelain=v1", "-z", "-uall"]))
    .filter((change) => !MANAGED_PATHS.some((prefix) => change.path.startsWith(prefix)));
  const result = checkAgentChanges(changes, plan);
  writeJson(path.join(dir, "guard.json"), result);
  setOutputs({ ok: result.ok, changed: result.allowed.length > 0 });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

function commandPatch({ flags }) {
  allowFlags(flags, ["dir", "out"]);
  const dir = requireFlag(flags, "dir");
  const out = flags.out ? requireFlag(flags, "out") : path.join(dir, "tests.patch");
  const guard = readJson(path.join(dir, "guard.json"));
  if (!guard?.ok || !guard.allowed.length) throw new Error("No guarded changes to package");
  git(["add", "--intent-to-add", "--", ...guard.allowed]);
  const patch = git(["diff", "HEAD", "--", ...guard.allowed]);
  fs.writeFileSync(out, patch);
  console.log(`Wrote ${out} (${guard.allowed.length} file(s), ${patch.length} bytes)`);
}

function commandCheckPatch({ flags }) {
  allowFlags(flags, ["dir", "patch"]);
  const plan = loadPlan(requireFlag(flags, "dir"));
  const changes = patchChanges(fs.readFileSync(requireFlag(flags, "patch"), "utf8"));
  const result = checkAgentChanges(changes, plan);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok || !changes.length) process.exitCode = 1;
}

function commandReport({ flags }) {
  allowFlags(flags, ["dir", "run-url", "out", "status", "reason", "sha"]);
  const dir = requireFlag(flags, "dir");
  const plan = loadPlan(dir);
  const verification = {};
  for (const area of plan.areas) {
    const typecheckFile = path.join(dir, `${area}-typecheck.txt`);
    verification[area] = {
      typecheck: fs.existsSync(typecheckFile) ? fs.readFileSync(typecheckFile, "utf8").trim() : "skipped",
      tests: summarizeVitest(readJson(path.join(dir, `${area}-tests.json`))),
      coverageBefore: summarizeCoverage(readJson(path.join(dir, `${area}-coverage-before.json`))),
      coverageAfter: summarizeCoverage(readJson(path.join(dir, `${area}-coverage-after.json`))),
    };
  }
  const markdown = renderReport({
    plan,
    decision: readJson(path.join(dir, "decision.json")),
    guard: readJson(path.join(dir, "guard.json")),
    verification: plan.needsTests ? verification : {},
    outcome: { status: flags.status ?? "failed", reason: flags.reason, sha: flags.sha },
    runUrl: flags["run-url"] ?? "",
  });
  if (flags.out) fs.writeFileSync(flags.out, markdown);
  else console.log(markdown);
}

const COMMANDS = {
  test: (args) => commandTest(args, "test"),
  typecheck: (args) => commandTest(args, "typecheck"),
  plan: commandPlan,
  verify: commandVerify,
  decision: commandDecision,
  guard: commandGuard,
  patch: commandPatch,
  "check-patch": commandCheckPatch,
  report: commandReport,
};

export function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Usage: cli.mjs <${Object.keys(COMMANDS).join("|")}> ...`);
    process.exitCode = 2;
    return;
  }
  handler(parseArgs(rest));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
