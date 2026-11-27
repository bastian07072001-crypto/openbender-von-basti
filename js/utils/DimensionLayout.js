import { Geometry } from './Geometry.js';

/**
 * Bemaßungs-Layout für 2D-Editor und PDF (gleiche Regeln in beiden
 * Ausgaben). Arbeitet komplett in Welt-Koordinaten (mm des Profils); die
 * Renderer rechnen nur noch in ihr Zielsystem um.
 *
 * - Längen: echte Maßlinie parallel zum Segment mit Hilfslinien und
 *   Pfeilen, Text horizontal an der Maßlinie.
 * - Winkel: Bogen mit Text; exakt 90° nur als Quadrat-Symbol ohne Zahl
 *   (ausser der Winkel ist gesperrt – dann mit Zahl, damit das Schloss
 *   sichtbar bleibt).
 * - Platzierung: Für jedes Maß werden mehrere Kandidaten erzeugt (Seite,
 *   gestaffelter Abstand, Text neben der Maßlinie bzw. Winkeltext weiter
 *   aussen) und nach Kollisionen mit Profil-Linien, Punkten, bereits
 *   platzierten Maßen und Texten bewertet; der beste gewinnt (greedy,
 *   kürzeste Segmente zuerst, da sie am wenigsten Platz haben). Wird ein
 *   Winkeltext von seinem Bogen weggeschoben, verbindet ihn eine
 *   Hinweislinie.
 *
 * opts (alles in Welt-Einheiten):
 *   textHeight, measure(text) -> Breite, decorate(text, locked) -> Anzeigetext,
 *   dimOffset, offsetStep, maxOffsetSteps, extGap, extOverhang, arrowSize,
 *   textGap, arcRadius(minLen), squareSize, pointRadius, foldOffset,
 *   backgroundPoints (optional: Punkte eines weiteren, im Hintergrund
 *   gezeichneten Profils mit denselben Segmenten – beim konischen Profil
 *   das andere Ende. Seine Linien gelten als Hindernis wie Profil-Linien,
 *   damit keine Maßlinie und kein Text darauf zu liegen kommt.)
 */
export class DimensionLayout {
    static compute(points, segments, opts) {
        const obstacles = { lines: [], rects: [], circles: [] };
        const result = { lengths: [], angles: [], labels: [] };
        if (!points || !segments || segments.length === 0) return result;

        const W_PROFILE = { text: 100, geom: 15 };
        const W_DIM = { text: 60, geom: 8 };
        let groupCounter = 0;
        const newGroup = () => ++groupCounter;
        // Mit Begrenzungsrechteck: schneller Vorab-Test in den Bewertungen
        const addLine = (a, b, w, g = newGroup()) => obstacles.lines.push({
            a, b, w, g,
            minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
            minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y)
        });

        // --- Hindernisse: gezeichnete Profil-Linien (inkl. Falz) und Punkte
        const fold = Geometry.computeFoldLayout(points, segments, opts.foldOffset);
        segments.forEach((seg, i) => {
            const a = Geometry.foldEndpoint(fold, i, seg.startIndex, points);
            const b = Geometry.foldEndpoint(fold, i, seg.endIndex, points);
            if (a && b) addLine(a, b, W_PROFILE);
        });
        fold.folds.forEach(f => {
            const g = newGroup();
            for (let i = 1; i < f.cap.length; i++) addLine(f.cap[i - 1], f.cap[i], W_PROFILE, g);
        });
        points.forEach(p => { if (p) obstacles.circles.push({ c: p, r: opts.pointRadius }); });

        if (opts.backgroundPoints) {
            const bgPoints = opts.backgroundPoints;
            const bgFold = Geometry.computeFoldLayout(bgPoints, segments, opts.foldOffset);
            segments.forEach((seg, i) => {
                const a = Geometry.foldEndpoint(bgFold, i, seg.startIndex, bgPoints);
                const b = Geometry.foldEndpoint(bgFold, i, seg.endIndex, bgPoints);
                if (a && b) addLine(a, b, W_PROFILE);
            });
            bgFold.folds.forEach(f => {
                const g = newGroup();
                for (let i = 1; i < f.cap.length; i++) addLine(f.cap[i - 1], f.cap[i], W_PROFILE, g);
            });
        }

