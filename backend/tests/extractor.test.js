import test from "node:test";
import assert from "node:assert/strict";
import {
  selectAudioOnlyFormats,
  selectProgressiveVideoFormats,
  selectVideoOnlyFormats,
  mapRealFormats,
  findOption,
  contentTypeForFormat,
  sanitizeExtractorTitle,
} from "../services/extractor/formatMapper.js";
import { buildExtractArgsForTests, mapExtractorErrorForTests, maxDownloadBytesForTests } from "../services/extractor/ytDlpRunner.js";

const PROGRESSIVE = [
  { format_id: "18", ext: "mp4", protocol: "https", vcodec: "avc1.42001E", acodec: "mp4a.40.2", height: 360, filesize: 123456 },
  { format_id: "22", ext: "mp4", protocol: "https", vcodec: "avc1.64001F", acodec: "mp4a.40.2", height: 720, filesize: 7890123 },
];
const AUDIO_ONLY = [
  { format_id: "140", ext: "m4a", protocol: "https", vcodec: "none", acodec: "mp4a.40.2", abr: 129.54, filesize: 4000 },
  { format_id: "251", ext: "webm", protocol: "https", vcodec: "none", acodec: "opus", abr: 160, filesize: 3000 },
];
const VIDEO_ONLY = [
  { format_id: "137", ext: "mp4", protocol: "https", vcodec: "avc1.640028", acodec: "none", height: 1080, filesize: 10_000_000 },
  { format_id: "136", ext: "mp4", protocol: "https", vcodec: "avc1.4d401f", acodec: "none", height: 720, filesize: 5_000_000 },
];

test("selects only plain-HTTP downloadable formats", () => {
  const all = [...PROGRESSIVE, ...AUDIO_ONLY, ...VIDEO_ONLY];
  const all_ids = (list) => list.map((f) => f.format_id);

  assert.deepEqual(all_ids(selectProgressiveVideoFormats([
    ...all,
    { format_id: "93", ext: "mp4", protocol: "m3u8_native", vcodec: "avc1", acodec: "mp4a", height: 360 },
    { format_id: "hls-1", ext: "mp4", protocol: "m3u8", vcodec: "avc1", acodec: "mp4a" },
    { format_id: "dashsep", ext: "mp4", protocol: "http_dash_segments", vcodec: "avc1", acodec: "mp4a" },
    { format_id: "badext", ext: "flv", protocol: "http", vcodec: "flv", acodec: "mp3" },
    null,
  ])), ["18", "22"]);

  assert.deepEqual(all_ids(selectAudioOnlyFormats(all)), ["140", "251"]);
  assert.deepEqual(all_ids(selectVideoOnlyFormats(all)), ["137", "136"]);
});

test("without ffmpeg, DASH-only sources expose audio-only files honestly", () => {
  const dashOnly = [...VIDEO_ONLY, ...AUDIO_ONLY];
  const { options } = mapRealFormats(dashOnly);
  assert.equal(options.some((o) => o.mediaType === "video"), false);
  assert.deepEqual(options.map((o) => o.id), ["f-251", "f-140"]);
  assert.equal(options[0].recommended, true);
});

test("with ffmpeg, merged video options are built from real streams and sizes sum", () => {
  const dashOnly = [...VIDEO_ONLY, ...AUDIO_ONLY];
  const { options } = mapRealFormats(dashOnly, { mergeFormat: "mp4" });
  assert.equal(options[0].id, "f-mux-137");
  assert.equal(options[0].label, "1080p MP4");
  assert.equal(options[0].selector, "137+251");
  assert.equal(options[0].sizeBytes, 10_000_000 + 3_000);
  assert.equal(options[0].recommended, true);

  // Audio singles remain available alongside merged video.
  assert.ok(options.some((o) => o.id === "f-140"));
  // Progressive none exist; merged dedupes per height/fps.
  assert.deepEqual(options.filter((o) => o.mediaType === "video").map((o) => o.label), ["1080p MP4", "720p MP4"]);
});

test("progressive options sort by height and mark the top as recommended", () => {
  const { options } = mapRealFormats(PROGRESSIVE);
  assert.deepEqual(options.map((o) => o.id), ["f-22", "f-18"]);
  assert.equal(options[0].recommended, true);
  assert.equal(options[1].recommended, false);
  assert.equal(options[0].label, "720p MP4");
  assert.equal(options[0].quality, "720p");
  assert.equal(options[0].sizeBytes, 7890123);
});

