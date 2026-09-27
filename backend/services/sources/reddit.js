import { createUnsupportedAdapter } from "./unsupported.js";

// Verified limitation (2026-09): yt-dlp's Reddit extractor currently fails on
// public URLs (extractor error), so GrabIt cannot honestly claim support.
export default createUnsupportedAdapter("reddit", ["reddit.com", "redd.it"]);
