import "dotenv/config";
import http from "node:http";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { HOST, PORT, YTDLP_PATH, FFMPEG_PATH } from "./config.js";
import { createApp } from "./app.js";

function checkExecutable(name, executable, args = ["--version"]) {
  console.log(`[startup] Checking ${name}`);
  console.log(`[startup] Executable: ${executable}`);

  if (executable.startsWith("/")) {
    if (!fs.existsSync(executable)) {
      throw new Error(`${name} does not exist: ${executable}`);
    }
    try {
      fs.accessSync(executable, fs.constants.X_OK);
    } catch {
      throw new Error(`${name} is not executable: ${executable}`);
    }
  }

  const result = spawnSync(executable, args, { encoding: "utf8" });

  if (result.error) {
    throw new Error(`${name} could not be executed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${name} exited with code ${result.status}: ${result.stderr || ""}`);
  }

  console.log(`[startup] ${name}: ${result.stdout.trim()}`);
}

console.log("=================================");
console.log("Dependency check");

try {
  checkExecutable("yt-dlp", YTDLP_PATH);
  checkExecutable("ffmpeg", FFMPEG_PATH);
  console.log("[startup] All dependencies OK");
} catch (error) {
  console.error("=================================");
  console.error("FATAL DEPENDENCY ERROR");
  console.error(error.message);
  console.error("=================================");
  process.exit(1);
}

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
