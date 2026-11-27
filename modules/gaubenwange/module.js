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
    vorgabe: 'schar',         // 'schar' = Scharbreite (Achsmass) vorgeben | 'band' = Bandbreite vorgeben
    scharbreite: 520,         // Achsmass Falz zu Falz (netto)
    bandbreite: 600,          // Blechband (Coil) für die Zuschnitte, bei vorgabe 'band'
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
    const raster = nichtNegativ(o.raster, 'raster', 'Raster');
    const { b, b1, bLetzte, bEinzige } = scharmasse(o);
    const runde = (x) => (raster > 0 ? Math.round(x / raster) * raster : x);
    const L = w.L;
    let xs;

    if (o.regel === 'gleichmaessig') {
        // So viele Scharen, dass keine nach dem Runden breiter ist als erlaubt
        // (erste Schar höchstens b1, alle anderen höchstens b).
        for (let n = Math.max(1, Math.ceil(L / b - 1e-9)); ; n++) {
            xs = [0];
            for (let i = 1; i < n; i++) xs.push(runde((i * L) / n));
            xs.push(L);
            const zuBreit = xs.some((x, i) => i > 0 && x - xs[i - 1] > (i === 1 ? b1 : b) + 1e-6);
            if (!zuBreit || n > 1000) break;
        }
        xs.pop();
    } else if (o.regel === 'vonVorne') {
        // Neue Achse nur, solange der Rest nicht mehr in eine letzte Schar passt
        // (die letzte Schar hat an der Spitze keinen Stehfalz und darf deshalb bei
        // Vorgabe Bandbreite etwas breiter sein).
        xs = [0];
        for (let k = 0, vorher = 0; L - vorher > (k === 0 ? bEinzige : bLetzte) + 1e-6; k++) {
            vorher = b1 + k * b;
            xs.push(runde(vorher));
        }
    } else {
        throw new GaubenFehler(`Unbekannte Einteilungsregel „${o.regel}“.`, 'regel');
    }
    // Eine gerundete Achse darf die Spitze nicht erreichen
    while (xs.length > 1 && xs[xs.length - 1] >= L - 1e-6) xs.pop();
    xs.push(L);
    return xs;
}

/**
 * Achsmasse aus der Vorgabe: b für alle Scharen, b1 für die erste.
 * Vorgabe Scharbreite: b = b1 = Scharbreite.
 * Vorgabe Bandbreite: das Band wird voll genutzt, also
 *   b  = Band − Stehfalz Front − Stehfalz Spitze,
 *   b1 = Band − Stehfalz erste Schar − Stehfalz Spitze (erste Schar hat den kleinen Falz),
 *   bLetzte = Band − Stehfalz Front (letzte Schar hat an der Spitze keinen Stehfalz),
 *   bEinzige = Band − Stehfalz erste Schar (nur eine Schar).
 * Mit Raster werden b und b1 nach unten auf das Raster gerundet, damit kein Zuschnitt breiter als das Band wird.
 */
