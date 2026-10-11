import path from "node:path";

import type { FileChange } from "./git-output.ts";
import { AREAS, type Area, isSafeRelativePath, normalizePath, testAreaOf } from "./test-locations.ts";

export interface PlanTarget {
  source: string;
  area: Area;
  status: string;
  testFile: string;
  testFileExists: boolean;
}

export interface ChangePlan {
  needsTests: boolean;
  areas: Area[];
  targets: PlanTarget[];
  ignored: { path: string; reason: string }[];
  changedTests: string[];
}

type IgnoreRule = [pattern: RegExp, reason: string];

const BACKEND_IGNORED: IgnoreRule[] = [
  [/^backend\/src\/generated\//, "generated code"],
  [/^backend\/src\/main\.ts$/, "process entry point"],
  [/(^|\/)types\.ts$/, "type-only module"],
  [/\.d\.ts$/, "type declarations"],
];

const FRONTEND_IGNORED: IgnoreRule[] = [
  [/^frontend\/src\/main\.tsx$/, "process entry point"],
  [/^frontend\/src\/test\//, "test support code"],
  [/^frontend\/src\/design-system\//, "design-system primitives (covered by Storybook)"],
  [/\.stories\.tsx?$/, "Storybook story"],
  [/\.styles\.ts$/, "styled-components styles"],
  [/\.types\.ts$/, "type-only module"],
  [/\.variants\.ts$/, "style variants"],
  [/(^|\/)types\.ts$/, "type-only module"],
  [/(^|\/)index\.ts$/, "barrel re-export"],
  [/(^|\/)queryKeys\.ts$/, "constant query keys"],
  [/\.d\.ts$/, "type declarations"],
];

type Classification =
  | { kind: "ignored"; reason: string }
  | { kind: "changed-test" }
  | { kind: "target"; area: Area; testFile: string };

function ignoreReason(rules: IgnoreRule[], file: string): string | undefined {
  return rules.find(([pattern]) => pattern.test(file))?.[1];
}

function classify(file: string, status: string): Classification {
  if (!isSafeRelativePath(file)) return { kind: "ignored", reason: "unsafe path" };
  if (status === "D") return { kind: "ignored", reason: "deleted file" };
  if (testAreaOf(file)) return { kind: "changed-test" };

  if (/^backend\/src\/.+\.ts$/.test(file)) {
    const reason = ignoreReason(BACKEND_IGNORED, file);
    if (reason) return { kind: "ignored", reason };
    return { kind: "target", area: "backend", testFile: `backend/tests/${path.posix.basename(file, ".ts")}.test.ts` };
  }

  if (/^frontend\/src\/.+\.tsx?$/.test(file)) {
    const reason = ignoreReason(FRONTEND_IGNORED, file);
    if (reason) return { kind: "ignored", reason };
    const extension = path.posix.extname(file);
    return { kind: "target", area: "frontend", testFile: `${file.slice(0, -extension.length)}.test${extension}` };
  }

  return { kind: "ignored", reason: "not unit-testable application source" };
}

export function planChanges(changes: FileChange[], { fileExists }: { fileExists: (file: string) => boolean }): ChangePlan {
  const seen = new Set<string>();
  const plan: ChangePlan = { needsTests: false, areas: [], targets: [], ignored: [], changedTests: [] };

  for (const change of changes) {
    const file = normalizePath(change.path);
    if (!file || seen.has(file)) continue;
    seen.add(file);

    const status = (change.status || "M").charAt(0);
    const result = classify(file, status);
    if (result.kind === "ignored") plan.ignored.push({ path: file, reason: result.reason });
    else if (result.kind === "changed-test") plan.changedTests.push(file);
    else {
      plan.targets.push({
        source: file,
        area: result.area,
        status,
        testFile: result.testFile,
        testFileExists: fileExists(result.testFile),
      });
    }
  }

  plan.areas = AREAS.filter((area) => plan.targets.some((target) => target.area === area));
  plan.needsTests = plan.targets.length > 0;
  return plan;
}
