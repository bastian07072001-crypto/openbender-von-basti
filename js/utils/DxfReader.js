/**
 * DXF lesen und in geschlossene Konturen pro Layer zerlegen (für Module:
 * api.dxf.read). Gegenstück zu DxfWriter.
 *
 * Unterstützt: LINE, ARC, CIRCLE, LWPOLYLINE und POLYLINE/VERTEX (mit Bulge),
 * POINT, TEXT/MTEXT (nur Inhalt und Lage), INSERT von Blöcken (Verschieben,
 * Drehen, gleichmässig Skalieren, Spiegeln). Formate R12 bis 2018, wie sie
 * QCad, LibreCAD, FreeCAD und AutoCAD schreiben. Gespiegelte Objekte
 * (Extrusionsrichtung 0/0/−1) werden in Weltkoordinaten umgerechnet.
 * Nicht unterstützt (mit Warnung): SPLINE, ELLIPSE, HATCH, 3D-Objekte.
 *
 * Alle Linien und Bögen eines Layers werden über gemeinsame Endpunkte
 * (Toleranz) zu Zügen verbunden. Ergebnis pro Layer:
 *   loops:    geschlossene Konturen [{ points: [{ x, y, bulge }], area }],
 *             immer im Gegenuhrzeigersinn (area > 0); bulge gilt für das
 *             Stück zum nächsten Punkt (wie DxfWriter)
 *   open:     offene Züge [{ points, start, end }] – meist ein Zeichenfehler
 *   branches: Punkte, an denen mehr als zwei Linien zusammenkommen
 *   points:   POINT-Objekte; texts: [{ text, x, y }]
 * Einheiten: $INSUNITS wird auf mm umgerechnet (Zoll, cm, m); fehlt die
 * Angabe, gilt mm.
 */

const UNIT_TO_MM = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };
const UNIT_NAMES = { 0: 'ohne Angabe (mm angenommen)', 1: 'Zoll', 2: 'Fuss', 4: 'mm', 5: 'cm', 6: 'm' };
const UNSUPPORTED = new Set(['SPLINE', 'ELLIPSE', 'HATCH', '3DFACE', '3DSOLID', 'REGION', 'BODY', 'MESH', 'SOLID', 'TRACE']);

export class DxfReader {
    /**
     * text: Inhalt der DXF-Datei. opts.tolerance: Abstand in mm, bis zu dem
     * zwei Endpunkte als verbunden gelten (Standard 0.01).
     */
    static read(text, opts = {}) {
        const tolerance = opts.tolerance > 0 ? opts.tolerance : 0.01;
        const warnings = [];
        const pairs = this.pairs(String(text || ''));
        const { header, blocks, entities } = this.sections(pairs);

        const unitCode = Number(header.$INSUNITS) || 0;
        const scale = UNIT_TO_MM[unitCode] || 1;
        if (!(unitCode in UNIT_TO_MM)) warnings.push(`Unbekannte Einheit ($INSUNITS = ${unitCode}), mm angenommen`);

        // Geometrie sammeln (Blöcke aufgelöst, in mm)
        const layers = {};
        const layer = (name) => {
            const key = String(name || '0').toUpperCase();
            if (!layers[key]) layers[key] = { edges: [], points: [], texts: [] };
            return layers[key];
        };
        const unsupported = {};
        const base = { m: [scale, 0, 0, scale, 0, 0], layer: null, depth: 0 };
        this.collect(entities, base, blocks, layer, unsupported, warnings);
        Object.entries(unsupported).forEach(([type, list]) => {
            warnings.push(`${list.count}× ${type} nicht unterstützt (Layer ${[...list.layers].join(', ')}) – bitte in Linien und Bögen umwandeln`);
        });

        const result = {};
        Object.entries(layers).forEach(([name, data]) => {
            const chains = this.chain(data.edges, tolerance);
            result[name] = {
                loops: chains.loops,
                open: chains.open,
                branches: chains.branches,
                points: data.points,
                texts: data.texts
            };
        });
        return { units: UNIT_NAMES[unitCode] || `Code ${unitCode}`, layers: result, warnings };
    }

    // --- Datei zerlegen ------------------------------------------------------

    static pairs(text) {
        const lines = text.split(/\r\n|\r|\n/);
        const out = [];
        for (let i = 0; i + 1 < lines.length; i += 2) {
            const code = parseInt(lines[i].trim(), 10);
            if (Number.isNaN(code)) continue;
            out.push([code, lines[i + 1].trim()]);
        }
        return out;
    }

