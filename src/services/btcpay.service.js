import axios from "axios";
import crypto from "crypto";
import { env } from "../config/env.js";

function btcpayClient() {
  return axios.create({
    baseURL: env.btcpayUrl,
    headers: {
      Authorization: `token ${env.btcpayApiKey}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });
}

export function isConfigured() {
  return Boolean(env.btcpayUrl && env.btcpayApiKey && env.btcpayStoreId);
}

export async function createInvoice({ amount, currency = "USDT", orderId, buyerEmail, userId }) {
  if (!isConfigured()) {
    throw new Error("BTCPay Server is not configured. Set BTCPAY_URL, BTCPAY_API_KEY, and BTCPAY_STORE_ID in your .env file.");
  }

  const client = btcpayClient();
  const { data } = await client.post(`/api/v1/stores/${env.btcpayStoreId}/invoices`, {
    amount: String(amount),
    currency,
    orderId: orderId || `deposit-${userId}-${Date.now()}`,
    buyerEmail: buyerEmail || undefined,
    checkout: {
      redirectURL: `${env.frontendOrigin}/dashboard`,
    },
    metadata: { userId },
  });

  return {
    invoiceId: data.id,
    amount: Number(data.amount),
    currency: data.currency,
    status: data.status,
    checkoutUrl: data.checkoutLink,
  };
}

export async function getInvoice(invoiceId) {
  if (!isConfigured()) {
    throw new Error("BTCPay Server is not configured.");
  }

  const client = btcpayClient();
  const { data } = await client.get(
    `/api/v1/stores/${env.btcpayStoreId}/invoices/${invoiceId}`,
  );

  return {
    invoiceId: data.id,
    amount: Number(data.amount),
    currency: data.currency,
    status: data.status,
    checkoutUrl: data.checkoutLink,
  };
}

export function verifyWebhookSignature(rawBody, signature) {
  if (!env.btcpayWebhookSecret) return false;
  const expected = crypto
    .createHmac("sha256", env.btcpayWebhookSecret)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ""));
  } catch {
    return false;
  }
}
