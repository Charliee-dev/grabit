import http from "node:http";
import https from "node:https";
import { MAX_REDIRECTS } from "../config.js";
import { AppError } from "./appError.js";
import { parseHttpUrl, validatePublicUrl } from "../services/urlValidator.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = "GrabIt/1.0 (+public direct-media utility)";

function normalizeRequestError(error) {
  if (error instanceof AppError) return error;
  if (error?.cause instanceof AppError) return error.cause;
  return new AppError(502, "DOWNLOAD_FAILED", "The media server couldn't be reached.");
}

function createPinnedLookup(addresses) {
  return (hostname, options, callback) => {
    const lookupOptions = typeof options === "object" ? options : {};
    const lookupCallback = typeof options === "function" ? options : callback;
    const matching = addresses.filter((entry) => !lookupOptions.family || entry.family === lookupOptions.family);

    if (matching.length === 0) {
      lookupCallback(new Error("No validated public address is available."));
      return;
    }

    if (lookupOptions.all) {
      lookupCallback(null, matching);
      return;
    }

    lookupCallback(null, matching[0].address, matching[0].family);
  };
}

export function requestOnce(url, addresses, { method = "GET", headers = {}, timeoutMs, signal } = {}) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let totalTimeout;
    let timeoutError;
    const onExternalAbort = () => controller.abort(signal?.reason);
    const cleanup = () => {
      clearTimeout(totalTimeout);
      signal?.removeEventListener("abort", onExternalAbort);
    };
    if (signal?.aborted) onExternalAbort();
    else signal?.addEventListener("abort", onExternalAbort, { once: true });

    const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
    const isIpLiteral = Boolean(requireIpVersion(hostname));
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request({
      protocol: url.protocol,
      hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Encoding": "identity",
        Connection: "close",
        ...headers,
        Host: url.host,
      },
      lookup: createPinnedLookup(addresses),
      servername: isIpLiteral ? undefined : hostname,
      maxHeaderSize: 16 * 1024,
      signal: controller.signal,
    }, (response) => resolve({ response, request }));

    if (timeoutMs) {
      totalTimeout = setTimeout(() => {
        timeoutError = new AppError(504, "TIMEOUT", "The request took too long. Please try again.");
        controller.abort(timeoutError);
      }, timeoutMs);
      request.setTimeout(timeoutMs, () => {
        timeoutError = new AppError(504, "TIMEOUT", "The request took too long. Please try again.");
        request.destroy(timeoutError);
      });
    }
    request.once("error", (error) => {
      cleanup();
      reject(timeoutError || normalizeRequestError(error));
    });
    request.once("close", cleanup);
    request.on("response", (response) => {
      response.once("end", cleanup);
      response.once("close", cleanup);
    });
    request.end();
  });
}

function requireIpVersion(hostname) {
  // Use the URL validator's public-IP check for the literal case via a lightweight address shape check.
  return hostname.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

export async function requestPublicUrl(input, { method = "HEAD", headers = {}, timeoutMs, maxRedirects = MAX_REDIRECTS, signal } = {}) {
  let currentUrl = parseHttpUrl(input instanceof URL ? input.href : input);
  const deadline = timeoutMs ? Date.now() + timeoutMs : null;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const remainingBeforeDns = deadline ? deadline - Date.now() : undefined;
    if (remainingBeforeDns !== undefined && remainingBeforeDns <= 0) {
      throw new AppError(504, "TIMEOUT", "The request took too long. Please try again.");
    }
    const dnsTimeout = remainingBeforeDns === undefined ? undefined : Math.max(1, Math.min(5000, remainingBeforeDns));
    const { url, addresses } = await validatePublicUrl(currentUrl.href, { timeoutMs: dnsTimeout });
    const remainingForRequest = deadline ? deadline - Date.now() : undefined;
    if (remainingForRequest !== undefined && remainingForRequest <= 0) {
      throw new AppError(504, "TIMEOUT", "The request took too long. Please try again.");
    }
    const { response, request } = await requestOnce(url, addresses, {
      method,
      headers,
      timeoutMs: remainingForRequest,
      signal,
    });
    const statusCode = response.statusCode || 0;

    if (!REDIRECT_STATUSES.has(statusCode)) {
      return { response, url, abort: () => request.destroy() };
    }

    const location = response.headers.location;
    response.destroy();
    if (!location) {
      throw new AppError(502, "DOWNLOAD_FAILED", "The media link redirected to an invalid location.");
    }
    if (redirectCount === maxRedirects) {
      throw new AppError(502, "DOWNLOAD_FAILED", "The media link redirected too many times.");
    }

    try {
      currentUrl = new URL(location, url);
    } catch {
      throw new AppError(502, "DOWNLOAD_FAILED", "The media link redirected to an invalid location.");
    }
  }

  throw new AppError(502, "DOWNLOAD_FAILED", "The media link couldn't be reached.");
}
