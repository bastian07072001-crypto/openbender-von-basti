/**
 * Gaubenwange – Rechenkern (Etappe 1)
 *
 * Rechnet die Seitenwand (Wange) einer Schlepp-, Satteldach- oder Flachdachgaube
 * aus dem Aufmass, teilt sie in senkrechte Scharen (Winkelstehfalz) ein und
 * liefert die Zuschnittmasse jeder Schar mit Falz- und Querfalzzugaben.
 *
 * Dieser Teil hat keine Oberfläche und greift auf nichts von OpenBender zu.
 * Oberfläche, PDF und DXF (Etappen 2–5) lesen nur die Ergebnisse von `rechne()`.
 * Tests: `node --test tests/gaubenwange/`
 *
 * Einheiten: Längen in mm, Winkel in Grad.
 *
 * Koordinaten (Seitenansicht der linken Wange, von aussen gesehen):
 *   x waagrecht von der Gaubenfront nach hinten, y senkrecht nach oben.
 *   Fu = (0 | 0)  vorne unten, Gaubenfront trifft Hauptdach
 *   Fo = (0 | H)  vorne oben, Gaubenfront trifft Gaubendach
 *   S  = (L | yS) Spitze, Gaubendach trifft Hauptdach
 *   Unterkante (Hauptdach)  y = x · tan α
 *   Oberkante (Gaubendach)  y = H + x · tan β
 *   Nahtlänge an der Stelle x:  h(x) = H − x · (tan α − tan β)
 */

const RAD = Math.PI / 180;
const EPS = 1e-9;

export const ARTEN = {
    schlepp: 'Schleppgaube',
    sattel: 'Satteldachgaube',
    flach: 'Flachdachgaube'
};

export const EINGABEARTEN = {
    laengen: 'Drei Längen (Höhe vorne, Unterkante, Oberkante)',
    winkel: 'Höhe vorne, Dachneigung, Gaubenneigung',
    tiefe: 'Höhe vorne, waagrechte Tiefe, Dachneigung',
    referenz: 'Höhe vorne, Oberkante, Winkel unten an der Front'
};

/** Vorgaben laut Festlegung mit Bastian (27.11.2026). */
export const STANDARD = Object.freeze({
    regel: 'vonVorne',        // 'vonVorne' | 'gleichmaessig'
    scharbreite: 520,         // Achsmass Falz zu Falz (netto)
    raster: 1,                // Falzachsen auf dieses Mass runden (mm), 0 = nicht runden
    minRest: 100,             // Restschar schmaler als das: Warnung
    zugabeFront: 45,          // Winkelstehfalz, Seite zur Gaubenfront
    zugabeSpitze: 35,         // Winkelstehfalz, Seite zur Spitze
    zugabeErsteFront: 35,     // erste Schar: kleiner Falz an der Gaubenecke
    querOben: 15,             // rechtwinklig zur Schnittkante, 90° nach vorne
    querUnten: 15,            // rechtwinklig zur Schnittkante, 170° umgelegt
    tolWinkel: 0.5,           // Kontrollmass: erlaubte Abweichung in Grad
    tolLaenge: 5              // Kontrollmass: erlaubte Abweichung in mm
});

export class GaubenFehler extends Error {
    constructor(text, feld) {
        super(text);
        this.name = 'GaubenFehler';
        this.feld = feld || null;
    }
}

// --- kleine Helfer ---------------------------------------------------------

const zahl = (wert, feld, name) => {
    const z = typeof wert === 'string' ? Number(wert.replace(',', '.')) : wert;
    if (typeof z !== 'number' || !Number.isFinite(z)) {
        throw new GaubenFehler(`${name} fehlt oder ist keine Zahl.`, feld);
    }
    return z;
};

const positiv = (wert, feld, name) => {
    const z = zahl(wert, feld, name);
    if (z <= 0) throw new GaubenFehler(`${name} muss grösser als 0 sein.`, feld);
    return z;
};

const nichtNegativ = (wert, feld, name) => {
    const z = zahl(wert, feld, name);
    if (z < 0) throw new GaubenFehler(`${name} darf nicht negativ sein.`, feld);
    return z;
};

const grad = (rad) => rad / RAD;
const clamp1 = (c) => Math.max(-1, Math.min(1, c));

/** Zahl mit Komma, z.B. fmt(3001.04) → "3001,0" */
export const fmt = (z, stellen = 1) => z.toFixed(stellen).replace('.', ',').replace(/^-(0,0*)$/, '$1');

// --- 1. Wange aus dem Aufmass ---------------------------------------------

