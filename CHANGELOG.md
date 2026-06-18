# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [0.8.0] - 2026-06-18

### Hinzugefügt
- **Laufzeit-Instanzverwaltung (Muster A):** Instanzen lassen sich zur Laufzeit
  hinzufügen, auflisten, testen und entfernen – ohne Neustart und ohne erneutes
  Verbinden. Neue Tools `sklera_add_instance`, `sklera_list_instances`,
  `sklera_test_instance`, `sklera_remove_instance`. Dynamische Instanzen liegen
  in einem **verschlüsselten** (AES-256-GCM) lokalen Speicher
  (`src/services/instanceStore.ts`), der bei **jedem** Request gelesen und mit
  den statischen Instanzen zusammengeführt wird (statisch hat Vorrang). Tokens
  werden nie im Klartext geloggt oder ausgegeben (Maskierung auf die letzten 4
  Zeichen). Neue Umgebungsvariablen `SKLERA_DYNAMIC_INSTANCES_FILE` und
  `SKLERA_INSTANCE_SECRET`.
  - `sklera_remove_instance` betrifft ausschließlich die lokale
    Konnektor-Konfiguration und ruft **keine** Sklera-API auf.
- **Provisioning API – NUR LESEND:** Neue Tools `sklera_provisioning_list`
  (`GET /provisioning/list`, optionale Filter `username`/`userId`/`email`/
  `licenseType`/`channelName`) und `sklera_provisioning_get`
  (`GET /provisioning/get/{channelId}`). Beide unterstützen `instance`.

### Sicherheit
- **Provisioning ist technisch auf Lesezugriff beschränkt:** Es sind
  ausschließlich GET-Endpoints angebunden; die schreibenden/destruktiven
  Endpoints (`createAccount`, `edit`, `setExpired`, `changeScreenCount`,
  `deleteAccount`) sind bewusst **nicht** vorhanden. Zusätzlich verweigert der
  `SkleraClient` jeden POST/PUT/DELETE gegen einen Provisioning-Pfad
  (`assertNotProvisioning`), sodass der Konnektor Accounts/Channels nicht
  verändern kann.

### Geändert
- `SERVER_VERSION` und `package.json` auf `0.8.0`.
- `ClientRegistry` konsultiert optional den dynamischen Instanz-Speicher
  (`attachDynamicStore`, `resolve`/`names` berücksichtigen dynamische Instanzen).

## [0.7.0] - 2026-06-16

### Hinzugefügt
- **Konfigurierbares HTTP-Timeout:** Neue Umgebungsvariable
  `SKLERA_HTTP_TIMEOUT_MS` steuert das Timeout aller Sklera-API-Aufrufe zentral.
  Der Default wurde von 15.000 ms auf **60.000 ms** angehoben, damit Aufrufe gegen
  sehr große Instanzen (tausende Screens) nicht mehr vorzeitig abbrechen
  (`resolveTimeoutMs()` in `src/services/client.ts`).
- **`sklera_list_screens` – Filter, Paginierung und Feldprojektion:** Neue
  optionale Parameter `channelId` (nur ein Channel), `limit`/`offset`
  (seitenweise Abfrage) und `fields` (`core` = schlanke Standardprojektion mit
  abgeleiteten Feldern `model`/`ip`, `full` = vollständige Objekte). Die Antwort
  ist nun ein Envelope `{ total, offset, limit, returned, screens }`. Damit lassen
  sich große Fleets innerhalb des Antwortgrößen-Limits abfragen.

### Behoben
- **`sklera_screen_connection_status` ignorierte `channelId`:** Die Sklera-API
  liefert für diesen Endpunkt stets alle Channels, unabhängig vom übergebenen
  `channelId`-Query-Parameter. Die Filterung erfolgt jetzt zuverlässig
  **client-seitig** auf die Channel-Gruppe(n) mit passender `channelId`; zwei
  verschiedene IDs liefern damit korrekt unterschiedliche Ergebnisse.

### Geändert
- `SERVER_VERSION` und `package.json` auf `0.7.0`.
- `sklera_list_screens` liefert standardmäßig die schlanke `core`-Projektion statt
  der vollständigen Objekte. Große Felder (`platformInfo`, `networkInfo`,
  `operatingTimes`) sind nur noch mit `fields="full"` enthalten.

### Kompatibilität
- Additiv und abwärtskompatibel: bestehende Aufrufe ohne neue Parameter
  funktionieren weiterhin. `sklera_list_screens` ohne Parameter liefert weiterhin
  alle Screens – nun als Envelope mit schlanker `core`-Projektion (für die
  vollständigen Objekte `fields="full"` setzen).

