import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { EXTRACT_TIMEOUT_MS, EXTRACT_DOWNLOAD_TIMEOUT_MS, MAX_CONCURRENT_EXTRACTIONS } from "../../config.js";
import { AppError } from "../../utils/appError.js";

const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const MAX_STDERR_BYTES = 32 * 1024;
const SOCKET_TIMEOUT_SECONDS = 15;
const MAX_BANDWIDTH = "25M";

let availabilityPromise = null;

export function isExtractorConfigured() {
  const configuredPath = process.env.YTDLP_PATH || "";
  if (!configuredPath) return false;
  return existsSync(configuredPath);
}

export function resetExtractorAvailabilityForTests() {
  availabilityPromise = null;
}

export function ffmpegAvailable() {
  return Boolean(resolveFfmpegPath());
}

export async function ensureExtractorAvailable() {
  if (!availabilityPromise) {
    availabilityPromise = (async () => {
      if (!isExtractorConfigured()) {
        throw extractorUnavailableError("extractor_not_configured");
      }
      try {
        await runExtractor(["--version"], { timeoutMs: 10_000 });
      } catch {
        throw extractorUnavailableError("extractor_unavailable");
      }
    })();
    availabilityPromise.catch(() => {});
  }
  return availabilityPromise;
}

function extractorUnavailableError(reason) {
  return new AppError(501, "SOURCE_NOT_SUPPORTED", "This source isn't supported yet.", {
    source: { detected: true, supported: false, reason },
  });
}

function mapExtractorError(stderr) {
  const text = String(stderr || "");
  if (/sign in to confirm|age.?restrict|members.?only|private video|login required|logged.?in|cookies|join this channel|account credentials/i.test(text)) {
    return new AppError(403, "PRIVATE_OR_PROTECTED", "This media isn't publicly accessible without signing in.");
  }
  if (/not found|http error 404|http error 410|has been removed|does not exist|unavailable|geo.?restrict|not available in your country|copyright/i.test(text)) {
    return new AppError(404, "MEDIA_NOT_FOUND", "We couldn't find accessible media at that link.");
  }
  if (/unsupported url/i.test(text)) {
    return new AppError(415, "SOURCE_NOT_SUPPORTED", "This source isn't supported yet.");
  }
  if (/maximum number of|http error 429|too many requests/i.test(text)) {
    return new AppError(429, "RATE_LIMITED", "The source is receiving too many requests. Wait a little, then try again.");
  }
  if (/timed out|timeout|connection reset/i.test(text)) {
    return new AppError(504, "TIMEOUT", "The request took too long. Please try again.");
  }
  return new AppError(502, "EXTRACTION_FAILED", "Media information for this link couldn't be read right now.");
}

