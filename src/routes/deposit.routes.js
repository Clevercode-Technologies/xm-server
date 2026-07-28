import { Router } from "express";
import {
  btcpayWebhook,
  createDepositInvoice,
  developmentCredit,
  getInvoiceStatus,
} from "../controllers/deposit.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const depositRoutes = Router();

depositRoutes.post("/invoice", requireAuth, createDepositInvoice);
depositRoutes.get("/invoice/:invoiceId", requireAuth, getInvoiceStatus);
depositRoutes.post("/development-credit", requireAuth, developmentCredit);
depositRoutes.post("/webhooks/btcpay", btcpayWebhook);
