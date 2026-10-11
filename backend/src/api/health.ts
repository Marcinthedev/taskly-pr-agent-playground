import { Router, type Request, type Response } from "express";
import type { Database } from "../features/todos/types.js";
import type { Logger } from "../core/logger.js";

export function createHealthRouter(database: Database, logger: Logger) {
  const router = Router();

  router.get("/health/live", (req, res) => {
    res.json({ status: "ok" });
  });

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
