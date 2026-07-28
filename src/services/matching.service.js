import { prisma } from "../config/prisma.js";
import { ticker } from "./marketData.service.js";
import { getLatestPrice } from "./marketStream.service.js";
import { executeLockedTrade, recordTransaction, ensureWallets } from "./wallet.service.js";

let io = null;

export function setMatchingIO(socketIo) {
  io = socketIo;
}

async function resolveLivePrice(symbol) {
  const cached = getLatestPrice(symbol);
  if (cached && cached.price > 0) return cached.price;

  const t = await ticker(symbol).catch(() => null);
  return t?.price ?? null;
}

export async function matchOrders() {
  const openOrders = await prisma.order.findMany({
    where: { status: "open" },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  for (const order of openOrders) {
    const livePrice = await resolveLivePrice(order.symbol);
    if (!livePrice || livePrice <= 0) continue;

    let shouldFill = false;
    let fillPrice = livePrice;

    if (order.type === "limit") {
      if (order.side === "buy" && livePrice <= order.price) {
        shouldFill = true;
        fillPrice = order.price;
      } else if (order.side === "sell" && livePrice >= order.price) {
        shouldFill = true;
        fillPrice = order.price;
      }
    } else if (order.type === "stop") {
      if (order.side === "buy" && livePrice >= (order.stopPrice ?? 0)) {
        shouldFill = true;
        fillPrice = livePrice;
      } else if (order.side === "sell" && livePrice <= (order.stopPrice ?? Infinity)) {
        shouldFill = true;
        fillPrice = livePrice;
      }
    } else if (order.type === "stop_limit") {
      if (order.side === "buy" && livePrice >= (order.stopPrice ?? 0)) {
        if (livePrice <= order.price) {
          shouldFill = true;
          fillPrice = order.price;
        }
      } else if (order.side === "sell" && livePrice <= (order.stopPrice ?? Infinity)) {
        if (livePrice >= order.price) {
          shouldFill = true;
          fillPrice = order.price;
        }
      }
    }

    if (!shouldFill) continue;

    try {
      await executeLockedTrade({
        userId: order.userId,
        side: order.side,
        symbol: order.symbol,
        price: fillPrice,
        amount: order.amount,
      });

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: {
          status: "filled",
          filled: order.amount,
          remaining: 0,
          price: fillPrice,
        },
      });

      const { notification } = await recordTransaction({
        userId: order.userId,
        type: "trade",
        symbol: order.symbol,
        amount: order.amount,
        valueUSD: fillPrice * order.amount,
        status: "completed",
        metadata: { side: order.side, orderId: order.id, orderType: order.type },
      });

      const wallets = await ensureWallets(order.userId);
      io?.to(`user:${order.userId}`).emit("notification", notification);
      io?.to(`user:${order.userId}`).emit("order_update", updated);
      io?.to(`user:${order.userId}`).emit("wallet_update", { wallets });

      console.log(`[matching] Filled ${order.type} ${order.side} ${order.amount} ${order.symbol} @ ${fillPrice} (order ${order.id})`);
    } catch (error) {
      console.error(`[matching] Failed to fill order ${order.id}:`, error.message);
    }
  }
}
