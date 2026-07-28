import { Router } from "express";
import { cancelOrder, listOrders, placeOrder } from "../controllers/trade.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { orderSchema } from "../validators/domain.validator.js";

export const tradeRoutes = Router();

tradeRoutes.use(requireAuth);
tradeRoutes.get("/orders", listOrders);
tradeRoutes.post("/orders", validate(orderSchema), placeOrder);
tradeRoutes.patch("/orders/:id/cancel", cancelOrder);
