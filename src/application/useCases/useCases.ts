import { v4 as uuid } from 'uuid';
import { UserPublic, toPublic } from '../../domain/entities/User';
import { BillingPlanConfig, BillingPlanKey } from '../../domain/entities/BillingConfig';
import {
  IBillingConfigRepository,
  IEmailService,
  IHashService,
  IPayPhoneService,
  ITokenService,
  IUserRepository,
} from '../../domain/ports/ports';

export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: number };

const ok = <T>(data: T): Result<T> => ({ success: true, data });
const fail = (error: string, code = 400): Result<never> => ({ success: false, error, code });

const DAY_MS = 24 * 60 * 60 * 1000;

const ACCOUNT_DELETION_REASONS = [
  'No uso la app',
  'Muy costoso',
  'Problemas tecnicos',
  'Privacidad o seguridad',
  'Tengo otra herramienta',
  'Otro',
] as const;

type AccountDeletionReason = (typeof ACCOUNT_DELETION_REASONS)[number];

// ── Helpers ────────────────────────────────────────────────────────────────

const cleanEmail = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase();

const cleanStr = (value: unknown): string =>
  String(value ?? '').trim();

function isValidEmail(email: string): boolean {
  return Boolean(email) && email.includes('@');
}

function isValidPassword(password: string): boolean {
  return password.length >= 8;
}

function withFreshTrialState(user: {
  trialStartedAt?: Date;
  trialDurationDays: number;
  trialDaysLeft: number;
}): number {
  if (!user.trialStartedAt) return user.trialDaysLeft;
  const elapsedDays = Math.floor(
    (Date.now() - new Date(user.trialStartedAt).getTime()) / (1000 * 60 * 60 * 24),
  );
  return Math.max(0, user.trialDurationDays - elapsedDays);
}

function extendPremiumExpiry(user: { isPremium: boolean; premiumExpiry?: Date }, daysToAdd: number): Date | null {
  if (!user.isPremium || !user.premiumExpiry) return null;
  const currentExpiry = new Date(user.premiumExpiry).getTime();
  if (currentExpiry <= Date.now()) return null;
  return new Date(currentExpiry + daysToAdd * DAY_MS);
}

function normalizeBillingPlanKey(value: unknown): BillingPlanKey | null {
  const normalized = cleanStr(value).toLowerCase();
  if (normalized === 'monthly' || normalized === 'mensual') return 'monthly';
  if (normalized === 'annual' || normalized === 'yearly' || normalized === 'anual') return 'annual';
  return null;
}

function findPlanByKey(plans: BillingPlanConfig[], key: BillingPlanKey): BillingPlanConfig | null {
  return plans.find((p) => p.key === key) ?? null;
}

function normalizeCheckoutUrl(value: unknown, fallback = ''): string {
  const clean = String(value ?? '').trim().slice(0, 500);
  if (!clean) return '';
  const lower = clean.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return clean;
  return fallback || '';
}

// ── Use Cases ──────────────────────────────────────────────────────────────

export class RegisterUseCase {
  constructor(
    private users: IUserRepository,
    private hash: IHashService,
    private token: ITokenService,
    private email: IEmailService,
  ) {}

  async execute(input: {
    username: string;
    email: string;
    password: string;
    machineId: string;
    ip?: string;
  }): Promise<Result<{ message: string; token: string; sessionId: string; user: UserPublic }>> {
    const username = cleanStr(input.username);
    const email = cleanEmail(input.email);
    const password = input.password ?? '';
    const machineId = cleanStr(input.machineId) || 'unknown_machine';

    if (!username || username.length < 3)
      return fail('El nombre de usuario debe tener al menos 3 caracteres.');
    if (!isValidEmail(email))
      return fail('Email invalido.');
    if (!isValidPassword(password))
      return fail('La contrasena debe tener al menos 8 caracteres.');

    if (machineId !== 'unknown_machine') {
      const machineCount = await this.users.countByMachineId(machineId);
      if (machineCount >= 3) {
        return {
          success: false,
          error: 'Has alcanzado el límite de 3 cuentas en este equipo.',
          code: 403,
          limitReached: true,
          currentCount: machineCount,
          maxAllowed: 3,
          suggestion: 'Puedes eliminar una cuenta existente desde el panel de ajustes para liberar un cupo.',
        } as any;
      }
    }

    const existing = await this.users.findByEmail(email);
    if (existing) return fail('Ya existe una cuenta con ese email.', 409);

    const passwordHash = await this.hash.hash(password);
    const emailVerifyToken = uuid();
    const sessionId = uuid();

    const created = await this.users.create({
      username,
      email,
      passwordHash,
      machineIdCreated: machineId,
      isPremium: false,
      trialDaysLeft: 7,
      trialDurationDays: 7,
      trialStartedAt: new Date(),
      activeSessions: [
        {
          sessionId,
          machineId,
          loginAt: new Date(),
          lastSeenAt: new Date(),
          ip: input.ip ?? '',
        },
      ],
      emailVerified: false,
      emailVerifyToken,
      isActive: true,
    });

    const token = this.token.generate({ userId: created.id, sessionId, email: created.email });

    void this.email.sendVerification(created.email, created.username, emailVerifyToken).catch(() => undefined);
    void this.email.sendWelcome(created.email, created.username).catch(() => undefined);

    return ok({
      message: 'Cuenta creada correctamente. Revisa tu email para verificar tu cuenta.',
      token,
      sessionId,
      user: toPublic(created),
    });
  }
}

