function readPositiveInteger(name, fallback, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const rawValue = process.env[name];
  const value = rawValue === undefined || rawValue === "" ? fallback : Number(rawValue);

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${name} configuration.`);
  }

  return value;
}

export const PORT = readPositiveInteger("PORT", 5001, { maximum: 65535 });
export const HOST = process.env.HOST || "0.0.0.0";
export const MAX_FILE_SIZE_BYTES = readPositiveInteger("MAX_FILE_SIZE_MB", 250, { maximum: 500 }) * 1024 * 1024;
export const ANALYZE_TIMEOUT_MS = readPositiveInteger("ANALYZE_TIMEOUT_MS", 12000, { maximum: 120000 });
export const DOWNLOAD_TIMEOUT_MS = readPositiveInteger("DOWNLOAD_TIMEOUT_MS", 30000, { maximum: 300000 });
export const MAX_REDIRECTS = readPositiveInteger("MAX_REDIRECTS", 4, { maximum: 10 });

export const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || "http://localhost:5500,http://127.0.0.1:5500")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
