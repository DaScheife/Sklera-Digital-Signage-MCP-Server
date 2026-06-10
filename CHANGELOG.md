# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

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
