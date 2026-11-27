/**
 * Profil- und Stücklisten-Daten für Module: Profil aus Schenkeln bauen und
 * Daten aus Modulen prüfen, bevor sie ins Datenmodell gelangen.
 */

export function validateProfile(data) {
    if (!data || !Array.isArray(data.points) || !Array.isArray(data.segments)) {
        throw new Error('profile.set: { points: [...], segments: [...] } erwartet');
    }
    if (data.points.length < 2 || data.segments.length < 1) throw new Error('profile.set: mindestens 2 Punkte und 1 Segment');
    const points = data.points.map((p, i) => {
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error(`profile.set: Punkt ${i} ungültig`);
        return { x: p.x, y: p.y };
    });
    const segments = data.segments.map((s, i) => {
        const a = s && s.startIndex, b = s && s.endIndex;
        if (!Number.isInteger(a) || !Number.isInteger(b) || a === b || a < 0 || b < 0 || a >= points.length || b >= points.length) {
            throw new Error(`profile.set: Segment ${i} verweist auf ungültige Punkte`);
        }
        const seg = { type: 'line', startIndex: a, endIndex: b };
        if (Number.isFinite(s.backLength) && s.backLength > 0) seg.backLength = s.backLength;
        return seg;
    });
    return { points, segments, conical: data.conical === true };
}

/**
 * Profil aus aufeinanderfolgenden Schenkeln.
 * steps: [{ length, turn }] – length in mm; turn = Richtungsänderung in
 *        Grad VOR diesem Schenkel, positiv = nach links (im Gegenuhrzeiger-
 *        sinn, so wie auf dem Bildschirm gesehen), negativ = nach rechts.
 *        Statt turn kann direction (absolute Richtung) angegeben werden.
 *        backLength (optional, mm): Länge am hinteren Ende (konisch).
 * opts:  { start: {x, y} (mm, Standard 0/0), direction: Startrichtung in Grad
 *        (0 = nach rechts, 90 = nach oben; Standard 0), conical: false }
 * Rückgabe: { points, segments, conical } für profile.set()
 */
export function buildProfile(steps, opts = {}) {
    if (!Array.isArray(steps) || steps.length === 0) throw new Error('profile.build: steps leer');
    const start = opts.start || { x: 0, y: 0 };
    let dir = Number(opts.direction) || 0;
    const points = [{ x: start.x, y: start.y }];
    const segments = [];
    steps.forEach((step, i) => {
        const length = Number(step.length);
        if (!(length > 0)) throw new Error(`profile.build: Schenkel ${i + 1} braucht eine Länge > 0`);
        if (Number.isFinite(step.direction)) dir = step.direction;
        else dir += Number(step.turn) || 0;
        const rad = dir * Math.PI / 180;
        const last = points[points.length - 1];
        // Profil-Koordinaten: y zeigt nach unten (wie der Bildschirm)
        points.push({ x: round6(last.x + length * Math.cos(rad)), y: round6(last.y - length * Math.sin(rad)) });
        const seg = { type: 'line', startIndex: points.length - 2, endIndex: points.length - 1 };
        if (Number.isFinite(step.backLength) && step.backLength > 0) seg.backLength = step.backLength;
        segments.push(seg);
    });
    return { points, segments, conical: opts.conical === true };
}

function round6(v) {
    return Math.round(v * 1e6) / 1e6;
}

export function cleanCutlistItem(item) {
    return {
        length: Number(item.length) || 0,
        quantity: Number(item.quantity) || 1,
        interlocking: !!item.interlocking,
        note: String(item.note || '')
    };
}

export function validateCutlist(items) {
    if (!Array.isArray(items)) throw new Error('cutlist.set: Liste erwartet');
    return items.map((item, i) => {
        const length = Number(item && item.length);
        const quantity = Math.max(1, parseInt(item && item.quantity, 10) || 1);
        if (!(length > 0)) throw new Error(`cutlist: Position ${i + 1} braucht eine Länge > 0 (in Meter)`);
        return { length, quantity, interlocking: !!item.interlocking, note: String(item.note || '') };
    });
}
