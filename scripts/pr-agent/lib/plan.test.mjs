import test from "node:test";
import assert from "node:assert/strict";

import { planChanges } from "./plan.mjs";

const none = () => false;

test("maps backend source files to backend/tests/<name>.test.ts", () => {
  const existing = new Set(["backend/tests/router.test.ts"]);
  const plan = planChanges(
    [
      { path: "backend/src/features/todos/router.ts", status: "M" },
      { path: "backend/src/core/lifespan.ts", status: "A" },
    ],
    { fileExists: (file) => existing.has(file) },
  );

  assert.equal(plan.needsTests, true);
  assert.deepEqual(plan.areas, ["backend"]);
  assert.deepEqual(plan.targets, [
    {
      source: "backend/src/features/todos/router.ts",
      area: "backend",
      status: "M",
      testFile: "backend/tests/router.test.ts",
      testFileExists: true,
    },
    {
      source: "backend/src/core/lifespan.ts",
      area: "backend",
      status: "A",
      testFile: "backend/tests/lifespan.test.ts",
      testFileExists: false,
    },
  ]);
});

test("maps frontend source files to co-located test files with the same extension", () => {
  const plan = planChanges(
    [
      { path: "frontend/src/features/todos/components/TodoItem.tsx", status: "M" },
      { path: "frontend/src/features/todos/hooks/useTodosQuery.ts", status: "M" },
    ],
    { fileExists: none },
  );

  assert.deepEqual(plan.areas, ["frontend"]);
  assert.deepEqual(
    plan.targets.map((target) => target.testFile),
    [
      "frontend/src/features/todos/components/TodoItem.test.tsx",
      "frontend/src/features/todos/hooks/useTodosQuery.test.ts",
    ],
  );
});

test("ignores files that are not unit-testable application source", () => {
  const plan = planChanges(
    [
      { path: "README.md", status: "M" },
      { path: "backend/package.json", status: "M" },
      { path: "backend/Dockerfile", status: "M" },
      { path: "backend/prisma/schema.prisma", status: "M" },
      { path: "backend/src/main.ts", status: "M" },
      { path: "backend/src/features/todos/types.ts", status: "M" },
      { path: "backend/src/generated/prisma/client.ts", status: "M" },
      { path: "frontend/.storybook/main.ts", status: "M" },
      { path: "frontend/src/main.tsx", status: "M" },
      { path: "frontend/src/design-system/components/Button/Button.tsx", status: "M" },
      { path: "frontend/src/features/todos/components/Foo.stories.tsx", status: "A" },
      { path: "frontend/src/features/todos/components/Foo.styles.ts", status: "A" },
      { path: "frontend/src/features/todos/index.ts", status: "M" },
      { path: "frontend/src/features/todos/types.ts", status: "M" },
      { path: "frontend/src/vite-env.d.ts", status: "M" },
      { path: "frontend/src/features/todos/api/queryKeys.ts", status: "M" },
      { path: "backend/src/core/config.ts", status: "D" },
    ],
    { fileExists: none },
  );

  assert.equal(plan.needsTests, false);
  assert.deepEqual(plan.areas, []);
  assert.deepEqual(plan.targets, []);
  assert.equal(plan.ignored.length, 17);
  assert.ok(plan.ignored.every((entry) => typeof entry.reason === "string" && entry.reason));
});

test("records test files changed by the PR author separately", () => {
  const plan = planChanges(
    [
      { path: "backend/tests/router.test.ts", status: "M" },
      { path: "frontend/src/lib/http.test.ts", status: "M" },
    ],
    { fileExists: none },
  );

  assert.equal(plan.needsTests, false);
  assert.deepEqual(plan.changedTests, [
    "backend/tests/router.test.ts",
    "frontend/src/lib/http.test.ts",
  ]);
});

test("normalizes Windows separators and de-duplicates paths", () => {
  const plan = planChanges(
    [
      { path: "frontend\\src\\lib\\http.ts", status: "M" },
      { path: "frontend/src/lib/http.ts", status: "M" },
    ],
    { fileExists: none },
  );

  assert.equal(plan.targets.length, 1);
  assert.equal(plan.targets[0].testFile, "frontend/src/lib/http.test.ts");
});

test("treats paths that escape the repository as ignored", () => {
  const plan = planChanges(
    [{ path: "backend/src/../../etc/passwd.ts", status: "M" }],
    { fileExists: none },
  );

  assert.equal(plan.needsTests, false);
  assert.match(plan.ignored[0].reason, /unsafe/);
});
