# Module für OpenBender

Module erweitern OpenBender um Fachfunktionen, ohne den Kern zu ändern. Beispiele sind Profilvorlagen für häufige Teile, ein Falzdach-Modul (Scharen berechnen und in die Stückliste übernehmen), ein Blindpaneel-Modul oder Einfassungen mit eigenem Eingabe-Tab. Ein Modul kann frei und offen sein oder als kostenpflichtiges Modul mit Lizenzschlüssel verkauft werden.

Diese Anleitung richtet sich an Entwicklerinnen und Entwickler. Sie beschreibt die **Schnittstelle Version 1** (`apiVersion: 1`).

**Inhalt**

1. [Was ein Modul kann](#1-was-ein-modul-kann)
2. [Schnellstart](#2-schnellstart)
3. [Aufbau einer Moduldatei](#3-aufbau-einer-moduldatei)
4. [Installieren und verteilen](#4-installieren-und-verteilen)
5. [Die Schnittstelle `api`](#5-die-schnittstelle-api)
6. [Koordinaten, Längen und Winkel](#6-koordinaten-längen-und-winkel)
7. [Daten in der Projektdatei](#7-daten-in-der-projektdatei)
8. [Lebenszyklus und Fehler](#8-lebenszyklus-und-fehler)
9. [Kostenpflichtige Module und Lizenzen](#9-kostenpflichtige-module-und-lizenzen)
10. [Versionen und Kompatibilität](#10-versionen-und-kompatibilität)
11. [Sicherheit](#11-sicherheit)
12. [Richtlinien für gute Module](#12-richtlinien-für-gute-module)
13. [Grenzen von Version 1](#13-grenzen-von-version-1)

---

## 1. Was ein Modul kann

| Möglichkeit | Funktion |
|---|---|
| Eigene Art von Ausmass neben dem Blechprofil (z.B. Blindpaneel) | `api.documents.addType` |
| Profilvorlagen mit Parametern (Dialog mit Vorschau) | `api.templates.add` |
| Profil lesen und ersetzen, Profil aus Schenkeln bauen | `api.profile` |
| Stückliste lesen und setzen | `api.cutlist` |
| Projektdaten lesen und setzen (Material, Dicke …) | `api.project` |
| Eigene Daten in der Projektdatei speichern | `api.data` |
| Einstellungen pro Browser merken | `api.settings` |
| Eigener Haupt-Tab mit eigener Oberfläche | `api.ui.addTab` |
| Funktionen in den Einstellungen (Tab „Module“) | `api.ui.addAction` |
| Dialoge, Eingabeformulare, Meldungen, Dateien speichern | `api.ui.*` |
| Im Profil-Editor zusätzlich zeichnen | `api.canvas.onDraw` |
| Eigene Seiten im PDF | `api.pdf.addPages` |
| DXF-Dateien erzeugen (z.B. für CNC) und lesen | `api.dxf.create`, `api.dxf.read` |
| 3D-Ansichten mit three.js | `api.libs.three` |
| Auf Änderungen reagieren | `api.on` |
| Lizenzstatus abfragen | `api.license` |

Mitgelieferte Beispiele:

- `modules/beispiel/module.js`: Zeigt fast alles, also Tab, Daten, Einstellungen, Menü-Eintrag, CSV-Datei, Zeichnen im Editor und eine PDF-Seite. Das Modul ist standardmässig ausgeschaltet; einschalten unter ⚙️ Einstellungen → Module.

Im Entwicklungsstand (nicht in jeder veröffentlichten Version enthalten):

- `modules/grundformen/module.js`: Profilvorlagen mit eigener Logik (Winkel mit optionalem Umschlag, U- und Z-Profil, Mauerabdeckung), standardmässig aus. Einfache Vorlagen brauchen kein Modul: Anwender legen sie direkt in der App an (📐 Vorlagen → Aktuelles Profil als Vorlage speichern).
- `modules/blindpaneele/module.js`: Eigene Dokumentart mit eigenem Tab, Zeichnung mit ziehbaren Ecken (SVG), Abwicklung und DXF für die CNC-Fräse.
- `modules/biegereihenfolge/`: Tab „Biegefolge“ beim Blechprofil, Rechnung mit Maschinenquerschnitt aus einer DXF-Zeichnung. Zeigt, wie ein grösseres Modul aus mehreren Quelldateien (`lib/`, `src/`) mit einem Bauskript zur einzelnen `module.js` zusammengesetzt wird.

## 2. Schnellstart

Ein Modul ist **eine einzelne JavaScript-Datei** (ES-Modul) **ohne eigene `import`-Anweisungen**. Alles, was es von OpenBender braucht, bekommt es über das Objekt `api`.

```js
// gehrung.js – kleinstes sinnvolles Modul: eine Profilvorlage
export default {
    id: 'gehrung',
    name: 'Gehrungswinkel',
    version: '1.0.0',
    apiVersion: 1,
    author: 'Muster Spenglerei',
    description: 'Winkelblech mit frei wählbarem Winkel.',

    register(api) {
        api.templates.add({
            id: 'winkel',
            name: 'Winkelblech',
            params: [
                { key: 'a', label: 'Schenkel a', type: 'number', unit: 'mm', value: 50, min: 5 },
                { key: 'b', label: 'Schenkel b', type: 'number', unit: 'mm', value: 80, min: 5 },
                { key: 'w', label: 'Winkel', type: 'number', unit: '°', value: 90, min: 20, max: 170 }
            ],
            build: (v) => ({
                steps: [
                    { length: v.a, direction: 90 },          // nach oben
                    { length: v.b, turn: -(180 - v.w) }      // rechts abbiegen
                ]
            })
        });
    }
};
```

So probierst du es aus:

1. In den Einstellungen (⚙️ in der Statusleiste) unter **Allgemein** einen Speicherordner wählen.
2. ⚙️ **Einstellungen → Module → Modul installieren (.js)** und die Datei wählen.
3. Danach: 📐 **Vorlagen → Profil aus Vorlage …**

Während der Entwicklung geht es schneller, wenn du die Datei direkt in den Ordner `<Speicherordner>/Module/` legst und die Seite neu lädst. Alternativ kannst du dein Modul wie die mitgelieferten unter `modules/` eintragen (siehe [4](#4-installieren-und-verteilen)).

## 3. Aufbau einer Moduldatei

```js
export default {
    id, name, version, apiVersion, author, description,   // Angaben
    license,                                             // nur bei kostenpflichtigen Modulen
    register(api) { … },                                 // Pflicht: Modul anmelden
    dispose() { … }                                      // optional: eigenes Aufräumen
};
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `id` | ja | Eindeutige Kennung: a–z, 0–9 und `-`, 2–41 Zeichen. Bestimmt den Dateinamen beim Installieren (`<id>.js`) und den Schlüssel der Daten in der Projektdatei. **Nie mehr ändern.** |
| `name` | empfohlen | Anzeigename (Module-Fenster, Menü) |
| `version` | empfohlen | Eigene Version, z.B. `1.2.0` |
| `apiVersion` | empfohlen | Benötigte Schnittstellen-Version (heute `1`). Ist sie neuer als die von OpenBender, wird das Modul nicht geladen und meldet das. |
| `author` | nein | Herausgeber, wird angezeigt |
| `description` | nein | Ein, zwei Sätze, wird im Module-Fenster angezeigt |
| `license` | nein | Lizenzpflicht, siehe [9](#9-kostenpflichtige-module-und-lizenzen) |
| `register(api)` | ja | Wird beim Start des Moduls aufgerufen und darf `async` sein. Hier meldet das Modul alles an. |
| `dispose()` | nein | Wird beim Ausschalten aufgerufen. Nur nötig, wenn das Modul ausserhalb der Schnittstelle etwas angelegt hat, z.B. Timer. |

## 4. Installieren und verteilen

**Mitgeliefert** werden Module mit der App. Sie liegen in `modules/<id>/module.js` und sind in `modules/index.json` eingetragen:

```json
{ "modules": [
    { "id": "beispiel", "file": "beispiel/module.js", "default": false }
] }
```

`default` legt fest, ob das Modul eingeschaltet ist, solange es niemand umgeschaltet hat. Mitgelieferte Module lassen sich nur ein- und ausschalten, nicht entfernen.

**Installiert** werden Module im Speicherordner, im Unterordner `Module`:

```
<Speicherordner>/
    Module/
        falzdach.js        ← installierte Module (Dateiname = id)
        lizenzen.json      ← Lizenzschlüssel { "falzdach": "OB1.…" }
    Kunde Meier/           ← Profile wie gewohnt
```

- **Installieren:** über ⚙️ Einstellungen → Module → Modul installieren (.js). Die Datei wird geprüft und als `<id>.js` in den Ordner kopiert. Eine ältere Version desselben Moduls wird dabei ersetzt. Von Hand in den Ordner gelegte `.js`-Dateien werden beim nächsten Start geladen.
- **Gemeinsam nutzen:** Liegt der Speicherordner auf einem Netzlaufwerk, haben alle Arbeitsplätze dieselben Module und Lizenzen.
- **Ein/aus** wird pro Browser gemerkt. Ausschalten wirkt sofort, ohne Neuladen.
- **Nach einem Neustart** fragt der Browser je nach Einstellung einmal nach dem Zugriff auf den Ordner. Bis dahin erscheint unten der Hinweis „Module laden“. In Chrome mit „Bei jedem Besuch zulassen“ und in der installierten App entfällt das meist.
- **Browser:** Für installierte Module braucht es Ordnerzugriff: Chrome oder Edge, auch als installierte App; in Brave nach Einschalten unter `brave://flags/#file-system-access-api`. Mitgelieferte Module funktionieren in jedem Browser.
- Der Datei-Browser blendet den Ordner `Module` aus.

## 5. Die Schnittstelle `api`

Jedes Modul bekommt sein eigenes `api`-Objekt. Alle Daten, die herauskommen, sind **Kopien**. Wer sie verändert, ändert das Dokument nicht. Änderungen gehen immer über die `set`-Funktionen.

### 5.1 Allgemein

| Eigenschaft | Inhalt |
|---|---|
| `api.apiVersion` | Schnittstellen-Version von OpenBender (`1`) |
| `api.appVersion` | OpenBender-Version, z.B. `'0.23'` |
| `api.module` | `{ id, name, version }` des eigenen Moduls |
| `api.license` | Lizenzstatus, siehe [9](#9-kostenpflichtige-module-und-lizenzen) |

### 5.2 Profil – `api.profile`

| Funktion | Beschreibung |
|---|---|
| `get()` | Profil: `{ points: [{x, y}], segments: [{ type, startIndex, endIndex, backLength? }], conical }` |
| `set(data, { fit })` | Profil ersetzen. Das ist **ein** Rückgängig-Schritt (Strg+Z). `data` wie bei `get()` oder das Ergebnis von `build()`. `fit: true` zeigt das ganze Profil. Ungültige Daten lösen einen Fehler aus. |
| `build(steps, opts)` | Profil aus Schenkeln bauen, ohne es zu setzen, siehe [6](#6-koordinaten-längen-und-winkel) |
| `unfold()` | Abwicklung in mm: `{ front, back, blank, waste }`. `back`, `blank` und `waste` betreffen konische Profile. |

`segment.type` ist `'line'` oder `'hem'` (Umschlag). OpenBender bestimmt ihn selbst aus der Geometrie, ein Wert in `set()` wird ignoriert. Ein Umschlag entsteht, wenn ein Schenkel fast ganz zurückfaltet, z.B. mit `turn: 180`.

### 5.3 Stückliste – `api.cutlist`

| Funktion | Beschreibung |
|---|---|
| `get()` | Positionen: `[{ length, quantity, interlocking, note }]`. `length` ist in **Meter**. |
| `set(items)` | Stückliste ersetzen. Länge > 0 und Stückzahl ≥ 1 sind Pflicht. |
| `add(item)` | Eine Position anhängen |

### 5.4 Projektdaten – `api.project`

| Funktion | Beschreibung |
|---|---|
| `get()` | `{ projectNumber, projectName, projectAuthor, profileName, materialType, materialSpec, materialThickness, materialColor }` |
| `set(partial)` | Nur die angegebenen Felder ändern, z.B. `set({ materialType: 'Titanzink', materialSpec: 'Blank', materialThickness: 0.7 })`. |
| `material3d(materialType?, spec?)` | Aussehen des Blechs in 3D wie in der 3D Vorschau: `{ key, color, metalness, roughness, texture?, lights }` (texture: `{ id, size, rotate, alpha }`, siehe js/utils/Textures.js; Ausführung mit eigener Darstellung geht vor) für `THREE.MeshStandardMaterial`, ohne Angabe für das Material des Projekts. `lights` enthält Umgebungs-, Haupt- und Fülllicht und die Hintergrundfarbe der 3D Vorschau. |

`materialThickness` muss zu Material und Ausführung lieferbar sein, sonst erscheint sie als „nicht im Sortiment“. Die Materialien stehen in `js/utils/MaterialData.js`.

### 5.5 Eigene Daten – `api.data`

| Funktion | Beschreibung |
|---|---|
| `get()` | Gespeicherte Daten des Moduls oder `null` |
| `set(value)` | Speichern (JSON-fähig: Objekte, Listen, Zahlen, Texte). `null` löscht die Daten. |

Die Daten werden mit der Projektdatei und im Autosave gespeichert, siehe [7](#7-daten-in-der-projektdatei). Seit Version 0.23 gehören sie **zum Blechprofil**: Jedes Profil eines Projekts hat seine eigenen Modul-Daten, `api.data.get()` liefert immer die des aktiven Profils.

### 5.6 Einstellungen – `api.settings`

`get(key, standard)` und `set(key, value)`: kleine Einstellungen pro Browser, z.B. zuletzt gewählte Optionen. Sie können verloren gehen (Browser-Daten löschen). Alles Wichtige gehört in `api.data`.

### 5.7 Oberfläche – `api.ui`

**`addTab({ id?, label, shortLabel?, title?, docType?, layout?, before?, history?, onShow?, onHide? })`**: ein eigener Haupt-Tab rechts neben den bestehenden, mit `before: 'vorschau'` (oder `'profile'`, `'cutlist'`, `'zuschnitt'`, Key eines Modul-Tabs) stattdessen vor diesem Tab. Mit `docType` erscheint der Tab nur bei dieser Dokumentart, siehe 5.9; ohne `docType` immer. Die Rückgabe ist `{ key, container, show(), setLabel(text, short?), refreshHistory() }`.

- `container` ist ein leeres `<div>`, das du frei gestaltest.
- `onShow(container)` läuft bei jedem Öffnen des Tabs, der richtige Moment zum Aktualisieren.
- `shortLabel` gilt auf dem Handy, z.B. nur ein Symbol.
- `layout: 'full'` gibt dem Modul die ganze Fläche unter der Toolbar, ohne Rand und ohne Scrollen der Seite. Das passt für Zeichenflächen. Das Modul ordnet dann selbst an, z.B. mit `display: grid` und `height: 100%`.
- `history: { undo(), redo(), canUndo(), canRedo() }` verbindet den eigenen Verlauf des Moduls mit den Knöpfen ↶ ↷ der Toolbar und mit Strg+Z / Strg+Y, solange der Tab offen ist. Nach jeder Änderung am Verlauf `tab.refreshHistory()` aufrufen, damit die Knöpfe den richtigen Zustand zeigen. Ohne `history` sind die Knöpfe im Modul-Tab gesperrt; das Profil wird dort nie zurückgesetzt.
- Mehrere Tabs pro Modul gehen mit unterschiedlicher `id`.

**`addAction({ id, label, title?, onClick })`**: ein Knopf unter „Funktionen der Module“ in den Einstellungen (Tab „Module“; bis 0.25 im Modul-Menü 🔌). `onClick` darf `async` sein; Fehler werden gemeldet.

**`prompt({ title, text?, fields, okLabel? })`**: Eingabedialog. Die Rückgabe ist ein Promise mit `{ key: Wert }` oder `null` bei Abbruch. Die Felder werden vor dem Schliessen geprüft.

| Feld | Bedeutung |
|---|---|
| `key` | Name des Werts im Ergebnis |
| `label` | Beschriftung |
| `type` | `'number'` (Standard), `'text'`, `'textarea'`, `'select'`, `'check'` |
| `value` | Startwert |
| `unit` | Einheit hinter dem Feld, z.B. `'mm'`, `'°'` |
| `min`, `max`, `step` | Grenzen für Zahlen (werden geprüft) |
| `options` | bei `select`: `['A', 'B']` oder `[{ value, label }]` |
| `help` | kleiner Hilfetext unter dem Feld |

Zahlen kommen als `Number` zurück, `check` als `true` oder `false`.

**`modal({ title, html | content, buttons, wide?, onOpen?(el, close), beforeClose?(value, el) })`**: freier Dialog. `buttons: [{ label, value, primary? }]`, Rückgabe ist das `value` des gedrückten Buttons, beim Schliessen `null`. Gibt `beforeClose` `false` zurück (oder ein Promise mit `false`, z.B. nach einer Rückfrage mit `confirm`), bleibt der Dialog offen.

**`confirm(title, text)`** liefert `true` oder `false`. **`toast(text, 'info' | 'warning', ms?)`** zeigt eine kurze Meldung. **`saveFile(name, inhalt, mime?)`** speichert eine Datei (Speichern-unter-Dialog, sonst Download); bei `'text/csv'` kommt automatisch eine BOM dazu, damit Excel Umlaute erkennt. **`switchTab(key)`** und **`currentTab()`**: Tabs heissen `'profile'`, `'cutlist'`, `'zuschnitt'`, `'vorschau'`, Modul-Tabs haben ihren `key`. **`esc(text)`** escaped Text für HTML.

> **Immer `api.ui.esc()` verwenden**, wenn Text aus Projektdaten, Dateien oder Eingaben in HTML eingesetzt wird.

### 5.8 Profilvorlagen – `api.templates`

**`add({ id, name, category?, description?, params, build })`**: Die Vorlage erscheint unter 📐 Vorlagen → **Profil aus Vorlage …** mit Parametern, Live-Vorschau und Abwicklung, zusammen mit den eigenen Vorlagen der Anwender.

> Für feste Formen mit veränderbaren Längen und Winkeln braucht es kein Modul: Anwender speichern ein gezeichnetes Profil mit 📐 Vorlagen → **Aktuelles Profil als Vorlage speichern** (Datei im Speicherordner, Unterordner `Vorlagen`). Ein Modul lohnt sich, wenn die Vorlage Logik braucht, z.B. Schenkel nur bei Wert > 0, Prüfungen oder eine passende Stückliste.

- `params` sind Felder wie bei `prompt`. Die zuletzt verwendeten Werte merkt sich der Browser.
- `category` gruppiert die Vorlagen in der Liste; Standard ist der Modulname.
- `build(values)` wird bei jeder Eingabe aufgerufen und liefert eines der folgenden Ergebnisse:
  - `{ steps, start?, direction?, conical? }`: Schenkel, siehe [6](#6-koordinaten-längen-und-winkel)
  - `{ points, segments }`: fertiges Profil
  - `{ profile: eines davon, cutlist?: [...], project?: {...} }`: zusätzlich Stückliste (ersetzt sie nach Rückfrage) und Projektdaten

  Wirft `build` einen Fehler, erscheint dessen Text im Dialog. Das ist praktisch für Prüfungen wie „Falzhöhe zu gross“.

### 5.9 Dokumentarten – `api.documents`

Ein Projekt ist eine Sammlung von **Ausmassen** (Leiste links). Jedes Ausmass hat eine Art: „Blechprofil“ (Grundart von OpenBender) oder eine Dokumentart eines Moduls, z.B. ein Blindpaneel. Tabs, Toolbar, PDF und DXF richten sich nach dem aktiven Ausmass; ein Klick auf eine Karte der Leiste wechselt auch die Art.

- **Neu** (Toolbar) beginnt ein neues Projekt und fragt, womit es beginnt.
- **+ Neues Ausmass** (Leiste) fügt dem Projekt eines hinzu und fragt nach der Art.
- Gibt es keine Modul-Dokumentarten, heisst der Knopf „+ Neues Profil“, und beide legen ohne Dialog ein Blechprofil an.

**`addType({ id, name, shortName?, description, icon, mainTab, coreTabs?, hideCutlist?, onNew?, exports?, preview?, split? })`**

| Feld | Bedeutung |
|---|---|
| `id` | Kennung der Art, wird je Ausmass in der Projektdatei gespeichert (`profiles[].type`). `'profile'` ist reserviert. |
| `name`, `description`, `icon` | Kachel im Dialog „Neu“ und Art auf der Karte in der Leiste. `icon` ist ein Zeichen oder Emoji. |
| `shortName` | Name eines Ausmasses ohne eigenen Namen, mit Nummer: `'Blindpaneel'` → „Blindpaneel 3“. Standard: `name`. |
| `mainTab` | `key` des eigenen Tabs (von `addTab` mit `docType: id`), der beim Öffnen gezeigt wird |
| `coreTabs` | Welche Tabs von OpenBender sichtbar bleiben: `'profile'`, `'cutlist'`, `'zuschnitt'`, `'vorschau'`. Standard ist `['cutlist']` (Projektdaten). |
| `hideCutlist` | `true`: Im Tab „Stückliste & Projekt“ nur die Projektdaten zeigen; der Tab heisst dann „Projekt“. |
| `onNew({ from })` | Wird nach „Neues Projekt“ bzw. „Neues Ausmass“ mit dieser Art aufgerufen, z.B. um `api.data` mit leeren Daten zu füllen. `from` sind die Modul-Daten des bisher aktiven Ausmasses, wenn es von derselben Art ist (sonst `null`) – zum Übernehmen von Einstellungen als Vorschlag. |
| `preview(daten)` | Vorschau auf der Karte in der Leiste und im Datei-Browser. Bekommt die Modul-Daten des Ausmasses (wie `api.data.get()`, nur gelesen) und liefert `{ thumbnail: SVG-Text, text }`. `text` steht unter dem Namen. Ohne `preview` zeigt die Karte das `icon`. |
| `split(daten)` | Optional: ein Ausmass in mehrere aufteilen, z.B. ältere Daten mit mehreren Teilen. Liefert `[{ name, data }, …]` oder `null`. Bei mehr als einem Teil ersetzt jeder Teil das Ausmass (der erste behält dessen `id`). Wird beim Öffnen einer Datei, beim Start und beim Einschalten des Moduls aufgerufen. |
| `exports: { pdf(), dxf() }` | Was die Toolbar-Buttons **PDF** und **DXF** tun, wenn ein Ausmass dieser Art aktiv ist (dürfen `async` sein). Fehlt eine Funktion, meldet der Button „noch nicht verfügbar“. |

**`current()`** liefert die Art des aktiven Ausmasses: `'profile'` oder die `id` einer Modul-Dokumentart.

**`entries()`** liefert alle Ausmasse des Projekts von Arten dieses Moduls, in der Reihenfolge der Leiste: `[{ id, nr, type, name, active, data }]`. `nr` ist die Nummer in der Leiste, `name` der eingetragene Name (oder `''`), `data` eine Kopie der Modul-Daten des Ausmasses (beim aktiven der aktuelle Stand). Gebraucht für PDF/DXF über mehrere Ausmasse, z.B. „alle Blindpaneele des Projekts“.

Der Name eines Ausmasses ist das Feld `profileName` (`api.project.get()` / `api.project.set({ profileName })`); er erscheint auf der Karte in der Leiste.

Gehört ein Ausmass zu einem fehlenden oder ausgeschalteten Modul, bleibt es als graue Karte in der Leiste und lässt sich nicht wählen; seine Daten bleiben in der Datei. Ist kein bearbeitbares Ausmass da, ergänzt OpenBender ein leeres Blechprofil. Wird das Modul ausgeschaltet, während eines seiner Ausmasse aktiv ist, wechselt OpenBender zum nächsten bearbeitbaren.

```js
const tab = api.ui.addTab({ id: 'paneele', label: '▭ Blindpaneel', docType: 'blindpaneele' });
api.documents.addType({
    id: 'blindpaneele',
    name: 'Blindpaneel',
    description: 'Paneel aus Verbundplatte …',
    icon: '▭',
    mainTab: tab.key,
    coreTabs: ['cutlist'],
    hideCutlist: true,
    onNew: ({ from }) => api.data.set({ v: 1, settings: from ? from.settings : {}, panels: [] }),
    preview: (daten) => ({ thumbnail: '', text: daten && daten.panels.length ? '600 × 400 mm' : 'Noch keine Form' }),
    exports: { dxf: () => …, pdf: () => … }
});
```

### 5.10 Zeichnen im Editor – `api.canvas`

**`onDraw((ctx, info) => { … })`**: wird nach jedem Zeichnen des Profil-Editors aufgerufen.

- `ctx` ist der Canvas-2D-Kontext, bereits in **Profil-Millimetern** (gleiche Koordinaten wie `profile.get()`).
- `info = { scale, points, segments, conical, side }`. `scale` ist Pixel pro mm, `points` sind die Punkte des gerade bearbeiteten Endes (`side`: `'front'` oder `'back'`).
- Für Linien und Schrift mit fester Bildschirmgrösse durch `scale` teilen, z.B. `ctx.lineWidth = 1 / scale` und `ctx.font = \`${12 / scale}px sans-serif\``.
- `save()` und `restore()` übernimmt OpenBender.

**`redraw()`**: neu zeichnen lassen, z.B. nach einer Einstellungsänderung.

### 5.11 PDF – `api.pdf`

**`addPages((pdf) => { … }, { id, label, standard })`**: wird beim PDF-Export nach den Seiten von OpenBender aufgerufen, vor den Seitenzahlen.

Beim Klick auf **PDF** erscheint ein Dialog, in dem der Benutzer per Checkbox wählt, welche Zusatzinhalte ins PDF kommen: Zuschnittliste, Zuschnitt-Visualisierung und je ein Eintrag pro `addPages`. Die Optionen dazu:

| Option | Bedeutung |
|---|---|
| `id` | Kennung des Abschnitts innerhalb des Moduls (bei mehreren `addPages` je eine eigene) |
| `label` | Text im Dialog, z.B. „Fertigungsliste (Übersicht je Teil)“. Fehlt er, steht der Modulname da |
| `standard` | `false` = im Dialog zuerst nicht angehakt (Vorgabe `true`). Die Wahl des Benutzers merkt sich der Browser |

| `pdf.` | Inhalt |
|---|---|
| `doc` | das jsPDF-Dokument (jsPDF 2.5.1, Einheit mm, A4 hoch), inkl. `doc.autoTable` |
| `newPage(titel)` | neue Seite mit Titel und Projektzeile im Stil der App; liefert die y-Position darunter |
| `margin`, `pageWidth`, `pageHeight` | Seitenmasse in mm |
| `project`, `profile`, `unfold`, `cutlist` | Kopien der Dokumentdaten |

Ohne `newPage()` entsteht keine Seite. So kann ein Modul nur dann eine Seite ausgeben, wenn es etwas zu zeigen hat. Die PDF-Standardschriften kennen nur Westeuropäisch: kein `→`, keine Emojis.

### 5.12 DXF – `api.dxf`

**`create(layers)`** liefert einen DXF-Schreiber im Format R12 (AC1009), Einheit mm. Diesen Aufbau lesen praktisch alle CAD- und CAM-Programme. `layers` ist `{ NAME: Farbe }` mit Farben als AutoCAD-Farbnummer (1 = rot, 3 = grün, 5 = blau, 7 = weiss/schwarz).

| Methode | Beschreibung |
|---|---|
| `polyline(punkte, { layer, closed })` | Linienzug, `punkte: [{ x, y, bulge? }]`. `bulge` = tan(Öffnungswinkel / 4) des Bogens zum nächsten Punkt, positiv = Gegenuhrzeigersinn. Echte Kreisbögen, keine Annäherung. |
| `line(a, b, layer)` | Linie |
| `circle(c, r, layer)`, `arc(c, r, startGrad, endGrad, layer)` | Kreis und Bogen (Gegenuhrzeigersinn) |
| `text(text, punkt, höhe, layer)` | Text |
| `toString()` | Fertige DXF-Datei als Text |

Geschlossene Polylinien bekommen das Kennzeichen „geschlossen“ und zusätzlich den Startpunkt am Ende, weil manche Leser das Kennzeichen übergehen, z.B. der DXF-Import von FreeCAD. Speichern mit `api.ui.saveFile(name, dxf.toString(), 'application/dxf')`.

**`read(text, { tolerance? })`** liest eine DXF-Datei (R12 bis 2018, z.B. aus QCad, LibreCAD, FreeCAD oder AutoCAD) und setzt Linien und Bögen jedes Layers zu Konturen zusammen. Endpunkte näher als `tolerance` (Standard 0.01 mm) gelten als verbunden. Die Datei liest man z.B. über ein `<input type="file">` mit `await file.text()`.

```js
const { units, layers, warnings } = api.dxf.read(text);
layers.OBERWANGE.loops      // geschlossene Konturen: [{ points: [{ x, y, bulge }], area }]
layers.OBERWANGE.open       // offene Züge: [{ points, start, end }] – meist ein Zeichenfehler
layers.OBERWANGE.branches   // Punkte mit mehr als zwei Linien: [{ x, y, count }]
layers.ACHSE.points         // POINT-Objekte; .texts: [{ text, x, y }]
```

- Layer-Namen in Grossbuchstaben, alle Masse in mm (`$INSUNITS` Zoll, cm, m wird umgerechnet; ohne Angabe gilt mm).
- Konturen laufen immer im Gegenuhrzeigersinn, `area` ist die Fläche in mm² (Bögen exakt mitgerechnet). `bulge` wie bei `polyline`.
- Unterstützt: LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE, POINT, TEXT, MTEXT und Blöcke (INSERT, auch gedreht und gespiegelt). SPLINE, ELLIPSE und HATCH werden ausgelassen und in `warnings` gemeldet.

### 5.13 Bibliotheken – `api.libs`

**`three`**: three.js (Version r128, wie die 3D-Vorschau von OpenBender) inklusive `THREE.OrbitControls`, oder `null`, falls die Bibliothek nicht geladen werden konnte (z.B. offline ohne Zwischenspeicher). Module laden three.js also nicht selbst.

**`jsPDF`**: der Konstruktor von jsPDF 2.5.1 inklusive Plugin `autoTable`, oder `null`. Gebraucht für eigene PDF-Dokumente, z.B. als `exports.pdf` einer Dokumentart: `const doc = new api.libs.jsPDF('p', 'mm', 'a4'); …; doc.save('name.pdf')`. Für zusätzliche Seiten im Blechprofil-PDF gibt es `api.pdf.addPages`.

Ein Modul mit eigener 3D-Ansicht legt seinen `WebGLRenderer` einmal an und hängt `renderer.domElement` in seinen Tab. In `dispose()` gibt es ihn mit `renderer.dispose()` wieder frei; Browser erlauben nur eine begrenzte Zahl von WebGL-Zeichenflächen. Beispiel: die 3D-Ansicht im Modul Blindpaneele.

### 5.14 Ereignisse – `api.on(name, fn)`

| Ereignis | Wann |
|---|---|
| `profile:updated` | Profil geändert (Zeichnen, Masse, Rückgängig, Laden …) |
| `document:changed` | irgendetwas am Dokument geändert (Profil, Stückliste, Projektdaten, Zuschnitt, Modul-Daten) |
| `document:new` | „Neu“ (vor `onNew` der gewählten Dokumentart) |
| `document:loaded` | Datei geladen oder anderes Profil des Projekts gewählt (danach `api.data.get()` und das Profil neu lesen) |
| `tab:changed` | anderer Tab, Parameter: der neue Tab-Key |

Die Abos werden beim Ausschalten des Moduls automatisch beendet.

## 6. Koordinaten, Längen und Winkel

- Alle Längen im Profil sind **Millimeter**, Stücklisten-Längen sind **Meter**.
- Profil-Koordinaten sind wie auf dem Bildschirm: **x nach rechts, y nach unten**.
- Ein Profil ist eine Kette von Punkten. Segment `i` verbindet `startIndex` mit `endIndex`, normalerweise Punkt `i` mit `i+1`.

Am einfachsten baut man Profile mit **Schenkeln** (`api.profile.build(steps, opts)` oder `steps` in einer Vorlage):

| Angabe | Bedeutung |
|---|---|
| `length` | Länge des Schenkels in mm (Pflicht) |
| `turn` | Richtungsänderung **vor** diesem Schenkel in Grad. Positiv = links herum, negativ = rechts herum (so wie man es auf dem Bildschirm sieht). |
| `direction` | statt `turn`: absolute Richtung in Grad. **0 = nach rechts, 90 = nach oben**, 180 = links, 270 = unten. |
| `backLength` | nur konisch: Länge am hinteren Ende |
| `opts.start` | Startpunkt `{x, y}` (Standard 0/0) |
| `opts.direction` | Startrichtung (Standard 0) |
| `opts.conical` | konisches Profil (Standard `false`) |

Der Editor zeigt **Innenwinkel**, also den Winkel zwischen zwei Schenkeln (90° = rechtwinklig, 135° = stumpf). Umrechnung: `turn = ±(180 − Innenwinkel)`.

| Innenwinkel im Editor | `turn` links herum | `turn` rechts herum |
|---|---|---|
| 90° | `90` | `-90` |
| 135° | `45` | `-45` |
| 45° (spitz) | `135` | `-135` |
| Umschlag (zurückfalten) | `180` | `-180` |

## 7. Daten in der Projektdatei

Projektdateien (`.json`, Format **2.1**) enthalten mehrere Ausmasse, jedes mit seiner Art (`type`). Die Daten der Module stehen je Ausmass unter `modules`:

```json
{
  "version": "2.1",
  "project": { "projectNumber": "…", "projectName": "…", "projectAuthor": "…" },
  "activeProfile": "p-3f9a…",
  "profiles": [
    { "id": "p-3f9a…", "type": "profile", "name": "Ortblech",
      "material": { "type": "Kupfer", "spec": "Blank", "thickness": 0.6, "color": "" },
      "profile": { … }, "cutlist": [ … ], "cutting": { … },
      "modules": { "falzdach": { "scharbreite": 530, "felder": [ … ] } } }
  ]
}
```

Für ein Modul ändert sich dadurch nichts: `api.project.get()` liefert wie bisher Projekt- und Materialfelder zusammen (die des aktiven Ausmasses), `api.profile`, `api.cutlist` und `api.data` beziehen sich auf das aktive Ausmass. Dateien im Format 1.5 (ein Profil, alles auf oberster Ebene) öffnen sich als Projekt mit einem Ausmass; bei Format 2.0 gilt die Dokumentart der Datei (`docType`) für alle Einträge.

- Daten eines Moduls **bleiben erhalten**, auch wenn das Modul auf einem Rechner fehlt oder ausgeschaltet ist. Wird die Datei dort gespeichert, sind die Daten weiterhin drin.
- „Neu“ leert die Daten aller Module, Laden ersetzt sie. Ein neues Ausmass beginnt ohne Modul-Daten (dann `onNew`), „Duplizieren“ kopiert sie mit.
- Die Daten werden **nicht** über Rückgängig erfasst; Rückgängig betrifft nur das Profil.
- Plane ein eigenes Versionsfeld in deinen Daten ein, z.B. `{ v: 1, … }`, damit spätere Modulversionen alte Dateien erkennen.

## 8. Lebenszyklus und Fehler

1. Beim Start lädt OpenBender zuerst die mitgelieferten Module, dann die installierten aus dem Speicherordner. Das geschieht nach dem Aufbau der App: Profil, Stückliste und gespeicherte Modul-Daten sind schon da.
2. Eingeschaltete Module werden geprüft (`id`, `register`, `apiVersion`, Lizenz) und mit `register(api)` gestartet.
3. Alles, was ein Modul anmeldet (Tabs, Menüeinträge, Vorlagen, Zeichnen, PDF, Ereignisse), merkt sich OpenBender. **Beim Ausschalten wird alles wieder entfernt**, danach folgt `dispose()`.
4. Wirft `register` einen Fehler, wird das Teil-Angemeldete entfernt. Das Modul erscheint dann als „Fehler“ mit Meldung im Module-Fenster.
5. Fehler in Ereignissen, beim Zeichnen oder im PDF werden in der Browser-Konsole (F12) gemeldet und stören die App nicht.

Zum Debuggen: Konsole öffnen (F12). Fehlermeldungen beginnen mit `Modul „<id>“`.

## 9. Kostenpflichtige Module und Lizenzen

### Prinzip

- Der Herausgeber besitzt ein **Schlüsselpaar**. Mit dem **privaten** Schlüssel stellt er Lizenzen aus, und zwar nur im Lizenz-Werkzeug, nie in der App.
- OpenBender kennt die **öffentlichen** Schlüssel der anerkannten Herausgeber (`js/modules/publishers.js`) und prüft Lizenzen damit **offline**.
- Ein Lizenzschlüssel sieht so aus: `OB1.<Daten>.<Signatur>`. Die Daten enthalten Herausgeber, Modul-ID, Lizenznehmer, Ausstellungsdatum und Ablaufdatum (oder unbefristet). Die Signatur ist ECDSA P-256 / SHA-256. Jede Änderung, etwa ein anderes Datum oder ein anderes Modul, macht sie ungültig.
- Der Kunde gibt den Schlüssel unter ⚙️ Einstellungen → Module → **Lizenz eingeben** ein. Er wird in `Module/lizenzen.json` im Speicherordner abgelegt und gilt damit für alle Arbeitsplätze mit diesem Ordner.

### Im Modul

```js
export default {
    id: 'falzdach',
    // …
    license: {
        publisher: 'bau-blech',   // Herausgeber-ID aus publishers.js
        product: 'falzdach',      // optional, Standard = id
        demo: true                // optional: ohne Lizenz als Demo starten
    },
    register(api) {
        if (!api.license.valid) {
            // Demo: z.B. nur 3 Felder, PDF mit Vermerk „Demo“
        }
        // api.license.licensee: Lizenznehmer, z.B. im PDF-Fuss ausgeben
    }
};
```

| `api.license.` | Bedeutung |
|---|---|
| `required` | Modul ist lizenzpflichtig |
| `valid` | gültige Lizenz vorhanden (bei Modulen ohne Lizenzpflicht immer `true`) |
| `demo` | läuft ohne gültige Lizenz (nur mit `license.demo: true`) |
| `licensee` | Lizenznehmer laut Schlüssel |
| `expires` | Ablaufdatum `'JJJJ-MM-TT'` oder `null` |

Ohne `demo: true` startet ein lizenzpflichtiges Modul ohne gültige Lizenz gar nicht. Es erscheint als „Lizenz fehlt“ mit dem Grund, z.B. abgelaufen, falsches Modul oder Signatur ungültig.

### Ablauf für Herausgeber

Das Werkzeug liegt in `Lizenz-Werkzeug/lizenz-werkzeug.html`, ausserhalb des App-Ordners. **Es darf nicht mit der App veröffentlicht werden.** Es läuft offline im Browser.

1. **Einmalig: Schlüsselpaar erzeugen.**
   - Herausgeber-ID und Namen eintragen. Das Werkzeug speichert `…-PRIVATER-SCHLUESSEL.json`. Diese Datei sicher aufbewahren und sichern, aber nie weitergeben und nie in den App-Ordner legen.
   - Den angezeigten Eintrag in `js/modules/publishers.js` einfügen und die App veröffentlichen.
2. **Pro Verkauf:**
   - Den privaten Schlüssel laden, Modul-ID und Lizenznehmer eintragen, auf Wunsch ein Ablaufdatum.
   - Auf „Lizenz erstellen“ klicken und dem Kunden den Schlüssel bzw. die Textdatei schicken.
3. **Andere Herausgeber:** Wer selbst Module verkaufen will, erzeugt ein eigenes Schlüsselpaar und schickt den öffentlichen Schlüssel an den OpenBender-Betreiber. Erst mit dem Eintrag in `publishers.js` erkennt OpenBender diese Lizenzen.

### Was die Lizenz leistet und was nicht

OpenBender läuft im Browser, und ein Modul ist lesbarer JavaScript-Code. Die Prüfung ist eine **Hürde gegen einfaches Weitergeben**, kein Kopierschutz: Wer den Code ändert, kann sie umgehen. Sinnvoll ergänzen lässt sie sich so:

- Lizenznehmer sichtbar machen, z.B. im PDF-Fuss oder im Modul-Tab. Weitergegebene Kopien sind dann zuordenbar.
- Lizenzbedingungen (EULA) mit dem Modul ausliefern.
- Updates und Support nur für Lizenznehmer.
- Später, mit der ERPNext-Anbindung, können Module für angemeldete Benutzer auch vom Server kommen.

## 10. Versionen und Kompatibilität

- Die Schnittstelle hat eine Versionsnummer (`api.apiVersion`, heute `1`).
- **Innerhalb von Version 1 kommt nur Neues dazu**: neue Funktionen, neue Felder, neue Ereignisse. Bestehendes bleibt, wie es hier beschrieben ist. Ein Modul für Version 1 läuft also auf jeder späteren 1.x.
- Ändert sich etwas inkompatibel, steigt die Version auf 2. OpenBender lädt dann weiterhin Module mit `apiVersion: 1`, solange das vertretbar ist; das Vorgehen steht dann hier.
- Neue Funktionen prüfen, bevor man sie nutzt: `if (api.cutlist.addMany) …`
- Für Module gilt: in `version` hochzählen, Datenformat in `api.data` mit eigener Versionsnummer.

## 11. Sicherheit

- Module sind Programmcode mit **vollem Zugriff** auf die App und den Browser-Tab. Installiere nur Module aus vertrauenswürdiger Quelle. Das Module-Fenster weist darauf hin.
- Die Schnittstelle prüft Daten, die Module ins Dokument schreiben (Profil, Stückliste), und schützt so das Datenmodell vor fehlerhaften Modulen. Gegen absichtlich schädliche Module schützt sie nicht.
- Text aus Dateien oder Eingaben immer mit `api.ui.esc()` in HTML einsetzen.

## 12. Richtlinien für gute Module

- **Nur die Schnittstelle benutzen.** Kein Zugriff auf interne Klassen, keine Änderungen an fremden DOM-Elementen. Eigene Oberfläche nur im eigenen Tab-`container` oder in Dialogen. So bleibt das Modul bei OpenBender-Updates lauffähig.
- **IDs und CSS-Klassen mit Präfix**, z.B. `fd-` für Falzdach. Dann gibt es keine Kollisionen mit anderen Modulen.
- **Bedienung wie OpenBender:** deutsch, Schweizer Schreibweise (ss statt ß), Masse in mm, Längen in der Stückliste in m. Bedienelemente auf Tablets mindestens 44 px gross.
- **Keine Netzwerkzugriffe** ohne klaren Hinweis an den Benutzer. OpenBender arbeitet lokal.
- **Fachlogik im Modul behalten** (Berechnung, Normen, Herstellerangaben), allgemeine Funktionen gehören in den Kern. Wenn dir etwas in der Schnittstelle fehlt, melde es; Erweiterungen für alle sind besser als Umwege.
- **Vorlagen-Werte prüfen:** In `build()` mit verständlicher Meldung einen Fehler werfen, wenn eine Kombination nicht herstellbar ist.

## 13. Grenzen von Version 1

Geplant, aber noch nicht in der Schnittstelle:

- **Zugriff auf alle Profile des Projekts.** Seit 0.23 kann ein Projekt mehrere Blechprofile enthalten; ein Modul sieht aber nur das aktive.
- Eigene Materialien und Rollen- bzw. Tafelformate für den Zuschnitt.
- Erweiterungen für DXF-Export, 3D-Vorschau und Zuschnitt-Optimierung.
- Eigene Werkzeuge im Zeichen-Editor, z.B. Klick-Interaktion auf der Zeichenfläche.
- Module vom Server, im Zusammenhang mit der ERPNext-Anbindung.
