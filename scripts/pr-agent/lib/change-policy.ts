import path from "node:path";

import type { ChangePlan, PlanTarget } from "./change-plan.ts";
import type { FileChange } from "./git-output.ts";
import {
  AREAS,
  type Area,
  isSafeRelativePath,
  normalizePath,
  TEST_FILE_PATTERN,
  testAreaOf,
} from "./test-locations.ts";

export interface PolicyResult {
  ok: boolean;
  allowed: string[];
  violations: { path: string; reason: string }[];
}

export type PolicyName = "tests" | "refactor";

type PolicyPlan = Pick<ChangePlan, "areas"> & { targets?: Pick<PlanTarget, "source" | "area">[] };

const SOURCE_FILE_PATTERN: Record<Area, RegExp> = {
  backend: /^backend\/src\/(?!generated\/)[\w.\-/]+\.ts$/,
  frontend: /^frontend\/src\/[\w.\-/]+\.tsx?$/,
};

function sourceAreaOf(file: string): Area | undefined {
  if (testAreaOf(file)) return undefined;
  return AREAS.find((area) => SOURCE_FILE_PATTERN[area].test(file));
}

function evaluate(
  changes: FileChange[],
  maxFiles: number,
  judge: (file: string, status: string) => string | null,
): PolicyResult {
  const allowed: string[] = [];
  const violations: PolicyResult["violations"] = [];

  for (const change of changes) {
    const file = normalizePath(change.path);
    const status = change.status.charAt(0);
    let reason: string | null;
    if (!isSafeRelativePath(file)) reason = "unsafe path";
    else if (status !== "A" && status !== "M") reason = "only new or modified text files are allowed";
    else reason = judge(file, status);

    if (reason) violations.push({ path: file, reason });
    else allowed.push(file);
  }

  if (allowed.length > maxFiles) {
    violations.push({ path: "*", reason: `agent changed more than ${maxFiles} files` });
  }
  return { ok: violations.length === 0, allowed, violations };
}

export function checkTestOnlyChanges(changes: FileChange[], plan: PolicyPlan, { maxFiles = 15 } = {}): PolicyResult {
  return evaluate(changes, maxFiles, (file) => {
    const area = testAreaOf(file);
    if (!area) return "not a test file in an allowed test location";
    if (!plan.areas.includes(area)) return `test file is outside the changed areas (${plan.areas.join(", ") || "none"})`;
    return null;
  });
}

export function checkRefactorChanges(changes: FileChange[], plan: PolicyPlan, { maxFiles = 12 } = {}): PolicyResult {
  const targets = plan.targets ?? [];
  const changedSources = new Set(targets.map((target) => target.source));
  const changedFolders = new Set(targets.map((target) => `${target.area}:${path.posix.dirname(target.source)}`));

  return evaluate(changes, maxFiles, (file, status) => {
    const testArea = testAreaOf(file);
    if (testArea) {
      if (status === "M") return "existing tests must stay unchanged in a refactor";
      if (!TEST_FILE_PATTERN[testArea].test(file)) return "new files under tests must be test files";
      if (!plan.areas.includes(testArea)) return "test file is outside the changed areas";
      return null;
    }

    const sourceArea = sourceAreaOf(file);
    if (!sourceArea) return "not application source or a test file";
    if (status === "M") return changedSources.has(file) ? null : "only source files changed by the PR may be refactored";
    return changedFolders.has(`${sourceArea}:${path.posix.dirname(file)}`)
      ? null
      : "new modules must sit next to a changed source file";
  });
}

export const CHANGE_POLICIES: Record<PolicyName, (changes: FileChange[], plan: PolicyPlan) => PolicyResult> = {
  tests: (changes, plan) => checkTestOnlyChanges(changes, plan),
  refactor: (changes, plan) => checkRefactorChanges(changes, plan),
};
