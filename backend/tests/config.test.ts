import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveDatabaseUrl, validateAppConfig } from "../src/core/config.js";

describe("resolveDatabaseUrl", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_USER;
    delete process.env.POSTGRES_PASSWORD;
    delete process.env.POSTGRES_HOST;
    delete process.env.DB_PORT;
    delete process.env.POSTGRES_DB;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns the explicit override when provided", () => {
    expect(
      resolveDatabaseUrl("postgresql://app:secret@db.internal:5432/app-db"),
    ).toBe("postgresql://app:secret@db.internal:5432/app-db");
  });

  it("builds a local PostgreSQL URL from the required environment variables", () => {
    process.env.POSTGRES_USER = "taskly";
    process.env.POSTGRES_PASSWORD = "very-secret";
    process.env.POSTGRES_HOST = "localhost";
    process.env.DB_PORT = "5432";
    process.env.POSTGRES_DB = "taskly";

    expect(resolveDatabaseUrl()).toBe(
      "postgresql://taskly:very-secret@localhost:5432/taskly",
    );
  });

  it("throws when the required environment variables are missing", () => {
    expect(() => resolveDatabaseUrl()).toThrow(
      "Missing environment variable: POSTGRES_USER",
    );
  });

  it("validates production-safe runtime configuration", () => {
    const config = validateAppConfig({
      NODE_ENV: "production",
      API_PORT: "9000",
      LOG_LEVEL: "warn",
    });

    expect(config.nodeEnv).toBe("production");
    expect(config.apiPort).toBe(9000);
    expect(config.logLevel).toBe("warn");
  });

  it("defaults to no CORS origins and 300 API requests per minute", () => {
    const config = validateAppConfig({});

    expect(config.corsOrigins).toEqual([]);
    expect(config.rateLimitMax).toBe(300);
  });

  it("parses a comma-separated CORS allowlist and a custom rate limit", () => {
    const config = validateAppConfig({
      CORS_ORIGINS: " https://app.example.com , https://admin.example.com ,",
      RATE_LIMIT_MAX: "50",
    });

    expect(config.corsOrigins).toEqual(["https://app.example.com", "https://admin.example.com"]);
    expect(config.rateLimitMax).toBe(50);
  });

  it("rejects CORS origins that are not bare http(s) origins", () => {
    expect(() => validateAppConfig({ CORS_ORIGINS: "*" })).toThrow("CORS_ORIGINS");
    expect(() => validateAppConfig({ CORS_ORIGINS: "https://app.example.com/path" })).toThrow("CORS_ORIGINS");
    expect(() => validateAppConfig({ RATE_LIMIT_MAX: "0" })).toThrow("RATE_LIMIT_MAX");
  });

  it("rejects invalid port and log levels", () => {
    expect(() =>
      validateAppConfig({
        NODE_ENV: "production",
        API_PORT: "0",
        LOG_LEVEL: "debug",
      }),
    ).toThrow();
    expect(() =>
      validateAppConfig({
        NODE_ENV: "production",
        API_PORT: "70000",
        LOG_LEVEL: "verbose",
      }),
    ).toThrow();
  });
});
