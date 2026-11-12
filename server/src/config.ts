import 'dotenv/config';

export const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';

const isProd = process.env.NODE_ENV === 'production';

export interface Config {
  env: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  officerInviteCode: string;
  corsOrigins: string[];
  bcryptRounds: number;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  expoPushUrl: string;
  schedulerIntervalMs: number;
}

export function loadConfig(): Config {
  const jwtSecret = process.env.JWT_SECRET || (isProd ? '' : 'dev-only-secret-change-me-dev-only-secret');
  if (!jwtSecret || jwtSecret.length < 24) {
    throw new Error('JWT_SECRET must be set (min 24 chars)');
  }
  const officerInviteCode = process.env.OFFICER_INVITE_CODE || '';
  if (isProd && !officerInviteCode) {
    throw new Error('OFFICER_INVITE_CODE must be set in production');
  }
  return {
    env: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT || 4000),
    databaseUrl: process.env.DATABASE_URL || 'postgres://localhost:5432/placement_os',
    jwtSecret,
    officerInviteCode,
    corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),
    accessTtlSeconds: 15 * 60,
    refreshTtlDays: 30,
    expoPushUrl: 'https://exp.host/--/api/v2/push/send',
    schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS || 30000),
  };
}