export class LoginUseCase {
  constructor(
    private users: IUserRepository,
    private hash: IHashService,
    private token: ITokenService,
  ) {}

  async execute(input: {
    email: string;
    password: string;
    machineId: string;
    ip?: string;
  }): Promise<Result<{ token: string; sessionId: string; user: UserPublic }>> {
    const email = cleanEmail(input.email);
    const password = input.password ?? '';
    const machineId = cleanStr(input.machineId) || 'unknown_machine';

    const user = email ? await this.users.findByEmail(email) : null;
    if (!user) return fail('Email o contrasena incorrectos.', 401);
    if (!user.isActive) return fail('Cuenta desactivada.', 403);

    const validPassword = await this.hash.compare(password, user.passwordHash);
    if (!validPassword) return fail('Email o contrasena incorrectos.', 401);

    const trialDaysLeft = withFreshTrialState(user);
    if (trialDaysLeft !== user.trialDaysLeft) {
      await this.users.update(user.id, { trialDaysLeft });
      user.trialDaysLeft = trialDaysLeft;
    }

    const sessionId = uuid();
    const activeSessions = [
      { sessionId, machineId, loginAt: new Date(), lastSeenAt: new Date(), ip: input.ip ?? '' },
    ];

    const updated = await this.users.update(user.id, { activeSessions });
    if (!updated) return fail('No se pudo iniciar sesion.', 500);

    const token = this.token.generate({ userId: updated.id, sessionId, email: updated.email });
    return ok({ token, sessionId, user: toPublic(updated) });
  }
}

export class LogoutUseCase {
  constructor(private users: IUserRepository) {}

  async execute(userId: string, sessionId: string): Promise<Result<{ message: string }>> {
    const user = await this.users.findById(userId);
    if (!user) return fail('Usuario no encontrado.', 404);

    const activeSessions = user.activeSessions.filter((s) => s.sessionId !== sessionId);
    await this.users.update(userId, { activeSessions });
    return ok({ message: 'Sesion cerrada correctamente.' });
  }
}

export class GetMeUseCase {
  constructor(private users: IUserRepository) {}

  async execute(userId: string, sessionId: string): Promise<Result<UserPublic>> {
    const user = await this.users.findById(userId);
    if (!user) return fail('Usuario no encontrado.', 404);

    const session = user.activeSessions.find((s) => s.sessionId === sessionId);
    if (!session) return fail('Sesion invalida o expirada.', 401);

    const trialDaysLeft = withFreshTrialState(user);
    const activeSessions = user.activeSessions.map((s) =>
      s.sessionId === sessionId ? { ...s, lastSeenAt: new Date() } : s,
    );

    const updated = await this.users.update(userId, { activeSessions, trialDaysLeft });
    if (!updated) return fail('No se pudo obtener la sesion.', 500);
    return ok(toPublic(updated));
  }
}

export class RefreshSessionUseCase {
  constructor(private users: IUserRepository) {}

  async execute(userId: string, sessionId: string): Promise<Result<{ ok: true }>> {
    const user = await this.users.findById(userId);
    if (!user) return fail('Usuario no encontrado.', 404);

    const hasSession = user.activeSessions.some((s) => s.sessionId === sessionId);
    if (!hasSession) return fail('Sesion invalida o expirada.', 401);

    const activeSessions = user.activeSessions.map((s) =>
      s.sessionId === sessionId ? { ...s, lastSeenAt: new Date() } : s,
    );
    await this.users.update(userId, { activeSessions });
    return ok({ ok: true });
  }
}

