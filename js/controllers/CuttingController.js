import { globalEventBus } from '../utils/EventBus.js';
import { FeldMeldung } from '../utils/FeldMeldung.js';
import { coilSortsFor, densityFor, coilOptionsFor, coilsNeeded, sheetOptionsFor, MATERIAL_COILS } from '../utils/CoilCatalog.js';
import { CuttingOptimizer } from '../utils/CuttingOptimizer.js';

// "Abschnitte entsorgen" und Quittierung kommen erst mit der ERPNext-
// Einbindung (Rüstauftrag) – bis dahin in App und PDF ausgeblendet. Logik und
// gespeicherte Daten bleiben erhalten.
export const ERP_FEATURES_ENABLED = false;

/**
 * Tab "Zuschnitt": Rollen- oder Tafelware, Vergleich (Verschnitt je
 * Rollenbreite bzw. Tafelformat), Wahl durch den Nutzer, Zuschnitt-Grafik, Zuschnittliste zum Abhaken und
 * Quittierung. Die Daten (toJSON) sind so aufgebaut, dass daraus später ein
 * Rüstauftrag in ERPNext entstehen kann.
 *
 * Meldet jede Änderung mit 'cutting:changed' (Autosave).
 */
export class CuttingController {
    constructor(profile, cutlistController, projectController) {
        this.profile = profile;
        this.cutlistController = cutlistController;
        this.projectController = projectController;
        this.reset(false);

        this.root = document.getElementById('view-zuschnitt');
        if (this.root) {
            this.root.querySelectorAll('.erp-feature').forEach(el => el.classList.toggle('hidden', !ERP_FEATURES_ENABLED));
        }
        this.initPanels();
        this.initEvents();
    }

    reset(notify = true) {
        this.state = {
            stock: 'coil',     // 'coil' = Rollenware, 'sheet' = Tafelware
            sortName: '',      // Sorte 'Material|Ausführung' ('' = aus den Projektdaten)
            selectedKey: '',   // '' = automatisch die beste Rolle / Tafel
            customWidth: '',
            customSheetWidth: '',
            customSheetLength: '',
            nest: false,       // konische Teile paarweise verschachteln: nur, wenn angehakt
            solo: false,       // true = nur dieses Profil, auch wenn andere Profile das gleiche Material haben
            dispose: false,    // "Abschnitte entsorgen" – Funktion folgt mit ERPNext
            checked: {},       // Teil-Schlüssel 'p<Pos>-<Nr>' → true
            signoff: null      // { name, date, at, planKey }
        };
        if (notify) this.changed();
    }

    toJSON() {
        return JSON.parse(JSON.stringify(this.state));
    }

    fromJSON(data) {
        this.reset(false);
        if (!data || typeof data !== 'object') return;
        const s = this.state;
        if (data.stock === 'sheet') s.stock = 'sheet';
        if (typeof data.sortName === 'string') s.sortName = data.sortName;
        if (typeof data.selectedKey === 'string') s.selectedKey = data.selectedKey;
        if (data.customWidth !== undefined) s.customWidth = String(data.customWidth);
        if (data.customSheetWidth !== undefined) s.customSheetWidth = String(data.customSheetWidth);
        if (data.customSheetLength !== undefined) s.customSheetLength = String(data.customSheetLength);
        s.nest = data.nest === true;
        s.solo = data.solo === true;
        s.dispose = data.dispose === true;
        if (data.checked && typeof data.checked === 'object') {
            Object.keys(data.checked).forEach(k => { if (data.checked[k] === true) s.checked[k] = true; });
        }
        if (data.signoff && typeof data.signoff.name === 'string') {
            s.signoff = {
                name: data.signoff.name,
                date: String(data.signoff.date || ''),
                at: String(data.signoff.at || ''),
                planKey: String(data.signoff.planKey || '')
            };
        }
    }

    changed() {
        globalEventBus.emit('cutting:changed');
    }

    /**
     * Zuschnitt über mehrere Profile des Projekts: fn() liefert
     * { kandidaten, members: [{ prof, profId, name, active, positions, unfold, conical }] }
     * – die Profile mit gleichem Material, gleicher Ausführung, Dicke und Farbe
     * (das aktive mit active: true, seine Daten kommen aus dem Editor).
     */
    setGroupProvider(fn) {
        this.groupProvider = fn;
    }

    /** Profile, die gemeinsam zugeschnitten werden (mindestens das aktive) */
    groupMembers() {
        const selbst = { prof: 0, profId: '', name: '', active: true };
        const g = this.groupProvider ? this.groupProvider() : null;
        if (!g) return { kandidaten: 1, members: [selbst] };
        const aktiv = g.members.find(m => m.active) || selbst;
        return { kandidaten: g.kandidaten, members: this.state.solo || g.members.length < 2 ? [{ ...aktiv, einzeln: true }] : g.members };
    }

    isVisible() {
        return !!(this.root && this.root.classList.contains('active'));
    }

    // Neu zeichnen, falls der Tab gerade offen ist (z.B. nach Laden einer
    // Datei oder "Neu" – Material und Stückliste können sich geändert haben)
    refresh() {
        if (this.isVisible()) this.render();
    }

    // Akkordeon-Panels: offen/zu pro Browser merken (reine Komfortfunktion,
    // localStorage kann fehlen oder gesperrt sein)
    initPanels() {
        if (!this.root) return;
        const STORAGE_KEY = 'openbender.cutPanels';
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (e) { saved = {}; }

        this.root.querySelectorAll('details.cut-card[id]').forEach(panel => {
            if (typeof saved[panel.id] === 'boolean') panel.open = saved[panel.id];
            panel.addEventListener('toggle', () => {
                saved[panel.id] = panel.open;
                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch (e) { /* ohne Speicher weiter */ }
            });
        });
    }

    initEvents() {
        globalEventBus.on('profile:updated', () => { if (this.isVisible()) this.render(); });
        if (!this.root) return;

        this.root.addEventListener('change', (e) => {
            const t = e.target;
            if (t.name === 'cut-stock') {
                this.state.stock = t.value === 'sheet' ? 'sheet' : 'coil';
                this.state.selectedKey = '';
            } else if (t.id === 'cut-sort') {
                this.state.sortName = t.value;
                this.state.selectedKey = '';
            } else if (t.id === 'cut-custom-sheet-width' || t.id === 'cut-custom-sheet-length') {
                this.state[t.id === 'cut-custom-sheet-width' ? 'customSheetWidth' : 'customSheetLength'] = t.value;
                this.state.selectedKey = 'custom';
            } else if (t.name === 'cut-coil') {
                this.state.selectedKey = t.value;
            } else if (t.id === 'cut-custom-width') {
                this.state.customWidth = t.value;
                this.state.selectedKey = 'custom';
            } else if (t.id === 'chk-cut-nest') {
                this.state.nest = t.checked;
            } else if (t.id === 'chk-cut-gruppe') {
                this.state.solo = !t.checked;
                this.state.selectedKey = '';
            } else if (t.id === 'chk-cut-dispose') {
                this.state.dispose = t.checked;
            } else if (t.classList.contains('cut-check')) {
                // Zeile = alle Teile der Position
                this.setCheckedMany((t.dataset.keys || t.dataset.key || '').split(' ').filter(Boolean), t.checked);
                return;
            } else {
                return;
            }
            this.changed();
            this.render();
        });

        // Teil in der Grafik antippen = abhaken / Haken entfernen
        const pieceIn = (target) => target.closest && target.closest('#cut-graphic [data-key]');
        this.root.addEventListener('keydown', (e) => {
            const piece = pieceIn(e.target);
            if (piece && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                this.setChecked(piece.dataset.key, !this.state.checked[piece.dataset.key]);
            }
        });

        this.root.addEventListener('click', (e) => {
            const piece = pieceIn(e.target);
            if (piece) {
                this.setChecked(piece.dataset.key, !this.state.checked[piece.dataset.key]);
                return;
            }
            if (e.target.id === 'btn-cut-signoff') this.signOff();
            if (e.target.id === 'btn-cut-signoff-undo') {
                this.state.signoff = null;
                this.changed();
                this.render();
            }
        });
    }

