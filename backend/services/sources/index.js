import { AppError } from "../../utils/appError.js";
import { parseHttpUrl } from "../urlValidator.js";
import direct from "./direct.js";
import extractorAdapter, { extractorReady } from "./extractor.js";
import facebook from "./facebook.js";
import instagram from "./instagram.js";
import pinterest from "./pinterest.js";
import reddit from "./reddit.js";
import vimeo from "./vimeo.js";

// Order matters: extractor-backed platform hosts first, then direct media files,
// then honestly-unsupported platform stubs (login walls, gallery walls, verified
// extractor failures).
export const sourceAdapters = [extractorAdapter, direct, facebook, instagram, pinterest, vimeo, reddit];

// Platform hosts stay "detected" either way, but they only claim support while the
// extractor binary is actually configured. This keeps reporting honest in every
// deployment: without yt-dlp the API reports detected-but-unsupported, never a
// capability it cannot deliver.
export function resolveSource(input) {
  const url = input instanceof URL ? parseHttpUrl(input.href) : parseHttpUrl(input);
  const matched = sourceAdapters.find((candidate) => candidate.canHandle(url)) || null;
  const extractorMissing = Boolean(matched?.requiresExtractor) && !extractorReady();
  return {
    url,
    adapter: extractorMissing ? null : matched,
    detection: {
      id: matched?.detectId?.(url) || matched?.id || "unknown",
      detected: Boolean(matched),
      supported: Boolean(matched?.supported) && !extractorMissing,
    },
  };
}

export function detectSource(input) {
  const { detection } = resolveSource(input);
  return { source: detection.id, detected: detection.detected, supported: detection.supported };
}

function unsupportedError(detection) {
  const recognized = detection.detected;
  return new AppError(
    415,
    recognized ? "SOURCE_NOT_SUPPORTED" : "UNSUPPORTED_SOURCE",
    "This source isn't supported yet.",
    { source: detection.id, detected: detection.detected, supported: detection.supported },
  );
}

export async function analyzeMedia(input) {
  const { url, adapter, detection } = resolveSource(input);
  if (!adapter?.supported) throw unsupportedError(detection);
  return adapter.analyze(url);
}

export async function downloadMedia(input, optionId, response) {
  const { url, adapter, detection } = resolveSource(input);
  if (!adapter?.supported) throw unsupportedError(detection);
  return adapter.download(url, optionId, response);
}
