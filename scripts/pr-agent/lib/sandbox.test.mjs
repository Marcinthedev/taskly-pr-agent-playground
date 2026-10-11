import test from "node:test";
import assert from "node:assert/strict";

import path from "node:path";

import { buildCommand, scrubbedEnv, spawnSpec } from "./sandbox.mjs";

test("scrubbedEnv keeps only the variables a test runner needs", () => {
  const env = scrubbedEnv({
    PATH: "/usr/bin",
    HOME: "/home/runner",
    ANTHROPIC_API_KEY: "sk-ant-secret",
    GITHUB_TOKEN: "ghs_secret",
    ACTIONS_RUNTIME_TOKEN: "runtime",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc",
    DATABASE_URL: "postgresql://u:p@db/x",
    npm_config_userconfig: "/tmp/npmrc",
    TEMP: "C:\\Temp",
  });

  assert.deepEqual(env, {
    PATH: "/usr/bin",
    HOME: "/home/runner",
    TEMP: "C:\\Temp",
    CI: "true",
    NODE_ENV: "test",
    FORCE_COLOR: "0",
  });
});

test("buildCommand runs only selected test files inside the area", () => {
  const command = buildCommand("test", "backend", ["backend/tests/router.test.ts"]);

  assert.deepEqual(command, {
    cwd: "backend",
    args: ["vitest", "run", "tests/router.test.ts"],
  });
});

test("buildCommand supports frontend files, typecheck and coverage runs", () => {
  assert.deepEqual(
    buildCommand("test", "frontend", ["frontend/src/lib/http.test.ts"]),
    { cwd: "frontend", args: ["vitest", "run", "src/lib/http.test.ts"] },
  );
  assert.deepEqual(buildCommand("typecheck", "frontend"), {
    cwd: "frontend",
    args: ["tsc", "--noEmit"],
  });
  assert.deepEqual(buildCommand("test", "backend", [], { json: "out.json", coverage: true }), {
    cwd: "backend",
    args: [
      "vitest", "run",
      "--reporter=default", "--reporter=json", "--outputFile.json=out.json",
      "--coverage", "--coverage.reporter=json-summary", "--coverage.reporter=text-summary",
      "--coverage.reportOnFailure",
    ],
  });
});

test("spawnSpec runs the package binary directly with node when no sandbox user is configured", () => {
  const spec = spawnSpec(buildCommand("test", "backend"), {
    repoRoot: "/repo",
    execPath: "/usr/bin/node",
    env: { PATH: "/usr/bin", HOME: "/home/dev", ANTHROPIC_API_KEY: "secret" },
  });

  assert.equal(spec.command, "/usr/bin/node");
  assert.deepEqual(spec.args, [path.join("/repo", "backend", "node_modules", "vitest", "vitest.mjs"), "run"]);
  assert.equal(spec.cwd, path.join("/repo", "backend"));
  assert.equal(spec.env.ANTHROPIC_API_KEY, undefined);
});

test("spawnSpec drops to the sandbox user with an empty, allowlisted environment", () => {
  const spec = spawnSpec(buildCommand("typecheck", "frontend"), {
    repoRoot: "/repo",
    execPath: "/usr/bin/node",
    env: { PATH: "/usr/bin", HOME: "/home/runner", ANTHROPIC_API_KEY: "secret", PR_AGENT_SANDBOX_USER: "prsandbox" },
  });

  assert.equal(spec.command, "sudo");
  assert.deepEqual(spec.args, [
    "-n", "-u", "prsandbox", "--", "env", "-i",
    "PATH=/usr/bin", "HOME=/home/prsandbox", "CI=true", "NODE_ENV=test", "FORCE_COLOR=0",
    "/usr/bin/node", path.join("/repo", "frontend", "node_modules", "typescript", "bin", "tsc"), "--noEmit",
  ]);
  assert.ok(!spec.args.some((arg) => arg.includes("secret")));
});

test("spawnSpec refuses to run unsandboxed on GitHub Actions", () => {
  assert.throws(
    () => spawnSpec(buildCommand("test", "backend"), { repoRoot: "/repo", execPath: "node", env: { GITHUB_ACTIONS: "true" } }),
    /PR_AGENT_SANDBOX_USER/,
  );
});

test("buildCommand rejects unknown areas, actions and files outside the area", () => {
  assert.throws(() => buildCommand("test", "infra"), /Unknown area/);
  assert.throws(() => buildCommand("exec", "backend"), /Unknown action/);
  assert.throws(
    () => buildCommand("test", "backend", ["frontend/src/lib/http.test.ts"]),
    /not a backend test file/,
  );
  assert.throws(
    () => buildCommand("test", "backend", ["backend/tests/x.test.ts; curl evil"]),
    /not a backend test file/,
  );
  assert.throws(
    () => buildCommand("test", "backend", ["--config=/tmp/evil.ts"]),
    /not a backend test file/,
  );
});
