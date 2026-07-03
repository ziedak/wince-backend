import { auditLogs } from '@org/db';
import type { DbClient } from '../types';

export interface AuditEntry {
  adminUserId?: number;
  storeId?: number;
  action: string;
  target?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
}

export class AuditService {
  constructor(private readonly db: DbClient) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditLogs).values({
      adminUserId: entry.adminUserId,
      storeId: entry.storeId,
      action: entry.action,
      target: entry.target,
      details: entry.details,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      success: entry.success,
    });
  }
}
