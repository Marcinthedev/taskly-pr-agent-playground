import test from "node:test";
import assert from "node:assert/strict";

import { parseNameStatus, parsePorcelain, patchChanges } from "./git.mjs";

test("parseNameStatus reads NUL-delimited diff output including renames", () => {
  const output = [
    "M", "backend/src/features/todos/router.ts",
    "A", "frontend/src/lib/new.ts",
    "D", "frontend/src/old.ts",
    "R087", "backend/src/a.ts", "backend/src/b.ts",
    "",
  ].join("\0");

  assert.deepEqual(parseNameStatus(output), [
    { status: "M", path: "backend/src/features/todos/router.ts" },
    { status: "A", path: "frontend/src/lib/new.ts" },
    { status: "D", path: "frontend/src/old.ts" },
    { status: "R", path: "backend/src/b.ts" },
  ]);
});

test("parsePorcelain maps working-tree states to A/M/D/R", () => {
  const output = [
    " M backend/tests/router.test.ts",
    "?? backend/tests/lifespan.test.ts",
    "A  frontend/src/lib/x.test.ts",
    " D backend/tests/app.test.ts",
    "R  backend/tests/new.test.ts", "backend/tests/old.test.ts",
    "",
  ].join("\0");

  assert.deepEqual(parsePorcelain(output), [
    { status: "M", path: "backend/tests/router.test.ts" },
    { status: "A", path: "backend/tests/lifespan.test.ts" },
    { status: "A", path: "frontend/src/lib/x.test.ts" },
    { status: "D", path: "backend/tests/app.test.ts" },
    { status: "R", path: "backend/tests/new.test.ts" },
  ]);
});

test("patchChanges lists every file a patch touches with its kind of change", () => {
  const patch = [
    "diff --git a/backend/tests/router.test.ts b/backend/tests/router.test.ts",
    "index 1111111..2222222 100644",
    "--- a/backend/tests/router.test.ts",
    "+++ b/backend/tests/router.test.ts",
    "@@ -1 +1 @@",
    "-a",
    "+b",
    "diff --git a/backend/tests/new.test.ts b/backend/tests/new.test.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/backend/tests/new.test.ts",
    "diff --git a/backend/src/main.ts b/backend/src/main.ts",
    "deleted file mode 100644",
    "diff --git a/backend/tests/a.test.ts b/backend/tests/b.test.ts",
    "similarity index 90%",
    "rename from backend/tests/a.test.ts",
    "rename to backend/tests/b.test.ts",
    "diff --git a/frontend/src/x.test.ts b/frontend/src/x.test.ts",
    "GIT binary patch",
    "diff --git a/backend/tests/run.test.ts b/backend/tests/run.test.ts",
    "old mode 100644",
    "new mode 100755",
    "",
  ].join("\n");

  assert.deepEqual(patchChanges(patch), [
    { status: "M", path: "backend/tests/router.test.ts" },
    { status: "A", path: "backend/tests/new.test.ts" },
    { status: "D", path: "backend/src/main.ts" },
    { status: "R", path: "backend/tests/b.test.ts" },
    { status: "B", path: "frontend/src/x.test.ts" },
    { status: "X", path: "backend/tests/run.test.ts" },
  ]);
});

test("parsers return an empty list for empty output", () => {
  assert.deepEqual(parseNameStatus(""), []);
  assert.deepEqual(parsePorcelain(""), []);
});
