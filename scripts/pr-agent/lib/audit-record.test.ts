import assert from "node:assert/strict";
import test from "node:test";

import { buildAuditRecord } from "./audit-record.ts";

const context = {
  timestamp: "2026-10-12T10:00:00.000Z",
  repository: "o/r",
  runUrl: "https://github.com/o/r/actions/runs/7",
  actor: "Marcinthedev",
  event: "synchronize",
  pr: 12,
  baseRef: "main",
  headSha: "abc123",
  mode: "tests" as const,
  model: "claude-sonnet-5-5",
  maxTurns: 40,
  timeoutMinutes: 15,
};

test("buildAuditRecord records who ran what, with which limits, and what it changed", () => {
  const record = buildAuditRecord({
    context,
    plan: {
      targets: [
        { source: "backend/src/features/todos/router.ts", area: "backend", status: "M", testFile: "backend/tests/router.test.ts", testFileExists: true },
      ],
    },
    decision: { decision: "tests_updated", summary: "", skills_used: ["pr-change-analysis", "test-verification"], files: [], skipped: [] },
    guard: { ok: true, allowed: ["backend/tests/router.test.ts"], violations: [] },
    verification: {
      backend: {
        typecheck: "success",
        format: null,
        tests: { total: 21, passed: 21, failed: 0, skipped: 0, failures: [] },
        linesBefore: 90,
        linesAfter: 93.7,
      },
    },
    usage: { costUsd: 0.42, turns: 18, durationMs: 300000, inputTokens: 100, outputTokens: 9000, cacheReadTokens: 500000, cacheWriteTokens: 40000 },
    outcome: { status: "committed", reason: "", sha: "def456" },
  });

  assert.deepEqual(record, {
    schemaVersion: 1,
    ...context,
    changedSources: ["backend/src/features/todos/router.ts"],
    decision: "tests_updated",
    skillsUsed: ["pr-change-analysis", "test-verification"],
    filesAllowed: ["backend/tests/router.test.ts"],
    violations: [],
    verification: { backend: { typecheck: "success", format: null, testsPassed: 21, testsTotal: 21, linesBefore: 90, linesAfter: 93.7 } },
    usage: { costUsd: 0.42, turns: 18, durationMs: 300000, inputTokens: 100, outputTokens: 9000, cacheReadTokens: 500000, cacheWriteTokens: 40000 },
    outcome: { status: "committed", reason: "", commit: "def456" },
  });
});

test("buildAuditRecord stays complete when the agent never reported or the guard never ran", () => {
  const record = buildAuditRecord({
    context,
    plan: null,
    decision: null,
    guard: null,
    verification: {},
    usage: null,
    outcome: { status: "failed", reason: "the agent run did not complete" },
  });

  assert.equal(record.decision, null);
  assert.deepEqual(record.changedSources, []);
  assert.deepEqual(record.skillsUsed, []);
  assert.deepEqual(record.filesAllowed, []);
  assert.equal(record.usage, null);
  assert.deepEqual(record.outcome, { status: "failed", reason: "the agent run did not complete", commit: null });
});