/**
 * Bestimmt das Wangendreieck aus einer der vier Eingabearten.
 * @param {object} e  { eingabeart, H, su, so, alpha, beta, L, schmiege }
 * @returns {object}  Wange mit allen Massen und Winkeln
 */
export function wange(e) {
    const art = e.eingabeart || 'laengen';
    let H, alpha, beta;
    const weg = [];   // Rechenweg dieser Stufe

    if (art === 'laengen') {
        H = positiv(e.H, 'H', 'Höhe vorne');
        const su = positiv(e.su, 'su', 'Unterkante');
        const so = positiv(e.so, 'so', 'Oberkante');
        if (H + so <= su + EPS || H + su <= so + EPS || su + so <= H + EPS) {
            throw new GaubenFehler('Die drei Längen ergeben kein Dreieck. Bitte Aufmass prüfen (jede Seite muss kürzer sein als die beiden anderen zusammen).', 'su');
        }
        // Kosinussatz: Winkel an der Front unten und oben
        const cosU = (H * H + su * su - so * so) / (2 * H * su);
        const cosO = (H * H + so * so - su * su) / (2 * H * so);
        const wU = grad(Math.acos(clamp1(cosU)));
        const wO = grad(Math.acos(clamp1(cosO)));
        alpha = 90 - wU;
        beta = wO - 90;
        weg.push(`Winkel unten (Kosinussatz) = arccos((H² + sᵤ² − sₒ²) / (2·H·sᵤ)) = ${fmt(wU, 3)}°  →  Dachneigung α = 90° − ${fmt(wU, 3)}° = ${fmt(alpha, 3)}°`);
        weg.push(`Winkel oben (Kosinussatz) = arccos((H² + sₒ² − sᵤ²) / (2·H·sₒ)) = ${fmt(wO, 3)}°  →  Gaubenneigung β = ${fmt(wO, 3)}° − 90° = ${fmt(beta, 3)}°`);
    } else if (art === 'winkel') {
        H = positiv(e.H, 'H', 'Höhe vorne');
        alpha = zahl(e.alpha, 'alpha', 'Dachneigung');
        beta = zahl(e.beta, 'beta', 'Gaubenneigung');
    } else if (art === 'tiefe') {
        H = positiv(e.H, 'H', 'Höhe vorne');
        const L = positiv(e.L, 'L', 'Waagrechte Tiefe');
        alpha = zahl(e.alpha, 'alpha', 'Dachneigung');
        if (alpha <= 0 || alpha >= 90) throw new GaubenFehler('Dachneigung muss zwischen 0° und 90° liegen.', 'alpha');
        beta = grad(Math.atan(Math.tan(alpha * RAD) - H / L));
        weg.push(`tan β = tan α − H / L = ${fmt(Math.tan(alpha * RAD), 5)} − ${fmt(H, 1)} / ${fmt(L, 1)}  →  β = ${fmt(beta, 3)}°`);
    } else if (art === 'referenz') {
        H = positiv(e.H, 'H', 'Höhe vorne');
        const so = positiv(e.so, 'so', 'Oberkante');
        const schmiege = zahl(e.schmiege, 'schmiege', 'Winkel unten');
        if (schmiege <= 0 || schmiege >= 90) throw new GaubenFehler('Winkel unten muss zwischen 0° und 90° liegen.', 'schmiege');
        if (so <= H) {
            throw new GaubenFehler('Mit dieser Eingabeart muss die Oberkante länger sein als die Höhe vorne, sonst ist die Wange nicht eindeutig. Bitte die drei Längen eingeben.', 'so');
        }
        alpha = 90 - schmiege;
        const sa = Math.sin(alpha * RAD), ca = Math.cos(alpha * RAD);
        const su = H * sa + Math.sqrt(so * so - H * H * ca * ca);
        const cosO = (H * H + so * so - su * su) / (2 * H * so);
        const wO = grad(Math.acos(clamp1(cosO)));
        beta = wO - 90;
        weg.push(`Dachneigung α = 90° − ${fmt(schmiege, 3)}° = ${fmt(alpha, 3)}°`);
        weg.push(`sᵤ = H·sin α + √(sₒ² − H²·cos² α) = ${fmt(su, 2)} mm`);
        weg.push(`Winkel oben (Kosinussatz) = ${fmt(wO, 3)}°  →  Gaubenneigung β = ${fmt(beta, 3)}°`);
    } else {
        throw new GaubenFehler(`Unbekannte Eingabeart „${art}“.`, 'eingabeart');
    }

    if (!(alpha > 0 && alpha < 90)) throw new GaubenFehler('Dachneigung muss zwischen 0° und 90° liegen.', 'alpha');
    if (!(beta > -45)) throw new GaubenFehler('Gaubenneigung ist unplausibel (kleiner als −45°).', 'beta');
    if (beta >= alpha - EPS) {
        throw new GaubenFehler('Die Gaubenneigung muss kleiner sein als die Dachneigung, sonst treffen Gaubendach und Hauptdach nie zusammen.', 'beta');
    }

    const tanA = Math.tan(alpha * RAD);
    const tanB = Math.tan(beta * RAD);
    const d = tanA - tanB;                 // Höhenabnahme je mm waagrecht
    const L = H / d;
    const yS = L * tanA;
    const su = L / Math.cos(alpha * RAD);
    const so = L / Math.cos(beta * RAD);
    const flaeche = H * L / 2;

    weg.push(`Waagrechte Tiefe L = H / (tan α − tan β) = ${fmt(H, 1)} / (${fmt(tanA, 5)} − ${fmt(tanB, 5)}) = ${fmt(L, 2)} mm`);
    weg.push(`Unterkante sᵤ = L / cos α = ${fmt(su, 2)} mm,  Oberkante sₒ = L / cos β = ${fmt(so, 2)} mm`);
    weg.push(`Fläche netto A = H · L / 2 = ${fmt(flaeche / 1e6, 4)} m²`);

    return {
        H, alpha, beta, tanA, tanB, d, L, yS, su, so, flaeche,
        winkelUnten: 90 - alpha,
        winkelOben: 90 + beta,
        winkelSpitze: alpha - beta,
        rechenweg: weg
    };
}

