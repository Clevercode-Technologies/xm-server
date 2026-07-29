import axios from "axios";

// Each adapter normalizes a single exchange's WS + REST payloads to the
// uniform shapes consumed by marketStream.service.js / marketData.service.js:
//   ticker:    { symbol, price, change24h, volume24h, high24h, low24h }
//   trade:     { symbol, price, quantity, time, side }
//   orderbook: { symbol, bids: [[p, q]], asks: [[p, q]] }
//
// Adapters that push incremental book deltas (Bybit, OKX) maintain a merged
// book per symbol and emit a throttled ~1s top-N snapshot.

const TOP_N = 20;
const EMIT_INTERVAL_MS = 1000;
const REST_TIMEOUT_MS = 8000;

function mergeSide(map, levels) {
  for (const [px, qty] of levels) {
    const p = Number(px);
    const q = Number(qty);
    if (!q || q <= 0) map.delete(p);
    else map.set(p, q);
  }
}

function topN(map, n) {
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, n)
    .map(([p, q]) => [p, q]);
}

/* ------------------------------- Binance ------------------------------- */
function binanceAdapter(restUrl) {
  return {
    id: "binance",
    wsUrl: "wss://stream.binance.com:9443/ws",
    pair(symbol) { return `${symbol.toLowerCase()}usdt`; },
    subscribe(ws, symbol) {
      const s = `${symbol.toLowerCase()}usdt`;
      const params = [`${s}@ticker`, `${s}@trade`, `${s}@depth20@1000ms`];
      ws.send(JSON.stringify({ method: "SUBSCRIBE", params, id: `sub-${symbol}-${Date.now()}` }));
    },
    unsubscribe(ws, symbol) {
      const s = `${symbol.toLowerCase()}usdt`;
      const params = [`${s}@ticker`, `${s}@trade`, `${s}@depth20@1000ms`];
      ws.send(JSON.stringify({ method: "UNSUBSCRIBE", params, id: `unsub-${symbol}-${Date.now()}` }));
    },
    parse(raw, emit) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg.stream || !msg.data) return;
      const [streamName, channel] = msg.stream.split("@");
      const symbol = streamName.replace("usdt", "").toUpperCase();
      const d = msg.data;
      if (channel === "ticker") {
        emit({ type: "ticker", data: { symbol, price: Number(d.c), change24h: Number(d.P), volume24h: Number(d.q), high24h: Number(d.h), low24h: Number(d.l) } });
      } else if (channel === "trade") {
        emit({ type: "trade", data: { symbol, price: Number(d.p), quantity: Number(d.q), time: d.T, side: d.m ? "sell" : "buy" } });
      } else if (channel.startsWith("depth")) {
        const bids = (d.bids || d.b || []).map((l) => [Number(l[0]), Number(l[1])]);
        const asks = (d.asks || d.a || []).map((l) => [Number(l[0]), Number(l[1])]);
        emit({ type: "orderbook", data: { symbol, bids, asks } });
      }
    },
    async restOrderBook(symbol) {
      const { data } = await axios.get(`${restUrl}/api/v3/depth`, { params: { symbol: `${symbol}USDT`, limit: 20 }, timeout: REST_TIMEOUT_MS });
      return { bids: data.bids || [], asks: data.asks || [], lastUpdateId: data.lastUpdateId || 0 };
    },
    async restTrades(symbol) {
      const { data } = await axios.get(`${restUrl}/api/v3/trades`, { params: { symbol: `${symbol}USDT`, limit: 50 }, timeout: REST_TIMEOUT_MS });
      return (data || []).map((t) => ({ price: Number(t.price), quantity: Number(t.qty), time: t.time, side: t.isBuyerMaker ? "sell" : "buy" }));
    },
    async restTicker(symbol) {
      const { data } = await axios.get(`${restUrl}/api/v3/ticker/24hr`, { params: { symbol: `${symbol}USDT` }, timeout: REST_TIMEOUT_MS });
      return { symbol, pair: `${symbol}USDT`, price: Number(data.lastPrice), change24h: Number(data.priceChangePercent), volume24h: Number(data.quoteVolume), high24h: Number(data.highPrice), low24h: Number(data.lowPrice), category: "crypto" };
    },
    async restKlines(symbol, interval) {
      const { data } = await axios.get(`${restUrl}/api/v3/klines`, { params: { symbol: `${symbol}USDT`, interval, limit: 100 }, timeout: REST_TIMEOUT_MS });
      return data;
    },
  };
}

