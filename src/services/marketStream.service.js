import WebSocket from "ws";
import { env } from "../config/env.js";
import { buildAdapters } from "./exchangeAdapters.js";
import { fetchYahooQuotes } from "./externalMarket.service.js";

const RECENT_TRADES_LIMIT = 50;
const FAILOVER_THRESHOLD = 3; // consecutive WS failures before advancing exchange
const COOLDOWN_MS = 60_000; // before rotating back to the first exchange

let io = null;
let adapters = [];
let currentIdx = 0;
let adapter = null;
let ws = null;
let reconnectAttempts = 0;
let consecutiveErrors = 0;
let reconnectTimer = null;
let lastFailoverAt = 0;
let yahooTimer = null;
let closing = false;

const subscribedSymbols = new Set();
const latestPrices = new Map();
const orderbooks = new Map(); // symbol -> { bids, asks, ts }
const recentTrades = new Map(); // symbol -> [{ price, quantity, time, side }]

export function initMarketStream(socketIo) {
  io = socketIo;
  adapters = buildAdapters(env.exchangeWsUrls, env.exchangeRestUrls);
  if (adapters.length === 0) {
    console.error("[marketStream] No exchange adapters configured");
    return;
  }
  connect();
  startYahooPolling();
}

export function getLatestPrice(symbol) {
  return latestPrices.get(symbol.toUpperCase());
}

export function getOrderBookSnapshot(symbol) {
  return orderbooks.get(symbol.toUpperCase());
}

export function getRecentTrades(symbol) {
  return recentTrades.get(symbol.toUpperCase()) || [];
}

function emit(event) {
  if (!io) return;
  if (event.type === "ticker") {
    const { symbol, price, change24h, volume24h, high24h, low24h } = event.data;
    latestPrices.set(symbol, { price, change24h, volume24h, high24h, low24h });
    io.to(`market:${symbol}`).emit("ticker_update", { symbol, price, change24h, volume24h, high24h, low24h });
  } else if (event.type === "trade") {
    const { symbol, price, quantity, time, side } = event.data;
    pushTrade(symbol, event.data);
    io.to(`market:${symbol}`).emit("trade_update", { symbol, price, quantity, time, side });
  } else if (event.type === "orderbook") {
    const { symbol, bids, asks } = event.data;
    if (!bids?.length && !asks?.length) return;
    orderbooks.set(symbol, { bids, asks, ts: Date.now() });
    io.to(`market:${symbol}`).emit("orderbook_update", { symbol, bids, asks });
  }
}

function pushTrade(symbol, trade) {
  const list = recentTrades.get(symbol) || [];
  list.unshift({ price: trade.price, quantity: trade.quantity, time: trade.time, side: trade.side });
  if (list.length > RECENT_TRADES_LIMIT) list.length = RECENT_TRADES_LIMIT;
  recentTrades.set(symbol, list);
}

function selectAdapter() {
  adapter = adapters[currentIdx];
}

function connect() {
  closing = false;
  selectAdapter();
  console.log(`[marketStream] Connecting to ${adapter.id} WS (${adapter.wsUrl})...`);
  if (adapter.init) adapter.init(emit);
  if (adapter.onReconnect) adapter.onReconnect();
  ws = new WebSocket(adapter.wsUrl);

  ws.on("open", () => {
    reconnectAttempts = 0;
    consecutiveErrors = 0;
    console.log(`[marketStream] ${adapter.id} WS connected`);
    for (const symbol of subscribedSymbols) {
      adapter.subscribe(ws, symbol);
    }
  });

  ws.on("message", (raw) => {
    adapter.parse(raw, emit);
  });

  ws.on("close", () => {
    if (closing) return;
    consecutiveErrors++;
    console.log(`[marketStream] ${adapter.id} WS closed (errors: ${consecutiveErrors})`);
    handleFailure();
  });

  ws.on("error", (err) => {
    console.error(`[marketStream] ${adapter.id} WS error:`, err.message);
  });
}

function handleFailure() {
  if (consecutiveErrors >= FAILOVER_THRESHOLD && adapters.length > 1) {
    const next = (currentIdx + 1) % adapters.length;
    if (next !== currentIdx) {
      console.log(`[marketStream] Failover ${adapters[currentIdx].id} -> ${adapters[next].id}`);
      if (adapter.stop) adapter.stop();
      currentIdx = next;
      consecutiveErrors = 0;
      lastFailoverAt = Date.now();
      scheduleReconnect(0);
      return;
    }
  }
  scheduleReconnect();
}

function scheduleReconnect(delay) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectAttempts++;
  const baseDelay = delay != null ? delay : Math.min(1000 * 2 ** reconnectAttempts, 30000);
  reconnectTimer = setTimeout(() => {
    if (adapters.length > 1 && currentIdx !== 0 && Date.now() - lastFailoverAt > COOLDOWN_MS) {
      console.log("[marketStream] Cooldown elapsed, rotating back to primary exchange");
      if (adapter.stop) adapter.stop();
      currentIdx = 0;
      consecutiveErrors = 0;
    }
    connect();
  }, baseDelay);
}

function subscribeSymbol(symbol) {
  subscribedSymbols.add(symbol);
  if (ws && ws.readyState === WebSocket.OPEN) {
    adapter.subscribe(ws, symbol);
    console.log(`[marketStream] Subscribed to ${symbol} via ${adapter.id}`);
  }
}

function unsubscribeSymbol(symbol) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  adapter.unsubscribe(ws, symbol);
  subscribedSymbols.delete(symbol);
  console.log(`[marketStream] Unsubscribed from ${symbol} via ${adapter.id}`);
}

export function onClientJoinMarket(symbol) {
  const normalized = symbol.toUpperCase();
  if (subscribedSymbols.has(normalized)) return;
  subscribeSymbol(normalized);
}

export function onClientLeaveMarket(symbol) {
  const normalized = symbol.toUpperCase();
  const room = io?.sockets.adapter.rooms.get(`market:${normalized}`);
  if (!room || room.size === 0) {
    unsubscribeSymbol(normalized);
  }
}

function startYahooPolling() {
  yahooTimer = setInterval(async () => {
    if (!io) return;
    const yahooRoomSymbols = [];
    for (const [roomName, sockets] of io.sockets.adapter.rooms) {
      if (roomName.startsWith("market:") && sockets.size > 0) {
        const symbol = roomName.replace("market:", "");
        if (!subscribedSymbols.has(symbol)) {
          yahooRoomSymbols.push(symbol);
        }
      }
    }
    if (yahooRoomSymbols.length === 0) return;

    const quotes = await fetchYahooQuotes(yahooRoomSymbols).catch(() => []);
    for (const q of quotes) {
      if (q && io) {
        latestPrices.set(q.symbol, {
          price: q.price,
          change24h: q.change24h,
          volume24h: q.volume24h,
          high24h: q.high24h,
          low24h: q.low24h,
        });
        io.to(`market:${q.symbol}`).emit("ticker_update", {
          symbol: q.symbol,
          price: q.price,
          change24h: q.change24h,
          volume24h: q.volume24h,
          high24h: q.high24h,
          low24h: q.low24h,
        });
      }
    }
  }, 30_000);
}

export function stopMarketStream() {
  closing = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (yahooTimer) clearInterval(yahooTimer);
  if (adapter && adapter.stop) adapter.stop();
  if (ws) {
    ws.close();
    ws = null;
  }
  subscribedSymbols.clear();
}
