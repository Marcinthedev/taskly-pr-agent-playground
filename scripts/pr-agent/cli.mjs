#!/usr/bin/env node
// Entry point shared by the PR workflow and the agent. Run from the repository root.
//
// Agent-facing (the only commands the agent may execute):
//   test       <area> [test files...]                 Vitest in a credential-free environment
//   typecheck  <area>                                 tsc in a credential-free environment
//   format     <area> <test files...>                 apply the area's formatter (frontend: Prettier)
//
// Workflow-facing (results go to --dir, outside the agent's reach in CI):
//   plan        --dir d --base <sha> --head <sha>      classify the PR diff, write plan.json + pr.diff
//   verify      <area> --dir d [--baseline]           typecheck + full suite with coverage
//   decision    --dir d --execution-file f            extract the agent's JSON report and usage
//   usage       --dir d                               print the agent's usage on one line
//   guard       --dir d [--policy tests|refactor]     check the agent's working-tree edits
//   patch       --dir d [--out f]                     write the guarded files as a patch (default d/tests.patch)
//   check-patch --dir d --patch f [--policy p]        re-check a patch before it is committed
//   report      --dir d --run-url u --out f [--mode tests|refactor --status s --reason r --sha x --pr-url u --pr-number n]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { agentUsage, extractDecision, finalAgentText } from "./lib/decision.mjs";
import { parseNameStatus, parsePorcelain, patchChanges } from "./lib/git.mjs";
import { checkAgentChanges, checkRefactorChanges } from "./lib/guard.mjs";
import { AREAS, TEST_FILE } from "./lib/paths.mjs";
import { planChanges } from "./lib/plan.mjs";
import { formatUsage, renderReport, summarizeCoverage, summarizeVitest } from "./lib/report.mjs";
import { buildCommand, FORMATTER, runCommand } from "./lib/sandbox.mjs";

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

  const phase = flags.baseline ? "before" : "after";
  const testsJson = path.join(dir, flags.baseline ? `${area}-tests-before.json` : `${area}-tests.json`);
  // The sandboxed run writes test results and coverage into a fresh scratch
  // folder: only this process writes into --dir (so tests cannot touch
  // plan.json, guard.json or decision.json), and no run has to delete files
  // that another OS user created in a shared coverage/ folder.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pr-agent-out-"));
  fs.chmodSync(scratch, 0o777);
  const scratchJson = path.join(scratch, "tests.json");
  const coverageSummary = path.join(scratch, "coverage", "coverage-summary.json");

  let typecheckOk = true;
  let formatOk = true;
  if (!flags.baseline) {
    typecheckOk = runCommand(buildCommand("typecheck", area), { repoRoot }) === 0;
    fs.writeFileSync(path.join(dir, `${area}-typecheck.txt`), typecheckOk ? "success" : "failure");

    // The agent's test files must follow the repository's formatter, where one exists.
    const touched = (readJson(path.join(dir, "guard.json"))?.allowed ?? []).filter((file) => TEST_FILE[area].test(file));
    if (FORMATTER[area] && touched.length) {
      formatOk = runCommand(buildCommand("format-check", area, touched), { repoRoot }) === 0;
      fs.writeFileSync(path.join(dir, `${area}-format.txt`), formatOk ? "success" : "failure");
    }
  }

  runCommand(
    buildCommand("test", area, [], { json: scratchJson, coverage: true, coverageDir: path.join(scratch, "coverage") }),
    { repoRoot },
  );
  if (fs.existsSync(scratchJson)) fs.copyFileSync(scratchJson, testsJson);
  if (fs.existsSync(coverageSummary)) fs.copyFileSync(coverageSummary, path.join(dir, `${area}-coverage-${phase}.json`));
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    // Folders the sandbox user created inside may not be removable by us; the runner is discarded anyway.
  }

  // Pass/fail comes from the test results, not the exit code: coverage
  // thresholds can fail a run whose tests all passed.
  const testsOk = vitestPassed(readJson(testsJson));
  console.log(
    `${area} ${phase}: typecheck=${typecheckOk ? "success" : "failure"} format=${formatOk ? "success" : "failure"} tests=${testsOk ? "passed" : "failed"}`,
  );
  if (!flags.baseline && !(typecheckOk && formatOk && testsOk)) process.exitCode = 1;
}

