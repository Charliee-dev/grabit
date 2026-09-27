import extractorAdapter from "./extractor.js";

const PINTEREST_HOSTS = ["pinterest.com", "pin.it"];

function matchesHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return PINTEREST_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

const pinterestAdapter = {
  id: "pinterest",
  supported: true,
  requiresExtractor: true,
  canHandle: (url) => matchesHost(url.hostname),
  analyze: (url) => extractorAdapter.analyze(url),
  download: (url, optionId, response) => extractorAdapter.download(url, optionId, response),
};

export default pinterestAdapter;
