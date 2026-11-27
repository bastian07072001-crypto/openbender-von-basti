/**
 * Zuschnitt-Optimierung für Rollenbleche (Längszuschnitt).
 *
 * Ablauf in der Werkstatt: zuerst ablängen (Querschnitt über die ganze
 * Rollenbreite), dann jeden Abschnitt in Längsstreifen aufspalten. Die
 * Querschnitte liegen darum in allen Streifen auf der gleichen Flucht: Die
 * Rolle besteht aus Abschnitten, in jedem Streifen liegt pro Abschnitt
 * höchstens ein Teil, der Abschnitt ist so lang wie sein längstes Teil.
 * Jeder Streifen ist so breit wie die Zuschnittbreite der Teile darin.
 * Gesucht ist die Aufteilung mit der kürzesten abgewickelten Rollenlänge. Verschnitt
 * = Rollenfläche (Breite × Länge) − Fläche der Teile; dazu gehören der
 * Reststreifen am Rand, nicht ausgenutzte Streifenlänge und bei konischen
 * Teilen der Keil neben der Schräge.
 *
 * Teile (alle Masse in mm):
 * - rect: gerades Teil, Breite = Abwicklung. Beim Steckprofil für nicht
 *   steckbare Positionen die grössere Abwicklung (Vorgabe Nutzer).
 * - trap: konisches Teil, Trapez von vorne nach hinten; einzeln braucht es
 *   einen Streifen in der grösseren Abwicklung. Konisch sind beim
 *   Steckprofil (mindestens eine Position steckbar) die steckbaren
 *   Positionen, sonst beim konisch gezeichneten Profil alle.
 * - pair: zwei gleich lange konische Teile gegengleich nebeneinander mit
 *   gemeinsamer Schrägschnittlinie, Breite = vorne + hinten.
 *
 * Tafelbleche (planForSheet): jede Tafel wird gleich in Streifen geteilt,
 * entweder längs (Streifen über die Tafellänge) oder quer (über die
 * Tafelbreite, nur wenn alle Teile so kurz sind). Gesucht sind möglichst
 * wenige Tafeln.
 */
export class CuttingOptimizer {
    /**
     * positions: Stückliste [{ length (m, Werte > 50 als mm), quantity, interlocking }]
     * unfold:    { front, back } Abwicklung in mm (Profile.getUnfoldLengths)
     * conical:   Profil ist konisch
     * nest:      konische Teile paarweise verschachteln
     */
    static buildItems(positions, unfold, conical, nest, tag = null) {
        const front = unfold.front;
        const back = conical ? unfold.back : unfold.front;
        const wide = Math.max(front, back);

        const rects = [];
        const traps = [];
        const plugProfile = positions.some(p => p.interlocking);
        const tapered = conical && Math.abs(front - back) > 1e-6;
        positions.forEach((position, posIndex) => {
            const value = parseFloat(position.length) || 0;
            const length = value > 50 ? value : value * 1000;
            const quantity = Math.max(0, parseInt(position.quantity) || 0);
            if (length <= 0) return;

            for (let k = 1; k <= quantity; k++) {
                // tag (Zuschnitt über mehrere Profile): { prof, profId, name, farbe(pos) }
                const piece = { pos: posIndex + 1, k, quantity, length };
                if (tag) Object.assign(piece, { prof: tag.prof, profId: tag.profId, name: `${tag.prof}-${posIndex + 1}`, farbe: tag.farbe + posIndex });
                if (tapered && (!plugProfile || position.interlocking)) {
                    traps.push(piece);
                } else {
                    rects.push(piece);
                }
            }
        });

        const items = rects.map(piece => ({ kind: 'rect', width: wide, length: piece.length, pieces: [piece], area: wide * piece.length }));

        if (nest) {
            // Gleich lange konische Teile paaren (auf 0.1 mm gleich)
            const byLength = new Map();
            traps.forEach(piece => {
                const key = Math.round(piece.length * 10);
                if (!byLength.has(key)) byLength.set(key, []);
                byLength.get(key).push(piece);
            });
            byLength.forEach(list => {
                for (let i = 0; i + 1 < list.length; i += 2) {
                    items.push({ kind: 'pair', width: front + back, length: list[i].length, pieces: [list[i], list[i + 1]], area: (front + back) * list[i].length });
                }
                if (list.length % 2 === 1) {
                    const piece = list[list.length - 1];
                    items.push({ kind: 'trap', width: wide, length: piece.length, pieces: [piece], area: (front + back) / 2 * piece.length });
                }
            });
        } else {
            traps.forEach(piece => items.push({ kind: 'trap', width: wide, length: piece.length, pieces: [piece], area: (front + back) / 2 * piece.length }));
        }

        // jedes Element kennt seine eigenen Abwicklungen (mehrere Profile auf einer Rolle)
        items.forEach(it => { it.front = front; it.back = back; });
        return { items, front, back };
    }