/** Nahtlänge (senkrechte Höhe netto) an der Stelle x. */
export const hoehe = (w, x) => w.H - x * w.d;

// --- 2. Einteilung in Scharen ---------------------------------------------

/**
 * Lagen der Falzachsen ab der Gaubenecke (x = 0) bis zur Spitze (x = L).
 * Innere Achsen werden auf `raster` gerundet; die Breiten sind die Differenzen,
 * ihre Summe ist deshalb immer genau L.
 */
export function achsen(w, opt = {}) {
    const o = { ...STANDARD, ...opt };
    const b = positiv(o.scharbreite, 'scharbreite', 'Scharbreite');
    const raster = nichtNegativ(o.raster, 'raster', 'Raster');
    const runde = (x) => (raster > 0 ? Math.round(x / raster) * raster : x);
    const L = w.L;
    const xs = [0];

    if (o.regel === 'gleichmaessig') {
        const n = Math.max(1, Math.ceil(L / b - 1e-9));
        for (let i = 1; i < n; i++) xs.push(runde((i * L) / n));
    } else if (o.regel === 'vonVorne') {
        for (let k = 1; k * b < L - 1e-6; k++) xs.push(runde(k * b));
    } else {
        throw new GaubenFehler(`Unbekannte Einteilungsregel „${o.regel}“.`, 'regel');
    }
    // Eine gerundete Achse darf die Spitze nicht erreichen
    while (xs.length > 1 && xs[xs.length - 1] >= L - 1e-6) xs.pop();
    xs.push(L);
    return xs;
}

/** Scharen mit Nahtlängen netto (ohne Zugaben). */
export function scharen(w, opt = {}) {
    const xs = achsen(w, opt);
    const liste = [];
    for (let i = 0; i < xs.length - 1; i++) {
        const x0 = xs[i], x1 = xs[i + 1];
        const letzte = i === xs.length - 2;
        const h0 = hoehe(w, x0);
        const h1 = letzte ? 0 : hoehe(w, x1);
        liste.push({
            nr: i + 1,
            erste: i === 0,
            letzte,
            x0, x1,
            breite: x1 - x0,
            h0, h1,
            flaeche: (x1 - x0) * (h0 + h1) / 2
        });
    }
    return liste;
}

// --- 3. Zuschnitt einer Schar ---------------------------------------------

