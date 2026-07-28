import argon2 from "argon2";
import crypto from "crypto";
import { prisma } from "../config/prisma.js";
import { ensureWallets } from "./wallet.service.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken, sign2FATempToken, verify2FATempToken } from "../utils/tokens.js";
import { verify2FACode } from "./twoFactor.service.js";
import { sendVerificationEmail } from "./email.service.js";
import { HttpError, isDbConnectionError, brief } from "../utils/errors.js";

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerified,
    twoFactorEnabled: user.twoFactorEnabled ?? false,
    createdAt: user.createdAt ?? null,
  };
}

/**
 * Wraps any Prisma operation and converts DB-level failures (timeouts,
 * topology drops, connection errors) into a 503 the controller can surface.
 */
async function withDb(label, fn) {
  try {
    return await fn();
  } catch (error) {
    if (isDbConnectionError(error)) {
      throw new HttpError(503, "SERVICE_UNAVAILABLE", "We couldn't reach the database. Please try again in a moment.", { detail: brief(error) });
    }
    // Duplicate key (e.g. email unique violation) -> map to friendly 409.
    if (error?.code === "P2002" || /duplicate key/i.test(String(error?.message || ""))) {
      throw new HttpError(409, "EMAIL_EXISTS", "An account with this email already exists. Try logging in instead.");
    }
    // Anything else from Prisma we didn't expect: 500 with detail.
    if (error?.clientVersion || error instanceof Error) {
      console.error(`[auth.service] Prisma error during ${label}:`, error);
      throw new HttpError(500, "DATABASE_ERROR", `We hit a database issue while ${label}. Please try again.`, { detail: brief(error) });
    }
    throw error;
  }
}

export async function register({ email, password, name }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const trimmedName = String(name || "").trim();

  const existing = await withDb("checking existing account", () =>
    prisma.user.findUnique({ where: { email: normalizedEmail } })
  );
  if (existing) {
    throw new HttpError(409, "EMAIL_EXISTS", "An account with this email already exists. Try logging in instead.");
  }

  let passwordHash;
  try {
    passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  } catch (error) {
    console.error("[auth.service] argon2.hash failed:", error);
    throw new HttpError(500, "PASSWORD_HASH_FAILED", "We couldn't secure your password. Please try again.", { detail: brief(error) });
  }

  const user = await withDb("creating account", () =>
    prisma.user.create({
      data: { email: normalizedEmail, passwordHash, name: trimmedName },
    })
  );

  try {
    await ensureWallets(user.id);
  } catch (error) {
    console.error("[auth.service] ensureWallets failed for user", user.id, error);
    throw new HttpError(500, "WALLET_SETUP_FAILED", "Your account was created but we couldn't provision your wallets. Please contact support.", { detail: brief(error) });
  }

  sendVerificationEmail(user).catch((error) => {
    console.error("[auth.service] sendVerificationEmail failed:", error);
  });

  return issueSession(user);
}

export async function login({ email, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  const user = await withDb("looking up account", () =>
    prisma.user.findUnique({ where: { email: normalizedEmail } })
  );

  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "No account exists for this email. Please sign up first.");
  }

  let passwordValid = false;
  try {
    passwordValid = await argon2.verify(user.passwordHash, password);
  } catch (error) {
    console.error("[auth.service] argon2.verify failed for user", user.id, error);
    throw new HttpError(401, "INVALID_CREDENTIALS", "Incorrect password. Please try again.");
  }

  if (!passwordValid) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Incorrect password. Please try again.");
  }

  if (user.status !== "active") {
    throw new HttpError(403, "ACCOUNT_INACTIVE", "Your account is not active. Please contact support.");
  }

  if (user.twoFactorEnabled && user.twoFactorSecret) {
    const tempToken = sign2FATempToken(user.id);
    return { requiresTwoFactor: true, tempToken };
  }

  await withDb("updating last login", () =>
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  ).catch((error) => {
    console.error("[auth.service] lastLoginAt update failed:", error);
  });

  return issueSession(user);
}

export async function loginWith2FA({ tempToken, code }) {
  let payload;
  try {
    payload = verify2FATempToken(tempToken);
  } catch {
    throw new HttpError(401, "INVALID_2FA_TOKEN", "Your 2FA session has expired. Please log in again.");
  }

  const user = await withDb("loading account for 2FA login", () =>
    prisma.user.findUnique({ where: { id: payload.sub } })
  );

  if (!user || user.status !== "active") {
    throw new HttpError(401, "INVALID_2FA_TOKEN", "Your session is no longer valid. Please log in again.");
  }

  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    throw new HttpError(400, "TWO_FACTOR_NOT_ENABLED", "Two-factor authentication is not enabled for this account.");
  }

  if (!verify2FACode(user.twoFactorSecret, code)) {
    throw new HttpError(401, "INVALID_CODE", "Invalid verification code. Please try again.");
  }

  await withDb("updating last login", () =>
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  ).catch((error) => {
    console.error("[auth.service] lastLoginAt update failed:", error);
  });

  return issueSession(user);
}

export async function issueSession(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  const refreshTokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  await withDb("storing refresh token", () =>
    prisma.user.update({ where: { id: user.id }, data: { refreshTokenHash } })
  );
  return { user: publicUser(user), accessToken, refreshToken };
}

export async function updateProfile({ userId, name }) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) {
    throw new HttpError(400, "INVALID_NAME", "Name cannot be empty.");
  }

  const user = await withDb("updating profile", () =>
    prisma.user.update({
      where: { id: userId },
      data: { name: trimmedName },
    })
  );

  return publicUser(user);
}

export async function changePassword({ userId, currentPassword, newPassword }) {
  const user = await withDb("loading account for password change", () =>
    prisma.user.findUnique({ where: { id: userId } })
  );

  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "Account not found.");
  }

  let passwordValid = false;
  try {
    passwordValid = await argon2.verify(user.passwordHash, currentPassword);
  } catch {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Current password is incorrect.");
  }

  if (!passwordValid) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Current password is incorrect.");
  }

  let passwordHash;
  try {
    passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  } catch {
    throw new HttpError(500, "PASSWORD_HASH_FAILED", "We couldn't secure your password. Please try again.");
  }

  await withDb("updating password", () =>
    prisma.user.update({ where: { id: userId }, data: { passwordHash } })
  );

  return true;
}

export async function refresh(refreshToken) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (error) {
    throw new HttpError(401, "INVALID_REFRESH_TOKEN", "Your session has expired. Please log in again.");
  }

  const user = await withDb("loading account for refresh", () =>
    prisma.user.findUnique({ where: { id: payload.sub } })
  );

  if (!user) {
    throw new HttpError(401, "INVALID_REFRESH_TOKEN", "Your session is no longer valid. Please log in again.");
  }

  const hash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  if (!user.refreshTokenHash || user.refreshTokenHash !== hash) {
    throw new HttpError(401, "INVALID_REFRESH_TOKEN", "Your session is no longer valid. Please log in again.");
  }

  if (user.status !== "active") {
    throw new HttpError(403, "ACCOUNT_INACTIVE", "Your account is not active. Please contact support.");
  }

  return issueSession(user);
}
