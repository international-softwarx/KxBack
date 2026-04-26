export interface SessionInfo {
  sessionId: string;
  machineId: string;
  loginAt: Date;
  lastSeenAt: Date;
  ip?: string;
}

export interface AccountDeletionRequest {
  requestId: string;
  reason: string;
  detail?: string;
  requestedAt: Date;
  dismissedAt?: Date;
}

export interface User {
  id: string;
  username: string;
  email: string;
  machineIdCreated?: string;
  passwordHash: string;
  isPremium: boolean;
  premiumExpiry?: Date;
  trialDaysLeft: number;
  trialDurationDays: number;
  trialStartedAt?: Date;
  payPhonePendingClientTransactionId?: string;
  payPhonePendingPlanKey?: 'monthly' | 'annual';
  payPhonePendingPremiumDays?: number;
  payPhonePendingCreatedAt?: Date;
  payPhoneLastTransactionId?: string;
  payPhoneLastClientTransactionId?: string;
  payPhoneLastPaymentStatus?: 'pending' | 'completed' | 'cancelled';
  payPhoneLastPaymentUpdatedAt?: Date;
  payPhonePaymentToken?: string;
  activeSessions: SessionInfo[];
  createdAt: Date;
  updatedAt: Date;
  emailVerified: boolean;
  emailVerifyToken?: string;
  passwordResetToken?: string;
  passwordResetExpiry?: Date;
  isActive: boolean;
  deactivatedAt?: Date;
  deactivatedReason?: string;
  accountDeletionRequest?: AccountDeletionRequest;
}

export interface UserPublic {
  id: string;
  username: string;
  email: string;
  machineIdCreated?: string;
  isPremium: boolean;
  premiumExpiry?: Date;
  trialDaysLeft: number;
  trialDurationDays: number;
  trialStartedAt?: Date;
  hasActivePremium: boolean;
  hasExpiredTrial: boolean;
  emailVerified: boolean;
  isActive: boolean;
  deactivatedAt?: Date;
  deactivatedReason?: string;
  accountDeletionRequest?: AccountDeletionRequest;
  createdAt: Date;
  updatedAt: Date;
  activeSessions: SessionInfo[];
}

export function toPublic(user: User): UserPublic {
  const isActivePremium = hasActivePremium(user);
  const freshTrialDaysLeft = withFreshTrialState(user);
  const hasExpiredTrial = freshTrialDaysLeft === 0 && !isActivePremium;

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    machineIdCreated: user.machineIdCreated,
    isPremium: user.isPremium,
    premiumExpiry: user.premiumExpiry,
    trialDaysLeft: Math.max(0, freshTrialDaysLeft),
    trialDurationDays: user.trialDurationDays,
    trialStartedAt: user.trialStartedAt,
    hasActivePremium: isActivePremium,
    hasExpiredTrial,
    emailVerified: user.emailVerified,
    isActive: user.isActive,
    deactivatedAt: user.deactivatedAt,
    deactivatedReason: user.deactivatedReason,
    accountDeletionRequest: user.accountDeletionRequest,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    activeSessions: user.activeSessions ?? [],
  };
}

export function hasActivePremium(user: User): boolean {
  if (!user.isPremium) {
    return false;
  }

  if (!user.premiumExpiry) {
    return true;
  }

  return new Date(user.premiumExpiry).getTime() > Date.now();
}

export function withFreshTrialState(user: {
  trialStartedAt?: Date;
  trialDurationDays: number;
  trialDaysLeft: number;
}): number {
  if (!user.trialStartedAt) {
    return user.trialDaysLeft;
  }

  const elapsedDays = Math.floor(
    (Date.now() - new Date(user.trialStartedAt).getTime()) / (1000 * 60 * 60 * 24),
  );

  return Math.max(0, user.trialDurationDays - elapsedDays);
}

export function canUseApp(user: User): boolean {
  // Siempre permite acceder a la app, incluso si el trial expiró
  // El frontend decide qué funciones bloquear según el estado premium/trial
  return true;
}
