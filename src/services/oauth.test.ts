import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkleraOAuthProvider } from "./oauth.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * The login flow validates every Sklera token against its instance by calling
 * the global fetch(). We stub it so no real HTTP request happens. By default
 * every token is accepted; individual tests override the implementation to
 * reject specific base URLs.
 */
function stubFetchAcceptAll(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response)
  );
}

const REDIRECT_URI = "https://connector.example/callback";

function registerTestClient(provider: SkleraOAuthProvider): OAuthClientInformationFull {
  return provider.clientsStore.registerClient({
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "none",
    client_name: "Test Connector",
  });
}

/** Extracts the `code` query parameter from a successful authorize redirect. */
function codeFromRedirect(redirect: string): string {
  const url = new URL(redirect);
  const code = url.searchParams.get("code");
  if (!code) throw new Error("redirect carried no authorization code");
  return code;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OAuth single-instance login (backward compatible form)", () => {
  beforeEach(() => stubFetchAcceptAll());

  it("issues a code and binds a single 'default' instance", async () => {
    // Arrange
    const provider = new SkleraOAuthProvider();
    const client = registerTestClient(provider);

    // Act
    const result = await provider.issueAuthorizationCode({
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeChallenge: "challenge",
      state: "xyz",
      scope: "sklera",
      resource: "",
      skleraToken: "TOKEN_SINGLE",
      baseUrl: "https://my.sklera.tv/",
    });

    // Assert
    expect("redirect" in result).toBe(true);
    const code = codeFromRedirect((result as { redirect: string }).redirect);
    const tokens = await provider.exchangeAuthorizationCode(client, code);
    const info = await provider.verifyAccessToken(tokens.access_token);

    const extra = info.extra as {
      instances: { default: string; instances: Record<string, { baseUrl: string; apiToken: string }> };
      skleraToken: string;
      baseUrl: string;
    };
    expect(extra.instances.default).toBe("default");
    expect(extra.instances.instances.default).toEqual({
      baseUrl: "https://my.sklera.tv",
      apiToken: "TOKEN_SINGLE",
    });
    // Legacy fields mirror the default instance for old consumers.
    expect(extra.skleraToken).toBe("TOKEN_SINGLE");
    expect(extra.baseUrl).toBe("https://my.sklera.tv");
  });

  it("rejects an empty submission (no token, no instances JSON)", async () => {
    const provider = new SkleraOAuthProvider();
    const client = registerTestClient(provider);

    const result = await provider.issueAuthorizationCode({
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeChallenge: "challenge",
      state: "",
      scope: "",
      resource: "",
      skleraToken: "   ",
      baseUrl: "",
    });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Token");
  });
});

