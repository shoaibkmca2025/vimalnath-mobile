import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must start with postgres://'),
  ADMIN_ORIGIN: z.url().transform((url) => new URL(url).origin),
  TRUST_PROXY: z.stringbool().default(false),
  // Module 10: staff emails need an SMTP login, e.g. smtps://user:password@smtp.gmail.com. Without it they're logged as not set up.
  SMTP_URL: z.string().regex(/^smtps?:\/\//, 'must start with smtp:// or smtps://').optional(),
  MAIL_FROM: z.string().max(200).optional(),
  // Only if enhanced push security is switched on in the Expo dashboard.
  EXPO_ACCESS_TOKEN: z.string().max(200).optional(),
});

/** Stops the server at startup if a setting is missing or wrong. Messages never include the values. */
export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const result = Env.safeParse(env);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
  throw new Error(`The server's settings are wrong. Check .env (see .env.example):\n${problems}`);
}
