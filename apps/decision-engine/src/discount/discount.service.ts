import { createLogger } from '@org/logger';
import { discountCodes, type Db } from '@org/db';
import { randomBytes } from 'node:crypto';

export class DiscountService {
  private readonly logger = createLogger({ service: 'DiscountService' });

  constructor(private readonly db: Db) {}

  /**
   * Generates a unique discount code and persists it to the discount_codes table.
   * Format: CR-{storeId}-{8 uppercase alphanumeric characters}
   * Returns null when the DB insert fails — caller treats null as "no discount".
   */
  async generateCode(
    storeId: number,
    sessionId: string,
    value: number,
    interventionId?: string,
  ): Promise<string | null> {
    const code = `CR-${storeId}-${randomAlphanumeric(8)}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // +1 hour

    try {
      await this.db.insert(discountCodes).values({
        code,
        storeId,
        sessionId,
        interventionId: interventionId ?? null,
        value: String(value),
        expiresAt,
      });

      this.logger.debug({ storeId, code, expiresAt }, 'DiscountService: code generated');
      return code;
    } catch (err) {
      this.logger.warn({ err, storeId, sessionId }, 'DiscountService: DB insert failed');
      return null;
    }
  }
}

/**
 * Returns a cryptographically random uppercase alphanumeric string of the given length.
 * Uses rejection sampling to avoid modulo bias.
 */
function randomAlphanumeric(length: number): string {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const CHARS_LEN = CHARS.length; // 36
  // 256 / 36 = 7.11, so bytes >= 252 are rejected to avoid bias
  const REJECT_THRESHOLD = 256 - (256 % CHARS_LEN);

  const result: string[] = [];
  while (result.length < length) {
    const byte = randomBytes(1)[0]!;
    if (byte < REJECT_THRESHOLD) {
      result.push(CHARS[byte % CHARS_LEN]!);
    }
  }
  return result.join('');
}