    /** Teile mehrerer Profile zusammenlegen (gleiches Material, gleiche Dicke → eine Rolle) */
    static mergeItems(infos) {
        return { items: infos.flatMap(i => i.items), front: infos[0] ? infos[0].front : 0, back: infos[0] ? infos[0].back : 0 };
    }

    /**
     * Mögliche Streifen-Aufteilungen quer: Listen von Streifenbreiten, deren
     * Summe in die Breite passt. Bis zwei verschiedene Breiten (ein Profil:
     * Einzel- und Paarstreifen) alle Kombinationen wie bisher; ab drei
     * Breiten nur noch volle Kombinationen (kein weiterer Streifen hätte
     * Platz), höchstens MAX_KOMBIS – sonst rechnet es bei vielen Profilen zu lange.
     */
    static laneCombos(widths, across) {
        const ws = [...new Set(widths.filter(w => w > 0).map(w => Math.round(w * 100) / 100))].sort((a, b) => b - a);
        const combos = [];
        const MAX_KOMBIS = 4000;
        const nurVolle = ws.length > 2;
        const kleinste = ws[ws.length - 1];
        const gehe = (i, rest, liste) => {
            if (combos.length >= MAX_KOMBIS) return;
            if (i === ws.length) {
                if (liste.length && (!nurVolle || rest < kleinste - 1e-6)) combos.push(liste);
                return;
            }
            const max = Math.floor((rest + 1e-6) / ws[i]);
            for (let n = 0; n <= max; n++) gehe(i + 1, rest - n * ws[i], [...liste, ...Array(n).fill(ws[i])]);
        };
        gehe(0, across, []);
        return combos;
    }

    /**
     * Beste Streifen-Aufteilung für eine Rollenbreite. Probiert alle
     * Kombinationen aus Anzahl Paar- und Einzelstreifen. Für jede werden
     * Abschnitte gebildet: das längste übrige Teil bestimmt die Länge des
     * Abschnitts, die übrigen Streifen bekommen je das längste Teil, das
     * hineinpasst (gleich lange zuerst). Genommen wird die kürzeste
     * Rollenlänge (bei Gleichstand weniger Streifen).
     */
    static planForWidth(itemsInfo, coilWidth) {
        const { items } = itemsInfo;
        const totalArea = items.reduce((sum, it) => sum + it.area, 0);
        if (items.length === 0) return { feasible: false, reason: 'empty' };

        // Streifenbreiten: je Profil die Einzelbreite, bei verschachtelten konischen Teilen die Paarbreite
        const widths = items.map(it => it.width);
        if (Math.max(...widths) > coilWidth + 1e-6) return { feasible: false, reason: 'narrow' };

        const sorted = [...items].sort((a, b) => b.length - a.length);
        let best = null;

        this.laneCombos(widths, coilWidth).forEach(combo => {
            const lanes = combo.map(width => ({ width, load: 0, items: [] }));
            const result = this.fillSections(sorted, lanes);
            if (!result) return;

            const used = lanes.filter(lane => lane.items.length > 0);
            const coilLength = result.length;
            if (!best || coilLength < best.coilLength - 1e-6 ||
                (Math.abs(coilLength - best.coilLength) <= 1e-6 && used.length < best.lanes.length)) {
                best = { lanes: used, coilLength, sections: result.sections };
            }
        });

        if (!best) return { feasible: false, reason: 'narrow' };

        const usedWidth = best.lanes.reduce((sum, lane) => sum + lane.width, 0);
        const coilArea = coilWidth * best.coilLength;
        const waste = coilArea - totalArea;
        return {
            feasible: true,
            coilWidth,
            lanes: best.lanes,
            // Abschnitte (Querschnitte über die ganze Breite): [{ start, length }]
            sections: best.sections,
            coilLength: best.coilLength,
            usedWidth,
            restStrip: coilWidth - usedWidth,
            partsArea: totalArea,
            coilArea,
            waste,
            wastePct: coilArea > 0 ? waste / coilArea * 100 : 0
        };
    }

