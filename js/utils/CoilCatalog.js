import { MATERIAL_SPECS } from './MaterialData.js';

/**
 * Lieferbare Rollenbleche für die Zuschnitt-Optimierung – nur für die
 * Materialien und Ausführungen, die in der Stückliste (Projektdaten)
 * wählbar sind (siehe MaterialData.js). Bewusst ohne Artikelnummern und
 * Preise von Lieferanten; eigene Artikel kommen später aus ERPNext.
 *
 * Breiten, Dicken und Rollengewichte aus den gängigen Rollen-Abwicklungen
 * (Händler-Sortiment); Prefalz nach PREFA (Bandbreiten laut Nutzer,
 * Standard-Coils 60 kg und 500 kg).
 *
 * density: Dichte in kg/dm³ → m²-Gewicht = Dicke mm × Dichte
 *   Titanzink 7.2 (RHEINZINK-Datenblatt), Kupfer 8.93, CrNi-Stahl 7.9,
 *   Stahl 7.85, Aluminium/Prefalz 2.7 (PREFA: 0.7 mm ≈ 1.89 kg/m²)
 * coils:   [Breite mm, Dicke mm, Rollengewicht kg]
 * Eine Ausführung ist eine Liste von coils oder { density, coils }, wenn
 * ihre Dichte vom Material abweicht.
 */

const series = (widths, thickness, kg = 100) => widths.map(w => [w, thickness, kg]);

const COPPER_BLANK = [
    [165, 0.6, 100], [200, 0.6, 50], [200, 0.6, 100], [210, 0.3, 50], [250, 0.6, 50], [250, 0.6, 100],
    [330, 0.6, 100], [400, 0.6, 100], [420, 0.3, 50],
    [500, 0.6, 100], [500, 0.6, 500], [500, 0.6, 1000],
    [670, 0.6, 100], [670, 0.6, 500], [670, 0.6, 1000], [750, 0.6, 100],
    [1000, 0.6, 100], [1000, 0.6, 500], [1000, 0.6, 1000], [1000, 0.8, 100], [1000, 1, 100],
    [1250, 0.6, 100]
];

const STEEL_GALVANIZED = [
    ...series([200, 250, 330, 400, 500, 670, 750, 1000], 0.62),
    [1000, 0.75, 100], [1000, 0.87, 100], [1000, 1, 100]
];

const ALUMINIUM = [[1000, 0.6, 100], [1000, 0.8, 100], [1000, 1, 100]];

const PREFALZ = [500, 650, 1000, 1200].flatMap(w => [[w, 0.7, 60], [w, 0.7, 500]]);

// Titanzink blank: RHEINZINK und VM zusammen
const ZINC_BLANK = [
    ...series([200, 250, 330, 400, 500, 670], 0.7), [670, 0.7, 500], [670, 0.7, 1000], [750, 0.7, 100],
    [1000, 0.7, 100], [1000, 0.7, 500], [1000, 0.7, 1000], [1000, 0.8, 100], [1000, 1, 100],
    [200, 0.7, 50], [250, 0.7, 50], [500, 0.7, 1000], [1000, 0.8, 1000], [1000, 1, 1000],
    [1250, 0.7, 100], [1250, 0.7, 1000]
];

// Titanzink vorbewittert: prePATINA, VM Quartz / Anthra (inkl. plus), GRANUM
const ZINC_PATINATED = [
    ...series([200, 250, 330, 400, 500, 670], 0.7), [670, 0.7, 1000], [750, 0.7, 100],
    [1000, 0.7, 100], [1000, 0.7, 1000], [1000, 0.8, 100], [1000, 0.8, 1000], [1000, 1, 100],
    [200, 0.7, 50], [250, 0.7, 50]
];

