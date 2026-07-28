import nodemailer from "nodemailer";
import { env } from "./env.js";

let transporter = null;

export function getMailer() {
  if (transporter) return transporter;

  if (!env.smtpHost) {
    transporter = {
      sendMail: async (opts) => {
        console.log("[email:dev] To:", opts.to);
        console.log("[email:dev] Subject:", opts.subject);
        console.log("[email:dev] Text:", opts.text?.slice(0, 200));
        return { messageId: "dev-" + Date.now() };
      },
    };
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
  });

  return transporter;
}
