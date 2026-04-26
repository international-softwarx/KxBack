import {
  BillingConfig,
  BillingPlanConfig,
  BillingPlanKey,
  DEFAULT_BILLING_CONFIG,
} from '../../../domain/entities/BillingConfig';
import { IBillingConfigRepository } from '../../../domain/ports/ports';
import { BillingConfigModel } from '../models/BillingConfigModel';

const PLAN_KEYS: BillingPlanKey[] = ['monthly', 'annual'];

function isBillingPlanKey(value: unknown): value is BillingPlanKey {
  return value === 'monthly' || value === 'annual';
}

function normalizeText(value: unknown, fallback: string): string {
  const clean = String(value ?? '')
    .trim()
    .slice(0, 80);
  return clean || fallback;
}

function normalizeCheckoutUrl(value: unknown, fallback = ''): string {
  const clean = String(value ?? '')
    .trim()
    .slice(0, 500);

  if (!clean) {
    return '';
  }

  const lower = clean.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return clean;
  }

  return fallback || '';
}

function normalizeAmount(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(1_000_000_00, Math.trunc(parsed)));
}

function normalizePremiumDays(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(3650, Math.trunc(parsed)));
}

function readPositiveIntEnv(keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = process.env[key];
    if (!value) {
      continue;
    }

    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
  }

  return fallback;
}

function getSeedPlansFromEnv(): BillingPlanConfig[] {
  const monthlyDefaults = DEFAULT_BILLING_CONFIG.plans.find((plan) => plan.key === 'monthly')!;
  const annualDefaults = DEFAULT_BILLING_CONFIG.plans.find((plan) => plan.key === 'annual')!;

  const monthlyAmountCents = readPositiveIntEnv(
    ['PAYPHONE_PLAN_AMOUNT_CENTS', 'PAYPHONE_MONTHLY_PLAN_AMOUNT_CENTS'],
    monthlyDefaults.amountCents,
  );
  const monthlyPremiumDays = readPositiveIntEnv(
    ['PAYPHONE_PREMIUM_DAYS', 'PAYPHONE_MONTHLY_PREMIUM_DAYS'],
    monthlyDefaults.premiumDays,
  );
  const annualAmountCents = readPositiveIntEnv(
    ['PAYPHONE_ANNUAL_PLAN_AMOUNT_CENTS'],
    annualDefaults.amountCents,
  );
  const annualPremiumDays = readPositiveIntEnv(
    ['PAYPHONE_ANNUAL_PREMIUM_DAYS'],
    annualDefaults.premiumDays,
  );

  return normalizePlans([
    {
      ...monthlyDefaults,
      amountCents: monthlyAmountCents,
      premiumDays: monthlyPremiumDays,
    },
    {
      ...annualDefaults,
      amountCents: annualAmountCents,
      premiumDays: annualPremiumDays,
    },
  ]);
}

function normalizePlans(inputPlans: unknown): BillingPlanConfig[] {
  const defaultsByKey = new Map<BillingPlanKey, BillingPlanConfig>(
    DEFAULT_BILLING_CONFIG.plans.map((plan) => [plan.key, plan]),
  );

  const providedByKey = new Map<BillingPlanKey, Partial<BillingPlanConfig>>();
  if (Array.isArray(inputPlans)) {
    for (const rawPlan of inputPlans) {
      if (!rawPlan || typeof rawPlan !== 'object') {
        continue;
      }

      const record = rawPlan as Record<string, unknown>;
      if (!isBillingPlanKey(record.key)) {
        continue;
      }

      providedByKey.set(record.key, {
        key: record.key,
        title: typeof record.title === 'string' ? record.title : undefined,
        amountCents: typeof record.amountCents === 'number' ? record.amountCents : undefined,
        premiumDays: typeof record.premiumDays === 'number' ? record.premiumDays : undefined,
        enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined,
        checkoutUrl: typeof record.checkoutUrl === 'string' ? record.checkoutUrl : undefined,
      });
    }
  }

  return PLAN_KEYS.map((key) => {
    const defaults = defaultsByKey.get(key)!;
    const provided = providedByKey.get(key) ?? {};
    return {
      key,
      title: normalizeText(provided.title, defaults.title),
      amountCents: normalizeAmount(provided.amountCents, defaults.amountCents),
      premiumDays: normalizePremiumDays(provided.premiumDays, defaults.premiumDays),
      enabled: typeof provided.enabled === 'boolean' ? provided.enabled : defaults.enabled,
      checkoutUrl: normalizeCheckoutUrl(provided.checkoutUrl, defaults.checkoutUrl),
    };
  });
}

function toEntity(doc: any): BillingConfig {
  return {
    plans: normalizePlans(doc?.plans),
    updatedAt: doc?.updatedAt ? new Date(doc.updatedAt) : new Date(),
  };
}

export class MongoBillingConfigRepository implements IBillingConfigRepository {
  async get(): Promise<BillingConfig> {
    const existing = await BillingConfigModel.findOne({ singletonKey: 'default' }).lean();
    if (!existing) {
      const plans = getSeedPlansFromEnv();
      const created = await BillingConfigModel.create({
        singletonKey: 'default',
        plans,
        updatedAt: new Date(),
      });

      return toEntity(created.toObject());
    }

    return toEntity(existing);
  }

  async save(config: BillingConfig): Promise<BillingConfig> {
    const plans = normalizePlans(config.plans);
    const updated = await BillingConfigModel.findOneAndUpdate(
      { singletonKey: 'default' },
      {
        $set: {
          plans,
          updatedAt: new Date(),
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    ).lean();

    return toEntity(updated);
  }
}
