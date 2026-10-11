import type { AgentReport, AgentUsage } from "./agent-result.ts";
import type { ChangePlan } from "./change-plan.ts";
import type { PolicyName, PolicyResult } from "./change-policy.ts";

export const TEST_AGENT_MARKER = "<!-- taskly-pr-test-agent -->";
export const TESTABILITY_AGENT_MARKER = "<!-- taskly-testability-agent -->";

const HEADERS: Record<PolicyName, { marker: string; title: string }> = {
  tests: { marker: TEST_AGENT_MARKER, title: "## 🧪 PR Test Agent" },
  refactor: { marker: TESTABILITY_AGENT_MARKER, title: "## 🧩 Testability Agent" },
};

const ICON: Record<string, string> = { success: "✅", failure: "❌", skipped: "⏭️" };

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: { name: string; message: string }[];
}

export interface AreaVerification {
  typecheck: string;
  format: string | null;
  tests: TestSummary | null;
  linesBefore: number | null;
  linesAfter: number | null;
}

export interface Outcome {
  status: string;
  reason?: string;
  sha?: string;
  url?: string;
  number?: string | number;
}

export interface CommentInput {
  mode?: PolicyName;
  plan: Pick<ChangePlan, "targets" | "ignored">;
  decision: AgentReport | null;
  guard: PolicyResult | null;
  verification?: Record<string, AreaVerification>;
  usage?: AgentUsage | null;
  outcome: Outcome;
  runUrl: string;
}

interface VitestJson {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  testResults?: { assertionResults?: { fullName: string; status: string; failureMessages?: string[] }[] }[];
}

export function summarizeVitest(json: unknown): TestSummary | null {
  if (!json || typeof json !== "object") return null;
  const report = json as VitestJson;
  const failures = (report.testResults ?? [])
    .flatMap((file) => file.assertionResults ?? [])
    .filter((assertion) => assertion.status === "failed")
    .map((assertion) => ({
      name: assertion.fullName,
      message: String(assertion.failureMessages?.[0] ?? "").split("\n")[0].slice(0, 300),
    }));
  return {
    total: report.numTotalTests ?? 0,
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? 0,
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
    failures,
  };
}

export function lineCoverage(summary: unknown): number | null {
  const pct = (summary as { total?: { lines?: { pct?: unknown } } } | null)?.total?.lines?.pct;
  return typeof pct === "number" ? pct : null;
}

function compactNumber(value: number): string {
  const trim = (number: number) => String(Math.round(number * 10) / 10);
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}k`;
  return String(value);
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function formatUsage(usage: AgentUsage | null | undefined): string {
  if (!usage) return "not reported";
  const parts: string[] = [];
  if (usage.turns !== null) parts.push(`${usage.turns} turns`);
  const counts: [number | null, string][] = [
    [usage.inputTokens, "in"],
    [usage.outputTokens, "out"],
    [usage.cacheReadTokens, "cache read"],
    [usage.cacheWriteTokens, "cache write"],
  ];
  const tokens = counts.filter((entry): entry is [number, string] => entry[0] !== null);
  if (tokens.length) parts.push(`tokens: ${tokens.map(([value, label]) => `${compactNumber(value)} ${label}`).join(", ")}`);
  if (usage.costUsd !== null) parts.push(`~$${usage.costUsd.toFixed(2)}`);
  if (usage.durationMs !== null) parts.push(duration(usage.durationMs));
  return parts.length ? parts.join(" · ") : "not reported";
}

export function sanitizeAgentText(value: unknown, maxLength = 500): string {
  const text = String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@(?=[\w-])/g, "@​")
    .replace(/\r?\n/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function code(value: unknown): string {
  return `\`${String(value ?? "").replace(/[`\r\n]/g, "")}\``;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function coverageCell(before: number | null, after: number | null): string {
  if (after === null) return "n/a";
  if (before === null) return `${round(after)}%`;
  const delta = round(after - before);
  return `${round(before)}% → ${round(after)}% (${delta >= 0 ? "+" : ""}${delta})`;
}

function testsCell(tests: TestSummary | null): string {
  if (!tests) return "not run";
  return `${tests.passed} / ${tests.total} passed${tests.skipped ? `, ${tests.skipped} skipped` : ""}`;
}