    /** Header-Variablen, Blöcke { name: [Objekte] } und Objekte der ENTITIES-Section */
    static sections(pairs) {
        const header = {};
        const blocks = {};
        let entities = [];
        let i = 0;
        while (i < pairs.length) {
            if (pairs[i][0] === 0 && pairs[i][1] === 'SECTION' && pairs[i + 1] && pairs[i + 1][0] === 2) {
                const name = pairs[i + 1][1];
                let j = i + 2;
                const start = j;
                while (j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1] === 'ENDSEC')) j++;
                const body = pairs.slice(start, j);
                if (name === 'HEADER') {
                    let variable = null;
                    body.forEach(([code, value]) => {
                        if (code === 9) variable = value;
                        else if (variable && !(variable in header)) header[variable] = value;
                    });
                } else if (name === 'BLOCKS') {
                    this.parseBlocks(body, blocks);
                } else if (name === 'ENTITIES') {
                    entities = this.objects(body);
                }
                i = j + 1;
            } else {
                i++;
            }
        }
        return { header, blocks, entities };
    }

    /** Folge von Gruppen in Objekte { type, codes: [[code, wert]] } (POLYLINE mit VERTEX zusammengefasst) */
    static objects(body) {
        const list = [];
        let current = null;
        body.forEach(([code, value]) => {
            if (code === 0) {
                current = { type: value, codes: [] };
                list.push(current);
            } else if (current) {
                current.codes.push([code, value]);
            }
        });
        // POLYLINE … VERTEX … SEQEND zu einem Objekt
        const out = [];
        for (let k = 0; k < list.length; k++) {
            const o = list[k];
            if (o.type === 'POLYLINE') {
                o.vertices = [];
                k++;
                while (k < list.length && list[k].type === 'VERTEX') o.vertices.push(list[k++]);
                // k steht auf SEQEND (oder dem nächsten Objekt)
                if (k < list.length && list[k].type !== 'SEQEND') k--;
                out.push(o);
            } else if (o.type !== 'SEQEND' && o.type !== 'VERTEX') {
                out.push(o);
            }
        }
        return out;
    }

    static parseBlocks(body, blocks) {
        let k = 0;
        while (k < body.length) {
            if (body[k][0] === 0 && body[k][1] === 'BLOCK') {
                let name = '';
                let bx = 0, by = 0;
                k++;
                while (k < body.length && body[k][0] !== 0) {
                    const [code, value] = body[k];
                    if (code === 2) name = value;
                    else if (code === 10) bx = parseFloat(value) || 0;
                    else if (code === 20) by = parseFloat(value) || 0;
                    k++;
                }
                const start = k;
                while (k < body.length && !(body[k][0] === 0 && body[k][1] === 'ENDBLK')) k++;
                blocks[name] = { base: { x: bx, y: by }, entities: this.objects(body.slice(start, k)) };
            }
            k++;
        }
    }

    // --- Geometrie -----------------------------------------------------------

    static get(o, code, fallback = 0) {
        const hit = o.codes.find(c => c[0] === code);
        return hit ? parseFloat(hit[1]) : fallback;
    }

    static str(o, code, fallback = '') {
        const hit = o.codes.find(c => c[0] === code);
        return hit ? hit[1] : fallback;
    }

    /**
     * Objekte mit Transformation ctx.m = [a, b, c, d, e, f] (x' = a·x + c·y + e,
     * y' = b·x + d·y + f) in die Layer übernehmen. Objekte auf Layer "0" in
     * einem Block erben den Layer des INSERT.
     */
    static collect(entities, ctx, blocks, layer, unsupported, warnings) {
        entities.forEach(o => {
            let layerName = this.str(o, 8, '0');
            if (ctx.layer && (layerName === '0' || layerName === '')) layerName = ctx.layer;
            const target = () => layer(layerName);
            // Spiegelung über die Extrusionsrichtung (Objekt-Koordinatensystem)
            const flip = this.get(o, 230, 1) < 0;
            const ocs = (x, y) => (flip ? { x: -x, y } : { x, y });
            const tr = (p) => this.apply(ctx.m, p);
            const mirrored = (ctx.m[0] * ctx.m[3] - ctx.m[1] * ctx.m[2]) < 0;
            const bulgeSign = (flip ? -1 : 1) * (mirrored ? -1 : 1);

            switch (o.type) {
                case 'LINE': {
                    const a = tr({ x: this.get(o, 10), y: this.get(o, 20) });
                    const b = tr({ x: this.get(o, 11), y: this.get(o, 21) });
                    target().edges.push({ a, b, bulge: 0 });
                    break;
                }
                case 'ARC':
                case 'CIRCLE': {
                    const c = ocs(this.get(o, 10), this.get(o, 20));
                    const r = this.get(o, 40);
                    if (!(r > 0)) break;
                    if (!this.uniform(ctx.m)) {
                        warnings.push(`${o.type} auf Layer ${layerName} in einem ungleichmässig skalierten Block – ausgelassen`);
                        break;
                    }
                    let s = o.type === 'CIRCLE' ? 0 : this.get(o, 50);
                    let e = o.type === 'CIRCLE' ? 360 : this.get(o, 51);
                    if (flip) [s, e] = [180 - e, 180 - s];
                    let sweep = ((e - s) % 360 + 360) % 360;
                    if (o.type === 'CIRCLE' || sweep < 1e-9) sweep = 360;
                    // Bögen über 180° in zwei Hälften (Bulge bleibt gut rechenbar)
                    const parts = sweep > 180 ? 2 : 1;
                    for (let k = 0; k < parts; k++) {
                        const a0 = (s + sweep * k / parts) * Math.PI / 180;
                        const a1 = (s + sweep * (k + 1) / parts) * Math.PI / 180;
                        const pa = tr({ x: c.x + r * Math.cos(a0), y: c.y + r * Math.sin(a0) });
                        const pb = tr({ x: c.x + r * Math.cos(a1), y: c.y + r * Math.sin(a1) });
                        const bulge = Math.tan((a1 - a0) / 4) * (mirrored ? -1 : 1);
                        target().edges.push({ a: pa, b: pb, bulge });
                    }
                    break;
                }
                case 'LWPOLYLINE': {
                    const closed = (this.get(o, 70) & 1) === 1;
                    const pts = [];
                    o.codes.forEach(([code, value]) => {
                        if (code === 10) pts.push({ x: parseFloat(value), y: 0, bulge: 0 });
                        else if (code === 20 && pts.length) pts[pts.length - 1].y = parseFloat(value);
                        else if (code === 42 && pts.length) pts[pts.length - 1].bulge = parseFloat(value) || 0;
                    });
                    this.addPolyline(target(), pts.map(p => ({ ...tr(ocs(p.x, p.y)), bulge: p.bulge * bulgeSign })), closed);
                    break;
                }
                case 'POLYLINE': {
                    const flags = this.get(o, 70);
                    if (flags & (8 | 16 | 64)) {
                        const key = '3D-POLYLINE/NETZ';
                        unsupported[key] = unsupported[key] || { count: 0, layers: new Set() };
                        unsupported[key].count++;
                        unsupported[key].layers.add(layerName);
                        break;
                    }
                    const pts = (o.vertices || []).map(v => ({
                        ...tr(ocs(this.get(v, 10), this.get(v, 20))),
                        bulge: (this.get(v, 42) || 0) * bulgeSign
                    }));
                    this.addPolyline(target(), pts, (flags & 1) === 1);
                    break;
                }
                case 'POINT':
                    target().points.push(tr({ x: this.get(o, 10), y: this.get(o, 20) }));
                    break;
                case 'TEXT':
                case 'MTEXT': {
                    const p = tr({ x: this.get(o, 10), y: this.get(o, 20) });
                    target().texts.push({ text: this.str(o, 1), x: p.x, y: p.y });
                    break;
                }
                case 'INSERT': {
                    const blk = blocks[this.str(o, 2)];
                    if (!blk) break;
                    if (ctx.depth > 8) {
                        warnings.push('Blöcke zu tief verschachtelt – ausgelassen');
                        break;
                    }
                    const sx = this.get(o, 41, 1), sy = this.get(o, 42, 1);
                    const rot = this.get(o, 50) * Math.PI / 180;
                    const ip = ocs(this.get(o, 10), this.get(o, 20));
                    const cos = Math.cos(rot), sin = Math.sin(rot);
                    // Block: Basispunkt abziehen, skalieren, drehen, an den Einfügepunkt
                    let local = [sx * cos, sx * sin, -sy * sin, sy * cos, 0, 0];
                    local[4] = ip.x - (local[0] * blk.base.x + local[2] * blk.base.y);
                    local[5] = ip.y - (local[1] * blk.base.x + local[3] * blk.base.y);
                    if (flip) local = this.multiply([-1, 0, 0, 1, 0, 0], local);
                    this.collect(blk.entities, { m: this.multiply(ctx.m, local), layer: layerName, depth: ctx.depth + 1 },
                        blocks, layer, unsupported, warnings);
                    break;
                }
                default:
                    if (UNSUPPORTED.has(o.type)) {
                        unsupported[o.type] = unsupported[o.type] || { count: 0, layers: new Set() };
                        unsupported[o.type].count++;
                        unsupported[o.type].layers.add(layerName);
                    }
            }
        });
    }

    static addPolyline(target, pts, closed) {
        // Wiederholter Startpunkt am Ende (z.B. von DxfWriter) nicht doppelt zählen
        if (closed && pts.length > 2) {
            const f = pts[0], l = pts[pts.length - 1];
            if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-9) pts = pts.slice(0, -1);
        }
        const n = closed ? pts.length : pts.length - 1;
        for (let k = 0; k < n; k++) {
            const a = pts[k], b = pts[(k + 1) % pts.length];
            target.edges.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, bulge: a.bulge || 0 });
        }
    }

    static apply(m, p) {
        return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
    }

    static multiply(m, n) {
        return [
            m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
            m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
            m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
        ];
    }

    static uniform(m) {
        const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
        return Math.abs(sx - sy) < 1e-9 * Math.max(1, sx) && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-9 * Math.max(1, sx * sy);
    }

    // --- Züge bilden ---------------------------------------------------------

    /**
     * Kanten { a, b, bulge } über gemeinsame Endpunkte zu geschlossenen und
     * offenen Zügen verbinden. Endpunkte näher als tolerance gelten als
     * derselbe Knoten (Gitter-Suche).
     */
    static chain(edges, tolerance) {
        edges = edges.filter(e => Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) > 1e-9);
        const nodes = [];
        const grid = new Map();
        const cell = (v) => Math.floor(v / tolerance);
        const nodeFor = (p) => {
            const cx = cell(p.x), cy = cell(p.y);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const list = grid.get(`${cx + dx},${cy + dy}`);
                    if (!list) continue;
                    const hit = list.find(i => Math.hypot(nodes[i].x - p.x, nodes[i].y - p.y) <= tolerance);
                    if (hit !== undefined) return hit;
                }
            }
            nodes.push({ x: p.x, y: p.y, edges: [] });
            const key = `${cx},${cy}`;
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(nodes.length - 1);
            return nodes.length - 1;
        };
        edges.forEach((e, i) => {
            e.na = nodeFor(e.a);
            e.nb = nodeFor(e.b);
            nodes[e.na].edges.push(i);
            nodes[e.nb].edges.push(i);
        });

        const used = new Set();
        const walk = (startNode) => {
            const points = [];
            let node = startNode;
            for (;;) {
                const next = nodes[node].edges.find(i => !used.has(i));
                if (next === undefined) break;
                used.add(next);
                const e = edges[next];
                const forward = e.na === node;
                points.push({ x: nodes[node].x, y: nodes[node].y, bulge: forward ? e.bulge : -e.bulge });
                node = forward ? e.nb : e.na;
            }
            points.push({ x: nodes[node].x, y: nodes[node].y, bulge: 0 });
            return { points, end: node };
        };

        const open = [];
        const loops = [];
        // Zuerst offene Züge von Enden aus (Knoten mit ungerader Anzahl Kanten)
        nodes.forEach((n, i) => {
            if (n.edges.length % 2 === 1) {
                while (n.edges.some(k => !used.has(k))) {
                    const { points } = walk(i);
                    if (points.length < 2) break;
                    open.push({ points, start: { x: points[0].x, y: points[0].y }, end: { x: points[points.length - 1].x, y: points[points.length - 1].y } });
                }
            }
        });
        // Übrig: geschlossene Züge
        edges.forEach((e, i) => {
            if (used.has(i)) return;
            const { points, end } = walk(e.na);
            if (end === e.na && points.length > 2) {
                points.pop();
                loops.push(this.orient(points));
            } else {
                open.push({ points, start: { x: points[0].x, y: points[0].y }, end: { x: points[points.length - 1].x, y: points[points.length - 1].y } });
            }
        });
        const branches = nodes.filter(n => n.edges.length > 2).map(n => ({ x: n.x, y: n.y, count: n.edges.length }));
        return { loops, open, branches };
    }

    /** Geschlossene Kontur im Gegenuhrzeigersinn mit Fläche */
    static orient(points) {
        let area = this.area(points);
        if (area < 0) {
            const n = points.length;
            const rev = [];
            for (let k = n - 1; k >= 0; k--) {
                // Bulge gehört zum Stück k-1 → k, rückwärts also zu k → k-1
                const prev = points[(k - 1 + n) % n];
                rev.push({ x: points[k].x, y: points[k].y, bulge: -prev.bulge });
            }
            points = rev;
            area = -area;
        }
        return { points, area };
    }

    /** Vorzeichenbehaftete Fläche einer geschlossenen Kontur mit Bögen (Bulge) */
    static area(points) {
        let sum = 0;
        const n = points.length;
        for (let k = 0; k < n; k++) {
            const a = points[k], b = points[(k + 1) % n];
            sum += (a.x * b.y - b.x * a.y) / 2;
            if (a.bulge) {
                const theta = 4 * Math.atan(a.bulge);
                const chord = Math.hypot(b.x - a.x, b.y - a.y);
                const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
                sum += (theta - Math.sin(theta)) * r * r / 2;
            }
        }
        return sum;
    }
}