    // Teil abhaken (Tabelle oder Grafik) und beide Ansichten nachführen
    setChecked(key, done) {
        this.setCheckedMany([key], done, key);
    }

    /** Mehrere Teile auf einmal ab- bzw. anhaken (Zeile der Zuschnittliste) */
    setCheckedMany(keys, done, focusKey = null) {
        keys.forEach(key => {
            if (done) this.state.checked[key] = true;
            else delete this.state.checked[key];
        });
        const key = focusKey;
        this.changed();

        // Liste neu ordnen (abgehakte nach unten), Grafik grün markieren;
        // Fokus für Tastatur behalten
        const result = this.compute();
        this.renderList(result);
        const graphic = document.getElementById('cut-graphic');
        if (graphic && result.selected && result.selected.plan.feasible) {
            const hadFocus = document.activeElement && graphic.contains(document.activeElement);
            graphic.innerHTML = result.sheet
                ? buildSheetSvg(result, this.state.checked, graphic.clientWidth || 1000)
                : buildCuttingSvg(result, this.state.checked, graphic.clientWidth || 1000);
            if (hadFocus) {
                const again = graphic.querySelector(`[data-key="${key}"]`);
                if (again) again.focus();
            }
        }
    }

    // --- Berechnung ---

    projectData() {
        return this.projectController ? this.projectController.getFormData() : {};
    }

    // Nur Materialien/Ausführungen der Stückliste (bei gesetztem Material dessen Ausführungen)
    availableSorts() {
        return coilSortsFor(this.projectData().materialType);
    }

    currentSort() {
        const sorts = this.availableSorts();
        const project = this.projectData();
        return sorts.find(s => s.key === this.state.sortName)
            || sorts.find(s => s.material === project.materialType && s.spec === project.materialSpec)
            || sorts[0];
    }

    /**
     * Alles, was Tab und PDF brauchen: Teile, Rollen-Optionen mit Plan,
     * beste und gewählte Option.
     */
    compute() {
        const project = this.projectData();
        const sort = this.currentSort();
        const unfold = this.profile.getUnfoldLengths();
        // Profile, die gemeinsam auf dieselbe Rolle / Tafel kommen (ein Profil: wie bisher)
        const { kandidaten, members: gruppe } = this.groupMembers();
        const gemeinsam = gruppe.length > 1;
        let farbe = 1;
        const members = gruppe.map(m => {
            const positions = m.active ? this.cutlistController.items : (m.positions || []);
            const mUnfold = m.active ? unfold : m.unfold;
            const mConical = m.active ? !!this.profile.conical : !!m.conical;
            const tag = gemeinsam ? { prof: m.prof, profId: m.profId, farbe } : null;
            farbe += positions.length;
            return { ...m, positions, unfold: mUnfold, conical: mConical, tag };
        });
        const conical = members.some(m => m.conical);
        const bauen = (nest) => CuttingOptimizer.mergeItems(members.map(m => CuttingOptimizer.buildItems(m.positions, m.unfold, m.conical, nest, m.tag)));
        const itemsInfo = bauen(false);
        // Verschachteln nur dort nutzen, wo es die Rolle besser ausnutzt: pro
        // Breite werden beide Varianten gerechnet und die bessere genommen
        // (Paare passen z.B. nicht auf schmale Rollen).
        const nestedInfo = conical && this.state.nest ? bauen(true) : null;

        const projectThickness = parseFloat(project.materialThickness) || 0;
        const density = (sort && sort.density) || densityFor(project.materialType);
        const sheet = this.state.stock === 'sheet';
        const allOptions = sheet ? sheetOptionsFor(sort, projectThickness) : coilOptionsFor(sort, projectThickness);
        const thicknessMatched = projectThickness > 0 && allOptions.some(o => Math.abs(o.thickness - projectThickness) < 1e-6);
        // Mit Materialstärke nur Rollen bzw. Tafeln in dieser Stärke (gibt es sie nicht: keine,
        // dann eigene Breite bzw. eigenes Tafelmass); ohne Stärke alle
        const catalogOptions = projectThickness > 0 ? (thicknessMatched ? allOptions : []) : allOptions;
        const defaultThickness = projectThickness || (catalogOptions[0] && catalogOptions[0].thickness) || 0;

        const options = catalogOptions.map(o => ({ ...o, custom: false }));
        if (sheet) {
            const w = parseFloat(this.state.customSheetWidth);
            const l = parseFloat(this.state.customSheetLength);
            if (w > 0 && l > 0) options.push({ key: 'custom', width: w, length: l, thickness: defaultThickness, custom: true });
        } else {
            const customWidth = parseFloat(this.state.customWidth);
            if (customWidth > 0) options.push({ key: 'custom', width: customWidth, thickness: defaultThickness, coilKg: [], custom: true });
        }

        // Rolle: kürzere Rollenlänge besser; Tafel: weniger Tafeln besser
        const better = sheet
            ? (a, b) => a.sheetCount < b.sheetCount || (a.sheetCount === b.sheetCount && a.waste < b.waste - 1e-6)
            : (a, b) => a.coilLength < b.coilLength - 1e-6 ||
                (Math.abs(a.coilLength - b.coilLength) <= 1e-6 && a.lanes.length < b.lanes.length);
        const planFor = (info, o) => sheet
            ? CuttingOptimizer.planForSheet(info, o.width, o.length)
            : CuttingOptimizer.planForWidth(info, o.width);

        options.forEach(o => {
            o.plan = planFor(itemsInfo, o);
            if (nestedInfo) {
                const nested = planFor(nestedInfo, o);
                if (nested.feasible && (!o.plan.feasible || better(nested, o.plan))) o.plan = nested;
            }
            if (o.plan.feasible) {
                o.kgPerM2 = o.thickness * density;
                if (sheet) {
                    o.plan.kg = o.plan.stockArea / 1e6 * o.kgPerM2;
                } else {
                    o.plan.kg = o.width / 1000 * o.plan.coilLength / 1000 * o.kgPerM2;
                    o.coils = coilsNeeded(o.plan, o.width, o.thickness, density, o.coilKg);
                }
            }
        });

        const area = (o) => o.width * (o.length || 0);
        const feasible = options.filter(o => o.plan.feasible && !o.custom);
        const best = feasible.reduce((b, o) => (!b || o.plan.wastePct < b.plan.wastePct - 1e-9 ||
            (Math.abs(o.plan.wastePct - b.plan.wastePct) <= 1e-9 && (o.width < b.width || (o.width === b.width && area(o) < area(b))))) ? o : b, null);

        let selected = options.find(o => o.key === this.state.selectedKey && o.plan.feasible) || best;

        return {
            project, sort, unfold, itemsInfo, options, best, selected, sheet,
            // gemeinsam zugeschnittene Profile [{ prof, profId, name, unfold, conical }] und Anzahl möglicher
            members, kandidaten, gemeinsam,
            pieceCount: itemsInfo.items.reduce((n, it) => n + it.pieces.length, 0),
            thicknessMatched, projectThickness, conical
        };
    }

