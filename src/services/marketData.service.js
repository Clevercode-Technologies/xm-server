import { env } from "../config/env.js";
import { fetchYahooQuotes, getYahooSymbols, isYahooSymbol } from "./externalMarket.service.js";
import { getOrderBookSnapshot, getRecentTrades, getLatestPrice } from "./marketStream.service.js";
import { buildAdapters } from "./exchangeAdapters.js";

const cache = new Map();
const ttlMs = 60_000;

const cryptoSymbols = ["BTC", "ETH", "USDT", "USDC", "BNB", "SOL", "TRX", "DOGE", "LTC", "TON",
  "XRP", "ADA", "AVAX", "LINK", "DOT", "MATIC", "SHIB", "UNI", "ATOM", "NEAR",
  "APT", "FIL", "ARB", "OP", "INJ", "SUI", "TIA", "SEI", "RUNE", "AAVE",
  "MKR", "PEPE", "WIF", "BONK", "JUP", "PYTH", "STX", "IMX", "GRT", "FTM",
  "ALGO", "RENDER", "FET", "WLD", "ENA", "JTO", "ONDO"];

let restAdapters = null;
function restAdaptersList() {
  if (!restAdapters) restAdapters = buildAdapters(env.exchangeWsUrls, env.exchangeRestUrls);
  return restAdapters;
}

function getCached(key) {
  const item = cache.get(key);
  if (!item || Date.now() - item.ts > ttlMs) return null;
  return item.value;
}

function setCached(key, value) {
  cache.set(key, { ts: Date.now(), value });
  return value;
}

async function withRestFailover(symbol, fn) {
  for (const ad of restAdaptersList()) {
    try {
      const result = await fn(ad);
      if (result) return result;
    } catch (err) {
      console.warn(`[marketData] ${ad.id} REST failed for ${symbol}: ${err.message}`);
    }
  }
  return null;
}

export async function listAssets() {
  const cached = getCached("assets");
  if (cached) return cached;

  const cryptoTickers = await Promise.all(
    cryptoSymbols.map((symbol) => ticker(symbol).catch(() => null))
  );

  const yahooTickers = await fetchYahooQuotes(getYahooSymbols()).catch(() => []);

  const all = [...cryptoTickers.filter(Boolean), ...yahooTickers.filter(Boolean)];
  return setCached("assets", all);
}

export async function ticker(symbol) {
  const normalized = symbol.toUpperCase();

  if (["USDT", "USDC"].includes(normalized)) {
    return { symbol: normalized, pair: `${normalized}USDT`, price: 1, change24h: 0, volume24h: 0, category: "crypto" };
  }

  const key = `ticker:${normalized}`;
  const cached = getCached(key);
  if (cached) return cached;

  if (isYahooSymbol(normalized)) {
    const yahooQuote = await fetchYahooQuotes([normalized]).then((r) => r[0]).catch(() => null);
    if (yahooQuote) return setCached(key, yahooQuote);
    const live = getLatestPrice(normalized);
    if (live) return setCached(key, { symbol: normalized, pair: normalized, ...live, category: "crypto" });
    return null;
  }

  const live = getLatestPrice(normalized);
  if (live && live.price > 0) {
    return setCached(key, {
      symbol: normalized,
      pair: `${normalized}USDT`,
      price: live.price,
      change24h: live.change24h,
      volume24h: live.volume24h,
      high24h: live.high24h,
      low24h: live.low24h,
      category: "crypto",
    });
  }

  const rest = await withRestFailover(normalized, (ad) => ad.restTicker(normalized));
  if (rest) return setCached(key, rest);
  return null;
}

export async function orderBook(symbol) {
  const normalized = symbol.toUpperCase();
  if (isYahooSymbol(normalized)) {
    return { bids: [], asks: [], lastUpdateId: 0 };
  }

  const snapshot = getOrderBookSnapshot(normalized);
  if (snapshot && snapshot.bids?.length && snapshot.asks?.length) {
    return { bids: snapshot.bids, asks: snapshot.asks, lastUpdateId: snapshot.ts || 0 };
  }

  const rest = await withRestFailover(normalized, (ad) => ad.restOrderBook(normalized));
  if (rest) return { bids: rest.bids || [], asks: rest.asks || [], lastUpdateId: rest.lastUpdateId || 0 };
  return { bids: [], asks: [], lastUpdateId: 0 };
}

export async function trades(symbol) {
  const normalized = symbol.toUpperCase();
  if (isYahooSymbol(normalized)) {
    return [];
  }

  const recent = getRecentTrades(normalized);
  if (recent.length > 0) return recent;

  const rest = await withRestFailover(normalized, (ad) => ad.restTrades(normalized));
  return rest || [];
}

export async function klines(symbol, interval = "1h") {
  const normalized = symbol.toUpperCase();
  if (isYahooSymbol(normalized)) {
    return [];
  }

  for (const ad of restAdaptersList()) {
    try {
      const data = await ad.restKlines(normalized, interval);
      if (data && data.length > 0) return data;
    } catch (err) {
      console.warn(`[marketData] ${ad.id} klines failed for ${normalized}: ${err.message}`);
    }
  }
  return [];
}
