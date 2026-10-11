// Policy gate applied to whatever the agent left in the working tree. It is the
// enforcement point: agent instructions and tool permissions are defence in
// depth, this check decides what may be committed.
import { isSafeRelativePath, normalizePath, testAreaOf } from "./paths.mjs";

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