    /**
     * Teile (längste zuerst) auf Abschnitte verteilen. lanes: [{ width, load,
     * items }] wird gefüllt (item.offset = Beginn des Abschnitts). Ergebnis
     * { length, sections } oder null, wenn ein Teil in keinen Streifen passt.
     */
    static fillSections(sorted, lanes) {
        const rest = [...sorted];
        const sections = [];
        let start = 0;
        const fits = (lane, item) => lane.width + 1e-6 >= item.width;
        while (rest.length) {
            // Das längste übrige Teil bestimmt die Länge des Abschnitts; es kommt in
            // den schmalsten passenden Streifen
            const first = rest[0];
            const sectionLength = first.length;
            const free = new Set(lanes);
            const place = (lane, item) => {
                lane.items.push({ ...item, offset: start });
                lane.load = start + item.length;
                free.delete(lane);
                rest.splice(rest.indexOf(item), 1);
            };
            const firstLane = [...free].filter(l => fits(l, first)).sort((a, b) => a.width - b.width)[0];
            if (!firstLane) return null;
            place(firstLane, first);
            // übrige Streifen: je das längste Teil, das in Breite und Abschnittlänge passt;
            // schmale Streifen zuerst, damit breite für breite Teile frei bleiben
            [...free].sort((a, b) => a.width - b.width).forEach(lane => {
                const item = rest.find(it => fits(lane, it) && it.length <= sectionLength + 1e-6);
                if (item) place(lane, item);
            });
            sections.push({ start, length: sectionLength });
            start += sectionLength;
        }
        return { length: start, sections };
    }

