import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runAgentLoop } from "./lib/agent-loop.ts";
import { buildSystemPrompt, buildTask, skillSummary } from "./lib/agent-prompt.ts";
import { type AgentReport, agentUsage, type AgentUsage, finalResultText, parseAgentReport } from "./lib/agent-result.ts";
import { buildAuditRecord } from "./lib/audit-record.ts";
import { type ChangePlan, planChanges } from "./lib/change-plan.ts";
import { CHANGE_POLICIES, type PolicyName, type PolicyResult } from "./lib/change-policy.ts";
import { filesInPatch, parseNameStatus, parsePorcelainStatus } from "./lib/git-output.ts";
import { type AreaVerification, formatUsage, lineCoverage, renderComment, summarizeVitest } from "./lib/pr-comment.ts";
import { openAiCompatibleChat } from "./lib/openai-chat.ts";
import { createRepoTools } from "./lib/repo-tools.ts";
import { FORMATTERS, runSandboxed, runSandboxedCaptured, sandboxCommand } from "./lib/sandbox.ts";
import { isArea, TEST_FILE_PATTERN } from "./lib/test-locations.ts";

type Flags = Record<string, string>;
interface Args {
  positional: string[];
  flags: Flags;
}

const repoRoot = process.cwd();
const MAX_DIFF_BYTES = 400_000;
// Written by the workflow or by claude-code-action (which parks PR copies of .claude/ in .claude-pr/); never part of a patch.
const MANAGED_PATHS = [".pr-agent/", ".claude/", ".claude-pr/"];

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) positional.push(arg);
    else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) flags[arg.slice(2)] = argv[++index];
    else flags[arg.slice(2)] = "true";
  }
  return { positional, flags };
}

function allowFlags(flags: Flags, allowed: string[]): void {
  const unknown = Object.keys(flags).filter((flag) => !allowed.includes(flag));
  if (unknown.length) throw new Error(`Unknown option(s): ${unknown.map((flag) => `--${flag}`).join(", ")}`);
}