/* -------------------------------- Bybit -------------------------------- */
function bybitAdapter(restUrl) {
  const bids = new Map(); // price -> qty  (keyed by `${symbol}:${side}`)
  const asks = new Map();
  const books = new Map(); // symbol -> { bids: Map, asks: Map }
  let timer = null;
  let emitFn = null;
  let subscribed = new Set();

  function flush() {
    if (!emitFn) return;
    for (const symbol of subscribed) {
      const b = books.get(symbol);
      if (!b) continue;
      emitFn({ type: "orderbook", data: { symbol, bids: topN(b.bids, TOP_N), asks: topN(b.asks, TOP_N).reverse() } });
    }
  }
  return {
    id: "bybit",
    wsUrl: "wss://stream.bybit.com/v5/public/spot",
    pair(symbol) { return `${symbol}USDT`; },
    init(emit) {
      emitFn = emit;
      if (timer) clearInterval(timer);
      timer = setInterval(flush, EMIT_INTERVAL_MS);
    },
    onReconnect() { books.clear(); },
    subscribe(ws, symbol) {
      const pair = `${symbol}USDT`;
      subscribed.add(symbol);
      ws.send(JSON.stringify({ op: "subscribe", args: [`tickers.${pair}`, `publicTrade.${pair}`, `orderbook.200.${pair}`] }));
    },
    unsubscribe(ws, symbol) {
      const pair = `${symbol}USDT`;
      subscribed.delete(symbol);
      books.delete(symbol);
      ws.send(JSON.stringify({ op: "unsubscribe", args: [`tickers.${pair}`, `publicTrade.${pair}`, `orderbook.200.${pair}`] }));
    },
    parse(raw, emit) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.op !== "snapshot" && msg.op !== "delta" && msg.topic === undefined) return;
      const topic = msg.topic;
      if (!topic) return;
      if (topic.startsWith("tickers.")) {
        const symbol = topic.replace("tickers.", "").replace("USDT", "").toUpperCase();
        const d = Array.isArray(msg.data) ? msg.data[0] : msg.data;
        if (!d) return;
        const price = Number(d.lastPrice);
        const open = Number(d.prevPrice24h) || 0;
        const change24h = open > 0 ? ((price - open) / open) * 100 : 0;
        emit({ type: "ticker", data: { symbol, price, change24h: Number(change24h.toFixed(4)), volume24h: Number(d.turnover24h) || 0, high24h: Number(d.highPrice24h) || 0, low24h: Number(d.lowPrice24h) || 0 } });
      } else if (topic.startsWith("publicTrade.")) {
        const symbol = topic.replace("publicTrade.", "").replace("USDT", "").toUpperCase();
        const list = Array.isArray(msg.data) ? msg.data : [msg.data];
        for (const t of list) {
          emit({ type: "trade", data: { symbol, price: Number(t.p), quantity: Number(t.v), time: t.T, side: t.S === "Sell" ? "sell" : "buy" } });
        }
      } else if (topic.startsWith("orderbook.200.")) {
        const symbol = topic.replace("orderbook.200.", "").replace("USDT", "").toUpperCase();
        const d = msg.data;
        let b = books.get(symbol);
        if (!b) { b = { bids: new Map(), asks: new Map() }; books.set(symbol, b); }
        if (msg.type === "snapshot") {
          b.bids.clear(); b.asks.clear();
          mergeSide(b.bids, d.b || d.bids || []);
          mergeSide(b.asks, d.a || d.asks || []);
        } else {
          mergeSide(b.bids, d.b || d.bids || []);
          mergeSide(b.asks, d.a || d.asks || []);
        }
      }
    },
    async restOrderBook(symbol) {
      const { data } = await axios.get(`${restUrl}/v5/market/orderbook`, { params: { category: "spot", symbol: `${symbol}USDT`, limit: 20 }, timeout: REST_TIMEOUT_MS });
      const r = data?.result;
      return { bids: (r?.b || []).map((l) => [Number(l[0]), Number(l[1])]), asks: (r?.a || []).map((l) => [Number(l[0]), Number(l[1])]), lastUpdateId: r?.ts ? Number(r.ts) : 0 };
    },
    async restTrades(symbol) {
      const { data } = await axios.get(`${restUrl}/v5/market/recent-trading`, { params: { category: "spot", symbol: `${symbol}USDT`, limit: 50 }, timeout: REST_TIMEOUT_MS });
      const list = data?.result?.list || [];
      return list.map((t) => ({ price: Number(t.p), quantity: Number(t.v), time: Number(t.T), side: t.S === "Sell" ? "sell" : "buy" }));
    },
    async restTicker(symbol) {
      const { data } = await axios.get(`${restUrl}/v5/market/tickers`, { params: { category: "spot", symbol: `${symbol}USDT` }, timeout: REST_TIMEOUT_MS });
      const d = data?.result?.list?.[0];
      if (!d) return null;
      const price = Number(d.lastPrice);
      const open = Number(d.prevPrice24h) || 0;
      const change24h = open > 0 ? ((price - open) / open) * 100 : 0;
      return { symbol, pair: `${symbol}USDT`, price, change24h: Number(change24h.toFixed(4)), volume24h: Number(d.turnover24h) || 0, high24h: Number(d.highPrice24h) || 0, low24h: Number(d.lowPrice24h) || 0, category: "crypto" };
    },
    async restKlines(symbol, interval) {
      const { data } = await axios.get(`${restUrl}/v5/market/kline`, { params: { category: "spot", symbol: `${symbol}USDT`, interval: mapIntervalBybit(interval), limit: 100 }, timeout: REST_TIMEOUT_MS });
      const list = data?.result?.list || [];
      return list.reverse().map((k) => [Number(k[0]), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5])]);
    },
    stop() { if (timer) clearInterval(timer); timer = null; emitFn = null; },
  };
}

