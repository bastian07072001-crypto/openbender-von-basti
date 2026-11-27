import { Geometry } from '../utils/Geometry.js';
import { PlugProfile } from '../utils/PlugProfile.js';

const HEM_OPEN_ANGLE_THRESHOLD_DEG = 18; // Winkel Grenze zur Bestimmung, wann es sich um ein Umschlag handelt

export class Profile {
    constructor() {
        this.clear();
    }

    clear() {
        this.points = [];
        this.segments = [];
        this.arcs = [];

        // Konisches Profil: zweites (hinteres) Profilende mit gleichem Aufbau
        // und gleichen Winkeln, nur die Längen dürfen abweichen (siehe
        // computeBackGeometry). activeSide = welches Ende gerade bearbeitet wird.
        this.conical = false;
        this.activeSide = 'front'; // 'front' | 'back'

        this.initDefaultProfile();
    }

    initDefaultProfile() {
        // Startlinie: (0,0) bis (0,50)
        const p0 = this.addPoint(0, 0);
        const p1 = this.addPoint(0, 50);
        this.addSegment(p0, p1);
    }

    addPoint(x, y) {
        this.points.push({ x, y });
        return this.points.length - 1;
    }

    addSegment(startIndex, endIndex) {
        if (startIndex === endIndex || startIndex < 0 || endIndex < 0) return null;
        if (startIndex >= this.points.length || endIndex >= this.points.length) return null;

        const seg = { type: 'line', startIndex, endIndex };
        this.segments.push(seg);
        this.reclassifySegments();
        return seg;
    }

    /**
     * Bestimmt für jedes Segment neu, ob es sich um eine normale Linie oder
     * einen Umschlag/Saum handelt, und schreibt das Ergebnis in seg.type
     * ('line' | 'hem').
     *
     * Konvention: Ein Segment wird immer als {startIndex: <bisheriger aktiver
     * Punkt>, endIndex: <neuer Punkt>} angelegt – startIndex ist also der
     * Scheitelpunkt, an dem ein Knick/Falz zum vorherigen Segment entstehen
     * kann. Gibt es an diesem Punkt ein weiteres Segment (die "Vorgänger"-
     * Linie), wird der Biegewinkel dorthin berechnet. Faltet sich das
     * aktuelle Segment fast vollständig auf die Vorgänger-Linie zurück
     * (Biegewinkel nahe ±180°, "Öffnung" ≤ Schwellenwert), gilt es als
     * Umschlag. Ohne Vorgänger-Segment (erste Linie einer Kette) bleibt es
     * immer eine normale Linie.
     *
     * Muss nach jeder Geometrie-Änderung erneut aufgerufen werden (neues
     * Segment, verschobener Punkt, JSON-Import) – wird daher an diesen
     * Stellen im Code jeweils mit ausgelöst.
     */
    reclassifySegments() {
        this.segments.forEach(seg => {
            seg.type = this.classifySegment(seg);
        });
    }

