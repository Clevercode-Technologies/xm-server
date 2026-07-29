import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { authRoutes } from "./routes/auth.routes.js";
import { walletRoutes } from "./routes/wallet.routes.js";
import { depositRoutes } from "./routes/deposit.routes.js";
import { withdrawRoutes } from "./routes/withdraw.routes.js";
import { tradeRoutes } from "./routes/trade.routes.js";
import { marketRoutes } from "./routes/market.routes.js";
import { notificationRoutes } from "./routes/notification.routes.js";
import { copytradeRoutes } from "./routes/copytrade.routes.js";
import { adminRoutes } from "./routes/admin.routes.js";
import { toErrorResponse } from "./utils/errors.js";

export function createApp() {
  const app = express();
  const allowedOrigins = env.frontendOrigin.split(",").map((o) => o.trim().replace(/\/$/, ""));

  app.use(helmet());
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300 }));

  app.use((req, _res, next) => {
    if (req.path === "/api/deposits/webhooks/btcpay") {
      req.rawBody = "";
      req.on("data", (chunk) => {
        req.rawBody += chunk.toString();
      });
    }
    next();
  });

  app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { req.rawBody = buf.toString(); } }));
  app.use(cookieParser(env.cookieSecret));
  app.use((req, _res, next) => {
    req.io = app.get("io");
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true, service: "xm-xchange-backend" }));
  app.use("/api/auth", authRoutes);
  app.use("/api/wallet", walletRoutes);
  app.use("/api/deposits", depositRoutes);
  app.use("/api/withdrawals", withdrawRoutes);
  app.use("/api/trade", tradeRoutes);
  app.use("/api/markets", marketRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/copy-trading", copytradeRoutes);
  app.use("/api/admin", adminRoutes);

  app.use((err, _req, res, _next) => {
    const { status, body } = toErrorResponse(err);
    res.status(status).json(body);
  });

  return app;
}
