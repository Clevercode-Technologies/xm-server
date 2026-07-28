import WebSocket from "ws";
import { fetchYahooQuotes } from "./externalMarket.service.js";

const BINANCE_WS = "wss://stream.binance.com:9443/ws";

let io = null;
let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let yahooTimer = null;
const subscribedSymbols = new Set();
const latestPrices = new Map();
let closing = false;

export function initMarketStream(socketIo) {
  io = socketIo;
  connectBinance();
  startYahooPolling();
}

export function getLatestPrice(symbol) {
  return latestPrices.get(symbol.toUpperCase());
}

function connectBinance() {
  closing = false;
  console.log("[marketStream] Connecting to Binance WS...");
  ws = new WebSocket(BINANCE_WS);

  ws.on("open", () => {
    reconnectAttempts = 0;
    console.log("[marketStream] Binance WS connected");
    for (const symbol of subscribedSymbols) {
      subscribeSymbol(symbol);
    }
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!msg.stream || !msg.data) return;

    const [streamName, channel] = msg.stream.split("@");
    const symbol = streamName.replace("usdt", "").toUpperCase();

    if (channel === "ticker") {
      const d = msg.data;
      const price = Number(d.c);
      latestPrices.set(symbol, {
        price,
        change24h: Number(d.P),
        volume24h: Number(d.q),
        high24h: Number(d.h),
        low24h: Number(d.l),
      });
      io?.to(`market:${symbol}`).emit("ticker_update", {
        symbol,
        price,
        change24h: Number(d.P),
        volume24h: Number(d.q),
        high24h: Number(d.h),
        low24h: Number(d.l),
      });
    } else if (channel === "trade") {
      const d = msg.data;
      io?.to(`market:${symbol}`).emit("trade_update", {
        symbol,
        price: Number(d.p),
        quantity: Number(d.q),
        time: d.T,
        side: d.m ? "sell" : "buy",
      });
    } else if (channel.startsWith("depth")) {
      const d = msg.data;
      io?.to(`market:${symbol}`).emit("orderbook_update", {
        symbol,
        bids: (d.bids || d.b || []).map((l) => [Number(l[0]), Number(l[1])]),
        asks: (d.asks || d.a || []).map((l) => [Number(l[0]), Number(l[1])]),
      });
    }
  });

  ws.on("close", () => {
    if (closing) return;
    console.log("[marketStream] Binance WS closed, scheduling reconnect...");
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("[marketStream] Binance WS error:", err.message);
  });
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectAttempts++;
  const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
  console.log(`[marketStream] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
  reconnectTimer = setTimeout(() => connectBinance(), delay);
}

function subscribeSymbol(symbol) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const streamSymbol = symbol.toLowerCase() + "usdt";
  const streams = [
    `${streamSymbol}@ticker`,
    `${streamSymbol}@trade`,
    `${streamSymbol}@depth20@1000ms`,
  ];
  ws.send(JSON.stringify({ method: "SUBSCRIBE", params: streams, id: `sub-${symbol}-${Date.now()}` }));
  subscribedSymbols.add(symbol);
  console.log(`[marketStream] Subscribed to ${symbol} streams`);
}

function unsubscribeSymbol(symbol) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const streamSymbol = symbol.toLowerCase() + "usdt";
  const streams = [
    `${streamSymbol}@ticker`,
    `${streamSymbol}@trade`,
    `${streamSymbol}@depth20@1000ms`,
  ];
  ws.send(JSON.stringify({ method: "UNSUBSCRIBE", params: streams, id: `unsub-${symbol}-${Date.now()}` }));
  subscribedSymbols.delete(symbol);
  console.log(`[marketStream] Unsubscribed from ${symbol} streams`);
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
  if (ws) {
    ws.close();
    ws = null;
  }
  subscribedSymbols.clear();
}
