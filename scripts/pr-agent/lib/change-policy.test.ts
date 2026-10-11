import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { checkRefactorChanges, checkTestOnlyChanges } from "./change-policy.ts";
import type { Area } from "./test-locations.ts";

const bothAreas: Area[] = ["backend", "frontend"];

describe("test-only policy", () => {
  const plan = { areas: bothAreas };

  test("accepts new and modified test files in planned areas", () => {
    const result = checkTestOnlyChanges(
      [
        { path: "backend/tests/router.test.ts", status: "M" },
        { path: "backend/tests/lifespan.test.ts", status: "A" },
        { path: "frontend/src/features/todos/hooks/useTodosQuery.test.ts", status: "A" },
        { path: "frontend/src/features/todos/TodosPage.test.tsx", status: "M" },
      ],
      plan,
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.violations, []);
    assert.equal(result.allowed.length, 4);
  });

  test("accepts shared test helpers next to the tests", () => {
    const result = checkTestOnlyChanges(
      [
        { path: "backend/tests/fixture.ts", status: "M" },
        { path: "frontend/src/test/renderWithClient.tsx", status: "A" },
      ],
      plan,
    );

    assert.equal(result.ok, true);
  });

  test("rejects the global test setup file, which would change every test", () => {
    const result = checkTestOnlyChanges([{ path: "frontend/src/test/setup.ts", status: "M" }], plan);

    assert.equal(result.ok, false);
    assert.match(result.violations[0].reason, /not a test file/);
  });

  test("rejects application source, config, workflow and agent files", () => {
    const result = checkTestOnlyChanges(
      [
        { path: "backend/src/features/todos/router.ts", status: "M" },
        { path: "backend/package.json", status: "M" },
        { path: "backend/vitest.config.ts", status: "M" },
        { path: ".github/workflows/pr-agents.yml", status: "M" },
        { path: ".claude/settings.json", status: "M" },
        { path: "scripts/pr-agent/lib/change-policy.ts", status: "M" },
      ],
      plan,
    );

    assert.equal(result.ok, false);
    assert.equal(result.violations.length, 6);
    assert.ok(result.violations.every((violation) => /not a test file/.test(violation.reason)));
  });

  test("rejects deletions and renames, even of test files", () => {
    const result = checkTestOnlyChanges(
      [
        { path: "backend/tests/router.test.ts", status: "D" },
        { path: "backend/tests/app.test.ts", status: "R100" },
      ],
      plan,
    );

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.violations.map((violation) => violation.reason),
      ["only new or modified text files are allowed", "only new or modified text files are allowed"],
    );
  });

  test("rejects tests in an area the PR did not change", () => {
    const result = checkTestOnlyChanges([{ path: "frontend/src/App.test.tsx", status: "M" }], { areas: ["backend"] });

    assert.equal(result.ok, false);
    assert.match(result.violations[0].reason, /outside the changed areas/);
  });

  test("rejects path traversal and too many files", () => {
    const traversal = checkTestOnlyChanges([{ path: "backend/tests/../src/main.test.ts", status: "A" }], plan);
    assert.equal(traversal.ok, false);
    assert.match(traversal.violations[0].reason, /unsafe path/);

    const many = Array.from({ length: 4 }, (_, index) => ({ path: `backend/tests/generated${index}.test.ts`, status: "A" }));
    const tooMany = checkTestOnlyChanges(many, plan, { maxFiles: 3 });
    assert.equal(tooMany.ok, false);
    assert.match(tooMany.violations.at(-1)!.reason, /more than 3 files/);
  });

  test("an empty change set is valid but has nothing allowed", () => {
    const result = checkTestOnlyChanges([], plan);
    assert.equal(result.ok, true);
    assert.deepEqual(result.allowed, []);
  });
});

describe("refactor policy", () => {
  const plan = {
    areas: bothAreas,
    targets: [
      { source: "backend/src/features/todos/router.ts", area: "backend" as const },
      { source: "frontend/src/features/todos/TodosPage.tsx", area: "frontend" as const },
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
    const result = checkRefactorChanges([{ path: "backend/tests/router.test.ts", status: "M" }], plan);

    assert.equal(result.ok, false);
    assert.match(result.violations[0].reason, /existing tests must stay unchanged/);
  });

  test("rejects source files the PR did not change", () => {
    const result = checkRefactorChanges([{ path: "backend/src/features/todos/repository.ts", status: "M" }], plan);

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
    const changes = Array.from({ length: 3 }, (_, index) => ({ path: `backend/tests/extracted${index}.test.ts`, status: "A" }));
    const result = checkRefactorChanges(changes, plan, { maxFiles: 2 });

    assert.equal(result.ok, false);
    assert.match(result.violations.at(-1)!.reason, /more than 2 files/);
  });
});
