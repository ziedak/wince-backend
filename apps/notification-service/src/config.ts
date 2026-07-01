export interface Config {
  port: number;
  kafkaBrokers: string[];
  kafkaTopicNotificationLog: string;
  kafkaTopicDlq: string;
  /** Internal secret — must match INTERNAL_SECRET in decision-engine */
  internalSecret: string;
  /** SendGrid API key — undefined skips email sending in dev */
  sendgridApiKey: string | undefined;
  /** Twilio credentials — all three must be set to enable SMS */
  twilioAccountSid: string | undefined;
  twilioAuthToken: string | undefined;
  twilioFromNumber: string | undefined;
  logLevel: string;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env['PORT'] ?? '3006', 10),
    kafkaBrokers: optional('KAFKA_HOSTS', 'kafka:29092').split(','),
    kafkaTopicNotificationLog: optional('KAFKA_TOPIC_NOTIFICATION_LOG', 'notification.log'),
    kafkaTopicDlq: optional('KAFKA_TOPIC_DLQ', 'dead.letters'),
    internalSecret: optional('INTERNAL_SECRET', 'dev-internal-secret'),
    sendgridApiKey: process.env['SENDGRID_API_KEY'],
    twilioAccountSid: process.env['TWILIO_ACCOUNT_SID'],
    twilioAuthToken: process.env['TWILIO_AUTH_TOKEN'],
    twilioFromNumber: process.env['TWILIO_FROM_NUMBER'],
    logLevel: optional('LOG_LEVEL', 'info'),
  };
}
