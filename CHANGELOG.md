# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [0.4.0] - 2026-06-12

### Hinzugefügt
- **Eingebauter OAuth-2.1-Authorization-Server (Remote-Modus):** Der HTTP-Transport
  kann jetzt über Claudes GUI-Connector ("Benutzerdefinierter Konnektor", nur URL)
  eingebunden werden. Damit entfällt der Fehler "Registrierung beim Anmeldedienst
  fehlgeschlagen", der auftrat, weil die GUI ausschließlich OAuth (mit Dynamic Client
  Registration) spricht und keine statischen Header zulässt.
  - Neue Endpunkte über `mcpAuthRouter` des MCP SDK: `/.well-known/oauth-protected-resource`
    (RFC 9728), `/.well-known/oauth-authorization-server` (RFC 8414), `/register`
    (RFC 7591 Dynamic Client Registration), `/authorize`, `/token`, `/revoke`.
  - Neuer Provider `SkleraOAuthProvider` in `src/services/oauth.ts`: zeigt während des
    Authorize-Schritts eine Login-Seite an, auf der der User sein Sklera API-Token
    (und optional die Instanz-URL) hinterlegt. Das Token wird per Best-Effort gegen
    `/data/api/channels/list` validiert und an den ausgestellten Bearer-Token gebunden.
  - PKCE (S256) wird erzwungen; Authorization Codes sind Einmal-gültig (5 Min TTL),
    Access Tokens 1 Stunde, Refresh Tokens werden rotiert.
  - Neue Umgebungsvariable `PUBLIC_URL` aktiviert den OAuth-Modus und definiert den
    Issuer bzw. die Resource-Kennung (z.B. `https://mcp.example.net`).
  - Optionale Umgebungsvariable `OAUTH_STORE_FILE` persistiert Clients und Tokens auf
    Platte (überlebt Neustarts; Sklera-Token liegt dann im Klartext, Datei entsprechend
    schützen). Ohne sie bleibt der Speicher rein im RAM.

### Geändert
- `SERVER_VERSION` auf `0.4.0`.
- `/mcp` akzeptiert im OAuth-Modus weiterhin die bisherigen Credential-Header
  (`X-Sklera-Token` / `X-Sklera-Instances`) als Fallback; beide Wege funktionieren
  parallel. Ohne `PUBLIC_URL` verhält sich der Server unverändert wie in 0.3.0.

## [0.3.0] - 2026-06-11

### Hinzugefügt
- **Remote-Modus mit per-Request-Authentifizierung:** Im HTTP-Transport
  (`TRANSPORT=http`) können Credentials jetzt pro Request via Header übergeben
  werden. Damit kann ein zentral gehosteter Server (z.B. hinter Cloudflare
  Tunnel) von mehreren Claude-Usern mit jeweils eigenem API-Token genutzt
  werden. Unterstützte Header:
  - `X-Sklera-Token`: API-Token des Users (Pflicht, wenn keine
    Server-Credentials gesetzt sind)
  - `X-Sklera-Url`: Basis-URL der Sklera-Instanz (optional, Default
    `https://my.sklera.tv`)
  - `X-Sklera-Instances`: vollständiges Multi-Instanz-JSON (identisches Format
    wie die Umgebungsvariable `SKLERA_INSTANCES`); hat Vorrang vor
    `X-Sklera-Token`
- Neue Funktion `loadRegistryFromHeaders()` in `src/services/registry.ts`
- `HOST`-Umgebungsvariable für das Bind-Interface im HTTP-Modus (Default
  `0.0.0.0`)
- Pro HTTP-Request wird eine isolierte Server- und Client-Instanz erzeugt;
  keine serverseitige Token-Speicherung, keine Vermischung zwischen Usern

### Geändert
- `buildServer()` akzeptiert die `ClientRegistry` als Parameter statt eines
  modulglobalen Zustands; Voraussetzung für per-Request-Registries
- HTTP-Modus startet auch ohne Umgebungs-Credentials (Multi-User-Betrieb);
  sind Umgebungs-Credentials gesetzt, dienen sie als Single-Tenant-Fallback
  für Requests ohne Auth-Header
- Requests ohne verwertbare Credentials erhalten HTTP 401, fehlerhafte
  Header (z.B. ungültiges JSON in `X-Sklera-Instances`) HTTP 400

### Kompatibilität
- **stdio-Modus (Claude Desktop, lokal): vollständig unverändert.** Bestehende
  `claude_desktop_config.json`-Konfigurationen funktionieren ohne Anpassung.
- HTTP-Modus mit Umgebungs-Credentials (v0.2.2-Verhalten) bleibt als Fallback
  erhalten.

## [0.2.2] - 2026-06-10

