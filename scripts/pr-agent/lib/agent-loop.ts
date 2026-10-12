import type { Chat, ChatMessage, ToolCall, ToolSpec } from "./openai-chat.ts";

type MaybePromise<T> = T | Promise<T>;

export interface AgentTools {
  listFiles(dir: string): MaybePromise<string[]>;
  readFile(file: string): MaybePromise<string>;
  search(pattern: string, dir?: string): MaybePromise<string>;
  writeFile(file: string, content: string): MaybePromise<void>;
  revertFile(file: string): MaybePromise<void>;
  run(action: string, area: string, files: string[]): MaybePromise<{ exitCode: number; output: string }>;
  loadSkill(name: string): MaybePromise<string>;
}

export interface AgentLoopResult {
  completed: boolean;
  log: Record<string, unknown>[];
}

const object = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required });
const text = { type: "string" };

function spec(name: string, description: string, parameters: Record<string, unknown>): ToolSpec {
  return { type: "function", function: { name, description, parameters } };
}

export const TOOL_SPECS: ToolSpec[] = [
  spec("list_files", "List files under a repository folder.", object({ path: text }, ["path"])),
  spec("read_file", "Read a repository file.", object({ path: text }, ["path"])),
  spec("search", "Search repository files for a regular expression.", object({ pattern: text, path: text }, ["pattern"])),
  spec("write_file", "Create or replace a unit test file.", object({ path: text, content: text }, ["path", "content"])),
  spec("revert_file", "Undo your changes to a file.", object({ path: text }, ["path"])),
  spec(
    "run",
    "Run tests, the type check or the formatter for test files in one area.",
    object(
      {
        action: { type: "string", enum: ["test", "typecheck", "format"] },
        area: { type: "string", enum: ["backend", "frontend"] },
        files: { type: "array", items: text },
      },
      ["action", "area"],
    ),
  ),
  spec("load_skill", "Load the instructions of a skill by name.", object({ name: text }, ["name"])),
];

function stringArg(args: Record<string, unknown>, name: string, optional = false): string {
  const value = args[name];
  if (value === undefined && optional) return "";
  if (typeof value !== "string") throw new Error(`argument "${name}" must be a string`);
  return value;
}

async function callTool(tools: AgentTools, toolCall: ToolCall): Promise<string> {
  const args: unknown = JSON.parse(toolCall.function.arguments || "{}");
  if (typeof args !== "object" || args === null || Array.isArray(args)) throw new Error("arguments must be a JSON object");
  const input = args as Record<string, unknown>;

  switch (toolCall.function.name) {
    case "list_files":
      return (await tools.listFiles(stringArg(input, "path"))).join("\n");
    case "read_file":
      return tools.readFile(stringArg(input, "path"));
    case "search":
      return tools.search(stringArg(input, "pattern"), stringArg(input, "path", true) || undefined);
    case "write_file":
      await tools.writeFile(stringArg(input, "path"), stringArg(input, "content"));
      return "written";
    case "revert_file":
      await tools.revertFile(stringArg(input, "path"));
      return "reverted";
    case "run": {
      const files = input.files ?? [];
      if (!Array.isArray(files) || !files.every((file) => typeof file === "string")) {
        throw new Error('argument "files" must be a list of strings');
      }
      const { exitCode, output } = await tools.run(stringArg(input, "action"), stringArg(input, "area"), files);
      return `exit code ${exitCode}\n${output}`;
    }
    case "load_skill":
      return tools.loadSkill(stringArg(input, "name"));
    default:
      throw new Error(`unknown tool ${toolCall.function.name}`);
  }
}

export async function runAgentLoop({
  chat,
  tools,
  systemPrompt,
  task,
  maxTurns,
}: {
  chat: Chat;
  tools: AgentTools;
  systemPrompt: string;
  task: string;
  maxTurns: number;
}): Promise<AgentLoopResult> {
  const started = Date.now();
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task },
  ];
  const log: Record<string, unknown>[] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  let finalText = "";
  let completed = false;

  for (let turn = 0; turn < maxTurns && !completed; turn += 1) {
    const response = await chat(messages, TOOL_SPECS);
    usage.input_tokens += response.usage.inputTokens;
    usage.output_tokens += response.usage.outputTokens;
    messages.push(response.message);
    log.push({ type: "assistant", message: response.message });

    const toolCalls = response.message.tool_calls ?? [];
    if (!toolCalls.length) {
      finalText = response.message.content ?? "";
      completed = true;
      break;
    }

    for (const toolCall of toolCalls) {
      let content: string;
      try {
        content = await callTool(tools, toolCall);
      } catch (error) {
        content = `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
      const reply: ChatMessage = { role: "tool", tool_call_id: toolCall.id, content };
      messages.push(reply);
      log.push({ type: "user", message: reply });
    }
  }

  log.push({
    type: "result",
    subtype: completed ? "success" : "error_max_turns",
    result: finalText,
    num_turns: log.filter((entry) => entry.type === "assistant").length,
    duration_ms: Date.now() - started,
    usage,
  });
  return { completed, log };
}
