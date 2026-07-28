import { z } from "zod";

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1).max(80),
  }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(80),
  }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

export const verify2FASchema = z.object({
  body: z.object({
    code: z.string().min(6).max(6),
  }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

export const disable2FASchema = z.object({
  body: z.object({
    code: z.string().min(6).max(6),
    password: z.string().min(1),
  }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

export const login2FASchema = z.object({
  body: z.object({
    tempToken: z.string().min(1),
    code: z.string().min(6).max(6),
  }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

export const setup2FASchema = z.object({
  body: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});