        // --- Winkel: Bögen/Quadrate sind fix und werden sofort Hindernisse
        const angleItems = this.collectAngles(points, segments);
        angleItems.forEach(item => {
            const { vertex, u1, u2, minLen, angle, locked } = item;
            const isRight = Math.round(angle) === 90;

            if (isRight) {
                const s = Math.min(opts.squareSize, minLen * 0.35);
                const q1 = add(vertex, mul(u1, s));
                const q3 = add(vertex, mul(u2, s));
                const q2 = add(q1, mul(u2, s));
                item.square = [q1, q2, q3];
                const g = newGroup();
                addLine(q1, q2, W_DIM, g);
                addLine(q2, q3, W_DIM, g);
                item.group = g;
                item.anchor = add(vertex, mul(add(u1, u2), s / 2));
                item.showText = locked;
                item.hitBox = { x: item.anchor.x, y: item.anchor.y, width: s * 1.6, height: s * 1.6 };
            } else {
                const r = opts.arcRadius(minLen);
                const a1 = Math.atan2(u1.y, u1.x);
                let diff = Math.atan2(u2.y, u2.x) - a1;
                while (diff < -Math.PI) diff += Math.PI * 2;
                while (diff > Math.PI) diff -= Math.PI * 2;
                const arc = [];
                const n = 16;
                for (let i = 0; i <= n; i++) {
                    const t = a1 + diff * (i / n);
                    arc.push({ x: vertex.x + Math.cos(t) * r, y: vertex.y + Math.sin(t) * r });
                }
                const g = newGroup();
                for (let i = 1; i < arc.length; i++) addLine(arc[i - 1], arc[i], W_DIM, g);
                item.group = g;
                item.arc = arc;
                item.radius = r;
                item.anchor = arc[n / 2];
                item.showText = true;
            }
        });

        // --- Längen: kürzeste zuerst
        // Die Maßlinie hängt an der GEZEICHNETEN Linie (bei Umschlägen die
        // schematisch versetzte Falz-Linie), damit sie parallel dazu steht;
        // der Maß-Wert bleibt die echte Länge zwischen den Profilpunkten.
        const lengthItems = segments
            .map((seg, segmentIndex) => ({
                seg, segmentIndex,
                length: Geometry.distance(points[seg.startIndex], points[seg.endIndex]),
                p1: Geometry.foldEndpoint(fold, segmentIndex, seg.startIndex, points),
                p2: Geometry.foldEndpoint(fold, segmentIndex, seg.endIndex, points)
            }))
            .filter(it => it.p1 && it.p2 && Geometry.distance(it.p1, it.p2) > 1e-6)
            .sort((a, b) => a.length - b.length);

        const centroid = this.centroid(points);

