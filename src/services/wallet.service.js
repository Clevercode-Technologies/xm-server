import { prisma } from "../config/prisma.js";

const DEFAULT_WALLETS = [
  { kind: "main", balances: [{ symbol: "USDT", amount: 0, locked: 0 }] },
  { kind: "spot", balances: [{ symbol: "USDT", amount: 0, locked: 0 }] },
  { kind: "funding", balances: [] },
];

export async function ensureWallets(userId) {
  for (const wallet of DEFAULT_WALLETS) {
    await prisma.wallet.upsert({
      where: { userId_kind: { userId, kind: wallet.kind } },
      create: { userId, kind: wallet.kind, balances: wallet.balances },
      update: {},
    });
  }
  return prisma.wallet.findMany({
    where: { userId },
    orderBy: { kind: "asc" },
  });
}

export async function adjustBalance({ userId, kind = "main", symbol, amount }) {
  const wallet = await prisma.wallet.findUnique({
    where: { userId_kind: { userId, kind } },
  });
  if (!wallet) throw new Error("Wallet not found");
  const normalized = symbol.toUpperCase();
  const balances = [...wallet.balances];
  const idx = balances.findIndex((b) => b.symbol === normalized);
  if (idx >= 0) {
    balances[idx] = {
      ...balances[idx],
      amount: Math.max(0, balances[idx].amount + amount),
    };
  } else if (amount > 0) {
    balances.push({ symbol: normalized, amount, locked: 0 });
  }
  return prisma.wallet.update({
    where: { id: wallet.id },
    data: { balances },
  });
}

export async function recordTransaction(data) {
  const tx = await prisma.transaction.create({ data });
  const notification = await prisma.notification.create({
    data: {
      userId: data.userId,
      title: `${data.type[0].toUpperCase()}${data.type.slice(1)} ${data.status}`,
      body: `${data.amount} ${data.symbol} is ${data.status}`,
      kind: data.type,
    },
  });
  return { transaction: tx, notification };
}

export async function transfer({ userId, from, to, symbol, amount }) {
  if (from === to) throw new Error("Source and destination wallets must differ");
  await adjustBalance({ userId, kind: from, symbol, amount: -amount });
  await adjustBalance({ userId, kind: to, symbol, amount });
  return recordTransaction({
    userId,
    type: "transfer",
    symbol,
    amount,
    status: "completed",
    metadata: { from, to },
  });
}
async function getWalletBalance(userId, kind, symbol) {
  const wallet = await prisma.wallet.findUnique({
    where: { userId_kind: { userId, kind } },
  });
  if (!wallet) return 0;
  const bal = wallet.balances.find((b) => b.symbol === symbol.toUpperCase());
  return bal ? bal.amount : 0;
}

export async function executeTrade({ userId, side, symbol, price, amount }) {
  const normalizedSymbol = symbol.toUpperCase();
  const quoteSymbol = "USDT";
  const cost = price * amount;

  if (side === "buy") {
    const usdtBalance = await getWalletBalance(userId, "main", quoteSymbol);
    if (usdtBalance < cost) {
      throw new Error(`Insufficient USDT balance. Need ${cost.toFixed(2)}, have ${usdtBalance.toFixed(2)}.`);
    }
    await adjustBalance({ userId, kind: "main", symbol: quoteSymbol, amount: -cost });
    await adjustBalance({ userId, kind: "main", symbol: normalizedSymbol, amount });
  } else {
    const assetBalance = await getWalletBalance(userId, "main", normalizedSymbol);
    if (assetBalance < amount) {
      throw new Error(`Insufficient ${normalizedSymbol} balance. Need ${amount}, have ${assetBalance}.`);
    }
    await adjustBalance({ userId, kind: "main", symbol: normalizedSymbol, amount: -amount });
    await adjustBalance({ userId, kind: "main", symbol: quoteSymbol, amount: cost });
  }

  return { side, symbol: normalizedSymbol, price, amount, cost };
}

export async function lockBalance({ userId, kind = "main", symbol, amount }) {
  const wallet = await prisma.wallet.findUnique({
    where: { userId_kind: { userId, kind } },
  });
  if (!wallet) throw new Error("Wallet not found");
  const normalized = symbol.toUpperCase();
  const balances = [...wallet.balances];
  const idx = balances.findIndex((b) => b.symbol === normalized);
  if (idx < 0) throw new Error(`No ${normalized} balance found`);
  if (balances[idx].amount < amount) {
    throw new Error(`Insufficient available ${normalized}. Need ${amount}, have ${balances[idx].amount}.`);
  }
  balances[idx] = {
    ...balances[idx],
    amount: Math.max(0, balances[idx].amount - amount),
    locked: (balances[idx].locked ?? 0) + amount,
  };
  return prisma.wallet.update({
    where: { id: wallet.id },
    data: { balances },
  });
}

export async function unlockBalance({ userId, kind = "main", symbol, amount }) {
  const wallet = await prisma.wallet.findUnique({
    where: { userId_kind: { userId, kind } },
  });
  if (!wallet) return;
  const normalized = symbol.toUpperCase();
  const balances = [...wallet.balances];
  const idx = balances.findIndex((b) => b.symbol === normalized);
  if (idx < 0) return;
  const unlockAmt = Math.min(amount, balances[idx].locked ?? 0);
  balances[idx] = {
    ...balances[idx],
    locked: Math.max(0, (balances[idx].locked ?? 0) - unlockAmt),
    amount: balances[idx].amount + unlockAmt,
  };
  return prisma.wallet.update({
    where: { id: wallet.id },
    data: { balances },
  });
}

export async function executeLockedTrade({ userId, side, symbol, price, amount }) {
  const normalizedSymbol = symbol.toUpperCase();
  const quoteSymbol = "USDT";
  const cost = price * amount;

  const wallet = await prisma.wallet.findUnique({
    where: { userId_kind: { userId, kind: "main" } },
  });
  if (!wallet) throw new Error("Wallet not found");
  const balances = [...wallet.balances];

  if (side === "buy") {
    const usdtIdx = balances.findIndex((b) => b.symbol === quoteSymbol);
    if (usdtIdx >= 0) {
      balances[usdtIdx] = {
        ...balances[usdtIdx],
        locked: Math.max(0, (balances[usdtIdx].locked ?? 0) - cost),
      };
    }
    const assetIdx = balances.findIndex((b) => b.symbol === normalizedSymbol);
    if (assetIdx >= 0) {
      balances[assetIdx] = { ...balances[assetIdx], amount: balances[assetIdx].amount + amount };
    } else {
      balances.push({ symbol: normalizedSymbol, amount, locked: 0 });
    }
  } else {
    const assetIdx = balances.findIndex((b) => b.symbol === normalizedSymbol);
    if (assetIdx >= 0) {
      balances[assetIdx] = {
        ...balances[assetIdx],
        locked: Math.max(0, (balances[assetIdx].locked ?? 0) - amount),
      };
    }
    const usdtIdx = balances.findIndex((b) => b.symbol === quoteSymbol);
    if (usdtIdx >= 0) {
      balances[usdtIdx] = { ...balances[usdtIdx], amount: balances[usdtIdx].amount + cost };
    } else {
      balances.push({ symbol: quoteSymbol, amount: cost, locked: 0 });
    }
  }

  await prisma.wallet.update({
    where: { id: wallet.id },
    data: { balances },
  });
  return { side, symbol: normalizedSymbol, price, amount, cost };
}
