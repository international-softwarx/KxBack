import { NextFunction, Request, Response, Router } from 'express';
import {
  ChangePasswordAuthenticatedUseCase,
  CreateUserByAdminUseCase,
  CreateCheckoutUseCase,
  DismissAccountDeletionNotificationUseCase,
  ForgotPasswordUseCase,
  GetBillingConfigUseCase,
  GetBillingPlansUseCase,
  GetCheckoutStatusUseCase,
  GetMeUseCase,
  GrantTrialUseCase,
  HandlePayPhoneWebhookUseCase,
  ListDeletionRequestsUseCase,
  ListUsersUseCase,
  LoginUseCase,
  LogoutUseCase,
  RequestAccountDeletionUseCase,
  RefreshSessionUseCase,
  RegisterUseCase,
  ResetPasswordUseCase,
  SetUserActiveStatusUseCase,
  SetUserTrialUseCase,
  UpdateBillingConfigUseCase,
  VerifyEmailUseCase,
  GetMachineAccountsUseCase,
  CleanupDeletionRequestsUseCase,
} from '../../application/useCases/useCases';
import {
  IBillingConfigRepository,
  IEmailService,
  IHashService,
  IPayPhoneService,
  ITokenService,
  IUserRepository,
} from '../../domain/ports/ports';
import { adminMiddleware, authMiddleware } from '../middleware/middleware';

