import { Ausgabe } from './Ausgabe.js';
import { Geometry } from '../utils/Geometry.js';

// Schenkelabstand am Umschlag (= 2 × Bogenradius), wenn keine Materialstärke
// bekannt ist – gleicher Wert wie die schematische Darstellung im 2D-Editor,
// PDF und 3D (dort HEM_FOLD_OFFSET_MM).
const DEFAULT_HEM_GAP_MM = 2.5;

// Mindest-Innenradius, der bei jeder Seitenwahl der Blechstärke im CAD
// (innen, aussen, mittig) übrig bleibt – sonst dringt das Blech im Umschlag
// in sich selbst ein und z.B. FreeCAD SheetMetal kann keinen Körper bilden.
const MIN_INNER_RADIUS_MM = 0.5;

/**
 * DXF für Maschinenübergabe (z.B. Thalmann-Steuerung, die Kreisbögen als
 * Umschlag interpretiert) und CAD-Weiterverarbeitung (z.B. FreeCAD
 * SheetMetal). Format R12 (AC1009), das von praktisch allen Lesern
 * unterstützt wird.
 *
 * Die Kontur wird als zusammenhängende Polylinien geschrieben (POLYLINE /
 * VERTEX mit Bulge): Linien und Umschlag-Bögen sind ein durchgehender
 * Linienzug, die Bögen echte Kreisbögen statt kurzer Einzelsegmente. Ein
 * Profil mit Verzweigungen wird in mehrere Züge aufgeteilt.
 */
// Layer: Name → Farbe (ACI). Konische Profile: vorne / hinten / Verbindungskanten.
const LAYERS = {
    '0': 7,
    VORNE: 7,
    HINTEN: 1,
    KANTEN: 8,
    TEXT: 3
};

export class DXFExporter {
    /**
     * options (nur für konische Profile):
     *   mode: '2d' – vorderes und hinteres Profil nebeneinander, beschriftet
     *         '3d' – Drahtmodell: vorne bei z = 0, hinten bei z = Länge,
     *                verbunden durch die Kanten
     *   lengthMm: Blechlänge für '3d'
     * Normale Profile: ein Querschnitt wie bisher (Layer 0).
     */
    /** Dateiname: Projektnummer_Profilname[_Variante]_JJJJ-MM-TT_HHMM.dxf (auch für das PDF genutzt) */
    static fileName(projectData = {}, variante = '', jetzt = new Date(), endung = 'dxf') {
        const teil = (t) => String(t || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '-');
        const zwei = (n) => String(n).padStart(2, '0');
        const stempel = `${jetzt.getFullYear()}-${zwei(jetzt.getMonth() + 1)}-${zwei(jetzt.getDate())}_${zwei(jetzt.getHours())}${zwei(jetzt.getMinutes())}`;
        const name = teil(projectData.profileName) || (projectData.projectNumber ? '' : 'blechprofil');
        return [teil(projectData.projectNumber), name, variante, stempel].filter(Boolean).join('_') + '.' + endung;
    }