export class ForgotPasswordUseCase {
  constructor(
    private users: IUserRepository,
    private email: IEmailService,
  ) {}

  async execute(emailAddress: string): Promise<Result<{ message: string }>> {
    const email = cleanEmail(emailAddress);
    const SAFE_MSG = 'Si el email existe, recibiras un enlace de recuperacion.';
    if (!email) return ok({ message: SAFE_MSG });

    const user = await this.users.findByEmail(email);
    if (!user) return ok({ message: SAFE_MSG });

    const token = uuid();
    const passwordResetExpiry = new Date(Date.now() + 60 * 60 * 1000);
    await this.users.update(user.id, { passwordResetToken: token, passwordResetExpiry });
    void this.email.sendPasswordReset(user.email, user.username, token).catch(() => undefined);
    return ok({ message: SAFE_MSG });
  }
}

export class ResetPasswordUseCase {
  constructor(
    private users: IUserRepository,
    private hash: IHashService,
  ) {}

  async execute(token: string, newPassword: string): Promise<Result<{ message: string }>> {
    const cleanToken = cleanStr(token);
    const password = newPassword ?? '';

    if (!cleanToken) return fail('Token invalido o expirado.', 400);
    if (!isValidPassword(password)) return fail('La contrasena debe tener al menos 8 caracteres.');

    const user = await this.users.findByPasswordResetToken(cleanToken);
    if (!user || !user.passwordResetExpiry || user.passwordResetExpiry < new Date())
      return fail('Token invalido o expirado.', 400);

    const passwordHash = await this.hash.hash(password);
    await this.users.update(user.id, {
      passwordHash,
      passwordResetToken: undefined,
      passwordResetExpiry: undefined,
      activeSessions: [],
    });
    return ok({ message: 'Contrasena actualizada correctamente.' });
  }
}

export class ChangePasswordAuthenticatedUseCase {
  constructor(
    private users: IUserRepository,
    private hash: IHashService,
  ) {}

  async execute(
    userId: string,
    currentPassword: string,
    newPassword: string,
    sessionId: string,
  ): Promise<Result<{ message: string }>> {
    const user = await this.users.findById(userId);
    if (!user) return fail('Usuario no encontrado.', 404);
    if (!currentPassword || !newPassword) return fail('Completa los campos requeridos.');
    if (!isValidPassword(newPassword)) return fail('La nueva contrasena debe tener al menos 8 caracteres.');

    const matches = await this.hash.compare(currentPassword, user.passwordHash);
    if (!matches) return fail('La contrasena actual es incorrecta.', 401);
    if (currentPassword === newPassword) return fail('La nueva contrasena no puede ser igual a la actual.');

    const passwordHash = await this.hash.hash(newPassword);
    const keepSession = user.activeSessions.filter((s) => s.sessionId === sessionId);
    await this.users.update(user.id, {
      passwordHash,
      passwordResetToken: undefined,
      passwordResetExpiry: undefined,
      activeSessions: keepSession,
    });
    return ok({ message: 'Contrasena actualizada correctamente.' });
  }
}

export class RequestAccountDeletionUseCase {
  constructor(private users: IUserRepository) {}

  async execute(
    userId: string,
    input: { reason: string; detail?: string },
  ): Promise<Result<{ message: string }>> {
    const user = await this.users.findById(userId);
    if (!user) return fail('Usuario no encontrado.', 404);
    if (!user.isActive) return fail('La cuenta ya se encuentra inactiva.');

    const reason = this.normalizeReason(input.reason);
    if (!reason) return fail('Selecciona un motivo valido para eliminar la cuenta.');

    const detail = String(input.detail ?? '').trim().slice(0, 100);
    if (detail.length > 100) return fail('El detalle no puede superar 100 caracteres.');

    await this.users.update(user.id, {
      isActive: false,
      deactivatedAt: new Date(),
      deactivatedReason: 'Solicitud de eliminacion de cuenta',
      accountDeletionRequest: { requestId: uuid(), reason, detail, requestedAt: new Date() },
      activeSessions: [],
    });

    return ok({ message: 'Solicitud recibida. Tu cuenta quedo inactiva hasta revision del administrador.' });
  }

  private normalizeReason(inputReason: string): AccountDeletionReason | null {
    const reason = cleanStr(inputReason);
    return ACCOUNT_DELETION_REASONS.find((a) => a === reason) ?? null;
  }
}

