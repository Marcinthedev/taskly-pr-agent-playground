import test from "node:test";
import assert from "node:assert/strict";

import { checkRefactorChanges } from "./guard.mjs";

const plan = {
  areas: ["backend", "frontend"],
  targets: [
    { source: "backend/src/features/todos/router.ts", area: "backend" },
    { source: "frontend/src/features/todos/TodosPage.tsx", area: "frontend" },
  ],
};

test("allows editing changed sources, extracting modules next to them, and adding new tests", () => {
  const result = checkRefactorChanges(
    [
      { path: "backend/src/features/todos/router.ts", status: "M" },
      { path: "backend/src/features/todos/completed.ts", status: "A" },
      { path: "backend/tests/completed.test.ts", status: "A" },
      { path: "frontend/src/features/todos/TodosPage.tsx", status: "M" },
      { path: "frontend/src/features/todos/clearNotice.ts", status: "A" },
      { path: "frontend/src/features/todos/clearNotice.test.ts", status: "A" },
    ],
    plan,
  );

  assert.equal(result.ok, true);
  assert.equal(result.allowed.length, 6);
});

test("existing tests must stay unchanged, which proves behaviour is preserved", () => {
  const result = checkRefactorChanges(
    [{ path: "backend/tests/router.test.ts", status: "M" }],
    plan,
  );

  assert.equal(result.ok, false);
  assert.match(result.violations[0].reason, /existing tests must stay unchanged/);
});

test("rejects source files the PR did not change", () => {
  const result = checkRefactorChanges(
    [{ path: "backend/src/features/todos/repository.ts", status: "M" }],
    plan,
  );

  assert.equal(result.ok, false);
  assert.match(result.violations[0].reason, /only source files changed by the PR/);
});

test("new modules must sit next to a changed source file", () => {
  const result = checkRefactorChanges(
    [
      { path: "backend/src/core/helpers.ts", status: "A" },
      { path: "frontend/src/lib/clear.ts", status: "A" },
    ],
    plan,
  );

  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 2);
  assert.match(result.violations[0].reason, /next to a changed source file/);
});

test("rejects config, workflow, dependency, deletions and unsafe paths", () => {
  const result = checkRefactorChanges(
    [
      { path: "backend/package.json", status: "M" },
      { path: ".github/workflows/ci.yml", status: "M" },
      { path: "backend/src/features/todos/router.ts", status: "D" },
      { path: "backend/src/features/todos/../../main.ts", status: "A" },
    ],
    plan,
  );

  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 4);
});

test("caps the number of changed files", () => {
  const changes = Array.from({ length: 3 }, (_, index) => ({
    path: `backend/tests/extracted${index}.test.ts`,
    status: "A",
  }));
  const result = checkRefactorChanges(changes, plan, { maxFiles: 2 });

  assert.equal(result.ok, false);
  assert.match(result.violations.at(-1).reason, /more than 2 files/);
});
