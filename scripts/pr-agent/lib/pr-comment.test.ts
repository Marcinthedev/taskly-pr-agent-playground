import assert from "node:assert/strict";
import test from "node:test";

import type { AgentUsage } from "./agent-result.ts";
import type { ChangePlan } from "./change-plan.ts";
import {
  formatUsage,
  lineCoverage,
  renderComment,
  sanitizeAgentText,
  summarizeVitest,
  TEST_AGENT_MARKER,
  TESTABILITY_AGENT_MARKER,
} from "./pr-comment.ts";

const usage: AgentUsage = {
  costUsd: 0.4213,
  turns: 23,
  durationMs: 312000,
  inputTokens: 1200,
  outputTokens: 18000,
  cacheWriteTokens: 40000,
  cacheReadTokens: 610000,
};

const vitestJson = {
  numTotalTests: 4,
  numPassedTests: 3,
  numFailedTests: 1,
  numPendingTests: 0,
  testResults: [
    {
      assertionResults: [
        { fullName: "lists tasks", status: "passed", failureMessages: [] },
        { fullName: "deletes tasks", status: "failed", failureMessages: ["AssertionError: expected 404 to be 204\n    at stack line"] },
      ],
    },
  ],
};

const plan: ChangePlan = {
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

test("formatUsage summarises turns, tokens, estimated cost and duration on one line", () => {
  assert.equal(formatUsage(usage), "23 turns · tokens: 1.2k in, 18k out, 610k cache read, 40k cache write · ~$0.42 · 5m 12s");
});

test("formatUsage leaves out unknown values and handles no data", () => {
  assert.equal(
    formatUsage({ ...usage, costUsd: null, cacheReadTokens: null, cacheWriteTokens: null }),
    "23 turns · tokens: 1.2k in, 18k out · 5m 12s",
  );
  assert.equal(formatUsage(null), "not reported");
});

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

test("lineCoverage reads the total line percentage", () => {
  assert.equal(lineCoverage({ total: { lines: { pct: 55.6 }, branches: { pct: 48.45 } } }), 55.6);
  assert.equal(lineCoverage({}), null);
  assert.equal(lineCoverage(null), null);
});

test("sanitizeAgentText neutralises mentions, HTML and runaway length", () => {
  assert.equal(sanitizeAgentText("ping @octocat <img src=x>"), "ping @​octocat &lt;img src=x&gt;");
  assert.equal(sanitizeAgentText("x".repeat(600), 10), "xxxxxxxxxx…");
  assert.equal(sanitizeAgentText(undefined), "");
});

test("renderComment shows the decision, verification and coverage change of a committed run", () => {
  const markdown = renderComment({
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
        format: null,
        tests: { total: 12, passed: 12, failed: 0, skipped: 0, failures: [] },
        linesBefore: 50,
        linesAfter: 62.5,
      },
    },
    usage,
    outcome: { status: "committed", sha: "abc1234def" },
    runUrl: "https://github.com/o/r/actions/runs/1",
  });

  assert.ok(markdown.startsWith(TEST_AGENT_MARKER));
  assert.match(markdown, /`tests_updated`/);
  assert.match(markdown, /`backend-unit-tests`/);
  assert.match(markdown, /\| backend \| ✅ success \| n\/a \| 12 \/ 12 passed \| 50% → 62.5% \(\+12.5\) \|/);
  assert.match(markdown, /Committed 1 test file\(s\) to this branch in `abc1234`/);
  assert.match(markdown, /\*\*Agent usage:\*\* 23 turns · tokens: 1\.2k in, 18k out/);
  assert.match(markdown, /README\.md/);
  assert.match(markdown, /actions\/runs\/1/);
});

test("renderComment shows the formatting result of frontend tests", () => {
  const markdown = renderComment({
    plan: { ...plan, targets: [] },
    decision: null,
    guard: null,
    verification: {
      frontend: {
        typecheck: "success",
        format: "failure",
        tests: { total: 3, passed: 3, failed: 0, skipped: 0, failures: [] },
        linesBefore: null,
        linesAfter: null,
      },
    },
    outcome: { status: "rejected", reason: "the changes failed typecheck, formatting or the test suite" },
    runUrl: "https://github.com/o/r/actions/runs/3",
  });

  assert.match(markdown, /\| Area \| Typecheck \| Format \| Tests \| Line coverage \|/);
  assert.match(markdown, /\| frontend \| ✅ success \| ❌ failure \| 3 \/ 3 passed \| n\/a \|/);
});

test("renderComment lists failures and policy violations and never claims a commit", () => {
  const markdown = renderComment({
    plan,
    decision: { decision: "tests_added", summary: "", skills_used: [], files: [], skipped: [] },
    guard: {
      ok: false,
      allowed: [],
      violations: [{ path: "backend/src/main.ts", reason: "not a test file in an allowed test location" }],
    },
    verification: {
      backend: { typecheck: "failure", format: null, tests: summarizeVitest(vitestJson), linesBefore: null, linesAfter: null },
    },
    outcome: { status: "rejected", reason: "the agent changed files outside its policy" },
    runUrl: "https://github.com/o/r/actions/runs/2",
  });

  assert.match(markdown, /### Policy violations/);
  assert.match(markdown, /backend\/src\/main\.ts/);
  assert.match(markdown, /❌ failure/);
  assert.match(markdown, /deletes tasks/);
  assert.match(markdown, /Not published: the agent changed files outside its policy/);
  assert.doesNotMatch(markdown, /Committed /);
});

test("renderComment in refactor mode uses its own title and marker and links the opened PR", () => {
  const markdown = renderComment({
    mode: "refactor",
    plan,
    decision: { decision: "refactored", summary: "Extracted completed-task filtering.", skills_used: ["testability-review"], files: [], skipped: [] },
    guard: { ok: true, allowed: ["backend/src/features/todos/completed.ts"], violations: [] },
    outcome: { status: "pr-opened", url: "https://github.com/o/r/pull/15", number: 15 },
    runUrl: "https://github.com/o/r/actions/runs/4",
  });

  assert.ok(markdown.startsWith(TESTABILITY_AGENT_MARKER));
  assert.ok(!markdown.includes(TEST_AGENT_MARKER));
  assert.match(markdown, /## 🧩 Testability Agent/);
  assert.match(markdown, /Opened #15 .*https:\/\/github\.com\/o\/r\/pull\/15/);
});

test("renderComment explains when no tests were needed", () => {
  const markdown = renderComment({
    plan: { ...plan, targets: [] },
    decision: null,
    guard: null,
    outcome: { status: "skipped", reason: "no unit-testable source changed" },
    runUrl: "https://github.com/o/r/actions/runs/5",
  });

  assert.match(markdown, /Skipped: no unit-testable source changed/);
  assert.match(markdown, /No unit-testable application source changed/);
  assert.doesNotMatch(markdown, /\| Area \|/);
});