function requireFlag(flags: Flags, name: string): string {
  const value = flags[name];
  if (!value || value === "true") throw new Error(`Missing --${name}`);
  return value;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function readJson<T = unknown>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function readText(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : null;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function setOutputs(outputs: Record<string, string | boolean>): void {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

function loadPlan(dir: string): ChangePlan {
  const plan = readJson<ChangePlan>(path.join(dir, "plan.json"));
  if (!plan) throw new Error(`Missing ${path.join(dir, "plan.json")}`);
  return plan;
}

function policyFor(flags: Flags) {
  const name = flags.policy ?? "tests";
  if (!(name in CHANGE_POLICIES)) throw new Error(`Unknown policy: ${name}`);
  return CHANGE_POLICIES[name as PolicyName];
}

function runInSandbox({ positional, flags }: Args, action: string): void {
  allowFlags(flags, []);
  const [area, ...files] = positional;
  process.exitCode = runSandboxed(sandboxCommand(action, area, files), { repoRoot });
}

function plan({ flags }: Args): void {
  allowFlags(flags, ["dir", "base", "head"]);
  const dir = requireFlag(flags, "dir");
  const range = `${requireFlag(flags, "base")}...${requireFlag(flags, "head")}`;
  const changePlan = planChanges(parseNameStatus(git(["diff", "--name-status", "-z", "-M", range])), {
    fileExists: (file) => fs.existsSync(path.join(repoRoot, file)),
  });
  writeJson(path.join(dir, "plan.json"), changePlan);

  const sources = changePlan.targets.map((target) => target.source);
  const diff = sources.length ? git(["diff", "-M", range, "--", ...sources]) : "";
  fs.writeFileSync(
    path.join(dir, "pr.diff"),
    diff.length > MAX_DIFF_BYTES ? `${diff.slice(0, MAX_DIFF_BYTES)}\n[diff truncated; read the source files directly]\n` : diff,
  );

  setOutputs({
    needs_tests: changePlan.needsTests,
    backend: changePlan.areas.includes("backend"),
    frontend: changePlan.areas.includes("frontend"),
  });
  console.log(JSON.stringify(changePlan, null, 2));
}

function vitestPassed(json: { numTotalTests?: number; numFailedTests?: number; numFailedTestSuites?: number } | null): boolean {
  return Boolean(json) && (json?.numTotalTests ?? 0) > 0 && json?.numFailedTests === 0 && (json?.numFailedTestSuites ?? 0) === 0;
}

function verify({ positional, flags }: Args): void {
  allowFlags(flags, ["dir", "baseline"]);
  const dir = path.resolve(requireFlag(flags, "dir"));
  const [area] = positional;
  if (!isArea(area)) throw new Error(`Unknown area: ${area}`);
  fs.mkdirSync(dir, { recursive: true });

  const phase = flags.baseline ? "before" : "after";
  const testsJson = path.join(dir, flags.baseline ? `${area}-tests-before.json` : `${area}-tests.json`);
  // Sandboxed output goes to a fresh folder: tests can't touch --dir, and nothing created by the sandbox user needs deleting.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pr-agent-out-"));
  fs.chmodSync(scratch, 0o777);
  const scratchJson = path.join(scratch, "tests.json");
  const coverageDir = path.join(scratch, "coverage");

  let typecheckOk = true;
  let formatOk = true;
  if (!flags.baseline) {
    typecheckOk = runSandboxed(sandboxCommand("typecheck", area), { repoRoot }) === 0;
    fs.writeFileSync(path.join(dir, `${area}-typecheck.txt`), typecheckOk ? "success" : "failure");

    const touchedTests = (readJson<PolicyResult>(path.join(dir, "guard.json"))?.allowed ?? []).filter((file) =>
      TEST_FILE_PATTERN[area].test(file),
    );
    if (FORMATTERS[area] && touchedTests.length) {
      formatOk = runSandboxed(sandboxCommand("format-check", area, touchedTests), { repoRoot }) === 0;
      fs.writeFileSync(path.join(dir, `${area}-format.txt`), formatOk ? "success" : "failure");
    }
  }

  runSandboxed(sandboxCommand("test", area, [], { json: scratchJson, coverage: true, coverageDir }), { repoRoot });
  if (fs.existsSync(scratchJson)) fs.copyFileSync(scratchJson, testsJson);
  const summary = path.join(coverageDir, "coverage-summary.json");
  if (fs.existsSync(summary)) fs.copyFileSync(summary, path.join(dir, `${area}-coverage-${phase}.json`));
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    // Folders created by the sandbox user may not be removable here; the runner is discarded anyway.
  }

  // Coverage thresholds can fail a run whose tests all passed, so judge by the results file, not the exit code.
  const testsOk = vitestPassed(readJson(testsJson));
  const label = (ok: boolean) => (ok ? "success" : "failure");
  console.log(`${area} ${phase}: typecheck=${label(typecheckOk)} format=${label(formatOk)} tests=${label(testsOk)}`);
  if (!flags.baseline && !(typecheckOk && formatOk && testsOk)) process.exitCode = 1;
}

function decision({ flags }: Args): void {
  allowFlags(flags, ["dir", "execution-file"]);
  const dir = requireFlag(flags, "dir");
  const log = readJson(requireFlag(flags, "execution-file"));
  const report = parseAgentReport(finalResultText(log));
  if (report) writeJson(path.join(dir, "decision.json"), report);
  const usage = agentUsage(log);
  if (usage) writeJson(path.join(dir, "usage.json"), usage);
  console.log(report ? JSON.stringify(report, null, 2) : "The agent did not return a valid report.");
  console.log(`Agent usage: ${formatUsage(usage)}`);
}

function usage({ flags }: Args): void {
  allowFlags(flags, ["dir"]);
  console.log(formatUsage(readJson<AgentUsage>(path.join(requireFlag(flags, "dir"), "usage.json"))));
}

function guard({ flags }: Args): void {
  allowFlags(flags, ["dir", "policy"]);
  const dir = requireFlag(flags, "dir");
  const changes = parsePorcelainStatus(git(["status", "--porcelain=v1", "-z", "-uall"])).filter(
    (change) => !MANAGED_PATHS.some((prefix) => change.path.startsWith(prefix)),
  );
  const result = policyFor(flags)(changes, loadPlan(dir));
  writeJson(path.join(dir, "guard.json"), result);
  setOutputs({ changed: result.allowed.length > 0 });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

function patch({ flags }: Args): void {
  allowFlags(flags, ["dir", "out"]);
  const dir = requireFlag(flags, "dir");
  const out = flags.out ? requireFlag(flags, "out") : path.join(dir, "changes.patch");
  const result = readJson<PolicyResult>(path.join(dir, "guard.json"));
  if (!result?.ok || !result.allowed.length) throw new Error("No approved changes to package");
  git(["add", "--intent-to-add", "--", ...result.allowed]);
  const diff = git(["diff", "HEAD", "--", ...result.allowed]);
  fs.writeFileSync(out, diff);
  console.log(`Wrote ${out} (${result.allowed.length} file(s), ${diff.length} bytes)`);
}

function checkPatch({ flags }: Args): void {
  allowFlags(flags, ["dir", "patch", "policy"]);
  const changes = filesInPatch(fs.readFileSync(requireFlag(flags, "patch"), "utf8"));
  const result = policyFor(flags)(changes, loadPlan(requireFlag(flags, "dir")));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok || !changes.length) process.exitCode = 1;
}

function modeFrom(flags: Flags): PolicyName {
  const mode = flags.mode ?? "tests";
  if (!(mode in CHANGE_POLICIES)) throw new Error(`Unknown mode: ${mode}`);
  return mode as PolicyName;
}

function loadVerification(dir: string, plan: ChangePlan | null): Record<string, AreaVerification> {
  if (!plan?.needsTests) return {};
  return Object.fromEntries(
    plan.areas.map((area) => [
      area,
      {
        typecheck: readText(path.join(dir, `${area}-typecheck.txt`)) ?? "skipped",
        format: readText(path.join(dir, `${area}-format.txt`)),
        tests: summarizeVitest(readJson(path.join(dir, `${area}-tests.json`))),
        linesBefore: lineCoverage(readJson(path.join(dir, `${area}-coverage-before.json`))),
        linesAfter: lineCoverage(readJson(path.join(dir, `${area}-coverage-after.json`))),
      },
    ]),
  );
}

function audit({ flags }: Args): void {
  allowFlags(flags, ["dir", "out", "mode", "engine", "model", "max-turns", "timeout-minutes", "status", "reason", "sha"]);
  const dir = requireFlag(flags, "dir");
  const event = readJson<{
    action?: string;
    pull_request?: { number?: number; base?: { ref?: string }; head?: { sha?: string } };
  }>(process.env.GITHUB_EVENT_PATH ?? "");
  const plan = readJson<ChangePlan>(path.join(dir, "plan.json"));
  const { GITHUB_SERVER_URL = "", GITHUB_REPOSITORY = "", GITHUB_RUN_ID = "", GITHUB_ACTOR = "" } = process.env;

  const record = buildAuditRecord({
    context: {
      timestamp: new Date().toISOString(),
      repository: GITHUB_REPOSITORY,
      runUrl: `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`,
      actor: GITHUB_ACTOR,
      event: event?.action ?? "",
      pr: event?.pull_request?.number ?? 0,
      baseRef: event?.pull_request?.base?.ref ?? "",
      headSha: event?.pull_request?.head?.sha ?? "",
      mode: modeFrom(flags),
      engine: flags.engine ?? "claude-code",
      model: flags.model ?? "",
      maxTurns: Number(flags["max-turns"] ?? 0),
      timeoutMinutes: Number(flags["timeout-minutes"] ?? 0),
    },
    plan,
    decision: readJson<AgentReport>(path.join(dir, "decision.json")),
    guard: readJson<PolicyResult>(path.join(dir, "guard.json")),
    verification: loadVerification(dir, plan),
    usage: readJson<AgentUsage>(path.join(dir, "usage.json")),
    outcome: { status: flags.status ?? "failed", reason: flags.reason, sha: flags.sha },
  });
  writeJson(requireFlag(flags, "out"), record);
  console.log(JSON.stringify(record, null, 2));
}

async function agent({ flags }: Args): Promise<void> {
  allowFlags(flags, ["dir", "agent-file", "skills-dir", "out"]);
  const dir = requireFlag(flags, "dir");
  const skillsDir = requireFlag(flags, "skills-dir");
  const out = requireFlag(flags, "out");
  const { PR_AGENT_API_BASE_URL: baseUrl, PR_AGENT_API_KEY: apiKey, MODEL: model, MAX_TURNS: maxTurns = "40" } = process.env;
  if (!baseUrl || !apiKey || !model) throw new Error("Set PR_AGENT_API_BASE_URL, PR_AGENT_API_KEY and MODEL");

  const changePlan = loadPlan(dir);
  const skills = fs
    .readdirSync(skillsDir)
    .map((name) => readText(path.join(skillsDir, name, "SKILL.md")))
    .flatMap((markdown) => (markdown ? [skillSummary(markdown)] : []))
    .filter((skill) => skill !== null);

  const result = await runAgentLoop({
    chat: openAiCompatibleChat({ baseUrl, apiKey, model }),
    tools: createRepoTools({
      repoRoot,
      plan: changePlan,
      skillsDir,
      runCommand: (command) => runSandboxedCaptured(command, { repoRoot }),
    }),
    systemPrompt: buildSystemPrompt(fs.readFileSync(requireFlag(flags, "agent-file"), "utf8"), skills),
    task: buildTask({ plan: changePlan, diff: readText(path.join(dir, "pr.diff")) ?? "" }),
    maxTurns: Number(maxTurns),
  });
  writeJson(out, result.log);
  setOutputs({ execution_file: out });
  console.log(`Agent ${result.completed ? "finished" : "stopped at the turn limit"}: ${formatUsage(agentUsage(result.log))}`);
  if (!result.completed) process.exitCode = 1;
}

function report({ flags }: Args): void {
  allowFlags(flags, ["dir", "run-url", "out", "status", "reason", "sha", "mode", "pr-url", "pr-number"]);
  const dir = requireFlag(flags, "dir");
  const changePlan = loadPlan(dir);

  const markdown = renderComment({
    mode: modeFrom(flags),
    plan: changePlan,
    decision: readJson<AgentReport>(path.join(dir, "decision.json")),
    guard: readJson<PolicyResult>(path.join(dir, "guard.json")),
    verification: loadVerification(dir, changePlan),
    usage: readJson<AgentUsage>(path.join(dir, "usage.json")),
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

const COMMANDS: Record<string, (args: Args) => void | Promise<void>> = {
  test: (args) => runInSandbox(args, "test"),
  typecheck: (args) => runInSandbox(args, "typecheck"),
  format: (args) => runInSandbox(args, "format"),
  plan,
  verify,
  decision,
  usage,
  guard,
  patch,
  "check-patch": checkPatch,
  report,
  audit,
  agent,
};

const [command, ...rest] = process.argv.slice(2);
const handler = COMMANDS[command];
if (!handler) {
  console.error(`Usage: node scripts/pr-agent/pr-agent.ts <${Object.keys(COMMANDS).join("|")}> ...`);
  process.exitCode = 2;
} else {
  try {
    await handler(parseArgs(rest));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
