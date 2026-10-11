import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/factory.ts";
import { createLogger, type Logger } from "../src/core/logger.ts";
import { record, todo } from "./fixture.ts";

function fakeLogger() {
  return {
    error: vi.fn<Logger["error"]>(),
    warn: vi.fn<Logger["warn"]>(),
    info: vi.fn<Logger["info"]>(),
    debug: vi.fn<Logger["debug"]>(),
  };
}

describe("application runtime", () => {
  it("returns the api health payload when the database is reachable", async () => {
    const database = { todo: { findFirst: vi.fn().mockResolvedValue({ id: 1 }) } } as any;

    const app = createApp(database, createLogger("silent"));
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("serves tasks through the repository wired to the database", async () => {
    const database = { todo: { findMany: vi.fn().mockResolvedValue([record]) } } as any;

    const response = await request(createApp(database, createLogger("silent"))).get("/api/todos");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([todo]);
  });

  it("rejects invalid todo payloads with a structured validation error", async () => {
    const database = { todo: { create: vi.fn() } } as any;

    const app = createApp(database, createLogger("silent"));
    const response = await request(app).post("/api/todos").send({ title: "", completed: "yes" });

    expect(response.status).toBe(422);
    expect(Array.isArray(response.body.detail)).toBe(true);
    expect(database.todo.create).not.toHaveBeenCalled();
  });

  it("returns a 404 for unknown routes", async () => {
    const app = createApp({ todo: {} } as any, createLogger("silent"));
    const response = await request(app).get("/api/not-found");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: "Not Found" });
  });

  it("serves the OpenAPI specification", async () => {
    const response = await request(createApp({ todo: {} } as any, createLogger("silent"))).get("/openapi.json");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("openapi");
    expect(response.body).toHaveProperty("paths");
  });
});

describe("HTTP hardening", () => {
  const database = { todo: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) } } as any;

  it("sends security headers on API responses", async () => {
    const response = await request(createApp(database, createLogger("silent"))).get("/api/todos");

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    // TLS terminates at the proxy; upgrading here breaks plain-http local docs.
    expect(response.headers["content-security-policy"]).not.toContain("upgrade-insecure-requests");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("allows cross-origin requests only from configured origins", async () => {
    const app = createApp(database, createLogger("silent"), { corsOrigins: ["https://app.example.com"] });

    const allowed = await request(app).get("/api/todos").set("Origin", "https://app.example.com");
    const denied = await request(app).get("/api/todos").set("Origin", "https://evil.example");

    expect(allowed.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers CORS preflight for allowed origins", async () => {
    const app = createApp(database, createLogger("silent"), { corsOrigins: ["https://app.example.com"] });

    const response = await request(app)
      .options("/api/todos/1")
      .set("Origin", "https://app.example.com")
      .set("Access-Control-Request-Method", "PATCH");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
  });

  it("sends no CORS headers by default (same-origin deployment behind nginx)", async () => {
    const response = await request(createApp(database, createLogger("silent")))
      .get("/api/todos")
      .set("Origin", "https://app.example.com");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rate-limits the task API per client and answers 429 in the API error shape", async () => {
    const app = createApp(database, createLogger("silent"), { rateLimit: { windowMs: 60_000, limit: 2 } });

    expect((await request(app).get("/api/todos")).status).toBe(200);
    expect((await request(app).get("/api/todos")).status).toBe(200);
    const limited = await request(app).get("/api/todos");

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ detail: "Too many requests. Please try again later." });
    expect(limited.headers["ratelimit-limit"] ?? limited.headers["ratelimit"]).toBeDefined();
  });

  it("never rate-limits health probes", async () => {
    const app = createApp(database, createLogger("silent"), { rateLimit: { windowMs: 60_000, limit: 1 } });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await request(app).get("/api/health/live")).status).toBe(200);
    }
  });
});

describe("request handling", () => {
  it("tags every response with a generated request id and logs its completion", async () => {
    const logger = fakeLogger();
    const app = createApp({ todo: { findFirst: vi.fn().mockResolvedValue(null) } } as any, logger);

    const response = await request(app).get("/api/health");

    const requestId = response.headers["x-request-id"];
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(logger.info).toHaveBeenCalledWith(
      "Request completed",
      expect.objectContaining({ requestId, method: "GET", url: "/api/health", statusCode: 200 }),
    );
  });

  it("answers malformed JSON with 422", async () => {
    const logger = fakeLogger();
    const response = await request(createApp({ todo: {} } as any, logger))
      .post("/api/todos")
      .set("Content-Type", "application/json")
      .send('{"title":');

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ detail: "Invalid JSON." });
    expect(logger.warn).toHaveBeenCalledWith("Malformed JSON payload rejected", expect.any(Object));
  });

  it("answers bodies over 1 MB with 413", async () => {
    const response = await request(createApp({ todo: {} } as any, fakeLogger()))
      .post("/api/todos")
      .send({ title: "x".repeat(1024 * 1024 + 1) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ detail: "Request body too large." });
  });

  it("hides unexpected errors and logs them under the response's request id", async () => {
    const logger = fakeLogger();
    const failure = new Error("connection reset");
    const database = { todo: { findMany: vi.fn().mockRejectedValue(failure) } } as any;

    const response = await request(createApp(database, logger))
      .get("/api/todos")
      .set("x-request-id", "client-chosen-id");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ detail: "Internal Server Error" });
    expect(logger.error).toHaveBeenCalledWith(
      "Unhandled server error",
      expect.objectContaining({ requestId: response.headers["x-request-id"], error: failure }),
    );
    expect(response.headers["x-request-id"]).not.toBe("client-chosen-id");
  });
});
