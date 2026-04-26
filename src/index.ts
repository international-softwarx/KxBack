import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';

import { MongoBillingConfigRepository } from './infrastructure/database/repositories/MongoBillingConfigRepository';
import { MongoUserRepository } from './infrastructure/database/repositories/MongoUserRepository';
import {
  BcryptHashService,
  JwtTokenService,
  NodemailerEmailService,
  PayPhoneService,
} from './infrastructure/auth/services';
import { errorHandler, notFound } from './presentation/middleware/middleware';
import { buildRouter } from './presentation/routes/routes';

function readEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

const requiredEnv = [
  'MONGODB_URI',
  'JWT_SECRET',
  'ADMIN_TOKEN',
  'FRONTEND_URL',
  'BACKEND_PUBLIC_URL',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'EMAIL_FROM',
] as const;

for (const key of requiredEnv) {
  if (!process.env[key]) {
    // eslint-disable-next-line no-console
    console.error(`[KX] Missing env variable: ${key}`);
    process.exit(1);
  }
}

const payPhoneToken = readEnv('PAYPHONE_TOKEN', 'PAYPHONE_API_TOKEN', 'PAYPHONE_ACCESS_TOKEN');
const payPhoneStoreId = readEnv('PAYPHONE_STORE_ID', 'PAYPHONE_STORE', 'PAYPHONE_STOREID');
let payPhoneWebhookStoreId = readEnv(
  'PAYPHONE_WEBHOOK_STORE_ID',
  'PAYPHONE_WEBHOOK_STORE',
  'PAYPHONE_WEBHOOK_STOREID',
);
if (!payPhoneWebhookStoreId) {
  payPhoneWebhookStoreId = payPhoneStoreId;
}

if (!payPhoneToken) {
  // eslint-disable-next-line no-console
  console.error('[KX] Missing env variable: PAYPHONE_TOKEN (or PAYPHONE_API_TOKEN)');
  process.exit(1);
}

const users = new MongoUserRepository();
const billingConfig = new MongoBillingConfigRepository();
const token = new JwtTokenService(process.env.JWT_SECRET!);
const hash = new BcryptHashService(12);

const email = new NodemailerEmailService({
  host: process.env.SMTP_HOST!,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER!,
  pass: process.env.SMTP_PASS!,
  from: process.env.EMAIL_FROM!,
  frontendUrl: process.env.FRONTEND_URL!,
  backendUrl: process.env.BACKEND_PUBLIC_URL!,
});

const payPhone = new PayPhoneService({
  token: payPhoneToken,
  storeId: payPhoneStoreId,
  linksUrl: process.env.PAYPHONE_LINKS_URL ?? 'https://pay.payphonetodoesposible.com/api/Links',
  currency: process.env.PAYPHONE_CURRENCY ?? 'USD',
  oneTime: process.env.PAYPHONE_ONE_TIME !== 'false',
  expireInHours: Number(process.env.PAYPHONE_EXPIRE_IN_HOURS ?? 0),
  webhookStoreId: payPhoneWebhookStoreId || payPhoneStoreId,
  salesByClientUrl: process.env.PAYPHONE_SALES_BY_CLIENT_URL ?? 'https://pay.payphonetodoesposible.com/api/Sale/client',
  notifyUrl: `${process.env.BACKEND_PUBLIC_URL}/api/webhooks/payphone`,
});
const app = express();

const allowedOrigins = [
  process.env.FRONTEND_URL!,
  ...String(process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  'http://localhost:3000',
  'http://localhost:5173',
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('CORS blocked'));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: '1mb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Demasiados intentos. Espera 15 minutos.',
  },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.',
  },
});

app.use('/api', generalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

const router = buildRouter({
  users,
  token,
  hash,
  email,
  payPhone,
  billingConfig,
  adminToken: process.env.ADMIN_TOKEN!,
  frontendUrl: process.env.FRONTEND_URL!,
});
const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiados intentos de pago. Espera un minuto.' },
});

app.use('/api/billing/checkout', checkoutLimiter);
app.use('/api/billing/renew', checkoutLimiter);

app.use('/api', router);

app.use(notFound);
app.use(errorHandler);

const PORT = Number(process.env.PORT ?? 4000);

async function bootstrap() {
  await mongoose.connect(process.env.MONGODB_URI!);
  // eslint-disable-next-line no-console
  console.log('[KX] MongoDB connected');

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[KX] Backend running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[KX] Failed to start backend', error);
  process.exit(1);
});

export default app;
