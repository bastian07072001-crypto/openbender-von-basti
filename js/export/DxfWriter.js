/**
 * Einfacher DXF-Schreiber (R12 / AC1009) für Module (api.dxf.create).
 * Gleicher Aufbau wie DXFExporter: Masseinheit mm, Layer-Tabelle mit Farben,
 * Polylinien als POLYLINE/VERTEX mit Bulge (echte Kreisbögen), dazu LINE,
 * CIRCLE, ARC und TEXT. R12 lesen praktisch alle CAD- und CAM-Programme.
 *
 *   const dxf = new DxfWriter({ KONTUR: 7, NUT: 1 });   // Layer: ACI-Farbe
 *   dxf.polyline([{ x, y, bulge? }, …], { layer: 'KONTUR', closed: true });
 *   dxf.circle({ x, y }, r, 'KONTUR');
 *   const text = dxf.toString();
 *
 * bulge eines Punkts = tan(Öffnungswinkel / 4) des Bogens zum nächsten Punkt,
 * positiv = Gegenuhrzeigersinn (wie in DXF üblich).
 */
export class DxfWriter {
    constructor(layers = {}) {
        this.layers = { '0': 7 };
        Object.entries(layers).forEach(([name, color]) => this.addLayer(name, color));
        this.entities = '';
    }

    addLayer(name, color = 7) {
        const clean = String(name).toUpperCase().replace(/[^A-Z0-9_\-$]/g, '_').slice(0, 31) || '0';
        this.layers[clean] = Math.max(1, Math.min(255, Math.round(Number(color) || 7)));
        return clean;
    }

    layerName(name) {
        const clean = String(name || '0').toUpperCase().replace(/[^A-Z0-9_\-$]/g, '_').slice(0, 31) || '0';
        if (!(clean in this.layers)) this.layers[clean] = 7;
        return clean;
    }

    line(a, b, layer = '0') {
        const l = this.layerName(layer);
        this.entities += `0\nLINE\n8\n${l}\n10\n${num(a.x)}\n20\n${num(a.y)}\n30\n0.0\n11\n${num(b.x)}\n21\n${num(b.y)}\n31\n0.0\n`;
        return this;
    }

    /**
     * Geschlossene Polylinie: Kennzeichen "geschlossen" UND der Startpunkt am
     * Ende wiederholt. Manche Leser (z.B. der DXF-Import von FreeCAD)
     * übergehen das Kennzeichen und liessen sonst das letzte Stück weg; wer
     * es beachtet, erhält nur ein Stück der Länge null.
     */
    polyline(points, { layer = '0', closed = false } = {}) {
        if (!points || points.length < 2) return this;
        const l = this.layerName(layer);
        const first = points[0], last = points[points.length - 1];
        const all = closed && Math.hypot(first.x - last.x, first.y - last.y) > 1e-9
            ? [...points, { x: first.x, y: first.y }]
            : points;
        let e = `0\nPOLYLINE\n8\n${l}\n66\n1\n10\n0.0\n20\n0.0\n30\n0.0\n70\n${closed ? 1 : 0}\n`;
        all.forEach(p => {
            e += `0\nVERTEX\n8\n${l}\n10\n${num(p.x)}\n20\n${num(p.y)}\n30\n0.0\n`;
            if (p.bulge) e += `42\n${num(p.bulge)}\n`;
            e += '70\n0\n';
        });
        e += `0\nSEQEND\n8\n${l}\n`;
        this.entities += e;
        return this;
    }

    circle(c, r, layer = '0') {
        const l = this.layerName(layer);
        this.entities += `0\nCIRCLE\n8\n${l}\n10\n${num(c.x)}\n20\n${num(c.y)}\n30\n0.0\n40\n${num(r)}\n`;
        return this;
    }

    /** Bogen um c mit Radius r von startDeg bis endDeg (Gegenuhrzeigersinn) */
    arc(c, r, startDeg, endDeg, layer = '0') {
        const l = this.layerName(layer);
        this.entities += `0\nARC\n8\n${l}\n10\n${num(c.x)}\n20\n${num(c.y)}\n30\n0.0\n40\n${num(r)}\n50\n${num(startDeg)}\n51\n${num(endDeg)}\n`;
        return this;
    }

    text(value, at, height = 5, layer = '0') {
        const l = this.layerName(layer);
        const clean = String(value).replace(/[\r\n]+/g, ' ');
        this.entities += `0\nTEXT\n8\n${l}\n10\n${num(at.x)}\n20\n${num(at.y)}\n30\n0.0\n40\n${num(height)}\n1\n${clean}\n`;
        return this;
    }

    toString() {
        const names = Object.keys(this.layers);
        let dxf = '0\nSECTION\n2\nHEADER\n';
        dxf += '9\n$ACADVER\n1\nAC1009\n';
        dxf += '9\n$INSUNITS\n70\n4\n';      // Millimeter
        dxf += '9\n$MEASUREMENT\n70\n1\n';   // metrisch
        dxf += '0\nENDSEC\n';
        dxf += '0\nSECTION\n2\nTABLES\n';
        dxf += '0\nTABLE\n2\nLTYPE\n70\n1\n';
        dxf += '0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n';
        dxf += '0\nENDTAB\n';
        dxf += `0\nTABLE\n2\nLAYER\n70\n${names.length}\n`;
        names.forEach(name => {
            dxf += `0\nLAYER\n2\n${name}\n70\n0\n62\n${this.layers[name]}\n6\nCONTINUOUS\n`;
        });
        dxf += '0\nENDTAB\n0\nENDSEC\n';
        dxf += '0\nSECTION\n2\nENTITIES\n';
        dxf += this.entities;
        dxf += '0\nENDSEC\n0\nEOF\n';
        return dxf;
    }
}

// Zahlen ohne Exponentenschreibweise und ohne Rundungsrauschen (µm genau)
function num(v) {
    const r = Math.round(Number(v) * 1e6) / 1e6;
    return Object.is(r, -0) ? '0' : String(r);
}
