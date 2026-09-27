import test from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isPublicIp, parseHttpUrl, validatePublicUrl } from "../services/urlValidator.js";
import { analyzeMedia, detectSource } from "../services/sources/index.js";
import { validateMediaResponse } from "../services/sources/direct.js";
import { createSizeLimiter, safeFilename, verifyDownloadResponse } from "../services/downloadService.js";
import { requestOnce } from "../utils/safeHttpRequest.js";
import { resetExtractorAvailabilityForTests } from "../services/extractor/ytDlpRunner.js";
import { clearExtractorCacheForTests } from "../services/sources/extractor.js";

test("accepts public HTTP URLs and rejects malformed, credentialed, and unsafe schemes", () => {
  assert.equal(parseHttpUrl("https://media.example.com/video.mp4").protocol, "https:");
  assert.equal(parseHttpUrl("http://media.example.com/video.mp4").protocol, "http:");
  assert.throws(() => parseHttpUrl("file:///C:/private/video.mp4"), { code: "INVALID_URL" });
  assert.throws(() => parseHttpUrl("javascript:alert(1)"), { code: "INVALID_URL" });
  assert.throws(() => parseHttpUrl("https://user:secret@example.com/video.mp4"), { code: "INVALID_URL" });
  assert.throws(() => parseHttpUrl("https://example.com:8443/video.mp4"), { code: "RESTRICTED_TARGET" });
  assert.throws(() => parseHttpUrl("http://127.0.0.1/admin"), { code: "RESTRICTED_TARGET" });
  assert.throws(() => parseHttpUrl("http://2130706433/admin"), { code: "RESTRICTED_TARGET" });
  assert.throws(() => parseHttpUrl("http://0x7f000001/admin"), { code: "RESTRICTED_TARGET" });
  assert.throws(() => parseHttpUrl("http://localhost./admin"), { code: "RESTRICTED_TARGET" });
  assert.throws(() => parseHttpUrl("not a URL"), { code: "INVALID_URL" });
});

test("rejects private, loopback, link-local, reserved, and transition IP targets", () => {
  for (const address of [
    "0.0.0.0", "10.2.3.4", "100.64.0.1", "127.0.0.1", "169.254.169.254",
    "172.20.10.1", "192.168.1.1", "198.18.0.1", "224.0.0.1", "::", "::1",
    "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2002::1",
  ]) {
    assert.equal(isPublicIp(address), false, `${address} must not be public`);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"]) {
    assert.equal(isPublicIp(address), true, `${address} should be public`);
  }
});

test("blocks localhost and local IP URLs before making a request", async () => {
  await assert.rejects(validatePublicUrl("http://127.0.0.1/video.mp4"), { code: "RESTRICTED_TARGET" });
  await assert.rejects(validatePublicUrl("http://[::1]/video.mp4"), { code: "RESTRICTED_TARGET" });
  await assert.rejects(validatePublicUrl("http://localhost/video.mp4"), { code: "RESTRICTED_TARGET" });
  await assert.rejects(validatePublicUrl("http://service.internal/video.mp4"), { code: "RESTRICTED_TARGET" });
});