export class VerifyEmailUseCase {
  constructor(private users: IUserRepository) {}

  async execute(token: string): Promise<Result<{ message: string }>> {
    const cleanToken = cleanStr(token);
    if (!cleanToken) return fail('Token de verificacion invalido.', 400);

    const user = await this.users.findByEmailVerifyToken(cleanToken);
    if (!user) return fail('Token de verificacion invalido.', 400);

    await this.users.update(user.id, { emailVerified: true, emailVerifyToken: undefined });
    return ok({ message: 'Email verificado correctamente.' });
  }
}

export class GetBillingPlansUseCase {
  constructor(private billingConfig: IBillingConfigRepository) {}

  async execute(): Promise<
    Result<{
      plans: Array<{
        key: BillingPlanKey;
        title: string;
        amountCents: number;
        premiumDays: number;
        checkoutUrl: string;
      }>;
    }>
  > {
    const config = await this.billingConfig.get();
    const enabledPlans = config.plans
      .filter((p) => p.enabled)
      .map((p) => ({ key: p.key, title: p.title, amountCents: p.amountCents, premiumDays: p.premiumDays, checkoutUrl: p.checkoutUrl || '' }));

    if (enabledPlans.length === 0) return fail('No hay planes de pago habilitados.', 503);
    return ok({ plans: enabledPlans });
  }
}

export class GetBillingConfigUseCase {
  constructor(private billingConfig: IBillingConfigRepository) {}

  async execute(): Promise<Result<{ plans: BillingPlanConfig[]; updatedAt: Date }>> {
    const config = await this.billingConfig.get();
    return ok({ plans: config.plans, updatedAt: config.updatedAt });
  }
}

export class UpdateBillingConfigUseCase {
  constructor(private billingConfig: IBillingConfigRepository) {}

  async execute(input: {
    plans?: Array<{
      key?: BillingPlanKey;
      title?: string;
      amountCents?: number;
      premiumDays?: number;
      enabled?: boolean;
      checkoutUrl?: string;
    }>;
  }): Promise<Result<{ plans: BillingPlanConfig[]; updatedAt: Date }>> {
    const current = await this.billingConfig.get();
    const planRecords = new Map<BillingPlanKey, BillingPlanConfig>(
      current.plans.map((p) => [p.key, p]),
    );

    for (const partial of input.plans ?? []) {
      const key = normalizeBillingPlanKey(partial?.key);
      if (!key) continue;
      const existing = planRecords.get(key);
      if (!existing) continue;

      const amount = Number(partial.amountCents);
      const premiumDays = Number(partial.premiumDays);

      planRecords.set(key, {
        key,
        title: String(partial.title ?? existing.title).trim().slice(0, 80) || existing.title,
        amountCents: Number.isFinite(amount) && amount > 0
          ? Math.max(1, Math.min(100_000_000, Math.trunc(amount)))
          : existing.amountCents,
        premiumDays: Number.isFinite(premiumDays) && premiumDays > 0
          ? Math.max(1, Math.min(3650, Math.trunc(premiumDays)))
          : existing.premiumDays,
        enabled: typeof partial.enabled === 'boolean' ? partial.enabled : existing.enabled,
        checkoutUrl: normalizeCheckoutUrl(partial.checkoutUrl, existing.checkoutUrl),
      });
    }

    const nextPlans = ['monthly', 'annual']
      .map((key) => planRecords.get(key as BillingPlanKey))
      .filter(Boolean) as BillingPlanConfig[];

    if (nextPlans.length === 0) return fail('No se pudo guardar la configuracion de billing.', 400);
    if (!nextPlans.some((p) => p.enabled)) return fail('Debes mantener al menos un plan habilitado.', 400);

    const saved = await this.billingConfig.save({ plans: nextPlans, updatedAt: new Date() });
    return ok({ plans: saved.plans, updatedAt: saved.updatedAt });
  }
}

export class CreateCheckoutUseCase {
  constructor(
    private users: IUserRepository,
    private billingConfig: IBillingConfigRepository,
    private payPhone: IPayPhoneService,
  ) {}