    // Kennung des Zuschnitts, um Änderungen nach der Quittierung zu erkennen
    planKey(result) {
        const s = result.selected;
        if (!s || !s.plan.feasible) return '';
        const lanesKey = (lanes) => lanes.map(l => `${Math.round(l.width)}:${l.items.map(i => i.pieces.map(p => `${p.prof ? `${p.prof}:` : ''}${p.pos}.${p.k}@${Math.round(p.length)}`).join('+')).join(',')}`).join(';');
        if (result.sheet) return `sheet|${s.key}|${s.plan.orientation}|${s.plan.sheets.map(sh => lanesKey(sh.lanes)).join('/')}`;
        return `${s.key}|${lanesKey(s.plan.lanes)}`;
    }

    // Zuschnittliste in der Reihenfolge, in der die Rolle abgewickelt und
    // geschnitten wird: Querreihe für Querreihe vom Rollenanfang her
    // (Abstand vom Anfang), innerhalb einer Querreihe Streifen 1, 2, 3 …
    // Tafeln: Tafel für Tafel, darin gleich wie bei der Rolle.
    listRows(result) {
        const rows = [];
        const s = result.selected;
        if (!s || !s.plan.feasible) return rows;
        const sheets = result.sheet ? s.plan.sheets : [{ lanes: s.plan.lanes }];
        sheets.forEach((sheet, sheetIndex) => sheet.lanes.forEach((lane, laneIndex) => {
            lane.items.forEach(item => {
                const { front, back } = item;
                item.pieces.forEach((piece, pi) => {
                    // Eigene Breite des Teils – es kann in einem breiteren Streifen liegen
                    let cut = `${fmtMm(item.width)} breit`;
                    if (item.kind === 'trap') cut = `konisch ${fmtMm(front)} → ${fmtMm(back)}`;
                    if (item.kind === 'pair') {
                        const other = item.pieces[1 - pi];
                        cut = `konisch ${fmtMm(pi === 0 ? front : back)} → ${fmtMm(pi === 0 ? back : front)}, Paar mit Pos. ${posName(other)}/${other.k} (Schrägschnitt)`;
                    }
                    rows.push({
                        key: pieceKey(piece),
                        sheet: sheetIndex + 1,
                        offset: item.offset,
                        sub: pi,
                        lane: laneIndex + 1,
                        laneLabel: result.sheet ? `${sheetIndex + 1} / ${laneIndex + 1}` : String(laneIndex + 1),
                        pos: posName(piece),
                        k: piece.k,
                        quantity: piece.quantity,
                        length: piece.length,
                        cut
                    });
                });
            });
        }));
        // Auf 0.1 mm gleiche Anfänge gelten als eine Querreihe
        const at = (r) => Math.round(r.offset * 10);
        rows.sort((a, b) => a.sheet - b.sheet || at(a) - at(b) || a.lane - b.lane || a.sub - b.sub);
        return rows;
    }

    /**
     * Daten für den PDF-Export (null, wenn kein Zuschnitt möglich ist).
     */
    getPdfData() {
        const result = this.compute();
        if (!result.selected || !result.selected.plan.feasible) return null;
        return {
            result,
            rows: this.listRows(result),
            checked: { ...this.state.checked },
            dispose: this.state.dispose,
            signoff: this.state.signoff,
            signoffOutdated: !!(this.state.signoff && this.state.signoff.planKey !== this.planKey(result))
        };
    }

    signOff() {
        const nameEl = document.getElementById('cut-signoff-name');
        const dateEl = document.getElementById('cut-signoff-date');
        const name = nameEl ? nameEl.value.trim() : '';
        if (!name) {
            FeldMeldung.zeigen(nameEl, 'Bitte einen Namen für die Quittierung eingeben.');
            return;
        }
        const result = this.compute();
        const rows = this.listRows(result);
        const open = rows.filter(r => !this.state.checked[r.key]).length;
        if (open > 0 && !window.confirm(`${open} Teil(e) sind noch nicht abgehakt. Trotzdem quittieren?`)) return;

        this.state.signoff = {
            name,
            date: (dateEl && dateEl.value) || todayIso(),
            at: new Date().toISOString(),
            planKey: this.planKey(result)
        };
        this.changed();
        this.render();
    }

    // --- Darstellung ---

    render() {
        if (!this.root) return;
        const result = this.compute();
        if (this.renderLeer(result)) return;
        this.renderSettings(result);
        this.renderCompare(result);
        this.renderPlan(result);
        this.renderList(result);
        this.renderSignoff(result);
    }

    /**
     * Leerer Zustand: ohne Profil oder ohne Teile in der Stückliste statt leerer Karten
     * ein Hinweis mit Knopf zum nächsten Schritt. true = nichts weiter zu zeigen.
     */
    renderLeer(result) {
        const leer = document.getElementById('cut-leer');
        const panels = ['cut-panel-coil', 'cut-panel-plan', 'cut-panel-list'].map(id => document.getElementById(id)).filter(Boolean);
        const ohneProfil = !(result.unfold && result.unfold.front > 0);
        const ohneTeile = result.pieceCount === 0;
        const istLeer = ohneProfil || ohneTeile;
        if (leer) {
            leer.classList.toggle('hidden', !istLeer);
            if (istLeer) {
                const [titel, text, knopf, tab] = ohneProfil
                    ? ['Noch kein Profil', 'Zeichne zuerst das Blechprofil – die Abwicklung bestimmt die Breite der Streifen.', '📐 Zum Profil', 'tab-btn-profile']
                    : ['Noch keine Teile zum Zuschneiden', 'Erfasse in der Stückliste die Positionen mit Länge und Stückzahl, dazu Material und Materialstärke. Dann rechnet der Zuschnitt die beste Rolle oder Tafel.', '📋 Zur Stückliste', 'tab-btn-cutlist'];
                leer.innerHTML = `<h3>${titel}</h3><p>${text}</p><button type="button" class="btn-primary-touch cut-leer-btn" data-tab="${tab}">${knopf}</button>`;
                leer.querySelector('button').addEventListener('click', () => {
                    const btn = document.getElementById(tab);
                    if (btn) btn.click();
                });
            }
        }
        panels.forEach(p => p.classList.toggle('hidden', istLeer));
        return istLeer;
    }