test("detects platform sources and reports support honestly based on extractor availability", async (t) => {
  const originalPath = process.env.YTDLP_PATH;
  t.after(() => {
    if (originalPath === undefined) delete process.env.YTDLP_PATH;
    else process.env.YTDLP_PATH = originalPath;
    resetExtractorAvailabilityForTests();
    clearExtractorCacheForTests();
  });

  // Without the extractor binary: platforms are detected but honestly unsupported.
  delete process.env.YTDLP_PATH;
  resetExtractorAvailabilityForTests();
  const platformUrls = [
    ["https://youtu.be/example", "youtube"],
    ["https://instagram.com/p/example", "instagram"],
    ["https://pinterest.com/pin/1", "pinterest"],
    ["https://tiktok.com/@example/video/1", "tiktok"],
    ["https://facebook.com/watch/example", "facebook"],
    ["https://x.com/example/status/1", "x"],
  ];
  for (const [url, source] of platformUrls) {
    assert.deepEqual(detectSource(url), { source, detected: true, supported: false });
  }
  await assert.rejects(analyzeMedia("https://www.youtube.com/watch?v=example"), {
    code: "SOURCE_NOT_SUPPORTED",
  });

  // With the extractor configured: extractor-backed hosts report supported.
  // (Detection only checks that the binary path exists; process.execPath exists everywhere.)
  process.env.YTDLP_PATH = process.execPath;
  resetExtractorAvailabilityForTests();
  clearExtractorCacheForTests();
  assert.deepEqual(detectSource("https://youtu.be/example"), { source: "youtube", detected: true, supported: true });
  assert.deepEqual(detectSource("https://youtube.com/watch/video.mp4"), {
    source: "youtube", detected: true, supported: true,
  });

  // Instagram, Facebook, and Pinterest are extractor-backed: supported when the
  // extractor is available.
  assert.deepEqual(detectSource("https://instagram.com/p/example"), { source: "instagram", detected: true, supported: true });
  assert.deepEqual(detectSource("https://facebook.com/watch/example"), { source: "facebook", detected: true, supported: true });
  assert.deepEqual(detectSource("https://pinterest.com/pin/1"), { source: "pinterest", detected: true, supported: true });

  // Login/gallery walls stay unsupported regardless of extractor availability.
  assert.deepEqual(detectSource("https://reddit.com/r/example/comments/1"), { source: "reddit", detected: true, supported: false });
  assert.deepEqual(detectSource("https://vimeo.com/12345"), { source: "vimeo", detected: true, supported: false });

  await assert.rejects(analyzeMedia("https://example.com/article"), { code: "UNSUPPORTED_SOURCE" });
  assert.deepEqual(detectSource("https://files.example/image.jpeg"), {
    source: "direct", detected: true, supported: true,
  });
});

test("accepts the direct image, audio, and video MIME types GrabIt advertises", () => {
  const supportedTypes = [
    ["video/mp4", "video"], ["video/quicktime", "video"], ["video/webm", "video"],
    ["audio/mpeg", "audio"], ["audio/wav", "audio"], ["audio/x-wav", "audio"],
    ["image/jpeg", "image"], ["image/png", "image"], ["image/webp", "image"], ["image/gif", "image"],
  ];
  for (const [contentType, mediaType] of supportedTypes) {
    const result = validateMediaResponse({ headers: { "content-type": `${contentType}; charset=binary`, "content-length": "4096" } }, {
      mediaTypes: [mediaType],
    });
    assert.equal(result.mediaType, mediaType);
    assert.equal(result.sizeBytes, 4096);
  }

  assert.throws(() => validateMediaResponse({ headers: { "content-type": "image/svg+xml" } }, {
    mediaTypes: ["image"],
  }), { code: "INVALID_CONTENT_TYPE" });
  assert.throws(() => validateMediaResponse({ headers: { "content-type": "image/png" } }, {
    mediaTypes: ["video"],
  }), { code: "INVALID_CONTENT_TYPE" });
  assert.throws(() => validateMediaResponse({
    headers: { "content-type": "video/mp4", "content-length": String(250 * 1024 * 1024 + 1) },
  }, { mediaTypes: ["video"] }), { code: "FILE_TOO_LARGE" });
});

test("revalidates download response type and sanitizes generated filenames", () => {
  assert.throws(() => verifyDownloadResponse({
    statusCode: 200,
    headers: { "content-type": "text/html", "content-length": "8" },
  }, { contentType: "video/mp4" }), { code: "INVALID_CONTENT_TYPE" });
  assert.throws(() => verifyDownloadResponse({
    statusCode: 200,
    headers: { "content-type": "video/mp4", "content-length": String(250 * 1024 * 1024 + 1) },
  }, { contentType: "video/mp4" }), { code: "FILE_TOO_LARGE" });
  const filename = safeFilename("../../folder\\bad:name?.txt", "mp4");
  assert.match(filename, /^[a-zA-Z0-9_-]+\.mp4$/);
  assert.equal(safeFilename("NUL", "png"), "media-NUL.png");
});

test("download stream stops when the configured byte limit is exceeded", async () => {
  const sink = new Writable({ write(chunk, encoding, callback) { callback(); } });
  await assert.rejects(
    pipeline(Readable.from([Buffer.from("four")]), createSizeLimiter(3), sink),
    { code: "FILE_TOO_LARGE" },
  );
});

test("upstream request timeout is bounded and reported with a safe code", async () => {
  const upstream = (await import("node:http")).createServer((request, response) => {
    setTimeout(() => response.end("late"), 100);
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const port = upstream.address().port;
  try {
    await assert.rejects(
      requestOnce(new URL(`http://127.0.0.1:${port}/slow`), [{ address: "127.0.0.1", family: 4 }], {
        method: "GET", timeoutMs: 20,
      }),
      { code: "TIMEOUT" },
    );
  } finally {
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
