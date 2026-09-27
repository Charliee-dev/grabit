import "dotenv/config";
import http from "node:http";
import { HOST, PORT } from "./config.js";
import { createApp } from "./app.js";

const app = createApp();

const server = http.createServer(app);
server.requestTimeout = 20_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT, HOST, () => {
  console.log(`GrabIt API listening on ${HOST}:${PORT}`);
});

function closeServer(signal) {
  console.log(`Received ${signal}; shutting down GrabIt API.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.once("SIGINT", () => closeServer("SIGINT"));
process.once("SIGTERM", () => closeServer("SIGTERM"));
