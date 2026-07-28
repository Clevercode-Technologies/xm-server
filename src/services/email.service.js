import { prisma } from "../config/prisma.js";
import { getMailer } from "../config/email.js";
import { env } from "../config/env.js";
import { signEmailVerificationToken, verifyEmailVerificationToken } from "../utils/tokens.js";
import { HttpError, brief } from "../utils/errors.js";

export async function sendVerificationEmail(user) {
  const token = signEmailVerificationToken(user.id);
  const verifyUrl = `${env.frontendUrl}/verify-email?token=${token}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h1 style="color: #0ea5e9; margin-bottom: 24px;">XM Exchange</h1>
      <h2 style="color: #1e293b; margin-bottom: 16px;">Verify your email address</h2>
      <p style="color: #475569; line-height: 1.6;">
        Welcome to XM Exchange! Click the button below to verify your email address and activate your account.
      </p>
      <a href="${verifyUrl}" style="display: inline-block; background: #0ea5e9; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; margin: 24px 0;">
        Verify Email
      </a>
      <p style="color: #94a3b8; font-size: 13px; margin-top: 24px;">
        Or paste this link into your browser:<br>
        <span style="word-break: break-all; color: #0ea5e9;">${verifyUrl}</span>
      </p>
      <p style="color: #94a3b8; font-size: 13px; margin-top: 24px;">
        This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
      </p>
    </div>
  `;

  const text = `XM Exchange — Verify your email\n\nVisit this link to verify your email: ${verifyUrl}\n\nThis link expires in 24 hours.`;

  const mailer = getMailer();
  try {
    await mailer.sendMail({
      from: env.smtpFrom,
      to: user.email,
      subject: "Verify your email — XM Exchange",
      text,
      html,
    });
    console.log(`[email.service] Verification email sent to ${user.email}`);
  } catch (error) {
    console.error("[email.service] sendMail failed:", brief(error));
  }
}

export async function verifyEmail(token) {
  let payload;
  try {
    payload = verifyEmailVerificationToken(token);
  } catch {
    throw new HttpError(400, "INVALID_TOKEN", "This verification link is invalid or has expired. Please request a new one.");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "Account not found.");
  }

  if (user.emailVerified) {
    return { alreadyVerified: true };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true },
  });

  return { verified: true };
}

export async function resendVerification(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "Account not found.");
  }
  if (user.emailVerified) {
    throw new HttpError(400, "ALREADY_VERIFIED", "Your email is already verified.");
  }
  await sendVerificationEmail(user);
  return { sent: true };
}
