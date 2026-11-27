// Tests für den Gaubenwangen-Rechenkern.
// Aufruf im Repository-Ordner:  node --test tests/gaubenwange/
// Vorher (nur wenn faelle.json geändert wurde):  python3 tests/gaubenwange/zweitrechnung.py

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rechne, wange, spiegeln, GaubenFehler } from '../../modules/gaubenwange/module.js';

const lies = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const { faelle } = lies('./faelle.json');
const zweit = lies('./soll_zweitrechnung.json').faelle;

const nah = (ist, soll, tol, text) => {
    assert.ok(Math.abs(ist - soll) <= tol, `${text}: ist ${ist}, soll ${soll} (Toleranz ${tol})`);
};

// --- 1. Zweitrechnung: jeder Fall, jede Zahl auf 0,001 mm ------------------

for (const [i, fall] of faelle.entries()) {
    test(`Zweitrechnung: ${fall.name}`, () => {
        const r = rechne(fall.eingabe, fall.einstellungen);
        const z = zweit[i];
        assert.equal(z.name, fall.name, 'soll_zweitrechnung.json passt nicht zu faelle.json – zweitrechnung.py neu laufen lassen');
        for (const k of ['H', 'L', 'su', 'so', 'yS', 'flaeche']) nah(r.wange[k], z.wange[k], 1e-3, `Wange ${k}`);
        for (const k of ['alpha', 'beta']) nah(r.wange[k], z.wange[k], 1e-9, `Wange ${k}`);
        assert.equal(r.scharen.length, z.scharen.length, 'Anzahl Scharen');
        r.scharen.forEach((s, j) => {
            const t = z.scharen[j];
            for (const k of ['x0', 'x1', 'breite', 'h0', 'h1']) nah(s[k], t[k], 1e-3, `Schar ${s.nr} ${k}`);
            nah(s.zuschnitt.breite, t.zBreite, 1e-3, `Schar ${s.nr} Zuschnittbreite`);
            for (const k of ['hoeheLinks', 'hoeheRechts', 'versatzUnten', 'versatzOben']) {
                nah(s.zuschnitt[k], t[k], 1e-3, `Schar ${s.nr} ${k}`);
            }
            assert.equal(s.zuschnitt.spitz, t.spitz, `Schar ${s.nr} spitz`);
        });
    });
}

// --- 2. Alle Proben in allen Fällen erfüllt --------------------------------

test('Alle eingebauten Proben bestehen', () => {
    for (const fall of faelle) {
        const r = rechne(fall.eingabe, fall.einstellungen);
        const falsch = r.proben.filter((p) => !p.ok).map((p) => p.name);
        assert.deepEqual(falsch, [], `${fall.name}: ${falsch.join(', ')}`);
        assert.ok(r.ok);
    }
});

// --- 3. Handrechnung / Referenz-Testgaube (Screenshots 27.11.2026) ---------

test('Referenz-Testgaube: Werte wie im SpenglerTV-Rechner', () => {
    const r = rechne({ art: 'schlepp', eingabeart: 'referenz', H: 1200, so: 3500, schmiege: 45 },
        { regel: 'vonVorne', scharbreite: 520 });
    const w = r.wange;
    nah(w.su, 4244.1, 0.05, 'Unterkante 424,4 cm');
    nah(w.L, 3001.0, 0.05, 'Gesamtbreite waagrecht 300,1 cm');
    nah(w.beta, 31, 0.05, 'Winkel oben 31°');
    nah(520 * w.d, 207.9, 0.05, 'Höhenabnahme je Schar 20,8 cm');
    const naehte = [1200, 992.1, 784.1, 576.2, 368.3, 160.4];
    r.scharen.forEach((s, j) => nah(s.h0, naehte[j], 0.05, `Nahtlänge ${s.nr}`));
    assert.deepEqual(r.scharen.slice(0, 5).map((s) => s.breite), [520, 520, 520, 520, 520]);
    nah(r.scharen[5].breite, 401.0, 0.05, 'Restschar 40,1 cm');
    // Schrägschnitt bei 60 cm Zuschnittbreite (Schar 02: 520 + 45 + 35)
    const z2 = r.scharen[1].zuschnitt;
    nah(z2.breite, 600, 1e-9, 'Zuschnittbreite Schar 02');
    nah(z2.versatzUnten, 600.0, 0.05, 'Schrägschnitt unten 60 cm');
    nah(z2.versatzOben, 360.1, 0.05, 'Schrägschnitt oben 36 cm');
});

