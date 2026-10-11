import path from "node:path";

export const AREAS = ["backend", "frontend"] as const;
export type Area = (typeof AREAS)[number];

const SAFE_SEGMENT = "[\\w.\\-/]+";

export const TEST_FILE_PATTERN: Record<Area, RegExp> = {
  backend: new RegExp(`^backend/tests/${SAFE_SEGMENT}\\.test\\.ts$`),
  frontend: new RegExp(`^frontend/src/${SAFE_SEGMENT}\\.test\\.tsx?$`),
};

const TEST_HELPER_PATTERN: Record<Area, RegExp> = {
  backend: new RegExp(`^backend/tests/${SAFE_SEGMENT}\\.ts$`),
  frontend: new RegExp(`^frontend/src/test/${SAFE_SEGMENT}\\.tsx?$`),
};

const GLOBAL_TEST_SETUP = /^frontend\/src\/test\/setup\.tsx?$/;

export function isArea(value: string | undefined): value is Area {
  return AREAS.includes(value as Area);
}

export function normalizePath(file: string | undefined): string {
  return String(file ?? "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export function isSafeRelativePath(file: string): boolean {
  if (!file || file.startsWith("/") || /^[a-zA-Z]:/.test(file)) return false;
  return path.posix.normalize(file) === file && !file.split("/").includes("..");
}

export function testAreaOf(file: string): Area | undefined {
  if (!isSafeRelativePath(file) || GLOBAL_TEST_SETUP.test(file)) return undefined;
  return AREAS.find((area) => TEST_FILE_PATTERN[area].test(file) || TEST_HELPER_PATTERN[area].test(file));
}
