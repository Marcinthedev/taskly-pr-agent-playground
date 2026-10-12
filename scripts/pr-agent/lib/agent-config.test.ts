import assert from "node:assert/strict";
import test from "node:test";

import { parseEnvFile, resolveAgentConfig } from "./agent-config.ts";

const file = [
  "# Non-secret settings",
  "PR_AGENT_ENGINE=claude-code",
  "PR_AGENT_API_BASE_URL=",
  "PR_AGENT_MODEL=claude-sonnet-5-5",
  "PR_AGENT_MAX_TURNS=40",
  "PR_AGENT_TIMEOUT_MINUTES=15",
  "PR_AGENT_AUTO_COMMIT=true",
  "PR_AGENT_KEEP_TRANSCRIPT=false",
  "",
].join("\r\n");

test("reads the settings from the env file", () => {
  assert.deepEqual(resolveAgentConfig(file), {
    ENGINE: "claude-code",
    API_BASE_URL: "",
    MODEL: "claude-sonnet-5-5",
    MAX_TURNS: "40",
    AGENT_TIMEOUT_MINUTES: "15",
    AUTO_COMMIT: "true",
    KEEP_TRANSCRIPT: "false",
  });
});

test("lets non-empty repository variables override the file and ignores unrelated ones", () => {
  const config = resolveAgentConfig(file, {
    PR_AGENT_ENGINE: "openai-compatible",
    PR_AGENT_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
    PR_AGENT_MODEL: "gemini-2.5-flash",
    PR_AGENT_MAX_TURNS: "",
    PR_AGENT_ALLOWED_USERS: "someone",
  });

  assert.equal(config.ENGINE, "openai-compatible");
  assert.equal(config.MODEL, "gemini-2.5-flash");
  assert.equal(config.MAX_TURNS, "40");
});

test("rejects unknown keys, malformed lines and keys set twice", () => {
  assert.throws(() => parseEnvFile("PR_AGENT_API_KEY=sk-123"), /line 1: unknown setting PR_AGENT_API_KEY/);
  assert.throws(() => parseEnvFile("export PR_AGENT_MODEL=x"), /line 1: expected KEY=value/);
  assert.throws(() => parseEnvFile("PR_AGENT_MODEL=a\n# preset\nPR_AGENT_MODEL=b"), /line 3: PR_AGENT_MODEL is set twice/);
});

test("rejects values that could break the workflow or leak the key", () => {
  const invalid: [Record<string, string>, RegExp][] = [
    [{ PR_AGENT_ENGINE: "codex" }, /PR_AGENT_ENGINE/],
    [{ PR_AGENT_MODEL: "gpt-5 --dangerously-skip-permissions" }, /PR_AGENT_MODEL/],
    [{ PR_AGENT_MAX_TURNS: "1e9" }, /PR_AGENT_MAX_TURNS/],
    [{ PR_AGENT_TIMEOUT_MINUTES: "120" }, /PR_AGENT_TIMEOUT_MINUTES/],
    [{ PR_AGENT_AUTO_COMMIT: "yes" }, /PR_AGENT_AUTO_COMMIT/],
    [{ PR_AGENT_ENGINE: "openai-compatible" }, /PR_AGENT_API_BASE_URL must be a URL/],
    [{ PR_AGENT_ENGINE: "openai-compatible", PR_AGENT_API_BASE_URL: "https://user:pw@host/v1" }, /credentials/],
  ];
  for (const [variables, error] of invalid) {
    assert.throws(() => resolveAgentConfig(file, variables), error, JSON.stringify(variables));
  }
});
