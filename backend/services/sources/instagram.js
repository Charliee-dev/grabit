import extractorAdapter from "./extractor.js";

const INSTAGRAM_HOSTS = ["instagram.com"];

function matchesHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return INSTAGRAM_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

const instagramAdapter = {
  id: "instagram",
  supported: true,
  requiresExtractor: true,
  canHandle: (url) => matchesHost(url.hostname),
  analyze: (url) => extractorAdapter.analyze(url),
  download: (url, optionId, response) => extractorAdapter.download(url, optionId, response),
};

export default instagramAdapter;
