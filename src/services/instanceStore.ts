import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { InstanceConfig } from "./registry.js";

/**
 * Persistent, runtime-mutable store for dynamically added Sklera instances
 * ("Muster A": add/list/test/remove instances at runtime without a reconnect
 * or restart).
 *
 * Design constraints honoured here:
 *  - Tokens are encrypted at rest (AES-256-GCM); only baseUrl and an optional
 *    label are stored in clear text.
 *  - The on-disk file is re-read whenever its mtime changes, so every request
 *    that builds a fresh registry sees the current instance list (the registry
 *    in HTTP mode is rebuilt per request and consults this store on resolve()).
 *  - Tokens are never exposed in clear text through any read API; list() only
 *    returns a masked form.
 */

const DEFAULT_STORE_FILE = "dynamic-instances.json";
const SCRYPT_SALT = "sklera-mcp-instance-store-v1";

/** Encrypted, on-disk representation of a single dynamic instance. */
interface StoredEntry {
  baseUrl: string;
  label?: string;
  /** AES-256-GCM payload, encoded as base64(iv):base64(authTag):base64(ciphertext). */
  token: string;
  createdAt: string;
  updatedAt: string;
}

interface StoreShape {
  instances: Record<string, StoredEntry>;
}

/** Masked, safe-to-display view of a dynamic instance. */
export interface DynamicInstanceInfo {
  name: string;
  baseUrl: string;
  label?: string;
  tokenMasked: string;
  createdAt: string;
  updatedAt: string;
}

/** Resolves the store file path from the environment, with a sane default. */
export function resolveStoreFile(): string {
  const configured = process.env.SKLERA_DYNAMIC_INSTANCES_FILE?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_STORE_FILE;
}

/**
 * Masks a token to its last 4 characters, never revealing the full value.
 * Short or empty tokens collapse to a fixed mask so length is not leaked.
 */
export function maskToken(token: string): string {
  if (token.length <= 4) return "****";
  return `…${token.slice(-4)}`;
}

/**
 * Derives the 32-byte AES key. Prefers an explicit SKLERA_INSTANCE_SECRET
 * (recommended for reproducible decryption across restarts). Without it, a
 * random key is generated once and persisted to a 0600 key file beside the
 * store so existing entries stay readable.
 */
function resolveKey(keyFile: string): Buffer {
  const secret = process.env.SKLERA_INSTANCE_SECRET;
  if (secret && secret.length > 0) {
    return scryptSync(secret, SCRYPT_SALT, 32);
  }
  try {
    const existing = readFileSync(keyFile);
    if (existing.length === 32) return existing;
  } catch {
    // No key file yet; fall through and create one.
  }
  const key = randomBytes(32);
  try {
    mkdirSync(dirname(keyFile), { recursive: true });
    writeFileSync(keyFile, key, { mode: 0o600 });
  } catch {
    // If the key cannot be persisted we still return it for this process; a
    // restart would then invalidate previously stored tokens. This is logged
    // by the caller path only indirectly to avoid leaking the file location.
  }
  return key;
}

export class DynamicInstanceStore {
  private readonly key: Buffer;
  private cache: StoreShape = { instances: {} };
  private cacheMtimeMs = -1;
  private loaded = false;

  constructor(
    private readonly storeFile: string,
    keyFile?: string
  ) {
    this.key = resolveKey(keyFile ?? `${storeFile}.key`);
  }

  // --- crypto ------------------------------------------------------------