export const MATERIAL_COILS = {
    'Kupfer': { density: 8.93, specs: {
        'Blank': COPPER_BLANK,
        'Verzinnt': [[500, 0.6, 100], [670, 0.6, 100]],
        'Patiniert': [[670, 0.6, 100], [670, 0.7, 100], [1000, 0.6, 100]]
    } },
    'CrNi-Stahl': { density: 7.9, specs: {
        'Matt': [
            [200, 0.5, 50], [200, 0.5, 100], [250, 0.5, 50], [250, 0.5, 100], [330, 0.5, 100], [400, 0.5, 100],
            [500, 0.5, 100], [670, 0.5, 100], [670, 0.5, 500], [670, 0.5, 1000], [750, 0.5, 100],
            [1000, 0.5, 100], [1000, 0.5, 500], [1000, 0.5, 1000], [1000, 0.6, 100], [1000, 0.8, 100],
            [1250, 0.5, 100], [1250, 0.5, 1000]
        ],
        'Matt +': [
            [200, 0.5, 50], [200, 0.5, 100], [250, 0.5, 50], [250, 0.5, 100], [330, 0.5, 100], [400, 0.5, 100],
            [500, 0.5, 100], [625, 0.5, 100], [625, 0.5, 1000], [670, 0.5, 100], [750, 0.5, 100],
            [1000, 0.5, 100], [1000, 0.5, 1000], [1250, 0.5, 100]
        ],
        // Verzinnt = Uginox Patina K41 (ferritischer Edelstahl, Dichte 7.7)
        'Verzinnt': { density: 7.7, coils: [
            ...series([200, 250, 330, 400, 500], 0.5), [500, 0.5, 1000], [580, 0.5, 100],
            [670, 0.5, 100], [670, 0.5, 1000], [750, 0.5, 100], [1000, 0.5, 100], [1000, 0.5, 1000]
        ] }
    } },
    'Stahlblech': { density: 7.85, specs: {
        'Blank': STEEL_GALVANIZED,
        'Verzinkt': STEEL_GALVANIZED,
        'Farbbeschichtet': [[1000, 0.6, 100]],
        'Pluvicolor': [[1000, 0.87, 100], [1000, 0.87, 1000]]
    } },
    'Titanzink': { density: 7.2, specs: {
        'Blank': ZINC_BLANK,
        'Vorbewittert': ZINC_PATINATED
    } },
    'Aluminium': { density: 2.7, specs: {
        'Blank': ALUMINIUM,
        'Eloxiert': ALUMINIUM,
        // Lochblech nur als Tafel (siehe MATERIAL_SHEETS)
        'Lochblech': []
    } },
    'Prefalz': { density: 2.7, specs: {
        'Glatt': PREFALZ,
        'Structa': PREFALZ
    } }
};

/**
 * Wählbare Rollen-Sorten = Material + Ausführung aus der Stückliste.
 * Ist ein Material gesetzt, nur dessen Ausführungen.
 */
export function coilSortsFor(material) {
    const materials = material && MATERIAL_COILS[material] ? [material] : Object.keys(MATERIAL_COILS);
    return materials.flatMap(m => (MATERIAL_SPECS[m] || Object.keys(MATERIAL_COILS[m].specs)).map(spec => {
        const entry = MATERIAL_COILS[m].specs[spec] || [];
        return {
            key: `${m}|${spec}`,
            name: `${m} – ${spec}`,
            material: m,
            spec,
            density: (!Array.isArray(entry) && entry.density) || MATERIAL_COILS[m].density,
            coils: Array.isArray(entry) ? entry : entry.coils
        };
    }));
}

// Dichte für eine eigene Rollenbreite ohne Katalog-Eintrag
export function densityFor(material) {
    return (MATERIAL_COILS[material] && MATERIAL_COILS[material].density) || 7.85;
}

/**
 * Rollenbreiten einer Sorte für den Vergleich: pro Breite und Dicke ein
 * Eintrag mit den lieferbaren Rollengewichten. Ist eine Dicke vorgegeben
 * und in der Sorte vorhanden, nur diese.
 */
