import test from "node:test";
import assert from "node:assert/strict";

import {
  formatUsage,
  REPORT_MARKER,
  renderReport,
  sanitizeAgentText,
  summarizeCoverage,
  summarizeVitest,
} from "./report.mjs";

const usage = {
  costUsd: 0.4213,
  turns: 23,
  durationMs: 312000,
  inputTokens: 1200,
  outputTokens: 18000,
  cacheWriteTokens: 40000,
  cacheReadTokens: 610000,
};

test("formatUsage summarises turns, tokens, estimated cost and duration on one line", () => {
  assert.equal(
    formatUsage(usage),
    "23 turns · tokens: 1.2k in, 18k out, 610k cache read, 40k cache write · ~$0.42 · 5m 12s",
  );
});

test("formatUsage leaves out unknown values and handles no data", () => {
  assert.equal(formatUsage({ ...usage, costUsd: null, cacheReadTokens: null, cacheWriteTokens: null }),
    "23 turns · tokens: 1.2k in, 18k out · 5m 12s");
  assert.equal(formatUsage(null), "not reported");
});

test("renderReport shows agent usage when it is known", () => {
  const markdown = renderReport({
    plan: { needsTests: true, areas: [], targets: [], ignored: [], changedTests: [] },
    decision: null,
    guard: null,
    verification: {},
    usage,
    outcome: { status: "skipped", reason: "nothing to do" },
    runUrl: "https://github.com/o/r/actions/runs/9",
  });

  assert.match(markdown, /\*\*Agent usage:\*\* 23 turns · tokens: 1\.2k in, 18k out/);
});

const vitestJson = {
  numTotalTests: 4,
  numPassedTests: 3,
  numFailedTests: 1,
  numPendingTests: 0,
  success: false,
  testResults: [
    {
      name: "/repo/backend/tests/router.test.ts",
      assertionResults: [
        { fullName: "lists tasks", status: "passed", failureMessages: [] },
        {
          fullName: "deletes tasks",
          status: "failed",
          failureMessages: ["AssertionError: expected 404 to be 204\n    at stack line"],
        },
      ],
    },
  ],
};

test("summarizeVitest counts results and keeps the first line of each failure", () => {
  assert.deepEqual(summarizeVitest(vitestJson), {
    total: 4,
    passed: 3,
    failed: 1,
    skipped: 0,
    failures: [{ name: "deletes tasks", message: "AssertionError: expected 404 to be 204" }],
  });
  assert.equal(summarizeVitest(null), null);
});

test("summarizeCoverage extracts total percentages", () => {
  const summary = {
    total: {
      lines: { pct: 55.6 },
      statements: { pct: 54.09 },
      functions: { pct: 53.7 },
      branches: { pct: 48.45 },
    },
  };
  assert.deepEqual(summarizeCoverage(summary), {
    lines: 55.6,
    statements: 54.09,
    functions: 53.7,
    branches: 48.45,
  });
  assert.equal(summarizeCoverage({}), null);
});

test("sanitizeAgentText neutralises mentions, HTML and runaway length", () => {
  assert.equal(sanitizeAgentText("ping @octocat <img src=x>"), "ping @​octocat &lt;img src=x&gt;");
  assert.equal(sanitizeAgentText("x".repeat(600), 10), "xxxxxxxxxx…");
  assert.equal(sanitizeAgentText(undefined), "");
});

const plan = {
  needsTests: true,
  areas: ["backend"],
  targets: [
    {
      source: "backend/src/features/todos/router.ts",
      area: "backend",
      status: "M",
      testFile: "backend/tests/router.test.ts",
      testFileExists: true,
    },
  ],
  ignored: [{ path: "README.md", reason: "not unit-testable application source" }],
  changedTests: [],
};

test("renderReport shows the agent decision, guard, verification and coverage delta", () => {
  const markdown = renderReport({
    plan,
    decision: {
      decision: "tests_updated",
      summary: "Router gained DELETE /completed; added cases.",
      skills_used: ["pr-change-analysis", "backend-unit-tests", "test-verification"],
      files: [{ path: "backend/tests/router.test.ts", action: "updated", covers: "DELETE /completed" }],
      skipped: [],
    },
    guard: { ok: true, allowed: ["backend/tests/router.test.ts"], violations: [] },
    verification: {
      backend: {
        typecheck: "success",
        tests: { total: 12, passed: 12, failed: 0, skipped: 0, failures: [] },
        coverageBefore: { lines: 50, statements: 50, functions: 50, branches: 40 },
        coverageAfter: { lines: 62.5, statements: 61, functions: 60, branches: 45 },
      },
    },
    outcome: { status: "committed", sha: "abc1234def" },
    runUrl: "https://github.com/o/r/actions/runs/1",
  });

  assert.ok(markdown.startsWith(REPORT_MARKER));
  assert.match(markdown, /tests_updated/);
  assert.match(markdown, /`backend-unit-tests`/);
  assert.match(markdown, /\| backend \| ✅ success \| 12 \/ 12 passed \| 50% → 62.5% \(\+12.5\) \|/);
  assert.match(markdown, /Committed .*abc1234/);
  assert.match(markdown, /README\.md/);
  assert.match(markdown, /actions\/runs\/1/);
});

test("renderReport lists failures and guard violations and never claims a commit", () => {
  const markdown = renderReport({
    plan,
    decision: { decision: "tests_added", summary: "", skills_used: [], files: [], skipped: [] },
    guard: {
      ok: false,
      allowed: [],
      violations: [{ path: "backend/src/main.ts", reason: "not a test file in an allowed test location" }],
    },
    verification: {
      backend: {
        typecheck: "failure",
        tests: summarizeVitest(vitestJson),
        coverageBefore: null,
        coverageAfter: null,
      },
    },
    outcome: { status: "rejected", reason: "guard rejected the agent's changes" },
    runUrl: "https://github.com/o/r/actions/runs/2",
  });

  assert.match(markdown, /backend\/src\/main\.ts/);
  assert.match(markdown, /❌ failure/);
  assert.match(markdown, /deletes tasks/);
  assert.match(markdown, /Not committed/);
  assert.doesNotMatch(markdown, /Committed /);
});

test("renderReport explains when no tests were needed", () => {
  const markdown = renderReport({
    plan: { ...plan, needsTests: false, areas: [], targets: [] },
    decision: null,
    guard: null,
    verification: {},
    outcome: { status: "skipped", reason: "no unit-testable source changed" },
    runUrl: "https://github.com/o/r/actions/runs/3",
  });

  assert.match(markdown, /no unit-testable source changed/);
  assert.doesNotMatch(markdown, /\| Area \|/);
});
