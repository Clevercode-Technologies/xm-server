import { prisma } from "../config/prisma.js";
import { ensureWallets, transfer } from "../services/wallet.service.js";

export async function listWallets(req, res) {
  const wallets = await ensureWallets(req.user.id);
  res.json({ wallets });
}

export async function listTransactions(req, res) {
  const txs = await prisma.transaction.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ transactions: txs });
}

export async function createTransfer(req, res) {
  try {
    const { transaction, notification } = await transfer({ userId: req.user.id, ...req.validated.body });
    const wallets = await prisma.wallet.findMany({ where: { userId: req.user.id } });
    req.io?.to(`user:${req.user.id}`).emit("notification", notification);
    res.status(201).json({ transaction, wallets });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}