export function coilOptionsFor(sort, thickness) {
    if (!sort) return [];
    const t = parseFloat(thickness);
    const hasThickness = t > 0 && sort.coils.some(([, th]) => Math.abs(th - t) < 1e-6);
    const map = new Map();
    sort.coils.forEach(([width, th, kg]) => {
        if (hasThickness && Math.abs(th - t) > 1e-6) return;
        const key = `${width}|${th}`;
        if (!map.has(key)) map.set(key, { key, width, thickness: th, coilKg: [] });
        const entry = map.get(key);
        if (kg && !entry.coilKg.includes(kg)) entry.coilKg.push(kg);
    });
    const options = [...map.values()].sort((a, b) => a.width - b.width || a.thickness - b.thickness);
    options.forEach(o => o.coilKg.sort((a, b) => a - b));
    return options;
}

/**
 * Wie viele Rollen ein Zuschnitt braucht, pro lieferbarem Rollengewicht.
 * Rollenlänge = Rollengewicht / (Breite × m²-Gewicht). Rolle für Rolle wird
 * in jedem Streifen der Reihe nach geschnitten, solange das nächste Teil
 * noch ganz auf die Rolle passt (Teile laufen nicht über einen
 * Rollenwechsel). fits = false, wenn ein Teil länger ist als eine Rolle.
 */
export function coilsNeeded(plan, coilWidth, thickness, density, coilKgList) {
    const kgPerM2 = thickness * density;
    const kgPerM = coilWidth / 1000 * kgPerM2;
    return coilKgList.map(kg => {
        const coilLength = kg / kgPerM * 1000; // mm
        const queues = plan.lanes.map(lane => lane.items.map(item => item.length));
        const fits = queues.every(q => q.every(len => len <= coilLength + 1e-6));
        let count = 0;
        if (fits) {
            while (queues.some(q => q.length > 0)) {
                count++;
                queues.forEach(q => {
                    let used = 0;
                    while (q.length > 0 && used + q[0] <= coilLength + 1e-6) used += q.shift();
                });
            }
        }
        return { kg, coilLength, count, fits, kgPerM2 };
    });
}

/**
 * Tafelbleche (Händler-Sortiment, ohne Artikelnummern und Preise):
 * [Breite mm, Länge mm, Dicke mm]. Zuordnung zu den Ausführungen der
 * Stückliste: Stahl sendzimir verzinkt → Stahlblech Blank/Verzinkt,
 * testa di moro → Farbbeschichtet, Tecu Patina → Kupfer Patiniert,
 * Aluminium 5005 → Aluminium, CrNi 2D (matt) → Matt, mattplus → Matt +,
 * Uginox → CrNi Verzinnt, Titanzink blank (inkl. VM) → Blank,
 * prePATINA / GRANUM → Titanzink Vorbewittert. Für Prefalz und Kupfer verzinnt sind
 * keine Tafeln erfasst.
 */
const sheets = (width, length, thicknesses) => thicknesses.map(t => [width, length, t]);

const STEEL_SHEETS = [
    ...sheets(1000, 2000, [0.62, 0.75, 0.87, 1, 1.5, 2]),
    ...sheets(1250, 2500, [1.5, 2, 3]),
    ...sheets(1500, 3000, [0.75, 0.87, 1, 1.25, 1.5, 2, 3])
];

const ALUMINIUM_SHEETS = [
    ...sheets(1000, 2000, [0.8, 1, 1.5, 2]),
    ...sheets(1250, 2500, [0.8, 1, 1.2, 1.5, 2]),
    ...sheets(1500, 3000, [1, 1.2, 1.5, 2])
];