    renderSettings(result) {
        this.root.querySelectorAll('input[name="cut-stock"]').forEach(r => { r.checked = r.value === this.state.stock; });
        const title = document.getElementById('cut-stock-title');
        if (title) title.textContent = result.sheet ? 'Tafel wählen' : 'Rolle wählen';
        const listLaneHead = document.getElementById('cut-list-lane-head');
        if (listLaneHead) listLaneHead.textContent = result.sheet ? 'Tafel / Streifen' : 'Streifen';

        const sortSel = document.getElementById('cut-sort');
        if (sortSel) {
            sortSel.innerHTML = '';
            this.availableSorts().forEach(s => sortSel.add(new Option(s.name, s.key)));
            sortSel.value = result.sort ? result.sort.key : '';
        }

        const info = document.getElementById('cut-material-info');
        if (info) {
            const p = result.project;
            const thicknessText = result.projectThickness > 0 ? `${result.projectThickness} mm` : 'nicht angegeben';
            const unfoldText = result.conical
                ? `vorne ${fmtMm(result.unfold.front)} · hinten ${fmtMm(result.unfold.back)}`
                : fmtMm(result.unfold.front);
            const stockText = result.sheet ? 'als Tafel' : 'als Rolle';
            let note = '';
            if (!p.materialType) note = 'Kein Material in den Projektdaten – alle Sorten zur Auswahl. Die Sorte kommt sonst aus der Stückliste & Projekt.';
            else if (!MATERIAL_COILS[p.materialType]) note = `Material „${p.materialType}“ ist hier nicht bekannt (nicht in den Einstellungen) – bitte die Sorte wählen. Gewicht und Rollen rechnen mit der gewählten Sorte.`;
            else if (result.projectThickness > 0 && !result.thicknessMatched) note = `Dicke ${result.projectThickness} mm gibt es in dieser Sorte nicht ${stockText} – ${result.sheet ? 'eigenes Tafelmass eingeben oder Rollenware wählen' : 'eigene Rollenbreite eingeben oder Tafelware wählen'}.`;
            else if (result.options.every(o => o.custom)) note = result.sheet ? 'Für diese Sorte sind keine Tafeln erfasst – eigenes Tafelmass eingeben.' : 'Für diese Sorte sind keine Rollen erfasst – eigene Rollenbreite eingeben oder Tafelware wählen.';
            else if (!(result.projectThickness > 0)) note = 'Keine Materialstärke in den Projektdaten – alle Dicken angezeigt.';
            // mehrere Profile gemeinsam: je Profil Name und Abwicklung
            const abw = (m) => (m.conical ? `${fmtMm(m.unfold.front)} / ${fmtMm(m.unfold.back)}` : fmtMm(m.unfold.front));
            const profile = result.gemeinsam
                ? ` · Profile: <strong>${result.members.map(m => `${m.prof} ${escapeHtml(m.name)} (${abw(m)})`).join(', ')}</strong>`
                : ` · Abwicklung: <strong>${unfoldText}</strong>`;
            info.innerHTML = `Material: <strong>${escapeHtml(p.materialType || '–')}</strong> · Dicke: <strong>${thicknessText}</strong>${profile} · Teile: <strong>${result.pieceCount}</strong>`
                + (note ? `<div class="cut-note">${escapeHtml(note)}</div>` : '');
        }

        // Zuschnitt über mehrere Profile: nur anbieten, wenn es weitere Profile mit gleichem Material gibt
        const gruppeRow = document.getElementById('cut-gruppe-row');
        if (gruppeRow) {
            gruppeRow.classList.toggle('hidden', !(result.kandidaten > 1));
            const chk = document.getElementById('chk-cut-gruppe');
            if (chk) chk.checked = !this.state.solo;
            const text = document.getElementById('cut-gruppe-text');
            if (text) text.textContent = `Alle ${result.kandidaten} Profile mit gleichem Material gemeinsam zuschneiden (gleiche Rolle bzw. Tafel)`;
        }
        const nestRow = document.getElementById('cut-nest-row');
        if (nestRow) nestRow.classList.toggle('hidden', !result.conical);
        const nest = document.getElementById('chk-cut-nest');
        if (nest) nest.checked = this.state.nest;
        const dispose = document.getElementById('chk-cut-dispose');
        if (dispose) dispose.checked = this.state.dispose;
        const custom = document.getElementById('cut-custom-width');
        if (custom && document.activeElement !== custom) custom.value = this.state.customWidth;
        [['cut-custom-sheet-width', 'customSheetWidth'], ['cut-custom-sheet-length', 'customSheetLength']].forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (el && document.activeElement !== el) el.value = this.state[key];
        });
        const customCoil = document.getElementById('cut-custom-coil');
        if (customCoil) customCoil.classList.toggle('hidden', result.sheet);
        const customSheet = document.getElementById('cut-custom-sheet');
        if (customSheet) customSheet.classList.toggle('hidden', !result.sheet);
    }

    renderCompare(result) {
        const head = document.getElementById('cut-compare-head');
        if (head) {
            head.innerHTML = result.sheet
                ? '<tr><th></th><th>Tafel (Breite × Länge × Dicke)</th><th class="cut-col-lanes">Streifen</th><th>Tafeln</th><th class="cut-col-kg">Bedarf</th><th>Verschnitt</th></tr>'
                : '<tr><th></th><th>Rolle (Breite × Dicke)</th><th class="cut-col-lanes">Streifen</th><th>Rollenlänge</th><th class="cut-col-kg">Bedarf</th><th>Verschnitt</th><th>Rollen</th></tr>';
        }
        const body = document.getElementById('cut-compare-body');
        if (!body) return;
        const cols = result.sheet ? 6 : 7;

        if (result.pieceCount === 0) {
            body.innerHTML = `<tr><td colspan="${cols}" class="cut-empty">Noch keine Positionen in der Stückliste.</td></tr>`;
            return;
        }
        if (result.options.length === 0) {
            const dicke = result.projectThickness > 0 && !result.thicknessMatched ? ` in ${result.projectThickness} mm` : '';
            body.innerHTML = `<tr><td colspan="${cols}" class="cut-empty">${result.sheet ? `Keine Tafeln${dicke} für diese Sorte erfasst.` : `Keine Rollen${dicke} für diese Sorte erfasst.`}</td></tr>`;
            return;
        }

        const rows = result.options.map(o => {
            const p = o.plan;
            const isSel = result.selected && result.selected.key === o.key;
            const isBest = result.best && result.best.key === o.key;
            let label;
            if (result.sheet) {
                label = o.custom ? `Eigenes Mass ${o.width} × ${o.length} mm` : `${o.width} × ${o.length} × ${o.thickness} mm`;
            } else {
                label = o.custom
                    ? `Eigene Breite ${fmtMm(o.width)}`
                    : `${o.width} × ${o.thickness} mm${o.coilKg.length ? ` <span class="cut-kg">(${o.coilKg.join(' / ')} kg)</span>` : ''}`;
            }
            if (!p.feasible) {
                const why = p.reason === 'long' ? 'Teil länger als die Tafel' : 'zu schmal für die Abwicklung';
                return `<tr class="cut-row-disabled"><td><input type="radio" name="cut-coil" disabled></td><td>${label}</td><td colspan="${cols - 2}">${why}</td></tr>`;
            }
            const waste = `<td><div class="cut-waste"><span class="cut-waste-bar" style="width:${Math.min(100, p.wastePct).toFixed(1)}%"></span><span>${p.wastePct.toFixed(1)} %</span></div></td>`;
            const first = `<td><input type="radio" name="cut-coil" value="${o.key}" ${isSel ? 'checked' : ''}></td>
                <td>${label}${isBest ? ' <span class="cut-best">beste</span>' : ''}</td>`;
            if (result.sheet) {
                return `<tr class="${isSel ? 'cut-row-selected' : ''}">${first}
                    <td class="cut-col-lanes">${describeSheetLanes(p, result.itemsInfo)}</td>
                    <td><strong>${p.sheetCount}</strong></td>
                    <td class="cut-col-kg">${p.kg.toFixed(1)} kg</td>
                    ${waste}
                </tr>`;
            }
            return `<tr class="${isSel ? 'cut-row-selected' : ''}">${first}
                <td class="cut-col-lanes">${describeLanes(p, result.itemsInfo)}</td>
                <td>${fmtM(p.coilLength)}</td>
                <td class="cut-col-kg">${p.kg.toFixed(1)} kg</td>
                ${waste}
                <td class="cut-col-coils">${coilCountText(o.coils && o.coils[0])}</td>
            </tr>`;
        });
        body.innerHTML = rows.join('');
    }

    renderPlan(result) {
        const summary = document.getElementById('cut-summary');
        const graphic = document.getElementById('cut-graphic');
        const s = result.selected;
        if (!summary || !graphic) return;

        if (!s || !s.plan.feasible) {
            const none = result.sheet
                ? 'Keine passende Tafel – bitte ein grösseres Tafelmass wählen.'
                : 'Keine passende Rolle – bitte eine breitere Rolle wählen.';
            // Ohne erfasste Tafeln/Rollen steht der Hinweis schon bei der Auswahl
            summary.innerHTML = result.pieceCount === 0 || result.options.length === 0 ? '' : `<p class="cut-empty">${none}</p>`;
            graphic.innerHTML = '';
            return;
        }

        const p = s.plan;
        const kachel = (titel, wert, klein = '') => `<div class="cut-kachel"><span class="cut-kachel-titel">${titel}</span><strong>${wert}</strong>${klein ? `<small>${klein}</small>` : ''}</div>`;
        const rest = p.restStrip > 0.5 ? `Reststreifen ${fmtMm(p.restStrip)}` : '';
        const verschnitt = kachel('Verschnitt', `${(p.waste / 1e6).toFixed(2)} m²`, `${p.wastePct.toFixed(1)} % · ${(p.waste / 1e6 * s.kgPerM2).toFixed(1)} kg`);
        if (result.sheet) {
            summary.innerHTML = `<div class="cut-kacheln">
                ${kachel('Bedarf', `${p.sheetCount} ${p.sheetCount === 1 ? 'Tafel' : 'Tafeln'}`, `${s.width} × ${s.length} mm · ${p.kg.toFixed(1)} kg`)}
                ${kachel('Aufspalten', describeSheetLanes(p, result.itemsInfo), rest)}
                ${verschnitt}
            </div>`;
            graphic.innerHTML = buildSheetSvg(result, this.state.checked, graphic.clientWidth || 1000) + planLegende(result);
            return;
        }
        summary.innerHTML = `<div class="cut-kacheln">
            ${kachel('Bedarf', fmtM(p.coilLength), `Rollen: ${coilsSummary(s.coils)}`)}
            ${kachel('1. Ablängen', describeSections(p), 'Querschnitt über die ganze Breite')}
            ${kachel('2. Aufspalten', describeLanes(p, result.itemsInfo), ['jeden Abschnitt', rest].filter(Boolean).join(' · '))}
            ${verschnitt}
        </div>`;
        graphic.innerHTML = buildCuttingSvg(result, this.state.checked, graphic.clientWidth || 1000) + planLegende(result);
    }

    renderList(result) {
        const body = document.getElementById('cut-list-body');
        if (!body) return;
        const rows = this.listRows(result);
        if (rows.length === 0) {
            body.innerHTML = '<tr><td colspan="5" class="cut-empty">Keine Teile.</td></tr>';
        } else {
            // Eine Zeile pro Position (gleiche Länge und gleicher Zuschnitt). Offene
            // oben (Plan-Reihenfolge), ganz abgehakte darunter. Einzelne Teile
            // lassen sich weiterhin in der Grafik abhaken.
            const gruppen = listGroups(rows, result.sheet, this.state.checked);
            const open = gruppen.filter(g => g.done < g.n);
            const done = gruppen.filter(g => g.done === g.n);
            const stueck = (g) => (g.n === g.quantity ? String(g.n) : `${g.n} von ${g.quantity}`)
                + (g.done > 0 && g.done < g.n ? ` <span class="cut-kg">(${g.done}/${g.n} erledigt)</span>` : '');
            const rowHtml = (g, isDone) => `<tr class="${isDone ? 'cut-row-done' : ''}">
                <td><input type="checkbox" class="touch-checkbox cut-check" data-keys="${g.keys.join(' ')}" ${isDone ? 'checked' : ''}${g.done > 0 && !isDone ? ' data-teilweise="1"' : ''} aria-label="Pos. ${escapeHtml(g.pos)} erledigt"></td>
                <td data-label="Pos.">${escapeHtml(g.pos)} <span class="cut-kg">· ${stueck(g)} Stk.</span></td>
                <td data-label="${result.sheet ? 'Tafel / Streifen' : 'Streifen'}">${escapeHtml(g.ort)}</td>
                <td data-label="Länge">${fmtLen(g.length)}</td>
                <td data-label="Zuschnitt">${escapeHtml(g.cut)}</td>
            </tr>`;
            body.innerHTML = open.map(g => rowHtml(g, false)).join('')
                + (done.length ? `<tr class="cut-done-sep"><td colspan="5">✔ Zugeschnitten (${done.reduce((n, g) => n + g.n, 0)} Teile)</td></tr>` : '')
                + done.map(g => rowHtml(g, true)).join('');
            body.querySelectorAll('[data-teilweise]').forEach(c => { c.indeterminate = true; });
        }
        this.renderProgress(rows);
    }

    renderProgress(rows = this.listRows(this.compute())) {
        const el = document.getElementById('cut-progress');
        if (!el) return;
        const done = rows.filter(r => this.state.checked[r.key]).length;
        el.textContent = rows.length ? `${done} von ${rows.length} Teilen abgehakt` : '';
    }

    renderSignoff(result) {
        const box = document.getElementById('cut-signoff');
        if (!box) return;
        const so = this.state.signoff;
        if (so) {
            const outdated = so.planKey !== this.planKey(result);
            box.innerHTML = `<p class="cut-signed">✔ Quittiert von <strong>${escapeHtml(so.name)}</strong> am <strong>${escapeHtml(formatDate(so.date))}</strong></p>`
                + (outdated ? '<p class="cut-note">⚠ Der Zuschnitt wurde nach der Quittierung geändert.</p>' : '')
                + '<button type="button" id="btn-cut-signoff-undo" class="dxf-btn">Quittierung aufheben</button>';
        } else {
            box.innerHTML = `<div class="cut-signoff-fields">
                <div class="form-group"><label for="cut-signoff-name">Name</label><input type="text" id="cut-signoff-name" placeholder="z.B. Max Muster"></div>
                <div class="form-group"><label for="cut-signoff-date">Datum</label><input type="date" id="cut-signoff-date" value="${todayIso()}"></div>
            </div>
            <button type="button" id="btn-cut-signoff" class="dxf-btn dxf-btn-primary">Auftrag quittieren</button>`;
        }
    }
}

