// Prüft, dass im PDF der Gaubenwange genau die gerechneten Masse stehen.
// Braucht jsPDF 2.5.1 (wie die App). Einmalig im Repository-Ordner:
//     npm install --no-save jspdf@2.5.1
// Aufruf:
//     node --test tests/gaubenwange/pdf.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { rechne, fmt, pdfGaube, pdfText, pdfDateiname } from '../../modules/gaubenwange/module.js';

let JsPDF = null;
try { JsPDF = createRequire(import.meta.url)('jspdf').jsPDF; } catch (e) { /* unten übersprungen */ }
const ohne = JsPDF ? false : 'jsPDF fehlt: npm install --no-save jspdf@2.5.1';

const { faelle } = JSON.parse(readFileSync(new URL('./faelle.json', import.meta.url), 'utf8'));
const KOPF = { projectNumber: 'P-1', projectName: 'Prüfprojekt', gaube: 'Gaube 1', materialType: 'Titanzink', materialThickness: 0.7 };

/** Alle Textstücke des PDFs in Schreibreihenfolge. */
function texte(doc) {
    const roh = doc.output();
    const liste = [];
    const re = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
    let m;
    while ((m = re.exec(roh))) liste.push(m[1].replace(/\\([()\\])/g, '$1'));
    return liste;
}

/** Kommt die Folge `teil` lückenlos in `liste` vor? Liefert die Anzahl Treffer. */
function treffer(liste, teil) {
    let n = 0;
    for (let i = 0; i + teil.length <= liste.length; i++) {
        if (teil.every((t, j) => liste[i + j] === t)) n++;
    }
    return n;
}

for (const fall of faelle) {
    for (const stellen of [0, 1]) {
        test(`PDF ${fall.name}, Anzeige ${stellen ? '0,1' : '1'} mm`, { skip: ohne }, () => {
            const r = rechne(fall.eingabe, fall.einstellungen);
            const f = (z) => fmt(z, stellen);
            const t = texte(pdfGaube(JsPDF, r, KOPF, { seiten: 'beide', stellen }));
            for (const s of r.scharen) {
                const z = s.zuschnitt;
                // Zeile der Masstabelle
                const zeile = [`L${s.nr} / R${s.nr}`, f(s.breite), f(s.h0), f(s.h1), f(z.breite), f(z.hoeheLinks), f(z.hoeheRechts), f(z.versatzUnten), f(z.versatzOben)];
                assert.equal(treffer(t, zeile), 1, `Tabellenzeile Schar ${s.nr}: ${zeile.join(' ')}`);
                // Massliste auf der Zuschnittseite, je einmal für links und rechts
                const liste = ['Zuschnitt Breite', f(z.breite), 'Höhe vorne (Front)', f(z.hoeheLinks), 'Höhe hinten (Spitze)', f(z.hoeheRechts),
                    'Versatz unten / oben', `${f(z.versatzUnten)} / ${f(z.versatzOben)}`, 'Achsmass', f(s.breite), 'Naht vorne / hinten', `${f(s.h0)} / ${f(s.h1)}`];
                assert.equal(treffer(t, liste), 2, `Massliste Schar ${s.nr}`);
                // Skizze: linke Wange Front links, rechte Wange gespiegelt
                assert.equal(treffer(t, [`Breite ${f(z.breite)}`, f(z.hoeheLinks), f(z.hoeheRechts)]), 1, `Skizze L${s.nr}`);
                assert.equal(treffer(t, [`Breite ${f(z.breite)}`, f(z.hoeheRechts), f(z.hoeheLinks)]), 1 + (f(z.hoeheLinks) === f(z.hoeheRechts) ? 1 : 0), `Skizze R${s.nr}`);
                assert.ok(t.includes(`L${s.nr}`) && t.includes(`R${s.nr}`));
            }
            assert.ok(treffer(t, ['Summe', f(r.wange.L)]) === 1, 'Summe der Achsmasse = Tiefe');
            assert.ok(t.every((x) => !x.includes('?')), 'Zeichen ausserhalb der PDF-Schrift');
        });
    }
}

test('PDF: nur eine Wange, ohne Rechenweg', { skip: ohne }, () => {
    const r = rechne(faelle[0].eingabe, faelle[0].einstellungen);
    const t = texte(pdfGaube(JsPDF, r, KOPF, { seiten: 'R', rechenweg: false }));
    assert.ok(!t.includes('Linke Wange') && t.includes('Rechte Wange'), 'nur Zuschnitte der rechten Wange');
    assert.ok(!t.includes('Rechenweg und Proben'));
});

test('PDF-Seitenzahl: Übersicht + 4 Scharen je Seite + Rechenweg', { skip: ohne }, () => {
    const r = rechne(faelle[0].eingabe, faelle[0].einstellungen);
    const n = r.scharen.length;
    const doc = pdfGaube(JsPDF, r, KOPF, { seiten: 'beide' });
    assert.equal(doc.internal.getNumberOfPages(), 1 + Math.ceil((2 * n) / 4) + 1);
});

test('PDF-Text: Sonderzeichen werden für die Standardschrift ersetzt', () => {
    assert.equal(pdfText('tan α − tan β → 90°, sᵤ² · H'), 'tan alpha - tan beta -> 90°, su² · H');
    assert.equal(pdfDateiname({ projectNumber: 'P 12', gaube: 'Gaube 1' }, new Date(2026, 10, 27, 9, 5)), 'P-12_Gaube-1_Gaubenwange_2026-11-27_0905.pdf');
});
