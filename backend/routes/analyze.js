import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { analyzeMedia } from "../services/sources/index.js";
import { AppError } from "../utils/appError.js";

export function createAnalyzeRouter({ limit = 30 } = {}) {
  const router = Router();
  const analysisLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
      success: false,
      error: { code: "RATE_LIMITED", message: "Too many links were checked. Wait a little, then try again." },
    }),
  });

  router.post("/", analysisLimiter, async (req, res, next) => {
    try {
      const url = req.body?.url;
      if (typeof url !== "string") {
        throw new AppError(400, "INVALID_URL", "Enter a complete public media link.");
      }

      const analysis = await analyzeMedia(url);
      res.json({
        success: true,
        source: analysis.source,
        title: analysis.title,
        thumbnail: analysis.thumbnail,
        mediaType: analysis.mediaType,
        duration: analysis.duration,
        sizeBytes: analysis.sizeBytes,
        options: analysis.options,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
