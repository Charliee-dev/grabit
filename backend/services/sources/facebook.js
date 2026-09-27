import extractorAdapter from "./extractor.js";

const FACEBOOK_HOSTS = ["facebook.com", "fb.watch"];

function matchesHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return FACEBOOK_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

const facebookAdapter = {
  id: "facebook",
  supported: true,
  requiresExtractor: true,
  canHandle: (url) => matchesHost(url.hostname),
  analyze: (url) => extractorAdapter.analyze(url),
  download: (url, optionId, response) => extractorAdapter.download(url, optionId, response),
};

export default facebookAdapter;