describe("OAuth multi-instance login", () => {
  it("validates every instance and binds the whole map", async () => {
    // Arrange
    stubFetchAcceptAll();
    const provider = new SkleraOAuthProvider();
    const client = registerTestClient(provider);
    const instancesJson = JSON.stringify({
      default: "onprem",
      instances: {
        my: { baseUrl: "https://my.sklera.tv", apiToken: "TOKEN_A" },
        onprem: { baseUrl: "https://sklera.example.net/", apiToken: "TOKEN_B" },
      },
    });

    // Act
    const result = await provider.issueAuthorizationCode({
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeChallenge: "challenge",
      state: "",
      scope: "sklera",
      resource: "",
      skleraToken: "",
      baseUrl: "",
      instancesJson,
    });

    // Assert: both instances were validated (one fetch per instance).
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const code = codeFromRedirect((result as { redirect: string }).redirect);
    const tokens = await provider.exchangeAuthorizationCode(client, code);
    const info = await provider.verifyAccessToken(tokens.access_token);

    const extra = info.extra as {
      instances: { default: string; instances: Record<string, { baseUrl: string; apiToken: string }> };
      skleraToken: string;
      baseUrl: string;
    };
    expect(extra.instances.default).toBe("onprem");
    expect(Object.keys(extra.instances.instances).sort()).toEqual(["my", "onprem"]);
    // Trailing slash is normalized away.
    expect(extra.instances.instances.onprem.baseUrl).toBe("https://sklera.example.net");
    // Legacy mirror points at the chosen default instance.
    expect(extra.skleraToken).toBe("TOKEN_B");
    expect(extra.baseUrl).toBe("https://sklera.example.net");
  });

  it("reports which instance was rejected", async () => {
    // Arrange: reject only the 'bad' base URL.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url.includes("bad.example")
            ? ({ ok: false, status: 401 } as Response)
            : ({ ok: true, status: 200 } as Response)
        )
      )
    );
    const provider = new SkleraOAuthProvider();
    const client = registerTestClient(provider);
    const instancesJson = JSON.stringify({
      instances: {
        good: { baseUrl: "https://good.example", apiToken: "OK" },
        bad: { baseUrl: "https://bad.example", apiToken: "NOPE" },
      },
    });

    // Act
    const result = await provider.issueAuthorizationCode({
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeChallenge: "challenge",
      state: "",
      scope: "",
      resource: "",
      skleraToken: "",
      baseUrl: "",
      instancesJson,
    });

    // Assert
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain('Instanz "bad"');
  });

  it("rejects malformed instances JSON without issuing a code", async () => {
    stubFetchAcceptAll();
    const provider = new SkleraOAuthProvider();
    const client = registerTestClient(provider);

    const result = await provider.issueAuthorizationCode({
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeChallenge: "challenge",
      state: "",
      scope: "",
      resource: "",
      skleraToken: "",
      baseUrl: "",
      instancesJson: "{ not valid json",
    });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("JSON");
    // A bad payload must never trigger token validation.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects an instance missing apiToken", async () => {
    stubFetchAcceptAll();
    const provider = new SkleraOAuthProvider();
    const client = registerTestClient(provider);
    const instancesJson = JSON.stringify({
      instances: { my: { baseUrl: "https://my.sklera.tv" } },
    });

    const result = await provider.issueAuthorizationCode({
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeChallenge: "challenge",
      state: "",
      scope: "",
      resource: "",
      skleraToken: "",
      baseUrl: "",
      instancesJson,
    });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("apiToken");
  });
});

describe("OAuth store backward compatibility", () => {
  let storeFile: string;

  afterEach(() => {
    try {
      rmSync(storeFile, { force: true });
    } catch {
      /* ignore */
    }
  });

  it("normalizes a legacy stored access token (skleraToken + baseUrl) to a default instance", async () => {
    // Arrange: write a store file in the pre-0.5.0 shape.
    const future = Math.floor(Date.now() / 1000) + 3600;
    storeFile = join(tmpdir(), `sklera-oauth-legacy-${process.pid}.json`);
    writeFileSync(
      storeFile,
      JSON.stringify({
        clients: {},
        accessTokens: {
          "legacy-access": {
            clientId: "c-legacy",
            skleraToken: "LEGACY_TOKEN",
            baseUrl: "https://old.example.net/",
            scopes: ["sklera"],
            expiresAt: future,
          },
        },
        refreshTokens: {},
      })
    );

    // Act
    const provider = new SkleraOAuthProvider({ storeFile });
    const info = await provider.verifyAccessToken("legacy-access");

    // Assert
    const extra = info.extra as {
      instances: { default: string; instances: Record<string, { baseUrl: string; apiToken: string }> };
      skleraToken: string;
      baseUrl: string;
    };
    expect(extra.instances.default).toBe("default");
    expect(extra.instances.instances.default).toEqual({
      baseUrl: "https://old.example.net",
      apiToken: "LEGACY_TOKEN",
    });
    expect(extra.skleraToken).toBe("LEGACY_TOKEN");
    expect(extra.baseUrl).toBe("https://old.example.net");
  });
});
