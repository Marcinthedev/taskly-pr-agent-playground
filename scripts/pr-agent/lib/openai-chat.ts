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
// Rate limits, overloads and gateway hiccups are usually gone within a minute.
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRY_DELAY_MS = 60_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryDelay(response: Response | undefined, attempt: number, baseDelayMs: number): number {
  const retryAfter = Number(response?.headers.get("retry-after"));
  const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * 2 ** attempt;
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

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
  retries = 5,
  baseDelayMs = 5_000,
  sleep = wait,
  log = console.warn,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: Fetch;
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}): Chat {
  const endpoint = new URL(`${baseUrl.replace(/\/+$/, "")}/chat/completions`);
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(isLocal && endpoint.protocol === "http:")) {
    throw new Error("The model endpoint must use HTTPS (plain HTTP is allowed only for localhost)");
  }

  async function send(body: string): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response | undefined;
      let problem: string;
      try {
        response = await fetchImpl(endpoint.toString(), {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt >= retries) return response;
        problem = `HTTP ${response.status}`;
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
        if (attempt >= retries) throw new Error(`Model provider unreachable: ${problem}`);
      }
      const delay = retryDelay(response, attempt, baseDelayMs);
      log(`Model provider unavailable (${problem}); retry ${attempt + 1} of ${retries} in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }
  }

  return async (messages, tools) => {
    const response = await send(JSON.stringify({ model, messages, tools, tool_choice: "auto" }));
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
