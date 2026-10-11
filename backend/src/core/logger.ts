import { z } from "zod";

export const logLevelSchema = z.enum([
  "error",
  "warn",
  "info",
  "debug",
  "silent",
]);

export type LogLevel = z.infer<typeof logLevelSchema>;

export interface Logger {
  error: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  debug: (message: string, context?: Record<string, unknown>) => void;
}

const logLevelPriority: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  silent: 99,
};

function normalizeMetadata(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeMetadata(entry));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        normalizeMetadata(entry),
      ]),
    );
  }

  return value;
}

function stringifyJsonLog(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): string {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    service: "taskly-app-node",
    env: process.env.NODE_ENV ?? "development",
    ddsource: "nodejs",
    ddtags: `service:taskly-app-node,env:${process.env.NODE_ENV ?? "development"}`,
    level,
    message,
  };

  if (context) {
    Object.assign(payload, normalizeMetadata(context));
  }

  return JSON.stringify(payload);
}

export function createLogger(level: LogLevel = "info"): Logger {
  const currentLevel = logLevelPriority[level] ?? logLevelPriority.info;

  const write = (
    method: "error" | "warn" | "info" | "debug",
    message: string,
    context?: Record<string, unknown>,
  ) => {
    if (currentLevel >= logLevelPriority.silent) {
      return;
    }

    const priority = logLevelPriority[method];
    if (priority <= currentLevel) {
      const line = stringifyJsonLog(method, message, context);
      console[method](line);
    }
  };

  return {
    error: (message, context) => write("error", message, context),
    warn: (message, context) => write("warn", message, context),
    info: (message, context) => write("info", message, context),
    debug: (message, context) => write("debug", message, context),
  };
}