    /**
     * Prüft in zwei Richtungen, ob seg ein Umschlag ist, und setzt bei
     * Erfolg seg.hemVertexIndex/seg.hemTipIndex (von den Renderern anstelle
     * von seg.startIndex/endIndex zu verwenden, siehe Geometry.js):
     *
     * 1. Normal: seg faltet an seinem eigenen Startpunkt zurück, relativ zu
     *    einem dort ankommenden bzw. früher gezeichneten Vorgänger-Segment
     *    (Geometry.findPredecessorSegment). Deckt den Standardfall ab
     *    (Umschlag am Ende einer Kette weitergezeichnet).
     * 2. Umgekehrt: Ein Nachfolge-Segment (das an seg.endIndex weiterzeichnet,
     *    Geometry.findSuccessorSegment) faltet an SEINEM Startpunkt eng
     *    zurück – und seg selbst ist dabei der kürzere der beiden Schenkel.
     *    Dann ist nicht das Nachfolge-Segment, sondern seg selbst der
     *    Umschlag, mit seg.endIndex (statt seg.startIndex) als
     *    Falz-Scheitelpunkt. Deckt den Fall ab, dass die kürzere Lasche VOR
     *    der längeren Basislinie gezeichnet wurde (z.B. ab einem
     *    Verzweigungspunkt zuerst ein kurzer Schenkel, danach – von dessen
     *    Ende aus weiter – die lange Basis).
     *
     * In beiden Richtungen gilt: der Winkel muss eng sein UND das Segment
     * muss kürzer als seine Basis sein (siehe Geometry.isHemCandidate) –
     * das längere der beiden Segmente bleibt immer eine normale Linie. Bei
     * exakt gleicher Länge (z.B. Mittelrippe mit gesperrten Längen) gewinnt
     * die normale Richtung, damit genau eines der beiden Umschlag wird.
     */
    classifySegment(seg) {
        delete seg.hemVertexIndex;
        delete seg.hemTipIndex;

        const segLength = Geometry.distance(this.points[seg.startIndex], this.points[seg.endIndex]);

        // Richtung 1: normal
        const prevSeg = Geometry.findPredecessorSegment(this.segments, seg);
        if (prevSeg) {
            const prevPointIndex = (prevSeg.startIndex === seg.startIndex) ? prevSeg.endIndex : prevSeg.startIndex;
            const refPt = this.points[prevPointIndex];
            const vertexPt = this.points[seg.startIndex];
            const tipPt = this.points[seg.endIndex];
            const baseLength = Geometry.distance(refPt, vertexPt);

            if (Geometry.isHemCandidate(refPt, vertexPt, tipPt, segLength, baseLength, HEM_OPEN_ANGLE_THRESHOLD_DEG, true)) {
                seg.hemVertexIndex = seg.startIndex;
                seg.hemTipIndex = seg.endIndex;
                return 'hem';
            }
        }

        // Richtung 2: umgekehrt
        const succSeg = Geometry.findSuccessorSegment(this.segments, seg);
        if (succSeg) {
            const refPt = this.points[seg.startIndex];
            const vertexPt = this.points[seg.endIndex];
            const tipPt = this.points[succSeg.endIndex];
            const baseLength = Geometry.distance(vertexPt, tipPt);

            if (Geometry.isHemCandidate(refPt, vertexPt, tipPt, segLength, baseLength, HEM_OPEN_ANGLE_THRESHOLD_DEG, false)) {
                seg.hemVertexIndex = seg.endIndex;
                seg.hemTipIndex = seg.startIndex;
                return 'hem';
            }
        }

        return 'line';
    }

    // --- LINIEN DÜRFEN SICH NICHT KREUZEN ---

    /**
     * true, wenn sich zwei nicht verbundene Linien echt schneiden (vorne
     * oder, beim konischen Profil, hinten). Berühren zählt nicht: z. B. liegt
     * beim Quetschbug das Ende des Umschlags auf der Linie davor.
     */
    kreuztSich() {
        if (Profile.linienKreuzen(this.points, this.segments)) return true;
        return this.conical && Profile.linienKreuzen(this.computeBackGeometry().points, this.segments);
    }

    static linienKreuzen(points, segments, toleranz = 0.05) {
        const linien = segments
            .map(seg => ({ seg, a: points[seg.startIndex], b: points[seg.endIndex] }))
            .filter(l => l.a && l.b);
        for (let i = 0; i < linien.length; i++) {
            for (let j = i + 1; j < linien.length; j++) {
                const L1 = linien[i], L2 = linien[j];
                const s1 = L1.seg, s2 = L2.seg;
                if (s1.startIndex === s2.startIndex || s1.startIndex === s2.endIndex
                    || s1.endIndex === s2.startIndex || s1.endIndex === s2.endIndex) continue;
                const rx = L1.b.x - L1.a.x, ry = L1.b.y - L1.a.y;
                const sx = L2.b.x - L2.a.x, sy = L2.b.y - L2.a.y;
                const len1 = Math.hypot(rx, ry), len2 = Math.hypot(sx, sy);
                if (len1 < toleranz || len2 < toleranz) continue;
                const d = rx * sy - ry * sx;
                if (Math.abs(d) < 1e-9 * len1 * len2) continue; // parallel
                const qx = L2.a.x - L1.a.x, qy = L2.a.y - L1.a.y;
                const t = (qx * sy - qy * sx) / d;
                const u = (qx * ry - qy * rx) / d;
                const e1 = toleranz / len1, e2 = toleranz / len2;
                if (t > e1 && t < 1 - e1 && u > e2 && u < 1 - e2) return true;
            }
        }
        return false;
    }

