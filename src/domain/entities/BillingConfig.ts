export type BillingPlanKey = 'monthly' | 'annual';

export interface BillingPlanConfig {
  key: BillingPlanKey;
  title: string;
  amountCents: number;
  premiumDays: number;
  enabled: boolean;
  checkoutUrl: string;
}

export interface BillingConfig {
  plans: BillingPlanConfig[];
  updatedAt: Date;
}

export const DEFAULT_BILLING_CONFIG: BillingConfig = {
  plans: [
    {
      key: 'monthly',
      title: 'Membresia mensual',
      amountCents: 499,
      premiumDays: 30,
      enabled: true,
      checkoutUrl: '',
    },
    {
      key: 'annual',
      title: 'Membresia anual',
      amountCents: 2500,
      premiumDays: 365,
      enabled: true,
      checkoutUrl: '',
    },
  ],
  updatedAt: new Date(0),
};
