import cookieParser from "cookie-parser";
import { verifyAccessToken } from "../utils/tokens.js";
import { onClientJoinMarket, onClientLeaveMarket } from "../services/marketStream.service.js";

const cookieSecret = process.env.COOKIE_SECRET || "dev-cookie-secret-change-me";

function parseCookieHeader(header) {
  if (!header) return {};
  const fakeReq = { headers: { cookie: header } };
  const result = {};
  try {
    cookieParser(cookieSecret)(fakeReq, {}, () => {
      Object.assign(result, fakeReq.cookies || {});
    });
  } catch {
    // ignore parse errors
  }
  return result;
}

export function registerSockets(io) {
  io.use((socket, next) => {
    let token = socket.handshake.auth?.token;
    if (!token) {
      const cookies = parseCookieHeader(socket.handshake.headers?.cookie);
      token = cookies.accessToken;
    }
    if (!token) return next();
    try {
      socket.user = verifyAccessToken(token);
      next();
    } catch {
      next(new Error("Invalid socket token"));
    }
  });

  io.on("connection", (socket) => {
    if (socket.user?.sub) socket.join(`user:${socket.user.sub}`);
    socket.data.markets = new Set();

    socket.on("join_market", (symbol) => {
      const sym = String(symbol).toUpperCase();
      socket.join(`market:${sym}`);
      socket.data.markets.add(sym);
      onClientJoinMarket(sym);
    });

    socket.on("leave_market", (symbol) => {
      const sym = String(symbol).toUpperCase();
      socket.leave(`market:${sym}`);
      socket.data.markets.delete(sym);
      onClientLeaveMarket(sym);
    });

    socket.on("disconnect", () => {
      for (const sym of socket.data.markets) {
        onClientLeaveMarket(sym);
      }
    });
  });
}
