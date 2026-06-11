# sklera-mcp-server

Version 0.3.0

MCP Server für die Sklera Digital Signage Data API v1.

Versionshistorie siehe `CHANGELOG.md`.

## Voraussetzungen

- Node.js >= 18
- Sklera API-Token (Manager-Rolle oder höher)

## Installation

```bash
npm install
npm run build
```

## Konfiguration

### Einzelne Instanz (Standard)

| Variable            | Pflicht | Default                  | Beschreibung              |
|---------------------|---------|--------------------------|---------------------------|
| `SKLERA_API_TOKEN`  | Ja      | –                        | API-Token aus dem Backend |
| `SKLERA_BASE_URL`   | Nein    | `https://my.sklera.tv`   | Für On-Premise-Instanzen  |

### Mehrere Instanzen (mehrere Sklera-Domains)

Für den Betrieb mehrerer Sklera-Domains (z.B. SaaS plus mehrere On-Premise-Installationen, je mit eigenem Token) steht die Variable `SKLERA_INSTANCES` als JSON zur Verfügung. Ist sie gesetzt, hat sie Vorrang vor `SKLERA_API_TOKEN` / `SKLERA_BASE_URL`.

```json
{
  "default": "my",
  "instances": {
    "my":          { "baseUrl": "https://my.sklera.tv",         "apiToken": "TOKEN_A" },
    "gehtsichaus": { "baseUrl": "https://sklera.gehtsichaus.net", "apiToken": "TOKEN_B" }
  }
}
```

Tools mit Instanz-Unterstützung akzeptieren einen optionalen Parameter `instance` (Name aus `instances`). Ohne Angabe wird die unter `default` definierte Instanz verwendet; fehlt `default`, gilt die erste Instanz.

## Transport

### stdio (Standard, für Claude Desktop / claude.ai)

```bash
SKLERA_API_TOKEN=<token> node dist/index.js
```

### HTTP (für Remote-Zugriff)

Der HTTP-Modus (Streamable HTTP Transport) unterstützt zwei Betriebsarten:

**Multi-User (empfohlen für zentrales Hosting):** Server ohne Credentials starten; jeder Request bringt seine eigenen Credentials via Header mit.

```bash
TRANSPORT=http PORT=3000 node dist/index.js
```

Unterstützte Auth-Header pro Request:

| Header | Pflicht | Beschreibung |
|---|---|---|
| `X-Sklera-Token` | Ja* | API-Token des Users |
| `X-Sklera-Url` | Nein | Basis-URL der Sklera-Instanz, Default `https://my.sklera.tv` |
| `X-Sklera-Instances` | Nein | Multi-Instanz-JSON (Format wie `SKLERA_INSTANCES`); hat Vorrang vor `X-Sklera-Token` |

*Entweder `X-Sklera-Token` oder `X-Sklera-Instances` muss gesetzt sein, sofern keine Server-Credentials existieren. Requests ohne Credentials werden mit HTTP 401 abgelehnt.

**Single-Tenant (Fallback):** Server mit Credentials in der Umgebung starten; Requests ohne Auth-Header nutzen diese.

```bash
TRANSPORT=http PORT=3000 SKLERA_API_TOKEN=<token> node dist/index.js
```

Endpoint: `POST http://localhost:3000/mcp`  
Health-Check: `GET http://localhost:3000/health`

Weitere Umgebungsvariablen: `HOST` (Bind-Interface, Default `0.0.0.0`).

**Sicherheitshinweise für den Remote-Betrieb:**
- Ausschließlich hinter TLS betreiben (Reverse Proxy oder Cloudflare Tunnel); Tokens werden im Klartext-Header übertragen
- Tokens werden weder serverseitig gespeichert noch geloggt; pro Request wird eine isolierte Client-Instanz erzeugt
- Rate-Limiting auf Proxy-Ebene (z.B. Cloudflare) wird empfohlen

## Einbindung in Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) bzw.  
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

### Variante A: Lokal (stdio)

```json
{
  "mcpServers": {
    "sklera": {
      "command": "node",
      "args": ["/pfad/zu/sklera-mcp-server/dist/index.js"],
      "env": {
        "SKLERA_API_TOKEN": "<dein-token>",
        "SKLERA_BASE_URL": "https://my.sklera.tv"
      }
    }
  }
}
```

### Variante B: Remote (HTTP)

Der Token bleibt in der lokalen Konfiguration des Users; nur die Server-URL zeigt auf den gehosteten MCP Server.

```json
{
  "mcpServers": {
    "sklera": {
      "type": "http",
      "url": "https://mcp.example.net/mcp",
      "headers": {
        "X-Sklera-Token": "<dein-token>",
        "X-Sklera-Url": "https://my.sklera.tv"
      }
    }
  }
}
```