    /**
     * Zustand merken und zurückholen (Änderung verwerfen, die zu einer Kreuzung führt).
     * neueKreuzung(stand): kreuzt sich das Profil jetzt, vorher aber nicht? (Ein
     * schon gekreuzt geöffnetes Profil bleibt so bearbeitbar.)
     */
    merken() {
        return JSON.stringify({ points: this.points, segments: this.segments, kreuzte: this.kreuztSich() });
    }

    neueKreuzung(stand) {
        return !JSON.parse(stand).kreuzte && this.kreuztSich();
    }

    zurueckholen(stand) {
        const d = JSON.parse(stand);
        this.points = d.points;
        this.segments = d.segments;
        this.reclassifySegments();
    }

    // --- SPEICHERN / LADEN (JSON-Datei und Autosave) ---

    toData() {
        return {
            points: this.points,
            segments: this.segments,
            conical: this.conical
        };
    }

    /**
     * Übernimmt gespeicherte Profildaten. Dateien ohne "conical" (vor
     * Version 0.15) laden als normales Profil. Ungültige hintere Längen
     * werden verworfen (= gleich wie vorne).
     */
    loadData(data = {}) {
        this.points = Array.isArray(data.points) ? data.points : [];
        this.segments = Array.isArray(data.segments) ? data.segments : [];
        this.segments.forEach(seg => {
            if (seg.backLength !== undefined && !(Number.isFinite(seg.backLength) && seg.backLength > 0)) {
                delete seg.backLength;
            }
            if (seg.backManual !== undefined && (seg.backManual !== true || seg.backLength === undefined)) {
                delete seg.backManual;
            }
        });
        this.setConical(data.conical === true);
        this.activeSide = 'front';
        this.reclassifySegments();
    }

    // --- KONISCHES PROFIL (hinteres Profilende) ---
    //
    // Das hintere Ende wird nicht als eigene Punktliste gespeichert, sondern
    // pro Segment nur seine Länge (seg.backLength). Die Richtungen kommen
    // immer vom vorderen Profil – damit sind Aufbau und Winkel beider Enden
    // zwangsläufig identisch, und jede Winkeländerung vorne gilt auch hinten.
    // Ohne seg.backLength ist die hintere Länge gleich der vorderen.

    isEditingBack() {
        return this.conical && this.activeSide === 'back';
    }

    setConical(enabled) {
        this.conical = !!enabled;
        if (!this.conical) this.activeSide = 'front';
    }

    setActiveSide(side) {
        this.activeSide = (this.conical && side === 'back') ? 'back' : 'front';
    }

    getBackLength(seg) {
        if (Number.isFinite(seg.backLength)) return seg.backLength;
        return Geometry.distance(this.points[seg.startIndex], this.points[seg.endIndex]);
    }

    // Von Hand gesetzte hintere Länge (Mass-Eingabe oder Punkt ziehen).
    // seg.backManual schützt sie vor der automatischen Steckprofil-Berechnung:
    // manuelle Eingaben haben immer Vorrang.
    setBackLength(segIndex, length) {
        const seg = this.segments[segIndex];
        if (!seg) return;
        seg.backLength = length;
        seg.backManual = true;
    }

    /**
     * Baut das hintere Profil auf: ausgehend von Punkt 0 (gemeinsamer
     * Bezugspunkt beider Enden) wird jeder weitere Punkt über die Richtung
     * des vorderen Segments und die hintere Länge erreicht.
     * Liefert { points, parent }, parent[i] = { segIndex, from } ist das
     * Segment, über das Punkt i erreicht wurde (Punkt 0 und nicht verbundene
     * Punkte: null). Ein geschlossener Ring würde über die zuerst erreichte
     * Seite aufgebaut.
     */
    computeBackGeometry() {
        const front = this.points;
        const points = front.map(pt => ({ x: pt.x, y: pt.y }));
        const parent = front.map(() => null);
        if (front.length === 0) return { points, parent };

        const visited = new Set([0]);
        const queue = [0];
        while (queue.length > 0) {
            const from = queue.shift();
            this.segments.forEach((seg, segIndex) => {
                let to = -1;
                if (seg.startIndex === from) to = seg.endIndex;
                else if (seg.endIndex === from) to = seg.startIndex;
                if (to < 0 || visited.has(to) || !front[to] || !front[from]) return;

                const dx = front[to].x - front[from].x;
                const dy = front[to].y - front[from].y;
                const len = Math.hypot(dx, dy);
                const backLen = this.getBackLength(seg);
                points[to] = len > 0
                    ? { x: points[from].x + dx / len * backLen, y: points[from].y + dy / len * backLen }
                    : { x: points[from].x, y: points[from].y };
                parent[to] = { segIndex, from };
                visited.add(to);
                queue.push(to);
            });
        }

        return { points, parent };
    }

