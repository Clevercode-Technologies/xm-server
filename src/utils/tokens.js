import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.jwtAccessSecret, {
    expiresIn: env.accessTokenTtl,
  });
}

export function signRefreshToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.jwtRefreshSecret, {
    expiresIn: env.refreshTokenTtl,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtAccessSecret);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwtRefreshSecret);
}

export function sign2FATempToken(userId) {
  return jwt.sign({ sub: userId, purpose: "2fa_pending" }, env.jwtAccessSecret, {
    expiresIn: env.twoFactorTempTtl,
  });
}

export function verify2FATempToken(token) {
  const payload = jwt.verify(token, env.jwtAccessSecret);
  if (payload.purpose !== "2fa_pending") {
    throw new Error("Invalid token purpose");
  }
  return payload;
}

export function signEmailVerificationToken(userId) {
  return jwt.sign({ sub: userId, purpose: "email_verify" }, env.jwtAccessSecret, {
    expiresIn: env.emailVerificationTtl,
  });
}

export function verifyEmailVerificationToken(token) {
  const payload = jwt.verify(token, env.jwtAccessSecret);
  if (payload.purpose !== "email_verify") {
    throw new Error("Invalid token purpose");
  }
  return payload;
}
