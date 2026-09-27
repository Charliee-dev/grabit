import { mkdtemp, rm, stat } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DOWNLOAD_TIMEOUT_MS, MAX_FILE_SIZE_BYTES } from "../config.js";
import { AppError } from "../utils/appError.js";
import { requestPublicUrl } from "../utils/safeHttpRequest.js";

export function safeFilename(title, format) {
  const safeExtension = /^[a-z0-9]{1,8}$/i.test(String(format)) ? String(format).toLowerCase() : "bin";
  let stem = String(title || "media")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "media";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `media-${stem}`;

  return `${stem}.${safeExtension}`;
}

function knownSize(response) {
  const length = response.headers["content-length"];
  if (!length || !/^\d+$/.test(length)) return null;
  return Number(length);
}

export function verifyDownloadResponse(response, analysis) {
  const statusCode = response.statusCode || 0;
  if (statusCode === 401 || statusCode === 403) {
    throw new AppError(403, "PRIVATE_OR_PROTECTED", "This media isn't publicly accessible.");
  }
  if (statusCode === 404 || statusCode === 410) {
    throw new AppError(404, "MEDIA_NOT_FOUND", "We couldn't find accessible media at that link.");
  }
  if (statusCode !== 200) {
    throw new AppError(502, "DOWNLOAD_FAILED", "The media server couldn't provide this file.");
  }

  const contentType = String(response.headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const contentEncoding = String(response.headers["content-encoding"] || "identity").toLowerCase();
  if (contentType !== analysis.contentType || !["", "identity"].includes(contentEncoding) || response.headers["content-range"]) {
    throw new AppError(415, "INVALID_CONTENT_TYPE", "The media file changed and couldn't be safely downloaded.");
  }

  const sizeBytes = knownSize(response);
  if (sizeBytes === 0) throw new AppError(404, "MEDIA_NOT_FOUND", "We couldn't find accessible media at that link.");
  if (sizeBytes !== null && sizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new AppError(413, "FILE_TOO_LARGE", "This file is too large to download.");
  }
}

export function createSizeLimiter(maximumBytes) {
  let receivedBytes = 0;

  return new Transform({
    transform(chunk, encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > maximumBytes) {
        callback(new AppError(413, "FILE_TOO_LARGE", "This file is larger than the current download limit."));
        return;
      }
      callback(null, chunk);
    },
  });
}

function mapTransferError(error) {
  if (error instanceof AppError) return error;
  if (error?.cause instanceof AppError) return error.cause;
  return new AppError(502, "DOWNLOAD_FAILED", "The media file couldn't be downloaded safely.");
}

export async function downloadDirectMedia(analysis, optionId, response) {
  const option = analysis.options.find((candidate) => candidate.id === optionId);
  if (!option) {
    throw new AppError(400, "INVALID_OPTION", "Choose an available media option.");
  }

  const abortController = new AbortController();
  const abortForClosedClient = () => abortController.abort();
  response.once("close", abortForClosedClient);

  let temporaryDirectory;
  try {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "grabit-"));
    const temporaryFile = path.join(temporaryDirectory, "media.tmp");
    const download = await requestPublicUrl(analysis.downloadUrl, {
      method: "GET",
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      signal: abortController.signal,
    });

    try {
      verifyDownloadResponse(download.response, analysis);
      await pipeline(
        download.response,
        createSizeLimiter(MAX_FILE_SIZE_BYTES),
        createWriteStream(temporaryFile, { flags: "wx", mode: 0o600 }),
      );
    } catch (error) {
      download.abort();
      throw mapTransferError(error);
    }

    const fileInfo = await stat(temporaryFile);
    if (fileInfo.size === 0) {
      throw new AppError(404, "MEDIA_NOT_FOUND", "We couldn't find accessible media at that link.");
    }
    if (analysis.sizeBytes !== null && analysis.sizeBytes !== undefined && fileInfo.size !== analysis.sizeBytes) {
      throw new AppError(502, "DOWNLOAD_FAILED", "The media file changed and couldn't be safely downloaded.");
    }

    const filename = safeFilename(analysis.title, option.format);
    response.status(200);
    response.set({
      "Content-Type": analysis.contentType,
      "Content-Length": String(fileInfo.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });

    await pipeline(createReadStream(temporaryFile), response);
  } finally {
    response.off("close", abortForClosedClient);
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
}
