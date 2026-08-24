# Development Changelog

Dieses Dokument ist fuer das Entwicklerteam gedacht. Es haelt fest, welche Aenderungen wann und von wem ins Projekt gekommen sind.

Quelle fuer bestehende Eintraege: Git-Historie (`git log`). Zeiten sind lokale Zeiten aus der Entwicklerumgebung.

Letzte manuelle Aktualisierung: 2026-08-24 08:40 - Adil

## Arbeitsregel

Bei jeder relevanten Aenderung bitte einen Eintrag ergaenzen:

```md
### YYYY-MM-DD HH:mm - Autor
- Commit: `abc1234`
- Bereich: Orders / Warehouse / WhatsApp / Shipping / Finance / Database / UI
- Aenderung: Kurz beschreiben, was geaendert wurde.
- Grund: Warum wurde es geaendert?
- Hinweis: Risiken, Deploy, Migrationen oder Tests.
```

## Aenderungen

### 2026-08-24 08:40 - Adil
- Commit: `9c0a35b`
- Bereich: M&P Shipping / Tracking
- Aenderung: M&P Status `Out-For-Delivery` wird jetzt korrekt als `out_for_delivery` erkannt statt faelschlich als `delivered`.
- Grund: M&P sendet den Status mit Bindestrichen. Die bisherige Normalisierung erkannte nur `out for delivery` mit Leerzeichen.
- Hinweis: Functions `mnp-carrier-status-sync` und `mnp-shipping-sync` wurden deployed. Bestehende falsch gesetzte Orders werden beim naechsten M&P Status-Sync korrigiert.

### 2026-08-24 08:30 - Adil
- Commit: `9bb261b`
- Bereich: Dokumentation / Team Workflow
- Aenderung: `DEVELOPMENT_CHANGELOG.md` als Team-Changelog erstellt und mit bestehenden Git-Aenderungen befuellt.
- Grund: Drei Entwickler sollen nachvollziehen koennen, wer wann welche Aenderungen ins Projekt gebracht hat.
- Hinweis: Das Dokument wird nicht automatisch aktualisiert. Entwickler muessen es beim Pushen mitpflegen.

### 2026-08-23 15:22 - Adil
- Commit: `966d044`
- Bereich: M&P Shipping
- Aenderung: M&P Destination-Reached Status-Sync erneut angepasst.

### 2026-08-23 15:18 - Adil
- Commit: `f0ac369`
- Bereich: M&P Shipping
- Aenderung: M&P Substatus `Destination Reached` bleibt sichtbar.

### 2026-08-23 15:15 - Adil
- Commit: `9432aba`
- Bereich: M&P Shipping
- Aenderung: M&P Status `Destination Reached` wird intern als `shipped` gemappt.

### 2026-08-23 15:08 - Anwar Bounasser
- Commit: `b346d75`
- Bereich: WhatsApp / Shipping
- Aenderung: Fuer M&P-Sendungen wird das M&P-spezifische Shipped-Template verwendet.

### 2026-08-23 13:41 - Adil
- Commit: `6418537`
- Bereich: M&P Tracking
- Aenderung: Wrapped M&P Tracking Response wird korrekt gelesen.

### 2026-08-23 13:36 - Adil
- Commit: `f73a136`
- Bereich: M&P Tracking
- Aenderung: M&P Tracking Array Responses werden unterstuetzt.

### 2026-08-23 13:32 - Adil
- Commit: `3cf897e`
- Bereich: M&P Tracking
- Aenderung: Status-Updates aus M&P Tracking korrigiert.

### 2026-08-23 13:26 - Adil
- Commit: `efdbb4a`
- Bereich: M&P Labels / Status Sync
- Aenderung: M&P Label- und Status-Sync-Logik korrigiert.

### 2026-08-22 15:04 - Anwar Bounasser
- Commit: `26ef559`
- Bereich: Orders
- Aenderung: Courier-Filter in der Admin Orders Seite hinzugefuegt.

### 2026-08-22 13:07 - Anwar Bounasser
- Commit: `8bf3f0b`
- Bereich: Warehouse
- Aenderung: Delivery-Courier-Filter fuer Not Printed, Ready to Dispatch und Out of Stock hinzugefuegt.

### 2026-08-22 11:47 - Anwar Bounasser
- Commit: `d61c7ca`
- Bereich: WhatsApp Inbox
- Aenderung: Zugewiesener Follow-up Agent wird in der Order Card angezeigt.