    static export(profile, projectData = {}, options = {}) {
        if (!profile || !profile.points || profile.points.length < 2) {
            console.warn('Keine ausreichenden Geometriedaten für DXF-Export vorhanden.');
            return;
        }

        const hemGap = this.hemGapFor(projectData.materialThickness);
        let entities = '';
        // Projektnummer_Profilname_Zeitstempel.dxf (fehlende Teile weggelassen)
        let variante = '';

        if (!profile.conical) {
            this.buildChains(profile, hemGap).forEach(chain => { entities += this.polylineEntity(chain, '0', 0); });
        } else {
            const back = { points: profile.computeBackGeometry().points, segments: profile.segments };
            const frontChains = this.buildChains(profile, hemGap);
            const backChains = this.buildChains(back, hemGap);
            const ext = this.extent([...profile.points, ...back.points]);
            const textHeight = Math.max(5, Math.max(ext.width, ext.height) * 0.06);

            if (options.mode === '3d') {
                const z = options.lengthMm > 0 ? options.lengthMm : 500;
                frontChains.forEach(chain => { entities += this.polylineEntity(chain, 'VORNE', 0); });
                backChains.forEach(chain => { entities += this.polylineEntity(chain, 'HINTEN', z); });

                // Kanten: gleicher Aufbau → gleiche Züge mit gleich vielen Punkten
                frontChains.forEach((chain, c) => {
                    const other = backChains[c];
                    if (!other || other.vertices.length !== chain.vertices.length) return;
                    chain.vertices.forEach((v, i) => {
                        entities += this.lineEntity({ ...v, z: 0 }, { ...other.vertices[i], z }, 'KANTEN');
                    });
                });

                entities += this.textEntity('vorne', ext.minX, ext.maxY + textHeight, 0, textHeight);
                // Daneben statt darüber: 2D-Programme zeigen die Datei von
                // oben, dort würden sich beide Texte sonst überlagern
                entities += this.textEntity('hinten', ext.minX + textHeight * 5, ext.maxY + textHeight, z, textHeight);
                variante = `konisch-3d-${Math.round(z)}mm`;
            } else {
                const dx = ext.width + Math.max(30, ext.width * 0.3);
                const shift = (chain) => ({ ...chain, vertices: chain.vertices.map(v => ({ ...v, x: v.x + dx })) });
                frontChains.forEach(chain => { entities += this.polylineEntity(chain, 'VORNE', 0); });
                backChains.forEach(chain => { entities += this.polylineEntity(shift(chain), 'HINTEN', 0); });

                entities += this.textEntity('vorne', ext.minX, ext.maxY + textHeight, 0, textHeight);
                entities += this.textEntity('hinten', ext.minX + dx, ext.maxY + textHeight, 0, textHeight);
                variante = 'konisch-2d';
            }
        }

        let dxf = '';
        dxf += "0\nSECTION\n2\nHEADER\n";
        dxf += "9\n$ACADVER\n1\nAC1009\n";
        dxf += "9\n$INSUNITS\n70\n4\n";      // 4 = Millimeter
        dxf += "9\n$MEASUREMENT\n70\n1\n";   // 1 = Metrisch
        dxf += "0\nENDSEC\n";
        dxf += this.tablesSection();
        dxf += "0\nSECTION\n2\nENTITIES\n";
        dxf += entities;
        dxf += "0\nENDSEC\n0\nEOF\n";

        this.downloadFile(dxf, this.fileName(projectData, variante), 'text/plain');
    }

    // Linientyp CONTINUOUS und die Layer (mit Farbe), damit CAD-Programme
    // die Layer mit Namen anzeigen
    static tablesSection() {
        const names = Object.keys(LAYERS);
        let t = "0\nSECTION\n2\nTABLES\n";
        t += "0\nTABLE\n2\nLTYPE\n70\n1\n";
        t += "0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n";
        t += "0\nENDTAB\n";
        t += `0\nTABLE\n2\nLAYER\n70\n${names.length}\n`;
        names.forEach(name => {
            t += `0\nLAYER\n2\n${name}\n70\n0\n62\n${LAYERS[name]}\n6\nCONTINUOUS\n`;
        });
        t += "0\nENDTAB\n0\nENDSEC\n";
        return t;
    }

    // 2D-Polylinie (mit Bulge-Bögen) auf Höhe z (Erhebung der Polylinie)
    static polylineEntity(chain, layer, z) {
        let e = `0\nPOLYLINE\n8\n${layer}\n66\n1\n10\n0.0\n20\n0.0\n30\n${z}\n70\n${chain.closed ? 1 : 0}\n`;
        chain.vertices.forEach(v => {
            e += `0\nVERTEX\n8\n${layer}\n10\n${v.x}\n20\n${v.y}\n30\n${z}\n`;
            if (v.bulge) e += `42\n${v.bulge}\n`;
            e += "70\n0\n";
        });
        e += `0\nSEQEND\n8\n${layer}\n`;
        return e;
    }

    static lineEntity(a, b, layer) {
        return `0\nLINE\n8\n${layer}\n10\n${a.x}\n20\n${a.y}\n30\n${a.z}\n11\n${b.x}\n21\n${b.y}\n31\n${b.z}\n`;
    }

    static textEntity(text, x, y, z, height) {
        return `0\nTEXT\n8\nTEXT\n10\n${x}\n20\n${y}\n30\n${z}\n40\n${height}\n1\n${text}\n`;
    }