test('Handrechnung Schar 02 mit Querfalz (Plan, Abschnitt Festlegungen)', () => {
    const r = rechne({ art: 'schlepp', eingabeart: 'referenz', H: 1200, so: 3500, schmiege: 45 },
        { regel: 'vonVorne', scharbreite: 520 });
    const z = r.scharen[1].zuschnitt;
    nah(z.querObenSenkrecht, 17.5, 0.05, 'Querfalz oben senkrecht 15 / cos 30,97°');
    nah(z.querUntenSenkrecht, 21.2, 0.05, 'Querfalz unten senkrecht 15 / cos 45°');
    nah(z.hoeheLinks, 1048.8, 0.05, 'Zuschnitthöhe links');
    nah(z.hoeheRechts, 808.9, 0.05, 'Zuschnitthöhe rechts');
});

test('Erste Schar hat beidseitig 35 mm, letzte keinen Falz an der Spitze', () => {
    const r = rechne({ eingabeart: 'referenz', H: 1200, so: 3500, schmiege: 45 }, { scharbreite: 520 });
    const erste = r.scharen[0].zuschnitt;
    assert.equal(erste.zugabeFront, 35);
    assert.equal(erste.zugabeSpitze, 35);
    nah(erste.breite, 590, 1e-9, 'Zuschnittbreite erste Schar');
    const mitte = r.scharen[2].zuschnitt;
    assert.equal(mitte.zugabeFront, 45);
    assert.equal(mitte.zugabeSpitze, 35);
    const letzte = r.scharen.at(-1).zuschnitt;
    assert.equal(letzte.zugabeSpitze, 0);
    assert.equal(letzte.spitz, false);
    assert.equal(letzte.kontur.length, 4);
    // senkrechter Abschnitt an der Spitze: nur die beiden Querfalz-Zugaben
    nah(letzte.hoeheRechts, letzte.querObenSenkrecht + letzte.querUntenSenkrecht, 1e-9, 'rechte Kante letzte Schar');
    nah(r.scharen.at(-1).x1 + 0, r.wange.L, 1e-9, 'letzte Achse = Spitze');
});

test('Fall B: Schleppgaube 45/15 aus dem Plan', () => {
    const r = rechne({ eingabeart: 'winkel', H: 1200, alpha: 45, beta: 15 }, { regel: 'gleichmaessig', scharbreite: 500 });
    nah(r.wange.L, 1639.2, 0.05, 'L');
    nah(r.wange.su, 2318.2, 0.05, 'Unterkante');
    nah(r.wange.so, 1697.1, 0.05, 'Oberkante');
    nah(r.wange.flaeche, 983538.3, 0.05, 'Fläche');
    assert.equal(r.scharen.length, 4);
    [1200, 900, 600, 300].forEach((h, j) => nah(r.scharen[j].h0, h, 0.6, `Nahtlänge ${j + 1}`));
});

// --- 4. Einteilung und Rundung ---------------------------------------------

test('Scharbreiten ergeben zusammen immer genau L', () => {
    for (const fall of faelle) {
        const r = rechne(fall.eingabe, fall.einstellungen);
        const summe = r.scharen.reduce((t, s) => t + s.breite, 0);
        nah(summe, r.wange.L, 1e-9, fall.name);
    }
});

test('Raster: innere Falzachsen liegen auf dem Raster', () => {
    const r = rechne({ eingabeart: 'laengen', H: 1475, su: 3870, so: 3010 }, { regel: 'gleichmaessig', scharbreite: 540, raster: 5 });
    r.scharen.slice(1).forEach((s) => assert.equal(s.x0 % 5, 0, `Achse ${s.x0}`));
});

test('Gleichmässig: keine Schar breiter als die Vorgabe', () => {
    for (const b of [300, 450, 520, 600, 670]) {
        const r = rechne({ eingabeart: 'winkel', H: 1300, alpha: 40, beta: 10 }, { regel: 'gleichmaessig', scharbreite: b, raster: 0 });
        r.scharen.forEach((s) => assert.ok(s.breite <= b + 1e-9, `b ${b}: Schar ${s.nr} ${s.breite}`));
    }
});

