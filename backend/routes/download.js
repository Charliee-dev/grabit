import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { downloadMedia } from "../services/sources/index.js";
import { AppError } from "../utils/appError.js";

export function createDownloadRouter({ limit = 8 } = {}) {
  const router = Router();
  const downloadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
      success: false,
      error: { code: "RATE_LIMITED", message: "Too many downloads were requested. Wait a little, then try again." },
    }),
  });

  router.post("/", downloadLimiter, async (req, res, next) => {
    try {
      const { url, optionId } = req.body || {};
      if (typeof url !== "string") {
        throw new AppError(400, "INVALID_URL", "Enter a complete public media link.");
      }
      if (typeof optionId !== "string" || optionId.length > 80) {
        throw new AppError(400, "INVALID_OPTION", "Choose an available media option.");
      }

      await downloadMedia(url, optionId, res);
    } catch (error) {
      if (res.headersSent || res.destroyed) {
        if (!res.destroyed) res.destroy();
        return;
      }
      next(error);
    }
  });

  return router;
}
