const form = document.querySelector("#urlForm");
const input = document.querySelector("#urlInput");
const clearButton = document.querySelector("#clearBtn");
const analyzeButton = document.querySelector("#analyzeBtn");
const formMessage = document.querySelector("#formMessage");
const processing = document.querySelector("#processing");
const processingText = document.querySelector("#processingText");
const results = document.querySelector("#results");
const sourceName = document.querySelector("#sourceName");
const mediaTitle = document.querySelector("#mediaTitle");
const previewMessage = document.querySelector("#previewMessage");
const qualityList = document.querySelector("#qualityList");
const qualityEyebrow = document.querySelector("#qualityEyebrow");
const qualityTag = document.querySelector("#qualityTag");
const resultsHeading = document.querySelector("#resultsHeading");
const stateTitle = document.querySelector("#stateTitle");
const stateText = document.querySelector("#stateText");
const downloadButton = document.querySelector("#downloadBtn");
const downloadHelp = document.querySelector("#downloadHelp");

function getApiBaseUrl() {
  const configured = typeof window.GRABIT_API_BASE_URL === "string"
    ? window.GRABIT_API_BASE_URL.trim()
    : "";
  if (configured) return configured.replace(/\/$/, "");

  const localHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const defaultUrl = localHost
    ? `${window.location.protocol}//${window.location.hostname}:5001/api`
    : `${window.location.origin}/api`;
  return defaultUrl.replace(/\/$/, "");
}

const API_BASE_URL = getApiBaseUrl();
const stepDescriptions = [
  "Link detected. Checking the address.",
  "Checking that the media is publicly reachable.",
  "Reading the media type and available file details.",
  "Preparing the available option.",
];
let currentAnalysis = null;
let currentAnalysisUrl = "";
let selectedOptionId = null;

const pause = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));

class ApiUnavailableError extends Error {
  constructor() {
    super("The GrabIt API could not be reached.");
    this.name = "ApiUnavailableError";
  }
}

class ApiResponseError extends Error {
  constructor(code, message) {
    super(message || "The link could not be processed.");
    this.name = "ApiResponseError";
    this.code = code || "SERVER_ERROR";
  }
}

function resetSteps() {
  document.querySelectorAll(".step").forEach((step) => {
    step.classList.remove("is-done", "is-current");
  });
  document.querySelectorAll(".step-connector").forEach((connector) => {
    connector.classList.remove("is-done");
  });
}

function showInitialState() {
  input.value = "";
  input.disabled = false;
  input.removeAttribute("aria-invalid");
  clearButton.disabled = false;
  clearButton.hidden = true;
  analyzeButton.disabled = false;
  analyzeButton.querySelector("span").textContent = "Analyze link";
  form.removeAttribute("aria-busy");
  formMessage.textContent = "";
  formMessage.hidden = true;
  processing.hidden = true;
  results.hidden = true;
  qualityList.replaceChildren();
  clearMediaPreview();
  downloadButton.disabled = true;
  currentAnalysis = null;
  currentAnalysisUrl = "";
  selectedOptionId = null;
  resetSteps();
}

function showError(message, { invalid = false } = {}) {
  formMessage.textContent = message;
  formMessage.hidden = false;
  if (invalid) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
  processing.hidden = true;
  results.hidden = true;
  form.removeAttribute("aria-busy");
  currentAnalysis = null;
  currentAnalysisUrl = "";
  selectedOptionId = null;
  downloadButton.disabled = true;
  enableForm();
  input.focus();
}

function clearError() {
  formMessage.textContent = "";
  formMessage.hidden = true;
  input.removeAttribute("aria-invalid");
}

function parseUserUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ApiResponseError("INVALID_URL", "Enter a complete link, such as https://example.com/video.mp4.");
  }

  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new ApiResponseError("INVALID_URL", "Enter a public link that starts with http:// or https://.");
  }

  return url;
}

