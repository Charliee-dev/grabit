import dns from "node:dns/promises";
import net from "node:net";
import { AppError } from "../utils/appError.js";

const MAX_URL_LENGTH = 2048;
const DNS_TIMEOUT_MS = 5000;
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

export function parseHttpUrl(input) {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_URL_LENGTH) {
    throw new AppError(400, "INVALID_URL", "Enter a complete public media link.");
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new AppError(400, "INVALID_URL", "Enter a complete public media link.");
  }

  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new AppError(400, "INVALID_URL", "Use a public link that starts with http:// or https://.");
  }

  // Non-standard ports are unnecessary for direct media links and increase the request surface.
  if (url.port) {
    throw new AppError(400, "RESTRICTED_TARGET", "This address can't be accessed.");
  }

  const hostname = stripIpv6Brackets(url.hostname).toLowerCase().replace(/\.$/, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    (net.isIP(hostname) > 0 && !isPublicIp(hostname))
  ) {
    throw new AppError(400, "RESTRICTED_TARGET", "This address can't be accessed.");
  }

  return url;
}

function stripIpv6Brackets(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isPrivateOrReservedIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;

  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function parseIpv6Groups(address) {
  let value = address.toLowerCase();

  if (value.includes(".")) {
    const separator = value.lastIndexOf(":");
    const ipv4 = value.slice(separator + 1);
    if (net.isIP(ipv4) !== 4) return null;
    const [a, b, c, d] = ipv4.split(".").map(Number);
    value = `${value.slice(0, separator)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;

  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

function isPrivateOrReservedIpv6(address) {
  const groups = parseIpv6Groups(address);
  if (!groups) return true;

  // Permit globally routed 2000::/3 addresses, with additional exclusions for special-use ranges.
  const globallyRouted = (groups[0] & 0xe000) === 0x2000;
  const mappedIpv4 = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const transitionOrDocumentation =
    (groups[0] === 0x2001 && (groups[1] === 0 || groups[1] === 0x0db8)) ||
    groups[0] === 0x2002 ||
    (groups[0] === 0x3fff && (groups[1] & 0xf000) === 0);

  if (!globallyRouted || mappedIpv4 || transitionOrDocumentation) return true;

  if (groups[0] === 0x2001 && groups[1] <= 0x01ff) return true;

  return false;
}

export function isPublicIp(address) {
  const version = net.isIP(address);
  if (version === 4) return !isPrivateOrReservedIpv4(address);
  if (version === 6) return !isPrivateOrReservedIpv6(address);
  return false;
}

export async function validatePublicUrl(input, { timeoutMs = DNS_TIMEOUT_MS } = {}) {
  const url = parseHttpUrl(input);
  const hostname = stripIpv6Brackets(url.hostname);
  const version = net.isIP(hostname);

  if (version) {
    if (!isPublicIp(hostname)) {
      throw new AppError(400, "RESTRICTED_TARGET", "This address can't be accessed.");
    }
    return { url, addresses: [{ address: hostname, family: version }] };
  }

  let addresses;
  let timeout;
  try {
    addresses = await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new AppError(504, "TIMEOUT", "The request took too long. Please try again.")), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_URL", "This address could not be found.");
  } finally {
    clearTimeout(timeout);
  }

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new AppError(400, "RESTRICTED_TARGET", "This address can't be accessed.");
  }

  return { url, addresses };
}
