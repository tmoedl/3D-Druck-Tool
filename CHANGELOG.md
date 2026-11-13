# Änderungen

Alle nennenswerten Änderungen an diesem Projekt werden hier festgehalten.
Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionsnummern folgen [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

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

[Unreleased]: https://github.com/tmoedl/3D-Druck-Tool/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/tmoedl/3D-Druck-Tool/releases/tag/v1.0.0