// --- Hilfsfunktionen (auch vom PDF-Export genutzt) ---

/**
 * Zuschnittliste pro Position statt pro Teil: gleiche Position, gleiche Länge
 * und gleicher Zuschnitt werden eine Zeile (Reihenfolge wie im Plan). Für Tab
 * und PDF. Zeile: { keys, pos, n, quantity, length, cut, ort, done }
 * ort z.B. "Tafel 1–4 · Str. 1–5" bzw. "Streifen 1–2".
 */
export function listGroups(rows, sheet, checked = {}) {
    const gruppen = [];
    const nachKey = new Map();
    rows.forEach(r => {
        const k = `${r.pos}|${Math.round(r.length * 10)}|${r.cut}`;
        let g = nachKey.get(k);
        if (!g) {
            g = { keys: [], pos: r.pos, n: 0, quantity: r.quantity, length: r.length, cut: r.cut, sheets: new Set(), lanes: new Set(), labels: [] };
            nachKey.set(k, g);
            gruppen.push(g);
        }
        g.keys.push(r.key);
        g.n += 1;
        g.sheets.add(r.sheet);
        g.lanes.add(r.lane);
        g.labels.push(r.laneLabel);
    });
    return gruppen.map(g => ({
        keys: g.keys,
        pos: g.pos,
        n: g.n,
        quantity: g.quantity,
        length: g.length,
        cut: g.cut,
        ort: g.n === 1 ? g.labels[0]
            : sheet ? `Tafel ${bereich(g.sheets)} · Str. ${bereich(g.lanes)}` : `Streifen ${bereich(g.lanes)}`,
        done: g.keys.filter(k => checked[k]).length
    }));
}