        lengthItems.forEach(({ seg, segmentIndex, length, p1, p2 }) => {
            const baseText = `${Math.round(length)} mm`;
            const text = opts.decorate(baseText, !!seg.lengthLocked);
            const width = opts.measure(text);
            const height = opts.textHeight;

            const u = unit(sub(p2, p1));
            const nLeft = { x: -u.y, y: u.x };
            const mid = mul(add(p1, p2), 0.5);
            const preferredSide = dot(sub(mid, centroid), nLeft) >= 0 ? 1 : -1;

            const arrowsInside = length > opts.arrowSize * 3;
            let best = null;

            for (const side of [preferredSide, -preferredSide]) {
                const n = mul(nLeft, side);
                const hN = halfExtent(width, height, n);
                const hU = halfExtent(width, height, u);

                for (let k = 0; k <= opts.maxOffsetSteps; k++) {
                    const d = opts.dimOffset + k * opts.offsetStep;
                    const A = add(p1, mul(n, d));
                    const B = add(p2, mul(n, d));
                    const ext1 = [add(p1, mul(n, opts.extGap)), add(p1, mul(n, d + opts.extOverhang))];
                    const ext2 = [add(p2, mul(n, opts.extGap)), add(p2, mul(n, d + opts.extOverhang))];
                    const beyond = (arrowsInside ? opts.arrowSize : opts.arrowSize * 2) + opts.textGap;

                    const modes = [
                        { mode: 'center', center: add(add(mid, mul(n, d)), mul(n, opts.textGap + hN)), extra: 0 },
                        { mode: 'end', center: add(add(B, mul(u, beyond + hU)), mul(n, opts.textGap + hN)), extra: 8 },
                        { mode: 'start', center: add(add(A, mul(u, -(beyond + hU))), mul(n, opts.textGap + hN)), extra: 8 }
                    ];

                    for (const m of modes) {
                        let dimLine = [A, B];
                        if (m.mode === 'end') dimLine = [A, add(B, mul(u, beyond + 2 * hU))];
                        if (m.mode === 'start') dimLine = [add(A, mul(u, -(beyond + 2 * hU))), B];
                        if (!arrowsInside && m.mode === 'center') {
                            dimLine = [add(A, mul(u, -opts.arrowSize * 2)), add(B, mul(u, opts.arrowSize * 2))];
                        }

                        // Leistung: Kollisionen sind nie negativ – erreicht schon der
                        // feste Anteil die beste Bewertung, kann die Variante nicht
                        // mehr gewinnen (Ergebnis identisch, nur schneller).
                        const fixed = k * 5 + m.extra + (side === preferredSide ? 0 : 2);
                        if (best && fixed >= best.score) continue;

                        const rect = { x: m.center.x, y: m.center.y, width, height };
                        const geomLines = [dimLine, ext1, ext2];
                        let score = fixed + this.scoreRect(rect, obstacles, opts);
                        if (best && score >= best.score) continue;
                        score += this.scoreDimLineCrossings(dimLine, obstacles, opts, W_PROFILE);
                        if (best && score >= best.score) continue;
                        score += this.scoreGeometry(geomLines, obstacles, opts);

                        if (!best || score < best.score) {
                            best = { score, rect, geomLines, A, B, n, u, arrowsInside };
                        }
                    }
                }
            }

            const arrows = best.arrowsInside
                ? [{ tip: best.A, dir: mul(best.u, -1) }, { tip: best.B, dir: best.u }]
                : [{ tip: best.A, dir: best.u }, { tip: best.B, dir: mul(best.u, -1) }];

            const label = {
                text, x: best.rect.x, y: best.rect.y, width, height,
                type: 'length', segmentIndex, locked: !!seg.lengthLocked
            };

            const g = newGroup();
            best.geomLines.forEach(([a, b]) => addLine(a, b, W_DIM, g));
            obstacles.rects.push(best.rect);

            result.lengths.push({ segmentIndex, lines: best.geomLines, arrows, label });
            result.labels.push(label);
        });

        // --- Winkel-Texte (Bögen sind schon Hindernisse)
        angleItems.forEach(item => {
            const { vertex, u1, u2, angle, locked, vertexIndex, angleSegmentIndex } = item;
            const entry = { vertexIndex, arc: item.arc || null, square: item.square || null, leader: null, label: null };

            if (!item.showText) {
                const hit = {
                    text: '', ...item.hitBox, type: 'angle', hitOnly: true,
                    vertexIndex, angleSegmentIndex, locked
                };
                entry.label = hit;
                result.labels.push(hit);
                result.angles.push(entry);
                return;
            }

            const text = opts.decorate(`${Math.round(angle)}°`, locked);
            const width = opts.measure(text);
            const height = opts.textHeight;

            let bis = add(u1, u2);
            bis = Math.hypot(bis.x, bis.y) < 1e-6 ? { x: -u1.y, y: u1.x } : unit(bis);
            const baseR = item.radius || Math.hypot(item.anchor.x - vertex.x, item.anchor.y - vertex.y);

            const dirs = [
                { v: bis, pen: 0 },
                { v: rotate(bis, 0.6), pen: 3 }, { v: rotate(bis, -0.6), pen: 3 },
                { v: mul(bis, -1), pen: 6 },
                { v: rotate(bis, Math.PI - 0.6), pen: 8 }, { v: rotate(bis, Math.PI + 0.6), pen: 8 }
            ];

            // Hinweislinie vom Bogen zum Text, sobald der Text nicht mehr
            // direkt am Bogen liegt – fliesst in die Bewertung ein, damit sie
            // keine Profil-Linien oder andere Hinweislinien kreuzt.
            const leaderFor = (rect, k, pen) => {
                if (k === 0 && pen === 0) return null;
                const target = nearestPointOnRect(item.anchor, rect);
                return Geometry.distance(item.anchor, target) > opts.textGap * 1.5 ? [item.anchor, target] : null;
            };

            let best = null;
            for (let k = 0; k <= 4; k++) {
                for (const dir of dirs) {
                    const dist = baseR + opts.textGap + halfExtent(width, height, dir.v) + k * height * 1.2;
                    const c = add(vertex, mul(dir.v, dist));
                    const fixed = k * 6 + dir.pen;
                    if (best && fixed >= best.score) continue; // kann nicht mehr gewinnen
                    const rect = { x: c.x, y: c.y, width, height };
                    const leader = leaderFor(rect, k, dir.pen);
                    let score = fixed + this.scoreRect(rect, obstacles, opts);
                    if (best && score >= best.score) continue;
                    if (leader) score += this.scoreGeometry([leader], obstacles, opts, new Set([item.group]), opts.textGap * 1.5);
                    if (!best || score < best.score) best = { score, rect, leader };
                }
            }

            const label = {
                text, x: best.rect.x, y: best.rect.y, width, height,
                type: 'angle', vertexIndex, angleSegmentIndex, locked
            };

            if (best.leader) {
                entry.leader = best.leader;
                addLine(best.leader[0], best.leader[1], W_DIM);
            }

            obstacles.rects.push(best.rect);
            entry.label = label;
            result.labels.push(label);
            result.angles.push(entry);
        });