## [0.6.0] - 2026-06-14

### Hinzugefügt
- **`instance`-Parameter an allen Tools:** Der optionale Parameter `instance`
  (Auswahl der Ziel-Domain aus der konfigurierten Instanzen-Abbildung) steht jetzt
  bei **jedem** Tool zur Verfügung – zuvor nur bei `sklera_list_users` und den
  Roommanager-Tools. Damit lassen sich Channels, Screens, Playlists, Nodes, Items,
  Playouts, Messages, Custom Values und Reporting gezielt auf einer beliebigen
  gebundenen Instanz abfragen. Dies vervollständigt den in 0.5.0 eingeführten
  Mehrinstanz-OAuth-Support: gebundene Instanzen sind nun über alle Tools
  ansprechbar (greift gleichermaßen für `SKLERA_INSTANCES`, `X-Sklera-Instances`
  und OAuth).
- Neue gemeinsame Definition `instanceField` in `src/tools/shared.ts`, von allen
  Tool-Modulen genutzt (entfernt die zuvor in `users.ts`/`rooms.ts` duplizierte
  Schema-Definition).

### Geändert
- `SERVER_VERSION` auf `0.6.0`.
- Alle `register*Tools`-Funktionen erhalten in `buildServer()` die vollständige
  `ClientRegistry` statt eines fest verdrahteten Default-Clients und lösen pro
  Aufruf über `registry.resolve(instance)` die Ziel-Instanz auf.

### Kompatibilität
- Vollständig abwärtskompatibel: `instance` ist optional; ohne Angabe wird wie
  bisher die Default-Instanz verwendet. stdio-, Header- und OAuth-Varianten bleiben
  unverändert. Der Parameter `instance` wird in keinem Fall an die Sklera-API
  weitergereicht (er dient nur der Client-Auswahl).

## [0.5.0] - 2026-06-14

### Hinzugefügt
- **Mehrinstanz-Unterstützung im OAuth-Login (Remote-Modus):** Eine einzige
  OAuth-Anbindung kann jetzt mehrere Sklera-Instanzen binden, ansprechbar über
  den bereits existierenden Tool-Parameter `instance`.
  - Die Login-Seite (`SkleraOAuthProvider.renderLoginPage`) zeigt standardmäßig
    weiterhin das einfache Formular (ein Token, optionale Instanz-URL). Ein neuer,
    einklappbarer Bereich **„Erweitert: mehrere Instanzen verbinden"** nimmt ein
    Instanzen-JSON im Format von `SKLERA_INSTANCES` entgegen (kein JavaScript,
    keine externen Abhängigkeiten).
  - Ist das Instanzen-JSON ausgefüllt, hat es Vorrang vor dem Einzel-Token. **Jede
    Instanz wird einzeln** über `validateSkleraToken` gegen ihre `baseUrl` geprüft;
    schlägt eine fehl, nennt die Fehlerseite die betroffene Instanz.
  - Die gesamte Instanzen-Abbildung wird durch den Authorization Code, die Access-
    und Refresh-Tokens durchgereicht. `verifyAccessToken` liefert sie in
    `AuthInfo.extra.instances`; zusätzlich werden die Felder `skleraToken`/`baseUrl`
    der Default-Instanz für Abwärtskompatibilität gespiegelt.
- Neue wiederverwendbare Funktion `buildRegistryFromInstances(parsed, label)` in
  `src/services/registry.ts`. Die JSON-Validierungs- und Aufbaulogik aus
  `loadRegistryFromEnv` und `loadRegistryFromHeaders` wurde dorthin extrahiert und
  wird nun zusätzlich im OAuth-Zweig von `index.ts` genutzt (keine Duplizierung).

### Geändert
- `SERVER_VERSION` auf `0.5.0`.
- Der OAuth-Bearer-Zweig in `index.ts` baut die `ClientRegistry` aus der im Token
  gespeicherten Instanzen-Abbildung statt aus einem einzelnen Token.

### Kompatibilität
- **stdio-Modus** (`SKLERA_API_TOKEN`, `SKLERA_INSTANCES`) und die **Header-Varianten**
  (`X-Sklera-Token`, `X-Sklera-Instances`) bleiben vollständig unverändert.
- **Persist-Format abwärtskompatibel:** Bestehende `OAUTH_STORE_FILE`-Dateien im
  alten Schema (nur `skleraToken` + `baseUrl` pro Token) werden beim Laden weiterhin
  akzeptiert und intern auf eine Instanz `default` abgebildet. Bestehende
  Single-Instanz-Anbindungen funktionieren unverändert weiter.

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
