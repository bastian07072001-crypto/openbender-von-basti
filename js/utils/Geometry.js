export class Geometry {
    /**
     * Findet das Vorgänger-Segment für den Scheitelpunkt eines Segments
     * (seg.startIndex) – also die Linie, die dort tatsächlich ANKOMMT
     * (other.endIndex === vertexIndex). Genutzt von Profile.classifySegment
     * sowie von CanvasRenderer/PDFExporter/DXFExporter/Preview3DController,
     * die alle exakt dieselbe Vorgänger-Linie für die Umschlag-Darstellung
     * finden müssen (2D, PDF, DXF und 3D müssen konsistent sein).
     *
     * Gibt es keine ankommende Linie (vertexIndex ist eine Profil-Wurzel,
     * z.B. der allererste gezeichnete Punkt, oder ein Punkt, von dem aus
     * mehrfach neu angesetzt wurde), wird ersatzweise ein "Geschwister"-
     * Segment gesucht, das denselben Startpunkt hat UND NACHWEISLICH FRÜHER
     * gezeichnet wurde (other.endIndex < seg.endIndex – Punkte werden beim
     * Zeichnen streng aufsteigend nummeriert, ein kleinerer Index bedeutet
     * also "früher entstanden"). Von mehreren solchen Geschwistern wird das
     * zuletzt gezeichnete (größter endIndex, aber immer noch < seg.endIndex)
     * verwendet.
     *
     * WICHTIG: Diese Geschwister-Suche ist bewusst EINSEITIG (asymmetrisch):
     * Ein früher gezeichnetes Geschwister-Segment wird als Referenzrichtung
     * für ein später gezeichnetes verwendet, aber NIEMALS umgekehrt. Ohne
     * diese Einseitigkeit würden sich zwei Segmente, die vom selben Punkt
     * aus gezeichnet wurden (z.B. eine ganz normale erste Profillinie, an
     * die anschließend – vom Startpunkt aus erneut angesetzt – ein Umschlag
     * gezeichnet wird), GEGENSEITIG als Vorgänger erkennen und beide fälsch-
     * lich als Umschlag klassifiziert werden (die ursprüngliche, oft lange
     * Grundlinie würde dann selbst zum "Umschlag" und schematisch verzerrt
     * dargestellt). Mit der Einseitigkeit bleibt die zuerst gezeichnete
     * Linie immer eine normale Linie; nur das später angesetzte Segment
     * wird (bei entsprechendem Winkel) korrekt als Umschlag erkannt.
     */
    static findPredecessorSegment(segments, seg) {
        const vertexIndex = seg.startIndex;

        const arriving = segments.find(other =>
            other !== seg && other.endIndex === vertexIndex
        );
        if (arriving) return arriving;

        let best = null;
        segments.forEach(other => {
            if (other === seg || other.startIndex !== vertexIndex) return;
            if (other.endIndex >= seg.endIndex) return; // nur früher gezeichnete Geschwister
            if (!best || other.endIndex > best.endIndex) best = other;
        });
        return best;
    }

    /**
     * Findet das Nachfolge-Segment, das an seg.endIndex weiterzeichnet
     * (other.startIndex === seg.endIndex) – das Gegenstück zu
     * findPredecessorSegment(), gebraucht für die "umgekehrte"
     * Umschlag-Prüfung in Profile.classifySegment(): Ist seg selbst kürzer
     * als dieses Nachfolge-Segment und faltet das Nachfolge-Segment eng auf
     * seg zurück, dann ist nicht das Nachfolge-Segment, sondern seg selbst
     * der Umschlag (mit seg.endIndex statt seg.startIndex als
     * Falz-Scheitelpunkt) – siehe seg.hemVertexIndex/hemTipIndex.
     */
    static findSuccessorSegment(segments, seg) {
        return segments.find(other => other !== seg && other.startIndex === seg.endIndex) || null;
    }

    /**
     * Liefert das Basis-/Vorgänger-Segment eines BEREITS als Umschlag
     * klassifizierten Segments (seg.type === 'hem', mit gesetztem
     * seg.hemVertexIndex – siehe Profile.classifySegment). Im Normalfall
     * (hemVertexIndex === seg.startIndex) ist das die über
     * findPredecessorSegment() gefundene ankommende/frühere Linie; bei einem
     * umgekehrt orientierten Umschlag (hemVertexIndex === seg.endIndex, seg
     * wurde vor seiner eigentlichen Basislinie gezeichnet) ist es
     * stattdessen das über findSuccessorSegment() gefundene Segment. Wird
     * von allen Renderern (2D/PDF/DXF/3D) genutzt, damit sie nicht selbst
     * zwischen beiden Fällen unterscheiden müssen.
     */
    static getHemBaseSegment(segments, seg) {
        if (!seg) return null;
        if (seg.hemVertexIndex === seg.endIndex) {
            return this.findSuccessorSegment(segments, seg);
        }
        return this.findPredecessorSegment(segments, seg);
    }

    /**
     * true, wenn an der Spitze (seg.hemTipIndex) eines Umschlags noch ein
     * weiteres Segment hängt – dann muss die schematische Falz-Linie exakt
     * dort enden (siehe computeFoldLayout / computeSymmetricFold).
     */
    static isHemTipConnected(segments, seg) {
        const tip = seg.hemTipIndex;
        return segments.some(other =>
            other !== seg && (other.startIndex === tip || other.endIndex === tip)
        );
    }

    /**
     * Prüft, ob ein Segment (Länge segLength, Scheitelpunkt vertexPt) relativ
     * zu einer Referenzrichtung (refPt -> vertexPt) und seinem fernen Punkt
     * (tipPt) als Umschlag gelten soll: der Biegewinkel muss eng sein UND
     * das Segment muss kürzer als seine Basis (baseLength) sein – von zwei
     * eng gefalteten Schenkeln ist immer der kürzere der Umschlag. Keine
     * absolute Längengrenze: auch eine hohe Mittelrippe (zwei lange,
     * gleich lange Schenkel) ist oben ein echter Falz.
     *
     * allowEqualLength: Tie-Breaker bei exakt gleich langen Schenkeln
     * (z.B. per Längensperre gesetzt). Nur die normale Prüfrichtung darf
     * gleich lang gewinnen, die umgekehrte muss strikt kürzer sein – so
     * wird von einem Paar immer genau EIN Segment der Umschlag.
     */
    static isHemCandidate(refPt, vertexPt, tipPt, segLength, baseLength, maxAngleDeg, allowEqualLength) {
        if (!refPt || !vertexPt || !tipPt) return false;
        const shorter = allowEqualLength ? segLength <= baseLength : segLength < baseLength;
        if (!shorter) return false;

        const bendAngle = this.calculateBendAngle(refPt, vertexPt, tipPt);
        const openAngle = 180 - Math.abs(bendAngle);
        return openAngle <= maxAngleDeg;
    }

    /**
     * Berechnet den euklidischen Abstand zwischen zwei Punkten.
     */
    static distance(p1, p2) {
        if (!p1 || !p2) return 0;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Alias für distance (berechnet die Länge eines Segments/Linie)
     */
    static getLineLength(p1, p2) {
        return this.distance(p1, p2);
    }

    /**
     * Prüft, ob ein Punkt (worldPos) auf oder nahe an einem Segment liegt.
     */
    static pointOnSegment(p, segment, points, tolerance = 6) {
        const p1 = points[segment.startIndex];
        const p2 = points[segment.endIndex];

        if (!p1 || !p2) return false;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const lenSq = dx * dx + dy * dy;

        // Falls Start- und Endpunkt identisch sind
        if (lenSq === 0) {
            return this.distance(p, p1) <= tolerance;
        }

        // Projektionsfaktor t berechnen (begrenzt auf das Segment [0, 1])
        let t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));

        // Nächstgelegener Punkt auf dem Segment
        const projX = p1.x + t * dx;
        const projY = p1.y + t * dy;

        // Abstand vom Klickpunkt zur Projektion messen
        const dist = Math.hypot(p.x - projX, p.y - projY);

        return dist <= tolerance;
    }

    /**
     * Berechnet den Biegewinkel an Punkt P2 zwischen den Vektoren (P1->P2) und (P2->P3).
     * 0° = gestreckt (keine Biegung), +90° = 90° Linksbiegung, -90° = 90° Rechtsbiegung.
     */
    static calculateBendAngle(p1, p2, p3) {
        if (!p1 || !p2 || !p3) return 0;

        // Vektor 1: Von P1 nach P2
        const v1x = p2.x - p1.x;
        const v1y = p2.y - p1.y;

        // Vektor 2: Von P2 nach P3
        const v2x = p3.x - p2.x;
        const v2y = p3.y - p2.y;

        const angle1 = Math.atan2(v1y, v1x);
        const angle2 = Math.atan2(v2y, v2x);

        let diff = (angle2 - angle1) * (180 / Math.PI);

        // Normalisieren auf den Bereich -180° bis +180°
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;

        return diff;
    }

    /**
     * Berechnet die Zielkoordinaten für einen neuen Punkt P3 basierend auf:
     * - Startpunkt des vorherigen Segments (P1)
     * - Scheitelpunkt / Aktivem Punkt (P2)
     * - Schenkellänge
     * - Maschinen-Biegewinkel in Grad (relativ zur Verlängerung von P1->P2)
     */
    static calculatePointFromBendAngle(p1, p2, length, bendAngleDeg) {
        if (!p2) return { x: 0, y: 0 };

        let baseAngleRad = 0;
        if (p1) {
            const v1x = p2.x - p1.x;
            const v1y = p2.y - p1.y;
            baseAngleRad = Math.atan2(v1y, v1x);
        }

        const bendAngleRad = (bendAngleDeg * Math.PI) / 180;
        const finalAngleRad = baseAngleRad + bendAngleRad;

        return {
            x: p2.x + length * Math.cos(finalAngleRad),
            y: p2.y + length * Math.sin(finalAngleRad)
        };
    }

    /**
     * Berechnet Start- und Endpunkt einer schematischen Umschlag/Saum-Linie:
     * parallel zur Vorgänger-Linie (p1 -> vertex) versetzt um offsetMm, mit
     * der tatsächlichen Länge des Umschlags (vertex -> p2). Wird sowohl für
     * die 2D-Darstellung (CanvasRenderer) als auch für die 3D-Abwicklung
     * (Preview3DController) verwendet, damit beide Ansichten konsistent
     * bleiben und niemand die Trigonometrie doppelt implementiert.
     *
     * Das Ende wird rein aus Länge + Basis-Richtung neu berechnet – die
     * tatsächliche Position von p2 zählt nur für die Versatz-Seite. Das ist
     * nur für eine FREIE Lasche-Spitze zulässig (an p2 hängt sonst nichts);
     * für verbundene Spitzen siehe computeSymmetricFold / computeFoldLayout.
     */
    static computeHemFoldLine(p1, vertex, p2, offsetMm) {
        const dx = vertex.x - p1.x;
        const dy = vertex.y - p1.y;
        const dirLen = Math.hypot(dx, dy) || 1;
        const ux = dx / dirLen;
        const uy = dy / dirLen;

        // Senkrechte zur Vorgänger-Linie
        const perpX = -uy;
        const perpY = ux;

        // Seite des Versatzes anhand des tatsächlichen Umschlag-Endpunkts
        // bestimmen, damit die schematische Linie auf der Seite bleibt, auf
        // der der Umschlag tatsächlich gezeichnet wurde.
        const toP2x = p2.x - vertex.x;
        const toP2y = p2.y - vertex.y;
        const side = (ux * toP2y - uy * toP2x) >= 0 ? 1 : -1;

        const offsetX = perpX * offsetMm * side;
        const offsetY = perpY * offsetMm * side;

        const start = { x: vertex.x + offsetX, y: vertex.y + offsetY };
        const hemLen = Math.hypot(toP2x, toP2y);
        const end = {
            x: start.x - ux * hemLen,
            y: start.y - uy * hemLen
        };

        return { ux, uy, offsetX, offsetY, start, end };
    }

    /**
     * Kreisbogen um center mit Radius radius von from nach to, und zwar in
     * der Drehrichtung, die über den Punkt via läuft. Liefert Start-Winkel,
     * vorzeichenbehafteten Überstreichwinkel (positiv = mathematisch positiv
     * in den Zahlen-Koordinaten) und eine Punktfolge für die Darstellung.
     * Der DXF-Export schreibt daraus einen echten Bogen, die übrigen
     * Ausgaben zeichnen die Punktfolge.
     */
    static arcThrough(center, radius, from, to, via, segments = 12) {
        const ang = (p) => Math.atan2(p.y - center.y, p.x - center.x);
        const a1 = ang(from);
        const norm = (a) => { while (a < 0) a += Math.PI * 2; while (a >= Math.PI * 2) a -= Math.PI * 2; return a; };
        const ccw = norm(ang(to) - a1);
        const viaOffset = norm(ang(via) - a1);
        const sweep = viaOffset <= ccw ? ccw : ccw - Math.PI * 2;

        const points = [];
        for (let i = 0; i <= segments; i++) {
            const t = a1 + sweep * (i / segments);
            points.push({ x: center.x + Math.cos(t) * radius, y: center.y + Math.sin(t) * radius });
        }
        points[0] = from;
        points[segments] = to;

        return { center, radius, startAngle: a1, sweep, from, to, points };
    }

    /**
     * Falz zwischen zwei Schenkeln, deren ferne Punkte (baseFar, tip) BEIDE
     * mit weiterer Geometrie verbunden sind (z.B. Mittelrippe). Die Kappe ist
     * ein Kreisbogen mit Radius offsetMm/2 um den Scheitelpunkt, beide
     * Schenkel laufen von ihrem fernen Punkt TANGENTIAL an diesen Bogen
     * (kein Knick am Übergang – wichtig für CAD, z.B. FreeCAD SheetMetal,
     * das jeden Knick als eigene Biegung behandeln würde). Symmetrisch zur
     * Winkelhalbierenden, eine symmetrisch gezeichnete Rippe bleibt gerade.
     */
    static computeSymmetricFold(baseFar, vertex, tip, offsetMm, capSegments = 12) {
        const unit = (p) => {
            const dx = p.x - vertex.x, dy = p.y - vertex.y;
            const len = Math.hypot(dx, dy) || 1;
            return { x: dx / len, y: dy / len };
        };
        const ua = unit(baseFar);
        const ub = unit(tip);

        let dx = ua.x + ub.x, dy = ua.y + ub.y;
        const dlen = Math.hypot(dx, dy);
        if (dlen < 1e-9) { dx = ua.x; dy = ua.y; } else { dx /= dlen; dy /= dlen; }
        const nx = -dy, ny = dx;

        const side = (dx * ub.y - dy * ub.x) >= 0 ? 1 : -1;
        const r = offsetMm / 2;

        // Tangentenpunkt vom fernen Punkt P an den Kreis (vertex, r) – von
        // den zwei möglichen der, der auf der Seite des Schenkels liegt.
        const tangentPoint = (P, preferred) => {
            const px = P.x - vertex.x, py = P.y - vertex.y;
            const dist = Math.hypot(px, py);
            if (dist <= r * 1.0001) return preferred;
            const phi = Math.atan2(py, px);
            const alpha = Math.acos(r / dist);
            const t1 = { x: vertex.x + r * Math.cos(phi + alpha), y: vertex.y + r * Math.sin(phi + alpha) };
            const t2 = { x: vertex.x + r * Math.cos(phi - alpha), y: vertex.y + r * Math.sin(phi - alpha) };
            return this.distance(t1, preferred) <= this.distance(t2, preferred) ? t1 : t2;
        };

        const baseEnd = tangentPoint(baseFar, { x: vertex.x - nx * r * side, y: vertex.y - ny * r * side });
        const hemStart = tangentPoint(tip, { x: vertex.x + nx * r * side, y: vertex.y + ny * r * side });
        const apex = { x: vertex.x - dx * r, y: vertex.y - dy * r };
        const arc = this.arcThrough(vertex, r, baseEnd, hemStart, apex, capSegments);

        return { baseEnd, hemStart, arc };
    }

    /**
     * Zentrale Umschlag-Geometrie für ALLE Ausgaben (2D, PDF, DXF, 3D): Für
     * jeden Umschlag (dessen Basis eine normale Linie ist) werden die
     * angepassten Linien-Endpunkte und die Kappe als echter Kreisbogen
     * berechnet (fold.arc; fold.cap = dessen Punktfolge). Die Renderer
     * zeichnen danach jedes Segment genau einmal als Linie zwischen seinen
     * (ggf. angepassten) Endpunkten plus die Kappen – dadurch schliesst die
     * Kontur immer lückenlos und keine Linie wird doppelt gezeichnet, auch
     * wenn ein Segment an beiden Enden Basis eines Umschlags ist. Linien und
     * Bögen gehen tangential ineinander über.
     *
     * - Freie Lasche-Spitze: Basis unverändert, Umschlag parallel versetzt
     *   mit berechneter Länge (computeHemFoldLine).
     * - Verbundene Spitze (isHemTipConnected): symmetrischer Falz
     *   (computeSymmetricFold), beide Schenkel enden exakt in ihren Punkten.
     *
     * offsetMm = Abstand der beiden Schenkel am Falz (= 2 × Bogenradius).
     * Umschläge, deren Basis selbst ein Umschlag ist (Mittelrippen-
     * Sonderfall mit Rundung), sind nicht enthalten.
     */
    static computeFoldLayout(points, segments, offsetMm, capSegments = 12) {
        const specs = [];
        segments.forEach((seg, segIndex) => {
            if (seg.type !== 'hem') return;
            const base = this.getHemBaseSegment(segments, seg);
            if (!base || base.type === 'hem') return;

            const vIdx = seg.hemVertexIndex;
            const tIdx = seg.hemTipIndex;
            const baseFarIdx = (base.startIndex === vIdx) ? base.endIndex : base.startIndex;
            if (!points[vIdx] || !points[tIdx] || !points[baseFarIdx]) return;

            specs.push({
                segIndex, baseIndex: segments.indexOf(base), vIdx, tIdx, baseFarIdx,
                connected: this.isHemTipConnected(segments, seg)
            });
        });

        // Hat eine Linie an BEIDEN Enden einen Falz, verschiebt jeder Falz
        // das Ende, von dem der andere ausgeht. Damit die Linie trotzdem an
        // beiden Bögen exakt tangential anliegt, wird die Berechnung mit den
        // jeweils verschobenen fernen Enden wiederholt (konvergiert schnell,
        // da die Linien viel länger als die Bogenradien sind).
        let endpoints = new Map();
        let folds = [];
        for (let iter = 0; iter < 6; iter++) {
            const far = (segIdx, pointIdx) => endpoints.get(`${segIdx}:${pointIdx}`) || points[pointIdx];
            const next = new Map();
            folds = [];

            specs.forEach(s => {
                const vertex = points[s.vIdx];
                const baseFar = far(s.baseIndex, s.baseFarIdx);

                let baseEnd, hemStart, arc;
                if (s.connected) {
                    // Das Spitzen-Ende bleibt der echte Punkt bzw. das dort
                    // von einem anderen Falz gesetzte Ende – hier nicht setzen.
                    const tip = far(s.segIndex, s.tIdx);
                    ({ baseEnd, hemStart, arc } = this.computeSymmetricFold(baseFar, vertex, tip, offsetMm, capSegments));
                } else {
                    const tip = points[s.tIdx];
                    const fold = this.computeHemFoldLine(baseFar, vertex, tip, offsetMm);
                    baseEnd = vertex;
                    hemStart = fold.start;
                    next.set(`${s.segIndex}:${s.tIdx}`, fold.end);
                    const r = offsetMm / 2;
                    const center = { x: (vertex.x + fold.start.x) / 2, y: (vertex.y + fold.start.y) / 2 };
                    // Wölbt sich in Basis-Richtung über den Scheitelpunkt hinaus
                    const apex = { x: center.x + fold.ux * r, y: center.y + fold.uy * r };
                    arc = this.arcThrough(center, r, baseEnd, hemStart, apex, capSegments);
                }

                next.set(`${s.baseIndex}:${s.vIdx}`, baseEnd);
                next.set(`${s.segIndex}:${s.vIdx}`, hemStart);
                folds.push({ segIndex: s.segIndex, baseIndex: s.baseIndex, vertexIndex: s.vIdx, arc, cap: arc.points });
            });

            endpoints = next;
        }

        return { endpoints, folds, hemIndices: new Set(folds.map(f => f.segIndex)) };
    }

    // Endpunkt eines Segments an pointIndex, ggf. durch einen Falz angepasst.
    static foldEndpoint(layout, segIndex, pointIndex, points) {
        return layout.endpoints.get(`${segIndex}:${pointIndex}`) || points[pointIndex];
    }

    /**
     * Berechnet eine abgerundete Ecke zwischen zwei Schenkeln (p1 -> vertex
     * und vertex -> p2) als Folge von Punkten entlang des Bogens (Tangente
     * auf der p1-Seite bis Tangente auf der p2-Seite), analog zu
     * CanvasRenderer.arcTo()/buildRoundedPath in Preview3DController.js. Wird
     * für die "Mittelrippen"-Darstellung verwendet: zwei sehr spitz
     * aufeinandertreffende Schenkel (z.B. zwei Umschläge, die sich
     * gegenseitig als Vorgänger nehmen) bekommen so einen realistischen
     * kleinen Biegeradius statt einer mathematisch scharfen Spitze, die in
     * der Realität keine Biegemaschine erzeugen kann.
     *
     * Der Radius wird automatisch so weit reduziert, dass die Tangenten-
     * Anlauflänge (radius / tan(Winkel/2)) niemals über die tatsächlichen
     * Schenkellängen hinausschießt UND niemals mehr als ein paar Millimeter
     * in die Schenkel hineinreicht. WICHTIG: Bei sehr spitzen Winkeln (z.B.
     * einer engen Mittelrippe) wird die Anlauflänge sonst riesig (radius /
     * tan(Winkel/2) wächst für kleine Winkel stark an – dasselbe Problem wie
     * beim Umschlag) und die Rundung würde
     * einen großen Teil des Schenkels abschneiden statt nur die Spitze
     * abzurunden. Daher wird die Anlauflänge auf einen kleinen Absolutwert
     * gedeckelt; der tatsächliche Radius ergibt sich dann aus dieser
     * gedeckelten Anlauflänge (kann bei sehr spitzen Winkeln entsprechend
     * klein ausfallen – das ist unvermeidlich, wenn die Rundung spitzennah
     * bleiben soll).
     */
    static computeRoundedCorner(p1, vertex, p2, targetRadius, segments = 12) {
        const v1x = p1.x - vertex.x, v1y = p1.y - vertex.y;
        const v2x = p2.x - vertex.x, v2y = p2.y - vertex.y;
        const len1 = Math.hypot(v1x, v1y) || 1;
        const len2 = Math.hypot(v2x, v2y) || 1;
        const u1x = v1x / len1, u1y = v1y / len1;
        const u2x = v2x / len2, u2y = v2y / len2;

        const dot = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
        const angle = Math.acos(dot); // 0..π, Winkel zwischen den Schenkeln

        // Entartet (Schenkel (fast) parallel oder exakt gegenläufig) – keine
        // sinnvolle Rundung möglich, Scheitelpunkt selbst zurückgeben.
        if (angle < 0.01 || angle > Math.PI - 0.01) {
            return { start: vertex, end: vertex, points: [vertex] };
        }

        const MAX_RUN_UP_MM = 4; // spitzennahe Rundung, unabhängig von der Schenkellänge
        const maxRunUp = Math.min(MAX_RUN_UP_MM, len1 * 0.45, len2 * 0.45);
        const runUp = Math.min(targetRadius / Math.tan(angle / 2), maxRunUp);
        const actualRadius = runUp * Math.tan(angle / 2);

        const start = { x: vertex.x + u1x * runUp, y: vertex.y + u1y * runUp };
        const end = { x: vertex.x + u2x * runUp, y: vertex.y + u2y * runUp };

        // Bogenmittelpunkt entlang der Winkelhalbierenden
        let bx = u1x + u2x, by = u1y + u2y;
        const blen = Math.hypot(bx, by) || 1;
        bx /= blen; by /= blen;
        const centerDist = actualRadius / Math.sin(angle / 2);
        const center = { x: vertex.x + bx * centerDist, y: vertex.y + by * centerDist };

        const a1 = Math.atan2(start.y - center.y, start.x - center.x);
        const a2 = Math.atan2(end.y - center.y, end.x - center.x);

        let diff = a2 - a1;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;

        const points = [];
        for (let i = 0; i <= segments; i++) {
            const t = a1 + diff * (i / segments);
            points.push({ x: center.x + Math.cos(t) * actualRadius, y: center.y + Math.sin(t) * actualRadius });
        }

        return { start, end, points };
    }

    /**
     * Berechnet die Polar-Koordinaten (Länge und absoluten Winkel im Raum) zwischen zwei Punkten.
     */
    static getPolarCoordinates(p1, p2) {
        if (!p1 || !p2) return { length: 0, angleDeg: 0 };

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;

        const length = Math.sqrt(dx * dx + dy * dy);
        let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

        if (angleDeg < 0) {
            angleDeg += 360;
        }

        return { length, angleDeg };
    }

    /**
     * Verschiebt p2 entlang der bestehenden Richtung (von p1 aus), sodass der
     * Abstand zu p1 exakt newLength entspricht. Wird für das Bearbeiten einer
     * Schenkellänge per Label-Eingabe/-Sperre verwendet – p1 bleibt fest, p2
     * wird neu positioniert.
     */
    static pointAtLength(p1, p2, newLength) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.hypot(dx, dy) || 1;

        return {
            x: p1.x + (dx / dist) * newLength,
            y: p1.y + (dy / dist) * newLength
        };
    }

    /**
     * Rotiert p2 um vertex, sodass der Winkel zwischen (vertex->p1) und
     * (vertex->p2) exakt newAngleDeg entspricht – Abstand von p2 zu vertex
     * (und damit die Schenkellänge) bleibt dabei unverändert. Die bisherige
     * Drehrichtung (im/gegen Uhrzeigersinn) wird beibehalten, damit sich der
     * Schenkel nicht unerwartet auf die andere Seite umklappt. Wird für das
     * Bearbeiten eines Winkels per Label-Eingabe/-Sperre verwendet.
     */
    static pointAtAngle(p1, vertex, p2, newAngleDeg) {
        const baseAngle = Math.atan2(p1.y - vertex.y, p1.x - vertex.x);
        const currentAngle = Math.atan2(p2.y - vertex.y, p2.x - vertex.x);

        let diff = currentAngle - baseAngle;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const sign = diff >= 0 ? 1 : -1;

        const newAngleRad = (newAngleDeg * Math.PI) / 180;
        const newDirAngle = baseAngle + sign * newAngleRad;

        const dist = Math.hypot(p2.x - vertex.x, p2.y - vertex.y);

        return {
            x: vertex.x + Math.cos(newDirAngle) * dist,
            y: vertex.y + Math.sin(newDirAngle) * dist
        };
    }

    /**
     * Sammelt alle Punktindizes, die von farIndex aus über Segmente
     * erreichbar sind, OHNE dabei über pivotIndex zu laufen (pivotIndex
     * selbst ist nicht enthalten). Wird beim Bearbeiten einer Länge/eines
     * Winkels per Label-Eingabe verwendet, um den "nachfolgenden" Teil der
     * Profilkette zu ermitteln, der bei der Änderung starr mitbewegt werden
     * muss, damit bereits gezeichnete Längen/Winkel dahinter unverändert
     * bleiben (siehe applyLength/applyAngle in LabelEditController). Nutzt
     * eine Graph-Traversierung statt reiner Indexvergleiche, damit auch
     * Verzweigungen (mehrere Segmente ab einem Punkt) korrekt behandelt
     * werden.
     */
    static collectDownstreamPoints(profile, farIndex, pivotIndex) {
        const segments = profile.segments || [];
        const visited = new Set([pivotIndex]);
        const result = new Set();
        const stack = [farIndex];

        while (stack.length > 0) {
            const idx = stack.pop();
            if (visited.has(idx)) continue;
            visited.add(idx);
            result.add(idx);

            segments.forEach(seg => {
                if (seg.startIndex === idx && !visited.has(seg.endIndex)) stack.push(seg.endIndex);
                if (seg.endIndex === idx && !visited.has(seg.startIndex)) stack.push(seg.startIndex);
            });
        }

        return result;
    }

    /**
     * Rotiert point um center um deltaRad (Bogenmaß, mathematisch positiv =
     * gegen den Uhrzeigersinn).
     */
    static rotatePointAround(center, point, deltaRad) {
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        const cos = Math.cos(deltaRad);
        const sin = Math.sin(deltaRad);

        return {
            x: center.x + dx * cos - dy * sin,
            y: center.y + dx * sin + dy * cos
        };
    }

    /**
     * Bewegt Punkt ptIndex im Auswahl/Verschieben-Modus zu (proposedX,
     * proposedY), hält dabei aber gesperrte Längen (seg.lengthLocked +
     * seg.lockedLength) und gesperrte Winkel (seg.angleLocked +
     * seg.lockedAngle) exakt ein, an denen dieser Punkt beteiligt ist. Der
     * Punkt "rutscht" dann nur innerhalb der erlaubten Freiheitsgrade (siehe
     * Beispiel in der Feature-Anfrage: ein gesperrter Schenkel rotiert um
     * seinen fixen Nachbarpunkt, statt sich zu verlängern/verkürzen).
     *
     * Deckt die üblichen Einzel-Constraint-Fälle ab (ein Punkt ist Vorgänger-
     * oder Fernpunkt einer gesperrten Länge/eines gesperrten Winkels). Hat
     * ein Punkt mehrere gleichzeitige, voneinander unabhängige Sperren (z.B.
     * über zwei verschiedene Segmente), wird nur die erste gefundene
     * angewendet – ein vollständiger Mehrfach-Constraint-Solver ist hier
     * bewusst nicht implementiert.
     */
    static applyConstrainedDrag(profile, ptIndex, proposedX, proposedY) {
        const points = profile.points;
        const segments = profile.segments || [];
        const point = points[ptIndex];
        if (!point) return;

        // 1. Punkt ist der Scheitelpunkt eines gesperrten Winkels: Der ferne
        //    Punkt wird NICHT einfach starr mitverschoben (das würde den
        //    Winkel relativ zur Vorgänger-Linie verfälschen, sobald deren
        //    anderer Endpunkt nicht ebenfalls mitwandert), sondern nach dem
        //    Verschieben des Scheitelpunkts neu berechnet: gleicher
        //    Drehsinn + gleicher gesperrter Winkel relativ zur (neuen)
        //    Richtung zum Vorgänger-Punkt, gleicher Abstand wie zuvor (bzw.
        //    lockedLength, falls zusätzlich längengesperrt).
        const asVertexAngleLocks = segments
            .filter(seg => seg.angleLocked && seg.startIndex === ptIndex)
            .map(seg => {
                const farPoint = points[seg.endIndex];
                const prevSeg = segments.find(other =>
                    other !== seg && (other.startIndex === ptIndex || other.endIndex === ptIndex)
                );
                if (!farPoint || !prevSeg) return null;

                const refIndex = (prevSeg.startIndex === ptIndex) ? prevSeg.endIndex : prevSeg.startIndex;
                const refPoint = points[refIndex];
                if (!refPoint) return null;

                const oldBaseAngle = Math.atan2(refPoint.y - point.y, refPoint.x - point.x);
                const oldFarAngle = Math.atan2(farPoint.y - point.y, farPoint.x - point.x);
                let diff = oldFarAngle - oldBaseAngle;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                while (diff < -Math.PI) diff += 2 * Math.PI;
                const sign = diff >= 0 ? 1 : -1;

                const dist = seg.lengthLocked
                    ? seg.lockedLength
                    : Math.hypot(farPoint.x - point.x, farPoint.y - point.y);

                return { seg, farPoint, refPoint, sign, dist };
            })
            .filter(Boolean);

        if (asVertexAngleLocks.length > 0) {
            point.x = proposedX;
            point.y = proposedY;

            asVertexAngleLocks.forEach(({ seg, farPoint, refPoint, sign, dist }) => {
                const newBaseAngle = Math.atan2(refPoint.y - point.y, refPoint.x - point.x);
                const lockedAngleRad = (seg.lockedAngle * Math.PI) / 180;
                const dirAngle = newBaseAngle + sign * lockedAngleRad;

                farPoint.x = point.x + Math.cos(dirAngle) * dist;
                farPoint.y = point.y + Math.sin(dirAngle) * dist;
            });
            return;
        }

        // 2. Punkt ist der ferne Punkt eines gesperrten Winkels: um den
        //    Scheitelpunkt rotieren, Winkel bleibt exakt erhalten. Ist der
        //    gleiche Schenkel zusätzlich längengesperrt, bleibt auch die
        //    Länge fix (der Punkt kann sich dann gar nicht mehr bewegen).
        const asFarAngleLock = segments.find(seg => seg.angleLocked && seg.endIndex === ptIndex);
        if (asFarAngleLock) {
            const vertexIndex = asFarAngleLock.startIndex;
            const vertex = points[vertexIndex];
            const prevSeg = segments.find(other =>
                other !== asFarAngleLock && (other.startIndex === vertexIndex || other.endIndex === vertexIndex)
            );

            if (vertex && prevSeg) {
                const refPointIndex = (prevSeg.startIndex === vertexIndex) ? prevSeg.endIndex : prevSeg.startIndex;
                const refPoint = points[refPointIndex];

                if (refPoint) {
                    const baseAngle = Math.atan2(refPoint.y - vertex.y, refPoint.x - vertex.x);
                    const currentAngle = Math.atan2(point.y - vertex.y, point.x - vertex.x);
                    let diff = currentAngle - baseAngle;
                    while (diff > Math.PI) diff -= 2 * Math.PI;
                    while (diff < -Math.PI) diff += 2 * Math.PI;
                    const sign = diff >= 0 ? 1 : -1;

                    const lockedAngleRad = (asFarAngleLock.lockedAngle * Math.PI) / 180;
                    const dirAngle = baseAngle + sign * lockedAngleRad;

                    const dist = asFarAngleLock.lengthLocked
                        ? asFarAngleLock.lockedLength
                        : Math.hypot(proposedX - vertex.x, proposedY - vertex.y);

                    point.x = vertex.x + Math.cos(dirAngle) * dist;
                    point.y = vertex.y + Math.sin(dirAngle) * dist;
                    return;
                }
            }
        }

        // 3. Reine Längensperre (ohne Winkelsperre): Punkt rotiert um seinen
        //    gesperrten Nachbarpunkt, bleibt dabei exakt auf lockedLength.
        const lengthLockSeg = segments.find(seg =>
            seg.lengthLocked && (seg.startIndex === ptIndex || seg.endIndex === ptIndex)
        );
        if (lengthLockSeg) {
            const otherIndex = (lengthLockSeg.startIndex === ptIndex) ? lengthLockSeg.endIndex : lengthLockSeg.startIndex;
            const other = points[otherIndex];
            if (other) {
                const dx = proposedX - other.x;
                const dy = proposedY - other.y;
                const dist = Math.hypot(dx, dy) || 1;
                point.x = other.x + (dx / dist) * lengthLockSeg.lockedLength;
                point.y = other.y + (dy / dist) * lengthLockSeg.lockedLength;
                return;
            }
        }

        // 4. Keine Sperren betroffen: frei bewegen.
        point.x = proposedX;
        point.y = proposedY;
    }
}
