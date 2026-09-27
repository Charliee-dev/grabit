import "dotenv/config";
import http from "node:http";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { HOST, PORT, YTDLP_PATH } from "./config.js";
import { createApp } from "./app.js";

// Startup verification: fail fast if yt-dlp is missing or broken.
console.log("=================================");
console.log("yt-dlp startup check");
console.log("Path:", YTDLP_PATH);
console.log("Exists:", fs.existsSync(YTDLP_PATH));

if (!fs.existsSync(YTDLP_PATH)) {
  console.error("FATAL: yt-dlp binary not found at", YTDLP_PATH);
  process.exit(1);
}

try {
  fs.accessSync(YTDLP_PATH, fs.constants.X_OK);
} catch {
  console.error("FATAL: yt-dlp is not executable");
  process.exit(1);
}

const ytdlpCheck = spawnSync(YTDLP_PATH, ["--version"], { encoding: "utf8" });

if (ytdlpCheck.error) {
  console.error("FATAL: Could not execute yt-dlp:", ytdlpCheck.error.message);
  process.exit(1);
}

if (ytdlpCheck.status !== 0) {
  console.error("FATAL: yt-dlp returned exit code", ytdlpCheck.status);
  console.error(ytdlpCheck.stderr);
  process.exit(1);
}

console.log("yt-dlp version:", ytdlpCheck.stdout.trim());
console.log("yt-dlp is ready");
console.log("=================================");

const app = createApp();

const server = http.createServer(app);
server.requestTimeout = 20_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT, HOST, () => {
  console.log(`GrabIt API listening on ${HOST}:${PORT}`);
});

function closeServer(signal) {
  console.log(`Received ${signal}; shutting down GrabIt API.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.once("SIGINT", () => closeServer("SIGINT"));
process.once("SIGTERM", () => closeServer("SIGTERM"));
