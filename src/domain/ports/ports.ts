import { User } from '../entities/User';
import { BillingConfig } from '../entities/BillingConfig';

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByEmailVerifyToken(token: string): Promise<User | null>;
  findByPasswordResetToken(token: string): Promise<User | null>;
  findByPayPhonePendingClientTransactionId(clientTransactionId: string): Promise<User | null>;
  save(user: User): Promise<User>;
  create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
  update(id: string, data: Partial<User>): Promise<User | null>;
  delete(id: string): Promise<boolean>;
  countAll(): Promise<number>;
  findAll(skip?: number, limit?: number): Promise<User[]>;
  countByMachineId(machineId: string): Promise<number>;
  findAllByMachineId(machineId: string): Promise<User[]>;
}

export interface IBillingConfigRepository {
  get(): Promise<BillingConfig>;
  save(config: BillingConfig): Promise<BillingConfig>;
}

export type TokenPayload = {
  userId: string;
  sessionId: string;
  email: string;
};

export interface ITokenService {
  generate(payload: TokenPayload, expiresIn?: string): string;
  verify(token: string): TokenPayload | null;
  decode(token: string): TokenPayload | null;
}

export interface IHashService {
  hash(plain: string): Promise<string>;
  compare(plain: string, hashed: string): Promise<boolean>;
}

export interface IEmailService {
  sendVerification(to: string, username: string, token: string): Promise<void>;
  sendPasswordReset(to: string, username: string, token: string): Promise<void>;
  sendWelcome(to: string, username: string): Promise<void>;
  sendTrialActivated(to: string, username: string, days: number): Promise<void>;
}

export interface PayPhoneWebhookPayload {
  Amount?: number;
  AuthorizationCode?: string;
  ClientTransactionId?: string;
  StatusCode?: number;
  TransactionStatus?: string;
  StoreId?: string;
  PhoneNumber?: string;
  Email?: string;
  CardType?: string;
  Bin?: string;
  DeferredCode?: string;
  DeferredMessage?: string;
  Deferred?: string;
  CardBrandCode?: string;
  CardBrand?: string;
  Document?: string;
  Currency?: string;
  Taxes?: unknown[];
  Reference?: string;
  AdditionalData?: string;
  Products?: unknown[];
  TransactionId?: number | string;
  [key: string]: unknown;
}

export interface PayPhoneCheckoutInput {
  amountCents: number;
  clientTransactionId: string;
  reference: string;
  additionalData?: string;
}

export interface PayPhoneCheckoutResult {
  paymentUrl: string;
}

export interface PayPhoneCheckoutStatusResult {
  found: boolean;
  approved: boolean;
  cancelled: boolean;
  transactionId?: string;
  statusCode?: number;
  transactionStatus?: string;
}

export interface IPayPhoneService {
  createCheckoutLink(input: PayPhoneCheckoutInput): Promise<PayPhoneCheckoutResult>;
  getCheckoutStatusByClientId(clientTransactionId: string): Promise<PayPhoneCheckoutStatusResult>;
  parseWebhookPayload(payload: Buffer | Record<string, unknown>): PayPhoneWebhookPayload;
  isApprovedPayment(payload: PayPhoneWebhookPayload): boolean;
  isExpectedStore(payload: PayPhoneWebhookPayload): boolean;
}
