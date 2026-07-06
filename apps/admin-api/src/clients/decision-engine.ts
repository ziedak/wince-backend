import { HttpClient } from '@org/http-client';
import type { Config } from '../config';

export interface RecalculateResponse {
  status: string;
  sessionId: string;
}

export interface ManualInterventionRequest {
  sessionId: string;
  type: 'price_reduction' | 'free_shipping' | 'countdown' | 'popup' | 'urgency';
  value: number;
  overrideCooldown?: boolean;
}

export interface ManualInterventionResponse {
  interventionId: string;
  status: 'sent' | 'skipped' | 'error';
  reason?: 'cooldown_active' | 'already_sent' | 'budget_exhausted' | 'lock_contention';
}

export class DecisionEngineClient {
  private readonly http: HttpClient;

  constructor(config: Config) {
    this.http = new HttpClient({
      baseURL: config.DECISION_ENGINE_URL,
      headers: { 'X-Internal-Secret': config.INTERNAL_SECRET },
      timeout: 10_000,
    });
  }

  async recalculate(sessionId: string): Promise<RecalculateResponse> {
    const res = await this.http.post<RecalculateResponse>('/v1/internal/recalculate', { sessionId });
    return res.data;
  }

  async manualIntervention(body: ManualInterventionRequest): Promise<ManualInterventionResponse> {
    const res = await this.http.post<ManualInterventionResponse>('/v1/internal/intervention/manual', body);
    return res.data;
  }

  async executeRecommendation(recommendationId: string): Promise<{ status: 'executed' | 'skipped'; interventionId?: string; reason?: string }> {
    const res = await this.http.post<{ status: 'executed' | 'skipped'; interventionId?: string; reason?: string }>(
      `/internal/execute/${encodeURIComponent(recommendationId)}`,
      {},
    );
    return res.data;
  }
}
