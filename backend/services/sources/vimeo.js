import { createUnsupportedAdapter } from "./unsupported.js";

// Verified limitation (2026-09): yt-dlp's Vimeo web client requires a logged-in
// account for every URL, and GrabIt never passes credentials or cookies.
export default createUnsupportedAdapter("vimeo", ["vimeo.com"]);