// Zahlenmenge kurz: 1–5 bzw. 1, 3, 4
function bereich(zahlen) {
    const z = [...zahlen].sort((a, b) => a - b);
    const teile = [];
    for (let i = 0; i < z.length; i++) {
        let j = i;
        while (j + 1 < z.length && z[j + 1] === z[j] + 1) j++;
        teile.push(j - i >= 2 ? `${z[i]}–${z[j]}` : z.slice(i, j + 1).join(', '));
        i = j;
    }
    return teile.join(', ');
}

export function fmtMm(v) {
    const r = Math.round(v * 10) / 10;
    return `${Number.isInteger(r) ? r : r.toFixed(1)} mm`;
}

export function fmtM(mm) {
    return `${(mm / 1000).toFixed(2)} m`;
}

// Teillängen millimetergenau (3 Stellen in m, wie in der Stückliste)
export function fmtLen(mm) {
    return `${(mm / 1000).toFixed(3)} m`;
}

// Rollenanzahl für ein Rollengewicht, z.B. "1 × 100 kg"
export function coilCountText(entry) {
    if (!entry) return '–';
    if (!entry.fits) return `Teil länger als ${entry.kg}-kg-Rolle`;
    return `${entry.count} × ${entry.kg} kg`;
}

// Alle lieferbaren Rollengewichte als Alternativen, z.B.
// "wahlweise 1 × 100 kg (25.9 m je Rolle) oder 1 × 500 kg (129.5 m je Rolle)"
export function coilsSummary(coils) {
    if (!coils || coils.length === 0) return 'Rollengewicht unbekannt (eigene Breite)';
    const teile = coils.map(c => c.fits
        ? `${c.count} × ${c.kg} kg (${fmtM(c.coilLength)} je Rolle)`
        : `${c.kg}-kg-Rolle zu kurz für das längste Teil`);
    return teile.length > 1 ? `wahlweise ${teile.join(' oder ')}` : teile[0];
}

// Abschnitte zum Ablängen, gleiche Längen zusammengefasst, z.B. "2 × 2.500 m + 2 × 2.350 m"
export function describeSections(plan) {
    const groups = new Map();
    (plan.sections || []).forEach(s => {
        const key = Math.round(s.length * 10) / 10;
        groups.set(key, (groups.get(key) || 0) + 1);
    });
    return [...groups.entries()].map(([l, n]) => `${n} × ${fmtLen(l)}`).join(' + ');
}

/** Legende unter der Zuschnitt-Grafik: Farbe je Position mit Stückzahl und Länge, dann die Linien */
function planLegende(result) {
    const s = result.selected;
    const lanes = result.sheet ? s.plan.sheets.flatMap(sh => sh.lanes) : s.plan.lanes;
    const pos = new Map();
    lanes.forEach(l => l.items.forEach(it => it.pieces.forEach(p => {
        const e = pos.get(posName(p)) || { n: 0, length: p.length, piece: p };
        e.n++;
        pos.set(posName(p), e);
    })));
    // mehrere Profile: Name des Profils vor der Position
    const profilText = (p) => {
        const m = p.prof ? (result.members || []).find(x => x.prof === p.prof) : null;
        return m ? `${escapeHtml(m.name)} · ` : '';
    };
    const eintraege = [...pos.values()].sort((a, b) => (a.piece.farbe || a.piece.pos) - (b.piece.farbe || b.piece.pos)).map(e =>
        `<span><i class="cut-leg-farbe" style="background:${posFarbe(e.piece)}"></i>${profilText(e.piece)}Pos. ${posName(e.piece)} · ${e.n} × ${fmtLen(e.length)}</span>`);
    const linien = [
        ...(result.sheet ? [] : ['<span><i class="cut-leg-quer"></i>Querschnitt (zuerst ablängen)</span>']),
        '<span><i class="cut-leg-laengs"></i>Längsschnitt</span>',
        '<span><i class="cut-leg-rest"></i>Verschnitt</span>',
        '<span><i class="cut-leg-done"></i>zugeschnitten (Teil antippen)</span>'
    ];
    const hinweis = result.sheet
        ? `Tafel ${s.width} × ${s.length} mm, Streifen ${s.plan.orientation === 'quer' ? 'quer (Tafel hochkant gezeichnet)' : 'längs'} · massstäblich`
        : 'Länge und Breite unterschiedlich skaliert';
    return `<div class="cut-legende"><div>${eintraege.join('')}</div><div>${linien.join('')}</div><small>${hinweis}</small></div>`;
}

/**
 * Was beim Aufspalten aus einem Streifen entsteht: gerade Teile in Streifenbreite,
 * konische Teile (vorne → hinten) bzw. Paare, die mit einem Schrägschnitt
 * getrennt werden – nicht einfach die Streifenbreite (info = result.itemsInfo).
 */
function streifenText(lane, info) {
    const arten = new Set(lane.items.map(it => it.kind));
    if (!info || (!arten.has('pair') && !arten.has('trap'))) return { text: fmtMm(lane.width), konisch: false };
    // Abwicklungen des konischen Teils in diesem Streifen (mehrere Profile: je Teil eigene)
    const k = lane.items.find(it => it.kind !== 'rect') || info;
    const konisch = `konisch ${fmtMm(k.front)} → ${fmtMm(k.back)}`;
    const breit = fmtMm(Math.max(k.front, k.back));
    let text = arten.has('pair')
        ? `${konisch}, je 2 Teile mit Schrägschnitt aus ${fmtMm(lane.width)}${arten.has('trap') ? ` (einzelnes Teil: ${breit} breit)` : ''}`
        : konisch;
    if (arten.has('rect')) text += `, gerade Teile ${breit}`;
    return { text, konisch: true };
}

function streifenGruppen(lanes, info) {
    const groups = new Map();
    lanes.forEach(l => {
        const s = streifenText(l, info);
        const g = groups.get(s.text) || { n: 0, konisch: s.konisch };
        g.n++;
        groups.set(s.text, g);
    });
    return groups;
}

