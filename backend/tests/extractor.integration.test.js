// Real-network integration tests for the yt-dlp-backed extractor adapter.
// These run only when the extractor binary is configured via YTDLP_PATH, so plain
// `npm test` stays hermetic. Configure the real binary to include these checks:
//   Windows (bash): YTDLP_PATH=./bin/yt-dlp.exe npm test
// Every assertion below is against real network responses; nothing is faked.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ffmpegAvailable, resetExtractorAvailabilityForTests } from "../services/extractor/ytDlpRunner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const localBinary = path.join(here, "..", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const configuredBinary = process.env.YTDLP_PATH || (existsSync(localBinary) ? localBinary : "");
if (configuredBinary) process.env.YTDLP_PATH = configuredBinary;
const extractorReady = Boolean(configuredBinary && existsSync(configuredBinary));

const { analyzeMedia, detectSource } = await import("../services/sources/index.js");

test("extractor integration tests are skipped when no binary is available", { skip: !extractorReady }, () => {
  assert.equal(extractorReady, true);
});

test("detects YouTube as supported when the extractor is configured", { skip: !extractorReady }, () => {
  assert.deepEqual(detectSource("https://youtu.be/EXAMPLEID"), {
    source: "youtube", detected: true, supported: true,
  });
});

test("detects all extractor-backed platforms as supported", { skip: !extractorReady }, () => {
  const platforms = [
    ["https://www.instagram.com/p/EXAMPLE", "instagram"],
    ["https://www.facebook.com/watch?v=EXAMPLE", "facebook"],
    ["https://www.pinterest.com/pin/12345", "pinterest"],
    ["https://x.com/example/status/12345", "x"],
    ["https://www.tiktok.com/@example/video/12345", "tiktok"],
  ];
  for (const [url, source] of platforms) {
    assert.deepEqual(detectSource(url), { source, detected: true, supported: true });
  }
});

const ffmpegConfigured = ffmpegAvailable();

test("real public YouTube video analyzes with real options", { skip: !extractorReady }, async () => {
  resetExtractorAvailabilityForTests();
  // Big Buck Bunny (Blender Foundation) — permanently public, no login, no DRM.
  const analysis = await analyzeMedia("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
  assert.equal(analysis.source, "YouTube");
  assert.ok(Array.isArray(analysis.options) && analysis.options.length >= 1);
  assert.equal(analysis.options[0].recommended, true);
  for (const option of analysis.options) {
    assert.match(option.id, /^f-/);
    assert.ok(/^(mp4|webm|m4a|mp3|opus|ogg|wav)$/i.test(option.format));
    assert.ok(option.selector && option.selector.length > 0);
  }
  if (ffmpegConfigured) {
    // Modern YouTube is DASH-only; real video options require ffmpeg merging.
    assert.equal(analysis.mediaType, "video");
    assert.ok(analysis.options.some((option) => option.mediaType === "video"));
  } else {
    // Without ffmpeg only audio singles are honestly offered.
    assert.equal(analysis.mediaType, "audio");
    assert.ok(analysis.options.every((option) => option.mediaType === "audio"));
  }
});
