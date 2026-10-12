import { spawnSync } from "node:child_process";
import path from "node:path";

import { type Area, isArea, isSafeRelativePath, TEST_FILE_PATTERN } from "./test-locations.ts";

export type SandboxAction = "test" | "typecheck" | "format" | "format-check";

export interface SandboxCommand {
  cwd: Area;
  args: [Binary, ...string[]];
}

type Binary = keyof typeof BINARIES;
type Env = Record<string, string | undefined>;

const BINARIES = {
  vitest: ["node_modules", "vitest", "vitest.mjs"],
  tsc: ["node_modules", "typescript", "bin", "tsc"],
  prettier: ["node_modules", "prettier", "bin", "prettier.cjs"],
};

const ENV_ALLOWLIST = [
  "PATH", "Path", "PATHEXT", "HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR",
  "SystemRoot", "ComSpec", "LANG", "TZ",
];

export const FORMATTERS: Partial<Record<Area, Binary>> = { frontend: "prettier" };

export function scrubbedEnv(source: Env = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ENV_ALLOWLIST) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, CI: "true", NODE_ENV: "test", FORCE_COLOR: "0" };
}

function areaRelativeTestFiles(area: Area, files: string[]): string[] {
  return files.map((file) => {
    if (!isSafeRelativePath(file) || !TEST_FILE_PATTERN[area].test(file)) {
      throw new Error(`${file} is not a ${area} test file`);
    }
    return file.slice(area.length + 1);
  });
}

export function sandboxCommand(
  action: string,
  area: string | undefined,
  files: string[] = [],
  { json, coverage = false, coverageDir }: { json?: string; coverage?: boolean; coverageDir?: string } = {},
): SandboxCommand {
  if (!isArea(area)) throw new Error(`Unknown area: ${area}`);
  if (action === "typecheck") return { cwd: area, args: ["tsc", "--noEmit"] };

  if (action === "format" || action === "format-check") {
    const formatter = FORMATTERS[area];
    if (!formatter) throw new Error(`The ${area} has no formatter configured`);
    if (!files.length) throw new Error("Formatting needs at least one test file");
    return { cwd: area, args: [formatter, action === "format" ? "--write" : "--check", ...areaRelativeTestFiles(area, files)] };
  }

  if (action !== "test") throw new Error(`Unknown action: ${action}`);
  const args: SandboxCommand["args"] = ["vitest", "run", ...areaRelativeTestFiles(area, files)];
  if (json) args.push("--reporter=default", "--reporter=json", `--outputFile.json=${json}`);
  if (coverage) {
    args.push("--coverage", "--coverage.reporter=json-summary", "--coverage.reporter=text-summary", "--coverage.reportOnFailure");
    if (coverageDir) args.push(`--coverage.reportsDirectory=${coverageDir}`);
  }
  return { cwd: area, args };
}

export function sandboxSpawnSpec(
  { cwd, args }: SandboxCommand,
  { repoRoot = process.cwd(), execPath = process.execPath, env = process.env as Env } = {},
) {
  const [binary, ...rest] = args;
  const directory = path.join(repoRoot, cwd);
  const program = [execPath, path.join(directory, ...BINARIES[binary]), ...rest];
  const user = env.PR_AGENT_SANDBOX_USER;

  if (!user) {
    if (env.GITHUB_ACTIONS === "true") {
      throw new Error("Refusing to run tests unsandboxed in CI: PR_AGENT_SANDBOX_USER is not set");
    }
    return { command: execPath, args: program.slice(1), cwd: directory, env: scrubbedEnv(env) };
  }

  const assignments = Object.entries({ ...scrubbedEnv(env), HOME: `/home/${user}` }).map(([name, value]) => `${name}=${value}`);
  return {
    command: "sudo",
    args: ["-n", "-u", user, "--", "env", "-i", ...assignments, ...program],
    cwd: directory,
    env: scrubbedEnv(env),
  };
}

export function runSandboxed(command: SandboxCommand, { repoRoot = process.cwd() } = {}): number {
  const spec = sandboxSpawnSpec(command, { repoRoot });
  const result = spawnSync(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: "inherit",
    timeout: 10 * 60 * 1000,
  });
  return result.status ?? 1;
}

export function runSandboxedCaptured(
  command: SandboxCommand,
  { repoRoot = process.cwd(), maxOutput = 20_000 } = {},
): { exitCode: number; output: string } {
  const spec = sandboxSpawnSpec(command, { repoRoot });
  const result = spawnSync(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`;
  return {
    exitCode: result.status ?? 1,
    output: output.length > maxOutput ? `[output truncated]\n${output.slice(-maxOutput)}` : output,
  };
}
