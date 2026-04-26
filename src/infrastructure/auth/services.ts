import bcrypt from 'bcryptjs';
import * as https from 'https';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import {
  IEmailService,
  IHashService,
  IPayPhoneService,
  PayPhoneCheckoutInput,
  PayPhoneCheckoutResult,
  PayPhoneCheckoutStatusResult,
  PayPhoneWebhookPayload,
  ITokenService,
  TokenPayload,
} from '../../domain/ports/ports';

export class JwtTokenService implements ITokenService {
  constructor(private secret: string) {}

  generate(payload: TokenPayload, expiresIn = '7d'): string {
    return jwt.sign(payload, this.secret, { expiresIn } as jwt.SignOptions);
  }

  verify(token: string): TokenPayload | null {
    try {
      return jwt.verify(token, this.secret) as TokenPayload;
    } catch {
      return null;
    }
  }

  decode(token: string): TokenPayload | null {
    try {
      return jwt.decode(token) as TokenPayload;
    } catch {
      return null;
    }
  }
}

export class BcryptHashService implements IHashService {
  constructor(private rounds = 12) {}

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.rounds);
  }

  compare(plain: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(plain, hashed);
  }
}

export class NodemailerEmailService implements IEmailService {
  private transporter: nodemailer.Transporter;
  private from: string;
  private frontendUrl: string;
  private backendUrl: string;

  constructor(config: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
    frontendUrl: string;
    backendUrl: string;
  }) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });

    this.from = config.from;
    this.frontendUrl = config.frontendUrl.replace(/\/$/, '');
    this.backendUrl = config.backendUrl.replace(/\/$/, '');
  }

  async sendVerification(to: string, username: string, token: string): Promise<void> {
    const verifyLink = `${this.backendUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;

    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: 'Verifica tu cuenta en Kx',
      html: this.template({
        title: 'Verifica tu email',
        username,
        body: 'Haz clic en el boton para verificar tu cuenta.',
        link: verifyLink,
        action: 'Verificar cuenta',
      }),
    });
  }

  async sendPasswordReset(to: string, username: string, token: string): Promise<void> {
    const resetLink = `${this.frontendUrl}/presentation/pages/reset-password/?token=${encodeURIComponent(token)}`;

    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: 'Recuperar contrasena - Kx',
      html: this.template({
        title: 'Restablece tu contrasena',
        username,
        body: 'Recibimos una solicitud para restablecer tu contrasena. Este enlace vence en 1 hora.',
        link: resetLink,
        action: 'Restablecer contrasena',
      }),
    });
  }

  async sendWelcome(to: string, username: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: 'Bienvenido a Kx',
      html: this.template({
        title: 'Bienvenido a Kx',
        username,
        body: 'Tu cuenta esta lista. Ya puedes usar Kx y aprovechar tus dias de prueba.',
        link: `${this.frontendUrl}/presentation/pages/dashboard/`,
        action: 'Abrir dashboard',
      }),
    });
  }

  async sendTrialActivated(to: string, username: string, days: number): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: `${days} dias premium activados`,
      html: this.template({
        title: 'Trial actualizado',
        username,
        body: `Se activaron ${days} dias de acceso premium en tu cuenta.`,
        link: `${this.frontendUrl}/presentation/pages/dashboard/`,
        action: 'Ver cuenta',
      }),
    });
  }

  private template(input: {
    title: string;
    username: string;
    body: string;
    link: string;
    action: string;
  }): string {
    return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#0d1117;color:#f0f6fc;font-family:Segoe UI,Arial,sans-serif;">
    <div style="max-width:520px;margin:32px auto;background:#161b22;border:1px solid #30363d;border-radius:14px;overflow:hidden;">
      <div style="padding:20px 24px;border-bottom:1px solid #30363d;background:#0f141a;">
        <div style="font-size:24px;font-weight:700;">Kx</div>
      </div>
      <div style="padding:24px;">
        <h1 style="font-size:20px;margin:0 0 12px 0;">${input.title}</h1>
        <p style="margin:0 0 12px 0;color:#c9d1d9;">Hola ${input.username},</p>
        <p style="margin:0 0 20px 0;color:#8b949e;line-height:1.55;">${input.body}</p>
        <a href="${input.link}" style="display:inline-block;padding:11px 18px;background:#238636;color:#fff;text-decoration:none;border-radius:9px;font-weight:600;">${input.action}</a>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #30363d;color:#8b949e;font-size:12px;">Si no solicitaste esta accion, ignora este mensaje.</div>
    </div>
  </body>
</html>`;
  }
}

