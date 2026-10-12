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

test("reports provider errors by status without echoing the key", async () => {
  const chat = openAiCompatibleChat({
    baseUrl: "https://example.test/v1",
    apiKey: "sk-secret",
    model: "m",
    fetchImpl: fakeFetch(401, { error: { message: "bad key sk-secret" } }),
  });

  await assert.rejects(chat([{ role: "user", content: "hi" }], tools), (error: Error) => {
    assert.match(error.message, /HTTP 401/);
    assert.doesNotMatch(error.message, /sk-secret/);
    return true;
  });
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