export function buildRouter(deps: {
  users: IUserRepository;
  token: ITokenService;
  hash: IHashService;
  email: IEmailService;
  payPhone: IPayPhoneService;
  billingConfig: IBillingConfigRepository;
  adminToken: string;
  frontendUrl: string;
}) {
  const router = Router();

  const auth = authMiddleware(deps.token, deps.users);
  const admin = adminMiddleware(deps.adminToken);

  router.get('/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        status: 'ok',
        service: 'kx-backend',
        timestamp: new Date().toISOString(),
      },
    });
  });

  router.post('/auth/register', async (req: Request, res: Response) => {
    const useCase = new RegisterUseCase(deps.users, deps.hash, deps.token, deps.email);
    const result = await useCase.execute({
      username: req.body.username,
      email: req.body.email,
      password: req.body.password,
      machineId: req.body.machineId,
      ip: req.ip,
    });

    res.status(result.success ? 201 : result.code ?? 400).json(result);
  });

  router.post('/auth/login', async (req: Request, res: Response) => {
    const useCase = new LoginUseCase(deps.users, deps.hash, deps.token);
    const result = await useCase.execute({
      email: req.body.email,
      password: req.body.password,
      machineId: req.body.machineId,
      ip: req.ip,
    });

    res.status(result.success ? 200 : result.code ?? 401).json(result);
  });

  router.post('/auth/logout', auth, async (req: Request, res: Response) => {
    const useCase = new LogoutUseCase(deps.users);
    const result = await useCase.execute(req.userId!, req.sessionId!);
    res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.get('/auth/me', auth, async (req: Request, res: Response) => {
    const useCase = new GetMeUseCase(deps.users);
    const result = await useCase.execute(req.userId!, req.sessionId!);
    res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.get('/auth/machine-accounts', admin, async (req: Request, res: Response) => {
    const machineId = String(req.headers['x-machine-id'] ?? req.query.machineId ?? '');
    const useCase = new GetMachineAccountsUseCase(deps.users);
  
    const result = await useCase.execute('admin', machineId);
  
    return res.status(result.success ? 200 : (result as any).code ?? 400).json(result);
  });

  router.post('/auth/refresh', auth, async (req: Request, res: Response) => {
    const useCase = new RefreshSessionUseCase(deps.users);
    const result = await useCase.execute(req.userId!, req.sessionId!);
    res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.post('/auth/forgot-password', async (req: Request, res: Response) => {
    const useCase = new ForgotPasswordUseCase(deps.users, deps.email);
    const result = await useCase.execute(req.body.email);
    res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.post('/auth/reset-password', async (req: Request, res: Response) => {
    const useCase = new ResetPasswordUseCase(deps.users, deps.hash);
    const result = await useCase.execute(req.body.token, req.body.password);
    res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.get('/auth/verify-email', async (req: Request, res: Response) => {
    const useCase = new VerifyEmailUseCase(deps.users);
    const result = await useCase.execute(String(req.query.token ?? ''));

    if (result.success) {
      return res.redirect(`${deps.frontendUrl}/presentation/pages/login/?verified=1`);
    }

    return res.redirect(`${deps.frontendUrl}/presentation/pages/login/?verify_error=1`);
  });

  router.post('/auth/change-password', auth, async (req: Request, res: Response) => {
    const useCase = new ChangePasswordAuthenticatedUseCase(deps.users, deps.hash);
    const result = await useCase.execute(
      req.userId!,
      String(req.body.currentPassword ?? ''),
      String(req.body.newPassword ?? ''),
      req.sessionId!,
    );
    return res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.post('/auth/request-account-deletion', auth, async (req: Request, res: Response) => {
    const useCase = new RequestAccountDeletionUseCase(deps.users);
    const result = await useCase.execute(req.userId!, {
      reason: String(req.body.reason ?? ''),
      detail: String(req.body.detail ?? ''),
    });
    return res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.get('/billing/plans', auth, async (req: Request, res: Response) => {
    const useCase = new GetBillingPlansUseCase(deps.billingConfig);
    const result = await useCase.execute();
    return res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.post('/billing/checkout', auth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const useCase = new CreateCheckoutUseCase(deps.users, deps.billingConfig, deps.payPhone);
      const result = await useCase.execute(req.userId!, req.body.planKey);
      return res.status(result.success ? 200 : result.code ?? 400).json(result);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/billing/renew', auth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const useCase = new CreateCheckoutUseCase(deps.users, deps.billingConfig, deps.payPhone);
      const result = await useCase.execute(req.userId!, req.body.planKey ?? 'monthly');
      return res.status(result.success ? 200 : result.code ?? 400).json(result);
    } catch (error) {
      return next(error);
    }
  });

  router.get(
    '/billing/checkout-status/:clientTransactionId',
    auth,
    async (req: Request, res: Response) => {
      const useCase = new GetCheckoutStatusUseCase(deps.users, deps.payPhone);
      const result = await useCase.execute(req.userId!, req.params.clientTransactionId);
      return res.status(result.success ? 200 : result.code ?? 400).json(result);
    },
  );

  router.post('/webhooks/payphone', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const useCase = new HandlePayPhoneWebhookUseCase(deps.users, deps.payPhone);
      const result = await useCase.execute(req.body as Record<string, unknown>);
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/admin/users', admin, async (req: Request, res: Response) => {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);

    const useCase = new ListUsersUseCase(deps.users);
    const result = await useCase.execute(page, limit);
    res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.patch('/admin/users/:id/machine-limit-reset', admin, async (req: Request, res: Response) => {
    const updated = await deps.users.update(req.params.id, { machineIdCreated: undefined });
    if (!updated) return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    return res.json({ success: true, data: { message: 'Límite reiniciado.' } });
  });

  router.post('/admin/users', admin, async (req: Request, res: Response) => {
    const useCase = new CreateUserByAdminUseCase(deps.users, deps.hash);
    const result = await useCase.execute({
      username: req.body.username,
      email: req.body.email,
      password: req.body.password,
      trialDays: req.body.trialDays,
      isPremium: req.body.isPremium,
      premiumDays: req.body.premiumDays,
      isActive: req.body.isActive,
    });

    return res.status(result.success ? 201 : result.code ?? 400).json(result);
  });

  router.get('/admin/billing/config', admin, async (_req: Request, res: Response) => {
    const useCase = new GetBillingConfigUseCase(deps.billingConfig);
    const result = await useCase.execute();
    return res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.patch('/admin/billing/config', admin, async (req: Request, res: Response) => {
    const useCase = new UpdateBillingConfigUseCase(deps.billingConfig);
    const result = await useCase.execute({
      plans: Array.isArray(req.body?.plans) ? req.body.plans : [],
    });
    return res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.post('/admin/grant-trial', admin, async (req: Request, res: Response) => {
    const useCase = new GrantTrialUseCase(deps.users, deps.email);
    const days = Number(req.body.days ?? 7);
    const result = await useCase.execute(req.body.email, days);
    res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.patch('/admin/users/:id/status', admin, async (req: Request, res: Response) => {
    const normalizedIsActive =
      req.body.isActive === true ||
      req.body.isActive === 'true' ||
      req.body.isActive === 1 ||
      req.body.isActive === '1';

    const useCase = new SetUserActiveStatusUseCase(deps.users);
    const result = await useCase.execute(req.params.id, {
      isActive: normalizedIsActive,
      reason: String(req.body.reason ?? ''),
      clearDeletionRequest: req.body.clearDeletionRequest !== false,
    });

    return res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.patch('/admin/users/:id/deletion-request/dismiss', admin, async (req: Request, res: Response) => {
    const useCase = new DismissAccountDeletionNotificationUseCase(deps.users);
    const result = await useCase.execute(req.params.id);
    return res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.get('/admin/deletion-requests', admin, async (_req: Request, res: Response) => {
    const useCase = new ListDeletionRequestsUseCase(deps.users);
    const result = await useCase.execute(500);
    return res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.patch('/admin/deletion-requests/cleanup', admin, async (_req: Request, res: Response) => {
    const useCase = new CleanupDeletionRequestsUseCase(deps.users);
    const result = await useCase.execute(30);
    return res.status(result.success ? 200 : (result as any).code ?? 400).json(result);
  });

  router.patch('/admin/users/:id/premium', admin, async (req: Request, res: Response) => {
    const body = req.body;
    const isPremium = Boolean(body.isPremium);
    const days = Number(body.days ?? 0);

    // Si isPremium es false O days es 0, quitar premium
    if (!isPremium || days <= 0) {
      const user = await deps.users.update(req.params.id, {
        isPremium: false,
        payPhonePendingClientTransactionId: undefined,
        payPhonePendingPlanKey: undefined,
        payPhonePendingPremiumDays: undefined,
        payPhonePendingCreatedAt: undefined,
      });

      if (!user) {
        return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
      }

      // IMPORTANTE: Usar $unset para eliminar premiumExpiry de la BD
      const { UserModel } = await import('../../infrastructure/database/models/UserModel');
      await UserModel.findByIdAndUpdate(user.id, {
        $unset: { premiumExpiry: 1 },
      });
      await UserModel.findByIdAndUpdate(user.id, {
        $max: { trialDurationDays: 1 },
      });

      const updatedUser = await deps.users.findById(user.id);

      return res.json({
        success: true,
        data: {
          message: 'Premium removido exitosamente.',
          user: updatedUser
        }
      });
    }

    // Si isPremium es true y days > 0, asignar premium
    const premiumExpiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const user = await deps.users.update(req.params.id, {
      isPremium: true,
      premiumExpiry,
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }

    return res.json({
      success: true,
      data: {
        message: `Premium activado por ${days} días.`,
        user
      }
    });
  });

  router.patch('/admin/users/:id/trial', admin, async (req: Request, res: Response) => {
    const trialDays = Number(req.body.trialDays ?? 0);
    const resetTrial = req.body.resetTrial === true;

    const useCase = new SetUserTrialUseCase(deps.users);
    const result = await useCase.execute(req.params.id, {
      trialDays: Math.max(0, trialDays),
      resetTrial,
    });

    return res.status(result.success ? 200 : result.code ?? 400).json(result);
  });

  router.delete('/admin/users/:id', admin, async (req: Request, res: Response) => {
    const deleted = await deps.users.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }

    return res.json({ success: true, data: { id: req.params.id } });
  });

  return router;
}
