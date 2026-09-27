import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const localBinary = path.join(here, "..", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
process.env.YTDLP_PATH = localBinary;

const { createApp } = await import("../app.js");

async function withServer(options, run) {
  const server = http.createServer(createApp(options));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(baseUrl);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postJson(baseUrl, path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("health and JSON error responses are stable and omit server details", async () => {
  await withServer({}, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { success: true, service: "GrabIt API", status: "ok" });
    assert.equal(health.headers.get("x-powered-by"), null);
    assert.ok(health.headers.get("content-security-policy"));

    const malformed = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
      success: false,
      error: { code: "INVALID_REQUEST", message: "Request data must be valid JSON." },
    });

    const badUrl = await postJson(baseUrl, "/api/analyze", { url: "not-a-url" });
    assert.equal(badUrl.status, 400);
    assert.equal((await badUrl.json()).error.code, "INVALID_URL");

    const invalidOption = await postJson(baseUrl, "/api/download", { url: "not-a-url" });
    assert.equal(invalidOption.status, 400);
    assert.equal((await invalidOption.json()).error.code, "INVALID_OPTION");

    const privateUrl = await postJson(baseUrl, "/api/analyze", { url: "http://169.254.169.254/latest/meta-data/" });
    assert.equal(privateUrl.status, 400);
    assert.equal((await privateUrl.json()).error.code, "RESTRICTED_TARGET");

    const unsupported = await postJson(baseUrl, "/api/analyze", { url: "https://youtu.be/example" });
    assert.equal(unsupported.status, 415);
    const payload = await unsupported.json();
    assert.equal(payload.success, false);
    assert.equal(payload.error.code, "SOURCE_NOT_SUPPORTED");
    assert.equal(JSON.stringify(payload).includes("stack"), false);
  });
});

test("CORS allows the configured frontend and withholds access from other origins", async () => {
  await withServer({ frontendOrigins: ["http://127.0.0.1:5500"] }, async (baseUrl) => {
    const preflight = await fetch(`${baseUrl}/api/analyze`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:5500",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "http://127.0.0.1:5500");

    const allowed = await postJson(baseUrl, "/api/analyze", { url: "bad" }, {
      Origin: "http://127.0.0.1:5500",
    });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://127.0.0.1:5500");

    const blocked = await fetch(`${baseUrl}/api/analyze`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://untrusted.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);
  });
});

test("request body size limits return a structured error", async () => {
  await withServer({}, async (baseUrl) => {
    const oversizedBody = JSON.stringify({ url: `https://example.com/${"x".repeat(18_000)}` });
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversizedBody,
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, "REQUEST_TOO_LARGE");
  });
});

test("analysis and download rate limits return the same structured error", async () => {
  await withServer({ analyzeLimit: 2, downloadLimit: 2 }, async (baseUrl) => {
    for (let index = 0; index < 2; index += 1) {
      const response = await postJson(baseUrl, "/api/analyze", { url: "not-a-url" });
      assert.equal(response.status, 400);
    }
    const limitedAnalysis = await postJson(baseUrl, "/api/analyze", { url: "not-a-url" });
    assert.equal(limitedAnalysis.status, 429);
    assert.equal((await limitedAnalysis.json()).error.code, "RATE_LIMITED");

    for (let index = 0; index < 2; index += 1) {
      const response = await postJson(baseUrl, "/api/download", { url: "not-a-url", optionId: "fake" });
      assert.equal(response.status, 400);
    }
    const limitedDownload = await postJson(baseUrl, "/api/download", { url: "not-a-url", optionId: "fake" });
    assert.equal(limitedDownload.status, 429);
    assert.equal((await limitedDownload.json()).error.code, "RATE_LIMITED");
  });
});
