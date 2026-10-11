// Single source of truth for where tests live. The planner, the guard and the
// sandboxed runner all read these, so they cannot drift apart.
import path from "node:path";

export const AREAS = ["backend", "frontend"];

const SAFE_SEGMENT = "[\\w.\\-/]+";

/** Runnable test files, per area. */
export const TEST_FILE = {
  backend: new RegExp(`^backend/tests/${SAFE_SEGMENT}\\.test\\.ts$`),
  frontend: new RegExp(`^frontend/src/${SAFE_SEGMENT}\\.test\\.tsx?$`),
};

/** Shared test helpers the agent may also edit, per area. */
export const TEST_HELPER = {
  backend: new RegExp(`^backend/tests/${SAFE_SEGMENT}\\.ts$`),
  frontend: new RegExp(`^frontend/src/test/${SAFE_SEGMENT}\\.tsx?$`),
};

export function normalizePath(file) {
  return String(file ?? "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export function isSafeRelativePath(file) {
  if (!file || file.startsWith("/") || /^[a-zA-Z]:/.test(file)) return false;
  return path.posix.normalize(file) === file && !file.split("/").includes("..");
}

/** Test infrastructure that applies to every test (Vitest setupFiles). */
const GLOBAL_TEST_SETUP = [/^frontend\/src\/test\/setup\.tsx?$/];

/** The area whose test file or helper this path is, or undefined. */
export function testAreaOf(file) {
  if (!isSafeRelativePath(file) || GLOBAL_TEST_SETUP.some((pattern) => pattern.test(file))) return undefined;
  return AREAS.find((area) => TEST_FILE[area].test(file) || TEST_HELPER[area].test(file));
}
