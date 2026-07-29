import http from "http";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { connectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { registerSockets } from "./sockets/index.js";
import { initMarketStream } from "./services/marketStream.service.js";
import { setMatchingIO } from "./services/matching.service.js";
import { startMatchingWorker } from "./workers/matching.worker.js";

async function main() {
  await connectDatabase();

  const app = createApp();
  const server = http.createServer(app);
  const allowedOrigins = env.frontendOrigin.split(",").map((o) => o.trim().replace(/\/$/, ""));

  const io = new Server(server, {
    cors: { origin: allowedOrigins, credentials: true },
  });
  registerSockets(io);
  app.set("io", io);

  initMarketStream(io);
  setMatchingIO(io);
  startMatchingWorker();

  server.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
