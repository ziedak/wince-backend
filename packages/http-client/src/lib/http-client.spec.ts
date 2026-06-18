import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpClient, HttpClient, HttpStatus } from './http-client.js';
import axios from 'axios';
import  { executeWithRetry }  from '@org/utils';
vi.mock('axios', () => {
  class MockAxiosHeaders {
    private readonly values = new Map<string, string>();

    static from(initial?: Record<string, string> | MockAxiosHeaders) {
      return initial instanceof MockAxiosHeaders
        ? initial
        : new MockAxiosHeaders(initial);
    }

    constructor(initial: Record<string, string> = {}) {
      for (const [key, value] of Object.entries(initial)) {
        this.set(key, value);
      }
    }

    set(name: string, value: string): this {
      this.values.set(name.toLowerCase(), value);
      return this;
    }

    get(name: string): string | undefined {
      return this.values.get(name.toLowerCase());
    }
  }

  const create = vi.fn(() => ({
    request: vi.fn(),
    interceptors: {
      request: {
        use: vi.fn(),
      },
      response: {
        use: vi.fn(),
      },
    },
  }));

  return {
    default: { create },
    create,
    AxiosHeaders: MockAxiosHeaders,
  };
});

vi.mock('@org/utils', () => ({
  executeWithRetry: vi.fn(async (operation: () => Promise<unknown>) => operation()),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

async function getAxiosMock() {
  
  return axios.create as unknown as ReturnType<typeof vi.fn>;
}

async function getUtilsMock() {

  return executeWithRetry as unknown as ReturnType<typeof vi.fn>;
}

describe('HttpClient', () => {
  it('merges defaults and custom config when creating axios client', async () => {
    createHttpClient({
      baseURL: 'https://api.example.com',
      timeout: 2500,
      retries: 2,
      retryDelay: 125,
      headers: { Authorization: 'Bearer token' },
    });

    const axiosCreate = await getAxiosMock();
    expect(axiosCreate).toHaveBeenCalledTimes(1);
    expect(axiosCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 2500,
        baseURL: 'https://api.example.com',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
      }),
    );
  });

  it('adds a request id and preserves urlencoded payloads', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '123e4567-e89b-12d3-a456-426614174000',
    );

    new HttpClient({ enableRequestId: true });

    const axiosCreate = await getAxiosMock();
    const mockClient = axiosCreate.mock.results[0]?.value as {
      interceptors: {
        request: { use: ReturnType<typeof vi.fn> };
        response: { use: ReturnType<typeof vi.fn> };
      };
    };

    const requestInterceptor = mockClient.interceptors.request.use.mock.calls[0]?.[0];
    const intercepted = requestInterceptor({
      data: 'a=1&b=2',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    expect(intercepted.headers.get('X-Request-ID')).toBe(
      '123e4567-e89b-12d3-a456-426614174000',
    );
    expect(intercepted.transformRequest?.[0]('raw=value')).toBe('raw=value');
  });

  it('transforms axios errors and supports a custom error transformer', async () => {
    const errorTransformer = vi.fn((error) => ({
      kind: 'wrapped' as const,
      status: error.status,
    }));

    new HttpClient({ errorTransformer });

    const axiosCreate = await getAxiosMock();
    const mockClient = axiosCreate.mock.results[0]?.value as {
      interceptors: {
        request: { use: ReturnType<typeof vi.fn> };
        response: { use: ReturnType<typeof vi.fn> };
      };
    };

    const responseInterceptor = mockClient.interceptors.response.use.mock.calls[0]?.[1];
    const axiosError = {
      response: {
        status: 503,
        statusText: 'Service Unavailable',
        data: { detail: 'down' },
      },
      message: 'boom',
    };

    await expect(responseInterceptor(axiosError)).rejects.toEqual({
      kind: 'wrapped',
      status: 503,
    });
    expect(errorTransformer).toHaveBeenCalledWith({
      status: 503,
      statusText: 'Service Unavailable',
      data: { detail: 'down' },
      message: 'boom',
    });
  });

  it('delegates through executeWithRetry and exposes convenience methods', async () => {
    const client = new HttpClient({ retries: 0, retryDelay: 0 });

    const axiosCreate = await getAxiosMock();
    const mockClient = axiosCreate.mock.results[0]?.value as { request: ReturnType<typeof vi.fn> };
    mockClient.request.mockResolvedValue({ data: { ok: true } });

    const utilsExecuteWithRetry = await getUtilsMock();

    const response = await client.post<{ ok: boolean }>(
      '/items',
      { name: 'book' },
      { headers: { Accept: 'application/json' } },
    );

    expect(response.data).toEqual({ ok: true });
    expect(utilsExecuteWithRetry).toHaveBeenCalledTimes(1);
    expect(utilsExecuteWithRetry.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        maxRetries: 0,
        retryDelay: 0,
      }),
    );
    expect(mockClient.request).toHaveBeenCalledWith({
      headers: { Accept: 'application/json' },
      method: 'POST',
      url: '/items',
      data: { name: 'book' },
    });

    const json = await client.requestJson<{ ok: boolean }>({ url: '/items/1', method: 'GET' });
    expect(json).toEqual({ ok: true });

    expect(HttpStatus.isSuccess(204)).toBe(true);
    expect(HttpStatus.isClientError(404)).toBe(true);
    expect(HttpStatus.isServerError(500)).toBe(true);
    expect(HttpStatus.isRetryable(429)).toBe(true);
  });
});