import mongoose, { Document, Schema } from 'mongoose';

type BillingPlanKey = 'monthly' | 'annual';

export interface BillingPlanDocument {
  key: BillingPlanKey;
  title: string;
  amountCents: number;
  premiumDays: number;
  enabled: boolean;
  checkoutUrl: string;
}

export interface BillingConfigDocument extends Document {
  singletonKey: string;
  plans: BillingPlanDocument[];
  updatedAt: Date;
}

const BillingPlanSchema = new Schema<BillingPlanDocument>(
  {
    key: { type: String, required: true, enum: ['monthly', 'annual'] },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    amountCents: { type: Number, required: true, min: 1 },
    premiumDays: { type: Number, required: true, min: 1, max: 3650 },
    enabled: { type: Boolean, default: true },
    checkoutUrl: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { _id: false },
);

const BillingConfigSchema = new Schema<BillingConfigDocument>(
  {
    singletonKey: { type: String, required: true, unique: true, default: 'default' },
    plans: { type: [BillingPlanSchema], required: true, default: [] },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
  },
);

export const BillingConfigModel = mongoose.model<BillingConfigDocument>(
  'BillingConfig',
  BillingConfigSchema,
);
