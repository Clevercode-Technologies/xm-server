import { Router } from "express";
import { requestWithdrawal } from "../controllers/withdraw.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { withdrawalSchema } from "../validators/domain.validator.js";

export const withdrawRoutes = Router();

withdrawRoutes.post("/", requireAuth, validate(withdrawalSchema), requestWithdrawal);
