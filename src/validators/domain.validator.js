import { z } from "zod";

export const symbolParamSchema = z.object({
  params: z.object({ symbol: z.string().min(2).max(12) }),
  query: z.object({}).passthrough(),
  body: z.object({}).passthrough(),
});

export const transferSchema = z.object({
  body: z.object({
    from: z.enum(["main", "spot", "funding"]),
    to: z.enum(["main", "spot", "funding"]),
    symbol: z.string().min(2).max(12),
    amount: z.number().positive(),
  }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

export const withdrawalSchema = z.object({
  body: z.object({
    symbol: z.string().min(2).max(12),
    amount: z.number().positive(),
    address: z.string().min(8),
  }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

export const orderSchema = z.object({
  body: z.object({
    symbol: z.string().min(2).max(12),
    side: z.enum(["buy", "sell"]),
    type: z.enum(["market", "limit", "stop", "stop_limit"]),
    price: z.number().positive(),
    amount: z.number().positive(),
    stopPrice: z.number().positive().optional(),
    leverage: z.number().int().min(1).max(100).optional(),
    marginMode: z.enum(["cross", "isolated"]).optional(),
    takeProfit: z.number().positive().optional(),
    stopLoss: z.number().positive().optional(),
    reduceOnly: z.boolean().optional(),
  }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});
