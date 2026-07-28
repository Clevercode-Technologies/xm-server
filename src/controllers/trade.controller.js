import { prisma } from "../config/prisma.js";
import {
  recordTransaction,
  executeTrade,
  executeLockedTrade,
  lockBalance,
  unlockBalance,
  ensureWallets,
} from "../services/wallet.service.js";
import { ticker } from "../services/marketData.service.js";

export async function placeOrder(req, res) {
  const body = req.validated.body;
  const isMarket = body.type === "market";

  try {
    let price = body.price;

    if (isMarket) {
      const t = await ticker(body.symbol.toUpperCase()).catch(() => null);
      if (t) price = t.price;

      await executeTrade({
        userId: req.user.id,
        side: body.side,
        symbol: body.symbol,
        price,
        amount: body.amount,
      });

      const order = await prisma.order.create({
        data: {
          userId: req.user.id,
          symbol: body.symbol.toUpperCase(),
          side: body.side,
          type: body.type,
          price,
          amount: body.amount,
          filled: body.amount,
          remaining: 0,
          status: "filled",
          stopPrice: body.stopPrice ?? null,
          leverage: body.leverage ?? 1,
          marginMode: body.marginMode ?? "cross",
          takeProfit: body.takeProfit ?? null,
          stopLoss: body.stopLoss ?? null,
          reduceOnly: body.reduceOnly ?? false,
        },
      });

      const { notification } = await recordTransaction({
        userId: req.user.id,
        type: "trade",
        symbol: body.symbol,
        amount: body.amount,
        valueUSD: price * body.amount,
        status: "completed",
        metadata: { side: body.side, orderId: order.id },
      });

      const wallets = await ensureWallets(req.user.id);
      req.io?.to(`user:${req.user.id}`).emit("notification", notification);
      req.io?.to(`user:${req.user.id}`).emit("order_update", order);
      req.io?.to(`user:${req.user.id}`).emit("wallet_update", { wallets });
      res.status(201).json({ order });
    } else {
      const lockSymbol = body.side === "buy" ? "USDT" : body.symbol;
      const lockAmount = body.side === "buy" ? body.price * body.amount : body.amount;

      await lockBalance({
        userId: req.user.id,
        kind: "main",
        symbol: lockSymbol,
        amount: lockAmount,
      });

      const order = await prisma.order.create({
        data: {
          userId: req.user.id,
          symbol: body.symbol.toUpperCase(),
          side: body.side,
          type: body.type,
          price: body.price,
          amount: body.amount,
          filled: 0,
          remaining: body.amount,
          status: "open",
          stopPrice: body.stopPrice ?? null,
          leverage: body.leverage ?? 1,
          marginMode: body.marginMode ?? "cross",
          takeProfit: body.takeProfit ?? null,
          stopLoss: body.stopLoss ?? null,
          reduceOnly: body.reduceOnly ?? false,
        },
      });

      req.io?.to(`user:${req.user.id}`).emit("order_update", order);
      res.status(201).json({ order });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

export async function listOrders(req, res) {
  const orders = await prisma.order.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ orders });
}

export async function cancelOrder(req, res) {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, userId: req.user.id, status: "open" },
  });
  if (!order) return res.status(404).json({ error: "Open order not found" });

  const lockSymbol = order.side === "buy" ? "USDT" : order.symbol;
  const lockAmount = order.side === "buy" ? order.price * order.amount : order.amount;

  await unlockBalance({
    userId: req.user.id,
    kind: "main",
    symbol: lockSymbol,
    amount: lockAmount,
  }).catch(() => {});

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: "canceled" },
  });

  const wallets = await ensureWallets(req.user.id);
  req.io?.to(`user:${req.user.id}`).emit("order_update", updated);
  req.io?.to(`user:${req.user.id}`).emit("wallet_update", { wallets });
  res.json({ order: updated });
}
