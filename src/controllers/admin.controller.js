import argon2 from "argon2";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { signAccessToken } from "../utils/tokens.js";

export async function adminLogin(req, res) {
  const { username, password } = req.body;
  const valid = username === env.adminUsername && password === env.adminPassword;
  if (!valid) return res.status(401).json({ error: "Invalid admin credentials" });

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email: `${env.adminUsername}@admin.local` },
    create: {
      email: `${env.adminUsername}@admin.local`,
      name: "Admin",
      role: "admin",
      emailVerified: true,
      passwordHash,
    },
    update: {
      name: "Admin",
      role: "admin",
      emailVerified: true,
      passwordHash,
    },
  });

  res.json({
    accessToken: signAccessToken(user),
    user: { id: user.id, email: user.email, role: user.role },
  });
}

export async function overview(_req, res) {
  const [users, transactions, orders] = await Promise.all([
    prisma.user.count(),
    prisma.transaction.count(),
    prisma.order.count(),
  ]);
  res.json({ users, transactions, orders });
}

export async function users(_req, res) {
  const items = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerified: true,
      twoFactorEnabled: true,
      lastLoginAt: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ users: items });
}
