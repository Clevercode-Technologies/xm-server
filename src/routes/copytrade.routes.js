import { Router } from "express";
import { z } from "zod";
import {
  listTraders,
  listCopies,
  followTrader,
  unfollowTrader,
} from "../controllers/copytrade.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";

const copySchema = z.object({
  body: z.object({
    traderId: z.string().min(1),
    allocation: z.number().positive(),
  }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

export const copytradeRoutes = Router();

copytradeRoutes.get("/traders", listTraders);
copytradeRoutes.use(requireAuth);
copytradeRoutes.get("/copies", listCopies);
copytradeRoutes.post("/copy", validate(copySchema), followTrader);
copytradeRoutes.delete("/:id", unfollowTrader);