### Behoben
- `sklera_lg_upgrade_firmware`: Der Parameter `firmwareUrl` wird jetzt flach im
  Request-Body gesendet statt verschachtelt unter `params`. Die verschachtelte
  Variante wurde von der Sklera API mit HTTP 401 abgelehnt; das flache Format
  wurde gegen die Live-API verifiziert (HTTP 200). Hinweis: Der ausführende
  API-User benötigt die Rolle **Reseller**.

## [0.2.1] - 2026-06-10

### Hinzugefügt
- Neues Tool `sklera_lg_upgrade_firmware`: Löst ein Remote-Firmware-Update auf
  einem LG WebOS Screen aus. Parameter: `screenId` (oder `screenName` +
  `channelId`) sowie `firmwareUrl` (vollständige URL zur EPK-Datei).
  Sendet den Befehl `device_lg_upgradeFirmware` mit dem Parameter `firmwareUrl`
  an den Endpunkt `/screens/sendCmd`. Erfordert einen API-Token mit der Rolle
  **Reseller**. Die Firmware-Datei wird vom Player selbstständig heruntergeladen
  und nach der Installation automatisch neu gestartet.

### Kompatibilität
- Vollständig abwärtskompatibel. Alle bestehenden Tools bleiben unverändert.

## [0.2.0] - 2026-06-08

### Hinzugefügt
- Anbindung des Sklera-Moduls **Roommanager** (Basispfad
  `/channelApi/roomManager`) mit 11 neuen Tools:
  `sklera_list_rooms`, `sklera_create_rooms`, `sklera_update_rooms`,
  `sklera_delete_rooms`, `sklera_edit_room`, `sklera_delete_room`,
  `sklera_list_events`, `sklera_create_event`, `sklera_update_event`,
  `sklera_delete_event`, `sklera_delete_events_before`.
- Neue Methode `SkleraClient.roomRequest()` samt separater axios-Instanz für den
  Roommanager-Basispfad. Sie berücksichtigt die Besonderheiten des Moduls:
  `apiToken` als Query-Parameter (nicht als Header) sowie gemischte
  Body-Formate (JSON für Räume, `application/x-www-form-urlencoded` für Termine).
- Alle Roommanager-Tools unterstützen den optionalen Parameter `instance` zur
  Auswahl der Ziel-Instanz (analog zu `sklera_list_users`).

### Geändert
- Server-Version von `0.1.0` auf `0.2.0` erhöht (rückwärtskompatible
  Funktionserweiterung gemäß Semantic Versioning).
- Erfolgserkennung in `SkleraClient.wrapError()` typsicher gemacht (Verhalten
  unverändert), um den Build mit aktuellen axios-Typdefinitionen zu ermöglichen.

### Kompatibilität
- Vollständig abwärtskompatibel: Der bestehende `/data/api`-Client und alle
  bisherigen Tools bleiben unverändert.
- Roommanager nutzt denselben konfigurierten Token wie die übrigen Tools
  (Channel API Token); keine zusätzliche Konfiguration erforderlich.

## [0.1.0] - 2026-06-08

Erste versionierte Veröffentlichung. Sie bildet die Basis (Baseline) für die
künftige Versionierung; alle weiteren Änderungen werden ab hier fortgeschrieben.

### Hinzugefügt
- Tool `sklera_list_users` (`GET /users/list`): listet alle für den API-Token
  sichtbaren Benutzerkonten inkl. Channel-Zuordnung, Adresse, Firma und
  `lastLogin`.
- Mehrdomänen-Unterstützung über eine Client-Registry
  (`src/services/registry.ts`): mehrere Sklera-Domains lassen sich per
  `SKLERA_INSTANCES` (JSON) mit je eigenem Token konfigurieren.
- Optionaler Parameter `instance` an `sklera_list_users` zur Auswahl der
  Ziel-Instanz; ohne Angabe wird die Default-Instanz verwendet.
- Versionsnummer wird zentral in `index.ts` (`SERVER_VERSION`) geführt und im
  HTTP-Health-Check (`GET /health`) sowie in den Startmeldungen ausgegeben.

### Geändert
- Server-Version von `1.0.0` auf `0.1.0` gesetzt, um eine saubere, an
  Semantic Versioning orientierte Historie ab dieser Veröffentlichung zu
  beginnen.
- Client-Erzeugung in `index.ts` von einer fest verdrahteten Einzelinstanz auf
  die Registry umgestellt.

### Kompatibilität
- Vollständig abwärtskompatibel: Die bisherige Konfiguration über
  `SKLERA_API_TOKEN` (+ optional `SKLERA_BASE_URL`) funktioniert unverändert und
  wird intern als Instanz `default` registriert.
- Alle 26 bestehenden Tools bleiben unverändert; Gesamtzahl nun 27.
