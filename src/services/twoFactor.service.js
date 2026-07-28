import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import argon2 from "argon2";
import { prisma } from "../config/prisma.js";
import { HttpError, isDbConnectionError, brief } from "../utils/errors.js";

const ISSUER = "XM-Exchange";

async function withDb(label, fn) {
  try {
    return await fn();
  } catch (error) {
    if (isDbConnectionError(error)) {
      throw new HttpError(503, "SERVICE_UNAVAILABLE", "We couldn't reach the database. Please try again in a moment.", { detail: brief(error) });
    }
    console.error(`[twoFactor.service] Prisma error during ${label}:`, error);
    throw new HttpError(500, "DATABASE_ERROR", `Database issue during ${label}.`, { detail: brief(error) });
  }
}

export async function setup2FA(userId) {
  const user = await withDb("loading account for 2FA setup", () =>
    prisma.user.findUnique({ where: { id: userId } })
  );

  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "Account not found.");
  }

  if (user.twoFactorEnabled) {
    throw new HttpError(409, "TWO_FACTOR_ALREADY_ENABLED", "Two-factor authentication is already enabled. Disable it first to reconfigure.");
  }

  const secret = generateSecret();
  const otpauthUrl = generateURI({ label: user.email, issuer: ISSUER, secret });

  await withDb("storing 2FA secret", () =>
    prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret },
    })
  );

  let qrDataUrl;
  try {
    qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 256, margin: 1 });
  } catch (error) {
    console.error("[twoFactor.service] QR generation failed:", error);
    throw new HttpError(500, "QR_GENERATION_FAILED", "Failed to generate QR code. Please try again.");
  }

  return { secret, otpauthUrl, qrDataUrl };
}

export async function enable2FA(userId, code) {
  const user = await withDb("loading account for 2FA enable", () =>
    prisma.user.findUnique({ where: { id: userId } })
  );

  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "Account not found.");
  }

  if (!user.twoFactorSecret) {
    throw new HttpError(400, "TWO_FACTOR_NOT_SETUP", "Please set up 2FA first before verifying.");
  }

  if (user.twoFactorEnabled) {
    throw new HttpError(409, "TWO_FACTOR_ALREADY_ENABLED", "Two-factor authentication is already enabled.");
  }

  let result;
  try {
    result = verifySync({ token: code, secret: user.twoFactorSecret });
  } catch {
    throw new HttpError(400, "INVALID_CODE", "Invalid verification code. Please try again.");
  }

  if (!result?.valid) {
    throw new HttpError(400, "INVALID_CODE", "Invalid verification code. Please try again.");
  }

  await withDb("enabling 2FA", () =>
    prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    })
  );

  return true;
}

export async function disable2FA(userId, code, password) {
  const user = await withDb("loading account for 2FA disable", () =>
    prisma.user.findUnique({ where: { id: userId } })
  );

  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "Account not found.");
  }

  if (!user.twoFactorEnabled) {
    throw new HttpError(400, "TWO_FACTOR_NOT_ENABLED", "Two-factor authentication is not enabled.");
  }

  let result;
  try {
    result = verifySync({ token: code, secret: user.twoFactorSecret });
  } catch {
    throw new HttpError(400, "INVALID_CODE", "Invalid verification code.");
  }

  if (!result?.valid) {
    throw new HttpError(400, "INVALID_CODE", "Invalid verification code.");
  }

  let passwordValid = false;
  try {
    passwordValid = await argon2.verify(user.passwordHash, password);
  } catch {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Password is incorrect.");
  }

  if (!passwordValid) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Password is incorrect.");
  }

  await withDb("disabling 2FA", () =>
    prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    })
  );

  return true;
}

export function verify2FACode(secret, code) {
  if (!secret) return false;
  try {
    return verifySync({ token: code, secret })?.valid === true;
  } catch {
    return false;
  }
}
