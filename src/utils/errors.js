/**
 * Typed HTTP errors so services can express intended status codes/messages
 * and the controller layer can reliably tell operational errors apart from
 * unexpected ones.
 */
export class HttpError extends Error {
  constructor(status, code, message, { detail } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.isOperational = true;
  }
}

const PRISMA_CONNECTION_CODES = new Set([
  "P1001", // Can't reach database server
  "P1002", // Database timeout
  "P1003", // Database does not exist
  "P1008", // Operations timed out
  "P1017", // Server closed the connection
]);

/**
 * Detects errors that mean the database (or network) is unavailable.
 * Covers MongoDB "Server selection timeout" and Prisma connection codes.
 */
export function isDbConnectionError(error) {
  if (!error) return false;
  if (PRISMA_CONNECTION_CODES.has(error.code)) return true;
  const msg = String(error.message || "");
  if (/server selection timeout/i.test(msg)) return true;
  if (/no available servers/i.test(msg)) return true;
  if (/topology.*destroyed/i.test(msg)) return true;
  if (/timed out/i.test(msg) && /mongodb|prisma|database/i.test(msg)) return true;
  return false;
}

/**
 * Reduces an unknown error into a single short string suitable for clients.
 * Never exposes secrets, file paths or stack traces.
 */
export function brief(error) {
  if (!error) return "Unknown error";
  if (error instanceof HttpError) return error.message;
  const code = error.code ? `[${error.code}] ` : "";
  const msg = String(error.message || error.name || "Unexpected error");
  // Strip noisy multi-line noise (e.g. full topology dumps) to the first sentence.
  const firstLine = msg.split("\n")[0].trim();
  const trimmed = firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
  return `${code}${trimmed}`;
}

/**
 * Maps any thrown value to a { status, body } tuple ready to send to a client.
 * - HttpError: returns its status/message; surfaces `detail` only for 5xx.
 * - DB connection errors: 503 with a friendly message.
 * - Everything else: 500 with a generic message + brief detail.
 */
export function toErrorResponse(error) {
  if (error instanceof HttpError) {
    const body = { error: error.message };
    if (error.code) body.code = error.code;
    if (error.status >= 500 && error.detail) body.detail = error.detail;
    if (error.status >= 500) console.error(`[error] ${error.code || "HTTP"} ${error.status}:`, error.original || error);
    return { status: error.status, body };
  }

  if (isDbConnectionError(error)) {
    console.error("[error] Database connection failure:", error);
    return {
      status: 503,
      body: {
        error: "We couldn't reach the database. Please try again in a moment.",
        code: "SERVICE_UNAVAILABLE",
        detail: brief(error),
      },
    };
  }

  console.error("[error] Unexpected error:", error);
  return {
    status: 500,
    body: {
      error: "Something went wrong on our end. Please try again later.",
      code: "INTERNAL_ERROR",
      detail: brief(error),
    },
  };
}
