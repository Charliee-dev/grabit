import { AppError } from "../../utils/appError.js";

export function createUnsupportedAdapter(id, hosts) {
  const matchesHost = (hostname) => {
    const normalized = hostname.toLowerCase().replace(/\.$/, "");
    return hosts.some((host) => normalized === host || normalized.endsWith(`.${host}`));
  };
  const unsupported = () => {
    throw new AppError(501, "SOURCE_NOT_SUPPORTED", "This source isn't supported yet.", {
      source: { id, detected: true, supported: false },
    });
  };

  return {
    id,
    supported: false,
    canHandle: (url) => matchesHost(url.hostname),
    analyze: unsupported,
    download: unsupported,
  };
}
