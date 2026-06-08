import axios, { AxiosInstance, AxiosError } from "axios";

export interface SkleraConfig {
  baseUrl: string;
  apiToken: string;
}

export class SkleraClient {
  private http: AxiosInstance;
  private roomHttp: AxiosInstance;
  private apiToken: string;
  private baseUrl: string;

  constructor(config: SkleraConfig) {
    this.apiToken = config.apiToken;
    this.baseUrl = config.baseUrl;
    this.http = axios.create({
      baseURL: `${config.baseUrl}/data/api`,
      timeout: 15000,
      headers: { "Content-Type": "application/json" },
    });
    // Roommanager lives under a different base path (/channelApi/roomManager)
    // and authenticates via the apiToken query parameter rather than a header.
    // It is kept on a separate axios instance so the existing /data/api client
    // remains untouched.
    this.roomHttp = axios.create({
      baseURL: `${config.baseUrl}/channelApi/roomManager`,
      timeout: 15000,
    });
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    try {
      const res = await this.http.get<T>(path, {
        params,
        headers: { apiToken: this.apiToken },
      });
      return res.data;
    } catch (err) {
      const wrapped = this.wrapError(err);
      if (wrapped === null) return (err as AxiosError).response?.data as T;
      throw wrapped;
    }
  }

  async post<T>(path: string, body?: unknown, params?: Record<string, unknown>): Promise<T> {
    try {
      const res = await this.http.post<T>(path, body, {
        params,
        headers: { apiToken: this.apiToken },
      });
      return res.data;
    } catch (err) {
      const wrapped = this.wrapError(err);
      if (wrapped === null) {
        // Response indicated success despite non-2xx status
        return (err as AxiosError).response?.data as T;
      }
      throw wrapped;
    }
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    try {
      const res = await this.http.put<T>(path, body, {
        headers: { apiToken: this.apiToken },
      });
      return res.data;
    } catch (err) {
      const wrapped = this.wrapError(err);
      if (wrapped === null) return (err as AxiosError).response?.data as T;
      throw wrapped;
    }
  }

  async delete<T>(path: string, body?: unknown, params?: Record<string, unknown>): Promise<T> {
    try {
      const res = await this.http.delete<T>(path, {
        data: body,
        params,
        headers: { apiToken: this.apiToken },
      });
      return res.data;
    } catch (err) {
      const wrapped = this.wrapError(err);
      if (wrapped === null) return (err as AxiosError).response?.data as T;
      throw wrapped;
    }
  }

  /**
   * Generic request against the Roommanager API
   * (`{baseUrl}/channelApi/roomManager`).
   *
   * The Roommanager differs from the /data/api endpoints in two ways:
   *  - the apiToken is passed as a query parameter, not as a header;
   *  - request bodies are either JSON (rooms create/update/delete) or
   *    application/x-www-form-urlencoded (events).
   *
   * Supply exactly one of `jsonBody` or `formBody` (or neither for GET/path-only
   * calls). Array values inside `formBody` are JSON-stringified, matching the
   * Roommanager expectation for the `rooms` field on events.
   */
  async roomRequest<T>(opts: {
    method: "get" | "post" | "put" | "delete";
    path: string;
    query?: Record<string, unknown>;
    jsonBody?: unknown;
    formBody?: Record<string, unknown>;
  }): Promise<T> {
    const params = { ...(opts.query ?? {}), apiToken: this.apiToken };
    const headers: Record<string, string> = {};
    let data: unknown;

    if (opts.formBody) {
      const usp = new URLSearchParams();
      for (const [key, value] of Object.entries(opts.formBody)) {
        if (value === undefined || value === null) continue;
        usp.append(key, typeof value === "string" ? value : JSON.stringify(value));
      }
      data = usp;
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (opts.jsonBody !== undefined) {
      data = opts.jsonBody;
      headers["Content-Type"] = "application/json";
    }

    try {
      const res = await this.roomHttp.request<T>({
        method: opts.method,
        url: opts.path,
        params,
        data,
        headers,
      });
      return res.data;
    } catch (err) {
      const wrapped = this.wrapError(err);
      if (wrapped === null) return (err as AxiosError).response?.data as T;
      throw wrapped;
    }
  }

  private wrapError(err: unknown): Error | null {
    if (axios.isAxiosError(err)) {
      const axErr = err as AxiosError<Record<string, unknown>>;
      const responseData = axErr.response?.data;
      const status = axErr.response?.status;

      const rd: unknown = responseData;
      if (rd === true ||
          rd === "true" ||
          (responseData && responseData["success"] === true)) {
        return null;
      }

      const msg =
        (responseData?.["error"] as string | undefined) ??
        (responseData?.["message"] as string | undefined) ??
        (responseData ? JSON.stringify(responseData) : axErr.message);

      return new Error(`Sklera API error ${status ?? "unknown"}: ${msg}`);
    }
    if (err instanceof Error) return err;
    return new Error(String(err));
  }
}

export function formatToolError(err: unknown): string {
  if (err instanceof Error) return `Error: ${err.message}`;
  return `Error: ${String(err)}`;
}

export function successText(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