  async execute(
    userId: string,
    requestedPlanKey: unknown,
  ): Promise<
    Result<{
      url: string;
      clientTransactionId: string;
      plan: { key: BillingPlanKey; title: string; amountCents: number; premiumDays: number };
    }>
  > {
    const user = await this.users.findById(userId);
    if (!user) return fail('Usuario no encontrado.', 404);

    const billing = await this.billingConfig.get();
    const requestedKey = normalizeBillingPlanKey(requestedPlanKey);
    if (!requestedKey) return fail('Plan de pago invalido.', 400);

    const plan = findPlanByKey(billing.plans, requestedKey);
    if (!plan || !plan.enabled) return fail('Plan no disponible en este momento.', 400);
    if (plan.amountCents < 1 || plan.premiumDays < 1) return fail('Configuracion de pago invalida.', 500);

    const clientTransactionId = this.generateClientTransactionId();

    try {
      const checkout = await this.payPhone.createCheckoutLink({
        amountCents: plan.amountCents,
        clientTransactionId,
        reference: `${plan.title} - ${user.username}`,
        additionalData: `user:${user.id};plan:${plan.key}`,
      });

      await this.users.update(user.id, {
        payPhonePendingClientTransactionId: clientTransactionId,
        payPhonePendingPlanKey: plan.key,
        payPhonePendingPremiumDays: plan.premiumDays,
        payPhonePendingCreatedAt: new Date(),
        payPhoneLastClientTransactionId: clientTransactionId,
        payPhoneLastPaymentStatus: 'pending',
        payPhoneLastPaymentUpdatedAt: new Date(),
      });

      return ok({
        url: checkout.paymentUrl,
        clientTransactionId,
        plan: { key: plan.key, title: plan.title, amountCents: plan.amountCents, premiumDays: plan.premiumDays },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const isGatewayError = message.includes('PayPhone rechazo la solicitud') || message.includes('PayPhone no devolvio');
      const detail = process.env.NODE_ENV !== 'production' && message ? ` Detalle tecnico: ${message}` : '';
      return fail(
        isGatewayError
          ? `No se pudo iniciar el pago con PayPhone. Verifica configuracion y credenciales.${detail}`
          : 'No se pudo iniciar el pago en este momento.',
        502,
      );
    }
  }

  private generateClientTransactionId(): string {
    const random = Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return random.padEnd(6, 'X').slice(0, 6);
  }
}

export class HandlePayPhoneWebhookUseCase {
  constructor(
    private users: IUserRepository,
    private payPhone: IPayPhoneService,
  ) {}

  async execute(payload: Buffer | Record<string, unknown>): Promise<{
    statusCode: number;
    body: { Response: boolean; ErrorCode: string };
  }> {
    let webhook;
    try {
      webhook = this.payPhone.parseWebhookPayload(payload);
    } catch {
      return { statusCode: 400, body: { Response: false, ErrorCode: '111' } };
    }

    const clientTransactionId = String(webhook.ClientTransactionId ?? '').trim();
    const hasTransactionId = webhook.TransactionId !== undefined && webhook.TransactionId !== null;
    const hasStatusCode = webhook.StatusCode !== undefined && webhook.StatusCode !== null;

    if (!clientTransactionId || !hasTransactionId || !hasStatusCode)
      return { statusCode: 400, body: { Response: false, ErrorCode: '444' } };

    if (!this.payPhone.isExpectedStore(webhook))
      return { statusCode: 400, body: { Response: false, ErrorCode: '666' } };

    const user = await this.users.findByPayPhonePendingClientTransactionId(clientTransactionId);
    if (!user) return { statusCode: 409, body: { Response: false, ErrorCode: '333' } };

    const transactionId = String(webhook.TransactionId).trim();
    if (user.payPhoneLastTransactionId === transactionId)
      return { statusCode: 200, body: { Response: true, ErrorCode: '000' } };

    if (!this.payPhone.isApprovedPayment(webhook)) {
      await this.users.update(user.id, {
        payPhonePendingClientTransactionId: undefined,
        payPhonePendingPlanKey: undefined,
        payPhonePendingPremiumDays: undefined,
        payPhonePendingCreatedAt: undefined,
        payPhoneLastClientTransactionId: clientTransactionId,
        payPhoneLastPaymentStatus: 'cancelled',
        payPhoneLastPaymentUpdatedAt: new Date(),
      });
      return { statusCode: 200, body: { Response: true, ErrorCode: '000' } };
    }

    const now = Date.now();
    const currentExpiry = user.premiumExpiry ? new Date(user.premiumExpiry).getTime() : 0;
    const baseTime = user.isPremium && currentExpiry > now ? currentExpiry : now;
    const grantedDays = Math.max(1, Number(user.payPhonePendingPremiumDays ?? 30));
    const premiumExpiry = new Date(baseTime + grantedDays * DAY_MS);

    await this.users.update(user.id, {
      isPremium: true,
      premiumExpiry,
      payPhoneLastTransactionId: transactionId,
      payPhoneLastClientTransactionId: clientTransactionId,
      payPhoneLastPaymentStatus: 'completed',
      payPhoneLastPaymentUpdatedAt: new Date(),
      payPhonePendingClientTransactionId: undefined,
      payPhonePendingPlanKey: undefined,
      payPhonePendingPremiumDays: undefined,
      payPhonePendingCreatedAt: undefined,
    });

    return { statusCode: 200, body: { Response: true, ErrorCode: '000' } };
  }
}

export class GetCheckoutStatusUseCase {
  constructor(
    private users: IUserRepository,
    private payPhone: IPayPhoneService,
  ) {}

  async execute(
    userId: string,
    clientTransactionId: string,
  ): Promise<Result<{ status: 'pending' | 'completed' | 'cancelled' | 'not_found'; user?: UserPublic }>> {
    const cleanId = cleanStr(clientTransactionId);
    if (!cleanId) return fail('Transaccion invalida.', 400);
  
    const user = await this.users.findById(userId);
    if (!user) return fail('Usuario no encontrado.', 404);
  
    // Si ya está premium y el último pago completado coincide, devolver directo
    if (
      user.payPhoneLastPaymentStatus === 'completed' &&
      user.payPhoneLastClientTransactionId === cleanId &&
      !user.payPhonePendingClientTransactionId
    ) {
      return ok({ status: 'completed', user: toPublic(user) });
    }
  
    // Consultar SIEMPRE a PayPhone con el ID que manda el cliente
    // independientemente del pendiente guardado (puede haber reintentos)
    try {
      const remote = await this.payPhone.getCheckoutStatusByClientId(cleanId);
  
      if (remote.found && remote.approved) {
        const now = Date.now();
        const currentExpiry = user.premiumExpiry ? new Date(user.premiumExpiry).getTime() : 0;
        const baseTime = user.isPremium && currentExpiry > now ? currentExpiry : now;
  
        // Intentar obtener los días del pendiente guardado si el ID coincide,
        // si no, buscar en el historial o usar 30 como fallback
        const grantedDays = Math.max(1, Number(
          user.payPhonePendingPremiumDays ?? 30
        ));
  
        const premiumExpiry = new Date(baseTime + grantedDays * DAY_MS);
        const transactionId = cleanStr(remote.transactionId ?? '');
  
        const updated = await this.users.update(user.id, {
          isPremium: true,
          premiumExpiry,
          payPhoneLastTransactionId: transactionId || user.payPhoneLastTransactionId,
          payPhoneLastClientTransactionId: cleanId,
          payPhoneLastPaymentStatus: 'completed',
          payPhoneLastPaymentUpdatedAt: new Date(),
          payPhonePendingClientTransactionId: undefined,
          payPhonePendingPlanKey: undefined,
          payPhonePendingPremiumDays: undefined,
          payPhonePendingCreatedAt: undefined,
        });
  
        return ok({ status: 'completed', user: updated ? toPublic(updated) : toPublic(user) });
      }
  
      if (remote.found && remote.cancelled) {
        await this.users.update(user.id, {
          payPhonePendingClientTransactionId: undefined,
          payPhonePendingPlanKey: undefined,
          payPhonePendingPremiumDays: undefined,
          payPhonePendingCreatedAt: undefined,
          payPhoneLastClientTransactionId: cleanId,
          payPhoneLastPaymentStatus: 'cancelled',
          payPhoneLastPaymentUpdatedAt: new Date(),
        });
        return ok({ status: 'cancelled' });
      }
  
      return ok({ status: 'pending' });
    } catch {
      return ok({ status: 'pending' });
    }
  }
}

export class GrantTrialUseCase {
  constructor(
    private users: IUserRepository,
    private email: IEmailService,
  ) {}

  async execute(targetEmail: string, days: number): Promise<Result<{ message: string }>> {
    const email = cleanEmail(targetEmail);
    if (!email) return fail('Email invalido.');
    if (days < 1 || days > 365) return fail('Dias invalidos (1-365).');

    const user = await this.users.findByEmail(email);
    if (!user) return fail('Usuario no encontrado.', 404);

    const extendedExpiry = extendPremiumExpiry(user, days);
    if (extendedExpiry) {
      await this.users.update(user.id, { premiumExpiry: extendedExpiry });
      void this.email.sendTrialActivated(user.email, user.username, days).catch(() => undefined);
      return ok({ message: `${days} dias sumados al premium de ${email}.` });
    }

    await this.users.update(user.id, {
      trialDaysLeft: days,
      trialDurationDays: days,
      trialStartedAt: new Date(),
    });
    void this.email.sendTrialActivated(user.email, user.username, days).catch(() => undefined);
    return ok({ message: `${days} dias de prueba otorgados a ${email}.` });
  }
}

export class CreateUserByAdminUseCase {
  constructor(
    private users: IUserRepository,
    private hash: IHashService,
  ) {}

  async execute(input: {
    username: string;
    email: string;
    password: string;
    trialDays?: number;
    isPremium?: boolean;
    premiumDays?: number;
    isActive?: boolean;
  }): Promise<Result<{ message: string; user: UserPublic }>> {
    const username = cleanStr(input.username);
    const email = cleanEmail(input.email);
    const password = String(input.password || '');
    const trialDays = Math.max(0, Math.min(365, Number(input.trialDays ?? 7)));
    const isPremium = Boolean(input.isPremium);
    const premiumDays = Math.max(0, Math.min(3650, Number(input.premiumDays ?? 0)));
    const isActive = input.isActive !== false;

    if (!username || username.length < 3) return fail('El usuario debe tener al menos 3 caracteres.');
    if (!isValidEmail(email)) return fail('Email invalido.');
    if (!isValidPassword(password)) return fail('La contrasena debe tener al menos 8 caracteres.');

    const existing = await this.users.findByEmail(email);
    if (existing) return fail('Ya existe una cuenta con ese email.', 409);

    const passwordHash = await this.hash.hash(password);
    const now = new Date();

    const created = await this.users.create({
      username,
      email,
      passwordHash,
      isPremium,
      premiumExpiry: isPremium && premiumDays > 0 ? new Date(Date.now() + premiumDays * DAY_MS) : undefined,
      trialDaysLeft: isPremium ? 0 : trialDays,
      trialDurationDays: isPremium ? 0 : trialDays,
      trialStartedAt: isPremium ? undefined : now,
      activeSessions: [],
      emailVerified: true,
      isActive,
      deactivatedAt: isActive ? undefined : now,
      deactivatedReason: isActive ? undefined : 'Creada por administrador como inactiva',
    });

    return ok({ message: 'Usuario creado correctamente.', user: toPublic(created) });
  }
}

export class SetUserActiveStatusUseCase {
  constructor(private users: IUserRepository) {}

  async execute(
    userId: string,
    input: { isActive: boolean; reason?: string; clearDeletionRequest?: boolean },
  ): Promise<Result<{ message: string; user: UserPublic }>> {
    const user = await this.users.findById(userId);
    if (!user) return fail('Usuario no encontrado.', 404);

    const isActive = Boolean(input.isActive);
    const reason = cleanStr(input.reason ?? '');
    const clearDeletionRequest = input.clearDeletionRequest !== false;

    const updatePayload = isActive
      ? {
          isActive: true,
          deactivatedAt: undefined,
          deactivatedReason: undefined,
          accountDeletionRequest: clearDeletionRequest ? undefined : user.accountDeletionRequest,
        }
      : {
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedReason: reason || 'Desactivada por administrador',
          activeSessions: [],
        };

    const updated = await this.users.update(user.id, updatePayload);
    if (!updated) return fail('No se pudo actualizar el estado del usuario.', 500);
    return ok({ message: isActive ? 'Usuario restaurado.' : 'Usuario inactivado.', user: toPublic(updated) });
  }
}

export class DismissAccountDeletionNotificationUseCase {
  constructor(private users: IUserRepository) {}

  async execute(userId: string): Promise<Result<{ message: string; user: UserPublic }>> {
    const user = await this.users.findById(userId);
    if (!user) return fail('Usuario no encontrado.', 404);
    if (!user.accountDeletionRequest) return fail('El usuario no tiene una solicitud de eliminacion.', 404);

    const updated = await this.users.update(user.id, {
      accountDeletionRequest: { ...user.accountDeletionRequest, dismissedAt: new Date() },
    });
    if (!updated) return fail('No se pudo actualizar la notificacion.', 500);
    return ok({ message: 'Notificacion marcada como revisada.', user: toPublic(updated) });
  }
}

export class ListDeletionRequestsUseCase {
  constructor(private users: IUserRepository) {}

  async execute(limit = 200): Promise<
    Result<{
      requests: Array<{
        userId: string;
        username: string;
        email: string;
        isActive: boolean;
        deactivatedAt?: Date;
        requestId: string;
        reason: string;
        detail?: string;
        requestedAt: Date;
        dismissedAt?: Date;
      }>;
    }>
  > {
    const users = await this.users.findAll(0, Math.max(1, Math.min(1000, limit)));
    const requests = users
      .filter((u) => Boolean(u.accountDeletionRequest))
      .map((u) => ({
        userId: u.id,
        username: u.username,
        email: u.email,
        isActive: u.isActive,
        deactivatedAt: u.deactivatedAt,
        requestId: u.accountDeletionRequest!.requestId,
        reason: u.accountDeletionRequest!.reason,
        detail: u.accountDeletionRequest!.detail,
        requestedAt: u.accountDeletionRequest!.requestedAt,
        dismissedAt: u.accountDeletionRequest!.dismissedAt,
      }))
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());

    return ok({ requests });
  }
}

export class ListUsersUseCase {
  constructor(private users: IUserRepository) {}

