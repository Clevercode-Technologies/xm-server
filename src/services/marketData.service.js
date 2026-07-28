import axios from "axios";
import { env } from "../config/env.js";
import { fetchYahooQuotes, getYahooSymbols, isYahooSymbol } from "./externalMarket.service.js";

const cache = new Map();
const ttlMs = 60_000;

const cryptoSymbols = ["BTC", "ETH", "USDT", "USDC", "BNB", "SOL", "TRX", "DOGE", "LTC", "TON",
  "XRP", "ADA", "AVAX", "LINK", "DOT", "MATIC", "SHIB", "UNI", "ATOM", "NEAR",
  "APT", "FIL", "ARB", "OP", "INJ", "SUI", "TIA", "SEI", "RUNE", "AAVE",
  "MKR", "PEPE", "WIF", "BONK", "JUP", "PYTH", "STX", "IMX", "GRT", "FTM",
  "ALGO", "RENDER", "FET", "WLD", "ENA", "JTO", "ONDO"];

function getCached(key) {
  const item = cache.get(key);
  if (!item || Date.now() - item.ts > ttlMs) return null;
  return item.value;
}

function setCached(key, value) {
  cache.set(key, { ts: Date.now(), value });
  return value;
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
    throw new Error(`Failed to fetch ${normalized} from Yahoo Finance`);
  }

  const pair = `${normalized}USDT`;
  const { data } = await axios.get(`${env.binanceBaseUrl}/api/v3/ticker/24hr`, {
    params: { symbol: pair },
    timeout: 8000,
  });
  return setCached(key, {
    symbol: normalized,
    pair,
    price: Number(data.lastPrice),
    change24h: Number(data.priceChangePercent),
    volume24h: Number(data.quoteVolume),
    category: "crypto",
  });
}

export async function orderBook(symbol) {
  const normalized = symbol.toUpperCase();
  if (isYahooSymbol(normalized)) {
    return { bids: [], asks: [], lastUpdateId: 0 };
  }
  const pair = `${normalized}USDT`;
  const { data } = await axios.get(`${env.binanceBaseUrl}/api/v3/depth`, {
    params: { symbol: pair, limit: 20 },
    timeout: 8000,
  });
  return data;
}

export async function trades(symbol) {
  const normalized = symbol.toUpperCase();
  if (isYahooSymbol(normalized)) {
    return [];
  }
  const pair = `${normalized}USDT`;
  const { data } = await axios.get(`${env.binanceBaseUrl}/api/v3/trades`, {
    params: { symbol: pair, limit: 50 },
    timeout: 8000,
  });
  return data;
}

export async function klines(symbol, interval = "1h") {
  const normalized = symbol.toUpperCase();
  if (isYahooSymbol(normalized)) {
    return [];
  }
  const pair = `${normalized}USDT`;
  const { data } = await axios.get(`${env.binanceBaseUrl}/api/v3/klines`, {
    params: { symbol: pair, interval, limit: 100 },
    timeout: 8000,
  });
  return data;
}
