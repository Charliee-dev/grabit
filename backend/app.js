import cors from "cors";
import express from "express";
import helmet from "helmet";
import { FRONTEND_ORIGINS } from "./config.js";
import { createAnalyzeRouter } from "./routes/analyze.js";
import { createDownloadRouter } from "./routes/download.js";
import { AppError, sendError } from "./utils/appError.js";

export function createApp({
  frontendOrigins = FRONTEND_ORIGINS,
  analyzeLimit = 30,
  downloadLimit = 8,
} = {}) {
  const app = express();
  const allowedOrigins = new Set(frontendOrigins);

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    exposedHeaders: ["Content-Disposition", "Content-Length"],
    maxAge: 600,
  }));
  app.use(express.json({ limit: "16kb", strict: true }));

  app.get("/api/health", (req, res) => {
    res.json({ success: true, service: "GrabIt API", status: "ok" });
  });

  app.use("/api/analyze", createAnalyzeRouter({ limit: analyzeLimit }));
  app.use("/api/download", createDownloadRouter({ limit: downloadLimit }));

  app.use((req, res) => {
    sendError(res, new AppError(404, "NOT_FOUND", "This API endpoint was not found."));
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error?.type === "entity.too.large") {
      sendError(res, new AppError(413, "REQUEST_TOO_LARGE", "This request is too large."));
      return;
    }
    if (error?.type === "entity.parse.failed") {
      sendError(res, new AppError(400, "INVALID_REQUEST", "Request data must be valid JSON."));
      return;
    }

    if (!(error instanceof AppError)) {
      console.error(`GrabIt API error: ${error?.name || "UnknownError"}`);
    }
    sendError(res, error);
  });

  return app;
}
