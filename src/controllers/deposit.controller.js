import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import * as btcpayService from "../services/btcpay.service.js";
import { adjustBalance, recordTransaction } from "../services/wallet.service.js";

export async function createDepositInvoice(req, res) {
  try {
    const { amount, currency } = req.body;
    if (!amount || Number(amount) <= 0)
      return res.status(400).json({ error: "A positive amount is required" });

    const invoice = await btcpayService.createInvoice({
      amount: Number(amount),
      currency: currency || "USDT",
      userId: req.user.id,
    });

    const record = await prisma.btcPayInvoice.create({
      data: {
        userId: req.user.id,
        invoiceId: invoice.invoiceId,
        amount: invoice.amount,
        currency: invoice.currency,
        status: invoice.status,
        checkoutUrl: invoice.checkoutUrl,
      },
    });

    res.status(201).json({ invoice, record });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

export async function getInvoiceStatus(req, res) {
  try {
    const invoice = await btcpayService.getInvoice(req.params.invoiceId);
    const record = await prisma.btcPayInvoice.findUnique({
      where: { invoiceId: req.params.invoiceId },
    });

    if (!record || record.userId !== req.user.id)
      return res.status(404).json({ error: "Invoice not found" });

    if (record.status !== invoice.status) {
      await prisma.btcPayInvoice.update({
        where: { id: record.id },
        data: { status: invoice.status },
      });
    }

    res.json({ invoice });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

export async function developmentCredit(req, res) {
  if (env.nodeEnv === "production")
    return res.status(403).json({ error: "Development credits are disabled in production" });
  const { symbol, amount } = req.body;
  await adjustBalance({ userId: req.user.id, kind: "main", symbol, amount: Number(amount) });
  const { transaction, notification } = await recordTransaction({
    userId: req.user.id,
    type: "deposit",
    symbol,
    amount: Number(amount),
    status: "completed",
  });
  req.io?.to(`user:${req.user.id}`).emit("notification", notification);
  res.status(201).json({ transaction });
}

export async function btcpayWebhook(req, res) {
  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const signature = req.headers["btcpay-sig"];

    if (!btcpayService.verifyWebhookSignature(rawBody, signature)) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    const event = req.body;
    const { type, invoiceId } = event;

    const record = await prisma.btcPayInvoice.findUnique({
      where: { invoiceId: invoiceId || event.invoice?.id },
    });

    if (!record) return res.json({ received: true, message: "Invoice not tracked" });

    const newStatus = event.metadata?.status || event.invoice?.status || "";
    await prisma.btcPayInvoice.update({
      where: { id: record.id },
      data: { status: newStatus },
    });

    if (type === "InvoiceSettled" || type === "InvoiceProcessing") {
      const existingTx = await prisma.transaction.findFirst({
        where: {
          userId: record.userId,
          type: "deposit",
          status: "completed",
          metadata: { path: ["invoiceId"], equals: record.invoiceId },
        },
      });

      if (!existingTx) {
        await adjustBalance({
          userId: record.userId,
          kind: "main",
          symbol: record.currency,
          amount: record.amount,
        });
        const { notification } = await recordTransaction({
          userId: record.userId,
          type: "deposit",
          symbol: record.currency,
          amount: record.amount,
          status: "completed",
          metadata: { invoiceId: record.invoiceId, provider: "btcpay" },
        });

        if (req.io) {
          req.io.to(`user:${record.userId}`).emit("deposit_confirmed", {
            invoiceId: record.invoiceId,
            amount: record.amount,
            currency: record.currency,
          });
          req.io.to(`user:${record.userId}`).emit("notification", notification);
        }
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error("[btcpay webhook] error:", error.message);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}
