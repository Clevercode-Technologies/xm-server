import { Router } from "express";
import { adminLogin, overview, users } from "../controllers/admin.controller.js";
import { requireAdmin, requireAuth } from "../middleware/auth.middleware.js";

export const adminRoutes = Router();

adminRoutes.post("/login", adminLogin);
adminRoutes.use(requireAuth, requireAdmin);
adminRoutes.get("/overview", overview);
adminRoutes.get("/users", users);
