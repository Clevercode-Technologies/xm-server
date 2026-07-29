import "dotenv/config";

export const env = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:3000",
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/xm-xchange",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "dev-access-secret-change-me",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "dev-refresh-secret-change-me",
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || "15m",
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL || "7d",
  twoFactorTempTtl: process.env.TWO_FACTOR_TEMP_TTL || "5m",
  emailVerificationTtl: process.env.EMAIL_VERIFICATION_TTL || "24h",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || "XM Exchange <noreply@xm-exchange.com>",
  smtpSecure: process.env.SMTP_SECURE === "true",
  cookieSecret: process.env.COOKIE_SECRET || "dev-cookie-secret-change-me",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "admin-change-me",
  binanceBaseUrl: process.env.BINANCE_BASE_URL || "https://api.binance.com",
  // Comma-separated failover lists. Defaults: Binance -> Bybit -> OKX.
  exchangeWsUrls: (process.env.EXCHANGE_WS_URLS || "wss://stream.binance.com:9443/ws,wss://stream.bybit.com/v5/public/spot,wss://ws.okx.com:8443/ws/v5/public")
    .split(",").map((u) => u.trim()).filter(Boolean),
  exchangeRestUrls: (process.env.EXCHANGE_REST_URLS || "https://api.binance.com,https://api.bybit.com,https://www.okx.com")
    .split(",").map((u) => u.trim()).filter(Boolean),
  btcpayUrl: process.env.BTCPAY_URL || "",
  btcpayApiKey: process.env.BTCPAY_API_KEY || "",
  btcpayStoreId: process.env.BTCPAY_STORE_ID || "",
  btcpayWebhookSecret: process.env.BTCPAY_WEBHOOK_SECRET || "",
};