async function requestAnalysis(url) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      credentials: "omit",
    });
  } catch {
    throw new ApiUnavailableError();
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiResponseError("SERVER_ERROR", "The server returned an unreadable response.");
  }

  if (!response.ok || payload?.success !== true) {
    throw new ApiResponseError(payload?.error?.code, payload?.error?.message);
  }
  if (!Array.isArray(payload.options) || payload.options.length === 0) {
    throw new ApiResponseError("SERVER_ERROR", "No available media options were returned.");
  }

  return payload;
}

async function animateProgress() {
  resetSteps();
  const steps = [...document.querySelectorAll(".step")];
  const connectors = [...document.querySelectorAll(".step-connector")];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const delay = reducedMotion ? 45 : 390;

  steps.forEach((step, index) => {
    step.querySelector(".step-icon").textContent = String(index + 1);
  });

  for (let index = 0; index < steps.length; index += 1) {
    processingText.textContent = stepDescriptions[index];
    steps[index].classList.add("is-current");
    await pause(delay);
    if (index < steps.length - 1) {
      steps[index].classList.remove("is-current");
      steps[index].classList.add("is-done");
      if (connectors[index]) connectors[index].classList.add("is-done");
    }
  }
}

function formatFileSize(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = sizeBytes;
  let unitIndex = -1;
  do {
    size /= 1024;
    unitIndex += 1;
  } while (size >= 1024 && unitIndex < units.length - 1);
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function makeQualityOption(option, { selected = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `quality-option${selected ? " is-selected" : ""}`;
  button.dataset.optionId = option.id;
  button.dataset.quality = option.label || option.quality || "Original";
  button.setAttribute("aria-pressed", String(selected));

  const mark = document.createElement("span");
  mark.className = "quality-mark";
  mark.textContent = String(option.format || "FILE").toUpperCase();

  const copy = document.createElement("span");
  copy.className = "quality-copy";
  const title = document.createElement("strong");
  title.textContent = option.label || option.quality || "Original";
  const detail = document.createElement("small");
  const details = [option.quality || "Original file", String(option.format || "file").toUpperCase()];
  const sizeLabel = formatFileSize(option.sizeBytes);
  if (sizeLabel) details.push(sizeLabel);
  detail.textContent = details.join(" · ");
  copy.append(title, detail);
  button.append(mark, copy);

  if (option.recommended) {
    const recommended = document.createElement("span");
    recommended.className = "recommended";
    recommended.textContent = "⭐ Recommended";
    button.append(recommended);
  }

  return button;
}

function renderOptions(options) {
  const selected = options.find((option) => option.recommended) || options[0];
  selectedOptionId = selected.id;
  qualityList.replaceChildren(...options.map((option) =>
    makeQualityOption(option, { selected: option.id === selectedOptionId }),
  ));
  qualityList.setAttribute("aria-label", "Available media options");
  qualityEyebrow.textContent = "AVAILABLE OPTIONS";
  qualityTag.textContent = options.length === 1 ? "Original file" : `${options.length} options`;
  resultsHeading.textContent = options.length === 1 && selected.quality === "Original"
    ? "Available file"
    : "Choose a quality";
  stateTitle.textContent = `${selected.label || selected.quality || "Original"} selected`;
  stateText.textContent = "Select Download when you're ready to save this file.";
}

function finishProcessing() {
  const steps = [...document.querySelectorAll(".step")];
  const connectors = [...document.querySelectorAll(".step-connector")];
  steps[steps.length - 1]?.classList.remove("is-current");
  steps[steps.length - 1]?.classList.add("is-done");
  connectors.forEach((connector) => connector.classList.add("is-done"));
  processingText.textContent = "Analysis complete.";
}

function showApiResults(analysis, url) {
  currentAnalysis = analysis;
  currentAnalysisUrl = url;
  sourceName.textContent = analysis.source || "Direct media";
  mediaTitle.textContent = analysis.title || "Direct media file";
  showMediaPreview(analysis);
  renderOptions(analysis.options);
  downloadButton.disabled = false;
  downloadButton.textContent = "Download";
  downloadHelp.textContent = "The file will be checked again before it is sent.";
  processing.hidden = true;
  results.hidden = false;
  form.removeAttribute("aria-busy");
  enableForm();
}

function clearMediaPreview() {
  const mediaPreview = document.querySelector(".media-preview");
  mediaPreview.querySelector(".media-preview-image")?.remove();
  document.querySelector(".preview-content").hidden = false;
  mediaPreview.setAttribute("aria-label", "Media preview unavailable");
}

function showMediaPreview(analysis) {
  clearMediaPreview();
  const mediaPreview = document.querySelector(".media-preview");
  const previewContent = document.querySelector(".preview-content");

  if (analysis.mediaType !== "image" || !analysis.thumbnail) {
    previewMessage.textContent = "Preview is not available for this file.";
    mediaPreview.setAttribute("aria-label", `Preview unavailable for ${analysis.mediaType || "media"} file`);
    return;
  }

  const image = document.createElement("img");
  image.className = "media-preview-image";
  image.alt = "";
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => {
    image.remove();
    previewContent.hidden = false;
    previewMessage.textContent = "The image preview is no longer available.";
    mediaPreview.setAttribute("aria-label", "Image preview unavailable");
  }, { once: true });
  image.src = analysis.thumbnail;
  mediaPreview.append(image);
  previewContent.hidden = true;
  mediaPreview.setAttribute("aria-label", `Image preview: ${analysis.title || "direct media file"}`);
}

function apiErrorMessage(error) {
  const messages = {
    INVALID_URL: "Enter a complete public link, such as https://example.com/video.mp4.",
    RESTRICTED_TARGET: "This address can't be accessed. Use a public media link.",
    UNSUPPORTED_SOURCE: "This source isn't supported yet. GrabIt can currently check direct media file links.",
    SOURCE_NOT_SUPPORTED: "This source isn't supported yet. GrabIt can currently check direct media file links.",
    SOURCE_NOT_IMPLEMENTED: "This source isn't supported yet. GrabIt can currently check direct media file links.",
    PRIVATE_OR_PROTECTED: "This media isn't publicly accessible. GrabIt can't access private or protected content.",
    MEDIA_NOT_FOUND: "We couldn't find accessible media at that link.",
    INVALID_CONTENT_TYPE: "This link doesn't point to a supported media file.",
    FILE_TOO_LARGE: "This file is too large to download.",
    DOWNLOAD_FAILED: "That file couldn't be downloaded right now. Please try again.",
    INVALID_OPTION: "Choose an available media option and try again.",
    RATE_LIMITED: "Too many requests were made. Wait a little, then try again.",
    TIMEOUT: "The request took too long. Please try again.",
    API_UNAVAILABLE: "GrabIt couldn't connect to check this link. Please try again shortly.",
    SERVER_ERROR: "Something went wrong while checking the link. Try again later.",
  };
  return messages[error?.code] || error?.message || messages.SERVER_ERROR;
}

function enableForm() {
  input.disabled = false;
  clearButton.disabled = false;
  clearButton.hidden = input.value.length === 0;
  analyzeButton.disabled = false;
  analyzeButton.querySelector("span").textContent = "Analyze link";
}

function beginProcessing() {
  clearError();
  analyzeButton.disabled = true;
  input.disabled = true;
  clearButton.hidden = true;
  clearButton.disabled = true;
  analyzeButton.querySelector("span").textContent = "Analyzing…";
  form.setAttribute("aria-busy", "true");
  results.hidden = true;
  processing.hidden = false;
  processing.scrollIntoView({ behavior: "smooth", block: "center" });
}

input.addEventListener("input", () => {
  clearButton.hidden = input.value.length === 0;
  if (!formMessage.hidden) clearError();
  if (!results.hidden) {
    results.hidden = true;
    currentAnalysis = null;
    currentAnalysisUrl = "";
    downloadButton.disabled = true;
  }
});

clearButton.addEventListener("click", () => {
  input.value = "";
  clearButton.hidden = true;
  clearError();
  processing.hidden = true;
  results.hidden = true;
  currentAnalysis = null;
  currentAnalysisUrl = "";
  downloadButton.disabled = true;
  input.focus();
});

qualityList.addEventListener("click", (event) => {
  const optionElement = event.target.closest(".quality-option");
  if (!optionElement || !qualityList.contains(optionElement)) return;

  qualityList.querySelectorAll(".quality-option").forEach((option) => {
    const isSelected = option === optionElement;
    option.classList.toggle("is-selected", isSelected);
    option.setAttribute("aria-pressed", String(isSelected));
  });

  selectedOptionId = optionElement.dataset.optionId;
  stateTitle.textContent = `${optionElement.dataset.quality} selected`;
  stateText.textContent = "Select Download when you're ready to save this file.";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (analyzeButton.disabled) return;

  let url;
  try {
    url = parseUserUrl(input.value);
  } catch (error) {
    showError(apiErrorMessage(error), { invalid: true });
    return;
  }

  beginProcessing();
  const animation = animateProgress();

  try {
    const analysis = await requestAnalysis(url.href);
    await animation;
    finishProcessing();
    showApiResults(analysis, url.href);
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    await animation;
    if (error instanceof ApiUnavailableError) {
      showError(apiErrorMessage({ code: "API_UNAVAILABLE" }));
    } else {
      showError(apiErrorMessage(error));
    }
  }
});

function downloadFilename(response) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([a-zA-Z0-9._-]+)"/);
  return match ? match[1] : "grabit-media";
}

