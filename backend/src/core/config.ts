import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
dotenv.config({ path: envPath, quiet: true });

const appConfigSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  LOG_LEVEL: z
    .enum(["error", "warn", "info", "debug", "silent"])
    .default("info"),
  // Comma-separated browser origins allowed to call the API cross-origin.
  // Empty (the default) means same-origin only, as when nginx serves both.
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .refine((origins) => origins.every(isBareOrigin), {
      message: "must be comma-separated http(s) origins without paths",
    }),
  // Task API requests allowed per client IP per minute.
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
});

function isBareOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
  } catch {
    return false;
  }
}

export type AppConfig = z.infer<typeof appConfigSchema> & {
  nodeEnv: "development" | "test" | "production";
  apiPort: number;
  logLevel: "error" | "warn" | "info" | "debug" | "silent";
  corsOrigins: string[];
  rateLimitMax: number;
};

export function validateAppConfig(
  raw: Record<string, string | undefined>,
): AppConfig {
  const normalized = {
    NODE_ENV: raw.NODE_ENV ?? "development",
    API_PORT: raw.API_PORT ?? "8000",
    LOG_LEVEL: raw.LOG_LEVEL ?? "info",
    CORS_ORIGINS: raw.CORS_ORIGINS ?? "",
    RATE_LIMIT_MAX: raw.RATE_LIMIT_MAX ?? "300",
  };

  const parsed = appConfigSchema.safeParse(normalized);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => issue.path.join(".") || issue.message)
      .join("; ");
    throw new Error(`Invalid application configuration: ${details}`);
  }

  return {
    ...parsed.data,
    nodeEnv: parsed.data.NODE_ENV,
    apiPort: parsed.data.API_PORT,
    logLevel: parsed.data.LOG_LEVEL,
    corsOrigins: parsed.data.CORS_ORIGINS,
    rateLimitMax: parsed.data.RATE_LIMIT_MAX,
  };
}

export function resolveDatabaseUrl(override?: string): string {
  const explicit = override ?? process.env.DATABASE_URL;
  if (explicit) {
    return explicit.replace(/^postgresql\+psycopg:/, "postgresql:");
  }

  const required = [
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_HOST",
    "DB_PORT",
    "POSTGRES_DB",
  ] as const;
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing environment variable: ${missing[0]}`);
  }

  const port = Number(process.env.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid database port: ${process.env.DB_PORT}`);
  }

  const url = new URL("postgresql://localhost");
  url.username = process.env.POSTGRES_USER!;
  url.password = process.env.POSTGRES_PASSWORD!;
  url.hostname = process.env.POSTGRES_HOST!;
  url.port = String(port);
  url.pathname = `/${encodeURIComponent(process.env.POSTGRES_DB!)}`;
  return url.toString();
}
