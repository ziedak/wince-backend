import { createLogger } from '@org/logger';
import { executeWithRetry } from '@org/utils';

// Health check utility
export interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  lastCheck: number;
  details?: Record<string, unknown>;
}

export class HealthChecker {
  private checks: Map<
    string,
    { fn: () => Promise<boolean>; timeout?: number | undefined }
  > = new Map();
  private results: Map<string, HealthCheck> = new Map();

  private logger = createLogger({ service: 'HealthChecker' });

  registerCheck(
    name: string,
    checkFn: () => Promise<boolean>,
    timeoutMs?: number | undefined,
  ) {
    this.checks.set(name, { fn: checkFn, timeout: timeoutMs });
  }

  async runChecks(): Promise<HealthCheck[]> {
    const results: HealthCheck[] = [];
    let details: Record<string, unknown> = {};
    for (const [name, { fn, timeout }] of this.checks.entries()) {
      const startTime = Date.now();
      let status: 'healthy' | 'unhealthy' | 'degraded' = 'unhealthy';

      try {
        const result = await executeWithRetry(
          async () => {
            return await Promise.race([
              fn(),
              new Promise<boolean>((_, reject) =>
                setTimeout(
                  () => reject(new Error('Health check timeout')),
                  timeout ?? 5000,
                ),
              ),
            ]);
          },
          (err) => {
            if (this.logger)
              this.logger.warn(`[HealthChecker] ${name} error: ${err}`);
          },
          { operationName: name, maxRetries: 2, retryDelay: 500 },
        );

        const responseTime = Date.now() - startTime;
        if (result) {
          status = responseTime > (timeout ?? 5000) ? 'degraded' : 'healthy';
        }
        details = { responseTime };
      } catch (error) {
        details = {
          error: error instanceof Error ? error.message : String(error),
        };
        if (this.logger)
          this.logger.error({
            message: `[HealthChecker] ${name} failed:`,
            error,
          });
      }
      const healthCheck: HealthCheck = {
        name,
        status,
        lastCheck: startTime,
        details,
      };
      this.results.set(name, healthCheck);
      results.push(healthCheck);
    }
    return results;
  }

  getCheck(name: string): HealthCheck | undefined {
    return this.results.get(name);
  }

  getAllChecks(): HealthCheck[] {
    return Array.from(this.results.values());
  }
}
