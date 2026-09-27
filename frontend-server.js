const http = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const files = new Map([
  ["/", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { name: "styles.css", type: "text/css; charset=utf-8" }],
  ["/api-config.js", { name: "api-config.js", type: "text/javascript; charset=utf-8" }],
  ["/app.js", { name: "app.js", type: "text/javascript; charset=utf-8" }],
]);

const server = http.createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD", "Content-Length": "0" }).end();
    return;
  }

  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  if (pathname === "/favicon.ico") {
    response.writeHead(204, { "Content-Length": "0" }).end();
    return;
  }
  const file = files.get(pathname);
  if (!file) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": "9" }).end("Not found");
    return;
  }

  try {
    const content = await readFile(path.join(root, file.name));
    response.writeHead(200, {
      "Content-Type": file.type,
      "Content-Length": String(content.length),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": "16" }).end("Unable to serve");
  }
});

server.listen(5500, "127.0.0.1", () => {
  console.log("GrabIt frontend available at http://127.0.0.1:5500");
});
