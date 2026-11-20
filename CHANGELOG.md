# Änderungen

Alle nennenswerten Änderungen an diesem Projekt werden hier festgehalten.
Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionsnummern folgen [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

## [1.1.0] – 2026-11-20

### Neu: Karten-Studio (3D-Karten aus Aktivitäten und Gebieten)
- Echte Geländehöhen (AWS Terrain Tiles) und Untergrund aus OpenStreetMap: Wald, Wiese,
  Acker, Siedlung, Wasser (Seen eben und vertieft, Flüsse als Rinne), Fels, Gletscher,
  optional Gebäude als Klötzchen und Straßen. Alternativ Färbung nach Höhenstufen oder einfarbig.
- Ausschnitt per 2D-Karte mit festem Sucher wählen (zoomen = größeres/kleineres Gebiet),
  Ortssuche, Formen Rechteck, abgerundet, Kreis, Sechseck, beliebige Seitenverhältnisse.
- Überhöhung frei oder feste Relief-Höhe in mm, Grunddicke, Glättung, Auflösung.
- GPX, TCX und FIT (auch `.gz` aus dem Strava-Export), mehrere Routen in eigenen Farben,
  erhaben, bündig oder als Rinne, Breite, Glättung, Start-/Ziel-Markierung.
  Multisport-FIT (Triathlon) wird automatisch in Teilstrecken getrennt; Einheiten ohne GPS
  (Hallenbad) zählen für die Statistik.
- Routen werden im selben Raster wie das Gelände berechnet und liegen immer exakt auf der
  Oberfläche (Abweichung < ½ Rasterzelle, per Test geprüft).
- Beschriftung: Titel und Statistik-Zeilen mit Platzhaltern ({distanz}, {zeit}, {pace}, …),
  Werte überschreibbar (z. B. offizielle Gesamtzeit), Titelleiste oder auf der Karte,
  erhaben, eben abgehoben, auf Plakette, eingraviert oder nur farbig; Ortsnamen und Gipfel.
- Rahmen mit Titelleiste, Filament-Zuordnung je Untergrund, 4/8/16 Filamente.
- Automatischer Vorschlag beim Laden einer Aktivität (Ausschnitt, Format, Überhöhung,
  Farben, Titel und Statistik passend zur Sportart).
- Stecksystem: Module (Bilderrahmen mit Einschub für Fotoabzüge, Medaillenhalter mit Haken
  und Text, Textschild) werden an die Karte angesetzt und von hinten mit Doppel-T-Verbindern
  zusammengesteckt; Aufhängeschlitze für Nagel/Schraube.

### Neu: Projekte
- Projekte speichern und öffnen (`.3dprojekt`): Modell, Farben und alle Karten-Einstellungen
  inkl. Routen. In Chrome/Edge speichert Strg+S direkt in die Datei.
- Automatische Zwischenspeicherung im Browser, „Zuletzt bearbeitet“ auf der Startseite.

### Verbessert
- Startseite mit klaren Einstiegen, übersichtlichere Kopfleiste, Hilfe mit Tastenkürzeln (F1).
- Bis zu 16 Filamente (Tasten 1–9), Strg+E exportiert 3MF.

## [1.0.0] – 2026-11-13

Erste öffentliche Version.

### Funktionen
- STL, OBJ und 3MF öffnen, mehrere Teile zu einem Modell zusammenfügen.
- Bemalen pro Dreieck mit bis zu 8 Filamenten: Pinsel, Dreieck, Eimer (mit
  Kantenwinkel), Rechteck, Höhe, Pipette, Alles färben, Farbe ersetzen.
- Exakte Formen (Kreis, Rechteck, Polygon, Lasso), die ins Netz eingeschnitten
  werden – bündig, erhaben oder eingraviert.
- Farbverlauf zwischen zwei Filamenten (Raster, Rauschen, Streifen) mit
  Unterteilung nur im Übergangsbereich.
- Bild importieren: als farbige Platte oder exakt auf das Modell aufgebracht,
  mehrfach platzierbar.
- Logo / Schild-Editor mit Relief-Vorschau, Effekten, Plattenformen, Rahmen und Vorlagen.
- Teilen-Werkzeug: Schnitt per Achse, Bereich, Kante, Querschnitt, Fläche,
  3 Punkte oder Bauraum; Verbinder (Dübel, Zapfen, Magnete, Bohrungen, Nut & Feder);
  Hinlegen & Anordnen, Export der Teile als STL-ZIP.
- Modell drehen, spiegeln, skalieren, hinlegen, unterteilen.
- 3MF-Export für Anycubic Slicer Next, OrcaSlicer, Bambu Studio und PrusaSlicer;
  eigene 3MF-Dateien lassen sich mit Farben wieder öffnen.
- Startskripte für Linux/macOS (`start.sh`) und Windows (`start.bat`, ohne Python lauffähig).

[Unreleased]: https://github.com/tmoedl/3D-Druck-Tool/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/tmoedl/3D-Druck-Tool/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/tmoedl/3D-Druck-Tool/releases/tag/v1.0.0
