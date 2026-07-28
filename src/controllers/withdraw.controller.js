import { adjustBalance, recordTransaction } from "../services/wallet.service.js";

export async function requestWithdrawal(req, res) {
  try {
    const { symbol, amount, address } = req.validated.body;
    await adjustBalance({ userId: req.user.id, kind: "main", symbol, amount: -amount });
    const { transaction, notification } = await recordTransaction({
      userId: req.user.id,
      type: "withdraw",
      symbol,
      amount,
      status: "pending",
      toAddress: address,
      metadata: { review: "manual" },
    });
    req.io?.to(`user:${req.user.id}`).emit("notification", notification);
    res.status(201).json({ transaction });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}
