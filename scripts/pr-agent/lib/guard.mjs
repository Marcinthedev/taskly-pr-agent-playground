// Policy gate applied to whatever the agent left in the working tree. It is the
// enforcement point: agent instructions and tool permissions are defence in
// depth, this check decides what may be committed.
import path from "node:path";

import { isSafeRelativePath, normalizePath, TEST_FILE, testAreaOf } from "./paths.mjs";

const SOURCE_FILE = {
  backend: /^backend\/src\/(?!generated\/)[\w.\-/]+\.ts$/,
  frontend: /^frontend\/src\/[\w.\-/]+\.tsx?$/,
};

function sourceAreaOf(file) {
  if (testAreaOf(file)) return undefined;
  return Object.keys(SOURCE_FILE).find((area) => SOURCE_FILE[area].test(file));
}

/**
 * Policy for the testability agent, which refactors application code:
 * - it may modify only source files the PR already changed;
 * - it may add new modules next to those files, and new test files;
 * - it may not touch existing tests, so the unchanged suite staying green
 *   proves the refactor preserved behaviour.
 *
 * @param {{ path: string, status: string }[]} changes
 * @param {{ areas: string[], targets: { source: string, area: string }[] }} plan
 */
export function checkRefactorChanges(changes, plan, { maxFiles = 12 } = {}) {
  const allowed = [];
  const violations = [];
  const targets = new Set(plan.targets.map((target) => target.source));
  const targetDirs = new Set(plan.targets.map((target) => `${target.area}:${path.posix.dirname(target.source)}`));

  for (const change of changes ?? []) {
    const file = normalizePath(change.path);
    const status = String(change.status ?? "").charAt(0);
    const reject = (reason) => violations.push({ path: file, reason });
    const testArea = testAreaOf(file);
    const sourceArea = sourceAreaOf(file);

    if (!isSafeRelativePath(file)) reject("unsafe path");
    else if (status !== "A" && status !== "M") reject("only new or modified text files are allowed");
    else if (testArea && status === "M") reject("existing tests must stay unchanged in a refactor");
    else if (testArea) {
      if (!TEST_FILE[testArea].test(file)) reject("new files under tests must be test files");
      else if (!plan.areas.includes(testArea)) reject("test file is outside the changed areas");
      else allowed.push(file);
    } else if (sourceArea && status === "M") {
      if (targets.has(file)) allowed.push(file);
      else reject("only source files changed by the PR may be refactored");
    } else if (sourceArea) {
      if (targetDirs.has(`${sourceArea}:${path.posix.dirname(file)}`)) allowed.push(file);
      else reject("new modules must sit next to a changed source file");
    } else {
      reject("not application source or a test file");
    }
  }

  if (allowed.length > maxFiles) {
    violations.push({ path: "*", reason: `agent changed more than ${maxFiles} files` });
  }

  return { ok: violations.length === 0, allowed, violations };
}

/**
 * @param {{ path: string, status: string }[]} changes  git name-status entries
 * @param {{ areas: string[] }} plan
 */
export function checkAgentChanges(changes, plan, { maxFiles = 15 } = {}) {
  const allowed = [];
  const violations = [];

  for (const change of changes ?? []) {
    const file = normalizePath(change.path);
    const status = String(change.status ?? "").charAt(0);
    const reject = (reason) => violations.push({ path: file, reason });

    if (!isSafeRelativePath(file)) reject("unsafe path");
    else if (status !== "A" && status !== "M") reject("only new or modified text files are allowed");
    else {
      const area = testAreaOf(file);
      if (!area) reject("not a test file in an allowed test location");
      else if (!plan.areas.includes(area)) reject(`test file is outside the changed areas (${plan.areas.join(", ") || "none"})`);
      else allowed.push(file);
    }
  }

  if (allowed.length > maxFiles) {
    violations.push({ path: "*", reason: `agent changed more than ${maxFiles} files` });
  }

  return { ok: violations.length === 0, allowed, violations };
}
