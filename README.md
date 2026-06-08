# sklera-mcp-server

Version 0.2.0

MCP Server für die Sklera Digital Signage Data API v1.

Versionshistorie siehe `CHANGELOG.md`.

## Voraussetzungen

- Node.js >= 18
- Sklera API-Token (Manager-Rolle oder höher)

## Sklera API Overview

Für die Nutzung der Sklera Digital Signage API (REST API) sind grundsätzlich drei Punkte notwendig:

Der Channel für den die API genutzt werden soll hat das Lizenzmodell sklera Standard oder sklera Professional
Ein sklera Benutzer der für den Zugriff auf den Channel berechtigt ist
Die Generierung eines API Tokens für den Benutzer

Die Möglichkeit den API Token einzusehen oder bei Bedarf zu erzeugen findet sich im sklera CMS unter Mehr->Benutzer 
bei der Bearbeitung eines Benutzers. Unter den Account-Daten befindet sich ein Punkt API Token, wo dieser angezeigt 
bzw. ggf. mittels Klick auf den entsprechenden Button erzeugt werden kann.

Bitte bewahren Sie diesen Token sicher auf und geben Sie ihn nicht weiter. Mithilfe dieses Token kann jeder in Besitz 
diesen berechtigte Channels im Rahmen der von der API zur Verfügung gestellten Möglichkeiten verändern. 
Im Zweifel können Sie jederzeit einen neuen Token generieren.

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
    "onpremise":   { "baseUrl": "https://<myonpremisedomain>", "apiToken": "TOKEN_B" }
  }
}
```

Tools mit Instanz-Unterstützung akzeptieren einen optionalen Parameter `instance` (Name aus `instances`). Ohne Angabe wird die unter `default` definierte Instanz verwendet; fehlt `default`, gilt die erste Instanz.

## Transport

Requests an die sklera REST API sind allgemein HTTP requests - je nach Endpoint GET, POST, PUT oder DELETE. 
Zusätzlich muss der API Token mit jedem Request im Header mitgeschickt werden. Die API erwartet einen JSON Body.

### stdio (Standard, für Claude Desktop / claude.ai)

```bash
SKLERA_API_TOKEN=<token> node dist/index.js
```

### HTTP (für Remote-Zugriff)

```bash
TRANSPORT=http PORT=3000 SKLERA_API_TOKEN=<token> node dist/index.js
```

Endpoint: `POST http://localhost:3000/mcp`  
Health-Check: `GET http://localhost:3000/health`

## Einbindung in Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) bzw.  
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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
