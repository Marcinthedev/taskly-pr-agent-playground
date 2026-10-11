// The only way the agent may execute code: typecheck or run Vitest for one area.
// In CI the child runs as a separate OS user (PR_AGENT_SANDBOX_USER) with an
// empty, allowlisted environment; the workflow blocks that user's network. A
// test written by the agent therefore cannot read the model key from the
// environment or from /proc of the agent process, and cannot send data out.
import { spawnSync } from "node:child_process";
import path from "node:path";

import { isSafeRelativePath, TEST_FILE } from "./paths.mjs";

const ENV_ALLOWLIST = [
  "PATH", "Path", "PATHEXT", "HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR",
  "SystemRoot", "ComSpec", "LANG", "TZ",
];

export function scrubbedEnv(source = process.env) {
  const env = {};
  for (const name of ENV_ALLOWLIST) {
    if (source[name] !== undefined) env[name] = source[name];
  }
  return { ...env, CI: "true", NODE_ENV: "test", FORCE_COLOR: "0" };
}

/**
 * @param {"test" | "typecheck"} action
 * @param {"backend" | "frontend"} area
 * @param {string[]} files  repository-relative test files; empty runs the whole suite
 * @param {{ json?: string, coverage?: boolean }} options
 */
export function buildCommand(action, area, files = [], { json, coverage = false } = {}) {
  if (!TEST_FILE[area]) throw new Error(`Unknown area: ${area}`);
  if (action === "typecheck") return { cwd: area, args: ["tsc", "--noEmit"] };
  if (action !== "test") throw new Error(`Unknown action: ${action}`);

  const relative = files.map((file) => {
    if (!isSafeRelativePath(file) || !TEST_FILE[area].test(file)) {
      throw new Error(`${file} is not a ${area} test file`);
    }
    return file.slice(area.length + 1);
  });

  const args = ["vitest", "run", ...relative];
  if (json) args.push("--reporter=default", "--reporter=json", `--outputFile.json=${json}`);
  if (coverage) {
    // reportOnFailure: a red baseline (e.g. a PR that broke a test) still gets a coverage number.
    args.push(
      "--coverage", "--coverage.reporter=json-summary", "--coverage.reporter=text-summary",
      "--coverage.reportOnFailure",
    );
  }
  return { cwd: area, args };
}

// Run the package's own binaries through node: no npx, no shell, no PATH lookup.
const BINARIES = {
  vitest: ["node_modules", "vitest", "vitest.mjs"],
  tsc: ["node_modules", "typescript", "bin", "tsc"],
};

export function spawnSpec({ cwd, args }, { repoRoot = process.cwd(), execPath = process.execPath, env = process.env } = {}) {
  const [binary, ...rest] = args;
  const directory = path.join(repoRoot, cwd);
  const program = [execPath, path.join(directory, ...BINARIES[binary]), ...rest];
  const user = env.PR_AGENT_SANDBOX_USER;

  if (!user) {
    if (env.GITHUB_ACTIONS === "true") {
      throw new Error("Refusing to run tests unsandboxed in CI: PR_AGENT_SANDBOX_USER is not set");
    }
    return { command: program[0], args: program.slice(1), cwd: directory, env: scrubbedEnv(env) };
  }

  const sandboxEnv = { ...scrubbedEnv(env), HOME: `/home/${user}` };
  const assignments = Object.entries(sandboxEnv).map(([name, value]) => `${name}=${value}`);
  return {
    command: "sudo",
    args: ["-n", "-u", user, "--", "env", "-i", ...assignments, ...program],
    cwd: directory,
    env: scrubbedEnv(env),
  };
}

export function runCommand(command, { repoRoot = process.cwd() } = {}) {
  const spec = spawnSpec(command, { repoRoot });
  const result = spawnSync(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: "inherit",
    timeout: 10 * 60 * 1000,
  });
  return result.status ?? 1;
}