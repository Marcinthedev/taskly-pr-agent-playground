import test from "node:test";
import assert from "node:assert/strict";

import { checkAgentChanges } from "./guard.mjs";

const fullStackPlan = { areas: ["backend", "frontend"] };

test("accepts new and modified test files in planned areas", () => {
  const result = checkAgentChanges(
    [
      { path: "backend/tests/router.test.ts", status: "M" },
      { path: "backend/tests/lifespan.test.ts", status: "A" },
      { path: "frontend/src/features/todos/hooks/useTodosQuery.test.ts", status: "A" },
      { path: "frontend/src/features/todos/TodosPage.test.tsx", status: "M" },
    ],
    fullStackPlan,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.allowed.length, 4);
});

test("accepts shared test helpers next to the tests", () => {
  const result = checkAgentChanges(
    [
      { path: "backend/tests/fixture.ts", status: "M" },
      { path: "frontend/src/test/renderWithClient.tsx", status: "A" },
    ],
    fullStackPlan,
  );

  assert.equal(result.ok, true);
});

test("rejects the global test setup file, which would change every test", () => {
  const result = checkAgentChanges([{ path: "frontend/src/test/setup.ts", status: "M" }], fullStackPlan);

  assert.equal(result.ok, false);
  assert.match(result.violations[0].reason, /not a test file/);
});

test("rejects application source, config, workflow and agent files", () => {
  const result = checkAgentChanges(
    [
      { path: "backend/src/features/todos/router.ts", status: "M" },
      { path: "backend/package.json", status: "M" },
      { path: "backend/vitest.config.ts", status: "M" },
      { path: ".github/workflows/pr-test-agent.yml", status: "M" },
      { path: ".claude/settings.json", status: "M" },
      { path: "scripts/pr-agent/lib/guard.mjs", status: "M" },
    ],
    fullStackPlan,
  );

  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 6);
  assert.ok(result.violations.every((violation) => /not a test file/.test(violation.reason)));
});

test("rejects deletions and renames, even of test files", () => {
  const result = checkAgentChanges(
    [
      { path: "backend/tests/router.test.ts", status: "D" },
      { path: "backend/tests/app.test.ts", status: "R100" },
    ],
    fullStackPlan,
  );

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.violations.map((violation) => violation.reason),
    ["only new or modified text files are allowed", "only new or modified text files are allowed"],
  );
});

test("rejects tests in an area the PR did not change", () => {
  const result = checkAgentChanges(
    [{ path: "frontend/src/App.test.tsx", status: "M" }],
    { areas: ["backend"] },
  );

  assert.equal(result.ok, false);
  assert.match(result.violations[0].reason, /outside the changed areas/);
});

test("rejects path traversal and too many files", () => {
  const traversal = checkAgentChanges(
    [{ path: "backend/tests/../src/main.test.ts", status: "A" }],
    fullStackPlan,
  );
  assert.equal(traversal.ok, false);
  assert.match(traversal.violations[0].reason, /unsafe path/);

  const many = Array.from({ length: 4 }, (_, index) => ({
    path: `backend/tests/generated${index}.test.ts`,
    status: "A",
  }));
  const tooMany = checkAgentChanges(many, fullStackPlan, { maxFiles: 3 });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.violations.at(-1).reason, /more than 3 files/);
});

test("an empty change set is valid but has nothing allowed", () => {
  const result = checkAgentChanges([], fullStackPlan);
  assert.equal(result.ok, true);
  assert.deepEqual(result.allowed, []);
});
