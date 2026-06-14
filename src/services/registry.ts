import { SkleraClient, SkleraConfig } from "./client.js";

/**
 * Configuration for a single named Sklera instance (domain + token).
 * Identical in shape to SkleraConfig; aliased for clarity in env parsing.
 */
export type InstanceConfig = SkleraConfig;

/**
 * Parsed multi-instance payload, identical in shape to the SKLERA_INSTANCES
 * environment variable and the x-sklera-instances header. Reused by the env,
 * header and OAuth code paths.
 */
export interface InstancesPayload {
  default?: string;
  instances?: Record<string, InstanceConfig>;
}

/**
 * Validates a parsed multi-instance payload and builds a ClientRegistry from it.
 *
 * Shared by loadRegistryFromEnv, loadRegistryFromHeaders and the OAuth branch in
 * index.ts so the validation rules (non-empty instances, each with baseUrl and
 * apiToken, default falls back to the first instance) live in exactly one place.
 *
 * @param parsed the already-JSON-parsed payload
 * @param label  source name used in error messages (e.g. "SKLERA_INSTANCES")
 */
export function buildRegistryFromInstances(
  parsed: InstancesPayload,
  label: string
): ClientRegistry {
  const instances = parsed.instances ?? {};
  const names = Object.keys(instances);
  if (names.length === 0) {
    throw new Error(`${label} contains no instances`);
  }
  for (const [name, cfg] of Object.entries(instances)) {
    if (!cfg || !cfg.baseUrl || !cfg.apiToken) {
      throw new Error(`Instance "${name}" must define both baseUrl and apiToken`);
    }
  }
  return new ClientRegistry(instances, parsed.default ?? names[0]);
}

/**
 * Holds one SkleraClient per configured Sklera instance (domain).
 *
 * Supports both the legacy single-instance setup
 * (SKLERA_API_TOKEN + SKLERA_BASE_URL) and a future-proof multi-instance
 * setup via the SKLERA_INSTANCES JSON environment variable.
 */
export class ClientRegistry {
  private clients = new Map<string, SkleraClient>();
  private defaultName: string;

  constructor(instances: Record<string, InstanceConfig>, defaultName: string) {
    for (const [name, cfg] of Object.entries(instances)) {
      this.clients.set(name, new SkleraClient(cfg));
    }
    if (!this.clients.has(defaultName)) {
      throw new Error(`Default instance "${defaultName}" is not configured`);
    }
    this.defaultName = defaultName;
  }

  /** Returns the client for the default instance. */
  default(): SkleraClient {
    return this.clients.get(this.defaultName) as SkleraClient;
  }

  /**
   * Resolves a client by instance name. Falls back to the default instance
   * when no name is supplied. Throws a descriptive error for unknown names.
   */
  resolve(instance?: string): SkleraClient {
    if (!instance) return this.default();
    const client = this.clients.get(instance);
    if (!client) {
      const available = [...this.clients.keys()].join(", ");
      throw new Error(
        `Unknown Sklera instance "${instance}". Configured instances: ${available}`
      );
    }
    return client;
  }

  /** Lists the names of all configured instances. */
  names(): string[] {
    return [...this.clients.keys()];
  }

  /** Returns the name of the default instance. */
  defaultInstanceName(): string {
    return this.defaultName;
  }
}

/**
 * Builds a ClientRegistry from environment variables.
 *
 * Precedence:
 *  1. SKLERA_INSTANCES (JSON) for multiple named domains, e.g.
 *     {
 *       "default": "my",
 *       "instances": {
 *         "my":         { "baseUrl": "https://my.sklera.tv",        "apiToken": "TOKEN_A" },
 *         "gehtsichaus":{ "baseUrl": "https://sklera.gehtsichaus.net","apiToken": "TOKEN_B" }
 *       }
 *     }
 *  2. Legacy SKLERA_API_TOKEN (+ optional SKLERA_BASE_URL) as a single
 *     instance named "default".
 */
export function loadRegistryFromEnv(): ClientRegistry {
  const instancesRaw = process.env.SKLERA_INSTANCES;

  if (instancesRaw) {
    let parsed: InstancesPayload;
    try {
      parsed = JSON.parse(instancesRaw) as InstancesPayload;
    } catch (err) {
      throw new Error(`SKLERA_INSTANCES is not valid JSON: ${String(err)}`);
    }
    return buildRegistryFromInstances(parsed, "SKLERA_INSTANCES");
  }

  // Legacy single-instance configuration.
  const apiToken = process.env.SKLERA_API_TOKEN ?? "";
  const baseUrl = process.env.SKLERA_BASE_URL ?? "https://my.sklera.tv";
  if (!apiToken) {
    throw new Error(
      "No Sklera credentials configured. Set SKLERA_API_TOKEN (+ optional SKLERA_BASE_URL), or SKLERA_INSTANCES for multiple domains."
    );
  }
  return new ClientRegistry({ default: { baseUrl, apiToken } }, "default");
}

/**
 * Builds a per-request ClientRegistry from HTTP headers (remote mode).
 *
 * Precedence:
 *  1. `x-sklera-instances`: full multi-instance JSON, identical in shape to
 *     the SKLERA_INSTANCES environment variable. Allows one remote user to
 *     address several Sklera domains via the `instance` tool parameter.
 *  2. `x-sklera-token` (+ optional `x-sklera-url`, default
 *     https://my.sklera.tv) as a single instance named "default".
 *
 * Returns null when no credential headers are present, so the caller can
 * decide whether to fall back to an env-based registry or reject the request.
 * Header values are never logged.
 */
export function loadRegistryFromHeaders(
  headers: Record<string, string | string[] | undefined>
): ClientRegistry | null {
  const single = (name: string): string | undefined => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const instancesRaw = single("x-sklera-instances");
  if (instancesRaw) {
    let parsed: InstancesPayload;
    try {
      parsed = JSON.parse(instancesRaw) as InstancesPayload;
    } catch (err) {
      throw new Error(`x-sklera-instances header is not valid JSON: ${String(err)}`);
    }
    return buildRegistryFromInstances(parsed, "x-sklera-instances header");
  }

  const apiToken = single("x-sklera-token");
  if (!apiToken) return null;

  const baseUrl = single("x-sklera-url") ?? "https://my.sklera.tv";
  return new ClientRegistry({ default: { baseUrl, apiToken } }, "default");
}