    static extent(points) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        points.forEach(p => {
            if (!p) return;
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        });
        return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
    }

    // Schenkelabstand am Umschlag; Bogenradius = Hälfte davon = mindestens
    // Blechstärke + Mindest-Innenradius, nie kleiner als die Schematik.
    static hemGapFor(thickness) {
        const t = parseFloat(thickness) || 0;
        return Math.max(DEFAULT_HEM_GAP_MM, 2 * (t + MIN_INNER_RADIUS_MM));
    }

    /**
     * Zerlegt das Profil in Kanten (Linien zwischen den ggf. durch einen
     * Falz angepassten Endpunkten, Umschlag-Bögen aus
     * Geometry.computeFoldLayout) und verbindet sie über gemeinsame
     * Endpunkte zu Zügen. Züge starten an Enden bzw. Verzweigungen, übrig
     * bleibende geschlossene Kreise werden als geschlossene Polylinie
     * geschrieben. Jeder Scheitelpunkt trägt den Bulge der FOLGENDEN Kante
     * (tan(Überstreichwinkel/4), Vorzeichen = Drehrichtung).
     *
     * Mittelrippen-Sonderfall (Basis eines Umschlags ist selbst ein
     * Umschlag) ist nicht im Falz-Layout enthalten und bleibt eine exakte
     * scharfe Ecke.
     */
    static buildChains(profile, hemGap) {
        const points = profile.points;
        const segments = profile.segments || [];
        const layout = Geometry.computeFoldLayout(points, segments, hemGap);

        const key = (p) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
        const edges = [];

        segments.forEach((seg, i) => {
            if (!points[seg.startIndex] || !points[seg.endIndex]) return;
            const a = Geometry.foldEndpoint(layout, i, seg.startIndex, points);
            const b = Geometry.foldEndpoint(layout, i, seg.endIndex, points);
            if (Geometry.distance(a, b) > 1e-9) edges.push({ a, b, sweep: 0 });
        });
        layout.folds.forEach(f => edges.push({ a: f.arc.from, b: f.arc.to, sweep: f.arc.sweep }));

        const adjacency = new Map();
        const addAdj = (p, edgeIndex) => {
            const k = key(p);
            if (!adjacency.has(k)) adjacency.set(k, []);
            adjacency.get(k).push(edgeIndex);
        };
        edges.forEach((e, i) => { addAdj(e.a, i); addAdj(e.b, i); });

        const used = new Set();
        const chains = [];

        const walk = (startPoint) => {
            const vertices = [{ x: startPoint.x, y: startPoint.y, bulge: 0 }];
            let current = startPoint;
            for (;;) {
                const next = (adjacency.get(key(current)) || []).find(i => !used.has(i));
                if (next === undefined) break;
                used.add(next);
                const e = edges[next];
                const forward = key(e.a) === key(current);
                const sweep = forward ? e.sweep : -e.sweep;
                vertices[vertices.length - 1].bulge = sweep ? Math.tan(sweep / 4) : 0;
                current = forward ? e.b : e.a;
                vertices.push({ x: current.x, y: current.y, bulge: 0 });
            }
            return vertices;
        };

        // Offene Züge ab Enden/Verzweigungen (Grad ≠ 2)
        adjacency.forEach((edgeList, k) => {
            if (edgeList.length === 2) return;
            edgeList.forEach(i => {
                if (used.has(i)) return;
                const e = edges[i];
                const start = key(e.a) === k ? e.a : e.b;
                const vertices = walk(start);
                if (vertices.length > 1) chains.push({ vertices, closed: false });
            });
        });

        // Übrige geschlossene Konturen
        edges.forEach((e, i) => {
            if (used.has(i)) return;
            const vertices = walk(e.a);
            // Letzter Punkt = Startpunkt – bei geschlossener Polylinie weglassen,
            // der Bulge der schliessenden Kante sitzt auf dem vorletzten Punkt.
            vertices.pop();
            chains.push({ vertices, closed: true });
        });

        return chains;
    }

    // Download bzw. in ERPNext Ablage im Projekt (js/export/Ausgabe.js)
    static downloadFile(content, fileName, mimeType) {
        Ausgabe.speichern(fileName, content, mimeType);
    }
}
