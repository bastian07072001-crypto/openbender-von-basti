# Modul Gaubenwange

Rechner für Gaubenwangen (Schlepp-, Satteldach- und Flachdachgaube): Wangendreieck aus dem Aufmass, Einteilung in senkrechte Scharen mit Winkelstehfalz, Zuschnittmasse mit Falz- und Querfalzzugaben, linke und gespiegelte rechte Wange.

**Stand: Etappe 2 – Rechenkern und Oberfläche, dazu Vorgabe Bandbreite.** Das Modul ist in `modules/index.json` eingetragen und standardmässig eingeschaltet. Bei „Neu“ und „+ Neues Ausmass“ gibt es die Art „Gaubenwange“ mit eigenem Tab: Eingabe, Gesamtansicht, Masstabelle, Zuschnitt je Schar, Rechenweg mit Proben, linke und rechte Wange. PDF und DXF folgen in Etappe 4 und 5.

## Prüfen

Im Repository-Ordner:

```
node --test tests/gaubenwange/rechnung.test.mjs
```

Wurde `tests/gaubenwange/faelle.json` geändert, vorher die unabhängige Zweitrechnung neu erzeugen:

```
python3 tests/gaubenwange/zweitrechnung.py
```

Die Tests prüfen jeden Fall gegen die Python-Zweitrechnung (anderer Rechenweg, Toleranz 0,001 mm), gegen die Handrechnung aus dem Plan und gegen die Zahlen der SpenglerTV-Testgaube.

## Festlegungen (Bastian, 27.11.2026)

- Aufmass: drei Längen netto (Höhe vorne = fertige Nahtlänge, Unterkante, Oberkante), alles in mm
- Winkelstehfalz: 45 mm zur Gaubenfront, 35 mm zur Spitze; erste Schar beidseitig 35 mm
- Querfalz oben und unten je 15 mm, rechtwinklig zur Schnittkante (senkrecht also 15 / cos)
- Scharbreite = Achsmass Falz zu Falz; Einteilung gleichmässig oder von vorne
- Wahlweise Bandbreite (Coil) statt Scharbreite vorgeben: Achsmass = Band − 45 − 35, erste Schar Band − 35 − 35, letzte Schar höchstens Band − 45 (kein Stehfalz an der Spitze); mit Raster nach unten gerundet, kein Zuschnitt wird breiter als das Band
- Restschar unter 100 mm Breite: Warnung
- Letzte Schar an der Spitze senkrecht abgeschnitten, hintere Kante = beide Querfalz-Zugaben; nach dem Umlegen läuft sie auf 0 aus
