import { Router, type Request, type Response } from "express";
import type { Database } from "../features/todos/types.js";
import type { Logger } from "../core/logger.js";

export function createHealthRouter(database: Database, logger: Logger) {
  const router = Router();

  // Liveness: the process is up and serving. Never touches dependencies, so a
  // database outage does not make the orchestrator restart healthy pods.
  router.get("/health/live", (req, res) => {
    res.json({ status: "ok" });
  });

  // Readiness: the API can serve requests, i.e. the database answers.
  // `/health` stays as an alias for existing probes (compose healthcheck).
  const ready = async (req: Request, res: Response) => {
    try {
      await database.todo.findFirst({ select: { id: true } });
      res.json({ status: "ok" });
    } catch (error) {
      logger.error("Health check failed", { route: req.originalUrl, error });
      res.status(503).json({ status: "unavailable" });
    }
  };
  router.get("/health/ready", ready);
  router.get("/health", ready);

  return router;
}
