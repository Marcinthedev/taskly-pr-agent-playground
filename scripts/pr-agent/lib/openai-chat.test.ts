import assert from "node:assert/strict";
import test from "node:test";

import { openAiCompatibleChat } from "./openai-chat.ts";

const tools = [
  {
    type: "function" as const,
    function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: {} } },
  },
];

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit }[] = []) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
}

test("sends an OpenAI-style chat completion request with tools and returns the message and usage", async () => {
  const seen: { url?: string; init?: RequestInit }[] = [];
  const chat = openAiCompatibleChat({
    baseUrl: "https://api.openai.com/v1/",
    apiKey: "sk-test",
    model: "gpt-test",
    fetchImpl: fakeFetch(
      200,
      {
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: "{}" } }] } }],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      },
      seen,
    ),
  });

  const response = await chat([{ role: "user", content: "hi" }], tools);

  assert.equal(seen[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal((seen[0].init?.headers as Record<string, string>).Authorization, "Bearer sk-test");
  const body = JSON.parse(String(seen[0].init?.body));
  assert.equal(body.model, "gpt-test");
  assert.deepEqual(body.tools, tools);
  assert.equal(response.message.tool_calls?.[0].function.name, "read_file");
  assert.deepEqual(response.usage, { inputTokens: 120, outputTokens: 30 });
});

test("reports the provider's error message without echoing the key", async () => {
  const chat = openAiCompatibleChat({
    baseUrl: "https://example.test/v1",
    apiKey: "sk-secret",
    model: "m",
    fetchImpl: fakeFetch(401, { error: { message: "bad key sk-secret" } }),
  });

  await assert.rejects(chat([{ role: "user", content: "hi" }], tools), (error: Error) => {
    assert.equal(error.message, "Model provider returned HTTP 401: bad key [redacted]");
    return true;
  });
});

test("reads Gemini-style error lists and caps plain-text errors", async () => {
  const gemini = openAiCompatibleChat({
    baseUrl: "https://example.test/v1",
    apiKey: "k",
    model: "m",
    fetchImpl: fakeFetch(400, [{ error: { code: 400, message: "Invalid JSON payload", status: "INVALID_ARGUMENT" } }]),
  });
  await assert.rejects(gemini([{ role: "user", content: "hi" }], tools), /^Error: Model provider returned HTTP 400: Invalid JSON payload$/);

  const plain = openAiCompatibleChat({
    baseUrl: "https://example.test/v1",
    apiKey: "k",
    model: "m",
    fetchImpl: fakeFetch(502, "x".repeat(2_000)),
    retries: 0,
  });
  await assert.rejects(plain([{ role: "user", content: "hi" }], tools), (error: Error) => error.message.length < 600);
});

test("rejects plain-http endpoints except on localhost", () => {
  assert.throws(() => openAiCompatibleChat({ baseUrl: "http://evil.test/v1", apiKey: "k", model: "m" }), /HTTPS/);
  assert.doesNotThrow(() => openAiCompatibleChat({ baseUrl: "http://localhost:11434/v1", apiKey: "k", model: "m" }));
});

test("rejects responses without a message", async () => {
  const chat = openAiCompatibleChat({
    baseUrl: "https://example.test/v1",
    apiKey: "k",
    model: "m",
    fetchImpl: fakeFetch(200, { choices: [] }),
  });

  await assert.rejects(chat([{ role: "user", content: "hi" }], tools), /no message/);
});

function sequencedFetch(responses: (() => Response)[], calls: { count: number }) {
  return async () => {
    const next = responses[Math.min(calls.count, responses.length - 1)];
    calls.count += 1;
    return next();
  };
}

const ok = () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "done" } }] }), { status: 200 });
const busy = (headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify({ error: { message: "high demand" } }), { status: 503, headers });

function retryingChat(responses: (() => Response)[], calls: { count: number }, delays: number[]) {
  return openAiCompatibleChat({
    baseUrl: "https://example.test/v1",
    apiKey: "k",
    model: "m",
    fetchImpl: sequencedFetch(responses, calls),
    retries: 3,
    baseDelayMs: 1_000,
    sleep: async (ms) => void delays.push(ms),
    log: () => {},
  });
}

test("retries overloads and rate limits with growing delays, honouring Retry-After", async () => {
  const calls = { count: 0 };
  const delays: number[] = [];
  const chat = retryingChat([busy(), busy({ "retry-after": "7" }), busy(), ok], calls, delays);

  const response = await chat([{ role: "user", content: "hi" }], tools);

  assert.equal(response.message.content, "done");
  assert.equal(calls.count, 4);
  assert.deepEqual(delays, [1_000, 7_000, 4_000]);
});

test("does not retry errors that a retry cannot fix", async () => {
  const calls = { count: 0 };
  const chat = retryingChat([() => new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404 })], calls, []);

  await assert.rejects(chat([{ role: "user", content: "hi" }], tools), /HTTP 404: model not found/);
  assert.equal(calls.count, 1);
});

test("gives up after the last retry and reports the provider's message", async () => {
  const calls = { count: 0 };
  const chat = retryingChat([busy()], calls, []);

  await assert.rejects(chat([{ role: "user", content: "hi" }], tools), /HTTP 503: high demand/);
  assert.equal(calls.count, 4);
});

test("retries network failures", async () => {
  const calls = { count: 0 };
  const delays: number[] = [];
  const chat = retryingChat(
    [
      () => {
        throw new TypeError("fetch failed");
      },
      ok,
    ],
    calls,
    delays,
  );

  assert.equal((await chat([{ role: "user", content: "hi" }], tools)).message.content, "done");
  assert.deepEqual(delays, [1_000]);
});