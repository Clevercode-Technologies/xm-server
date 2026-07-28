import { prisma } from "../config/prisma.js";
import { verifyAccessToken } from "../utils/tokens.js";
import { HttpError, toErrorResponse, isDbConnectionError, brief } from "../utils/errors.js";

async function loadUserById(id) {
  try {
    return await prisma.user.findUnique({ where: { id } });
  } catch (error) {
    if (isDbConnectionError(error)) {
      throw new HttpError(503, "SERVICE_UNAVAILABLE", "We couldn't reach the database. Please try again in a moment.", { detail: brief(error) });
    }
    console.error("[auth.middleware] user lookup failed:", error);
    throw new HttpError(500, "DATABASE_ERROR", "We hit a database issue while loading your session. Please try again.", { detail: brief(error) });
  }
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : req.cookies?.accessToken;
    if (!token) {
      return res.status(401).json({ error: "Authentication required. Please log in.", code: "AUTH_REQUIRED" });
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return res.status(401).json({ error: "Your session has expired. Please log in again.", code: "TOKEN_EXPIRED" });
    }

    const user = await loadUserById(payload.sub);
    if (!user || user.status !== "active") {
      return res.status(401).json({ error: "Your session is no longer valid. Please log in again.", code: "INVALID_SESSION" });
    }

    delete user.passwordHash;
    delete user.refreshTokenHash;
    req.user = user;
    next();
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    res.status(status).json(body);
  }
}

export function requireAdmin(req, res, next) {
  if (!["admin", "super_admin"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Admin access required.", code: "ADMIN_REQUIRED" });
  }
  next();
}
