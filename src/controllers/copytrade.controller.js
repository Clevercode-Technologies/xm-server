import { prisma } from "../config/prisma.js";

const SEED_TRADERS = [
  { name: "Ahmed XM", bio: "Multi-asset swing trader specialising in BTC and major forex pairs.", roi30d: 245.8, winRate: 87, followers: 12450, maxAllocation: 10000, minAllocation: 100, riskScore: 6, assets: ["BTC", "ETH", "SOL", "EURUSD"] },
  { name: "CryptoQueen", bio: "DeFi researcher and trend-following specialist.", roi30d: 189.3, winRate: 82, followers: 8750, maxAllocation: 5000, minAllocation: 50, riskScore: 7, assets: ["ETH", "BNB", "ADA", "SOL"] },
  { name: "AlphaTrader", bio: "Quantitative scalper with 8 years of experience.", roi30d: 156.7, winRate: 79, followers: 6320, maxAllocation: 7500, minAllocation: 200, riskScore: 8, assets: ["BTC", "SOL", "AVAX", "XAUUSD"] },
  { name: "FXMaster", bio: "Forex grid trading with strict risk management.", roi30d: 98.4, winRate: 91, followers: 9100, maxAllocation: 20000, minAllocation: 500, riskScore: 4, assets: ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"] },
  { name: "GoldDigger", bio: "Commodities-focused position trader.", roi30d: 72.1, winRate: 84, followers: 4200, maxAllocation: 15000, minAllocation: 250, riskScore: 5, assets: ["XAUUSD", "XAGUSD", "USOIL"] },
];

async function ensureSeedTraders() {
  const count = await prisma.trader.count();
  if (count > 0) return;
  for (const t of SEED_TRADERS) {
    await prisma.trader.create({ data: t });
  }
}

export async function listTraders(req, res) {
  await ensureSeedTraders();
  const traders = await prisma.trader.findMany({
    orderBy: { roi30d: "desc" },
  });
  let copiedIds = new Set();
  if (req.user?.id) {
    const copies = await prisma.copyTrade.findMany({
      where: { userId: req.user.id, status: "active" },
    });
    copiedIds = new Set(copies.map((c) => c.traderId));
  }
  const tradersWithStatus = traders.map((t) => ({
    ...t,
    isCopied: copiedIds.has(t.id),
  }));
  res.json({ traders: tradersWithStatus });
}

export async function listCopies(req, res) {
  const copies = await prisma.copyTrade.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: "desc" },
  });
  res.json({ copies });
}

export async function followTrader(req, res) {
  const { traderId, allocation } = req.validated.body;
  const trader = await prisma.trader.findUnique({ where: { id: traderId } });
  if (!trader) return res.status(404).json({ error: "Trader not found" });

  const alloc = Number(allocation);
  if (alloc < trader.minAllocation || alloc > trader.maxAllocation) {
    return res.status(400).json({ error: `Allocation must be between ${trader.minAllocation} and ${trader.maxAllocation}` });
  }

  const existing = await prisma.copyTrade.findUnique({
    where: { userId_traderId: { userId: req.user.id, traderId } },
  });
  if (existing && existing.status === "active") {
    return res.status(409).json({ error: "Already copying this trader" });
  }

  const copy = await prisma.copyTrade.upsert({
    where: { userId_traderId: { userId: req.user.id, traderId } },
    create: { userId: req.user.id, traderId, traderName: trader.name, allocation: alloc, status: "active" },
    update: { allocation: alloc, status: "active" },
  });

  await prisma.trader.update({
    where: { id: traderId },
    data: { followers: { increment: existing ? 0 : 1 } },
  });

  const notification = await prisma.notification.create({
    data: {
      userId: req.user.id,
      title: "Copy trade activated",
      body: `You are now copying ${trader.name} with $${alloc}.`,
      kind: "copy_trade",
    },
  });

  req.io?.to(`user:${req.user.id}`).emit("notification", notification);
  res.status(201).json({ copy: copy });
}

export async function unfollowTrader(req, res) {
  const copy = await prisma.copyTrade.findFirst({
    where: { id: req.params.id, userId: req.user.id, status: "active" },
  });
  if (!copy) return res.status(404).json({ error: "Active copy not found" });

  const updated = await prisma.copyTrade.update({
    where: { id: copy.id },
    data: { status: "stopped" },
  });

  res.json({ copy: updated });
}
