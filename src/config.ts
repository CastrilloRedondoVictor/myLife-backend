import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('localhost'),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  TENANT_DATA_READY: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  OIDC_REDIRECT_URI: z.string().url().default('http://localhost:4000/api/auth/google/callback'),
});

export const config = envSchema.parse(process.env);