function statusCell(status: string | null, missing: string): string {
  return status ? `${ICON[status] ?? "❔"} ${status}` : missing;
}

function outcomeLine(outcome: Outcome, guard: PolicyResult | null): string {
  switch (outcome.status) {
    case "committed":
      return `✅ Committed ${guard?.allowed.length ?? 0} test file(s) to this branch in ${code(String(outcome.sha).slice(0, 7))}.`;
    case "proposed":
      return "📎 Verified tests are attached as a patch artifact (auto-commit is disabled).";
    case "pr-opened":
      return `🔀 Opened #${Number(outcome.number)} with the refactor and its tests, for your review: ${String(outcome.url).replace(/[\s()<>]/g, "")}`;
    case "skipped":
      return `⏭️ Skipped: ${sanitizeAgentText(outcome.reason)}.`;
    default:
      return `⚠️ Not published: ${sanitizeAgentText(outcome.reason || "unknown")}.`;
  }
}

export function renderComment({
  mode = "tests",
  plan,
  decision,
  guard,
  verification = {},
  usage = null,
  outcome,
  runUrl,
}: CommentInput): string {
  const { marker, title } = HEADERS[mode];
  const lines = [marker, title, "", `**Outcome:** ${outcomeLine(outcome, guard)}`, ""];
  if (usage) lines.push(`**Agent usage:** ${formatUsage(usage)}`, "");

  if (decision) {
    lines.push("### Agent decision", "", `- **Decision:** ${code(decision.decision)}`);
    if (decision.summary) lines.push(`- **Summary (agent-written):** ${sanitizeAgentText(decision.summary)}`);
    if (decision.skills_used.length) lines.push(`- **Skills used:** ${decision.skills_used.map(code).join(", ")}`);
    if (decision.files.length) {
      lines.push("", "| File | Action | Covers |", "| --- | --- | --- |");
      for (const file of decision.files) {
        lines.push(`| ${code(file.path)} | ${sanitizeAgentText(file.action, 20)} | ${sanitizeAgentText(file.covers, 200)} |`);
      }
    }
    for (const skipped of decision.skipped) {
      lines.push(`- Skipped ${code(skipped.source)}: ${sanitizeAgentText(skipped.reason, 200)}`);
    }
    lines.push("");
  }

  if (guard && !guard.ok) {
    lines.push("### Policy violations", "", "The agent's changes were discarded because they broke its file policy:", "");
    for (const violation of guard.violations) lines.push(`- ${code(violation.path)}: ${violation.reason}`);
    lines.push("");
  }

  const areas = Object.keys(verification);
  if (areas.length) {
    lines.push("### Verification (run by the workflow, not the agent)", "");
    lines.push("| Area | Typecheck | Format | Tests | Line coverage |", "| --- | --- | --- | --- | --- |");
    for (const area of areas) {
      const result = verification[area];
      lines.push(
        `| ${area} | ${statusCell(result.typecheck, "not run")} | ${statusCell(result.format, "n/a")} | ${testsCell(result.tests)} | ${coverageCell(result.linesBefore, result.linesAfter)} |`,
      );
    }
    const failures = areas.flatMap((area) => verification[area].tests?.failures ?? []);
    if (failures.length) {
      lines.push("", "**Failing tests:**", "");
      for (const failure of failures.slice(0, 20)) lines.push(`- ${sanitizeAgentText(failure.name, 200)}: ${code(failure.message)}`);
    }
    lines.push("");
  }

  lines.push("<details><summary>Change plan</summary>", "");
  if (plan.targets.length) {
    lines.push("| Changed source | Test file |", "| --- | --- |");
    for (const target of plan.targets) {
      lines.push(`| ${code(target.source)} | ${code(target.testFile)}${target.testFileExists ? "" : " (new)"} |`);
    }
  } else {
    lines.push("No unit-testable application source changed.");
  }
  if (plan.ignored.length) {
    lines.push("", "Ignored:", "");
    for (const entry of plan.ignored.slice(0, 50)) lines.push(`- ${code(entry.path)}: ${entry.reason}`);
  }
  lines.push("", "</details>", "", `[Workflow run and artifacts](${runUrl})`);

  return lines.join("\n");
}