export function scharmasse(opt = {}) {
    const o = { ...STANDARD, ...opt };
    const raster = nichtNegativ(o.raster, 'raster', 'Raster');
    if (o.vorgabe === 'band') {
        const band = positiv(o.bandbreite, 'bandbreite', 'Bandbreite');
        const zf = nichtNegativ(o.zugabeFront, 'zugabeFront', 'Stehfalz zur Front');
        const zs = nichtNegativ(o.zugabeSpitze, 'zugabeSpitze', 'Stehfalz zur Spitze');
        const ze = nichtNegativ(o.zugabeErsteFront, 'zugabeErsteFront', 'Erste Schar an der Ecke');
        const ab = (x) => (raster > 0 ? Math.floor(x / raster + 1e-9) * raster : x);
        const b = ab(band - zf - zs);
        const b1 = ab(band - ze - zs);
        if (b <= 0 || b1 <= 0) {
            throw new GaubenFehler(`Bandbreite ${fmt(band, 0)} mm ist kleiner als die Stehfalz-Zugaben (${fmt(zf + zs, 0)} mm).`, 'bandbreite');
        }
        return { vorgabe: 'band', band, b, b1, bLetzte: ab(band - zf), bEinzige: ab(band - ze), zf, zs, ze };
    }
    if (o.vorgabe !== 'schar' && o.vorgabe !== undefined) {
        throw new GaubenFehler(`Unbekannte Vorgabe „${o.vorgabe}“.`, 'vorgabe');
    }
    const b = positiv(o.scharbreite, 'scharbreite', 'Scharbreite');
    return { vorgabe: 'schar', b, b1: b, bLetzte: b, bEinzige: b };
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
 * Kante besteht nur aus den beiden Querfalz-Zugaben. Nach dem Umlegen der Querfalze
 * läuft die Schar hinten genau auf 0 aus (bestätigt von Bastian, 27.11.2026).
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
        const passt = o.vorgabe !== 'band' || zusammen <= scharmasse(o).bLetzte + 1e-6;
        warnungen.push(passt
            ? `Letzte Schar nur ${fmt(letzte.breite, 0)} mm breit (unter ${fmt(o.minRest, 0)} mm). Vorschlag: mit der vorletzten zusammenlegen (dann ${fmt(zusammen, 0)} mm) oder gleichmässig einteilen.`
            : `Letzte Schar nur ${fmt(letzte.breite, 0)} mm breit (unter ${fmt(o.minRest, 0)} mm). Zusammenlegen passt nicht aufs Band, Vorschlag: gleichmässig einteilen.`);
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
    if (o.vorgabe === 'band') {
        const band = Number(o.bandbreite);
        const breitester = Math.max(...liste.map((s) => s.zuschnitt.breite));
        probe(`Kein Zuschnitt breiter als das Band (${fmt(band, 0)} mm)`, 1, breitester <= band + 1e-6 ? 1 : 0);
    }
    for (const s of liste) {
        const z = s.zuschnitt;
        if (!z.spitz) probe(`Schar ${s.nr}: Zuschnitthöhe vorne − hinten = Breite · (tan α − tan β)`, z.breite * w.d, z.hoeheLinks - z.hoeheRechts, 1e-6);
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

// =============================================================================
// Oberfläche (Etappe 2): Ausmass-Art „Gaubenwange“ mit eigenem Tab
// =============================================================================

const FELDER = {
    H: { label: 'Höhe vorne', einheit: 'mm', hilfe: 'Fertige Nahtlänge an der Gaubenfront' },
    su: { label: 'Unterkante', einheit: 'mm', hilfe: 'Entlang Hauptdach, fertig' },
    so: { label: 'Oberkante', einheit: 'mm', hilfe: 'Entlang Gaubendach, fertig' },
    alpha: { label: 'Dachneigung α', einheit: '°', hilfe: 'Hauptdach' },
    beta: { label: 'Gaubenneigung β', einheit: '°', hilfe: 'Gaubendach, Satteldach = 0' },
    L: { label: 'Waagrechte Tiefe', einheit: 'mm', hilfe: 'Front bis Spitze, waagrecht' },
    schmiege: { label: 'Winkel unten', einheit: '°', hilfe: 'Zwischen Front und Hauptdach' }
};

const FELDER_JE_ART = {
    laengen: ['H', 'su', 'so'],
    winkel: ['H', 'alpha', 'beta'],
    tiefe: ['H', 'L', 'alpha'],
    referenz: ['H', 'so', 'schmiege']
};

const KONTROLLE = ['alpha', 'beta', 'su', 'so', 'L'];

const ZUGABEN = [
    ['zugabeFront', 'Stehfalz zur Front', 'mm', 'Alle Scharen ausser der ersten'],
    ['zugabeSpitze', 'Stehfalz zur Spitze', 'mm', ''],
    ['zugabeErsteFront', 'Erste Schar an der Ecke', 'mm', 'Kleiner Falz an der Gaubenecke'],
    ['querOben', 'Querfalz oben', 'mm', 'Rechtwinklig zur Schnittkante'],
    ['querUnten', 'Querfalz unten', 'mm', 'Rechtwinklig zur Schnittkante'],
    ['raster', 'Falzachsen runden auf', 'mm', '0 = nicht runden'],
    ['minRest', 'Restschar mindestens', 'mm', 'Darunter kommt eine Warnung']
];

/** Kurzinfo zur Vorgabe Bandbreite (leer bei Vorgabe Scharbreite). */
const bandText = (r) => {
    const o = r.einstellungen;
    if (o.vorgabe !== 'band') return '';
    const m = scharmasse(o);
    return `Band ${fmt(m.band, 0)} mm: Achsmass ${fmt(m.b, 1)} mm, erste Schar ${fmt(m.b1, 1)} mm, letzte Schar höchstens ${fmt(m.bLetzte, 1)} mm.`;
};

/** Rechenweg-Zeilen zur Vorgabe Bandbreite. */
const bandWeg = (r) => {
    const o = r.einstellungen;
    if (o.vorgabe !== 'band') return [];
    const m = scharmasse(o);
    const rund = Number(o.raster) > 0 ? `, abgerundet auf ${fmt(Number(o.raster), 1)} mm` : '';
    return [
        `Achsmass aus Band: ${fmt(m.band, 1)} − ${fmt(m.zf, 1)} − ${fmt(m.zs, 1)} = ${fmt(m.band - m.zf - m.zs, 1)} mm${rund} → ${fmt(m.b, 1)} mm`,
        `Erste Schar: ${fmt(m.band, 1)} − ${fmt(m.ze, 1)} − ${fmt(m.zs, 1)} = ${fmt(m.band - m.ze - m.zs, 1)} mm${rund} → ${fmt(m.b1, 1)} mm`,
        `Letzte Schar ohne Stehfalz an der Spitze: höchstens ${fmt(m.band, 1)} − ${fmt(m.zf, 1)} = ${fmt(m.bLetzte, 1)} mm`
    ];
};

const leereDaten = (vorher) => ({
    v: 1,
    eingabe: {
        art: 'schlepp', eingabeart: 'laengen',
        H: '', su: '', so: '', alpha: '', beta: '', L: '', schmiege: '',
        kontrolle: { alpha: '', beta: '', su: '', so: '', L: '' }
    },
    einstellungen: vorher && vorher.einstellungen
        ? { ...vorher.einstellungen }
        : {
            regel: STANDARD.regel, vorgabe: STANDARD.vorgabe, scharbreite: String(STANDARD.scharbreite),
            bandbreite: String(STANDARD.bandbreite), raster: String(STANDARD.raster),
            minRest: String(STANDARD.minRest), zugabeFront: String(STANDARD.zugabeFront),
            zugabeSpitze: String(STANDARD.zugabeSpitze), zugabeErsteFront: String(STANDARD.zugabeErsteFront),
            querOben: String(STANDARD.querOben), querUnten: String(STANDARD.querUnten)
        },
    ansicht: { seite: 'L', stellen: 0, reiter: 'gesamt', schar: 1 }
});

/** Gespeicherte Daten auf den aktuellen Aufbau bringen (fehlende Felder ergänzen). */
const vervollstaendige = (d) => {
    const leer = leereDaten();
    if (!d || typeof d !== 'object') return leer;
    return {
        v: 1,
        eingabe: { ...leer.eingabe, ...(d.eingabe || {}), kontrolle: { ...leer.eingabe.kontrolle, ...((d.eingabe || {}).kontrolle || {}) } },
        einstellungen: { ...leer.einstellungen, ...(d.einstellungen || {}) },
        ansicht: { ...leer.ansicht, ...(d.ansicht || {}) }
    };
};

const leer = (v) => v === undefined || v === null || String(v).trim() === '';

/** Rechnung aus den gespeicherten (Text-)Feldern; liefert { r } oder { fehler, feld }. */
function rechneDaten(d) {
    const e = d.eingabe;
    const eingabe = { art: e.art, eingabeart: e.eingabeart, kontrolle: {} };
    const fehlend = [];
    for (const k of FELDER_JE_ART[e.eingabeart] || []) {
        if (leer(e[k])) fehlend.push(FELDER[k].label);
        eingabe[k] = e[k];
    }
    if (fehlend.length) return { fehlt: fehlend };
    for (const k of KONTROLLE) {
        if (!leer(e.kontrolle[k]) && !(FELDER_JE_ART[e.eingabeart] || []).includes(k)) eingabe.kontrolle[k] = e.kontrolle[k];
    }
    const o = {};
    for (const [k, v] of Object.entries(d.einstellungen)) {
        if (k === 'regel' || k === 'vorgabe') { o[k] = v; continue; }
        if (leer(v)) continue;
        const z = Number(String(v).replace(',', '.'));
        if (!Number.isFinite(z)) return { fehler: `Einstellung „${k}“ ist keine Zahl.`, feld: k };
        o[k] = z;
    }
    try {
        return { r: rechne(eingabe, o) };
    } catch (f) {
        if (f instanceof GaubenFehler) return { fehler: f.message, feld: f.feld };
        throw f;
    }
}

// --- Zeichnungen (SVG) ------------------------------------------------------

const svgEsc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n2 = (z) => Math.round(z * 100) / 100;

/** Gesamtansicht der Wange mit Falzachsen, Nahtlängen und Masskette. */
function svgGesamt(r, seite, stellen) {
    const w = r.wange;
    const f = (z) => fmt(z, stellen);
    const span = Math.max(w.L, w.yS);
    const schmal = typeof window !== 'undefined' && window.innerWidth < 600;
    const fs = span / (schmal ? 21 : 30);
    const m = fs * 3.2;
    const R = seite === 'R';
    const X = (x) => n2(R ? w.L - x : x);
    const Y = (y) => n2(w.yS - y);
    const teile = [];
    const txt = (x, y, t, opt = {}) => teile.push(
        `<text x="${n2(x)}" y="${n2(y)}" font-size="${n2(opt.fs || fs)}" text-anchor="${opt.anchor || 'middle'}"` +
        `${opt.rot ? ` transform="rotate(${n2(opt.rot)} ${n2(x)} ${n2(y)})"` : ''}` +
        ` fill="${opt.farbe || '#2c3e50'}"${opt.fett ? ' font-weight="bold"' : ''}>${svgEsc(t)}</text>`);
    const linie = (x1, y1, x2, y2, opt = {}) => teile.push(
        `<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="${opt.farbe || '#2c3e50'}" stroke-width="${n2(opt.b || fs / 10)}"${opt.strich ? ` stroke-dasharray="${n2(fs / 2)} ${n2(fs / 3)}"` : ''}/>`);

    // Wange
    teile.push(`<polygon points="${X(0)},${Y(0)} ${X(0)},${Y(w.H)} ${X(w.L)},${Y(w.yS)}" fill="#d5f5ee" stroke="#16a085" stroke-width="${n2(fs / 6)}" stroke-linejoin="round"/>`);

    // Falzachsen mit Nahtlänge, Positionsnummern
    r.scharen.forEach((s, i) => {
        if (i > 0) {
            linie(X(s.x0), Y(s.x0 * w.tanA), X(s.x0), Y(w.H + s.x0 * w.tanB), { farbe: '#2471a3', strich: true, b: fs / 12 });
        }
        if (i > 0 && s.h0 > fs * 2.2) {
            txt(X(s.x0) + (R ? -1 : 1) * fs * 0.9, Y(s.x0 * w.tanA + s.h0 / 2), f(s.h0), { rot: -90, farbe: '#d35400', fs: fs * 0.85 });
        }
        const xm = (s.x0 + s.x1) / 2;
        const ym = xm * w.tanA + (s.h0 + s.h1) / 4;
        if (s.breite > fs * 2.4 && (s.h0 + s.h1) / 2 > fs * 1.5) txt(X(xm), Y(ym) + fs * 0.35, `${seite}${s.nr}`, { fett: true });
    });

    // Masskette unten (Achsmasse)
    const yK = Y(0) + m * 0.55;
    linie(X(0), yK, X(w.L), yK, { farbe: '#2471a3' });
    r.scharen.forEach((s) => {
        linie(X(s.x0), yK - fs * 0.4, X(s.x0), yK + fs * 0.4, { farbe: '#2471a3' });
        if (s.breite > fs * 2) txt(X((s.x0 + s.x1) / 2), yK - fs * 0.35, f(s.breite), { farbe: '#2471a3', fs: fs * 0.85 });
    });
    linie(X(w.L), yK - fs * 0.4, X(w.L), yK + fs * 0.4, { farbe: '#2471a3' });
    txt(X(w.L / 2), yK + fs * 1.4, `L = ${f(w.L)} mm waagrecht`, { farbe: '#2471a3', fs: fs * 0.85 });

    // Höhe vorne
    const xH = X(0) + (R ? 1 : -1) * m * 0.55;
    linie(xH, Y(0), xH, Y(w.H), { farbe: '#d35400' });
    linie(xH - fs * 0.4, Y(0), xH + fs * 0.4, Y(0), { farbe: '#d35400' });
    linie(xH - fs * 0.4, Y(w.H), xH + fs * 0.4, Y(w.H), { farbe: '#d35400' });
    txt(xH + (R ? 1 : -1) * fs * 0.5, Y(w.H / 2), `H ${f(w.H)}`, { rot: -90, farbe: '#d35400', fett: true });

    // Kanten
    const rotU = (R ? 1 : -1) * w.alpha;
    const rotO = (R ? 1 : -1) * w.beta;
    const nu = { x: Math.sin(w.alpha * RAD), y: -Math.cos(w.alpha * RAD) };
    const no = { x: -Math.sin(w.beta * RAD), y: Math.cos(w.beta * RAD) };
    const mu = { x: w.L * 0.55, y: w.L * 0.55 * w.tanA };
    const mo = { x: w.L * 0.45, y: w.H + w.L * 0.45 * w.tanB };
    txt(X(mu.x + nu.x * fs * 1.6), Y(mu.y + nu.y * fs * 1.6), `Unterkante ${f(w.su)}`, { rot: rotU, farbe: '#16a085' });
    txt(X(mo.x + no.x * fs * 0.9), Y(mo.y + no.y * fs * 0.9), `Oberkante ${f(w.so)}`, { rot: rotO, farbe: '#16a085' });

    // Winkel
    txt(X(0) + (R ? -1 : 1) * fs * 0.6, Y(0) + fs * 0.9, `${fmt(w.winkelUnten, 1)}°`, { anchor: R ? 'end' : 'start', fs: fs * 0.8, farbe: '#7f8c8d' });
    txt(X(0) + (R ? -1 : 1) * fs * 0.6, Y(w.H) + fs * 1.6, `${fmt(w.winkelOben, 1)}°`, { anchor: R ? 'end' : 'start', fs: fs * 0.8, farbe: '#7f8c8d' });
    txt(X(w.L) + (R ? -1 : 1) * fs * 0.6, Y(w.yS) - fs * 0.4, `${fmt(w.winkelSpitze, 1)}°`, { anchor: R ? 'end' : 'start', fs: fs * 0.8, farbe: '#7f8c8d' });

    const vb = [-m * 1.25, -m * 0.7, w.L + m * 2.5, w.yS + m * 1.7].map(n2).join(' ');
    return `<svg class="gw-svg" viewBox="${vb}" role="img" aria-label="Gesamtansicht ${seite === 'R' ? 'rechte' : 'linke'} Wange">${teile.join('')}</svg>`;
}

/** Zuschnitt einer Schar mit Biegelinien und Massen. */
function svgSchar(z, pos, stellen) {
    const f = (v) => fmt(v, stellen);
    const vmax = Math.max(...z.kontur.map((p) => p.v));
    const span = Math.max(z.breite, vmax);
    const fs = span / (typeof window !== 'undefined' && window.innerWidth < 600 ? 16 : 22);
    const m = fs * 3.4;
    const X = (u) => n2(u);
    const Y = (v) => n2(vmax - v);
    const teile = [];
    const txt = (x, y, t, opt = {}) => teile.push(
        `<text x="${n2(x)}" y="${n2(y)}" font-size="${n2(opt.fs || fs)}" text-anchor="${opt.anchor || 'middle'}"` +
        `${opt.rot ? ` transform="rotate(${n2(opt.rot)} ${n2(x)} ${n2(y)})"` : ''} fill="${opt.farbe || '#2c3e50'}"${opt.fett ? ' font-weight="bold"' : ''}>${svgEsc(t)}</text>`);
    const linie = (a, b, opt = {}) => teile.push(
        `<line x1="${X(a.u)}" y1="${Y(a.v)}" x2="${X(b.u)}" y2="${Y(b.v)}" stroke="${opt.farbe || '#2c3e50'}" stroke-width="${n2(opt.b || fs / 10)}"${opt.strich ? ` stroke-dasharray="${n2(fs / 2)} ${n2(fs / 3)}"` : ''}/>`);

    teile.push(`<polygon points="${z.kontur.map((p) => `${X(p.u)},${Y(p.v)}`).join(' ')}" fill="#eef2f7" stroke="#2c3e50" stroke-width="${n2(fs / 7)}" stroke-linejoin="round"/>`);
    z.biegen.forEach((l) => linie(l.a, l.b, { farbe: '#c0392b', strich: true, b: fs / 14 }));

    const links = z.kontur.filter((p) => p.u < z.breite / 2);
    const rechts = z.kontur.filter((p) => p.u >= z.breite / 2);
    const lo = Math.max(...links.map((p) => p.v)), lu = Math.min(...links.map((p) => p.v));
    const ro = Math.max(...rechts.map((p) => p.v)), ru = Math.min(...rechts.map((p) => p.v));
    const lx = Math.min(...links.map((p) => p.u)), rx = Math.max(...rechts.map((p) => p.u));

    // Breite unten
    const yB = Y(Math.min(lu, ru)) + m * 0.85;
    teile.push(`<line x1="${X(lx)}" y1="${n2(yB)}" x2="${X(rx)}" y2="${n2(yB)}" stroke="#2471a3" stroke-width="${n2(fs / 10)}"/>`);
    txt((X(lx) + X(rx)) / 2, yB + fs * 1.2, `Breite ${f(z.breite)}`, { farbe: '#2471a3', fett: true });
    // Höhen links und rechts
    txt(X(lx) - fs * 0.5, (Y(lo) + Y(lu)) / 2 + fs * 0.35, `${f(lo - lu)}`, { anchor: 'end', farbe: '#d35400', fett: true });
    txt(X(rx) + fs * 0.5, (Y(ro) + Y(ru)) / 2 + fs * 0.35, `${f(ro - ru)}`, { anchor: 'start', farbe: '#d35400', fett: true });
    // Versatz
    txt((X(lx) + X(rx)) / 2, Y(Math.min(lu, ru)) + m * 0.35, `Versatz unten ${f(z.versatzUnten)}`, { fs: fs * 0.8, farbe: '#7f8c8d' });
    txt((X(lx) + X(rx)) / 2, Y(Math.max(lo, ro)) - fs * 0.6, `Versatz oben ${f(z.versatzOben)}`, { fs: fs * 0.8, farbe: '#7f8c8d' });
    txt((X(lx) + X(rx)) / 2, (Y(lo) + Y(lu) + Y(ro) + Y(ru)) / 4 + fs * 0.4, pos, { fs: fs * 1.6, fett: true, farbe: '#16a085' });

    const vb = [-m * 1.6, -m * 0.6, z.breite + m * 3.2, vmax + m * 1.7].map(n2).join(' ');
    return `<svg class="gw-svg" viewBox="${vb}" role="img" aria-label="Zuschnitt ${svgEsc(pos)}">${teile.join('')}</svg>`;
}

function vorschauSvg(r) {
    const w = r.wange;
    const s = 56 / Math.max(w.L, w.yS);
    const p = (x, y) => `${n2(4 + x * s)},${n2(60 - y * s)}`;
    const achsen = r.scharen.slice(1).map((sc) => `<line x1="${n2(4 + sc.x0 * s)}" y1="${n2(60 - sc.x0 * w.tanA * s)}" x2="${n2(4 + sc.x0 * s)}" y2="${n2(60 - (w.H + sc.x0 * w.tanB) * s)}" stroke="#2471a3" stroke-width="1"/>`).join('');
    return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><polygon points="${p(0, 0)} ${p(0, w.H)} ${p(w.L, w.yS)}" fill="#d5f5ee" stroke="#16a085" stroke-width="2" stroke-linejoin="round"/>${achsen}</svg>`;
}

// --- Stil -----------------------------------------------------------------

const STIL = `
.gw { display: grid; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); gap: 20px; align-items: start; color: #2c3e50; }
.gw * { box-sizing: border-box; }
.gw-karte { background: #fff; border: 1px solid #e3e7eb; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
.gw-karte h3 { margin: 0 0 10px; font-size: 1rem; text-transform: uppercase; letter-spacing: .03em; color: #34495e; }
.gw-segment { display: flex; gap: 6px; flex-wrap: wrap; }
.gw-segment button { flex: 1 1 0; min-height: 48px; min-width: 90px; padding: 8px 10px; font-size: 1rem; font-weight: bold; border: 2px solid #ced4da; background: #f8f9fa; color: #495057; border-radius: 8px; cursor: pointer; }
.gw-segment button.aktiv { border-color: #16a085; background: #d5f5ee; color: #0e6655; }
.gw-karte .gw-segment + .gw-segment { margin-top: 12px; }
.gw-felder { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px 12px; margin-top: 10px; }
.gw-feld label { display: block; font-weight: bold; font-size: .92rem; color: #495057; margin-bottom: 4px; }
.gw-feld .gw-in { display: flex; align-items: center; border: 1px solid #ced4da; border-radius: 8px; background: #fff; }
.gw-feld .gw-in:focus-within { border-color: #16a085; box-shadow: 0 0 0 2px #a3e4d7; }
.gw-feld input:focus, .gw-feld select:focus { outline: none; }
.gw-feld input, .gw-feld select { width: 100%; min-height: 48px; padding: 8px 10px; font-size: 1.15rem; border: none; border-radius: 8px; background: transparent; text-align: right; }
.gw-feld select { text-align: left; font-size: 1rem; }
.gw-feld .gw-einh { padding: 0 10px 0 2px; color: #7f8c8d; }
.gw-feld small { display: block; color: #7f8c8d; font-size: .8rem; margin-top: 3px; }
.gw-feld.gw-falsch .gw-in { border-color: #c0392b; box-shadow: 0 0 0 2px #f5b7b1; }
.gw-hinweis { color: #7f8c8d; font-size: .88rem; margin: 6px 0 0; }
.gw details summary { cursor: pointer; font-weight: bold; min-height: 40px; display: flex; align-items: center; color: #34495e; }
.gw-meldung { border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; font-size: 1rem; }
.gw-meldung.fehler { background: #fdedec; color: #922b21; border: 1px solid #f5b7b1; }
.gw-meldung.warnung { background: #fef5e7; color: #935116; border: 1px solid #f8c471; }
.gw-meldung.leer { background: #eaf2f8; color: #1f618d; border: 1px solid #aed6f1; }
.gw-meldung ul { margin: 0; padding-left: 20px; }
.gw-zahlen { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; margin-bottom: 14px; }
.gw-zahl { background: #fff; border: 1px solid #e3e7eb; border-radius: 10px; padding: 10px 12px; }
.gw-zahl b { display: block; font-size: 1.35rem; color: #16a085; }
.gw-zahl span { font-size: .8rem; color: #7f8c8d; }
.gw-leiste { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.gw-leiste .gw-segment { flex-wrap: nowrap; }
.gw-leiste .gw-segment button { min-width: 0; padding: 8px 4px; }
.gw-svg { width: 100%; height: auto; max-height: 70vh; display: block; background: #fff; border-radius: 10px; border: 1px solid #e3e7eb; font-family: inherit; }
.gw-tabelle-rahmen { overflow-x: auto; background: #fff; border: 1px solid #e3e7eb; border-radius: 10px; }
.gw-tabelle { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.gw-tabelle th, .gw-tabelle td { padding: 12px 10px; text-align: right; border-bottom: 1px solid #eef0f2; white-space: nowrap; }
.gw-tabelle th { background: #f1f3f5; font-size: .8rem; color: #495057; line-height: 1.25; }
.gw-tabelle td:first-child, .gw-tabelle th:first-child { text-align: left; font-weight: bold; }
.gw-tabelle tbody tr { cursor: pointer; }
.gw-tabelle tbody tr:hover { background: #f4fbf9; }
.gw-tabelle tfoot td { font-weight: bold; background: #f8f9fa; }
.gw-schar-kopf { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.gw-schar-kopf button { min-width: 56px; min-height: 48px; font-size: 1.4rem; border: 2px solid #ced4da; background: #f8f9fa; border-radius: 8px; cursor: pointer; }
.gw-schar-kopf button:disabled { opacity: .35; cursor: default; }
.gw-schar-kopf strong { flex: 1; text-align: center; font-size: 1.3rem; }
.gw-schar-masse { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-top: 12px; }
.gw-schar-masse div { background: #fff; border: 1px solid #e3e7eb; border-radius: 8px; padding: 8px 12px; }
.gw-schar-masse b { display: block; font-size: 1.5rem; }
.gw-schar-masse span { font-size: .8rem; color: #7f8c8d; }
.gw-weg { background: #fff; border: 1px solid #e3e7eb; border-radius: 10px; padding: 12px 16px; }
.gw-weg ol { padding-left: 20px; margin: 6px 0 14px; }
.gw-weg li { margin: 4px 0; }
.gw-probe-ok { color: #1e8449; }
.gw-probe-falsch { color: #c0392b; font-weight: bold; }
@media (max-width: 900px) { .gw { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 520px) {
  .gw-felder { grid-template-columns: 1fr 1fr; }
  .gw-zahlen { grid-template-columns: 1fr 1fr; }
  .gw-tabelle th, .gw-tabelle td { padding: 10px 6px; font-size: .9rem; }
  .gw-leiste .gw-segment { flex-wrap: wrap; }
  .gw-leiste .gw-segment button { flex: 1 1 40%; }
}
.gw-tabelle td:first-child, .gw-tabelle th:first-child { position: sticky; left: 0; background: inherit; z-index: 1; }
.gw-tabelle tbody td:first-child { background: #fff; }
`;

// --- Modul ------------------------------------------------------------------

export default {
    id: 'gaubenwange',
    name: 'Gaubenwange',
    version: '0.3.0',
    apiVersion: 1,
    author: 'Bastian',
    description: 'Gaubenwangen (Schlepp-, Satteldach-, Flachdachgaube) aus dem Aufmass rechnen, in Scharen mit Winkelstehfalz einteilen und Zuschnittmasse je Schar ausgeben.',

    register(api) {
        const esc = api.ui.esc;
        let daten = null;
        let el = null;
        let verbunden = false;

        const tab = api.ui.addTab({
            id: 'wange',
            label: '⌂ Gaubenwange',
            shortLabel: '⌂',
            title: 'Gaubenwange rechnen und einteilen',
            docType: 'gaubenwange',
            onShow: () => zeigen()
        });

        api.documents.addType({
            id: 'gaubenwange',
            name: 'Gaubenwange',
            shortName: 'Gaube',
            description: 'Seitenwand einer Schlepp-, Satteldach- oder Flachdachgaube: Aufmass, Einteilung in Scharen, Zuschnittmasse.',
            icon: '⌂',
            mainTab: tab.key,
            coreTabs: ['cutlist'],
            hideCutlist: true,
            onNew: ({ from }) => api.data.set(leereDaten(from)),
            preview: (d) => {
                const erg = d ? rechneDaten(vervollstaendige(d)) : {};
                if (!erg.r) return { thumbnail: '', text: 'Noch kein Aufmass' };
                const w = erg.r.wange;
                return { thumbnail: vorschauSvg(erg.r), text: `H ${fmt(w.H, 0)} · ${erg.r.scharen.length} Scharen` };
            }
        });

        api.on('document:loaded', () => {
            if (api.documents.current() === 'gaubenwange' && api.ui.currentTab() === tab.key) zeigen();
        });

        const speichern = () => api.data.set(daten);

        function zeigen() {
            daten = vervollstaendige(api.data.get());
            el = tab.container;
            el.innerHTML = `<style>${STIL}</style><div class="gw"><div class="gw-links"></div><div class="gw-rechts"></div></div>`;
            el.querySelector('.gw-links').innerHTML = eingabeHtml();
            ergebnisZeigen();
            if (!verbunden) { verbinden(); verbunden = true; }
        }

        // --- Eingabe ---------------------------------------------------------

        const feldHtml = (pfad, key, def, wert) => `
            <div class="gw-feld" data-feldkey="${esc(key)}">
                <label for="gw-${esc(pfad)}">${esc(def.label)}</label>
                <div class="gw-in"><input id="gw-${esc(pfad)}" type="text" inputmode="decimal" autocomplete="off" data-pfad="${esc(pfad)}" value="${esc(wert ?? '')}"><span class="gw-einh">${esc(def.einheit)}</span></div>
                ${def.hilfe ? `<small>${esc(def.hilfe)}</small>` : ''}
            </div>`;

        const segment = (act, optionen, aktiv) => `<div class="gw-segment">${optionen.map(([wert, text]) =>
            `<button type="button" data-act="${act}" data-wert="${esc(wert)}" class="${wert === aktiv ? 'aktiv' : ''}">${esc(text)}</button>`).join('')}</div>`;

        function eingabeHtml() {
            const e = daten.eingabe, o = daten.einstellungen;
            const felder = FELDER_JE_ART[e.eingabeart].map((k) => feldHtml(`eingabe.${k}`, k, FELDER[k], e[k])).join('');
            const kontrolle = KONTROLLE.filter((k) => !FELDER_JE_ART[e.eingabeart].includes(k))
                .map((k) => feldHtml(`eingabe.kontrolle.${k}`, `k-${k}`, { ...FELDER[k], hilfe: '' }, e.kontrolle[k])).join('');
            const zugaben = ZUGABEN.map(([k, label, einheit, hilfe]) => feldHtml(`einstellungen.${k}`, k, { label, einheit, hilfe }, o[k])).join('');
            return `
            <div class="gw-karte">
                <h3>Gaube</h3>
                ${segment('art', [['schlepp', 'Schlepp'], ['sattel', 'Satteldach'], ['flach', 'Flachdach']], e.art)}
            </div>
            <div class="gw-karte">
                <h3>Aufmass</h3>
                <div class="gw-feld">
                    <label for="gw-eingabeart">Eingabe über</label>
                    <div class="gw-in"><select id="gw-eingabeart" data-act="eingabeart">
                        ${Object.entries(EINGABEARTEN).map(([k, t]) => `<option value="${k}"${k === e.eingabeart ? ' selected' : ''}>${esc(t)}${k === 'laengen' ? ' – empfohlen' : ''}</option>`).join('')}
                    </select></div>
                </div>
                <div class="gw-felder">${felder}</div>
                <p class="gw-hinweis">Masse in mm, fertig (netto) = so gross wie die Fläche am Ende.</p>
            </div>
            <div class="gw-karte">
                <h3>Einteilung</h3>
                ${segment('regel', [['vonVorne', 'Von vorne, Rest an der Spitze'], ['gleichmaessig', 'Gleichmässig']], o.regel)}
                ${segment('vorgabe', [['schar', 'Scharbreite vorgeben'], ['band', 'Bandbreite vorgeben']], o.vorgabe)}
                <div class="gw-felder">${o.vorgabe === 'band'
                    ? feldHtml('einstellungen.bandbreite', 'bandbreite', { label: 'Bandbreite', einheit: 'mm', hilfe: 'Coil-Breite, wird voll genutzt. Achsmass = Band − Stehfalz-Zugaben' }, o.bandbreite)
                    : feldHtml('einstellungen.scharbreite', 'scharbreite', { label: o.regel === 'gleichmaessig' ? 'Scharbreite höchstens' : 'Scharbreite', einheit: 'mm', hilfe: 'Achsmass Falz zu Falz' }, o.scharbreite)}</div>
            </div>
            <div class="gw-karte">
                <details>
                    <summary>Zugaben und Einstellungen</summary>
                    <div class="gw-felder">${zugaben}</div>
                </details>
            </div>
            <div class="gw-karte">
                <details${KONTROLLE.some((k) => !leer(e.kontrolle[k])) ? ' open' : ''}>
                    <summary>Kontrollmass (freiwillig)</summary>
                    <p class="gw-hinweis">Zusätzlich gemessene Werte. Weicht die Rechnung ab, erscheint eine Warnung.</p>
                    <div class="gw-felder">${kontrolle}</div>
                </details>
            </div>`;
        }

        // --- Ergebnis --------------------------------------------------------

        function ergebnisZeigen() {
            const ziel = el.querySelector('.gw-rechts');
            const erg = rechneDaten(daten);
            el.querySelectorAll('.gw-feld').forEach((f) => f.classList.toggle('gw-falsch', !!erg.feld && f.dataset.feldkey === erg.feld));

            if (erg.fehlt) {
                ziel.innerHTML = `<div class="gw-meldung leer">Bitte noch eingeben: <b>${erg.fehlt.map(esc).join(', ')}</b></div>`;
                return;
            }
            if (erg.fehler) {
                ziel.innerHTML = `<div class="gw-meldung fehler"><b>Kann nicht rechnen:</b> ${esc(erg.fehler)}</div>`;
                return;
            }
            const r = erg.r, w = r.wange, a = daten.ansicht;
            const st = Number(a.stellen) || 0;
            const f = (z) => fmt(z, st);
            const zuschnittFlaeche = r.scharen.reduce((t, s) => t + konturFlaeche(s.zuschnitt.kontur), 0);

            const warn = [];
            if (!r.ok) warn.push(`Eine Probe stimmt nicht: ${r.proben.filter((p) => !p.ok).map((p) => p.name).join(', ')}. Bitte Werte nicht verwenden.`);
            warn.push(...r.warnungen);

            ziel.innerHTML = `
                ${warn.length ? `<div class="gw-meldung ${r.ok ? 'warnung' : 'fehler'}"><ul>${warn.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
                <div class="gw-zahlen">
                    <div class="gw-zahl"><b>${fmt(w.alpha, 1)}°</b><span>Dachneigung α</span></div>
                    <div class="gw-zahl"><b>${fmt(w.beta, 1)}°</b><span>Gaubenneigung β</span></div>
                    <div class="gw-zahl"><b>${f(w.L)}</b><span>Tiefe waagrecht mm</span></div>
                    <div class="gw-zahl"><b>${r.scharen.length}</b><span>Scharen je Wange</span></div>
                    <div class="gw-zahl"><b>${fmt(w.flaeche / 1e6, 2)}</b><span>Fläche je Wange m²</span></div>
                    <div class="gw-zahl"><b>${fmt(2 * zuschnittFlaeche / 1e6, 2)}</b><span>Blech beide Wangen m²</span></div>
                </div>
                ${bandText(r) ? `<p class="gw-hinweis">${esc(bandText(r))}</p>` : ''}
                <div class="gw-leiste">
                    ${segment('seite', [['L', 'Linke Wange'], ['R', 'Rechte Wange']], a.seite)}
                    ${segment('reiter', [['gesamt', 'Ansicht'], ['tabelle', 'Masstabelle'], ['schar', 'Schar'], ['weg', 'Rechenweg']], a.reiter)}
                </div>
                <div class="gw-ansicht">${ansichtHtml(r, a, f, st)}</div>
                <div class="gw-leiste" style="margin-top:12px">
                    ${segment('stellen', [['0', 'Anzeige auf 1 mm'], ['1', 'Anzeige auf 0,1 mm']], String(st))}
                </div>`;
        }

        const konturFlaeche = (k) => Math.abs(k.reduce((t, p, i) => { const q = k[(i + 1) % k.length]; return t + p.u * q.v - q.u * p.v; }, 0) / 2);

        function ansichtHtml(r, a, f, st) {
            const seite = a.seite === 'R' ? 'R' : 'L';
            const w = r.wange;
            if (a.reiter === 'tabelle') {
                const zeilen = r.scharen.map((s) => {
                    const z = s.zuschnitt;
                    return `<tr data-act="zeigeSchar" data-wert="${s.nr}"><td>${seite}${s.nr}</td><td>${f(s.breite)}</td><td>${f(s.h0)}</td><td>${f(s.h1)}</td>
                        <td>${f(z.breite)}</td><td>${f(z.hoeheLinks)}</td><td>${f(z.hoeheRechts)}</td><td>${f(z.versatzUnten)}</td><td>${f(z.versatzOben)}</td></tr>`;
                }).join('');
                return `<div class="gw-tabelle-rahmen"><table class="gw-tabelle">
                    <thead><tr><th>Pos</th><th>Achs-<br>mass</th><th>Naht<br>vorne</th><th>Naht<br>hinten</th><th>Zuschnitt<br>Breite</th><th>Zuschnitt<br>Höhe vorne</th><th>Zuschnitt<br>Höhe hinten</th><th>Versatz<br>unten</th><th>Versatz<br>oben</th></tr></thead>
                    <tbody>${zeilen}</tbody>
                    <tfoot><tr><td>Summe</td><td>${f(r.scharen.reduce((t, s) => t + s.breite, 0))}</td><td colspan="7"></td></tr></tfoot>
                </table></div>
                <p class="gw-hinweis">Summe der Achsmasse = Tiefe waagrecht ${f(w.L)} mm. Zuschnitthöhen inklusive Querfalz. Vorne = Seite zur Gaubenfront. Zeile antippen für die Zuschnittskizze. ${seite === 'R' ? 'Rechte Wange: alle Masse wie links, Zuschnitt gespiegelt.' : ''}</p>`;
            }
            if (a.reiter === 'schar') {
                const nr = Math.min(Math.max(1, Number(a.schar) || 1), r.scharen.length);
                const s = r.scharen[nr - 1];
                const z = seite === 'R' ? spiegeln(s.zuschnitt) : s.zuschnitt;
                const pos = `${seite}${s.nr}`;
                return `
                    <div class="gw-schar-kopf">
                        <button type="button" data-act="schar" data-wert="${nr - 1}" ${nr <= 1 ? 'disabled' : ''} aria-label="vorherige Schar">‹</button>
                        <strong>Schar ${esc(pos)} von ${r.scharen.length}</strong>
                        <button type="button" data-act="schar" data-wert="${nr + 1}" ${nr >= r.scharen.length ? 'disabled' : ''} aria-label="nächste Schar">›</button>
                    </div>
                    ${svgSchar(z, pos, st)}
                    <div class="gw-schar-masse">
                        <div><b>${f(z.breite)}</b><span>Zuschnitt Breite</span></div>
                        <div><b>${f(s.zuschnitt.hoeheLinks)}</b><span>Höhe an der Seite zur Front</span></div>
                        <div><b>${f(s.zuschnitt.hoeheRechts)}</b><span>Höhe an der Seite zur Spitze</span></div>
                        <div><b>${f(z.versatzUnten)}</b><span>Versatz unten</span></div>
                        <div><b>${f(z.versatzOben)}</b><span>Versatz oben</span></div>
                        <div><b>${f(s.breite)}</b><span>Achsmass (netto)</span></div>
                        <div><b>${f(z.zugabeFront)} / ${f(z.zugabeSpitze)}</b><span>Stehfalz Front / Spitze</span></div>
                        <div><b>${f(s.h0)} / ${f(s.h1)}</b><span>Nahtlänge vorne / hinten</span></div>
                    </div>
                    <p class="gw-hinweis">Rot gestrichelt: Biegelinien. Höhen am Zuschnitt inklusive Querfalz (oben ${fmt(z.querObenSenkrecht, 1)} mm, unten ${fmt(z.querUntenSenkrecht, 1)} mm senkrecht gemessen).</p>`;
            }
            if (a.reiter === 'weg') {
                const z0 = r.scharen[0].zuschnitt;
                const zeilen = [
                    ...w.rechenweg,
                    `Höhenabnahme je mm waagrecht: tan α − tan β = ${fmt(w.d, 5)}`,
                    `Nahtlänge an der Stelle x: h(x) = H − x · ${fmt(w.d, 5)}`,
                    `Querfalz oben senkrecht = ${fmt(z0.querOben, 1)} / cos ${fmt(w.beta, 2)}° = ${fmt(z0.querObenSenkrecht, 2)} mm`,
                    `Querfalz unten senkrecht = ${fmt(z0.querUnten, 1)} / cos ${fmt(w.alpha, 2)}° = ${fmt(z0.querUntenSenkrecht, 2)} mm`,
                    `Versatz unten = Zuschnittbreite · tan α, Versatz oben = Zuschnittbreite · tan β`,
                    ...bandWeg(r)
                ];
                return `<div class="gw-weg">
                    <b>Rechenweg</b><ol>${zeilen.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
                    <b>Proben</b><ol>${r.proben.map((p) => `<li class="${p.ok ? 'gw-probe-ok' : 'gw-probe-falsch'}">${p.ok ? '✓' : '✗'} ${esc(p.name)}</li>`).join('')}</ol>
                </div>`;
            }
            return svgGesamt(r, seite, st) + `<p class="gw-hinweis">Orange: Nahtlängen netto. Blau: Achsmasse der Scharen. ${seite === 'R' ? 'Rechte Wange, von aussen gesehen.' : 'Linke Wange, von aussen gesehen.'}</p>`;
        }

        // --- Ereignisse ------------------------------------------------------

        function verbinden() {
            el.addEventListener('input', (ev) => {
                const pfad = ev.target.dataset && ev.target.dataset.pfad;
                if (!pfad) return;
                const teile = pfad.split('.');
                let ziel = daten;
                for (const t of teile.slice(0, -1)) ziel = ziel[t];
                ziel[teile[teile.length - 1]] = ev.target.value;
                speichern();
                ergebnisZeigen();
            });
            el.addEventListener('change', (ev) => {
                if (ev.target.dataset.act === 'eingabeart') {
                    daten.eingabe.eingabeart = ev.target.value;
                    speichern();
                    zeigenNeu();
                }
            });
            el.addEventListener('click', (ev) => {
                const k = ev.target.closest('[data-act]');
                if (!k || k.tagName === 'SELECT') return;
                const wert = k.dataset.wert;
                switch (k.dataset.act) {
                    case 'art': daten.eingabe.art = wert; break;
                    case 'regel': daten.einstellungen.regel = wert; break;
                    case 'vorgabe': daten.einstellungen.vorgabe = wert; break;
                    case 'seite': daten.ansicht.seite = wert; break;
                    case 'reiter': daten.ansicht.reiter = wert; break;
                    case 'stellen': daten.ansicht.stellen = Number(wert); break;
                    case 'schar': daten.ansicht.schar = Number(wert); break;
                    case 'zeigeSchar': daten.ansicht.schar = Number(wert); daten.ansicht.reiter = 'schar'; break;
                    default: return;
                }
                speichern();
                if (['art', 'regel', 'vorgabe'].includes(k.dataset.act)) zeigenNeu();
                else ergebnisZeigen();
            });
        }

        // Eingabe neu aufbauen, Fokus und Scrollstand behalten
        function zeigenNeu() {
            const links = el.querySelector('.gw-links');
            links.innerHTML = eingabeHtml();
            ergebnisZeigen();
        }
    }
};