export class PayPhoneService implements IPayPhoneService {
  private token: string;
  private storeId: string;
  private linksUrl: string;
  private currency: string;
  private oneTime: boolean;
  private expireInHours: number;
  private webhookStoreId: string;
  private salesByClientUrl: string;
  private notifyUrl: string;

  constructor(config: {
    token: string;
    storeId?: string;
    linksUrl: string;
    currency: string;
    oneTime: boolean;
    expireInHours: number;
    webhookStoreId: string;
    salesByClientUrl: string;
    notifyUrl: string;
  }) {
    this.token = config.token;
    this.storeId = String(config.storeId ?? '').trim();
    this.linksUrl = config.linksUrl;
    this.currency = config.currency;
    this.oneTime = config.oneTime;
    this.expireInHours = config.expireInHours;
    this.webhookStoreId = config.webhookStoreId;
    this.salesByClientUrl = config.salesByClientUrl;
    this.notifyUrl = config.notifyUrl;
  }

  async createCheckoutLink(input: PayPhoneCheckoutInput): Promise<PayPhoneCheckoutResult> {
    const amountCents = Math.max(1, Math.trunc(input.amountCents));
    const clientTransactionId = this.normalizeClientTransactionId(input.clientTransactionId);

    if (!clientTransactionId) {
      throw new Error('PayPhone requiere clientTransactionId valido (max 15 caracteres).');
    }

    const bodyBase = {
      amount: amountCents,
      amountWithoutTax: amountCents,
      amountWithTax: 0,
      tax: 0,
      currency: this.currency,
      reference: (input.reference || 'Kx Premium').slice(0, 100),
      clientTransactionId,
      oneTime: this.oneTime,
      expireIn: this.expireInHours,
      notifyUrl: this.notifyUrl,
    };

    const postToLinks = (
      body: Record<string, unknown>,
    ): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> =>
      new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(body);
        const url = new URL(this.linksUrl);

        const req = https.request(
          {
            hostname: url.hostname,
            port: url.port ? Number(url.port) : 443,
            path: `${url.pathname}${url.search}`,
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.token}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'Content-Length': Buffer.byteLength(bodyStr),
            },
          },
          (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => {
              data += chunk.toString('utf8');
            });
            res.on('end', () => {
              const statusCode = Number(res.statusCode ?? 0);
              resolve({
                ok: statusCode >= 200 && statusCode < 300,
                status: statusCode,
                text: () => Promise.resolve(data),
              });
            });
          },
        );

        req.on('error', reject);
        req.write(bodyStr);
        req.end();
      });

    const withStore = this.storeId ? { ...bodyBase, storeId: this.storeId } : bodyBase;
    let lastSentBody: Record<string, unknown> = withStore;

    let response = await postToLinks(withStore);
    let rawResponse = (await response.text()).trim();

    // Algunos tokens estan ligados a tienda por defecto y fallan si se envia storeId.
    if (!response.ok && response.status === 404 && this.storeId) {
      lastSentBody = bodyBase;
      response = await postToLinks(bodyBase);
      rawResponse = (await response.text()).trim();
    }

    if (process.env.NODE_ENV !== 'production') {
      // Temporal debug para diagnosticar rechazos 4xx/5xx desde PayPhone.
      // Evitamos incluir token sensible.
      // eslint-disable-next-line no-console
      console.log('[PAYPHONE DEBUG]', {
        url: this.linksUrl,
        status: response.status,
        body: rawResponse.slice(0, 500),
        sentBody: JSON.stringify(lastSentBody).slice(0, 300),
      });
    }

    if (!response.ok) {
      throw new Error(`PayPhone rechazo la solicitud (${response.status}). ${rawResponse || 'Sin detalle.'}`);
    }

    const paymentUrl = this.extractPaymentUrl(rawResponse);
    if (!paymentUrl) {
      throw new Error('PayPhone no devolvio un enlace de pago valido.');
    }

    return { paymentUrl };
  }

  async getCheckoutStatusByClientId(clientTransactionId: string): Promise<PayPhoneCheckoutStatusResult> {
    const cleanId = this.normalizeClientTransactionId(clientTransactionId);
    if (!cleanId) {
      return { found: false, approved: false, cancelled: false };
    }
  
    const endpoint = `${this.salesByClientUrl.replace(/\/$/, '')}/${encodeURIComponent(cleanId)}`;
  
    // TEMPORAL DEBUG
    console.log('[PAYPHONE STATUS DEBUG] Consultando:', endpoint, '| ID:', cleanId);
  
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });
  
    // TEMPORAL DEBUG
    const rawResponse = (await response.text()).trim();
    console.log('[PAYPHONE STATUS DEBUG] Respuesta:', response.status, rawResponse.slice(0, 300));
  
    if (response.status === 404) {
      return { found: false, approved: false, cancelled: false };
    }
  
    if (!response.ok) {
      throw new Error(`PayPhone no permitio consultar transaccion (${response.status}).`);
    }
  
    if (!rawResponse) {
      return { found: false, approved: false, cancelled: false };
    }
  
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawResponse) as Record<string, unknown>;
    } catch {
      return { found: false, approved: false, cancelled: false };
    }
  
    const statusCode = this.toNumber(payload.StatusCode ?? payload.statusCode ?? payload.status_code);
    const transactionStatus = this.toStringValue(
      payload.TransactionStatus ?? payload.transactionStatus ?? payload.transaction_status,
    );
    const transactionId = this.toStringValue(
      payload.TransactionId ?? payload.transactionId ?? payload.transaction_id,
    );
  
    const approved =
      statusCode === 3 ||
      String(transactionStatus ?? '')
        .trim()
        .toLowerCase() === 'approved';
    const hasKnownStatus = statusCode !== undefined || Boolean(transactionStatus);
    const cancelled = hasKnownStatus && !approved;
  
    return {
      found: true,
      approved,
      cancelled,
      transactionId,
      statusCode,
      transactionStatus,
    };
  }

  parseWebhookPayload(payload: Buffer | Record<string, unknown>): PayPhoneWebhookPayload {
    const parsed = Buffer.isBuffer(payload)
      ? (JSON.parse(payload.toString('utf8')) as Record<string, unknown>)
      : payload;
    const keyMap = new Map<string, unknown>();
    for (const [key, value] of Object.entries(parsed)) {
      keyMap.set(this.normalizeWebhookKey(key), value);
    }

    const read = (...keys: string[]): unknown => {
      for (const key of keys) {
        const value = keyMap.get(this.normalizeWebhookKey(key));
        if (value !== undefined && value !== null) {
          return value;
        }
      }
      return undefined;
    };

    return {
      ...parsed,
      StatusCode: this.toNumber(read('StatusCode', 'statusCode', 'status_code')),
      Amount: this.toNumber(read('Amount', 'amount')),
      ClientTransactionId: this.toStringValue(
        read('ClientTransactionId', 'clientTransactionId', 'client_transaction_id'),
      ),
      StoreId: this.toStringValue(read('StoreId', 'storeId', 'store_id')),
      TransactionStatus: this.toStringValue(
        read('TransactionStatus', 'transactionStatus', 'transaction_status'),
      ),
      TransactionId: read('TransactionId', 'transactionId', 'transaction_id') as
        | number
        | string
        | undefined,
    };
  }

  isApprovedPayment(payload: PayPhoneWebhookPayload): boolean {
    const statusCode = Number(payload.StatusCode ?? 0);
    const statusText = String(payload.TransactionStatus ?? '')
      .trim()
      .toLowerCase();

    return statusCode === 3 || statusText === 'approved';
  }

  isExpectedStore(payload: PayPhoneWebhookPayload): boolean {
    if (!this.webhookStoreId) {
      return true;
    }

    const expected = String(this.webhookStoreId).trim().toLowerCase();
    const incoming = String(payload.StoreId ?? '')
      .trim()
      .toLowerCase();
    return expected === incoming;
  }

  private extractPaymentUrl(rawResponse: string): string | null {
    if (!rawResponse) {
      return null;
    }

    if (/^https?:\/\//i.test(rawResponse)) {
      return rawResponse;
    }

    try {
      const parsed = JSON.parse(rawResponse) as unknown;

      if (typeof parsed === 'string' && /^https?:\/\//i.test(parsed)) {
        return parsed;
      }

      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        const directCandidates = [
          record.url,
          record.Url,
          record.link,
          record.Link,
          record.paymentUrl,
          record.PaymentUrl,
          record.checkoutUrl,
          record.CheckoutUrl,
        ];

        for (const candidate of directCandidates) {
          if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) {
            return candidate;
          }
        }

        const nestedData = record.data;
        if (nestedData && typeof nestedData === 'object') {
          const nested = nestedData as Record<string, unknown>;
          const nestedCandidates = [nested.url, nested.link, nested.paymentUrl, nested.checkoutUrl];
          for (const candidate of nestedCandidates) {
            if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) {
              return candidate;
            }
          }
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private toNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private toStringValue(value: unknown): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    const trimmed = String(value).trim();
    return trimmed ? trimmed : undefined;
  }

  private normalizeWebhookKey(key: string): string {
    return String(key || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private normalizeClientTransactionId(value: string): string {
    return String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 15);
  }
}