  private encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
  }

  private decrypt(payload: string): string {
    const [ivB64, tagB64, ctB64] = payload.split(":");
    if (!ivB64 || !tagB64 || !ctB64) {
      throw new Error("Malformed encrypted instance token");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  // --- persistence -------------------------------------------------------

  /**
   * Reloads the store from disk when the file changed (mtime) or was never
   * read. Keeps the in-memory cache authoritative between writes within the
   * same process while still picking up out-of-band changes per request.
   */
  private reloadIfChanged(): void {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(this.storeFile).mtimeMs;
    } catch {
      // File does not exist (yet): empty store.
      if (!this.loaded) {
        this.cache = { instances: {} };
        this.loaded = true;
      }
      return;
    }
    if (this.loaded && mtimeMs === this.cacheMtimeMs) return;
    try {
      const raw = readFileSync(this.storeFile, "utf8");
      const parsed = JSON.parse(raw) as StoreShape;
      this.cache = { instances: parsed.instances ?? {} };
    } catch {
      this.cache = { instances: {} };
    }
    this.cacheMtimeMs = mtimeMs;
    this.loaded = true;
  }

  private persist(): void {
    mkdirSync(dirname(this.storeFile) === "" ? "." : dirname(this.storeFile), {
      recursive: true,
    });
    writeFileSync(this.storeFile, JSON.stringify(this.cache, null, 2), {
      mode: 0o600,
    });
    try {
      this.cacheMtimeMs = statSync(this.storeFile).mtimeMs;
    } catch {
      this.cacheMtimeMs = -1;
    }
  }

  // --- read API ----------------------------------------------------------

  /** Returns the names of all dynamic instances. */
  names(): string[] {
    this.reloadIfChanged();
    return Object.keys(this.cache.instances);
  }

  has(name: string): boolean {
    this.reloadIfChanged();
    return Object.prototype.hasOwnProperty.call(this.cache.instances, name);
  }

  /**
   * Returns the decrypted connection config for a single instance, or
   * undefined if it is not stored. Used by the registry to build a client on
   * demand; never exposed to tool output.
   */
  config(name: string): InstanceConfig | undefined {
    this.reloadIfChanged();
    const entry = this.cache.instances[name];
    if (!entry) return undefined;
    return { baseUrl: entry.baseUrl, apiToken: this.decrypt(entry.token) };
  }

  /** Masked listing of all dynamic instances (no clear-text tokens). */
  list(): DynamicInstanceInfo[] {
    this.reloadIfChanged();
    return Object.entries(this.cache.instances).map(([name, entry]) => ({
      name,
      baseUrl: entry.baseUrl,
      label: entry.label,
      tokenMasked: maskToken(this.safeDecrypt(entry.token)),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }));
  }

  /** Decrypts but never throws, so a single corrupt entry cannot break list(). */
  private safeDecrypt(payload: string): string {
    try {
      return this.decrypt(payload);
    } catch {
      return "";
    }
  }

  // --- write API ---------------------------------------------------------

  /**
   * Adds a new dynamic instance or updates an existing one. The token is
   * encrypted before being written. `nowIso` is injected so callers control
   * timestamps (and tests stay deterministic).
   */
  add(input: {
    name: string;
    baseUrl: string;
    apiToken: string;
    label?: string;
    nowIso: string;
  }): void {
    this.reloadIfChanged();
    const existing = this.cache.instances[input.name];
    this.cache.instances[input.name] = {
      baseUrl: input.baseUrl,
      label: input.label,
      token: this.encrypt(input.apiToken),
      createdAt: existing?.createdAt ?? input.nowIso,
      updatedAt: input.nowIso,
    };
    this.persist();
  }

  /** Removes a dynamic instance. Returns true if something was removed. */
  remove(name: string): boolean {
    this.reloadIfChanged();
    if (!this.cache.instances[name]) return false;
    delete this.cache.instances[name];
    this.persist();
    return true;
  }
}

let sharedStore: DynamicInstanceStore | null = null;

/**
 * Lazily constructs the process-wide shared store from the environment.
 *
 * Note: the store is process-global and not partitioned per OAuth user. For
 * this self-hosted single-operator deployment that is an intentional, KISS
 * trade-off; multi-tenant isolation would require per-principal stores.
 */
export function getSharedInstanceStore(): DynamicInstanceStore {
  if (!sharedStore) {
    sharedStore = new DynamicInstanceStore(resolveStoreFile());
  }
  return sharedStore;
}
