import { Router } from "express";
import { assets, klines, orderBook, ticker, trades } from "../controllers/market.controller.js";

export const marketRoutes = Router();

marketRoutes.get("/assets", assets);
marketRoutes.get("/:symbol/ticker", ticker);
marketRoutes.get("/:symbol/orderbook", orderBook);
marketRoutes.get("/:symbol/trades", trades);
marketRoutes.get("/:symbol/klines", klines);