        return result;
    }

    // Winkel an Punkten mit genau zwei Segmenten, ohne Falz-Scheitelpunkte
    // von Umschlägen (dort wird schematisch gefaltet, der Winkel ist ohne
    // Aussage). Mittelrippen-Sonderfall (Basis selbst Umschlag) gilt als
    // normale Ecke. Der Sperrstatus liegt auf seg2 (siehe LabelEditController).
    static collectAngles(points, segments) {
        const isRenderableHem = (seg) => {
            if (!seg || seg.type !== 'hem') return false;
            const base = Geometry.getHemBaseSegment(segments, seg);
            return !!base && base.type !== 'hem';
        };

        const items = [];
        points.forEach((vertex, vertexIndex) => {
            if (!vertex) return;
            const connected = segments.filter(s => s.startIndex === vertexIndex || s.endIndex === vertexIndex);
            if (connected.length !== 2) return;
            const [seg1, seg2] = connected;
            if ((seg1.hemVertexIndex === vertexIndex && isRenderableHem(seg1)) ||
                (seg2.hemVertexIndex === vertexIndex && isRenderableHem(seg2))) return;

            const p1 = points[seg1.startIndex === vertexIndex ? seg1.endIndex : seg1.startIndex];
            const p2 = points[seg2.startIndex === vertexIndex ? seg2.endIndex : seg2.startIndex];
            if (!p1 || !p2) return;

            const len1 = Geometry.distance(p1, vertex);
            const len2 = Geometry.distance(p2, vertex);
            if (len1 < 1e-6 || len2 < 1e-6) return;

            const u1 = unit(sub(p1, vertex));
            const u2 = unit(sub(p2, vertex));
            const angle = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2)))) * 180 / Math.PI;

            items.push({
                vertex, vertexIndex, u1, u2, angle,
                minLen: Math.min(len1, len2),
                angleSegmentIndex: segments.indexOf(seg2),
                locked: !!seg2.angleLocked
            });
        });
        return items;
    }

    static scoreRect(rect, obstacles, opts) {
        const pad = opts.textGap * 0.5;
        const box = { x: rect.x, y: rect.y, width: rect.width + pad * 2, height: rect.height + pad * 2 };
        let score = 0;
        const hitGroups = new Set();
        const bx0 = box.x - box.width / 2, bx1 = box.x + box.width / 2;
        const by0 = box.y - box.height / 2, by1 = box.y + box.height / 2;
        obstacles.lines.forEach(l => {
            if (l.maxX < bx0 || l.minX > bx1 || l.maxY < by0 || l.minY > by1) return; // weit weg
            if (!hitGroups.has(l.g) && segmentHitsRect(l.a, l.b, box)) { hitGroups.add(l.g); score += l.w.text; }
        });
        obstacles.rects.forEach(r => { if (rectsOverlap(box, r)) score += 100; });
        obstacles.circles.forEach(c => { if (circleHitsRect(c.c, c.r, box)) score += 100; });
        return score;
    }

    static scoreGeometry(lines, obstacles, opts, ignoreGroups = null, tol = opts.extGap * 0.6) {
        let score = 0;
        const hitGroups = new Set(ignoreGroups || []);
        const hitRects = new Set();
        lines.forEach(([a, b]) => {
            const x0 = Math.min(a.x, b.x) - tol, x1 = Math.max(a.x, b.x) + tol;
            const y0 = Math.min(a.y, b.y) - tol, y1 = Math.max(a.y, b.y) + tol;
            obstacles.lines.forEach(l => {
                if (l.maxX < x0 || l.minX > x1 || l.maxY < y0 || l.minY > y1) return; // weit weg
                if (!hitGroups.has(l.g) && segmentDistance(a, b, l.a, l.b) < tol) { hitGroups.add(l.g); score += l.w.geom; }
            });
            obstacles.rects.forEach(r => {
                if (r.x + r.width / 2 < x0 || r.x - r.width / 2 > x1 || r.y + r.height / 2 < y0 || r.y - r.height / 2 > y1) return;
                if (!hitRects.has(r) && segmentHitsRect(a, b, r)) { hitRects.add(r); score += 50; }
            });
        });
        return score;
    }

    // Eine Maßlinie, die eine Profil-Linie kreuzt, ist sehr störend – das
    // wird separat und streng bewertet (nicht mit den Hilfslinien
    // zusammengefasst, die an Ecken zwangsläufig Nachbar-Linien berühren).
    // Die Enden der Maßlinie (Pfeilspitzen) sind ausgenommen, damit eine
    // Maßlinie, die genau auf einer anschliessenden Linie endet, nicht zählt.
    static scoreDimLineCrossings([a, b], obstacles, opts, profileWeight) {
        const len = Geometry.distance(a, b);
        if (len <= opts.arrowSize * 2) return 0;
        const u = unit(sub(b, a));
        const a2 = add(a, mul(u, opts.arrowSize));
        const b2 = add(b, mul(u, -opts.arrowSize));
        const tol = opts.extGap * 0.6;
        const x0 = Math.min(a2.x, b2.x) - tol, x1 = Math.max(a2.x, b2.x) + tol;
        const y0 = Math.min(a2.y, b2.y) - tol, y1 = Math.max(a2.y, b2.y) + tol;
        const hit = new Set();
        obstacles.lines.forEach(l => {
            if (l.w !== profileWeight || l.maxX < x0 || l.minX > x1 || l.maxY < y0 || l.minY > y1) return;
            if (!hit.has(l.g) && segmentDistance(a2, b2, l.a, l.b) < tol) hit.add(l.g);
        });
        return hit.size * 60;
    }

    static centroid(points) {
        const valid = points.filter(Boolean);
        const sum = valid.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
        return { x: sum.x / (valid.length || 1), y: sum.y / (valid.length || 1) };
    }
}