### 2026-08-22 10:22 - Anwar Bounasser
- Commit: `af83159`
- Bereich: Follow Ups
- Aenderung: Bereits retournierte Orders werden aus der stale re-attempt Warnung ausgeschlossen.

### 2026-08-22 10:13 - Anwar Bounasser
- Commit: `916ae7b`
- Bereich: Follow Ups
- Aenderung: Stale re-attempted Orders werden markiert und oben angepinnt.

### 2026-08-21 20:58 - Adil
- Commit: `41d57b8`
- Bereich: M&P Labels
- Aenderung: M&P Label PDF Handling korrigiert.

### 2026-08-21 20:31 - Adil
- Commit: `6ce6eb6`
- Bereich: M&P Tracking
- Aenderung: Fehlerbehandlung fuer M&P Tracking verbessert.

### 2026-08-21 17:45 - Adil
- Commit: `f09682e`
- Bereich: Shipping Router
- Aenderung: Carrier-Fallback-Routing ergaenzt. Wenn der aktive Carrier eine Stadt nicht abdeckt, kann auf PostEx ausgewichen werden.

### 2026-08-21 17:31 - Adil
- Commit: `4c13eac`
- Bereich: Shipping
- Aenderung: M&P Carrier Routing in `main` gemerged.

### 2026-08-21 17:24 - Adil
- Commit: `aac0e20`
- Bereich: Settings / Carriers
- Aenderung: Konfigurationsseite fuer Carrier Routing hinzugefuegt.

### 2026-08-21 17:13 - Adil
- Commit: `a85b850`
- Bereich: M&P Tracking
- Aenderung: Parsing der M&P Tracking Response korrigiert.

### 2026-08-21 17:11 - Adil
- Commit: `fee9ca3`
- Bereich: M&P Cities
- Aenderung: Parsing der M&P City Response korrigiert.

### 2026-08-21 11:28 - Anwar Bounasser
- Commit: `4fd9ed3`
- Bereich: Delivery Analytics
- Aenderung: Delivery Analytics KPIs nach SellerAnalytics Event-Date Pattern ueberarbeitet und fehlendes `confirmed_at` korrigiert.

### 2026-08-21 10:26 - Anwar Bounasser
- Commit: `8be7a85`
- Bereich: Analytics / Dashboard
- Aenderung: Confirmation Analytics Attribution, Handling-Time-Metrik und My Dashboard Claimed Orders korrigiert.

### 2026-08-21 09:26 - Adil
- Commit: `e7eb0e9`
- Bereich: Shipping
- Aenderung: Vorherige M&P Carrier Routing und Label-Aenderung zurueckgesetzt.

### 2026-08-21 09:25 - Adil
- Commit: `eacf482`
- Bereich: Shipping
- Aenderung: M&P Carrier Routing und Labels hinzugefuegt.

### 2026-08-21 08:57 - Anwar Bounasser
- Commit: `cd9ff7c`
- Bereich: Order Attribution
- Aenderung: Confirmed-Order Attribution korrigiert, damit der echte bestaetigende User gutgeschrieben wird.

### 2026-08-21 08:23 - Anwar Bounasser
- Commit: `4a68834`
- Bereich: WhatsApp Inbox
- Aenderung: Shipment Tracking Number wird in der WhatsApp Inbox Order Card angezeigt.

### 2026-08-21 07:58 - Anwar Bounasser
- Commit: `dbce1ae`
- Bereich: WhatsApp Inbox / Follow Up
- Aenderung: Kombinierbare Stage/Refine Filter und Follow Up Overview Stat hinzugefuegt.

### 2026-08-20 15:54 - Anwar Bounasser
- Commit: `54f2d05`
- Bereich: Follow Up
- Aenderung: Follow Up Badge/Filter auf `failed_attempt` statt `shipped` begrenzt.

### 2026-08-20 15:43 - Anwar Bounasser
- Commit: `fb33485`
- Bereich: AI / WhatsApp
- Aenderung: AI darf Address Flow nicht ueber alte Buttons bei bereits shipped Orders erneut oeffnen.

### 2026-08-20 14:28 - Anwar Bounasser
- Commit: `68b9542`
- Bereich: Manual Orders
- Aenderung: Telefonnummer bei manueller Order-Erstellung wird validiert.
