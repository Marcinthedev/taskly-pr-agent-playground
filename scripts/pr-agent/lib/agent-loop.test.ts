import assert from "node:assert/strict";
import test from "node:test";

import { agentUsage, finalResultText } from "./agent-result.ts";
import { type AgentTools, runAgentLoop } from "./agent-loop.ts";
import type { Chat, ChatMessage, ToolCall } from "./openai-chat.ts";

function call(id: string, name: string, args: unknown): ToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function scriptedChat(replies: ChatMessage[], seen: ChatMessage[][] = []): Chat {
  let turn = 0;
  return async (messages) => {
    seen.push(structuredClone(messages));
    const message = replies[Math.min(turn, replies.length - 1)];
    turn += 1;
    return { message, usage: { inputTokens: 100, outputTokens: 10 } };
  };
}

function fakeTools(log: string[] = []): AgentTools {
  return {
    listFiles: (dir) => (log.push(`list ${dir}`), ["backend/tests/router.test.ts"]),
    readFile: (file) => (log.push(`read ${file}`), "export const x = 1;"),
    search: (pattern) => (log.push(`search ${pattern}`), "backend/src/x.ts:1: match"),
    writeFile: (file) => {
      log.push(`write ${file}`);
      if (file.startsWith("backend/src/")) throw new Error("only test files may be written");
    },
    revertFile: (file) => void log.push(`revert ${file}`),
    run: (action, area, files) => (log.push(`run ${action} ${area} ${files.join(" ")}`), { exitCode: 0, output: "1 passed" }),
    loadSkill: (name) => (log.push(`skill ${name}`), `# ${name}`),
  };
}

test("runs tool calls, feeds results back, and ends with the final report in the run log", async () => {
  const seen: ChatMessage[][] = [];
  const log: string[] = [];
  const result = await runAgentLoop({
    chat: scriptedChat(
      [
        { role: "assistant", content: null, tool_calls: [call("1", "load_skill", { name: "pr-change-analysis" }), call("2", "read_file", { path: "backend/src/x.ts" })] },
        { role: "assistant", content: null, tool_calls: [call("3", "write_file", { path: "backend/tests/x.test.ts", content: "test" })] },
        { role: "assistant", content: null, tool_calls: [call("4", "run", { action: "test", area: "backend", files: ["backend/tests/x.test.ts"] })] },
        { role: "assistant", content: "Done.\n```json\n{\"decision\":\"tests_added\",\"summary\":\"ok\"}\n```" },
      ],
      seen,
    ),
    tools: fakeTools(log),
    systemPrompt: "You are the test engineer.",
    task: "Write tests.",
    maxTurns: 10,
  });

  assert.equal(result.completed, true);
  assert.deepEqual(log, [
    "skill pr-change-analysis",
    "read backend/src/x.ts",
    "write backend/tests/x.test.ts",
    "run test backend backend/tests/x.test.ts",
  ]);
  assert.equal(seen[0][0].role, "system");
  assert.equal(seen[1].at(-1)?.role, "tool");
  assert.equal(seen[1].at(-1)?.tool_call_id, "2");
  assert.match(finalResultText(result.log), /"decision":"tests_added"/);
  assert.deepEqual(agentUsage(result.log), {
    costUsd: null,
    turns: 4,
    durationMs: agentUsage(result.log)?.durationMs ?? null,
    inputTokens: 400,
    outputTokens: 40,
    cacheWriteTokens: null,
    cacheReadTokens: null,
  });
});

test("returns tool errors to the model instead of crashing", async () => {
  const seen: ChatMessage[][] = [];
  await runAgentLoop({
    chat: scriptedChat(
      [
        { role: "assistant", content: null, tool_calls: [call("1", "write_file", { path: "backend/src/x.ts", content: "x" })] },
        { role: "assistant", content: null, tool_calls: [call("2", "delete_everything", {}), call("3", "read_file", "not json")] },
        { role: "assistant", content: "giving up" },
      ],
      seen,
    ),
    tools: fakeTools(),
    systemPrompt: "s",
    task: "t",
    maxTurns: 10,
  });

  assert.match(String(seen[1].at(-1)?.content), /Error: only test files may be written/);
  const secondTurnResults = seen[2].slice(-2).map((message) => String(message.content));
  assert.match(secondTurnResults[0], /Error: unknown tool delete_everything/);
  assert.match(secondTurnResults[1], /Error/);
});

test("stops at the turn limit without a report", async () => {
  const result = await runAgentLoop({
    chat: scriptedChat([{ role: "assistant", content: null, tool_calls: [call("1", "list_files", { path: "." })] }]),
    tools: fakeTools(),
    systemPrompt: "s",
    task: "t",
    maxTurns: 3,
  });

  assert.equal(result.completed, false);
  assert.equal(finalResultText(result.log), "");
  assert.equal(agentUsage(result.log)?.turns, 3);
});
