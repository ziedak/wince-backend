import axios, { AxiosRequestConfig, AxiosResponse, AxiosError, AxiosHeaders } from "axios";
import { executeWithRetry } from "@org/utils";

/**
 * HTTP Client Configuration Interface
 */
export interface HttpClientConfig {
  timeout?: number;
  headers?: Record<string, string>;
  baseURL?: string;
  retries?: number;
  retryDelay?: number;
  enableRequestId?: boolean;
  errorTransformer?: (error: HttpErrorResponse) => unknown;
}

/**
 * HTTP Error Response Interface
 */
export interface HttpErrorResponse {
  status: number;
  statusText: string;
  data?: unknown;
  message: string;
}

/**
 * Enhanced HTTP Client with better configuration and error handling
 */
export class HttpClient {
  private client: ReturnType<typeof axios.create>;
  private config: HttpClientConfig;

  constructor(config: HttpClientConfig = {}) {
    this.config = {
      timeout: 5000,
      headers: { "Content-Type": "application/json" },
      retries: 3,
      retryDelay: 500,
      enableRequestId: true,
      ...config,
    };

    const axiosConfig: AxiosRequestConfig = {
      timeout: this.config.timeout ?? 5000,
      headers: {
        "Content-Type": "application/json",
        ...(this.config.headers ?? {}),
      },
      ...(this.config.baseURL && { baseURL: this.config.baseURL }),
    };

    this.client = axios.create(axiosConfig);

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        const headers = AxiosHeaders.from(config.headers ?? {});

        // Add request ID for tracking if enabled
        if (this.config.enableRequestId) {
          headers.set("X-Request-ID", crypto.randomUUID());
        }

        // Handle form-urlencoded data properly
        // If data is already a string and Content-Type is form-urlencoded,
        // prevent Axios from applying JSON transformers
        const contentType = headers.get("Content-Type") ?? headers.get("content-type");
        if (
          typeof config.data === "string" &&
          contentType === "application/x-www-form-urlencoded"
        ) {
          // Use identity transformer to preserve the string as-is
          config.transformRequest = [(data) => data];
        }

        config.headers = headers;

        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const errorResponse: HttpErrorResponse = {
          status: error.response?.status || 0,
          statusText: error.response?.statusText || "Unknown Error",
          data: error.response?.data,
          message: error.message,
        };
        if (typeof this.config.errorTransformer === "function") {
          return Promise.reject(this.config.errorTransformer(errorResponse));
        }
        return Promise.reject(errorResponse);
      }
    );
  }

  /**
   * Execute request with retry logic
   */
  private async executeWithRetry<T>(
    operation: () => Promise<AxiosResponse<T>>
  ): Promise<AxiosResponse<T>> {
    return executeWithRetry(
      operation,
      (error: unknown) => {
        if (error && typeof error === "object" && "status" in error) {
          const httpError = error as HttpErrorResponse;
          return `HTTP ${httpError.status}: ${httpError.message}`;
        }
        return `HTTP request failed: ${String(error)}`;
      },
      {
        operationName: "HTTP Request",
        maxRetries: this.config.retries ?? 3,
        retryDelay: this.config.retryDelay ?? 500,
        enableCircuitBreaker: true,
      }
    );
  }

  async request<T = unknown>(
    config: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(() => this.client.request<T>(config));
  }

  /**
   * Make a request and return parsed JSON data
   */
  async requestJson<T = unknown>(config: AxiosRequestConfig): Promise<T> {
    const response = await this.request<T>(config);
    return response.data;
  }
  /**
   * GET request that returns JSON data
   */
  async get<T = unknown>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: "GET", url });
  }
  /**
   * POST request that returns JSON data
   */
  async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.request<T>({
      ...config,
      method: "POST",
      url,
      data,
    });
  }
  /**
   * PUT request that returns JSON data
   */
  async put<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.request<T>({
      ...config,
      method: "PUT",
      url,
      data,
    });
  }
  /**
   * DELETE request that returns JSON data
   */
  async delete<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.request<T>({
      ...config,
      method: "DELETE",
      url,
      data,
    });
  }
}

/**
 * Create a typed HTTP client for specific API endpoints
 */
export function createHttpClient(config: HttpClientConfig = {}): HttpClient {
  return new HttpClient(config);
}

/**
 * HTTP status code utilities
 */
export const HttpStatus = {
  isSuccess: (status: number): boolean => status >= 200 && status < 300,
  isClientError: (status: number): boolean => status >= 400 && status < 500,
  isServerError: (status: number): boolean => status >= 500,
  isRetryable: (status: number): boolean =>
    status >= 500 || status === 408 || status === 429,
} as const;