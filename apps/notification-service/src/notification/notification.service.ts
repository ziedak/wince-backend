import { createLogger } from '@org/logger';
import type { NotificationRequest } from '@org/types';
import type { Config } from '../config.js';
import type { NotificationMetrics } from '../metrics.js';

const logger = createLogger({ service: 'NotificationService' });

export type NotificationOutcome = 'delivered' | 'skipped' | 'failed';

export interface NotificationResult {
  outcome: NotificationOutcome;
  channel: 'email' | 'sms';
  reason?: string;
}

/**
 * Sends email or SMS for a given NotificationRequest.
 *
 * Consent is checked here (last line of defence — Decision Engine also checked).
 * Returns NotificationResult — never throws.
 *
 * sendgrid and twilio are dynamically imported so the service starts cleanly
 * when credentials are absent (dev / local without external accounts).
 */
export class NotificationService {
  constructor(
    private readonly config: Config,
    private readonly metrics: NotificationMetrics,
  ) {}

  async send(req: NotificationRequest): Promise<NotificationResult> {
    if (req.type === 'email') {
      return this.sendEmail(req);
    }
    return this.sendSms(req);
  }

  private async sendEmail(req: NotificationRequest): Promise<NotificationResult> {
    if (!req.emailConsent) {
      this.metrics.notificationSent('email', 'skipped');
      logger.debug({ interventionId: req.interventionId }, 'Email skipped — no consent');
      return { outcome: 'skipped', channel: 'email', reason: 'no_consent' };
    }

    if (!req.email) {
      this.metrics.notificationSent('email', 'skipped');
      logger.debug({ interventionId: req.interventionId }, 'Email skipped — no email address');
      return { outcome: 'skipped', channel: 'email', reason: 'no_email_address' };
    }

    if (!this.config.sendgridApiKey) {
      this.metrics.notificationSent('email', 'skipped');
      logger.warn({ interventionId: req.interventionId }, 'Email skipped — SENDGRID_API_KEY not configured');
      return { outcome: 'skipped', channel: 'email', reason: 'no_api_key' };
    }

    const sgMail = await import('@sendgrid/mail');
    sgMail.default.setApiKey(this.config.sendgridApiKey);

    await sgMail.default.send({
      to: req.email,
      from: 'noreply@wince.app',
      templateId: req.templateId,
      dynamicTemplateData: {
        ...req.templateData,
        interventionId: req.interventionId,
        storeId: req.storeId,
      },
    } as Parameters<typeof sgMail.default.send>[0]);

    this.metrics.notificationSent('email', 'success');
    logger.info({ interventionId: req.interventionId, to: req.email }, 'Email sent');
    return { outcome: 'delivered', channel: 'email' };
  }

  private async sendSms(req: NotificationRequest): Promise<NotificationResult> {
    if (!req.smsConsent) {
      this.metrics.notificationSent('sms', 'skipped');
      logger.debug({ interventionId: req.interventionId }, 'SMS skipped — no consent');
      return { outcome: 'skipped', channel: 'sms', reason: 'no_consent' };
    }

    if (!req.phone) {
      this.metrics.notificationSent('sms', 'skipped');
      logger.debug({ interventionId: req.interventionId }, 'SMS skipped — no phone number');
      return { outcome: 'skipped', channel: 'sms', reason: 'no_phone' };
    }

    const { twilioAccountSid, twilioAuthToken, twilioFromNumber } = this.config;
    if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber) {
      this.metrics.notificationSent('sms', 'skipped');
      logger.warn({ interventionId: req.interventionId }, 'SMS skipped — Twilio credentials not configured');
      return { outcome: 'skipped', channel: 'sms', reason: 'no_credentials' };
    }

    const { default: Twilio } = await import('twilio');
    const client = Twilio(twilioAccountSid, twilioAuthToken);

    const body = req.templateData.discountCode
      ? `Your exclusive offer: use code ${req.templateData.discountCode} for your cart. Limited time!`
      : 'You left something in your cart! Come back and complete your purchase.';

    await client.messages.create({
      body,
      from: twilioFromNumber,
      to: req.phone,
    });

    this.metrics.notificationSent('sms', 'success');
    logger.info({ interventionId: req.interventionId, to: req.phone }, 'SMS sent');
    return { outcome: 'delivered', channel: 'sms' };
  }
}
