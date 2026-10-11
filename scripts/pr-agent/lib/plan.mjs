// Deterministic change planner: decides which changed files are unit-testable
// application source and where their tests live. The agent receives this plan;
// it never decides on its own which areas it may touch.
import path from "node:path";

import { AREAS, isSafeRelativePath, normalizePath, testAreaOf } from "./paths.mjs";

export { AREAS, isSafeRelativePath, normalizePath };

const BACKEND_IGNORED = [
  [/^backend\/src\/generated\//, "generated code"],
  [/^backend\/src\/main\.ts$/, "process entry point"],
  [/(^|\/)types\.ts$/, "type-only module"],
  [/\.d\.ts$/, "type declarations"],
];

const FRONTEND_IGNORED = [
  [/^frontend\/src\/main\.tsx$/, "process entry point"],
  [/^frontend\/src\/test\//, "test support code"],
  [/^frontend\/src\/design-system\//, "design-system primitives (covered by Storybook)"],
  [/\.stories\.tsx?$/, "Storybook story"],
  [/\.styles\.ts$/, "styled-components styles"],
  [/\.types\.ts$/, "type-only module"],
  [/\.variants\.ts$/, "style variants"],
  [/(^|\/)types\.ts$/, "type-only module"],
  [/(^|\/)index\.ts$/, "barrel re-export"],
  // Mirrors the coverage exclusions in vite.config.ts: constants only, nothing to test.
  [/(^|\/)queryKeys\.ts$/, "constant query keys"],
  [/\.d\.ts$/, "type declarations"],
];

function firstMatch(rules, file) {
  return rules.find(([pattern]) => pattern.test(file))?.[1];
}

function classify(file, status) {
  if (!isSafeRelativePath(file)) return { ignored: "unsafe path" };
  if (status === "D") return { ignored: "deleted file" };

  if (testAreaOf(file)) {
    return { changedTest: true };
  }

  if (/^backend\/src\/.+\.ts$/.test(file)) {
    const reason = firstMatch(BACKEND_IGNORED, file);
    if (reason) return { ignored: reason };
    const name = path.posix.basename(file, ".ts");
    return { area: "backend", testFile: `backend/tests/${name}.test.ts` };
  }

  if (/^frontend\/src\/.+\.tsx?$/.test(file)) {
    const reason = firstMatch(FRONTEND_IGNORED, file);
    if (reason) return { ignored: reason };
    const extension = path.posix.extname(file);
    return {
      area: "frontend",
      testFile: `${file.slice(0, -extension.length)}.test${extension}`,
    };
  }

  return { ignored: "not unit-testable application source" };
}

/**
 * @param {{ path: string, status: string }[]} changes  git name-status entries
 * @param {{ fileExists: (file: string) => boolean }} options
 */
export function planChanges(changes, { fileExists }) {
  const seen = new Set();
  const targets = [];
  const ignored = [];
  const changedTests = [];

  for (const change of changes ?? []) {
    const file = normalizePath(change.path);
    if (!file || seen.has(file)) continue;
    seen.add(file);

    const status = String(change.status ?? "M").charAt(0);
    const result = classify(file, status);
    if (result.ignored) ignored.push({ path: file, reason: result.ignored });
    else if (result.changedTest) changedTests.push(file);
    else {
      targets.push({
        source: file,
        area: result.area,
        status,
        testFile: result.testFile,
        testFileExists: Boolean(fileExists(result.testFile)),
      });
    }
  }

  const areas = AREAS.filter((area) => targets.some((target) => target.area === area));
  return { needsTests: targets.length > 0, areas, targets, ignored, changedTests };
}