function commandDecision({ flags }) {
  allowFlags(flags, ["dir", "execution-file"]);
  const dir = requireFlag(flags, "dir");
  const log = readJson(requireFlag(flags, "execution-file"));
  const decision = extractDecision(finalAgentText(log));
  if (decision) writeJson(path.join(dir, "decision.json"), decision);
  const usage = agentUsage(log);
  if (usage) writeJson(path.join(dir, "usage.json"), usage);
  setOutputs({ found: Boolean(decision), decision: decision?.decision ?? "missing" });
  console.log(decision ? JSON.stringify(decision, null, 2) : "The agent did not return a valid decision report.");
  console.log(`Agent usage: ${formatUsage(usage)}`);
}

function commandUsage({ flags }) {
  allowFlags(flags, ["dir"]);
  console.log(formatUsage(readJson(path.join(requireFlag(flags, "dir"), "usage.json"))));
}

// tests: the test agent may change test files only.
// refactor: the testability agent may change the PR's sources, add modules next
// to them and add new tests, but never edit existing tests.
const POLICIES = { tests: checkAgentChanges, refactor: checkRefactorChanges };

function policyFor(flags) {
  const name = flags.policy ?? "tests";
  if (!POLICIES[name]) throw new Error(`Unknown policy: ${name}`);
  return POLICIES[name];
}

function commandGuard({ flags }) {
  allowFlags(flags, ["dir", "policy"]);
  const dir = requireFlag(flags, "dir");
  const plan = loadPlan(dir);
  const changes = parsePorcelain(git(["status", "--porcelain=v1", "-z", "-uall"]))
    .filter((change) => !MANAGED_PATHS.some((prefix) => change.path.startsWith(prefix)));
  const result = policyFor(flags)(changes, plan);
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
  allowFlags(flags, ["dir", "patch", "policy"]);
  const plan = loadPlan(requireFlag(flags, "dir"));
  const changes = patchChanges(fs.readFileSync(requireFlag(flags, "patch"), "utf8"));
  const result = policyFor(flags)(changes, plan);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok || !changes.length) process.exitCode = 1;
}

function commandReport({ flags }) {
  allowFlags(flags, ["dir", "run-url", "out", "status", "reason", "sha", "mode", "pr-url", "pr-number"]);
  const dir = requireFlag(flags, "dir");
  const plan = loadPlan(dir);
  const verification = {};
  for (const area of plan.areas) {
    const typecheckFile = path.join(dir, `${area}-typecheck.txt`);
    verification[area] = {
      typecheck: fs.existsSync(typecheckFile) ? fs.readFileSync(typecheckFile, "utf8").trim() : "skipped",
      format: fs.existsSync(path.join(dir, `${area}-format.txt`))
        ? fs.readFileSync(path.join(dir, `${area}-format.txt`), "utf8").trim()
        : null,
      tests: summarizeVitest(readJson(path.join(dir, `${area}-tests.json`))),
      coverageBefore: summarizeCoverage(readJson(path.join(dir, `${area}-coverage-before.json`))),
      coverageAfter: summarizeCoverage(readJson(path.join(dir, `${area}-coverage-after.json`))),
    };
  }
  const markdown = renderReport({
    mode: flags.mode ?? "tests",
    plan,
    decision: readJson(path.join(dir, "decision.json")),
    guard: readJson(path.join(dir, "guard.json")),
    verification: plan.needsTests ? verification : {},
    usage: readJson(path.join(dir, "usage.json")),
    outcome: {
      status: flags.status ?? "failed",
      reason: flags.reason,
      sha: flags.sha,
      url: flags["pr-url"],
      number: flags["pr-number"],
    },
    runUrl: flags["run-url"] ?? "",
  });
  if (flags.out) fs.writeFileSync(flags.out, markdown);
  else console.log(markdown);
}

const COMMANDS = {
  test: (args) => commandTest(args, "test"),
  typecheck: (args) => commandTest(args, "typecheck"),
  format: (args) => commandTest(args, "format"),
  plan: commandPlan,
  verify: commandVerify,
  decision: commandDecision,
  guard: commandGuard,
  patch: commandPatch,
  "check-patch": commandCheckPatch,
  report: commandReport,
  usage: commandUsage,
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
