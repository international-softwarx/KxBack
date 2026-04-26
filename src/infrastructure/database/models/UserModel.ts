import mongoose, { Document, Schema } from 'mongoose';
import { User } from '../../../domain/entities/User';

export interface UserDocument extends Omit<User, 'id'>, Document {}

const SessionSchema = new Schema(
  {
    sessionId: { type: String, required: true },
    machineId: { type: String, required: true },
    loginAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    ip: { type: String, default: '' },
  },
  { _id: false },
);

const AccountDeletionRequestSchema = new Schema(
  {
    requestId: { type: String, required: true },
    reason: { type: String, required: true },
    detail: { type: String },
    requestedAt: { type: Date, required: true },
    dismissedAt: { type: Date },
  },
  { _id: false },
);

const UserSchema = new Schema<UserDocument>(
  {
    username: { type: String, required: true, trim: true, minlength: 3, maxlength: 30 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    machineIdCreated: { type: String, index: true },
    passwordHash: { type: String, required: true },
    isPremium: { type: Boolean, default: false },
    premiumExpiry: { type: Date },
    trialDaysLeft: { type: Number, default: 7 },
    trialDurationDays: { type: Number, default: 7 },
    trialStartedAt: { type: Date },
    payPhonePendingClientTransactionId: { type: String },
    payPhonePendingPlanKey: { type: String, enum: ['monthly', 'annual'] },
    payPhonePendingPremiumDays: { type: Number },
    payPhonePendingCreatedAt: { type: Date },
    payPhoneLastTransactionId: { type: String },
    payPhoneLastClientTransactionId: { type: String },
    payPhoneLastPaymentStatus: { type: String, enum: ['pending', 'completed', 'cancelled'] },
    payPhoneLastPaymentUpdatedAt: { type: Date },
    payPhonePaymentToken: { type: String },
    activeSessions: { type: [SessionSchema], default: [] },
    emailVerified: { type: Boolean, default: false },
    emailVerifyToken: { type: String },
    passwordResetToken: { type: String },
    passwordResetExpiry: { type: Date },
    isActive: { type: Boolean, default: true },
    deactivatedAt: { type: Date },
    deactivatedReason: { type: String },
    accountDeletionRequest: { type: AccountDeletionRequestSchema },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_, ret) => {
        const mutable = ret as any;
        mutable.id = mutable._id.toString();
        delete mutable._id;
        delete mutable.__v;
        delete mutable.passwordHash;
        delete mutable.emailVerifyToken;
        delete mutable.passwordResetToken;
        return mutable;
      },
    },
  },
);

UserSchema.index({ payPhonePendingClientTransactionId: 1 });
UserSchema.index({ emailVerifyToken: 1 });
UserSchema.index({ passwordResetToken: 1 });
UserSchema.index({ isActive: 1, createdAt: -1 });
UserSchema.index({ 'accountDeletionRequest.requestedAt': -1 });
UserSchema.index({ machineIdCreated: 1, isActive: 1 });

export const UserModel = mongoose.model<UserDocument>('User', UserSchema);
