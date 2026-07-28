import { Router } from "express";
import {
  listNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from "../controllers/notification.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const notificationRoutes = Router();

notificationRoutes.use(requireAuth);
notificationRoutes.get("/", listNotifications);
notificationRoutes.patch("/read-all", markAllAsRead);
notificationRoutes.patch("/:id", markAsRead);
notificationRoutes.delete("/:id", deleteNotification);
