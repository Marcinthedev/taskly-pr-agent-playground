import test from "node:test";
import assert from "node:assert/strict";

import { agentUsage, extractDecision, finalAgentText } from "./decision.mjs";

test("agentUsage reads cost, turns, duration and tokens from the run log", () => {
  const log = [
    { type: "assistant", message: { content: [] } },
    {
      type: "result",
      subtype: "success",
      total_cost_usd: 0.4213,
      num_turns: 23,
      duration_ms: 312000,
      usage: {
        input_tokens: 1200,
        output_tokens: 18000,
        cache_creation_input_tokens: 40000,
        cache_read_input_tokens: 610000,
      },
    },
  ];

  assert.deepEqual(agentUsage(log), {
    costUsd: 0.4213,
    turns: 23,
    durationMs: 312000,
    inputTokens: 1200,
    outputTokens: 18000,
    cacheWriteTokens: 40000,
    cacheReadTokens: 610000,
  });
});

test("agentUsage counts subagent work: per-model totals and every assistant turn", () => {
  // The coordinator's own `usage` excludes the subagent that did the work;
  // `modelUsage` covers the whole session.
  const log = [
    { type: "assistant", message: {} },
    { type: "assistant", message: {}, parent_tool_use_id: "toolu_1" },
    { type: "assistant", message: {}, parent_tool_use_id: "toolu_1" },
    { type: "assistant", message: {} },
    {
      type: "result",
      total_cost_usd: 0.28,
      num_turns: 2,
      duration_ms: 74000,
      usage: { input_tokens: 4, output_tokens: 1000, cache_read_input_tokens: 30500, cache_creation_input_tokens: 8600 },
      modelUsage: {
        "claude-sonnet-5-5": { inputTokens: 40, outputTokens: 21000, cacheReadInputTokens: 900000, cacheCreationInputTokens: 60000, costUSD: 0.25 },
        "claude-haiku-5-5": { inputTokens: 10, outputTokens: 500, cacheReadInputTokens: 2000, cacheCreationInputTokens: 0, costUSD: 0.03 },
      },
    },
  ];

  assert.deepEqual(agentUsage(log), {
    costUsd: 0.28,
    turns: 4,
    durationMs: 74000,
    inputTokens: 50,
    outputTokens: 21500,
    cacheWriteTokens: 60000,
    cacheReadTokens: 902000,
  });
});

test("agentUsage tolerates missing fields and missing logs", () => {
  assert.deepEqual(agentUsage([{ type: "result", num_turns: 3 }]), {
    costUsd: null,
    turns: 3,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    cacheWriteTokens: null,
    cacheReadTokens: null,
  });
  assert.equal(agentUsage(null), null);
  assert.equal(agentUsage([{ type: "assistant" }]), null);
});

const valid = {
  decision: "tests_added",
  summary: "Added router tests.",
  skills_used: ["pr-change-analysis", "backend-unit-tests"],
  files: [{ path: "backend/tests/router.test.ts", action: "updated", covers: "DELETE /completed" }],
  skipped: [],
};

test("extractDecision reads the last fenced json block of the final message", () => {
  const text = [
    "Earlier draft:",
    "```json",
    JSON.stringify({ ...valid, decision: "abstained" }),
    "```",
    "Final report:",
    "```json",
    JSON.stringify(valid, null, 2),
    "```",
  ].join("\n");

  assert.deepEqual(extractDecision(text), valid);
});

test("extractDecision rejects unknown decisions and malformed shapes", () => {
  const wrap = (value) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

  assert.equal(extractDecision("no json here"), null);
  assert.equal(extractDecision("```json\n{not json}\n```"), null);
  assert.equal(extractDecision(wrap({ ...valid, decision: "merged_to_main" })), null);
  assert.equal(extractDecision(wrap({ ...valid, files: "everything" })), null);
  assert.equal(extractDecision(wrap({ ...valid, files: [{ path: 3 }] })), null);
});

test("extractDecision accepts the testability agent's decisions", () => {
  const wrap = (value) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
  assert.equal(extractDecision(wrap({ ...valid, decision: "refactored" }))?.decision, "refactored");
  assert.equal(extractDecision(wrap({ ...valid, decision: "no_refactor_needed" }))?.decision, "no_refactor_needed");
});

test("extractDecision fills optional arrays", () => {
  const text = "```json\n" + JSON.stringify({ decision: "no_tests_needed", summary: "Docs only." }) + "\n```";
  assert.deepEqual(extractDecision(text), {
    decision: "no_tests_needed",
    summary: "Docs only.",
    skills_used: [],
    files: [],
    skipped: [],
  });
});

test("finalAgentText returns the result text from a Claude Code execution log", () => {
  const log = [
    { type: "system", subtype: "init" },
    { type: "assistant", message: { content: [{ type: "text", text: "working" }] } },
    { type: "result", subtype: "success", result: "done ```json {} ```" },
  ];
  assert.equal(finalAgentText(log), "done ```json {} ```");
  assert.equal(finalAgentText([]), "");
  assert.equal(finalAgentText(null), "");
});