/* --------------------------------- OKX --------------------------------- */
function okxAdapter(restUrl) {
  const books = new Map(); // symbol -> { bids: Map, asks: Map }
  let timer = null;
  let emitFn = null;
  let subscribed = new Set();

  function flush() {
    if (!emitFn) return;
    for (const symbol of subscribed) {
      const b = books.get(symbol);
      if (!b) continue;
      emitFn({ type: "orderbook", data: { symbol, bids: topN(b.bids, TOP_N), asks: topN(b.asks, TOP_N).reverse() } });
    }
  }
  return {
    id: "okx",
    wsUrl: "wss://ws.okx.com:8443/ws/v5/public",
    pair(symbol) { return `${symbol}-USDT`; },
    init(emit) {
      emitFn = emit;
      if (timer) clearInterval(timer);
      timer = setInterval(flush, EMIT_INTERVAL_MS);
    },
    onReconnect() { books.clear(); },
    subscribe(ws, symbol) {
      const instId = `${symbol}-USDT`;
      subscribed.add(symbol);
      ws.send(JSON.stringify({ op: "subscribe", args: [
        { channel: "tickers", instId },
        { channel: "trades", instId },
        { channel: "books", instId },
      ] }));
    },
    unsubscribe(ws, symbol) {
      const instId = `${symbol}-USDT`;
      subscribed.delete(symbol);
      books.delete(symbol);
      ws.send(JSON.stringify({ op: "unsubscribe", args: [
        { channel: "tickers", instId },
        { channel: "trades", instId },
        { channel: "books", instId },
      ] }));
    },
    parse(raw, emit) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!Array.isArray(msg.arg ? [msg.arg] : msg) && !msg.arg) return;
      const arg = msg.arg;
      if (!arg || !arg.channel) return;
      const symbol = (arg.instId || "").replace("-USDT", "").toUpperCase();
      if (arg.channel === "tickers") {
        const d = (msg.data || [])[0];
        if (!d) return;
        const price = Number(d.last);
        const open = Number(d.open24h) || price;
        const change24h = open > 0 ? ((price - open) / open) * 100 : 0;
        emit({ type: "ticker", data: { symbol, price, change24h: Number(change24h.toFixed(4)), volume24h: Number(d.volCcy24h) || 0, high24h: Number(d.high24h) || 0, low24h: Number(d.low24h) || 0 } });
      } else if (arg.channel === "trades") {
        for (const t of (msg.data || [])) {
          emit({ type: "trade", data: { symbol, price: Number(t.px), quantity: Number(t.sz), time: Number(t.ts), side: t.side === "sell" ? "sell" : "buy" } });
        }
      } else if (arg.channel === "books") {
        const d = (msg.data || [])[0];
        if (!d) return;
        let b = books.get(symbol);
        if (!b) { b = { bids: new Map(), asks: new Map() }; books.set(symbol, b); }
        if (msg.action === "snapshot") {
          b.bids.clear(); b.asks.clear();
          mergeSide(b.bids, d.bids || []);
          mergeSide(b.asks, d.asks || []);
        } else {
          mergeSide(b.bids, d.bids || []);
          mergeSide(b.asks, d.asks || []);
        }
      }
    },
    async restOrderBook(symbol) {
      const { data } = await axios.get(`${restUrl}/api/v5/market/books`, { params: { instId: `${symbol}-USDT`, sz: 20 }, timeout: REST_TIMEOUT_MS });
      const d = (data?.data || [])[0] || {};
      return { bids: (d.bids || []).map((l) => [Number(l[0]), Number(l[1])]), asks: (d.asks || []).map((l) => [Number(l[0]), Number(l[1])]), lastUpdateId: Date.now() };
    },
    async restTrades(symbol) {
      const { data } = await axios.get(`${restUrl}/api/v5/market/trades`, { params: { instId: `${symbol}-USDT` }, timeout: REST_TIMEOUT_MS });
      const list = data?.data || [];
      return list.slice(0, 50).map((t) => ({ price: Number(t.px), quantity: Number(t.sz), time: Number(t.ts), side: t.side === "sell" ? "sell" : "buy" }));
    },
    async restTicker(symbol) {
      const { data } = await axios.get(`${restUrl}/api/v5/market/ticker`, { params: { instId: `${symbol}-USDT` }, timeout: REST_TIMEOUT_MS });
      const d = (data?.data || [])[0];
      if (!d) return null;
      const price = Number(d.last);
      const open = Number(d.open24h) || price;
      const change24h = open > 0 ? ((price - open) / open) * 100 : 0;
      return { symbol, pair: `${symbol}USDT`, price, change24h: Number(change24h.toFixed(4)), volume24h: Number(d.volCcy24h) || 0, high24h: Number(d.high24h) || 0, low24h: Number(d.low24h) || 0, category: "crypto" };
    },
    async restKlines(symbol, interval) {
      const { data } = await axios.get(`${restUrl}/api/v5/market/candles`, { params: { instId: `${symbol}-USDT`, bar: mapIntervalOkx(interval), limit: 100 }, timeout: REST_TIMEOUT_MS });
      const list = data?.data || [];
      return list.reverse().map((k) => [Number(k[0]), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5])]);
    },
    stop() { if (timer) clearInterval(timer); timer = null; emitFn = null; },
  };
}

function mapIntervalBybit(interval) {
  const map = { "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "4h": "240", "1d": "D", "1w": "W" };
  return map[interval] || "60";
}
function mapIntervalOkx(interval) {
  const map = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "1d": "1D", "1w": "1W" };
  return map[interval] || "1H";
}

const FACTORIES = {
  "wss://stream.binance.com:9443/ws": binanceAdapter,
  "wss://stream.bybit.com/v5/public/spot": bybitAdapter,
  "wss://ws.okx.com:8443/ws/v5/public": okxAdapter,
};

export function buildAdapters(wsUrls, restUrls) {
  const adapters = [];
  for (let i = 0; i < wsUrls.length; i++) {
    const wsUrl = wsUrls[i];
    const restUrl = restUrls[i] || restUrls[0];
    const factory = FACTORIES[wsUrl];
    if (factory) adapters.push(factory(restUrl));
  }
  return adapters;
}
