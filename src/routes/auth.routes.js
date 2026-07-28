import { Router } from "express";
import {
  changePassword, complete2FALogin, disable2FA, login, logout, me,
  refresh, register, resendVerification, setup2FA, updateProfile, verify2FA,
  verifyEmail,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  changePasswordSchema, disable2FASchema, login2FASchema, loginSchema,
  registerSchema, setup2FASchema, updateProfileSchema, verify2FASchema,
} from "../validators/auth.validator.js";

export const authRoutes = Router();

authRoutes.post("/register", validate(registerSchema), register);
authRoutes.post("/login", validate(loginSchema), login);
authRoutes.post("/2fa/login", validate(login2FASchema), complete2FALogin);
authRoutes.post("/refresh", refresh);
authRoutes.post("/logout", logout);
authRoutes.get("/me", requireAuth, me);
authRoutes.patch("/me", requireAuth, validate(updateProfileSchema), updateProfile);
authRoutes.post("/change-password", requireAuth, validate(changePasswordSchema), changePassword);
authRoutes.post("/2fa/setup", requireAuth, setup2FA);
authRoutes.post("/2fa/verify", requireAuth, validate(verify2FASchema), verify2FA);
authRoutes.post("/2fa/disable", requireAuth, validate(disable2FASchema), disable2FA);
authRoutes.get("/verify-email", verifyEmail);
authRoutes.post("/resend-verification", requireAuth, resendVerification);
