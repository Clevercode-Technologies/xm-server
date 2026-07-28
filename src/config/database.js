import { prisma } from "./prisma.js";

export async function connectDatabase() {
  await prisma.$connect();
  console.log("[database] Prisma connected to MongoDB");
}

export { prisma };
