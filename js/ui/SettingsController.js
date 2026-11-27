/**
 * Einstellungen (⚙️ in der Statusleiste): Tabs Allgemein, Module, Material,
 * Shortcuts. Das Gerüst steht in index.html (#settings-overlay).
 *
 * - Allgemein: Speicherordner (Inhalt von main.js, updateStorageOption)
 * - Module:    Funktionen und Verwaltung der Module (ModuleUI.mountManager)
 * - Material:  mitgelieferte und eigene Materialien, Darstellung in 3D mit
 *              Schiebereglern und Vorschau (Materials.js); im ERP-Betrieb die
 *              verknüpften Artikel
 * - Shortcuts: Tastenkürzel (statisch)
 */
import { Materials, CHANGED_EVENT, cleanMaterial } from '../utils/Materials.js';
import { MATERIAL_COILS, MATERIAL_SHEETS } from '../utils/CoilCatalog.js';
import { MATERIAL_SPECS } from '../utils/MaterialData.js';
import { sheetLook, sheetMaterial, sheetEnvironment, applySheetLook } from '../utils/SheetLook.js';
import { Textures, TEXTURE_SIZE } from '../utils/Textures.js';
import { ErpStorage } from '../storage/ErpStorage.js';
import { Toast } from '../utils/Toast.js';
import { escapeHtml } from '../modules/ModuleUI.js';

const fmt = (v) => String(Math.round(v * 1000) / 1000);
const listText = (arr) => arr.map(fmt).join(', ');
// Zahlenliste aus Text: { values } oder { error }. Trenner Strichpunkt, Leerzeichen
// oder Komma mit Leerzeichen („0.6, 0.7“); bei Dezimalzahlen ist ein Komma ohne
// Leerzeichen das Dezimalkomma („0,6“), bei ganzen Zahlen auch ein Trenner („200,250“).
// Mehrdeutiges wie „0,6,0,7“ gibt einen Fehler statt falscher Werte.
function parseList(text, decimal, label) {
    const t = String(text || '').trim();
    if (!t) return { values: [] };
    const parts = t.split(decimal ? /[;\s]+|,\s+/ : /[;,\s]+/).filter(Boolean);
    const values = [];
    for (const p of parts) {
        if (!/^\d+([.,]\d+)?$/.test(p)) {
            return { error: `${label}: „${p}“ ist keine Zahl. Mehrere Werte mit Strichpunkt oder Komma und Leerzeichen trennen, z.B. „0.6; 0.7“ oder „0.6, 0.7“.` };
        }
        values.push(parseFloat(p.replace(',', '.')));
    }
    return { values };
}
// Tafelformate „1000x2000, 1250×2500“: { values } oder { error }
function parseSheets(text) {
    const values = [];
    for (const p of String(text || '').split(/[;,\n]+/).map(x => x.trim()).filter(Boolean)) {
        const m = p.replace(/\s/g, '').match(/^(\d+(?:[.]\d+)?)[x×*](\d+(?:[.]\d+)?)$/i);
        if (!m) return { error: `Tafelformat „${p}“ nicht erkannt – Breite x Länge in mm, z.B. „1000x2000“.` };
        values.push([parseFloat(m[1]), parseFloat(m[2])]);
    }
    return { values };
}

