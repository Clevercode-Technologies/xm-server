import { Router } from "express";
import { createTransfer, listTransactions, listWallets } from "../controllers/wallet.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { transferSchema } from "../validators/domain.validator.js";

export const walletRoutes = Router();

walletRoutes.use(requireAuth);
walletRoutes.get("/", listWallets);
walletRoutes.get("/transactions", listTransactions);
walletRoutes.post("/transfer", validate(transferSchema), createTransfer);
