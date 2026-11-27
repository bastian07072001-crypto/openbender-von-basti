import { Geometry } from './Geometry.js';

// Biegungen, die höchstens so weit von einer Geraden abweichen, gelten als
// Anreifung und ändern die Längen nicht (Spengler-Praxis).
export const ANREIFUNG_MAX_DEG = 10;

/**
 * Steckbare Profile: Berechnet aus dem vorderen (engen) Profil die Längen
 * des hinteren, weiten Endes, damit das nächste Blech ohne Ausschnitt
 * hineingesteckt werden kann. Die Winkel bleiben gleich (konisches Profil).
 *
 * Regel (Blechstärke t, "Aussenseite" = Seite, auf der das weite Stück
 * über dem engen liegt):
 * - Biegung: läuft die Aussenseite aussen um die Biegung herum, werden
 *   beide anliegenden Schenkel +t länger, liegt sie innen, −t kürzer.
 * - Anreifung (Abweichung ≤ ANREIFUNG_MAX_DEG): keine Änderung.
 * - Freies Ende: nochmals ±t, mit dem Vorzeichen der Biegung am anderen
 *   Ende des Schenkels (auch bei einer Anreifung).
 * - Umschlag mit freier Spitze: nur die Falz zählt (1× t), kein Zuschlag
 *   an der Spitze.
 * - Verzweigungspunkte (3 und mehr Linien): keine Änderung.
 * - Ergebnis auf den nächsthöheren Millimeter aufrunden.
 *
 * side: +1 = Aussenseite links der Laufrichtung, −1 = rechts. Die
 * Laufrichtung geht von einem Ende des Profils aus (erster Punkt mit nur
 * einer Linie), damit die Seite entlang der ganzen Kette gleich bleibt.
 */
export class PlugProfile {
    /**
     * Biegungen des Profils, unabhängig von der Aussenseite: pro Punkt mit
     * genau zwei Linien der Drehwinkel (Grad, + = Linksdrehung entlang der
     * Laufrichtung), ob es eine Anreifung und ob es eine Umschlag-Falz ist.
     */
    static analyze(profile) {
        const { points, segments } = profile;

        const degree = points.map(() => 0);
        segments.forEach(seg => {
            degree[seg.startIndex]++;
            degree[seg.endIndex]++;
        });

        // Segmente von einem Profilende aus orientieren (Breitensuche)
        let root = degree.findIndex(d => d === 1);
        if (root < 0) root = 0;
        const oriented = segments.map(() => null); // { from, to }
        const visited = new Set([root]);
        const queue = [root];
        while (queue.length > 0) {
            const from = queue.shift();
            segments.forEach((seg, i) => {
                if (oriented[i]) return;
                let to = -1;
                if (seg.startIndex === from) to = seg.endIndex;
                else if (seg.endIndex === from) to = seg.startIndex;
                if (to < 0) return;
                oriented[i] = { from, to };
                if (!visited.has(to)) {
                    visited.add(to);
                    queue.push(to);
                }
            });
        }

        // Biegungen an Punkten mit genau zwei Linien
        const bends = points.map(() => null); // { turn, cross, anreifung, hemFold }
        points.forEach((pt, v) => {
            if (degree[v] !== 2) return;
            const incoming = oriented.find(o => o && o.to === v);
            const outgoing = oriented.find(o => o && o.from === v);
            if (!incoming || !outgoing) return;

            const a = points[incoming.from];
            const b = points[outgoing.to];
            const inX = pt.x - a.x, inY = pt.y - a.y;
            const outX = b.x - pt.x, outY = b.y - pt.y;
            const cross = inX * outY - inY * outX;
            const dot = inX * outX + inY * outY;
            const turn = Math.atan2(cross, dot) * 180 / Math.PI;
            const hemFold = segments.some(seg => seg.type === 'hem' && seg.hemVertexIndex === v);
            bends[v] = { turn, cross, anreifung: Math.abs(turn) <= ANREIFUNG_MAX_DEG, hemFold };
        });

        return { degree, bends };
    }

    static computeBackLengths(profile, thickness, side) {
        const { points, segments } = profile;
        const t = thickness;
        const { degree, bends: rawBends } = this.analyze(profile);

        // Dreht die Kette zur Aussenseite hin, liegt diese innen in der
        // Biegung (−t), sonst aussen (+t). Exakt 180° (kein Drehsinn
        // bestimmbar): aussen.
        const bends = rawBends.map(bend => bend && {
            sign: bend.cross * side > 1e-9 ? -1 : 1,
            anreifung: bend.anreifung
        });

        return segments.map(seg => {
            const front = Geometry.distance(points[seg.startIndex], points[seg.endIndex]);
            let delta = 0;
            const ends = [seg.startIndex, seg.endIndex];

            ends.forEach(v => {
                const bend = bends[v];
                if (bend && !bend.anreifung) delta += bend.sign * t;
            });

            ends.forEach((v, k) => {
                if (degree[v] !== 1) return;
                // Umschlag: an der freien Spitze kein Zuschlag
                if (seg.type === 'hem' && seg.hemTipIndex === v) return;
                const otherBend = bends[ends[1 - k]];
                if (otherBend) delta += otherBend.sign * t;
            });

            // Vom angezeigten (ganzzahligen) Mass ausgehen: gezeichnete Längen
            // haben oft Nachkommastellen (15.07 statt 15), die sonst beim
            // Aufrunden einen ganzen Millimeter zu viel ergäben.
            return Math.max(1, Math.ceil(Math.round(front) + delta - 1e-6));
        });
    }

    /**
     * Wählt als Aussenseite die Seite, um die sich das Profil insgesamt
     * herumbiegt: Summe der Drehwinkel ohne Umschlag-Falzen; dreht die Kette
     * insgesamt nach links, liegt aussen rechts. Passt bei allen Beispielen
     * in docs/Beispiele Steckbare Bleche. Bei Gleichstand die Seite mit der
     * grösseren hinteren Abwicklung, sonst links (+1).
     */
    static chooseSide(profile, thickness) {
        const { bends } = this.analyze(profile);
        const netTurn = bends.reduce((sum, bend) => sum + (bend && !bend.hemFold ? bend.turn : 0), 0);
        if (netTurn > 1e-6) return -1;
        if (netTurn < -1e-6) return 1;

        const sum = (lengths) => lengths.reduce((a, b) => a + b, 0);
        const left = sum(this.computeBackLengths(profile, thickness, 1));
        const right = sum(this.computeBackLengths(profile, thickness, -1));
        return right > left ? -1 : 1;
    }
}
