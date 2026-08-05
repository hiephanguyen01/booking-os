import { z } from "zod";

export const forgotPasswordFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, { error: "REQUIRED" })
    .toLowerCase()
    .email({ error: "INVALID_EMAIL" }),
});

export const passwordCommandFormSchema = z
  .object({
    newPassword: z.string().min(12, { error: "PASSWORD_TOO_SHORT" }),
    confirmation: z.string().min(1, { error: "REQUIRED" }),
  })
  .refine((value) => value.newPassword === value.confirmation, {
    path: ["confirmation"],
    error: "PASSWORD_CONFIRMATION_MISMATCH",
  });

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordFormSchema>;
export type PasswordCommandFormValues = z.infer<typeof passwordCommandFormSchema>;
