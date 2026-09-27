import { AppError } from "../../utils/appError.js";
import { parseHttpUrl } from "../urlValidator.js";
import direct from "./direct.js";
import facebook from "./facebook.js";
import instagram from "./instagram.js";
import pinterest from "./pinterest.js";
import tiktok from "./tiktok.js";
import x from "./x.js";
import youtube from "./youtube.js";

export const sourceAdapters = [youtube, instagram, pinterest, tiktok, facebook, x, direct];

export function resolveSource(input) {
  const url = input instanceof URL ? parseHttpUrl(input.href) : parseHttpUrl(input);
  const adapter = sourceAdapters.find((candidate) => candidate.canHandle(url)) || null;
  return {
    url,
    adapter,
    detection: {
      id: adapter?.id || "unknown",
      detected: Boolean(adapter),
      supported: Boolean(adapter?.supported),
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