/**
 * Zuschnittkontur einer Schar mit Falz- und Querfalzzugaben.
 *
 * Seitlich: Winkelstehfalz, zur Gaubenfront `zugabeFront` (erste Schar
 * `zugabeErsteFront`), zur Spitze `zugabeSpitze`. Die letzte Schar hat an der
 * Spitze keinen Stehfalz; sie wird dort senkrecht abgeschnitten, ihre rechte
 * Kante besteht nur aus den beiden Querfalz-Zugaben (Annahme, mit Bastian zu klären).
 * Oben/unten: Querfalz rechtwinklig zur Schnittkante gemessen; senkrecht ist die
 * Zugabe deshalb querOben / cos β bzw. querUnten / cos α.
 *
 * Örtliche Koordinaten der Schar (u nach rechts, v nach oben), Ursprung =
 * unterste Ecke an der Frontseite. Die Kontur der linken Wange; die rechte ist
 * ihr Spiegelbild (siehe `spiegeln`).
 */
export function zuschnitt(w, s, opt = {}) {
    const o = { ...STANDARD, ...opt };
    const zv = nichtNegativ(s.erste ? o.zugabeErsteFront : o.zugabeFront, 'zugabeFront', 'Falzzugabe Front');
    const zh = s.letzte ? 0 : nichtNegativ(o.zugabeSpitze, 'zugabeSpitze', 'Falzzugabe Spitze');
    const qoMass = nichtNegativ(o.querOben, 'querOben', 'Querfalz oben');
    const quMass = nichtNegativ(o.querUnten, 'querUnten', 'Querfalz unten');
    const qo = qoMass / Math.cos(w.beta * RAD);   // senkrechter Anteil oben
    const qu = quMass / Math.cos(w.alpha * RAD);  // senkrechter Anteil unten

    const oben = (x) => w.H + x * w.tanB + qo;   // obere Schnittkante
    const unten = (x) => x * w.tanA - qu;        // untere Schnittkante
    const xT = (w.H + qo + qu) / w.d;            // dort treffen sich beide Schnittkanten

    const xa = s.x0 - zv;
    let xb = s.x1 + zh;
    let spitz = false;
    if (xb >= xT - 1e-9) { xb = xT; spitz = true; }

    const breite = xb - xa;
    const v0 = unten(xa);
    const hoeheLinks = oben(xa) - v0;
    const hoeheRechts = spitz ? 0 : oben(xb) - unten(xb);
    const versatzUnten = breite * w.tanA;
    const versatzOben = breite * w.tanB;

    const kontur = spitz
        ? [{ u: 0, v: 0 }, { u: breite, v: versatzUnten }, { u: 0, v: hoeheLinks }]
        : [{ u: 0, v: 0 }, { u: breite, v: versatzUnten }, { u: breite, v: hoeheLinks + versatzOben }, { u: 0, v: hoeheLinks }];

    // Biegelinien (für DXF und Zuschnittskizze)
    const uSpitze = w.L - xa;                       // dort enden die Netto-Kanten
    const uEnde = Math.min(breite, uSpitze);
    const biegen = [];
    if (quMass > 0) biegen.push({ art: 'querUnten', a: { u: 0, v: qu }, b: { u: uEnde, v: qu + uEnde * w.tanA } });
    if (qoMass > 0) biegen.push({ art: 'querOben', a: { u: 0, v: hoeheLinks - qo }, b: { u: uEnde, v: hoeheLinks - qo + uEnde * w.tanB } });
    const senkrecht = (u, art) => {
        const x = xa + u;
        biegen.push({ art, a: { u, v: unten(x) - v0 }, b: { u, v: oben(x) - v0 } });
    };
    if (zv > 0) senkrecht(zv, 'falzFront');
    if (zh > 0) senkrecht(zv + s.breite, 'falzSpitze');

    return {
        zugabeFront: zv, zugabeSpitze: zh,
        querOben: qoMass, querUnten: quMass,
        querObenSenkrecht: qo, querUntenSenkrecht: qu,
        breite, hoeheLinks, hoeheRechts, versatzUnten, versatzOben,
        spitz, kontur, biegen
    };
}

/** Spiegelbild einer Zuschnittkontur (rechte Wange). */
export function spiegeln(z) {
    const m = (p) => ({ u: z.breite - p.u, v: p.v });
    return {
        ...z,
        kontur: z.kontur.map(m).reverse(),
        biegen: z.biegen.map((l) => ({ art: l.art, a: m(l.a), b: m(l.b) }))
    };
}

// --- 4. Gesamtrechnung mit Proben -------------------------------------------

/**
 * Komplette Rechnung für eine Gaube.
 * @param {object} eingabe  { art, eingabeart, H, su, so, alpha, beta, L, schmiege, kontrolle: { alpha?, beta?, su?, so?, L? } }
 * @param {object} einstellungen  siehe STANDARD
 */