test("audio-only single format maps to Original with size", () => {
  const { options } = mapRealFormats([
    { format_id: "audio-http", ext: "mp3", protocol: "https", vcodec: "none", acodec: "mp3", filesize: 8192 },
  ]);
  assert.equal(options.length, 1);
  assert.equal(options[0].quality, "Original");
  assert.equal(options[0].recommended, true);
  assert.equal(options[0].mediaType, "audio");
  assert.equal(options[0].sizeBytes, 8192);
});

test("approx sizes are used when exact sizes are missing; unknown sizes are omitted", () => {
  const { options } = mapRealFormats([
    { format_id: "approx", ext: "mp4", protocol: "https", vcodec: "h264", acodec: "aac", height: 480, filesize_approx: 5000 },
    { format_id: "unknown", ext: "webm", protocol: "https", vcodec: "vp9", acodec: "opus", height: 240 },
  ]);
  assert.equal(options[0].sizeBytes, 5000);
  assert.equal("sizeBytes" in options[1], false);
});

test("throws honest unsupported when nothing is downloadable", () => {
  assert.throws(() => mapRealFormats([
    { format_id: "hls", ext: "mp4", protocol: "m3u8_native", vcodec: "avc1", acodec: "mp4a" },
  ]), { code: "SOURCE_NOT_SUPPORTED" });
  assert.throws(() => mapRealFormats([]), { code: "SOURCE_NOT_SUPPORTED" });
});

test("findOption resolves by id and rejects unknown options", () => {
  const { options } = mapRealFormats([...PROGRESSIVE, ...AUDIO_ONLY]);
  assert.equal(findOption(options, "f-18").selector, "18");
  assert.throws(() => findOption(options, "f-nope"), { code: "INVALID_OPTION" });
});

test("content types resolve only for streamable extensions", () => {
  assert.equal(contentTypeForFormat("mp4"), "video/mp4");
  assert.equal(contentTypeForFormat("m4a"), "audio/mp4");
  assert.throws(() => contentTypeForFormat("ts"), { code: "SOURCE_NOT_SUPPORTED" });
});

test("titles are sanitized for Content-Disposition safety", () => {
  assert.equal(sanitizeExtractorTitle('Bad/Title:*?"<>|', "abc123"), "Bad Title");
  assert.equal(sanitizeExtractorTitle("", "we!ird-id"), "Media-we-ird-id");
});

test("extractor args are fixed, url comes last, and temp dir is included", () => {
  const args = buildExtractArgsForTests("https://example.com/watch?v=1", "/tmp/grabit-x-1");
  assert.equal(args[args.length - 1], "https://example.com/watch?v=1");
  assert.ok(args.includes("--dump-single-json"));
  assert.ok(args.includes("--no-playlist"));
  assert.ok(args.includes("/tmp/grabit-x-1"));
  assert.equal(args.some((arg) => /(^|\s)rm(\s|$)/.test(arg)), false);
});

test("extractor errors map to honest, bounded error codes", () => {
  assert.equal(mapExtractorErrorForTests("ERROR: Sign in to confirm you're not a bot").code, "PRIVATE_OR_PROTECTED");
  assert.equal(mapExtractorErrorForTests("ERROR: [youtube] private video. Sign in if you've been granted access").code, "PRIVATE_OR_PROTECTED");
  assert.equal(mapExtractorErrorForTests("ERROR: This video is unavailable").code, "MEDIA_NOT_FOUND");
  assert.equal(mapExtractorErrorForTests("ERROR: Unsupported URL").code, "SOURCE_NOT_SUPPORTED");
  assert.equal(mapExtractorErrorForTests("ERROR: HTTP Error 429: Too Many Requests").code, "RATE_LIMITED");
  assert.equal(mapExtractorErrorForTests("some unexpected failure").code, "EXTRACTION_FAILED");
});

test("download byte ceiling respects the configured maximum", () => {
  assert.equal(maxDownloadBytesForTests({ MAX_FILE_SIZE_MB: "250" }), 250 * 1024 * 1024);
  assert.equal(maxDownloadBytesForTests({ MAX_FILE_SIZE_MB: "nonsense" }), 250 * 1024 * 1024);
  assert.equal(maxDownloadBytesForTests({ MAX_FILE_SIZE_MB: "900" }), 250 * 1024 * 1024);
  assert.equal(maxDownloadBytesForTests({ MAX_FILE_SIZE_MB: "64" }), 64 * 1024 * 1024);
});
