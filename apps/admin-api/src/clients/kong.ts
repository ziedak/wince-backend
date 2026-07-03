import { HttpClient } from '@org/http-client';
import type { Config } from '../config';

export interface KongConsumer {
  id: string;
  username: string;
  custom_id?: string;
}

export interface KongApiKey {
  id: string;
  key: string;
  consumer: { id: string };
}

export class KongClient {
  private readonly http: HttpClient;

  constructor(config: Config) {
    this.http = new HttpClient({
      baseURL: config.KONG_ADMIN_URL,
      timeout: 10_000,
    });
  }

  async createConsumer(username: string, customId?: string): Promise<KongConsumer> {
    const res = await this.http.post<KongConsumer>('/consumers', {
      username,
      ...(customId && { custom_id: customId }),
    });
    return res.data;
  }

  async createApiKey(username: string, key: string): Promise<KongApiKey> {
    const res = await this.http.post<KongApiKey>(`/consumers/${encodeURIComponent(username)}/key-auth`, { key });
    return res.data;
  }

  async deleteApiKey(username: string, keyId: string): Promise<void> {
    await this.http.delete(`/consumers/${encodeURIComponent(username)}/key-auth/${encodeURIComponent(keyId)}`);
  }

  async deleteConsumer(username: string): Promise<void> {
    await this.http.delete(`/consumers/${encodeURIComponent(username)}`);
  }

  async listApiKeys(username: string): Promise<KongApiKey[]> {
    const res = await this.http.get<{ data: KongApiKey[] }>(`/consumers/${encodeURIComponent(username)}/key-auth`);
    return res.data.data;
  }
}