export class SettingsController {
    /**
     * deps: { moduleUI, onShowGeneral(), currentMaterial() → { type, spec } }
     */
    constructor(deps) {
        this.deps = deps;
        this.overlay = document.getElementById('settings-overlay');
        if (!this.overlay) return;
        this.tabs = [...this.overlay.querySelectorAll('.settings-tabs [data-tab]')];
        this.pages = [...this.overlay.querySelectorAll('.settings-page')];
        this.materialPage = this.overlay.querySelector('[data-page="material"]');
        this.modulePage = this.overlay.querySelector('[data-page="module"]');
        this.selected = null;          // gewähltes Material (Name) oder '' = neues Material
        this.artikel = null;           // ERP: verknüpfte Artikel (null = noch nicht geladen)
        this.saveTimer = null;
        this.busy = 0;                 // laufende Speichervorgänge (eigene Änderungsmeldungen nicht neu zeichnen)
        this.formDirty = false;        // Formular des eigenen Materials geändert, nicht gespeichert
        this.lookSpec = '';            // Darstellung für: '' = alle Ausführungen, sonst eine Ausführung
        this.textureList = null;       // [{ id, name, builtin }] (Textures.list)

        this.tabs.forEach(btn => btn.addEventListener('click', () => this.showTab(btn.dataset.tab)));
        this.overlay.querySelector('#settings-close').addEventListener('click', () => this.close());
        this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.close(); });
        document.addEventListener('keydown', (e) => {
            // Dialog über den Einstellungen (Rückfrage) schliesst zuerst sich selbst
            if (e.key === 'Escape' && this.isOpen() && !document.querySelector('.module-dialog-overlay')) this.close();
        });
        this.materialPage.addEventListener('click', (e) => this.onMaterialClick(e));
        this.materialPage.addEventListener('input', (e) => this.onMaterialInput(e));
        this.materialPage.addEventListener('change', (e) => this.onMaterialChange(e));
        // Enter im Formular speichert
        this.materialPage.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.matches('[data-f]')) {
                e.preventDefault();
                const btn = this.materialPage.querySelector('.mat-form [data-do="save"]');
                if (btn) btn.click();
            }
        });
        document.addEventListener(CHANGED_EVENT, () => {
            if (!this.isOpen() || this.currentTab !== 'material' || this.busy > 0) return;
            if (this.formDirty) this.renderPending = true; else this.renderMaterials();
        });
    }

    isOpen() {
        return this.overlay && !this.overlay.classList.contains('hidden');
    }

    open(tab = 'allgemein') {
        if (!this.overlay) return;
        // Material-Tab zeigt zuerst das Material des aktuellen Profils
        const cur = this.deps.currentMaterial ? this.deps.currentMaterial() : null;
        if (cur && cur.type && Materials.list().some(m => m.name === cur.type)) {
            this.selected = cur.type;
            this.lookSpec = Materials.hasSpecLook(cur.type, cur.spec) || Materials.hasBuiltinSpecLook(cur.type, cur.spec) ? cur.spec : '';
        }
        this.formDirty = false;
        this.overlay.classList.remove('hidden');
        this.showTab(tab);
    }

    /** Ungespeicherte Änderungen im Formular verwerfen? (true = weiter) */
    async discardOk() {
        if (!this.formDirty) return true;
        const ui = this.deps.moduleUI;
        const ok = ui ? await ui.confirm('Änderungen verwerfen?', 'Die Angaben zum Material sind noch nicht gespeichert.') : true;
        if (ok) this.formDirty = false;
        return ok;
    }

    async close() {
        if (!this.overlay) return;
        if (this.formDirty && !(await this.discardOk())) return;
        this.flushSave();
        this.overlay.classList.add('hidden');
        if (this.deps.moduleUI) this.deps.moduleUI.unmountManager();
        this.disposePreview();
    }

    async showTab(tab) {
        // nur bei ungespeichertem Formular warten (Rückfrage), sonst sofort wechseln
        if (this.formDirty && this.currentTab === 'material' && tab !== 'material' && this.isOpen()) {
            if (!(await this.discardOk())) return;
        }
        this.currentTab = tab;
        this.tabs.forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tab);
            b.setAttribute('aria-selected', String(b.dataset.tab === tab));
        });
        this.pages.forEach(p => p.classList.toggle('active', p.dataset.page === tab));
        if (tab === 'allgemein' && this.deps.onShowGeneral) this.deps.onShowGeneral();
        if (tab === 'module' && this.deps.moduleUI) this.deps.moduleUI.mountManager(this.modulePage);
        else if (this.deps.moduleUI) this.deps.moduleUI.unmountManager();
        if (tab === 'material') {
            this.renderMaterials();
            if (this.textureList === null) this.loadTextures();
            if (ErpStorage.isActive() && this.artikel === null) this.loadArtikel();
        } else {
            this.disposePreview();
        }
    }

    // --- Material ------------------------------------------------------------

    async loadArtikel() {
        try {
            this.artikel = (await ErpStorage.call('material_artikel')) || [];
        } catch (e) {
            console.warn('Verknüpfte Artikel:', e);
            this.artikel = [];
            this.artikelFehler = e.message || String(e);
        }
        if (!this.isOpen() || this.currentTab !== 'material') return;
        if (this.formDirty) this.renderPending = true; else this.renderMaterials();
    }

    async loadTextures() {
        this.textureList = await Textures.list();
        if (!this.isOpen() || this.currentTab !== 'material') return;
        if (this.formDirty) this.renderPending = true; else this.renderDetail();
    }

    linkedItems(name) {
        return (this.artikel || []).filter(a => a.ob_material === name);
    }

    statusHtml() {
        const st = Materials.state();
        const erp = ErpStorage.isActive();
        let html = `<p class="opt-note">${escapeHtml(Materials.ort())}</p>`;
        if (st.source === 'waiting') {
            html += '<p class="settings-warn">Der Speicherordner wartet auf die Freigabe. <button type="button" class="status-btn" data-do="grant">Zugriff erlauben</button></p>';
        } else if (!st.loaded) {
            html += `<p class="settings-warn">${escapeHtml(st.error || 'Keine Ablage für eigene Materialien.')} Die mitgelieferten Materialien gehen trotzdem; Änderungen an der Darstellung gelten nur bis zum Neuladen.</p>`;
        } else if (st.readOnly) {
            html += '<p class="settings-warn">Eigene Materialien und Darstellung ändern dürfen in ERPNext nur Projektleiter (Projects Manager).</p>';
        }
        if (erp && this.artikelFehler) html += `<p class="settings-warn">Verknüpfte Artikel konnten nicht geladen werden: ${escapeHtml(this.artikelFehler)}</p>`;
        return html;
    }

    renderMaterials() {
        const page = this.materialPage;
        const list = Materials.list();
        if (this.selected !== '' && !list.some(m => m.name === this.selected)) this.selected = list[0] ? list[0].name : null;
        const erp = ErpStorage.isActive();
        const badge = (name) => {
            if (!erp || this.artikel === null) return '';
            const n = this.linkedItems(name).length;
            return n ? `<span class="mat-link ok" title="${n} Artikel in ERPNext verknüpft">🔗 ${n}</span>` : '<span class="mat-link" title="Kein Artikel in ERPNext verknüpft">–</span>';
        };
        const item = (m) => `<button type="button" class="mat-item${m.name === this.selected ? ' active' : ''}" data-do="select" data-name="${escapeHtml(m.name)}">
                <span class="mat-swatch" style="background:${escapeHtml(Materials.look(m.name).color)}"></span>
                <span class="mat-name">${escapeHtml(m.name)}</span>${badge(m.name)}</button>`;
        const own = list.filter(m => !m.builtin);
        page.innerHTML = `${this.statusHtml()}
            <div class="mat-layout">
                <div class="mat-list" role="listbox" aria-label="Materialien">
                    <div class="mat-group">Mitgeliefert</div>
                    ${list.filter(m => m.builtin).map(item).join('')}
                    <div class="mat-group">Eigene Materialien</div>
                    ${own.map(item).join('') || '<div class="mat-empty">noch keine</div>'}
                    <button type="button" class="status-btn mat-new${this.selected === '' ? ' active' : ''}" data-do="new" ${Materials.canSave() ? '' : 'disabled'}>+ Neues Material</button>
                </div>
                <div class="mat-detail"></div>
            </div>`;
        this.renderDetail();
        this.swatchTextures();
    }

    /** Farbtupfer der Liste: bei einer Textur das Bild */
    swatchTextures() {
        this.materialPage.querySelectorAll('.mat-item[data-name]').forEach(btn => {
            const specs = MATERIAL_SPECS[btn.dataset.name] || [];
            const look = Materials.look(btn.dataset.name, specs[0]);
            const sw = btn.querySelector('.mat-swatch');
            if (!sw || !look.texture) return;
            Textures.url(look.texture.id).then(u => {
                if (u) { sw.style.backgroundImage = `url("${u.replace(/"/g, '%22')}")`; sw.style.backgroundSize = 'cover'; }
            });
        });
    }

    renderDetail() {
        const box = this.materialPage.querySelector('.mat-detail');
        if (!box) return;
        this.disposePreview();
        this.formDirty = false;
        this.renderPending = false;
        const name = this.selected;
        if (name === null) { box.innerHTML = ''; return; }
        const isNew = name === '';
        const builtin = !isNew && Materials.isBuiltin(name);
        const custom = isNew ? null : Materials.custom(name);
        const specs = isNew ? [] : (MATERIAL_SPECS[name] || []);
        if (this.lookSpec && !specs.includes(this.lookSpec)) this.lookSpec = '';
        const spec = this.lookSpec;
        const look = isNew ? (this.newLook || (this.newLook = { color: '#8a939c', metalness: 0.4, roughness: 0.45 })) : Materials.look(name, spec);
        const canSave = Materials.canSave();
        const linked = ErpStorage.isActive() && !isNew && this.linkedItems(name).length > 0;
        const pct = (v) => Math.round(v * 100);

        let sortiment;
        if (builtin) {
            const coils = MATERIAL_COILS[name];
            const specs = MATERIAL_SPECS[name] || [];
            const all = specs.flatMap(s => { const e = coils.specs[s] || []; return Array.isArray(e) ? e : e.coils; });
            const widths = [...new Set(all.map(c => c[0]))].sort((a, b) => a - b);
            const thick = [...new Set(all.map(c => c[1]))].sort((a, b) => a - b);
            const sheets = specs.flatMap(s => (MATERIAL_SHEETS[name] || {})[s] || []);
            const formats = [...new Set(sheets.map(t => `${t[0]}×${t[1]}`))];
            sortiment = `<dl class="mat-facts">
                    <dt>Ausführungen</dt><dd>${escapeHtml(specs.join(', '))}</dd>
                    <dt>Dichte</dt><dd>${fmt(coils.density)} kg/dm³</dd>
                    <dt>Dicken (Rolle)</dt><dd>${escapeHtml(listText(thick))} mm</dd>
                    <dt>Rollenbreiten</dt><dd>${escapeHtml(listText(widths))} mm</dd>
                    <dt>Tafeln</dt><dd>${escapeHtml(formats.join(', ') || '–')}</dd>
                </dl>
                <p class="opt-note">Mitgelieferte Materialien lassen sich nicht ändern, nur ihre Darstellung. Für ein anderes Sortiment ein eigenes Material anlegen.</p>`;
        } else {
            const m = custom || { name: '', specs: [], density: '', thicknesses: [], coilWidths: [], coilKg: [100], sheets: [] };
            const ro = canSave ? '' : 'disabled';
            sortiment = `<div class="mat-form">
                    <label>Name<input type="text" data-f="name" value="${escapeHtml(m.name)}" maxlength="40" placeholder="z.B. Messing" ${ro || (linked ? 'disabled title="Mit Artikeln in ERPNext verknüpft – Name gesperrt"' : '')}></label>
                    <label>Ausführungen<input type="text" data-f="specs" value="${escapeHtml(m.specs.join(', '))}" placeholder="z.B. Blank, Patiniert (leer = Standard)" ${ro}></label>
                    <label>Dichte (kg/dm³)<input type="text" inputmode="decimal" data-f="density" value="${m.density === '' ? '' : fmt(m.density)}" placeholder="z.B. 8.5" ${ro}></label>
                    <label>Dicken (mm)<input type="text" inputmode="decimal" data-f="thicknesses" value="${escapeHtml(listText(m.thicknesses))}" placeholder="z.B. 0.6, 0.7, 0.8" ${ro}></label>
                    <label>Rollenbreiten (mm)<input type="text" inputmode="decimal" data-f="coilWidths" value="${escapeHtml(listText(m.coilWidths))}" placeholder="z.B. 200, 250, 333, 500, 670, 1000" ${ro}></label>
                    <label>Rollengewichte (kg)<input type="text" inputmode="decimal" data-f="coilKg" value="${escapeHtml(listText(m.coilKg))}" placeholder="z.B. 100, 500" ${ro}></label>
                    <label>Tafelformate (mm)<input type="text" data-f="sheets" value="${escapeHtml(m.sheets.map(s => `${fmt(s[0])}x${fmt(s[1])}`).join(', '))}" placeholder="z.B. 1000x2000, 1250x2500" ${ro}></label>
                    <p class="opt-note">Jede Rollenbreite und jedes Tafelformat gilt für alle Dicken und Ausführungen. Nur Rollen oder nur Tafeln geht auch.${linked ? ' Der Name ist gesperrt, weil Artikel in ERPNext mit diesem Material verknüpft sind.' : custom ? ' Umbenennen: bereits gespeicherte Dateien behalten den alten Namen und zeigen ihn als „nicht in den Einstellungen“.' : ''}</p>
                    <div class="mat-form-error" hidden></div>
                    <div class="mat-form-actions">
                        ${custom ? `<button type="button" class="dxf-btn" data-do="delete" ${ro}>Löschen</button>` : ''}
                        <button type="button" class="dxf-btn dxf-btn-primary" data-do="save" ${ro}>${isNew ? 'Material anlegen' : 'Speichern'}</button>
                    </div>
                </div>`;
        }

        let erpHtml = '';
        if (ErpStorage.isActive() && !isNew) {
            const items = this.linkedItems(name);
            erpHtml = `<h4>Verknüpfte Artikel (ERPNext)</h4>` + (this.artikel === null
                ? '<p class="opt-note">wird geladen …</p>'
                : items.length
                    ? `<table class="mat-items"><thead><tr><th>Artikel</th><th>Sorte</th><th>Dicke</th><th>Lieferform</th></tr></thead><tbody>${items.map(a => `<tr>
                        <td><a href="/app/item/${encodeURIComponent(a.name)}" target="_blank" rel="noopener">${escapeHtml(a.item_name || a.name)}</a></td>
                        <td>${escapeHtml(a.ob_sorte || 'alle')}</td><td>${fmt(a.ob_dicke || 0)} mm</td><td>${escapeHtml(a.ob_lieferform || '')}</td></tr>`).join('')}</tbody></table>`
                    : '<p class="opt-note">Noch kein Artikel verknüpft: im Artikel (Abschnitt „openBender“) „Mit openBender verknüpft“ setzen und dieses Material wählen. Ohne Artikel gibt es keine Bestandsprüfung und Lagerbuchung.</p>');
        }

        this.lastTextureId = look.texture ? look.texture.id : '';
        box.innerHTML = `<div class="mat-head">
                <h3>${isNew ? 'Neues Material' : escapeHtml(name)}</h3>
                <span class="mat-kind">${isNew ? '' : builtin ? 'mitgeliefert' : 'eigenes Material'}</span>
            </div>
            <div class="mat-look">
                <div class="mat-preview" aria-label="Vorschau der Darstellung"></div>
                <div class="mat-sliders">
                    <h4>Darstellung in 3D</h4>
                    ${this.lookControlsHtml(name, look, { isNew, builtin, specs, spec, canSave })}
                </div>
            </div>
            <h4>Sortiment</h4>
            ${sortiment}
            ${erpHtml}`;
        this.initPreview(box.querySelector('.mat-preview'), look);
    }

    /** Regler der Darstellung (Ausführung, Farbe, Glanz, Rauheit, Textur) */
    lookControlsHtml(name, look, { isNew, builtin, specs, spec, canSave }) {
        const pct = (v) => Math.round(v * 100);
        const tex = look.texture || null;
        const list = this.textureList || [];
        const opt = (t) => `<option value="${escapeHtml(t.id)}" ${tex && tex.id === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`;
        const known = !tex || list.some(t => t.id === tex.id);
        const ownSelected = tex && tex.id.startsWith('eigen:') && known;
        const specSel = specs.length > 1 || (specs.length === 1 && specs[0] !== 'Standard')
            ? `<label class="mat-slider">Gilt für<select data-spec>
                    <option value="">Alle Ausführungen</option>
                    ${specs.map(x => `<option value="${escapeHtml(x)}" ${x === spec ? 'selected' : ''}>${escapeHtml(x)}${Materials.hasSpecLook(name, x) ? ' ●' : ''}</option>`).join('')}
                </select><span></span></label>`
            : '';
        const own = spec && Materials.hasSpecLook(name, spec);
        const supplied = spec && Materials.hasBuiltinSpecLook(name, spec);
        const inherits = spec && !own && !supplied;
        let buttons = '';
        if (own) buttons = `<button type="button" class="status-btn" data-do="spec-reset">${supplied ? 'Zurücksetzen' : 'Wie alle Ausführungen'}</button>`;
        else if (!spec && builtin) buttons = '<button type="button" class="status-btn" data-do="reset-look">Zurücksetzen</button>';
        const off = tex ? '' : 'disabled';
        return `${specSel}
            <label class="mat-slider">Farbe<input type="color" data-look="color" value="${escapeHtml(look.color)}"><span></span></label>
            <label class="mat-slider">Metallglanz<input type="range" min="0" max="100" step="1" data-look="metalness" value="${pct(look.metalness)}"><output>${pct(look.metalness)} %</output></label>
            <label class="mat-slider">Rauheit<input type="range" min="0" max="100" step="1" data-look="roughness" value="${pct(look.roughness)}"><output>${pct(look.roughness)} %</output></label>
            <label class="mat-slider">Textur<select data-look="texture">
                    <option value="">keine</option>
                    <optgroup label="Mitgeliefert">${list.filter(t => t.builtin).map(opt).join('')}</optgroup>
                    ${list.some(t => !t.builtin) ? `<optgroup label="Eigene">${list.filter(t => !t.builtin).map(opt).join('')}</optgroup>` : ''}
                    ${known ? '' : `<option value="${escapeHtml(tex.id)}" selected>${escapeHtml(tex.id.replace(/^\w+:/, ''))} (fehlt)</option>`}
                </select><span></span></label>
            <div class="mat-tex-actions">
                <button type="button" class="status-btn" data-do="tex-add">Eigene Textur …</button>
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-input="texture">
                ${ownSelected ? '<button type="button" class="status-btn" data-do="tex-del">Textur löschen</button>' : ''}
            </div>
            <label class="mat-slider">Bildbreite<input type="number" min="10" max="10000" step="10" data-look="size" value="${tex ? fmt(tex.size) : TEXTURE_SIZE}" ${off}><output>mm</output></label>
            <label class="mat-check"><input type="checkbox" data-look="rotate" ${tex && tex.rotate ? 'checked' : ''} ${off}> Textur um 90° drehen</label>
            <label class="mat-check"><input type="checkbox" data-look="alpha" ${tex && tex.alpha ? 'checked' : ''} ${off}> Alphakanal als Löcher (z.B. Lochblech)</label>
            ${buttons}
            <p class="opt-note">${inherits ? `„${escapeHtml(spec)}“ übernimmt die Darstellung aller Ausführungen; eine Änderung gilt nur für „${escapeHtml(spec)}“. ` : ''}${supplied && !own ? `Mitgelieferte Darstellung von „${escapeHtml(spec)}“; eine Änderung gilt nur für diese Ausführung. ` : ''}${!spec && builtin && MATERIAL_SPECS[name] && MATERIAL_SPECS[name].some(x => Materials.hasBuiltinSpecLook(name, x)) ? 'Die Ausführungen haben eigene Texturen (unter „Gilt für“); Glanz und Rauheit von hier gelten auch dort. ' : ''}${tex ? 'Die Farbe färbt die Textur ein (Weiss = Originalfarben). ' : ''}${isNew ? 'Wird mit dem Material gespeichert.' : canSave ? 'Wird automatisch gespeichert.' : 'Gilt nur bis zum Neuladen (keine Ablage).'}</p>`;
    }

    readLook() {
        const box = this.materialPage.querySelector('.mat-sliders');
        const get = (k) => box.querySelector(`[data-look="${k}"]`);
        const look = {
            color: get('color').value,
            metalness: Number(get('metalness').value) / 100,
            roughness: Number(get('roughness').value) / 100
        };
        const id = get('texture').value;
        if (id) {
            look.texture = {
                id,
                size: Math.min(10000, Math.max(10, Number(get('size').value) || 1000)),
                rotate: get('rotate').checked,
                alpha: get('alpha').checked
            };
        }
        return look;
    }

    /** Textur gewechselt: Vorgaben setzen (Bildbreite, Alphakanal, Farbe weiss) */
    onTextureSelected(sel) {
        const box = this.materialPage.querySelector('.mat-sliders');
        const get = (k) => box.querySelector(`[data-look="${k}"]`);
        const id = sel.value;
        const had = this.lastTextureId;
        this.lastTextureId = id;
        ['size', 'rotate', 'alpha'].forEach(k => { get(k).disabled = !id; });
        if (!id) return;
        const b = Textures.builtin(id);
        get('size').value = TEXTURE_SIZE;
        get('alpha').checked = !!(b && b.alpha);
        get('rotate').checked = false;
        if (!had) get('color').value = '#ffffff';
    }

    onMaterialChange(e) {
        const el = e.target;
        if (el.matches('[data-spec]')) { this.changeLookSpec(el); return; }
        if (el.matches('[data-input="texture"]')) { this.addTexture(el); return; }
        // Checkboxen und Auswahl lösen in älteren Browsern kein input aus
        if (el.matches('select[data-look], input[type="checkbox"][data-look]') && !el.dataset.handled) this.onMaterialInput(e);
        delete el.dataset.handled;
    }

    async changeLookSpec(sel) {
        const value = sel.value;
        if (!(await this.discardOk())) { sel.value = this.lookSpec; return; }
        await this.flushSave();
        this.lookSpec = value;
        this.renderDetail();
    }

    async addTexture(input) {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        try {
            const { id, alpha } = await Textures.add(file);
            this.textureList = await Textures.list();
            Toast.show(alpha ? 'Textur hinzugefügt – durchsichtige Stellen werden als Löcher dargestellt.' : 'Textur hinzugefügt.', 'info', alpha ? 5000 : 3000);
            // gleich verwenden
            const formDirty = this.formDirty;
            const look = this.readLook();
            look.texture = { id, size: TEXTURE_SIZE, rotate: false, alpha };
            if (!this.lastTextureId) look.color = '#ffffff';
            this.applyLook(look);
            if (!formDirty) this.renderDetail();
            else { this.renderPending = true; }
        } catch (err) {
            Toast.show(`Textur nicht hinzugefügt: ${err.message || err}`, 'warning', 6000);
        }
    }

    onMaterialInput(e) {
        const el = e.target;
        if (el.matches('[data-f]')) { this.formDirty = true; return; }
        if (!el.matches('[data-look]')) return;
        if (e.type === 'input') el.dataset.handled = '1'; // change danach nicht doppelt
        const out = el.parentElement.querySelector('output');
        if (out && el.type === 'range') out.textContent = `${el.value} %`;
        if (el.dataset.look === 'texture') this.onTextureSelected(el);
        this.applyLook(this.readLook());
    }

    /** Aussehen übernehmen: Vorschau, live in der App, verzögert speichern */
    applyLook(look) {
        this.updatePreview(look);
        const name = this.selected;
        if (name === '') { this.newLook = look; return; }
        const spec = this.lookSpec;
        const data = Materials.data();
        const custom = data.materialien.find(m => m.name === name);
        if (spec) data.darstellung[`${name}|${spec}`] = look;
        else if (custom) custom.look = look;
        else data.darstellung[name] = look;
        this.pending = data;
        this.busy++;
        try { Materials.preview(data); } finally { this.busy--; }
        if (!spec) {
            const sw = this.materialPage.querySelector(`.mat-item[data-name="${CSS.escape(name)}"] .mat-swatch`);
            if (sw) {
                sw.style.background = look.color;
                if (look.texture) {
                    Textures.url(look.texture.id).then(u => {
                        if (u) { sw.style.backgroundImage = `url("${u.replace(/"/g, '%22')}")`; sw.style.backgroundSize = 'cover'; }
                    });
                }
            }
        }
        clearTimeout(this.saveTimer);
        if (Materials.canSave()) this.saveTimer = setTimeout(() => this.flushSave(), 800);
    }

    async flushSave() {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
        const data = this.pending;
        this.pending = null;
        if (!data || !Materials.canSave()) return;
        this.busy++;
        try {
            await Materials.save(data);
        } catch (err) {
            Toast.show(`Darstellung nicht gespeichert: ${err.message || err}`, 'warning', 5000);
        } finally {
            this.busy--;
        }
    }

    /** Formular lesen: { values } oder { error } */
    readForm() {
        const box = this.materialPage.querySelector('.mat-form');
        const v = (k) => box.querySelector(`[data-f="${k}"]`).value;
        const lists = {
            density: parseList(v('density'), true, 'Dichte'),
            thicknesses: parseList(v('thicknesses'), true, 'Dicken'),
            coilWidths: parseList(v('coilWidths'), false, 'Rollenbreiten'),
            coilKg: parseList(v('coilKg'), false, 'Rollengewichte'),
            sheets: parseSheets(v('sheets'))
        };
        const bad = Object.values(lists).find(r => r.error);
        if (bad) return { error: bad.error };
        if (lists.density.values.length > 1) return { error: 'Dichte: bitte nur einen Wert angeben.' };
        return {
            values: {
                name: v('name'),
                specs: v('specs').split(/[,;]+/).map(x => x.trim()).filter(Boolean),
                density: lists.density.values[0],
                thicknesses: lists.thicknesses.values,
                coilWidths: lists.coilWidths.values,
                coilKg: lists.coilKg.values,
                sheets: lists.sheets.values
            }
        };
    }

    formError(text) {
        const el = this.materialPage.querySelector('.mat-form-error');
        if (!el) return;
        el.textContent = text || '';
        el.hidden = !text;
    }

    async onMaterialClick(e) {
        const btn = e.target.closest('[data-do]');
        if (!btn || btn.disabled) return;
        const act = btn.dataset.do;
        if (act === 'select' || act === 'new') {
            if (!(await this.discardOk())) return;
            await this.flushSave();
            const next = act === 'new' ? '' : btn.dataset.name;
            if (next !== this.selected) {
                // mitgelieferte Materialien: gleich die erste Ausführung mit Textur zeigen (so wie in 3D)
                this.lookSpec = (MATERIAL_SPECS[next] || []).find(x => Materials.hasBuiltinSpecLook(next, x)) || '';
            }
            this.selected = act === 'new' ? '' : btn.dataset.name;
            if (act === 'new') this.newLook = null;
            this.renderMaterials();
        } else if (act === 'grant') {
            await Materials.load(true);
            this.renderMaterials();
        } else if (act === 'tex-add') {
            const input = this.materialPage.querySelector('[data-input="texture"]');
            if (input) input.click();
        } else if (act === 'tex-del') {
            const sel = this.materialPage.querySelector('[data-look="texture"]');
            const id = sel && sel.value;
            if (!id || !id.startsWith('eigen:')) return;
            const ui = this.deps.moduleUI;
            const ok = ui ? await ui.confirm('Textur löschen?', 'Die Textur wird aus der Ablage gelöscht. Materialien, die sie verwenden, werden ohne Textur dargestellt.') : true;
            if (!ok) return;
            try {
                await Textures.remove(id);
                this.textureList = await Textures.list();
                sel.value = '';
                this.onTextureSelected(sel);
                this.applyLook(this.readLook());
                this.renderDetail();
                Toast.show('Textur gelöscht.', 'info');
            } catch (err) {
                Toast.show(`Textur nicht gelöscht: ${err.message || err}`, 'warning', 6000);
            }
        } else if (act === 'spec-reset') {
            await this.flushSave();
            const data = Materials.data();
            delete data.darstellung[`${this.selected}|${this.lookSpec}`];
            if (Materials.canSave()) await this.store(data, `„${this.lookSpec}“ wie alle Ausführungen.`);
            else { Materials.preview(data); this.renderMaterials(); }
        } else if (act === 'reset-look') {
            await this.flushSave();
            const data = Materials.data();
            delete data.darstellung[this.selected];
            if (Materials.canSave()) await this.store(data, 'Darstellung zurückgesetzt.');
            else { Materials.preview(data); this.renderMaterials(); }
        } else if (act === 'save') {
            await this.flushSave();
            let m;
            try {
                const form = this.readForm();
                if (form.error) throw new Error(form.error);
                m = cleanMaterial({ ...form.values, look: this.selected === '' ? (this.newLook || undefined) : Materials.look(this.selected) });
            } catch (err) {
                this.formError(err.message);
                return;
            }
            const data = Materials.data();
            const clash = Materials.list().some(x => x.name.toLowerCase() === m.name.toLowerCase() && x.name !== this.selected);
            if (clash) { this.formError(`Ein Material „${m.name}“ gibt es schon.`); return; }
            const i = data.materialien.findIndex(x => x.name === this.selected);
            if (i >= 0) data.materialien[i] = m; else data.materialien.push(m);
            // umbenannt: Darstellungen der Ausführungen mitnehmen
            if (this.selected && this.selected !== m.name) {
                Object.keys(data.darstellung).filter(k => k.startsWith(`${this.selected}|`)).forEach(k => {
                    data.darstellung[`${m.name}|${k.slice(this.selected.length + 1)}`] = data.darstellung[k];
                    delete data.darstellung[k];
                });
            }
            const ok = await this.store(data, this.selected === '' ? `Material „${m.name}“ angelegt.` : `Material „${m.name}“ gespeichert.`);
            if (ok) { this.selected = m.name; this.renderMaterials(); }
        } else if (act === 'delete') {
            const name = this.selected;
            const ui = this.deps.moduleUI;
            const n = this.linkedItems(name).length;
            const erpText = n ? ` In ERPNext ${n === 1 ? 'ist 1 Artikel' : `sind ${n} Artikel`} mit „${name}“ verknüpft. ${n === 1 ? 'Er behält' : 'Sie behalten'} das Material; Bestandsprüfung und Lagerbuchung aus openBender gehen aber nur, solange es das Material hier gibt.` : '';
            const ok = ui ? await ui.confirm('Material löschen?', `„${name}“ wird aus den eigenen Materialien entfernt. Dateien, die es verwenden, behalten den Namen (markiert als „nicht in den Einstellungen“); im Zuschnitt muss dort eine Sorte gewählt werden.${erpText}`) : true;
            if (!ok) return;
            this.formDirty = false;
            await this.flushSave();
            const data = Materials.data();
            data.materialien = data.materialien.filter(x => x.name !== name);
            Object.keys(data.darstellung).filter(k => k.startsWith(`${name}|`)).forEach(k => delete data.darstellung[k]);
            if (await this.store(data, `Material „${name}“ gelöscht.`)) { this.selected = null; this.renderMaterials(); }
        }
    }

    async store(data, message) {
        this.busy++;
        try {
            await Materials.save(data);
            this.busy--;
            Toast.show(message, 'info');
            this.formDirty = false;
            this.renderMaterials();
            return true;
        } catch (err) {
            this.busy--;
            const text = err.message || String(err);
            if (this.materialPage.querySelector('.mat-form-error')) this.formError(text);
            else Toast.show(text, 'warning', 5000);
            return false;
        }
    }

    // --- 3D-Vorschau eines Materials (kleines gekantetes Blech) ---------------

    initPreview(el, look) {
        if (!el || typeof THREE === 'undefined') return;
        const w = el.clientWidth || 240, h = el.clientHeight || 170;
        try {
            const renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            renderer.setSize(w, h);
            el.appendChild(renderer.domElement);
            const lights = sheetLook('').lights;
            const scene = new THREE.Scene();
            scene.background = new THREE.Color(lights.background);
            scene.environment = sheetEnvironment(renderer);
            scene.add(new THREE.AmbientLight(lights.ambient.color, lights.ambient.intensity));
            const main = new THREE.DirectionalLight(lights.main.color, lights.main.intensity);
            main.position.set(...lights.main.position);
            scene.add(main);
            const fill = new THREE.DirectionalLight(lights.fill.color, lights.fill.intensity);
            fill.position.set(...lights.fill.position);
            scene.add(fill);

            // Kastenrinne mit Wasserfalz als Vorschau: ein flacher Quader je Schenkel,
            // Texturkoordinaten in mm wie in der 3D Vorschau (u quer, v längs)
            const render = () => { if (this.preview) this.preview.renderer.render(this.preview.scene, this.preview.camera); };
            const material = sheetMaterial(look, render);
            const group = new THREE.Group();
            const pts = [[-60, 45], [-60, 0], [60, 0], [60, 60], [50, 60]];
            const t = 2, depth = 240;
            let offset = 0;
            for (let i = 1; i < pts.length; i++) {
                const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
                const len = Math.hypot(x2 - x1, y2 - y1);
                const geo = new THREE.BoxGeometry(len + t, t, depth);
                const p = geo.attributes.position, uv = geo.attributes.uv;
                for (let k = 0; k < p.count; k++) uv.setXY(k, offset + p.getX(k) + len / 2, p.getZ(k));
                uv.needsUpdate = true;
                offset += len;
                const box = new THREE.Mesh(geo, material);
                box.position.set((x1 + x2) / 2, (y1 + y2) / 2 - 28, 0);
                box.rotation.z = Math.atan2(y2 - y1, x2 - x1);
                group.add(box);
            }
            group.rotation.y = -0.65;
            group.rotation.x = 0.4;
            scene.add(group);
            const camera = new THREE.PerspectiveCamera(35, w / h, 1, 3000);
            camera.position.set(0, 40, 360);
            camera.lookAt(0, 0, 0);
            this.preview = { renderer, scene, camera, group, material };
            // mit der Maus drehen und zoomen
            if (THREE.OrbitControls) {
                const controls = new THREE.OrbitControls(camera, renderer.domElement);
                controls.addEventListener('change', render);
                this.preview.controls = controls;
            }
            render();
        } catch (e) {
            console.warn('Vorschau der Darstellung:', e);
            el.textContent = '3D-Vorschau nicht verfügbar';
        }
    }

    updatePreview(look) {
        const p = this.preview;
        if (!p) return;
        applySheetLook(p.material, look, () => p.renderer.render(p.scene, p.camera));
        p.renderer.render(p.scene, p.camera);
    }

    disposePreview() {
        const p = this.preview;
        if (!p) return;
        if (p.controls) p.controls.dispose();
        p.group.children.forEach(c => c.geometry.dispose());
        if (p.material.map) p.material.map.dispose();
        p.material.dispose();
        if (p.scene.environment) p.scene.environment.dispose();
        p.renderer.dispose();
        if (p.renderer.forceContextLoss) p.renderer.forceContextLoss();
        p.renderer.domElement.remove();
        this.preview = null;
    }
}
