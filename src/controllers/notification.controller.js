import { prisma } from "../config/prisma.js";

export async function listNotifications(req, res) {
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.notification.count({
      where: { userId: req.user.id, read: false },
    }),
  ]);
  res.json({ notifications, unreadCount });
}

export async function markAsRead(req, res) {
  const notification = await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user.id },
    data: { read: true },
  });
  if (notification.count === 0) {
    return res.status(404).json({ error: "Notification not found" });
  }
  const updated = await prisma.notification.findUnique({ where: { id: req.params.id } });
  res.json({ notification: updated });
}

export async function markAllAsRead(req, res) {
  const result = await prisma.notification.updateMany({
    where: { userId: req.user.id, read: false },
    data: { read: true },
  });
  res.json({ updated: result.count });
}

export async function deleteNotification(req, res) {
  const result = await prisma.notification.deleteMany({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (result.count === 0) {
    return res.status(404).json({ error: "Notification not found" });
  }
  res.json({ deleted: true });
}