// --- Vektor-/Kollisions-Helfer
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const unit = (a) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
const rotate = (a, rad) => ({ x: a.x * Math.cos(rad) - a.y * Math.sin(rad), y: a.x * Math.sin(rad) + a.y * Math.cos(rad) });

// Halbe Ausdehnung einer (achsparallelen) Textbox in Richtung v
const halfExtent = (w, h, v) => Math.abs(v.x) * w / 2 + Math.abs(v.y) * h / 2;

function rectsOverlap(a, b) {
    return Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2;
}

function circleHitsRect(c, r, rect) {
    const nx = Math.max(rect.x - rect.width / 2, Math.min(c.x, rect.x + rect.width / 2));
    const ny = Math.max(rect.y - rect.height / 2, Math.min(c.y, rect.y + rect.height / 2));
    return Math.hypot(c.x - nx, c.y - ny) < r;
}

function nearestPointOnRect(p, rect) {
    return {
        x: Math.max(rect.x - rect.width / 2, Math.min(p.x, rect.x + rect.width / 2)),
        y: Math.max(rect.y - rect.height / 2, Math.min(p.y, rect.y + rect.height / 2))
    };
}

function segmentHitsRect(a, b, rect) {
    const x0 = rect.x - rect.width / 2, x1 = rect.x + rect.width / 2;
    const y0 = rect.y - rect.height / 2, y1 = rect.y + rect.height / 2;
    const inside = (p) => p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1;
    if (inside(a) || inside(b)) return true;
    const c = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    for (let i = 0; i < 4; i++) {
        if (segmentsIntersect(a, b, c[i], c[(i + 1) % 4])) return true;
    }
    return false;
}

function segmentsIntersect(p1, p2, p3, p4) {
    const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function pointSegmentDistance(p, a, b) {
    const ab = sub(b, a);
    const len2 = dot(ab, ab);
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
    return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t));
}

function segmentDistance(a, b, c, d) {
    if (segmentsIntersect(a, b, c, d)) return 0;
    return Math.min(
        pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
        pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b)
    );
}