export const MATERIAL_SHEETS = {
    'Kupfer': {
        'Blank': [
            ...sheets(1000, 2000, [0.3, 0.6, 0.8, 1, 1.2, 1.5, 2]),
            ...sheets(1000, 3000, [0.6, 0.8, 1, 1.5, 2]),
            [1250, 2500, 0.6], [1250, 3000, 0.6]
        ],
        'Patiniert': [...sheets(670, 2000, [0.6, 0.7]), [1000, 2000, 0.6], ...sheets(1000, 3000, [0.6, 0.7])]
    },
    'CrNi-Stahl': {
        'Matt': [...sheets(1000, 2000, [0.5, 0.6, 0.8]), ...sheets(1250, 2500, [0.5, 0.6]), [1250, 3000, 0.5]],
        'Matt +': [[1000, 2000, 0.5], [1000, 3000, 0.5], [1250, 2500, 0.7], [1250, 3000, 0.7]],
        'Verzinnt': [[1000, 2000, 0.5]]
    },
    'Stahlblech': {
        'Blank': STEEL_SHEETS,
        'Verzinkt': STEEL_SHEETS,
        'Farbbeschichtet': [[1000, 2000, 0.6]],
        'Pluvicolor': [[1000, 2000, 0.87], [1000, 3000, 0.87]]
    },
    'Titanzink': {
        'Blank': [...sheets(1000, 2000, [0.3, 0.7, 0.8, 1, 1.5, 2]), ...sheets(1000, 3000, [0.7, 0.8, 1])],
        'Vorbewittert': [...sheets(1000, 2000, [0.7, 0.8, 1]), [1000, 3000, 1]]
    },
    'Aluminium': {
        'Blank': ALUMINIUM_SHEETS,
        'Eloxiert': ALUMINIUM_SHEETS,
        'Lochblech': [...sheets(1000, 2000, [1, 1.5, 2]), ...sheets(1250, 2500, [1, 1.5, 2])]
    }
};

// Tafeln einer Sorte (Material|Ausführung aus coilSortsFor)
export function sheetsForSort(sort) {
    if (!sort) return [];
    return (MATERIAL_SHEETS[sort.material] && MATERIAL_SHEETS[sort.material][sort.spec]) || [];
}

/**
 * Tafelformate einer Sorte für den Vergleich. Ist eine Dicke vorgegeben
 * und als Tafel vorhanden, nur diese.
 */
export function sheetOptionsFor(sort, thickness) {
    const list = sheetsForSort(sort);
    const t = parseFloat(thickness);
    const hasThickness = t > 0 && list.some(([, , th]) => Math.abs(th - t) < 1e-6);
    return list
        .filter(([, , th]) => !hasThickness || Math.abs(th - t) < 1e-6)
        .map(([width, length, th]) => ({ key: `${width}x${length}|${th}`, width, length, thickness: th }))
        .sort((a, b) => a.width - b.width || a.length - b.length || a.thickness - b.thickness);
}

/**
 * Lieferbare Dicken für Material + Ausführung (Stückliste), aufsteigend,
 * aus Rollen und Tafeln. Ohne Ausführung alle Dicken des Materials.
 * sheetOnly: Dicken, die es nur als Tafel gibt. standard = die Dicke mit
 * den meisten Rollen (übliche Dicke, z.B. Titanzink 0.7 mm).
 */
export function thicknessesFor(material, spec) {
    const mat = MATERIAL_COILS[material];
    const matSheets = MATERIAL_SHEETS[material] || {};
    if (!mat) return { list: [], sheetOnly: [], standard: 0 };
    const specs = spec && mat.specs[spec] ? [spec] : Object.keys(mat.specs);
    const counts = new Map();
    const sheetThicknesses = new Set();
    specs.forEach(s => {
        const entry = mat.specs[s];
        (Array.isArray(entry) ? entry : entry.coils).forEach(([, th]) => counts.set(th, (counts.get(th) || 0) + 1));
        (matSheets[s] || []).forEach(([, , th]) => sheetThicknesses.add(th));
    });
    const sheetOnly = [...sheetThicknesses].filter(th => !counts.has(th));
    const list = [...counts.keys(), ...sheetOnly].sort((a, b) => a - b);
    const coilList = [...counts.keys()];
    const standard = coilList.reduce((best, th) => (counts.get(th) > (counts.get(best) || 0) ? th : best), coilList[0] || list[0] || 0);
    return { list, sheetOnly, standard };
}