  async execute(
    page = 1,
    limit = 20,
  ): Promise<Result<{ users: UserPublic[]; total: number; page: number; limit: number }>> {
    const cleanPage = Math.max(1, Number.isFinite(page) ? page : 1);
    const cleanLimit = Math.min(100, Math.max(1, Number.isFinite(limit) ? limit : 20));
    const skip = (cleanPage - 1) * cleanLimit;

    const [users, total] = await Promise.all([
      this.users.findAll(skip, cleanLimit),
      this.users.countAll(),
    ]);

    return ok({ users: users.map(toPublic), total, page: cleanPage, limit: cleanLimit });
  }
}

export class SetUserTrialUseCase {
  constructor(private users: IUserRepository) {}

  async execute(
    userId: string,
    input: { trialDays?: number; resetTrial?: boolean },
  ): Promise<Result<UserPublic>> {
    const user = await this.users.findById(userId);
    if (!user) return fail('Usuario no encontrado.', 404);

    const requestedDays = Math.max(1, Number(input.trialDays ?? user.trialDaysLeft));

    const extendedExpiry = extendPremiumExpiry(user, requestedDays);
    if (extendedExpiry) {
      const updated = await this.users.update(user.id, { premiumExpiry: extendedExpiry });
      if (!updated) return fail('No se pudo actualizar el premium del usuario.', 500);
      return ok(toPublic(updated));
    }

    const newTrialStartedAt = input.resetTrial || !user.trialStartedAt ? new Date() : user.trialStartedAt;
    const updated = await this.users.update(user.id, {
      trialDaysLeft: requestedDays,
      trialDurationDays: requestedDays,
      trialStartedAt: newTrialStartedAt,
    });
    if (!updated) return fail('No se pudo actualizar el trial del usuario.', 500);
    return ok(toPublic(updated));
  }
}

export class GetMachineAccountsUseCase {
  constructor(private users: IUserRepository) {}