// --- 5. Warnungen ---------------------------------------------------------

test('Restschar unter 100 mm wird gemeldet', () => {
    const r = rechne({ eingabeart: 'winkel', H: 1200, alpha: 45, beta: 15 }, { regel: 'vonVorne', scharbreite: 540 });
    assert.ok(r.scharen.at(-1).breite < 100);
    assert.ok(r.warnungen.some((t) => t.startsWith('Letzte Schar nur')));
});

test('Kontrollmass mit Abweichung wird gemeldet, ohne Abweichung nicht', () => {
    const e = { eingabeart: 'referenz', H: 1200, so: 3500, schmiege: 45 };
    assert.ok(rechne({ ...e, kontrolle: { su: 4250 } }).warnungen.some((t) => t.includes('Kontrollmass Unterkante')));
    assert.ok(!rechne({ ...e, kontrolle: { su: 4246 } }).warnungen.some((t) => t.includes('Kontrollmass')));
    assert.ok(rechne({ ...e, kontrolle: { alpha: 44 } }).warnungen.some((t) => t.includes('Kontrollmass Dachneigung')));
});

test('Satteldachgaube mit schräger Oberkante wird gemeldet', () => {
    const r = rechne({ art: 'sattel', eingabeart: 'winkel', H: 900, alpha: 38, beta: 5 });
    assert.ok(r.warnungen.some((t) => t.startsWith('Satteldachgaube')));
});

// --- 6. Fehleingaben -------------------------------------------------------

const fehlt = (e, feld) => assert.throws(() => wange(e), (f) => f instanceof GaubenFehler && (!feld || f.feld === feld));

test('Fehleingaben werden mit Klartext abgewiesen', () => {
    fehlt({ eingabeart: 'laengen', H: 1200, su: 5000, so: 3000 }, 'su');            // kein Dreieck
    fehlt({ eingabeart: 'laengen', H: 0, su: 4000, so: 3000 }, 'H');
    fehlt({ eingabeart: 'laengen', H: 1200, su: 'abc', so: 3000 }, 'su');
    fehlt({ eingabeart: 'winkel', H: 1200, alpha: 30, beta: 30 }, 'beta');           // Gaube steiler als Dach
    fehlt({ eingabeart: 'winkel', H: 1200, alpha: 95, beta: 10 }, 'alpha');
    fehlt({ eingabeart: 'referenz', H: 1200, so: 1100, schmiege: 45 }, 'so');        // nicht eindeutig
    fehlt({ eingabeart: 'tiefe', H: 1200, L: 500, alpha: 45 }, 'beta');              // L viel zu kurz
    fehlt({ eingabeart: 'unbekannt', H: 1200 }, 'eingabeart');
});

test('Komma als Dezimalzeichen wird angenommen', () => {
    const w = wange({ eingabeart: 'laengen', H: '1200', su: '4244,1135', so: '3500' });
    nah(w.alpha, 45, 1e-4, 'alpha');
});

// --- 7. Rechte Wange --------------------------------------------------------

test('Rechte Wange ist das Spiegelbild der linken', () => {
    const r = rechne({ eingabeart: 'referenz', H: 1200, so: 3500, schmiege: 45 });
    const flaeche = (k) => k.reduce((t, p, i) => { const q = k[(i + 1) % k.length]; return t + p.u * q.v - q.u * p.v; }, 0) / 2;
    for (const s of r.scharen) {
        const l = s.zuschnitt, rw = spiegeln(l);
        nah(Math.abs(flaeche(rw.kontur)), Math.abs(flaeche(l.kontur)), 1e-6, `Fläche Schar ${s.nr}`);
        l.kontur.forEach((p) => assert.ok(rw.kontur.some((q) => Math.abs(q.u - (l.breite - p.u)) < 1e-9 && Math.abs(q.v - p.v) < 1e-9)));
        assert.ok(flaeche(l.kontur) > 0 && flaeche(rw.kontur) > 0, 'beide Konturen gegen den Uhrzeigersinn');
    }
});