export function describeLanes(plan, info = null) {
    return [...streifenGruppen(plan.lanes, info).entries()]
        .map(([t, g]) => (g.konisch && g.n === 1 ? t : `${g.n} × ${t}`)).join(' + ');
}

// Tafel: Richtung und Streifen, z.B. "je Tafel längs 3 × 333 mm". Haben die
// Tafeln verschiedene Aufteilungen: "Tafel 1–4 längs 5 × 200 mm; Tafel 5–8 längs 6 × 165 mm"
export function describeSheetLanes(plan, info = null) {
    const text = (sheet) => [...streifenGruppen(sheet.lanes, info).entries()]
        .map(([t, g]) => (g.konisch && g.n === 1 ? t : `${g.n} × ${t}`)).join(' + ');
    const teile = [];
    plan.sheets.forEach((sheet, i) => {
        const t = text(sheet);
        const letzte = teile[teile.length - 1];
        if (letzte && letzte.text === t) letzte.bis = i + 1;
        else teile.push({ von: i + 1, bis: i + 1, text: t });
    });
    if (teile.length === 1) return `je Tafel ${plan.orientation} ${teile[0].text}`;
    return teile.map(x => `Tafel ${x.von === x.bis ? x.von : `${x.von}–${x.bis}`} ${plan.orientation} ${x.text}`).join('; ');
}

export function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso || '');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Umrisse der Teile eines Elements in Rollen-Koordinaten (mm: x entlang der
 * Rolle, y quer, laneY = Streifenbeginn), für App-Grafik und PDF:
 * [{ piece, poly: [[x, y], ×4] }]. Konische Teile massstäblich (Breiten
 * vorne/hinten im Verhältnis zur Streifenbreite), vorne bei x0.
 */
export function itemShapes(item, laneY, front = item.front, back = item.back) {
    // jedes Element kennt seine Abwicklungen (mehrere Profile auf einer Rolle)
    if (item.front !== undefined) { front = item.front; back = item.back; }
    const x0 = item.offset;
    const x1 = item.offset + item.length;
    const w = item.width;
    if (item.kind === 'rect') {
        return [{ piece: item.pieces[0], poly: [[x0, laneY], [x1, laneY], [x1, laneY + w], [x0, laneY + w]] }];
    }

    if (item.kind === 'trap') {
        return [{ piece: item.pieces[0], poly: [[x0, laneY], [x1, laneY], [x1, laneY + back], [x0, laneY + front]] }];
    }

    // Paar: zusammen vorne + hinten (= Streifenbreite), gemeinsame Schräge
    return [
        { piece: item.pieces[0], poly: [[x0, laneY], [x1, laneY], [x1, laneY + back], [x0, laneY + front]] },
        { piece: item.pieces[1], poly: [[x0, laneY + front], [x1, laneY + back], [x1, laneY + front + back], [x0, laneY + front + back]] }
    ];
}

// Schlüssel zum Abhaken; bei mehreren Profilen mit der Kennung des Profils
export const pieceKey = (piece) => (piece.profId ? `p${piece.pos}-${piece.k}@${piece.profId}` : `p${piece.pos}-${piece.k}`);
// Position zum Anzeigen: bei mehreren Profilen „<Profil>-<Pos.>“
export const posName = (piece) => piece.name || String(piece.pos);