  async execute(
    userId: string,
    machineId: string,
  ): Promise<Result<{ accounts: any[]; count: number; max: number }>> {
    if (!machineId?.trim()) return fail('machineId requerido.', 400);

    const all = await this.users.findAllByMachineId(machineId.trim());
    const accounts = all.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email.replace(/(.{2}).+(@.+)/, '$1***$2'),
      createdAt: u.createdAt,
      isActive: u.isActive,
      hasActivePremium: u.isPremium && (!u.premiumExpiry || new Date(u.premiumExpiry) > new Date()),
      trialDaysLeft: u.trialDaysLeft,
    }));

    return ok({ accounts, count: all.filter((u) => u.isActive).length, max: 3 });
  }
}
export class CleanupDeletionRequestsUseCase {
  constructor(private users: IUserRepository) {}

  async execute(olderThanDays = 30): Promise<Result<{ cleaned: number }>> {
    const cutoff = new Date(Date.now() - olderThanDays * DAY_MS);

    // Traer todos (límite alto, es operación admin puntual)
    const all = await this.users.findAll(0, 2000);

    const toClean = all.filter(u => {
      const req = u.accountDeletionRequest;
      if (!req?.dismissedAt) return false; // solo revisadas
      return new Date(req.dismissedAt).getTime() < cutoff.getTime();
    });

    let cleaned = 0;
    for (const u of toClean) {
      // Quitar solo el campo accountDeletionRequest, NO eliminar el usuario
      await this.users.update(u.id, { accountDeletionRequest: undefined });
      cleaned++;
    }

    return ok({ cleaned });
  }
}