    /**
     * Beste Aufteilung auf Tafeln (Breite × Länge). Für beide Richtungen und
     * jede Kombination aus Paar- und Einzelstreifen pro Tafel werden die
     * Teile längste zuerst in den Streifen gelegt, in dem am wenigsten Platz
     * übrig bleibt (Best Fit); passt ein Teil nirgends mehr, kommt eine neue
     * Tafel dazu. Genommen wird die kleinste Tafelzahl, bei Gleichstand
     * längs vor quer und weniger Streifen.
     */
    static planForSheet(itemsInfo, sheetWidth, sheetLength) {
        const { items } = itemsInfo;
        const totalArea = items.reduce((sum, it) => sum + it.area, 0);
        if (items.length === 0) return { feasible: false, reason: 'empty' };

        const widths = items.map(it => it.width);
        const widest = Math.max(...widths);
        const longest = Math.max(...items.map(it => it.length));
        const sorted = [...items].sort((a, b) => b.length - a.length);

        const orientations = [{ name: 'längs', across: sheetWidth, along: sheetLength }];
        if (Math.abs(sheetWidth - sheetLength) > 1e-6) orientations.push({ name: 'quer', across: sheetLength, along: sheetWidth });

        // Teil in den Streifen mit der kleinsten Restlänge (bei Gleichstand der
        // schmalere – breite Streifen bleiben für breite Teile)
        const ziel = (sheetList, item, along) => {
            let target = null;
            sheetList.forEach(sheet => sheet.lanes.forEach(lane => {
                if (lane.width + 1e-6 < item.width) return;
                const left = along - lane.load - item.length;
                if (left < -1e-6) return;
                if (!target || left < target.left - 1e-6 || (Math.abs(left - target.left) <= 1e-6 && lane.width < target.lane.width)) target = { lane, left };
            }));
            return target;
        };
        const legen = (target, item) => {
            target.lane.items.push({ ...item, offset: target.lane.load });
            target.lane.load += item.length;
        };
        // Bewertung: weniger Tafeln, dann weniger Verschnitt in den Streifen (Teil
        // schmaler als sein Streifen), dann schmalerer Reststreifen am Rand, dann
        // weniger Streifen
        const bewerten = (sheets, o) => {
            let schlupf = 0, usedLanes = 0;
            sheets.forEach(sh => sh.lanes.forEach(l => {
                if (l.items.length) usedLanes++;
                l.items.forEach(it => { schlupf += (l.width - it.width) * it.length; });
            }));
            const rest = o.across - sheets[0].lanes.filter(l => l.items.length).reduce((s, l) => s + l.width, 0);
            return { sheets, orientation: o, usedLanes, schlupf, rest };
        };
        const besser = (a, b) => {
            if (!b) return true;
            if (a.sheets.length !== b.sheets.length) return a.sheets.length < b.sheets.length;
            if (Math.abs(a.schlupf - b.schlupf) > 1) return a.schlupf < b.schlupf;
            if (a.orientation.name !== b.orientation.name) return false;
            if (Math.abs(a.rest - b.rest) > 1e-6) return a.rest < b.rest;
            return a.usedLanes < b.usedLanes;
        };

        let best = null;
        let reason = 'narrow';
        orientations.forEach(o => {
            if (longest > o.along + 1e-6) { reason = reason === 'narrow' ? 'long' : reason; return; }
            if (widest > o.across + 1e-6) return;

            // a) dieselbe Streifenaufteilung auf allen Tafeln
            this.laneCombos(widths, o.across).forEach(laneWidths => {
                const newSheet = () => ({ lanes: laneWidths.map(width => ({ width, load: 0, items: [] })) });
                const sheets = [];
                for (const item of sorted) {
                    let target = ziel(sheets, item, o.along);
                    if (!target) {
                        const sheet = newSheet();
                        target = ziel([sheet], item, o.along);
                        if (!target) return;
                        sheets.push(sheet);
                    }
                    legen(target, item);
                }
                const kandidat = bewerten(sheets, o);
                if (besser(kandidat, best)) best = kandidat;
            });

            // b) jede Tafel mit eigener Aufteilung: Tafel für Tafel die Aufteilung,
            //    die am meisten der übrigen Teile aufnimmt (bei Gleichstand am
            //    wenigsten Verschnitt in den Streifen) – Teile liegen dann in Streifen
            //    ihrer eigenen Breite, der Verschnitt bleibt am Rand
            let uebrig = sorted.slice();
            const sheets = [];
            while (uebrig.length) {
                let beste = null;
                this.laneCombos(uebrig.map(it => it.width), o.across).forEach(laneWidths => {
                    const sheet = { lanes: laneWidths.map(width => ({ width, load: 0, items: [] })) };
                    const gelegt = new Set();
                    let flaeche = 0, schlupf = 0;
                    uebrig.forEach((item, i) => {
                        const target = ziel([sheet], item, o.along);
                        if (!target) return;
                        legen(target, item);
                        gelegt.add(i);
                        flaeche += item.area;
                        schlupf += (target.lane.width - item.width) * item.length;
                    });
                    if (!gelegt.size) return;
                    if (!beste || flaeche > beste.flaeche + 1e-6
                        || (Math.abs(flaeche - beste.flaeche) <= 1e-6 && schlupf < beste.schlupf - 1e-6)) {
                        beste = { sheet, gelegt, flaeche, schlupf };
                    }
                });
                if (!beste) break;
                beste.sheet.lanes = beste.sheet.lanes.filter(l => l.items.length);
                sheets.push(beste.sheet);
                uebrig = uebrig.filter((_, i) => !beste.gelegt.has(i));
            }
            if (!uebrig.length && sheets.length) {
                const kandidat = bewerten(sheets, o);
                if (besser(kandidat, best)) best = kandidat;
            }
        });

        if (!best) return { feasible: false, reason };

        const o = best.orientation;
        const sheets = best.sheets.map(sheet => {
            const usedWidth = sheet.lanes.reduce((sum, lane) => sum + lane.width, 0);
            return { lanes: sheet.lanes.filter(lane => lane.items.length > 0), usedWidth, restStrip: o.across - usedWidth };
        });
        const stockArea = sheets.length * sheetWidth * sheetLength;
        const waste = stockArea - totalArea;
        return {
            feasible: true,
            sheetWidth,
            sheetLength,
            orientation: o.name,
            across: o.across,
            along: o.along,
            sheets,
            sheetCount: sheets.length,
            // Reststreifen der ersten (vollen) Tafel; jede Tafel hat ihren eigenen (sheets[i].restStrip)
            restStrip: sheets[0].restStrip,
            partsArea: totalArea,
            stockArea,
            waste,
            wastePct: stockArea > 0 ? waste / stockArea * 100 : 0
        };
    }
}
