import { env } from "../config/env.js";
import { toErrorResponse, HttpError } from "../utils/errors.js";
import * as authService from "../services/auth.service.js";
import * as twoFactorService from "../services/twoFactor.service.js";
import * as emailService from "../services/email.service.js";

function setSessionCookies(res, session) {
  const secure = env.nodeEnv === "production";
  res.cookie("accessToken", session.accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: 15 * 60 * 1000,
  });
  res.cookie("refreshToken", session.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export async function register(req, res) {
  try {
    const session = await authService.register(req.validated.body);
    setSessionCookies(res, session);
    res.status(201).json(session);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    res.status(status).json(body);
  }
}

export async function login(req, res) {
  try {
    const result = await authService.login(req.validated.body);
    if (result.requiresTwoFactor) {
      return res.status(200).json(result);
    }
    setSessionCookies(res, result);
    res.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    res.status(status).json(body);
  }
}

export async function complete2FALogin(req, res) {
  try {
    const session = await authService.loginWith2FA(req.validated.body);
    setSessionCookies(res, session);
    res.json(session);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    res.status(status).json(body);
  }
}

export async function setup2FA(req, res) {
  try {
    const result = await twoFactorService.setup2FA(req.user.id);
    res.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    res.status(status).json(body);
  }
}

export async function verify2FA(req, res) {
  try {
    await twoFactorService.enable2FA(req.user.id, req.validated.body.code);
    res.json({ ok: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    res.status(status).json(body);
  }
}

export async function disable2FA(req, res) {
  try {
    await twoFactorService.disable2FA(
      req.user.id,
      req.validated.body.code,
      req.validated.body.password,
    );
    res.json({ ok: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    res.status(status).json(body);
  }
}

export async function refresh(req, res) {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) {
      throw new HttpError(400, "MISSING_REFRESH_TOKEN", "No session to refresh. Please log in again.");
    }
    const session = await authService.refresh(token);
    setSessionCookies(res, session);
    res.json(session);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    res.status(status).json(body);
  }
}

export async function logout(_req, res) {
  res.clearCookie("accessToken");
  res.clearCookie("refreshToken");
  res.status(204).send();
}

export async function updateProfile(req, res) {
  try {
    const user = await authService.updateProfile({
      userId: req.user.id,
      name: req.validated.body.name,
    });
    res.json({ user });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    res.status(status).json(body);
  }
}

export async function changePassword(req, res) {
  try {
    await authService.changePassword({
      userId: req.user.id,
      currentPassword: req.validated.body.currentPassword,
      newPassword: req.validated.body.newPassword,
    });
    res.json({ ok: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    res.status(status).json(body);
  }
}

export function me(req, res) {
  res.json({ user: req.user });
}

export async function verifyEmail(req, res) {
  try {
    const token = req.query.token;
    if (!token) {
      throw new HttpError(400, "MISSING_TOKEN", "Verification token is required.");
    }
    const result = await emailService.verifyEmail(token);
    res.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    res.status(status).json(body);
  }
}

export async function resendVerification(req, res) {
  try {
    await emailService.resendVerification(req.user.id);
    res.json({ ok: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    res.status(status).json(body);
  }
}
