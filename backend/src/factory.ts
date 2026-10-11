import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { rateLimit as rateLimiter } from "express-rate-limit";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import swaggerUi from "swagger-ui-express";
import { createHealthRouter } from "./api/health.js";
import { createLogger, type Logger } from "./core/logger.js";
import { TodoRepository } from "./features/todos/repository.js";
import { createTodosRouter } from "./features/todos/router.js";
import type { Database } from "./features/todos/types.js";

export interface AppOptions {
  /** Origins allowed to call the API cross-origin; empty means same-origin only. */
  corsOrigins?: string[];
  /** Per-client limit for the task API. */
  rateLimit?: { windowMs: number; limit: number };
}

export function createApp(
  database: Database,
  logger: Logger = createLogger(),
  { corsOrigins = [], rateLimit = { windowMs: 60_000, limit: 300 } }: AppOptions = {},
) {
  const app = express();

  app.disable("x-powered-by");
  // TLS terminates at the ingress, which owns HTTPS upgrades; upgrading here
  // would break the Swagger UI on plain-http local runs.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  if (corsOrigins.length) {
    app.use(cors({ origin: corsOrigins, methods: ["GET", "POST", "PATCH", "DELETE"] }));
  }
  app.enable("case sensitive routing");
  app.enable("strict routing");
  // Exactly one reverse proxy (nginx in compose) sits in front of the API.
  // Trusting every hop would let clients spoof their IP via X-Forwarded-For.
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    const requestId = randomUUID();
    const start = Date.now();

    res.locals.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    logger.info("Incoming request", {
      requestId,
      method: req.method,
      url: req.originalUrl,
    });

    res.on("finish", () => {
      logger.info("Request completed", {
        requestId,
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
      });
    });

    next();
  });

  app.use(express.json({ limit: "1mb" }));
  app.use("/api", createHealthRouter(database, logger));
  app.use(
    "/api/todos",
    rateLimiter({
      ...rateLimit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (req, res) => {
        logger.warn("Rate limit exceeded", { requestId: res.locals.requestId, method: req.method, url: req.originalUrl });
        res.status(429).json({ detail: "Too many requests. Please try again later." });
      },
    }),
    createTodosRouter(new TodoRepository(database)),
  );

  const specification = JSON.parse(
    readFileSync(new URL("../openapi.json", import.meta.url), "utf8"),
  );
  app.get("/openapi.json", (req, res) => res.json(specification));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(specification));
  app.use((req, res) => res.status(404).json({ detail: "Not Found" }));

  const handleError: ErrorRequestHandler = (error: unknown, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    const errorType =
      typeof error === "object" && error !== null && "type" in error
        ? String(error.type)
        : undefined;

    if (errorType === "entity.parse.failed") {
      logger.warn("Malformed JSON payload rejected", {
        method: req.method,
        url: req.originalUrl,
      });
      return res.status(422).json({ detail: "Invalid JSON." });
    }

    if (errorType === "entity.too.large") {
      logger.warn("Payload exceeded size limit", {
        method: req.method,
        url: req.originalUrl,
      });
      return res.status(413).json({ detail: "Request body too large." });
    }

    logger.error("Unhandled server error", {
      requestId: res.locals.requestId,
      method: req.method,
      url: req.originalUrl,
      error,
    });

    res.status(500).json({ detail: "Internal Server Error" });
  };

  app.use(handleError);
  return app;
}
