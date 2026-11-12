import { z } from 'zod';
import { validateEmail, validateName, validatePassword, validatePhone } from './validation';

const email = z.string().superRefine((v, ctx) => {
  const r = validateEmail(v);
  if (!r.ok) ctx.addIssue({ code: 'custom', message: r.error });
});
const phone = z.string().superRefine((v, ctx) => {
  const r = validatePhone(v);
  if (!r.ok) ctx.addIssue({ code: 'custom', message: r.error });
});
const name = z.string().superRefine((v, ctx) => {
  const r = validateName(v);
  if (!r.ok) ctx.addIssue({ code: 'custom', message: r.error });
});
const password = z.string().superRefine((v, ctx) => {
  const r = validatePassword(v);
  if (!r.ok) ctx.addIssue({ code: 'custom', message: r.error });
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
});
export type LoginForm = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    name,
    email,
    phone,
    password,
    role: z.enum(['student', 'officer']),
    inviteCode: z.string().max(100),
    acceptTerms: z.boolean().refine((v) => v === true, { message: 'You must agree to the Terms and Privacy Policy to create an account' }),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'officer' && v.inviteCode.trim().length === 0) {
      ctx.addIssue({ code: 'custom', path: ['inviteCode'], message: 'Enter the invite code from your placement office' });
    }
  });
export type RegisterForm = z.infer<typeof registerSchema>;
