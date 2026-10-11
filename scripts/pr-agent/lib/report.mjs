// Renders the single PR comment from verified facts: the deterministic plan,
// the guard result, test/coverage numbers measured by the workflow, and the
// agent's self-reported decision (sanitised, and labelled as the agent's).
export const REPORT_MARKER = "<!-- taskly-pr-test-agent -->";

const ICON = { success: "✅", failure: "❌", skipped: "⏭️", cancelled: "⏹️" };

export function summarizeVitest(json) {
  if (!json || typeof json !== "object") return null;
  const failures = [];
  for (const file of json.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status !== "failed") continue;
      const message = String(assertion.failureMessages?.[0] ?? "").split("\n")[0];
      failures.push({ name: assertion.fullName, message: message.slice(0, 300) });
    }
  }
  return {
    total: json.numTotalTests ?? 0,
    passed: json.numPassedTests ?? 0,
    failed: json.numFailedTests ?? 0,
    skipped: (json.numPendingTests ?? 0) + (json.numTodoTests ?? 0),
    failures,
  };
}

export function summarizeCoverage(summary) {
  const total = summary?.total;
  if (!total) return null;
  return {
    lines: total.lines.pct,
    statements: total.statements.pct,
    functions: total.functions.pct,
    branches: total.branches.pct,
  };
}

function compactNumber(value) {
  const trim = (number) => String(Math.round(number * 10) / 10);
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}k`;
  return String(value);
}

function duration(ms) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/** One line for the PR comment and the commit message. */
export function formatUsage(usage) {
  if (!usage) return "not reported";
  const parts = [];
  if (usage.turns !== null) parts.push(`${usage.turns} turns`);
  const tokens = [
    [usage.inputTokens, "in"],
    [usage.outputTokens, "out"],
    [usage.cacheReadTokens, "cache read"],
    [usage.cacheWriteTokens, "cache write"],
  ].filter(([value]) => value !== null);
  if (tokens.length) parts.push(`tokens: ${tokens.map(([value, label]) => `${compactNumber(value)} ${label}`).join(", ")}`);
  if (usage.costUsd !== null) parts.push(`~$${usage.costUsd.toFixed(2)}`);
  if (usage.durationMs !== null) parts.push(duration(usage.durationMs));
  return parts.length ? parts.join(" · ") : "not reported";
}

export function sanitizeAgentText(value, maxLength = 500) {
  const text = String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@(?=[\w-])/g, "@​")
    .replace(/\r?\n/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function code(value) {
  return `\`${String(value ?? "").replace(/[`\r\n]/g, "")}\``;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function coverageCell(before, after) {
  if (!after) return "n/a";
  if (!before) return `${round(after.lines)}%`;
  const delta = round(after.lines - before.lines);
  const sign = delta >= 0 ? "+" : "";
  return `${round(before.lines)}% → ${round(after.lines)}% (${sign}${delta})`;
}

function testsCell(tests) {
  if (!tests) return "not run";
  const skipped = tests.skipped ? `, ${tests.skipped} skipped` : "";
  return `${tests.passed} / ${tests.total} passed${skipped}`;
}

function outcomeLine(outcome, guard) {
  switch (outcome?.status) {
    case "committed":
      return `✅ Committed ${guard?.allowed?.length ?? 0} test file(s) to this branch in ${code(String(outcome.sha).slice(0, 7))}.`;
    case "proposed":
      return "📎 Verified tests are attached as a patch artifact (auto-commit is disabled).";
    case "skipped":
      return `⏭️ Skipped: ${sanitizeAgentText(outcome.reason)}.`;
    default:
      return `⚠️ Not committed: ${sanitizeAgentText(outcome?.reason ?? "unknown")}.`;
  }
}

export function renderReport({ plan, decision, guard, verification = {}, usage = null, outcome, runUrl }) {
  const lines = [REPORT_MARKER, "## 🧪 PR Test Agent", "", `**Outcome:** ${outcomeLine(outcome, guard)}`, ""];
  if (usage) lines.push(`**Agent usage:** ${formatUsage(usage)}`, "");

  if (decision) {
    lines.push("### Agent decision", "");
    lines.push(`- **Decision:** ${code(decision.decision)}`);
    if (decision.summary) lines.push(`- **Summary (agent-written):** ${sanitizeAgentText(decision.summary)}`);
    if (decision.skills_used?.length) {
      lines.push(`- **Skills used:** ${decision.skills_used.map(code).join(", ")}`);
    }
    if (decision.files?.length) {
      lines.push("", "| Test file | Action | Covers |", "| --- | --- | --- |");
      for (const file of decision.files) {
        lines.push(`| ${code(file.path)} | ${sanitizeAgentText(file.action, 20)} | ${sanitizeAgentText(file.covers, 200)} |`);
      }
    }
    for (const skipped of decision.skipped ?? []) {
      lines.push(`- Skipped ${code(skipped.source)}: ${sanitizeAgentText(skipped.reason, 200)}`);
    }
    lines.push("");
  }

  if (guard && !guard.ok) {
    lines.push("### Guard violations", "", "The agent's changes were discarded because they broke the test-only policy:", "");
    for (const violation of guard.violations) lines.push(`- ${code(violation.path)}: ${violation.reason}`);
    lines.push("");
  }

  const areas = Object.keys(verification);
  if (areas.length) {
    lines.push("### Verification (run by the workflow, not the agent)", "");
    lines.push("| Area | Typecheck | Format | Tests | Line coverage |", "| --- | --- | --- | --- | --- |");
    for (const area of areas) {
      const result = verification[area];
      const typecheck = `${ICON[result.typecheck] ?? "❔"} ${result.typecheck ?? "not run"}`;
      const format = result.format ? `${ICON[result.format] ?? "❔"} ${result.format}` : "n/a";
      lines.push(`| ${area} | ${typecheck} | ${format} | ${testsCell(result.tests)} | ${coverageCell(result.coverageBefore, result.coverageAfter)} |`);
    }
    const failures = areas.flatMap((area) => verification[area].tests?.failures ?? []);
    if (failures.length) {
      lines.push("", "**Failing tests:**", "");
      for (const failure of failures.slice(0, 20)) {
        lines.push(`- ${sanitizeAgentText(failure.name, 200)}: ${code(failure.message)}`);
      }
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
