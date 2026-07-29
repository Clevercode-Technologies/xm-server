# CONTEXT — Market Data Resilience (xm-server)

## Problem
`/api/markets/:symbol/orderbook|trades` returned **502 Bad Gateway** from Render; the browser misreports this as a CORS error (no headers on a failed response = "No Access-Control-Allow-Origin"). The frontend (`xm-exchange`) already does Socket.IO-first with simulated fallback, so the REST polling spam in the logs is a *symptom* of the Socket.IO connection failing — not the root cause.

## Root causes
1. `FRONTEND_ORIGIN` on Render likely missing `https://xm-exchange.pages.dev` → breaks Socket.IO CORS (polling transport) → `socketActiveRef` stays false → frontend falls back to REST polling.
2. Binance REST **and** WS geo-block / rate-limit Render's IP → REST market endpoints throw on timeout → Render proxy returns 502; WS may emit nothing.

## Decisions
- Implement Steps 1–3 regardless of the ops fix (Binance IP-block is a latent risk either way).
- Failover exchanges: **Binance → Bybit → OKX**, with **server-side payload normalization** so the frontend sees a uniform shape and stays untouched.
- Frontend needs essentially no change (already socket-first). Only an optional one-line cleanup.

## Constraints (must not break)
- Socket.IO event names unchanged: `ticker_update`, `trade_update`, `orderbook_update`.
- `getLatestPrice(symbol)` contract used by `matching.service.js`.
- Yahoo polling for forex/commodities/indices.
- All auth/wallet/trade/deposit routes & `matchOrders` worker.
- Frontend `useMarketData.ts` already correct — no polling-removal needed.

## Implementation

### Step 1 — WS failover + normalization (`src/services/marketStream.service.js`)
- Config-driven exchange list with `{ wsUrl, adapter }`.
- **Binance adapter** = current behavior (`depth20@1000ms` full top-20 snapshot → emit directly).
- **Bybit adapter** (`wss://stream.bybit.com/v5/public/spot`): subscribe `tickers.{sym}` / `publicTrade.{sym}` / `orderbook.200.{sym}`; maintain merged book (snapshot+delta), emit top-20 throttled to ~1s.
- **OKX adapter** (`wss://ws.okx.com:8443/ws/v5/public`): subscribe `tickers` / `trades` / `books`; map `last`/`volCcy24h`/`px`/`sz`/`S`; maintain merged book, emit top-20 throttled to ~1s.
- Failover: on N consecutive WS failures, advance to next exchange; rotate back to Binance after cooldown.
- Maintain per-symbol in-memory: `orderbookSnapshot`, `recentTrades` ring buffer (50), `latestPrices` (existing).

### Step 2 — Resilient REST endpoints (`src/services/marketData.service.js`)
- `orderBook(symbol)` → in-memory → exchange REST (Binance→Bybit→OKX) → `{ bids:[], asks:[], lastUpdateId:0 }`.
- `trades(symbol)` → in-memory → exchange REST → `[]`.
- `ticker(symbol)` → `latestPrices`-based → exchange REST → null-safe.
- `klines(symbol)` → Binance REST (best-effort) → Bybit → `[]` on failure.
- `listAssets()` already caches; Yahoo fallback retained. No throw escapes → no 502.

### Step 3 — Env config (`src/config/env.js`)
- `exchangeWsUrls` / `exchangeRestUrls` (comma-separated, env-driven), default Binance→Bybit→OKX.
- `binanceBaseUrl` kept as backward-compatible alias.

### Step 4 — Frontend polish (xm-exchange, one line, optional)
- Remove `extraHeaders: { Cookie: document.cookie }` from `app/lib/exchange.tsx` (browsers reject → "Refused to set unsafe header" noise).

## Out of scope
- DB schema, auth, wallet, trade, deposit routes, matching worker, Yahoo service, socket auth.

## Verification
- `npm run dev` (xm-server) boots clean.
- `curl -i .../api/markets/BTC/orderbook` → 200 with data.
- Force-kill Binance WS → Bybit takes over; `orderbook_update` still fires.
- Limit orders still fill (matching price resolution intact).
- `npm run build` (xm-exchange) clean after the one-line polish.

## Files
- `xm-server/src/services/exchangeAdapters.js` (new)
- `xm-server/src/services/marketStream.service.js` (major)
- `xm-server/src/services/marketData.service.js` (refactor)
- `xm-server/src/config/env.js` (config)
- `xm-exchange/app/lib/exchange.tsx` (one-line cleanup)

## Operational (owner action, not code)
- Render dashboard → xm-server → Environment → set `FRONTEND_ORIGIN=https://xm-exchange.pages.dev`.
- Render → Logs → confirm `[server] listening` and `[marketStream] ... connected` appear.