export function rechne(eingabe, einstellungen = {}) {
    const o = { ...STANDARD, ...einstellungen };
    const art = eingabe.art || 'schlepp';
    if (!ARTEN[art]) throw new GaubenFehler(`Unbekannte Gaubenart „${art}“.`, 'art');

    const w = wange(eingabe);
    const warnungen = [];

    // Plausibilität je Gaubenart
    if (art === 'sattel' && Math.abs(w.beta) > 1) {
        warnungen.push(`Satteldachgaube: Die Oberkante sollte waagrecht sein, aus dem Aufmass ergibt sich ${fmt(w.beta, 1)}°. Bitte Aufmass prüfen.`);
    }
    if (art === 'flach' && (w.beta > 10 || w.beta < -5)) {
        warnungen.push(`Flachdachgaube: Gaubenneigung ${fmt(w.beta, 1)}° ist ungewöhnlich für ein Flachdach.`);
    }
    if (art === 'schlepp' && w.beta <= 0) {
        warnungen.push(`Schleppgaube: Gaubenneigung ${fmt(w.beta, 1)}° ist nicht steigend. Ist es eine Flach- oder Satteldachgaube?`);
    }

    // Kontrollmasse (vierter Wert) vergleichen, nie still überschreiben
    const k = eingabe.kontrolle || {};
    const vergleiche = (feld, name, ist, einheit, tol) => {
        if (k[feld] === undefined || k[feld] === null || k[feld] === '') return;
        const soll = zahl(k[feld], feld, name);
        const diff = ist - soll;
        if (Math.abs(diff) > tol) {
            warnungen.push(`Kontrollmass ${name}: gemessen ${fmt(soll, 1)} ${einheit}, aus dem Aufmass gerechnet ${fmt(ist, 1)} ${einheit} (Abweichung ${fmt(diff, 1)} ${einheit}).`);
        }
    };
    vergleiche('alpha', 'Dachneigung', w.alpha, '°', o.tolWinkel);
    vergleiche('beta', 'Gaubenneigung', w.beta, '°', o.tolWinkel);
    vergleiche('su', 'Unterkante', w.su, 'mm', o.tolLaenge);
    vergleiche('so', 'Oberkante', w.so, 'mm', o.tolLaenge);
    vergleiche('L', 'Waagrechte Tiefe', w.L, 'mm', o.tolLaenge);

    const liste = scharen(w, o).map((s) => ({ ...s, zuschnitt: zuschnitt(w, s, o) }));
    const letzte = liste[liste.length - 1];
    if (liste.length > 1 && letzte.breite < o.minRest - 1e-9) {
        const zusammen = letzte.breite + liste[liste.length - 2].breite;
        warnungen.push(`Letzte Schar nur ${fmt(letzte.breite, 0)} mm breit (unter ${fmt(o.minRest, 0)} mm). Vorschlag: mit der vorletzten zusammenlegen (dann ${fmt(zusammen, 0)} mm) oder gleichmässig einteilen.`);
    }

    // Proben
    const proben = [];
    const probe = (name, soll, ist, tol = 1e-6) => proben.push({ name, soll, ist, ok: Math.abs(soll - ist) <= tol });
    probe('Winkelsumme im Dreieck = 180°', 180, w.winkelUnten + w.winkelOben + w.winkelSpitze);
    probe('Summe der Scharbreiten = waagrechte Tiefe L', w.L, liste.reduce((t, s) => t + s.breite, 0));
    probe('Summe der Scharflächen = Wangenfläche', w.flaeche, liste.reduce((t, s) => t + s.flaeche, 0), 1e-3);
    probe('Nahtlänge an der Spitze = 0', 0, hoehe(w, w.L));
    probe('Höhe vorne aus L zurückgerechnet', w.H, w.L * w.d);
    if (eingabe.eingabeart === 'laengen' || !eingabe.eingabeart) {
        probe('Unterkante zurückgerechnet = Aufmass', zahl(eingabe.su, 'su', 'Unterkante'), w.su, 1e-6);
        probe('Oberkante zurückgerechnet = Aufmass', zahl(eingabe.so, 'so', 'Oberkante'), w.so, 1e-6);
    }
    for (const s of liste) {
        const z = s.zuschnitt;
        if (!z.spitz) probe(`Schar ${s.nr}: Höhe links − rechts = Breite · (tan α − tan β)`, z.breite * w.d, z.hoeheLinks - z.hoeheRechts, 1e-6);
    }

    return {
        version: 1,
        art,
        wange: w,
        einstellungen: o,
        scharen: liste,
        warnungen,
        proben,
        ok: proben.every((p) => p.ok)
    };
}
