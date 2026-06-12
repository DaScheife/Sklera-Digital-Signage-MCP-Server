import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Self-contained OAuth 2.1 Authorization Server for the Sklera MCP server.
 *
 * Background
 * ----------
 * The Sklera Data API authenticates with a non-standard `apiToken` header,
 * not OAuth. Claude's GUI "custom connector" flow, however, speaks the MCP
 * Authorization spec (RFC 9728 protected-resource metadata, RFC 8414 AS
 * metadata, RFC 7591 dynamic client registration, OAuth 2.1 + PKCE). It has
 * no field for a static header, so a bare header-auth server cannot be added
 * through the GUI and registration fails ("Registrierung beim Anmeldedienst
 * fehlgeschlagen").
 *
 * This provider bridges the gap: it implements a minimal OAuth 2.1 AS whose
 * sole job is to collect the user's Sklera apiToken through a login page
 * during the authorization step and bind it to the issued bearer token. The
 * MCP request handler later reads that Sklera token back out of the validated
 * access token and builds the per-request ClientRegistry from it.
 *
 * Trade-offs (documented for transparency, not hidden):
 * - Tokens are stored in memory by default; on process restart all sessions
 *   are invalidated and users must re-authorize. Set OAUTH_STORE_FILE to
 *   persist clients and tokens to disk (the Sklera apiToken is then stored at
 *   rest in plaintext; protect the file accordingly).
 * - PKCE (S256) is enforced by the SDK token handler via the challenge this
 *   provider returns from challengeForAuthorizationCode().
 */

interface StoredAuthCode {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  skleraToken: string;
  baseUrl: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
}

interface StoredAccessToken {
  clientId: string;
  skleraToken: string;
  baseUrl: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
}

interface StoredRefreshToken {
  clientId: string;
  skleraToken: string;
  baseUrl: string;
  scopes: string[];
  resource?: string;
}

interface PersistShape {
  clients: Record<string, OAuthClientInformationFull>;
  accessTokens: Record<string, StoredAccessToken>;
  refreshTokens: Record<string, StoredRefreshToken>;
}

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_SKLERA_URL = "https://my.sklera.tv";

function randomId(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Best-effort validation of a Sklera apiToken: a successful channel listing
 * proves the token is accepted by the target instance. Network errors are
 * treated as "could not validate" and reported, so a wrong base URL does not
 * masquerade as a wrong token.
 */
async function validateSkleraToken(
  baseUrl: string,
  apiToken: string
): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/data/api/channels/list`, {
      method: "GET",
      headers: { apiToken, "Content-Type": "application/json" },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "Token wurde von der Sklera-Instanz abgelehnt (401/403)." };
    }
    if (!res.ok) {
      return { ok: false, message: `Sklera-Instanz antwortete mit HTTP ${res.status}.` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: `Sklera-Instanz unter ${escapeHtml(baseUrl)} nicht erreichbar: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  constructor(private readonly provider: SkleraOAuthProvider) {}

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.provider.getClient(clientId);
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">
  ): OAuthClientInformationFull {
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: randomId(16),
      client_id_issued_at: nowSeconds(),
    };
    // Public clients (PKCE, no secret) are the norm for Claude connectors.
    // Only mint a secret when the client explicitly asks for a confidential
    // auth method.
    if (client.token_endpoint_auth_method && client.token_endpoint_auth_method !== "none") {
      full.client_secret = randomId(24);
      full.client_secret_expires_at = 0; // never expires
    }
    this.provider.putClient(full);
    return full;
  }
}

export class SkleraOAuthProvider implements OAuthServerProvider {
  private clients = new Map<string, OAuthClientInformationFull>();
  private authCodes = new Map<string, StoredAuthCode>();
  private accessTokens = new Map<string, StoredAccessToken>();
  private refreshTokens = new Map<string, StoredRefreshToken>();
  private readonly storeFile?: string;
  private readonly loginPath: string;
  public readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(opts: { storeFile?: string; loginPath?: string } = {}) {
    this.storeFile = opts.storeFile;
    this.loginPath = opts.loginPath ?? "/sklera-oauth/login";
    this.clientsStore = new InMemoryClientsStore(this);
    this.load();
  }

  // --- persistence -------------------------------------------------------

  private load(): void {
    if (!this.storeFile) return;
    try {
      const raw = readFileSync(this.storeFile, "utf8");
      const data = JSON.parse(raw) as PersistShape;
      this.clients = new Map(Object.entries(data.clients ?? {}));
      this.accessTokens = new Map(Object.entries(data.accessTokens ?? {}));
      this.refreshTokens = new Map(Object.entries(data.refreshTokens ?? {}));
    } catch {
      // No store yet or unreadable: start empty.
    }
  }