function runExtractor(args, { timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    if (!isExtractorConfigured()) {
      reject(extractorUnavailableError("extractor_not_configured"));
      return;
    }

    const child = spawn(process.env.YTDLP_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdoutBytes = 0;
    const stdoutChunks = [];
    const stderrChunks = [];
    let stderrBytes = 0;
    let settled = false;
    let timeout;

    const settle = (settleFn, value) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      try {
        child.kill();
      } catch { /* The process already exited. */ }
      settleFn(value);
    };

    timeout = setTimeout(() => {
      settle(reject, new AppError(504, "TIMEOUT", "The request took too long. Please try again."));
    }, timeoutMs);
    timeout.unref?.();

    child.stdout.on("data", (chunk) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        settle(reject, new AppError(502, "EXTRACTION_FAILED", "Media information was too large to process."));
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk) => {
      if (settled) return;
      stderrBytes += chunk.length;
      stderrChunks.push(chunk);
      while (stderrBytes - stderrChunks[0].length > MAX_STDERR_BYTES) {
        stderrBytes -= stderrChunks[0].length;
        stderrChunks.shift();
      }
    });

    child.once("error", () => {
      settle(reject, new AppError(502, "EXTRACTION_FAILED", "The extraction engine couldn't be started."));
    });

    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (code !== 0) {
        reject(mapExtractorError(stderr));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function withConcurrencyLimit(task) {
  const queue = (globalThis.__grabitExtractionQueue ||= { active: 0, waiters: [] });
  return new Promise((resolve, reject) => {
    const start = () => {
      queue.active += 1;
      task().then(resolve, reject).finally(() => {
        queue.active -= 1;
        queue.waiters.shift()?.();
      });
    };
    if (queue.active < MAX_CONCURRENT_EXTRACTIONS) start();
    else queue.waiters.push(start);
  });
}

// FFMPEG_PATH wins; otherwise resolve the optional ffmpeg-static package (used on
// hosting platforms without a system ffmpeg). Returns "" when absent: yt-dlp then
// only offers single-file formats, and the API reports honestly.
let cachedFfmpegPath;
function resolveFfmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath;
  cachedFfmpegPath = "";
  try {
    const ffmpegStaticPath = createRequire(import.meta.url)("ffmpeg-static");
    if (typeof ffmpegStaticPath === "string" && ffmpegStaticPath && existsSync(ffmpegStaticPath)) {
      cachedFfmpegPath = ffmpegStaticPath;
    }
  } catch {
    // ffmpeg-static is not installed; single-file-only mode remains available.
  }
  return cachedFfmpegPath;
}

function commonArgs(temporaryDirectory) {
  const ffmpegPath = resolveFfmpegPath();
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--quiet",
    "--no-progress",
    "--no-cache-dir",
    "--force-ipv4",
    "--socket-timeout", String(SOCKET_TIMEOUT_SECONDS),
    "--retries", "2",
    "--extractor-retries", "1",
    "--limit-rate", MAX_BANDWIDTH,
    "--paths", temporaryDirectory,
  ];
  if (ffmpegPath) args.push("--ffmpeg-location", ffmpegPath);
  return args;
}

export async function extractMediaInfo(url, { timeoutMs = EXTRACT_TIMEOUT_MS } = {}) {
  await ensureExtractorAvailable();
  return withConcurrencyLimit(async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "grabit-x-"));
    try {
      const args = [
        ...commonArgs(temporaryDirectory),
        "--dump-single-json",
        "--",
        url,
      ];
      const { stdout } = await runExtractor(args, { timeoutMs });
      return JSON.parse(stdout.toString("utf8"));
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    }
  });
}

export async function downloadExtractedMedia(url, formatSelector, { timeoutMs = EXTRACT_DOWNLOAD_TIMEOUT_MS } = {}) {
  if (!isExtractorConfigured()) {
    throw extractorUnavailableError("extractor_not_configured");
  }

  return withConcurrencyLimit(async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "grabit-d-"));
    try {
      const args = [
        ...commonArgs(temporaryDirectory),
        "--no-part",
        "--max-filesize", String(maxDownloadBytes()),
        "-f", formatSelector,
        "-o", path.join(temporaryDirectory, "media.%(ext)s"),
        "--",
        url,
      ];
      // Merged streams ("video+audio") must land in the advertised container;
      // otherwise vp9+m4a falls back to Matroska while the option says MP4.
      if (formatSelector.includes("+")) {
        args.splice(args.indexOf("--"), 0, "--merge-output-format", "mp4");
      }
      const { stderr } = await runExtractor(args, { timeoutMs });
      if (/file is larger than|max-filesize/i.test(stderr)) {
        throw new AppError(413, "FILE_TOO_LARGE", "This file is too large to download.");
      }
      return temporaryDirectory;
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  });
}

function maxDownloadBytes(env = process.env) {
  const raw = Number(env.MAX_FILE_SIZE_MB || 250);
  const megabytes = Number.isInteger(raw) && raw > 0 && raw <= 500 ? raw : 250;
  return megabytes * 1024 * 1024;
}

// Test hooks: the runner itself stays private and spawn-only.
export function buildExtractArgsForTests(url, temporaryDirectory) {
  return [
    ...commonArgs(temporaryDirectory),
    "--dump-single-json",
    "--",
    url,
  ];
}

export function mapExtractorErrorForTests(stderr) {
  return mapExtractorError(stderr);
}

export function maxDownloadBytesForTests(env) {
  return maxDownloadBytes(env);
}
