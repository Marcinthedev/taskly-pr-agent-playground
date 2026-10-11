import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/core/logger.ts";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits structured Datadog-style JSON logs with a timestamp and context", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const logger = createLogger("info");

    logger.info("task completed", { requestId: "abc-123", statusCode: 200 });

    expect(info).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(info.mock.calls[0][0] as string);
    expect(payload.level).toBe("info");
    expect(payload.message).toBe("task completed");
    expect(payload.service).toBe("taskly-app-node");
    expect(payload.ddsource).toBe("nodejs");
    expect(payload.timestamp).toMatch(/Z$/);
    expect(payload.requestId).toBe("abc-123");
    expect(payload.statusCode).toBe(200);
  });

  it("suppresses logs at the silent level", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const logger = createLogger("silent");

    logger.info("hidden");

    expect(info).not.toHaveBeenCalled();
  });
});
