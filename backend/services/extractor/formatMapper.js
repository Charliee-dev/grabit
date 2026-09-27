import { AppError } from "../../utils/appError.js";

const EXT_CONTENT_TYPES = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
};

// Single-file container extensions that GrabIt can stream and name honestly.
const STREAMED_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov", "mkv", "m4a", "mp3", "opus", "ogg", "oga", "wav"]);

// Exact protocol allowlist: only plain HTTP downloads deliver one file per format.
// DASH segment lists and HLS playlists are not single files.
const DOWNLOADABLE_PROTOCOLS = new Set(["http", "https"]);

const MERGE_OUTPUT_FORMATS = new Set(["mp4", "webm"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov", "mkv"]);

// Segmented delivery (HLS/DASH) is only allowed in platform mode, where the media
// URLs originate from the platform's extracted metadata rather than user input.
// GrabIt's own fetcher never downloads segmented media for user-supplied URLs.
const SEGMENTED_PROTOCOL_PREFIXES = ["m3u8", "http_dash_segments"];

function hasRealCodec(codec) {
  return typeof codec === "string" && codec !== "none" && codec !== "unknown";
}

function isDownloadableProtocol(format, { allowSegmented = false } = {}) {
  const protocol = String(format.protocol || "").toLowerCase();
  if (DOWNLOADABLE_PROTOCOLS.has(protocol)) return true;
  if (!allowSegmented) return false;
  return SEGMENTED_PROTOCOL_PREFIXES.some((prefix) => protocol.startsWith(prefix));
}

function isStreamableExtension(format) {
  return STREAMED_EXTENSIONS.has(String(format.ext || "").toLowerCase());
}

function hasUsableFormatId(format) {
  return typeof format.format_id === "string" && format.format_id.length > 0;
}

function formatSizeBytes(format) {
  if (Number.isFinite(format.filesize) && format.filesize > 0) return format.filesize;
  if (Number.isFinite(format.filesize_approx) && format.filesize_approx > 0) return format.filesize_approx;
  return null;
}

function formatHeight(format) {
  return Number.isFinite(format.height) ? format.height : null;
}

// Audio-only single files (m4a, mp3, opus...): real, complete, downloadable files.
export function selectAudioOnlyFormats(formats, protocolOptions = {}) {
  const audio = (formats || []).filter((format) =>
    format && hasUsableFormatId(format) && isStreamableExtension(format) && isDownloadableProtocol(format, protocolOptions) &&
    hasRealCodec(format.acodec) &&
    (format.vcodec === "none" || format.vcodec === undefined),
  );

  // YouTube duplicates audio formats as "-drc" (dynamic range compression)
  // variants of the same stream at the same bitrate. Keep one per container+abr,
  // preferring the original over the -drc duplicate. These are yt-dlp's real
  // format_ids; the dedupe only avoids showing the same audio twice.
  const byKey = new Map();
  for (const format of audio) {
    const baseId = String(format.format_id).replace(/-drc$/, "");
    const key = `${String(format.ext).toLowerCase()}:${Number.isFinite(format.abr) ? format.abr : "unknown"}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, format);
      continue;
    }
    const existingIsDrc = /-drc$/.test(String(existing.format_id));
    const candidateIsDrc = /-drc$/.test(String(format.format_id));
    if (existingIsDrc && !candidateIsDrc) byKey.set(key, format);
  }
  return [...byKey.values()];
}

// Progressive video files: one HTTP file containing both video and audio.
export function selectProgressiveVideoFormats(formats, protocolOptions = {}) {
  return (formats || []).filter((format) =>
    format && hasUsableFormatId(format) && isStreamableExtension(format) && isDownloadableProtocol(format, protocolOptions) &&
    hasRealCodec(format.vcodec) && hasRealCodec(format.acodec),
  );
}

// Video-only streams: usable only by merging with ffmpeg at download time.
export function selectVideoOnlyFormats(formats, protocolOptions = {}) {
  return (formats || []).filter((format) =>
    format && hasUsableFormatId(format) && isStreamableExtension(format) && isDownloadableProtocol(format, protocolOptions) &&
    hasRealCodec(format.vcodec) &&
    (format.acodec === "none" || format.acodec === undefined),
  );
}

function compareFormats(left, right) {
  const leftHeight = formatHeight(left) ?? -1;
  const rightHeight = formatHeight(right) ?? -1;
  if (leftHeight !== rightHeight) return rightHeight - leftHeight;

  const leftFps = Number.isFinite(left.fps) ? left.fps : 0;
  const rightFps = Number.isFinite(right.fps) ? right.fps : 0;
  if (leftFps !== rightFps) return rightFps - leftFps;

  const leftAbr = Number.isFinite(left.abr) ? left.abr : -1;
  const rightAbr = Number.isFinite(right.abr) ? right.abr : -1;
  if (leftAbr !== rightAbr) return rightAbr - leftAbr;

  const leftSize = formatSizeBytes(left) ?? -1;
  const rightSize = formatSizeBytes(right) ?? -1;
  if (leftSize !== rightSize) return rightSize - leftSize;

  return left.format_id.localeCompare(right.format_id);
}

function safeOptionId(formatId) {
  return `f-${String(formatId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}`;
}

function optionFromSingleFormat(format) {
  const extension = String(format.ext).toLowerCase();
  const height = formatHeight(format);
  const sizeBytes = formatSizeBytes(format);

  return {
    id: safeOptionId(format.format_id),
    label: height ? `${height}p ${extension.toUpperCase()}` : extension.toUpperCase(),
    quality: height ? `${height}p` : "Original",
    format: extension,
    // Codec-based, not extension-based: an opus-in-webm file is audio even though
    // webm is commonly a video container.
    mediaType: String(format.vcodec) === "none" ? "audio" : "video",
    recommended: false,
    selector: String(format.format_id),
    ...(height ? { height } : {}),
    ...(Number.isFinite(format.fps) && format.fps > 0 ? { fps: Math.round(format.fps) } : {}),
    ...(sizeBytes !== null ? { sizeBytes } : {}),
  };
}

// Builds real muxed options from video-only formats: yt-dlp downloads the video
// stream plus the best audio stream and merges them with ffmpeg. Sizes are the sum
// of both real parts and only included when both are known. Selector strings are
// exactly what yt-dlp accepts after -f.
function optionsFromMuxedFormats(videoFormats, audioFormats, mergeFormat) {
  const bestAudio = [...audioFormats].sort(compareFormats)[0];
  if (!bestAudio) return [];

  const audioSize = formatSizeBytes(bestAudio);
  const seenHeights = new Set();

  return [...videoFormats].sort(compareFormats).flatMap((videoFormat) => {
    const height = formatHeight(videoFormat);
    const dedupeKey = height === null
      ? videoFormat.format_id
      : `${height}:${Number.isFinite(videoFormat.fps) ? Math.round(videoFormat.fps) : 0}`;
    if (seenHeights.has(dedupeKey)) return [];
    seenHeights.add(dedupeKey);

    const videoSize = formatSizeBytes(videoFormat);
    const heightLabel = height ? `${height}p` : videoFormat.format_id;
    const extension = mergeFormat || String(videoFormat.ext).toLowerCase();

    return [{
      id: safeOptionId(`mux-${videoFormat.format_id}`),
      label: `${heightLabel} ${extension.toUpperCase()}`,
      quality: height ? heightLabel : "Original",
      format: extension,
      mediaType: "video",
      recommended: false,
      selector: `${videoFormat.format_id}+${bestAudio.format_id}`,
      ...(height ? { height } : {}),
      ...(Number.isFinite(videoFormat.fps) && videoFormat.fps > 0 ? { fps: Math.round(videoFormat.fps) } : {}),
      ...(videoSize !== null && audioSize !== null ? { sizeBytes: videoSize + audioSize } : {}),
    }];
  });
}

function unsupportedNoFormats() {
  return new AppError(415, "SOURCE_NOT_SUPPORTED", "This source isn't supported yet.", {
    source: { detected: true, supported: false, reason: "no_downloadable_formats" },
  });
}

// Maps yt-dlp's real formats to GrabIt options, best first:
//   1. ffmpeg-merged video (when configured) built from real video-only streams
//   2. progressive single files with both video and audio
//   3. audio-only single files
// Without ffmpeg, DASH-only sources expose their audio-only files and stay honest
// about video: no video options are invented.
export function mapRealFormats(formats, { mergeFormat, allowSegmented = false } = {}) {
  const all = formats || [];
  const protocolOptions = { allowSegmented };
  const audioOnly = selectAudioOnlyFormats(all, protocolOptions).sort(compareFormats);
  const progressive = selectProgressiveVideoFormats(all, protocolOptions).sort(compareFormats);
  const options = [];

  if (mergeFormat && MERGE_OUTPUT_FORMATS.has(mergeFormat)) {
    const videoOnly = selectVideoOnlyFormats(all, protocolOptions).sort(compareFormats);
    options.push(...optionsFromMuxedFormats(videoOnly, audioOnly, mergeFormat));
  }
  options.push(...progressive.map(optionFromSingleFormat));
  options.push(...audioOnly.map(optionFromSingleFormat));

  if (options.length === 0) throw unsupportedNoFormats();
  options[0].recommended = true;
  return { options };
}

export function findOption(options, optionId) {
  const option = (options || []).find((candidate) => candidate.id === optionId);
  if (!option) {
    throw new AppError(400, "INVALID_OPTION", "Choose an available media option.");
  }
  return option;
}

export function contentTypeForFormat(extension) {
  const contentType = EXT_CONTENT_TYPES[String(extension || "").toLowerCase()];
  if (!contentType) {
    throw new AppError(415, "SOURCE_NOT_SUPPORTED", "This source isn't supported yet.");
  }
  return contentType;
}

export function sanitizeExtractorTitle(title, videoId) {
  const cleaned = String(title || "")
    .normalize("NFKD")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || `Media-${String(videoId || "file").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24)}`;
}
