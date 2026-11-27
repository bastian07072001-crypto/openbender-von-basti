(README.md)

# OpenBender

Ein browserbasierter Editor für Blechprofile — Profile zeichnen, Längen und Winkel exakt bearbeiten, Projekt-Daten und Zuschnitt-Liste erfassen,in 3D anschauen und als **massgenaues DXF** oder **PDF Rüstauftrag** ausgeben.

![Profile konstruieren](docs/screenshot.png)

![3D Vorschau](docs/screenshot2.png)

## Warum

Spengler müssen regelmässig Blechprofile aufnehmen, sei es für die erstellung von Angeboten oder als Produktions-Auftrag für die Werkstatt oder für einem externen Produzenten. Mit openBender soll das Ausmessen solcher Profile auf das Tablet gebracht werden. So können unleserliche Skizzen oder der Verlust von Notizzetteln vermieden werden.

## Funktionen

- **2D-Profil-Editor** — ein Profil als Abfolge von Punkten/Segmenten zeichnen
- **Mehrere Blechprofile pro Projekt** — Profile in einer zuklappbaren Leiste links verwalten (neu, duplizieren, umbenennen, sortieren); jedes mit eigenem Material und eigener Stückliste. PDF und DXF für ein oder alle Profile, Zuschnitt gleicher Materialien auf einer gemeinsamen Rolle
- **Masse per Klick bearbeiten** — auf ein Längen- oder Winkel-Label klicken und einen exakten Wert eingeben; optional sperren, damit das Mass beim Ziehen verbundener Punkte fix bleibt
- **Realistische Umschlag-/Saum-Darstellung** — schematische Falz-Visualisierung mit kleinem, realistischem Biegeradius in 2D-, 3D- und PDF-Ansicht
- **3D-Vorschau** des gebogenen Profils
- **PDF-Export** — Fertigungszeichnung inkl. Stückliste und Projektdaten
- **DXF-Export** — **massgenau**, zur direkten Übergabe an die Abkantmaschine; keine kosmetische Rundung
- **Materialkatalog** (Kupfer, CrNi-Stahl, Aluminium, Prefalz, Stahlblech, Titanzink, …)
- **Eigene Profilvorlagen** — ein gezeichnetes Profil als Vorlage speichern, veränderbare Längen und Winkel benennen; beim Verwenden nur noch diese Masse eingeben (Vorschau mit Bezeichnungen). Ablage im Speicherordner (Unterordner „Vorlagen“)
- **Zuschnitt** — Rollen- oder Tafelware, optimiert auf wenig Verschnitt; Rolle zuerst ablängen, dann aufspalten
- **Module (Erweiterungen)** — Profilvorlagen, eigene Tabs, PDF-Seiten u.v.m. als einzelne JavaScript-Datei; auch kostenpflichtige Module mit Lizenzschlüssel. Anleitung für Entwickler: [docs/module.md](docs/module.md)
- **Tablet-/Touch-tauglich** — grosse Trefferflächen, funktioniert gut mit einem Stift
- **Kein Build-Schritt** — reines JavaScript (ES-Module), läuft direkt im Browser

> **Hinweis zur Genauigkeit:** 2D-Editor, 3D-Vorschau und PDF-Export zeigen an Biegekanten evtl. eine kleine kosmetische Rundung für eine realistischere Darstellung. Der **DXF-Export ist immer massgenau** — er kann an gewisse Abkantmaschinen übergeben werden, seine Masse müssen daher exakt stimmen.

## Schnellstart

Die App ist statisch (kein Backend, kein Build-Schritt), nutzt aber ES-Module und muss daher über HTTP ausgeliefert werden statt direkt als `file://`-URL geöffnet zu werden. Jeder statische Webserver funktioniert:

```bash
python3 -m http.server 8000
```

Danach `http://localhost:8000` im Browser öffnen.

## Bedienung

- **Profil zeichnen**: durch Klicken Punkte setzen; auf ein Längen-/Winkel-Label klicken, um es exakt zu bearbeiten, und über den Sperr-Button ein Mass beim Ziehen verbundener Punkte fixieren
- **Stückliste & Projekt**: Projektdaten und Stücklisten-Positionen
- **3D Vorschau**: 3D-Ansicht des gebogenen Profils
- Export-Buttons: **PDF** (Rüstauftrag), **DXF** (Massgenaue CAD Ausgabe), **Speichern/Laden** (Profil als JSON lokal sichern/laden)

## Projektstruktur

```
index.html
css/               Styles
js/
  models/          Profil-Datenmodell
  controllers/      Zeichnen, Auswahl, Label-Bearbeitung, Historie, Stückliste, Projekt, 3D-Vorschau
  renderer/         2D-Canvas-Rendering
  interactions/      Maus-/Touch-Eventhandling
  export/           PDF-/DXF-/JSON-Exporter
  utils/            Geometrie-Hilfsfunktionen, Materialdaten
  storage/          Speicherordner
  templates/        Eigene Profilvorlagen
  modules/          Modul-System (Schnittstelle, Lizenzen)
modules/           Mitgelieferte Module (Entwickler-Beispiel)
icons/             App-Icon (SVG-Quelle + generierte PNGs)
```

## Technik

Vanilla JavaScript (ES-Module), Canvas 2D, [Three.js](https://threejs.org/) für die 3D-Vorschau, [jsPDF](https://github.com/parallax/jsPDF) + jsPDF-AutoTable für den PDF-Export — alle per CDN eingebunden. Kein Bundler, kein `npm install` nötig.

## Lizenz

MIT — siehe [LICENSE](LICENSE).