downloadButton.addEventListener("click", async () => {
  if (!currentAnalysis || !selectedOptionId || downloadButton.disabled) return;

  downloadButton.disabled = true;
  downloadButton.textContent = "Preparing download…";
  stateTitle.textContent = "Preparing your download";
  stateText.textContent = "Checking that the file is still available.";

  try {
    let fileHandle = null;
    if (typeof window.showSaveFilePicker === "function") {
      const selected = currentAnalysis.options.find((option) => option.id === selectedOptionId);
      const extension = /^[a-z0-9]{1,8}$/i.test(selected?.format || "") ? selected.format : "media";
      fileHandle = await window.showSaveFilePicker({ suggestedName: `grabit.${extension}` });
    }

    const response = await fetch(`${API_BASE_URL}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: currentAnalysisUrl, optionId: selectedOptionId }),
      credentials: "omit",
    });

    if (!response.ok) {
      let payload;
      try { payload = await response.json(); } catch { payload = null; }
      throw new ApiResponseError(payload?.error?.code, payload?.error?.message);
    }

    const filename = downloadFilename(response);
    downloadButton.textContent = "Downloading…";
    stateTitle.textContent = "Downloading your file";
    stateText.textContent = "The file is being transferred to your device.";

    if (fileHandle) {
      const writable = await fileHandle.createWritable();
      await response.body.pipeTo(writable);
    } else {
      const blob = await response.blob();
      if (!blob.size) throw new ApiResponseError("DOWNLOAD_FAILED", "The file was empty.");
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    }

    downloadButton.textContent = "Download complete";
    stateTitle.textContent = "Download complete";
    stateText.textContent = "Your browser received the file and started saving it.";
    downloadHelp.textContent = "The temporary server copy is removed after transfer.";
  } catch (error) {
    if (error?.name === "AbortError") {
      downloadButton.disabled = false;
      downloadButton.textContent = "Download";
      stateTitle.textContent = "Download cancelled";
      stateText.textContent = "No file was saved. Select Download when you're ready to try again.";
      return;
    }
    const normalized = error instanceof ApiResponseError
      ? error
      : new ApiResponseError("DOWNLOAD_FAILED", "That file couldn't be downloaded right now. Please try again.");
    stateTitle.textContent = "Download unavailable";
    stateText.textContent = apiErrorMessage(normalized);
    downloadButton.disabled = false;
    downloadButton.textContent = "Try download again";
  }
});

showInitialState();