  private persist(): void {
    if (!this.storeFile) return;
    const data: PersistShape = {
      clients: Object.fromEntries(this.clients),
      accessTokens: Object.fromEntries(this.accessTokens),
      refreshTokens: Object.fromEntries(this.refreshTokens),
    };
    try {
      mkdirSync(dirname(this.storeFile), { recursive: true });
      writeFileSync(this.storeFile, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch {
      // Persistence is best-effort; a failed write must not break the flow.
    }
  }

  // --- clients store backing --------------------------------------------

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId);
  }

  putClient(client: OAuthClientInformationFull): void {
    this.clients.set(client.client_id, client);
    this.persist();
  }

  // --- authorization flow ------------------------------------------------

  /**
   * Renders the Sklera login page instead of issuing a code immediately.
   * The page collects the user's apiToken (and optional instance URL) and
   * posts it back to the login endpoint, which then calls issueAuthorizationCode().
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    const fields = {
      client_id: client.client_id,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      state: params.state ?? "",
      scope: (params.scopes ?? []).join(" "),
      resource: params.resource ? params.resource.href : "",
    };
    res
      .status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      .send(this.renderLoginPage(client, fields));
  }

  /**
   * Called by the login endpoint after the user submits the form.
   * Validates the Sklera token, stores an authorization code and returns the
   * redirect target (including code and state) for the OAuth callback.
   */
  async issueAuthorizationCode(input: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    state: string;
    scope: string;
    resource: string;
    skleraToken: string;
    baseUrl: string;
  }): Promise<{ redirect: string } | { error: string }> {
    const client = this.clients.get(input.clientId);
    if (!client) return { error: "Unbekannte client_id." };
    if (!client.redirect_uris.includes(input.redirectUri)) {
      return { error: "redirect_uri ist fuer diesen Client nicht registriert." };
    }
    const baseUrl = (input.baseUrl || DEFAULT_SKLERA_URL).trim().replace(/\/$/, "");
    const validation = await validateSkleraToken(baseUrl, input.skleraToken.trim());
    if (!validation.ok) {
      return { error: validation.message ?? "Token-Validierung fehlgeschlagen." };
    }

    const code = randomId(32);
    this.authCodes.set(code, {
      clientId: input.clientId,
      codeChallenge: input.codeChallenge,
      redirectUri: input.redirectUri,
      skleraToken: input.skleraToken.trim(),
      baseUrl,
      scopes: input.scope ? input.scope.split(" ").filter(Boolean) : [],
      resource: input.resource || undefined,
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    });

    const url = new URL(input.redirectUri);
    url.searchParams.set("code", code);
    if (input.state) url.searchParams.set("state", input.state);
    return { redirect: url.href };
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const entry = this.authCodes.get(authorizationCode);
    if (!entry || entry.expiresAt < Date.now()) {
      throw new Error("invalid or expired authorization code");
    }
    return entry.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string
  ): Promise<OAuthTokens> {
    const entry = this.authCodes.get(authorizationCode);
    if (!entry || entry.expiresAt < Date.now()) {
      throw new Error("invalid or expired authorization code");
    }
    if (entry.clientId !== client.client_id) {
      throw new Error("authorization code was issued to a different client");
    }
    if (redirectUri !== undefined && redirectUri !== entry.redirectUri) {
      throw new Error("redirect_uri mismatch");
    }
    // Authorization codes are single-use.
    this.authCodes.delete(authorizationCode);

    return this.mintTokens({
      clientId: entry.clientId,
      skleraToken: entry.skleraToken,
      baseUrl: entry.baseUrl,
      scopes: entry.scopes,
      resource: entry.resource,
    });
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[]
  ): Promise<OAuthTokens> {
    const entry = this.refreshTokens.get(refreshToken);
    if (!entry) throw new Error("invalid refresh token");
    if (entry.clientId !== client.client_id) {
      throw new Error("refresh token was issued to a different client");
    }
    // Rotate the refresh token.
    this.refreshTokens.delete(refreshToken);
    return this.mintTokens({
      clientId: entry.clientId,
      skleraToken: entry.skleraToken,
      baseUrl: entry.baseUrl,
      scopes: scopes && scopes.length ? scopes : entry.scopes,
      resource: entry.resource,
    });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const entry = this.accessTokens.get(token);
    if (!entry) throw new Error("invalid access token");
    if (entry.expiresAt < nowSeconds()) {
      this.accessTokens.delete(token);
      this.persist();
      throw new Error("access token expired");
    }
    return {
      token,
      clientId: entry.clientId,
      scopes: entry.scopes,
      expiresAt: entry.expiresAt,
      resource: entry.resource ? new URL(entry.resource) : undefined,
      extra: { skleraToken: entry.skleraToken, baseUrl: entry.baseUrl },
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    this.accessTokens.delete(request.token);
    this.refreshTokens.delete(request.token);
    this.persist();
  }

  // --- helpers -----------------------------------------------------------

  private mintTokens(src: {
    clientId: string;
    skleraToken: string;
    baseUrl: string;
    scopes: string[];
    resource?: string;
  }): OAuthTokens {
    const accessToken = randomId(32);
    const refreshToken = randomId(32);
    const expiresAt = nowSeconds() + ACCESS_TOKEN_TTL_SECONDS;

    this.accessTokens.set(accessToken, {
      clientId: src.clientId,
      skleraToken: src.skleraToken,
      baseUrl: src.baseUrl,
      scopes: src.scopes,
      resource: src.resource,
      expiresAt,
    });
    this.refreshTokens.set(refreshToken, {
      clientId: src.clientId,
      skleraToken: src.skleraToken,
      baseUrl: src.baseUrl,
      scopes: src.scopes,
      resource: src.resource,
    });
    this.persist();

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: src.scopes.join(" ") || undefined,
    };
  }

  /** Path the login form posts to; registered by index.ts on the app root. */
  getLoginPath(): string {
    return this.loginPath;
  }

  private renderLoginPage(
    client: OAuthClientInformationFull,
    fields: Record<string, string>
  ): string {
    const hidden = Object.entries(fields)
      .map(
        ([k, v]) =>
          `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`
      )
      .join("\n        ");
    const clientName = escapeHtml(client.client_name ?? "MCP-Client");
    return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sklera MCP Anmeldung</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f1115; color: #e6e8eb;
           display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
    .card { background: #1a1d23; padding: 2rem; border-radius: 12px; max-width: 420px; width: 100%;
            box-shadow: 0 10px 40px rgba(0,0,0,0.4); }
    h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
    p { color: #9aa1ab; font-size: 0.9rem; margin: 0 0 1.25rem; }
    label { display: block; font-size: 0.85rem; margin: 0.75rem 0 0.25rem; }
    input[type=text], input[type=password] { width: 100%; box-sizing: border-box; padding: 0.6rem;
            border-radius: 8px; border: 1px solid #333; background: #0f1115; color: #e6e8eb; }
    button { margin-top: 1.25rem; width: 100%; padding: 0.7rem; border: 0; border-radius: 8px;
             background: #3b82f6; color: white; font-weight: 600; cursor: pointer; }
    .hint { font-size: 0.75rem; color: #6b7280; margin-top: 0.4rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Sklera MCP verbinden</h1>
    <p>${clientName} moechte auf deine Sklera-Daten zugreifen. Hinterlege dein Sklera API-Token, um den Zugriff zu autorisieren.</p>
    <form method="POST" action="${escapeHtml(this.loginPath)}">
        ${hidden}
        <label for="sklera_token">Sklera API-Token</label>
        <input type="password" id="sklera_token" name="sklera_token" required autocomplete="off">
        <label for="base_url">Sklera-Instanz (optional)</label>
        <input type="text" id="base_url" name="base_url" placeholder="${DEFAULT_SKLERA_URL}" autocomplete="off">
        <div class="hint">Leer lassen fuer ${DEFAULT_SKLERA_URL}. Fuer On-Premise die volle URL eintragen.</div>
        <button type="submit">Autorisieren</button>
    </form>
  </div>
</body>
</html>`;
  }

  /** Renders an error variant of the login page (e.g. rejected token). */
  renderLoginError(message: string, fields: Record<string, string>): string {
    const client = this.clients.get(fields.client_id) ?? ({ client_id: fields.client_id, redirect_uris: [] } as OAuthClientInformationFull);
    const base = this.renderLoginPage(client, {
      client_id: fields.client_id ?? "",
      redirect_uri: fields.redirect_uri ?? "",
      code_challenge: fields.code_challenge ?? "",
      state: fields.state ?? "",
      scope: fields.scope ?? "",
      resource: fields.resource ?? "",
    });
    const banner = `<div style="background:#3b1d1d;color:#fca5a5;padding:0.6rem 0.8rem;border-radius:8px;margin-bottom:1rem;font-size:0.85rem;">${escapeHtml(
      message
    )}</div>`;
    return base.replace("<form", `${banner}<form`);
  }
}

/** Unused export kept for completeness if SHA256 helpers are needed elsewhere. */
export function sha256Base64Url(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}