// Eine Farbe je Position (gleich in App, Legende und PDF), damit man die Teile einer Position im Plan wiederfindet
const POS_FILLS = ['#aed6f1', '#f9c99b', '#d2b4de', '#f7dc6f', '#a3e4d7', '#f5b7b1', '#d5dbdb', '#abebc6'];
export const posFill = (pos) => POS_FILLS[(Math.max(1, pos) - 1) % POS_FILLS.length];
export const posFillRgb = (pos) => { const h = posFill(pos).slice(1); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
// Farbe eines Teils (mehrere Profile: fortlaufend über alle Positionen)
export const posFarbe = (piece) => posFill(piece.farbe || piece.pos);
export const posFarbeRgb = (piece) => posFillRgb(piece.farbe || piece.pos);
const SVG_DEFS = `<defs>
            <pattern id="cut-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="8" height="8" fill="#f4f6f7"/><line x1="0" y1="0" x2="0" y2="8" stroke="#c0c6cc" stroke-width="2"/>
            </pattern>
            <pattern id="cut-done" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                <rect width="8" height="8" fill="#d5f5e3"/><line x1="0" y1="0" x2="0" y2="8" stroke="#27ae60" stroke-width="2.5"/>
            </pattern>
        </defs>`;

// Ein Teil als antippbares Polygon mit Beschriftung (pts in Pixeln)
function pieceSvg(pts, piece, done, fill) {
    // Antippbar: hakt das Teil ab (CuttingController.setChecked)
    const key = pieceKey(piece);
    const name = `Pos. ${posName(piece)} (${piece.k}/${piece.quantity}), ${fmtLen(piece.length)}`;
    let svg = `<polygon class="cut-piece" data-key="${key}" tabindex="0" role="checkbox" aria-checked="${done}" aria-label="${name} zugeschnitten" points="${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}" fill="${fill}" stroke="#2c3e50" stroke-width="1"><title>${name} – antippen zum ${done ? 'Zurücksetzen' : 'Abhaken'}</title></polygon>`;

    const x0 = pts[0][0], x1 = pts[1][0];
    const cy = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
    const boxH = Math.min(Math.abs(pts[3][1] - pts[0][1]), Math.abs(pts[2][1] - pts[1][1]));
    // Beschriftung je nach Platz: eine Zeile (breit), zwei Zeilen
    // (Pos. + Länge, wenn hoch genug), nur Pos. oder nur die Nummer
    const pieceW = x1 - x0;
    const tick = done ? '✔ ' : '';
    let lines = [];
    if (pieceW > 160) lines = [`${tick}Pos. ${posName(piece)} · ${fmtLen(piece.length)}`];
    else if (pieceW > 70 && boxH >= 40) lines = [`${tick}Pos. ${posName(piece)}`, fmtLen(piece.length)];
    else if (pieceW > 66) lines = [`${tick}Pos. ${posName(piece)}`];
    else if (pieceW > 22) lines = [posName(piece)];
    if (lines.length && boxH > 17) {
        const cx = ((x0 + x1) / 2).toFixed(1);
        const firstY = cy + 5 - (lines.length - 1) * 8.5;
        svg += `<text pointer-events="none" text-anchor="middle" font-size="15" fill="${done ? '#1e8449' : '#2c3e50'}" font-weight="${done ? 'bold' : 'normal'}">`
            + lines.map((line, i) => `<tspan x="${cx}" y="${(firstY + i * 17).toFixed(1)}">${line}</tspan>`).join('')
            + '</text>';
    }
    return svg;
}

/**
 * Zuschnitt-Grafik als SVG: Rolle von oben (Länge nach rechts, Breite nach
 * unten), Streifen untereinander, Teile hintereinander. Längs- und
 * Querrichtung sind unterschiedlich skaliert (Rollen sind oft viel länger
 * als breit); Verschnitt grau schraffiert, abgehakte (zugeschnittene)
 * Teile grün schraffiert.
 */
// Touch: jedes Teil mindestens so gross wie eine Fingerkuppe (Pixel)
const MIN_PIECE_PX_ALONG = 64;
const MIN_PIECE_PX_ACROSS = 44;

export function buildCuttingSvg(result, checked = {}, availableWidth = 1000) {
    const s = result.selected;
    const plan = s.plan;
    const { front, back } = result.itemsInfo;

    // Kürzestes Teil (längs) und schmalstes Teil (quer) bestimmen den Massstab,
    // damit jedes Teil gut antippbar bleibt. Reicht die Breite des Bildschirms
    // nicht, wird die Grafik breiter und lässt sich seitlich wischen.
    const items = plan.lanes.flatMap(lane => lane.items);
    const minLength = Math.min(...items.map(it => it.length));
    const minAcross = Math.min(...items.map(it => it.kind === 'rect' ? it.width : Math.min(it.front ?? front, it.back ?? back)));

    const left = 10, top = 28, right = 70;
    const baseDrawW = Math.max(300, availableWidth - left - right);
    const drawW = Math.min(12000, Math.max(baseDrawW, plan.coilLength * MIN_PIECE_PX_ALONG / minLength));
    const sx = drawW / plan.coilLength;
    const sy = Math.max(MIN_PIECE_PX_ACROSS / minAcross, 110 / s.width);
    const drawH = Math.min(900, s.width * sy);
    const W = left + drawW + right;
    const H = top + drawH + 14;
    // Passt die Grafik in die verfügbare Breite, füllt sie diese; sonst
    // in echter Pixelgrösse (Container scrollt seitlich)
    const cssWidth = W > availableWidth + 1 ? `${Math.round(W)}px` : '100%';

    const X = (mm) => left + mm * sx;
    const Y = (mm) => top + mm * sy;

    let svg = `<svg class="cut-svg" style="width:${cssWidth}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Zuschnitt-Plan">
        ${SVG_DEFS}
        <rect x="${X(0)}" y="${Y(0)}" width="${drawW}" height="${drawH}" fill="url(#cut-hatch)" stroke="#7f8c8d" stroke-width="1.5"/>`;

    let laneY = 0;
    plan.lanes.forEach(lane => {
        lane.items.forEach(item => {
            itemShapes(item, laneY, front, back).forEach(({ piece, poly }) => {
                const pts = poly.map(([x, y]) => [X(x), Y(y)]);
                const done = !!checked[pieceKey(piece)];
                svg += pieceSvg(pts, piece, done, done ? 'url(#cut-done)' : posFarbe(piece));
            });
        });
        laneY += lane.width;
        // Längsschnitt zwischen den Streifen
        svg += `<line x1="${X(0)}" y1="${Y(laneY).toFixed(1)}" x2="${X(plan.coilLength)}" y2="${Y(laneY).toFixed(1)}" stroke="#c0392b" stroke-width="1" stroke-dasharray="6 4"/>`;
    });
    // Querschnitte (Ablängen) über die ganze Rollenbreite, zwischen den Abschnitten
    (plan.sections || []).slice(1).forEach(sec => {
        svg += `<line x1="${X(sec.start).toFixed(1)}" y1="${Y(0) - 6}" x2="${X(sec.start).toFixed(1)}" y2="${(Y(0) + drawH + 6).toFixed(1)}" stroke="#2471a3" stroke-width="2"/>`;
    });

    svg += `<text x="${X(plan.coilLength / 2)}" y="${top - 10}" text-anchor="middle" font-size="14" fill="#2c3e50">Rollenlänge ${fmtM(plan.coilLength)}</text>`;
    svg += `<text x="${X(plan.coilLength) + 8}" y="${Y(s.width / 2) + 5}" font-size="14" fill="#2c3e50">${fmtMm(s.width)}</text>`;
    svg += '</svg>';
    return svg;
}

/**
 * Zuschnitt-Grafik für Tafelware: jede Tafel massstäblich (Länge und
 * Breite gleich skaliert), Streifenrichtung nach rechts – bei Querzuschnitt
 * liegt die Tafel also hochkant. Mehrere Tafeln nebeneinander und in
 * Reihen; reicht der Platz nicht für antippbare Teile, scrollt die Grafik.
 */
export function buildSheetSvg(result, checked = {}, availableWidth = 1000) {
    const s = result.selected;
    const plan = s.plan;
    const { front, back } = result.itemsInfo;
    const A = plan.along, C = plan.across;
    const n = plan.sheets.length;

    const items = plan.sheets.flatMap(sh => sh.lanes.flatMap(lane => lane.items));
    const minLength = Math.min(...items.map(it => it.length));
    const minAcross = Math.min(...items.map(it => it.kind === 'rect' ? it.width : Math.min(it.front ?? front, it.back ?? back)));
    const sMin = Math.max(MIN_PIECE_PX_ALONG / minLength, MIN_PIECE_PX_ACROSS / minAcross);

    const pad = 10, gap = 24, labelH = 22, legendH = 4;
    const avail = Math.max(300, availableWidth - 2 * pad);
    const cols = Math.max(1, Math.min(n, 3, Math.floor((avail + gap) / (A * sMin + gap))));
    let scale = (avail - (cols - 1) * gap) / (cols * A);
    scale = Math.min(scale, 360 / C);   // Tafeln nicht übergross
    scale = Math.max(scale, sMin);      // Teile bleiben antippbar
    const sheetW = A * scale, sheetH = C * scale;
    const rowsCount = Math.ceil(n / cols);
    const W = 2 * pad + cols * sheetW + (cols - 1) * gap;
    const H = rowsCount * (labelH + sheetH + gap) + legendH;
    const cssWidth = W > availableWidth + 1 ? `${Math.round(W)}px` : '100%';

    let svg = `<svg class="cut-svg" style="width:${cssWidth}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Zuschnitt-Plan Tafeln">
        ${SVG_DEFS}`;

    plan.sheets.forEach((sheet, i) => {
        const ox = pad + (i % cols) * (sheetW + gap);
        const oy = Math.floor(i / cols) * (labelH + sheetH + gap) + labelH;
        const X = (mm) => ox + mm * scale;
        const Y = (mm) => oy + mm * scale;
        const done = sheet.lanes.every(l => l.items.every(it => it.pieces.every(p => checked[pieceKey(p)])));
        svg += `<text x="${ox}" y="${oy - 7}" font-size="13" font-weight="bold" fill="${done ? '#1e8449' : '#2c3e50'}">${done ? '✔ ' : ''}Tafel ${i + 1}</text>`;
        svg += `<rect x="${ox}" y="${oy}" width="${sheetW.toFixed(1)}" height="${sheetH.toFixed(1)}" fill="url(#cut-hatch)" stroke="#7f8c8d" stroke-width="1.5"/>`;

        let laneY = 0;
        sheet.lanes.forEach(lane => {
            lane.items.forEach(item => {
                itemShapes(item, laneY, front, back).forEach(({ piece, poly }) => {
                    const pts = poly.map(([x, y]) => [X(x), Y(y)]);
                    const isDone = !!checked[pieceKey(piece)];
                    svg += pieceSvg(pts, piece, isDone, isDone ? 'url(#cut-done)' : posFarbe(piece));
                });
            });
            laneY += lane.width;
            if (laneY < C - 0.5) {
                svg += `<line x1="${X(0)}" y1="${Y(laneY).toFixed(1)}" x2="${X(A)}" y2="${Y(laneY).toFixed(1)}" stroke="#c0392b" stroke-width="1" stroke-dasharray="6 4"/>`;
            }
        });
    });

    svg += '</svg>';
    return svg;
}
