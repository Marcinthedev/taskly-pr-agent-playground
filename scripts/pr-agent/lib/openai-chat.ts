export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatResponse {
  message: ChatMessage;
  usage: { inputTokens: number; outputTokens: number };
}

export type Chat = (messages: ChatMessage[], tools: ToolSpec[]) => Promise<ChatResponse>;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const MAX_ERROR_CHARS = 500;

function providerError(body: string): string {
  let message = body;
  try {
    const parsed: unknown = JSON.parse(body);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const error = (first as { error?: { message?: unknown } } | null)?.error;
    if (typeof error?.message === "string") message = error.message;
  } catch {
    // Not JSON: keep the raw text.
  }
  return message.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_CHARS);
}

export function openAiCompatibleChat({
  baseUrl,
  apiKey,
  model,
  fetchImpl = fetch,
  timeoutMs = 120_000,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: Fetch;
  timeoutMs?: number;
}): Chat {
  const endpoint = new URL(`${baseUrl.replace(/\/+$/, "")}/chat/completions`);
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(isLocal && endpoint.protocol === "http:")) {
    throw new Error("The model endpoint must use HTTPS (plain HTTP is allowed only for localhost)");
  }

  return async (messages, tools) => {
    const response = await fetchImpl(endpoint.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const detail = providerError(await response.text()).split(apiKey).join("[redacted]");
      throw new Error(`Model provider returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    const payload = (await response.json()) as {
      choices?: { message?: ChatMessage }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const message = payload.choices?.[0]?.message;
    if (!message) throw new Error("Model provider returned no message");
    return {
      message: { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls },
      usage: { inputTokens: payload.usage?.prompt_tokens ?? 0, outputTokens: payload.usage?.completion_tokens ?? 0 },
    };
  };
}
