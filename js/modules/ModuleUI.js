/**
 * Oberfläche des Modul-Systems: Modul-Tabs, Modul-Menü (🔌), Dialoge für
 * Module (modal / prompt / confirm), Vorlagen-Auswahl und Module-Verwaltung.
 * Gehört zum ModuleHost; Module selbst greifen nur über api.ui darauf zu.
 */
import { Toast } from '../utils/Toast.js';
import { Profile } from '../models/Profile.js';
import { profileThumbnail } from '../controllers/FileBrowserController.js';
import { buildProfile, validateProfile, validateCutlist } from './ModuleData.js';
import { ErpStorage } from '../storage/ErpStorage.js';
import { UserTemplates, stepsWithValues, templateFields, templatePreviewSvg, templatePreviewRows } from '../templates/UserTemplates.js';

const TEMPLATE_VALUES_KEY = 'openbender.templateValues';

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export class ModuleUI {
    constructor(host) {
        this.host = host;
        this.activeTabKey = null;
        this.docType = 'profile';   // aktive Dokumentart (siehe ModuleHost.docTypes)
        this.initMenu();
    }

    // --- Modul-Menü -----------------------------------------------------------
    // Seit 0.26 gibt es keinen Toolbar-Knopf 🔌 mehr: Funktionen und
    // Verwaltung der Module stehen in den Einstellungen (Tab „Module“).
    // Das Menü bleibt für toggleMenu(anchor), falls es jemand braucht.

    initMenu() {
        this.menu = document.getElementById('module-menu');
        if (!this.menu) return;
        this.menu.addEventListener('click', (e) => {
            const item = e.target.closest('button');
            if (!item) return;
            this.closeMenu();
            if (item.dataset.do === 'templates') this.openTemplates();
            else if (item.dataset.do === 'manage') this.openManager();
            else if (item.dataset.action !== undefined) this.runAction(Number(item.dataset.action));
        });
        document.addEventListener('pointerdown', (e) => {
            if (!this.menu.classList.contains('hidden') && !this.menu.contains(e.target) && e.target !== this.menuAnchor) this.closeMenu();
        });
    }

    /** Aktion eines Moduls ausführen (api.ui.addAction) */
    runAction(index) {
        const action = this.host.actions[index];
        if (!action) return;
        Promise.resolve().then(() => action.onClick()).catch(err => {
            console.error(`Modul „${action.moduleId}“ ${action.id}:`, err);
            this.toast(`Fehler im Modul: ${err.message || err}`, 'warning');
        });
    }

    /** Menü unter einem Element öffnen. */
    toggleMenu(anchor) {
        if (!this.menu) return;
        const opening = this.menu.classList.contains('hidden');
        if (opening) {
            this.menuAnchor = anchor;
            this.renderMenu();
            const r = anchor.getBoundingClientRect();
            this.menu.style.top = `${r.bottom + 4}px`;
            this.menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 280))}px`;
        }
        this.menu.classList.toggle('hidden', !opening);
    }

    closeMenu() {
        if (this.menu) this.menu.classList.add('hidden');
    }

    renderMenu() {
        const names = Object.fromEntries(this.host.catalog.map(c => [c.id, c.name]));
        let html = '';
        this.host.actions.forEach((a, i) => {
            html += `<button type="button" role="menuitem" data-action="${i}" title="${escapeHtml(a.title)}">${escapeHtml(a.label)}<span class="module-menu-src">${escapeHtml(names[a.moduleId] || a.moduleId)}</span></button>`;
        });
        if (html) html += '<hr>';
        html += '<button type="button" role="menuitem" data-do="manage">🔌 Module verwalten …</button>';
        this.menu.innerHTML = html;
    }

    /** Nach Änderungen an Modulen (Aktionen, Vorlagen, Status). */
    refresh() {
        if (this.menu && !this.menu.classList.contains('hidden')) this.renderMenu();
        if (this.managerBody) this.renderManager();
        this.renderNotice();
    }

    // --- Tabs ----------------------------------------------------------------

    addTab(entry, def) {
        const key = `mod-${entry.id}${def.id ? `-${def.id}` : ''}`;
        if (this.host.tabs.some(t => t.key === key)) throw new Error(`Tab „${key}“ gibt es schon`);
        const label = String(def.label || entry.name);
        const shortLabel = String(def.shortLabel || label);

        const nav = document.querySelector('.main-tabs');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'main-tab-btn module-tab-btn';
        button.dataset.tab = key;
        button.title = String(def.title || entry.name);
        button.innerHTML = `<span class="lbl-long">${escapeHtml(label)}</span><span class="lbl-short">${escapeHtml(shortLabel)}</span>`;
        button.addEventListener('click', () => this.host.app.switchTab(key));
        // before: Tab-Key ('profile', 'cutlist', 'zuschnitt', 'vorschau' oder Modul-Tab), vor dem
        // der neue Tab erscheint; ohne oder unbekannt: ganz rechts
        const vor = def.before ? (document.getElementById(`tab-btn-${def.before}`) || nav.querySelector(`[data-tab="${CSS.escape(String(def.before))}"]`)) : null;
        if (vor && vor.parentNode === nav) nav.insertBefore(button, vor);
        else nav.appendChild(button);

        const view = document.createElement('div');
        view.className = 'app-view module-view';
        view.id = `view-${key}`;
        // layout 'full': ganze Fläche ohne Rand und Seiten-Scrollen (z.B. Zeichenflächen),
        // sonst wie Stückliste/Zuschnitt (zentriert, scrollt)
        view.innerHTML = def.layout === 'full'
            ? '<div class="module-container module-full"></div>'
            : '<div class="cutlist-scroll-area"><div class="cutlist-container module-container"></div></div>';
        document.body.insertBefore(view, document.getElementById('toast-container'));
        const container = view.querySelector('.module-container');

        const h = def.history;
        const history = h && ['undo', 'redo', 'canUndo', 'canRedo'].every(k => typeof h[k] === 'function') ? h : null;
        const tab = {
            key, moduleId: entry.id, button, view, history,
            // Tab nur bei dieser Dokumentart zeigen (api.documents.addType), sonst immer
            docType: def.docType ? String(def.docType) : null,
            onShow: typeof def.onShow === 'function' ? def.onShow : null,
            onHide: typeof def.onHide === 'function' ? def.onHide : null
        };
        tab.handle = Object.freeze({
            key,
            container,
            show: () => this.host.app.switchTab(key),
            // Nach Änderungen am eigenen Verlauf: Knöpfe ↶ ↷ der Toolbar nachführen
            refreshHistory: () => { if (this.host.app.refreshHistory) this.host.app.refreshHistory(); },
            setLabel: (text, short) => {
                button.querySelector('.lbl-long').textContent = text;
                button.querySelector('.lbl-short').textContent = short || text;
            }
        });
        this.host.tabs.push(tab);
        button.classList.toggle('doc-hidden', !!tab.docType && tab.docType !== this.docType);
        return tab;
    }

    removeTab(tab) {
        if (this.activeTabKey === tab.key) this.host.app.switchTab(this.host.app.homeTab());
        tab.button.remove();
        tab.view.remove();
        this.host.tabs.splice(this.host.tabs.indexOf(tab), 1);
    }

    /** Verlauf des Modul-Tabs key ({ undo, redo, canUndo, canRedo }) oder null */
    historyFor(key) {
        const tab = this.host.tabs.find(t => t.key === key);
        if (!tab || !tab.history) return null;
        const safe = (fn, def) => () => { try { return fn(); } catch (e) { console.error(`Modul „${tab.moduleId}“ Verlauf:`, e); return def; } };
        return { undo: safe(tab.history.undo), redo: safe(tab.history.redo), canUndo: safe(tab.history.canUndo, false), canRedo: safe(tab.history.canRedo, false) };
    }

    /** Dokumentart gewechselt: Tabs anderer Dokumentarten ausblenden. */
    applyDocType(id) {
        this.docType = id;
        this.host.tabs.forEach(t => t.button.classList.toggle('doc-hidden', !!t.docType && t.docType !== id));
    }

    /**
     * Dialog "Neu": Dokumentart wählen. types: [{ id, name, description, icon }]
     * opts: { title, text, note }. Promise mit der gewählten id oder null.
     */
    openNewDialog(types, opts = {}) {
        return new Promise((resolve) => {
            let chosen = null;
            this.modal({
                title: opts.title || 'Neu',
                wide: types.length > 2,
                html: `<p class="info-panel-desc">${escapeHtml(opts.text || 'Was möchtest du erstellen?')}</p>
                    <div class="new-doc-grid">${types.map(t => `<button type="button" class="new-doc-tile" data-type="${escapeHtml(t.id)}">
                        <span class="new-doc-icon" aria-hidden="true">${escapeHtml(t.icon || '📄')}</span>
                        <span class="new-doc-name">${escapeHtml(t.name)}</span>
                        <span class="new-doc-desc">${escapeHtml(t.description || '')}</span>
                    </button>`).join('')}</div>
                    <p class="opt-note">${escapeHtml(opts.note || 'Das aktuelle Dokument wird geleert. Gespeicherte Dateien bleiben unverändert.')}</p>`,
                buttons: [{ label: 'Abbrechen', value: null }],
                onOpen: (body, close) => {
                    body.addEventListener('click', (e) => {
                        const tile = e.target.closest('.new-doc-tile');
                        if (!tile) return;
                        chosen = tile.dataset.type;
                        close(chosen);
                    });
                    const first = body.querySelector('.new-doc-tile');
                    if (first) first.focus();
                }
            }).then(() => resolve(chosen));
        });
    }

    /** Von main.js switchTab(): Modul-Tabs ein-/ausblenden. */
    onTabSwitched(activeKey) {
        const previous = this.host.tabs.find(t => t.key === this.activeTabKey);
        const next = this.host.tabs.find(t => t.key === activeKey);
        this.host.tabs.forEach(t => {
            t.button.classList.toggle('active', t === next);
            t.view.classList.toggle('active', t === next);
        });
        if (previous && previous !== next && previous.onHide) this.safe(previous.moduleId, () => previous.onHide());
        this.activeTabKey = next ? next.key : null;
        if (next && next !== previous && next.onShow) this.safe(next.moduleId, () => next.onShow(next.handle.container));
    }

    safe(moduleId, fn) {
        try { fn(); } catch (e) { console.error(`Modul „${moduleId}“:`, e); }
    }

    // --- Dialoge ---------------------------------------------------------

    toast(text, type = 'info', duration = 3500) {
        Toast.show(escapeHtml(text), type === 'warning' ? 'warning' : 'info', duration);
    }

    /**
     * Dialog. def: { title, html | content (Element), buttons: [{ label,
     * value, primary }], wide, onOpen(el, close) }. Promise mit dem value des
     * gedrückten Buttons (Schliessen/Esc: null).
     */
    modal(def = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'info-panel-overlay module-dialog-overlay';
            const buttons = def.buttons || [{ label: 'OK', value: true, primary: true }];
            overlay.innerHTML = `<div class="info-panel module-dialog${def.wide ? ' module-dialog-wide' : ''}" role="dialog" aria-modal="true">
                <button type="button" class="info-panel-close" data-close aria-label="Schliessen">✕</button>
                <h2>${escapeHtml(def.title || '')}</h2>
                <div class="module-dialog-body"></div>
                <div class="dxf-actions">${buttons.map((b, i) => `<button type="button" class="dxf-btn${b.primary ? ' dxf-btn-primary' : ''}" data-btn="${i}">${escapeHtml(b.label)}</button>`).join('')}</div>
            </div>`;
            const body = overlay.querySelector('.module-dialog-body');
            if (def.content instanceof Node) body.appendChild(def.content);
            else body.innerHTML = def.html || '';

            let done = false;
            const close = (value = null) => {
                if (done) return;
                done = true;
                document.removeEventListener('keydown', onKey, true);
                overlay.remove();
                resolve(value);
            };
            const onKey = (e) => {
                // Bei Dialog im Dialog (z.B. Rückfrage) nur den obersten schliessen
                const top = [...document.querySelectorAll('.module-dialog-overlay')].pop();
                if (e.key === 'Escape' && top === overlay) { e.stopPropagation(); close(null); }
            };
            document.addEventListener('keydown', onKey, true);
            let busy = false;
            overlay.addEventListener('click', async (e) => {
                if (busy) return;
                if (e.target === overlay || e.target.closest('[data-close]')) { close(null); return; }
                const btn = e.target.closest('[data-btn]');
                if (!btn) return;
                const b = buttons[Number(btn.dataset.btn)];
                // beforeClose(value, el) → false (oder Promise mit false) hält
                // den Dialog offen (z.B. Eingabe ungültig)
                if (def.beforeClose) {
                    busy = true;
                    let keep;
                    try { keep = (await def.beforeClose(b.value, body)) === false; } finally { busy = false; }
                    if (keep) return;
                }
                close(b.value);
            });
            document.body.appendChild(overlay);
            if (def.onOpen) def.onOpen(body, close);
            const first = body.querySelector('input, select, textarea');
            if (first) first.focus();
        });
    }

    async confirm(title, text) {
        const value = await this.modal({
            title,
            html: `<p class="info-panel-desc">${escapeHtml(text)}</p>`,
            buttons: [{ label: 'Abbrechen', value: false }, { label: 'OK', value: true, primary: true }]
        });
        return value === true;
    }

    /**
     * Eingabe-Dialog. def: { title, text, fields: [Feld], okLabel }
     * Feld: { key, label, type: 'number'|'text'|'select'|'check', unit, value,
     *         min, max, step, options: [{ value, label }] | ['A', 'B'], help }
     * Promise mit { key: Wert } oder null (abgebrochen).
     */
    async prompt(def = {}) {
        const fields = def.fields || [];
        let values = null;
        const ok = await this.modal({
            title: def.title,
            html: (def.text ? `<p class="info-panel-desc">${escapeHtml(def.text)}</p>` : '') + `<div class="module-form">${fieldsHtml(fields, {})}</div>`,
            buttons: [{ label: 'Abbrechen', value: false }, { label: def.okLabel || 'OK', value: true, primary: true }],
            beforeClose: (value, body) => {
                if (!value) return true;
                const result = readFields(body, fields);
                if (result.error) { showFormError(body, result.error); return false; }
                values = result.values;
                return true;
            }
        });
        return ok ? values : null;
    }

    // --- Vorlagen-Auswahl ----------------------------------------------------

    /**
     * Profil aus Vorlage: eigene Vorlagen aus dem Speicherordner (Ordner
     * "Vorlagen", siehe templates/UserTemplates.js) und Vorlagen aus Modulen.
     */
    async openTemplates() {
        const own = (await UserTemplates.list(true)).map(({ file, template: t, readOnly }) => ({
            key: `user:${file}`,
            file,
            readOnly: !!readOnly,
            template: t,
            name: t.name,
            category: t.category || 'Eigene Vorlagen',
            description: t.description || (t.params.length ? '' : 'Feste Form ohne veränderbare Masse.'),
            params: templateFields(t),
            build: (v) => ({ steps: stepsWithValues(t, v), start: t.start, direction: t.direction, conical: t.conical === true })
        }));
        const templates = [...own, ...this.host.templates];
        if (!templates.length) {
            await this.modal({
                title: 'Profil aus Vorlage',
                html: `<p class="info-panel-desc">Es gibt noch keine Vorlagen. So legen Sie eine an: Profil zeichnen, dann <strong>📐 Vorlagen → Aktuelles Profil als Vorlage speichern …</strong> wählen und die Längen und Winkel anhaken, die beim Verwenden veränderbar sein sollen.</p>
                    <p class="opt-note">${escapeHtml(UserTemplates.ortListe())}</p>`,
                buttons: [{ label: 'OK', value: true, primary: true }]
            });
            return;
        }
        let remembered = {};
        try { remembered = JSON.parse(localStorage.getItem(TEMPLATE_VALUES_KEY) || '{}') || {}; } catch (e) { remembered = {}; }
        let current = templates.find(t => t.key === remembered.__last) || templates[0];
        let lastResult = null;
        let close = null;

        const listHtml = () => {
            const categories = [...new Set(templates.map(t => t.category))];
            return categories.map(cat => `<div class="tpl-cat">${escapeHtml(cat)}</div>` + templates
                .filter(t => t.category === cat)
                .map(t => `<button type="button" class="tpl-item" data-key="${escapeHtml(t.key)}">${escapeHtml(t.name)}</button>`).join('')).join('');
        };

        const render = (body) => {
            body.querySelectorAll('.tpl-item').forEach(b => b.classList.toggle('active', b.dataset.key === current.key));
            const values = remembered[current.key] || {};
            body.querySelector('.tpl-desc').textContent = current.description;
            body.querySelector('.tpl-form').innerHTML = fieldsHtml(current.params, values);
            body.querySelector('.tpl-own').hidden = !current.file || current.readOnly;
            update(body);
        };
        const update = (body) => {
            const read = readFields(body.querySelector('.tpl-form'), current.params);
            const preview = body.querySelector('.tpl-preview');
            const info = body.querySelector('.tpl-info');
            lastResult = null;
            if (read.error) {
                preview.innerHTML = '';
                info.innerHTML = `<span class="module-form-error">${escapeHtml(read.error)}</span>`;
                return;
            }
            try {
                lastResult = normalizeTemplateResult(current.build(read.values));
                lastResult.values = read.values;
                const p = new Profile();
                p.loadData(JSON.parse(JSON.stringify(lastResult.profile)));
                const unfold = p.getUnfoldLengths();
                // Eigene Vorlage: mit Bezeichnungen der Eingabefelder
                preview.innerHTML = current.template
                    ? templatePreviewSvg({ ...current.template, steps: stepsWithValues(current.template, read.values) }, templatePreviewRows(current.template))
                    : profileThumbnail({ profile: lastResult.profile });
                const extra = [];
                if (lastResult.cutlist) extra.push(`${lastResult.cutlist.length} Stücklisten-Position(en)`);
                if (lastResult.project) extra.push('Projektdaten');
                info.textContent = `Abwicklung ${Math.round(unfold.front)} mm${p.conical ? ` / hinten ${Math.round(unfold.back)} mm` : ''} · ${lastResult.profile.segments.length} Schenkel`
                    + (extra.length ? ` · setzt auch ${extra.join(' und ')}` : '');
            } catch (e) {
                preview.innerHTML = '';
                info.innerHTML = `<span class="module-form-error">${escapeHtml(e.message || e)}</span>`;
            }
        };

        const ok = await this.modal({
            title: 'Profil aus Vorlage',
            wide: true,
            html: `<div class="tpl-layout">
                <div class="tpl-list">${listHtml()}</div>
                <div class="tpl-main">
                    <p class="tpl-desc info-panel-desc"></p>
                    <div class="tpl-form module-form"></div>
                    <div class="tpl-preview"></div>
                    <p class="tpl-info opt-note"></p>
                    <div class="tpl-own" hidden><button type="button" class="status-btn" data-do="delete-template">Vorlage löschen</button></div>
                </div>
            </div>`,
            buttons: [{ label: 'Abbrechen', value: false }, { label: 'Profil übernehmen', value: true, primary: true }],
            onOpen: (body, closeDialog) => {
                close = closeDialog;
                body.addEventListener('click', async (e) => {
                    if (e.target.closest('[data-do="delete-template"]') && current.file) {
                        const doomed = current;
                        if (!(await this.confirm('Vorlage löschen?', `Die Vorlage „${doomed.name}“ wird ${ErpStorage.isActive() ? 'in ERPNext für alle' : 'aus dem Ordner „Vorlagen“'} gelöscht.`))) return;
                        try {
                            await UserTemplates.remove(doomed.file);
                        } catch (err) {
                            this.toast(`Löschen fehlgeschlagen: ${err.message || err}`, 'warning');
                            return;
                        }
                        templates.splice(templates.indexOf(doomed), 1);
                        if (!templates.length) { close(null); this.toast(`Vorlage „${doomed.name}“ gelöscht.`); return; }
                        current = templates[0];
                        body.querySelector('.tpl-list').innerHTML = listHtml();
                        render(body);
                        this.toast(`Vorlage „${doomed.name}“ gelöscht.`);
                        return;
                    }
                    const item = e.target.closest('.tpl-item');
                    if (!item) return;
                    current = templates.find(t => t.key === item.dataset.key) || current;
                    render(body);
                });
                body.addEventListener('input', () => update(body));
                body.addEventListener('change', () => update(body));
                render(body);
            },
            beforeClose: (value) => !value || !!lastResult
        });
        if (!ok || !lastResult) return;

        remembered[current.key] = lastResult.values;
        remembered.__last = current.key;
        try { localStorage.setItem(TEMPLATE_VALUES_KEY, JSON.stringify(remembered)); } catch (e) { /* nur Komfort */ }

        const app = this.host.app;
        if (lastResult.cutlist && app.cutlist.toJSON().length > 0) {
            const replace = await this.confirm('Stückliste ersetzen?', 'Die Vorlage bringt eigene Stücklisten-Positionen mit. Die bisherige Stückliste wird dabei ersetzt.');
            if (!replace) lastResult.cutlist = null;
        }
        // Erst den Profil-Tab zeigen, damit "ganzes Profil zeigen" die
        // richtige Zeichenfläche hat
        app.switchTab('profile');
        app.setProfile(lastResult.profile, { fit: true });
        if (lastResult.cutlist) app.setCutlist(lastResult.cutlist);
        if (lastResult.project) app.setProject(lastResult.project);
        this.toast(`Vorlage „${current.name}“ übernommen (Rückgängig: Strg+Z).`);
    }

    // --- Module verwalten ----------------------------------------------------

    /**
     * Module verwalten: öffnet die Einstellungen im Tab „Module“
     * (openSettings setzt main.js). Ohne Einstellungen als eigenes Fenster.
     */
    async openManager() {
        if (this.openSettings) {
            this.openSettings('module');
            return;
        }
        await this.modal({
            title: 'Module',
            wide: true,
            html: '<div class="module-manager-host"></div>',
            buttons: [{ label: 'Schliessen', value: true, primary: true }],
            onOpen: (body) => this.mountManager(body.querySelector('.module-manager-host'))
        });
        this.unmountManager();
    }

    /** Verwaltung (Funktionen, Liste, Installieren) in ein Element einsetzen */
    mountManager(container) {
        if (!container) return;
        if (!container.dataset.managerMounted) {
            container.dataset.managerMounted = '1';
            container.innerHTML = `<div class="module-actions-box" hidden>
                    <h3>Funktionen der Module</h3>
                    <div class="module-actions"></div>
                </div>
                <h3>Module</h3>
                <p class="info-panel-desc">Module erweitern OpenBender um Fachfunktionen. Mitgelieferte Module lassen sich ein- und ausschalten; weitere Module werden im Speicherordner (Unterordner „Module“) installiert und stehen so allen Arbeitsplätzen mit demselben Ordner zur Verfügung.</p>
                <div class="module-list"></div>
                <div class="module-manager-actions">
                    <button type="button" class="dxf-btn dxf-btn-primary" data-do="install">Modul installieren (.js) …</button>
                    <input type="file" accept=".js,.mjs,text/javascript" hidden data-input="install">
                </div>
                <p class="opt-note module-folder-note"></p>
                <p class="opt-note">Module sind Programmcode mit vollem Zugriff auf die App – nur Module aus vertrauenswürdiger Quelle installieren. Für Entwickler: Schnittstelle in docs/module.md.</p>`;
            container.addEventListener('change', (e) => this.onManagerChange(e));
            container.addEventListener('click', (e) => this.onManagerClick(e));
        }
        this.managerBody = container;
        this.renderManager();
    }

    unmountManager() {
        this.managerBody = null;
    }

    renderManager() {
        const body = this.managerBody;
        if (!body) return;
        const host = this.host;
        const rows = host.catalog.map((c, i) => {
            const on = host.isEnabled(c);
            let status = '';
            if (c.status === 'active') status = '<span class="module-status ok">aktiv</span>';
            else if (c.status === 'license') status = '<span class="module-status warn">Lizenz fehlt</span>';
            else if (c.status === 'error') status = `<span class="module-status err">Fehler: ${escapeHtml(c.error)}</span>`;
            else status = '<span class="module-status">aus</span>';

            let licenseHtml = '';
            if (c.license) {
                const r = c.licenseResult;
                if (r && r.valid) {
                    licenseHtml = `<div class="module-license ok">🔑 Lizenziert für <strong>${escapeHtml(r.licensee)}</strong>${r.expires ? ` · gültig bis ${escapeHtml(r.expires)}` : ' · unbefristet'}</div>`;
                } else {
                    const why = r && r.reason && r.reason !== 'Kein Lizenzschlüssel eingegeben' ? ` (${escapeHtml(r.reason)})` : '';
                    licenseHtml = `<div class="module-license">🔑 Kostenpflichtiges Modul${c.license.demo ? ' – läuft ohne Lizenz als Demo' : ''}${why}</div>`;
                }
            }
            const meta = [c.version && `Version ${escapeHtml(c.version)}`, c.author && escapeHtml(c.author), c.source === 'builtin' ? 'mitgeliefert' : 'Speicherordner'].filter(Boolean).join(' · ');
            const buttons = [
                c.license ? `<button type="button" class="status-btn" data-do="license" data-i="${i}">${c.licenseResult && c.licenseResult.valid ? 'Lizenz ändern' : 'Lizenz eingeben'}</button>` : '',
                c.source === 'folder' ? `<button type="button" class="status-btn" data-do="remove" data-i="${i}">Entfernen</button>` : ''
            ].join('');
            return `<div class="module-row">
                <label class="module-toggle"><input type="checkbox" data-i="${i}" ${on ? 'checked' : ''} ${c.def ? '' : 'disabled'} aria-label="${escapeHtml(c.name)} einschalten"></label>
                <div class="module-info">
                    <div class="module-title"><strong>${escapeHtml(c.name)}</strong> ${status}</div>
                    <div class="module-meta">${meta}</div>
                    ${c.description ? `<div class="module-desc">${escapeHtml(c.description)}</div>` : ''}
                    ${licenseHtml}
                    ${buttons ? `<div class="module-buttons">${buttons}</div>` : ''}
                </div>
            </div>`;
        });
        body.querySelector('.module-list').innerHTML = rows.join('') || '<p class="opt-note">Keine Module vorhanden.</p>';

        // Funktionen der Module (api.ui.addAction), früher im Menü 🔌
        const names = Object.fromEntries(host.catalog.map(c => [c.id, c.name]));
        const actionsBox = body.querySelector('.module-actions-box');
        if (actionsBox) {
            actionsBox.hidden = host.actions.length === 0;
            actionsBox.querySelector('.module-actions').innerHTML = host.actions.map((a, i) =>
                `<button type="button" class="status-btn" data-do="action" data-action="${i}" title="${escapeHtml(a.title)}">${escapeHtml(a.label)} <span class="module-menu-src">${escapeHtml(names[a.moduleId] || a.moduleId)}</span></button>`).join('');
        }

        const note = body.querySelector('.module-folder-note');
        const states = {
            unsupported: 'Installieren geht nur mit Ordnerzugriff (Chrome oder Edge, auch als installierte App). Mitgelieferte Module funktionieren überall.',
            none: 'Installierte Module liegen im Speicherordner (Unterordner „Module“). Zum Installieren zuerst unter „Allgemein“ einen Speicherordner wählen.',
            waiting: 'Installierte Module im Speicherordner warten auf die Freigabe des Ordners.',
            ready: 'Installierte Module: Speicherordner → Unterordner „Module“. Dort abgelegte .js-Dateien werden beim Start geladen.'
        };
        note.innerHTML = escapeHtml(states[host.folderState] || '')
            + (host.folderState === 'waiting' ? ' <button type="button" class="status-btn" data-do="grant">Zugriff erlauben</button>' : '');
    }

    async onManagerChange(e) {
        const host = this.host;
        if (e.target.matches('input[type="checkbox"][data-i]')) {
            const entry = host.catalog[Number(e.target.dataset.i)];
            if (entry) await host.setEnabled(entry, e.target.checked);
        } else if (e.target.matches('[data-input="install"]')) {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file) return;
            try {
                const entry = await host.install(file);
                this.toast(entry.status === 'error'
                    ? `Modul installiert, startet aber nicht: ${entry.error}`
                    : `Modul „${entry.name}“ ${entry.version} installiert.`, entry.status === 'error' ? 'warning' : 'info', 4500);
            } catch (err) {
                this.toast(`Installation fehlgeschlagen: ${err.message || err}`, 'warning', 6000);
            }
        }
    }

    async onManagerClick(e) {
        const btn = e.target.closest('[data-do]');
        if (!btn || !this.managerBody) return;
        const host = this.host;
        const entry = host.catalog[Number(btn.dataset.i)];
        if (btn.dataset.do === 'action') {
            // Einstellungen schliessen, damit die Funktion (Dialog, Tab) sichtbar ist
            if (this.closeSettings) this.closeSettings();
            this.runAction(Number(btn.dataset.action));
        } else if (btn.dataset.do === 'install') {
            this.managerBody.querySelector('[data-input="install"]').click();
        } else if (btn.dataset.do === 'grant') {
            await this.grantFolder();
        } else if (btn.dataset.do === 'remove' && entry) {
            if (!(await this.confirm('Modul entfernen?', `„${entry.name}“ wird aus dem Speicherordner gelöscht. Daten des Moduls in Projektdateien bleiben erhalten.`))) return;
            try { await host.remove(entry); } catch (err) { this.toast(err.message || String(err), 'warning', 5000); }
        } else if (btn.dataset.do === 'license' && entry) {
            await this.askLicense(entry);
        }
    }

    async askLicense(entry) {
        const host = this.host;
        const values = await this.prompt({
            title: `Lizenz für „${entry.name}“`,
            text: 'Lizenzschlüssel einfügen (beginnt mit „OB1.“). Er wird im Speicherordner abgelegt (Module/lizenzen.json) und gilt für alle Arbeitsplätze mit diesem Ordner.',
            fields: [{ key: 'key', label: 'Lizenzschlüssel', type: 'textarea', value: host.licenses[entry.id] || '' }],
            okLabel: 'Prüfen und speichern'
        });
        if (!values) return;
        try {
            const result = await host.setLicense(entry, values.key);
            if (result.valid) this.toast(`Lizenz gültig – lizenziert für ${result.licensee}.`);
            else this.toast(`Lizenz ungültig: ${result.reason}`, 'warning', 6000);
        } catch (err) {
            this.toast(err.message || String(err), 'warning', 6000);
        }
    }

    async grantFolder() {
        await this.host.loadFolder(true);
        this.refresh();
        const loaded = this.host.catalog.filter(c => c.source === 'folder' && c.status === 'active').length;
        if (this.host.folderState === 'ready') this.toast(`${loaded} Modul(e) aus dem Speicherordner geladen.`);
    }

    /** Hinweis-Leiste, wenn installierte Module auf die Ordner-Freigabe warten. */
    renderNotice() {
        let bar = document.getElementById('module-notice');
        if (this.host.folderState !== 'waiting') {
            if (bar) bar.remove();
            return;
        }
        if (bar) return;
        bar = document.createElement('div');
        bar.id = 'module-notice';
        bar.className = 'module-notice';
        bar.innerHTML = '<span>🔌 Installierte Module warten auf die Freigabe des Speicherordners.</span><button type="button" class="status-btn" data-grant>Module laden</button><button type="button" class="module-notice-close" aria-label="Ausblenden">✕</button>';
        bar.addEventListener('click', (e) => {
            if (e.target.closest('[data-grant]')) this.grantFolder();
            else if (e.target.closest('.module-notice-close')) bar.remove();
        });
        document.body.appendChild(bar);
    }
}

// --- Formularfelder (prompt und Vorlagen) -----------------------------------

function optionList(options) {
    return (options || []).map(o => (typeof o === 'object' ? { value: String(o.value), label: String(o.label ?? o.value) } : { value: String(o), label: String(o) }));
}

export function fieldsHtml(fields, values) {
    return fields.map((f, i) => {
        const id = `mf-${i}-${Math.random().toString(36).slice(2, 7)}`;
        const value = f.key in values ? values[f.key] : f.value;
        const help = f.help ? `<div class="module-field-help">${escapeHtml(f.help)}</div>` : '';
        const unit = f.unit ? `<span class="module-field-unit">${escapeHtml(f.unit)}</span>` : '';
        let input;
        if (f.type === 'select') {
            input = `<select id="${id}" data-key="${escapeHtml(f.key)}">${optionList(f.options).map(o => `<option value="${escapeHtml(o.value)}" ${String(value) === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
        } else if (f.type === 'check') {
            return `<label class="module-field module-field-check"><input type="checkbox" id="${id}" data-key="${escapeHtml(f.key)}" ${value ? 'checked' : ''} ${f.disabled ? 'disabled' : ''}> ${escapeHtml(f.label)}${help}</label>`;
        } else if (f.type === 'textarea') {
            input = `<textarea id="${id}" data-key="${escapeHtml(f.key)}" rows="4">${escapeHtml(value ?? '')}</textarea>`;
        } else if (f.type === 'text') {
            input = `<input type="text" id="${id}" data-key="${escapeHtml(f.key)}" value="${escapeHtml(value ?? '')}">`;
        } else {
            // Textfeld mit Zifferntastatur statt type="number": zeigt den Punkt unabhängig von der
            // Spracheinstellung des Browsers; readFields nimmt Punkt und Komma an und prüft min/max
            input = `<input type="text" id="${id}" data-key="${escapeHtml(f.key)}" value="${escapeHtml(value ?? '')}" inputmode="decimal" autocomplete="off">`;
        }
        return `<div class="module-field"><label for="${id}">${escapeHtml(f.label || f.key)}</label><div class="module-field-input">${input}${unit}</div>${help}</div>`;
    }).join('') + '<div class="module-form-error" hidden></div>';
}

/** Werte lesen und prüfen: { values } oder { error } */
export function readFields(el, fields) {
    const values = {};
    for (const f of fields) {
        const input = el.querySelector(`[data-key="${CSS.escape(f.key)}"]`);
        if (!input) continue;
        if (f.type === 'check') { values[f.key] = input.checked; continue; }
        if (f.type === 'select' || f.type === 'text' || f.type === 'textarea') { values[f.key] = input.value; continue; }
        const v = parseFloat(String(input.value).replace(',', '.'));
        if (!Number.isFinite(v)) return { error: `„${f.label || f.key}“: bitte eine Zahl eingeben` };
        if (f.min !== undefined && v < f.min) return { error: `„${f.label || f.key}“: mindestens ${f.min}${f.unit ? ` ${f.unit}` : ''}` };
        if (f.max !== undefined && v > f.max) return { error: `„${f.label || f.key}“: höchstens ${f.max}${f.unit ? ` ${f.unit}` : ''}` };
        values[f.key] = v;
    }
    return { values };
}

function showFormError(el, text) {
    const box = el.querySelector('.module-form-error');
    if (box) { box.textContent = text; box.hidden = false; }
}

/**
 * Ergebnis von template.build(values) vereinheitlichen. Erlaubt sind:
 *   { points, segments }                  – fertiges Profil
 *   { steps, start?, direction?, conical? } – Schenkel (wie api.profile.build)
 *   { profile: eines davon, cutlist?, project? }
 */
function normalizeTemplateResult(result) {
    if (!result || typeof result !== 'object') throw new Error('Vorlage liefert kein Profil');
    const wrapped = result.profile ? result : { profile: result };
    let profile = wrapped.profile;
    if (Array.isArray(profile.steps)) profile = buildProfile(profile.steps, profile);
    if (!Array.isArray(profile.points) || !Array.isArray(profile.segments) || profile.segments.length === 0) {
        throw new Error('Vorlage liefert kein gültiges Profil');
    }
    return {
        profile: validateProfile(profile),
        cutlist: Array.isArray(wrapped.cutlist) ? validateCutlist(wrapped.cutlist) : null,
        project: wrapped.project && typeof wrapped.project === 'object' ? wrapped.project : null
    };
}