Für mehrere Sklera-Instanzen pro User alternativ:

```json
{
  "mcpServers": {
    "sklera": {
      "type": "http",
      "url": "https://mcp.example.net/mcp",
      "headers": {
        "X-Sklera-Instances": "{\"default\":\"my\",\"instances\":{\"my\":{\"baseUrl\":\"https://my.sklera.tv\",\"apiToken\":\"TOKEN_A\"},\"onprem\":{\"baseUrl\":\"https://sklera.example.net\",\"apiToken\":\"TOKEN_B\"}}}"
      }
    }
  }
}
```

## Verfügbare Tools (27)

### Channels
- `sklera_list_channels` – Alle zugänglichen Channels auflisten

### Users
- `sklera_list_users` – Alle sichtbaren Benutzerkonten auflisten (inkl. Channel-Zuordnung, Adresse, lastLogin); optionaler Parameter `instance` für Mehrdomänen-Betrieb

### Screens / Player
- `sklera_list_screens` – Alle Screens auflisten
- `sklera_screen_stats` – Online/Offline-Statistiken
- `sklera_screen_connection_status` – Echtzeit-Verbindungsstatus
- `sklera_send_screen_command` – Fernbefehl senden (restart, reload, next, prev, ...)
- `sklera_edit_screen` – Screen-Eigenschaften bearbeiten
- `sklera_list_screengroups` – Screen-Gruppen eines Channels

### Playlists
- `sklera_list_playlists` – Alle Playlists auflisten
- `sklera_create_playlist` – Neue Playlist erstellen
- `sklera_edit_playlist` – Playlist bearbeiten
- `sklera_delete_playlist` – Playlist löschen
- `sklera_clear_playlist` – Alle Spots einer Playlist entfernen
- `sklera_prune_playlist` – Abgelaufene Spots entfernen

### Nodes (Spots)
- `sklera_list_nodes` – Spots einer Playlist auflisten
- `sklera_add_node` – Neuen Spot hinzufügen (mit Scheduling)
- `sklera_edit_node` – Spot bearbeiten
- `sklera_delete_node` – Spot löschen

### Library Items
- `sklera_list_items` – Bibliotheks-Items (filterbar nach Typ, Ordner, Datum)
- `sklera_get_item` – Einzelnes Item abrufen
- `sklera_replace_item_by_url` – Item-Inhalt durch URL ersetzen
- `sklera_delete_item` – Item löschen
- `sklera_copy_item` – Item kopieren

### Playouts
- `sklera_list_playouts` – Alle Playouts auflisten
- `sklera_get_playout` – Playout-Details abrufen
- `sklera_edit_playout` – Playout bearbeiten (Screens, Playlists, Aktivierung)
- `sklera_delete_playout` – Playout löschen

### Messages
- `sklera_list_messages` – Laufschriften/Nachrichten auflisten
- `sklera_create_message` – Neue Nachricht erstellen

### Custom Values
- `sklera_get_custom_values` – Alle Custom Values abrufen
- `sklera_edit_custom_value` – Custom Value bearbeiten

### Reporting
- `sklera_reporting_played_live` – Rohe Wiedergabe-Logs (max. 7 Tage)
- `sklera_reporting_played_hourly` – Stündlich aggregierte Wiedergabe-Logs (max. 14 Tage)
- `sklera_reporting_played_daily` – Täglich aggregierte Wiedergabe-Logs (max. 364 Tage)
- `sklera_reporting_touch_live` – Rohe Touch-Logs (max. 7 Tage)
- `sklera_reporting_touch_daily` – Täglich aggregierte Touch-Logs (max. 364 Tage)

### Roommanager (ab 0.2.0)
Basispfad `/channelApi/roomManager`; Authentifizierung über den `apiToken`-Query-Parameter. Alle Tools unterstützen den optionalen Parameter `instance`.

- `sklera_list_rooms` – Alle Räume des Channels abrufen
- `sklera_create_rooms` – Einen oder mehrere Räume anlegen
- `sklera_update_rooms` – Mehrere Räume gesammelt aktualisieren (je `_id` erforderlich)
- `sklera_delete_rooms` – Mehrere Räume per ID löschen
- `sklera_edit_room` – Einzelnen Raum per `roomId` bearbeiten
- `sklera_delete_room` – Einzelnen Raum per `roomId` löschen
- `sklera_list_events` – Termine abrufen (optional `dateBegin` / `dateEnd`)
- `sklera_create_event` – Termin anlegen (`title`, `begin`, `end`, `roomId` erforderlich)
- `sklera_update_event` – Termin per `eventId` aktualisieren
- `sklera_delete_event` – Termin per `eventId` löschen
- `sklera_delete_events_before` – Termine vor einem Datum entfernen
