import * as marketData from "../services/marketData.service.js";

export async function assets(_req, res) {
  res.json({ assets: await marketData.listAssets() });
}

export async function ticker(req, res) {
  res.json({ ticker: await marketData.ticker(req.params.symbol) });
}

export async function orderBook(req, res) {
  res.json({ orderBook: await marketData.orderBook(req.params.symbol) });
}

export async function trades(req, res) {
  res.json({ trades: await marketData.trades(req.params.symbol) });
}

export async function klines(req, res) {
  res.json({ klines: await marketData.klines(req.params.symbol, req.query.interval || "1h") });
}