    /**
     * Abwicklung (Summe aller Schenkellängen) beider Enden in mm.
     * blank: Zuschnittbreite für den Blechbedarf. Beim konischen Profil wird
     * aus einem Rechteck der grösseren Abwicklung geschnitten – der
     * Verschnitt zählt zum Bedarf.
     * waste: davon Verschnittbreite (Rechteck minus Trapez = halbe Differenz).
     */
    getUnfoldLengths() {
        // Summe der auf ganze mm gerundeten Schenkel, wie sie im Profil angezeigt
        // werden – Abwicklung, Zuschnitt und Anriss rechnen mit denselben Zahlen
        let front = 0;
        let back = 0;
        this.segments.forEach(seg => {
            const p1 = this.points[seg.startIndex];
            const p2 = this.points[seg.endIndex];
            if (!p1 || !p2) return;
            front += Math.round(Geometry.distance(p1, p2));
            back += Math.round(this.getBackLength(seg));
        });
        if (!this.conical) back = front;
        return { front, back, blank: Math.max(front, back), waste: Math.abs(front - back) / 2 };
    }

    /**
     * Steckbares Profil: hinteres Ende als weites Stück berechnen (siehe
     * PlugProfile) und den Konisch-Modus einschalten. Ohne side wird die
     * Seite gewählt, die das weitere Stück ergibt. Von Hand gesetzte
     * hintere Längen (seg.backManual) bleiben unverändert. Gibt die Anzahl
     * beibehaltener manueller Längen zurück.
     */
    applyPlugProfile(thickness, side = PlugProfile.chooseSide(this, thickness)) {
        const lengths = PlugProfile.computeBackLengths(this, thickness, side);
        let kept = 0;
        lengths.forEach((length, i) => {
            const seg = this.segments[i];
            if (seg.backManual) {
                kept++;
                return;
            }
            seg.backLength = length;
        });
        this.setConical(true);
        return kept;
    }

    /**
     * Tauscht vorderes und hinteres Profilende komplett, ohne ein Mass zu
     * verändern: das hintere Profil wird zum vorderen und umgekehrt.
     * Punkt 0 bleibt als gemeinsamer Bezugspunkt liegen. Gesperrte Längen
     * übernehmen ihren neuen vorderen Wert. Die Markierung "von Hand"
     * entfällt – das Getauschte ist jetzt das gezeichnete vordere Profil.
     */
    swapEnds() {
        if (!this.conical) return;
        const backPoints = this.computeBackGeometry().points;
        const frontLengths = this.segments.map(seg =>
            Geometry.distance(this.points[seg.startIndex], this.points[seg.endIndex])
        );

        this.points = backPoints;
        this.segments.forEach((seg, i) => {
            seg.backLength = frontLengths[i];
            delete seg.backManual;
            if (seg.lengthLocked) {
                seg.lockedLength = Math.round(Geometry.distance(this.points[seg.startIndex], this.points[seg.endIndex]));
            }
        });
        this.reclassifySegments();
    }

    // Punkte des gerade bearbeiteten Endes (vorne: die echten Punkte)
    getActivePoints() {
        return this.isEditingBack() ? this.computeBackGeometry().points : this.points;
    }

    /**
     * Ziehen eines Punktes im hinteren Profil: Da Winkel fix sind, kann der
     * Punkt nur entlang seines Segments (Richtung von Punkt 0 weg) gleiten –
     * es ändert sich nur die hintere Länge dieses Segments, der Rest der
     * Kette wird mitverschoben. Punkt 0 (Bezugspunkt) bleibt fest.
     */
    dragBackPoint(ptIndex, x, y) {
        const { points, parent } = this.computeBackGeometry();
        const link = parent[ptIndex];
        if (!link) return;

        const fromFront = this.points[link.from];
        const toFront = this.points[ptIndex];
        const dx = toFront.x - fromFront.x;
        const dy = toFront.y - fromFront.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return;

        const origin = points[link.from];
        const projected = ((x - origin.x) * dx + (y - origin.y) * dy) / len;
        this.setBackLength(link.segIndex, Math.max(1, Math.round(projected)));
    }
}
