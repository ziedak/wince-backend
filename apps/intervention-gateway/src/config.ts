export interface Config {
  port: number;
  redisUrl: string;
  /** Internal secret — must match INTERNAL_SECRET in decision-engine */
  internalSecret: string;
  /** IP address of this pod, used for multi-pod WS routing */
  podIp: string;
  /** TTL in seconds for ws:active Redis keys; renewed on each heartbeat */
  wsTtlSeconds: number;
  /** Default pending intervention TTL when no policy override */
  pendingTtlSeconds: number;
  logLevel: string;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env['PORT'] ?? '3005', 10),
    redisUrl: optional('REDIS_URL', 'redis://redis:6379'),
    internalSecret: optional('INTERNAL_SECRET', 'dev-internal-secret'),
    podIp: optional('POD_IP', '127.0.0.1'),
    wsTtlSeconds: parseInt(process.env['WS_TTL_SECONDS'] ?? '60', 10),
    pendingTtlSeconds: parseInt(process.env['PENDING_TTL_SECONDS'] ?? '1800', 10),
    logLevel: optional('LOG_LEVEL', 'info'),
  };
}
