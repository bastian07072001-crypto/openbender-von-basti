/**
 * Modul-Host: lädt Erweiterungsmodule und stellt ihnen die Schnittstelle
 * (api) bereit. Ein Modul ist eine einzelne JavaScript-Datei (ES-Modul ohne
 * eigene Imports):
 *
 *   export default {
 *       id: 'falzdach', name: 'Falzdach', version: '1.0.0', apiVersion: 1,
 *       register(api) { api.ui.addTab(…); api.templates.add(…); … }
 *   };
 *
 * Herkunft der Module:
 *   - mitgeliefert: modules/index.json + modules/<id>/module.js (App-Ordner)
 *   - installiert:  Unterordner "Module" im Speicherordner (FolderStorage),
 *                   dort auch lizenzen.json mit den Lizenzschlüsseln
 *
 * Alles, was ein Modul beiträgt (Tabs, Menüeinträge, Vorlagen, Zeichen- und
 * PDF-Erweiterungen, Ereignisse), wird pro Modul gemerkt und beim Abschalten
 * wieder entfernt – Abschalten wirkt sofort, ohne Neuladen. Fehler eines
 * Moduls werden abgefangen und stören die App nicht.
 *
 * Modul-Daten (api.data) liegen in der Projektdatei unter "modules" und
 * bleiben auch erhalten, wenn das Modul fehlt oder ausgeschaltet ist.
 *
 * Schnittstelle und Beispiele: docs/module.md
 */
import { globalEventBus } from '../utils/EventBus.js';
import { FolderStorage } from '../storage/FolderStorage.js';
import { ErpStorage } from '../storage/ErpStorage.js';
import { Ausgabe } from '../export/Ausgabe.js';
import { verifyLicense } from './License.js';
import { DxfWriter } from '../export/DxfWriter.js';
import { DxfReader } from '../utils/DxfReader.js';
import { sheetLook } from '../utils/SheetLook.js';
import { Textures } from '../utils/Textures.js';
import { ModuleUI, escapeHtml } from './ModuleUI.js';
import { buildProfile, validateProfile, validateCutlist, cleanCutlistItem } from './ModuleData.js';

export const MODULE_API_VERSION = 1;
export const APP_VERSION = '0.26';

const ENABLED_KEY = 'openbender.modules.enabled';     // { id: true/false } pro Browser
const FOLDER_IDS_KEY = 'openbender.modules.folderIds'; // nur Hinweis "Module warten auf Freigabe"
const LICENSE_FILE = 'lizenzen.json';
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/;

// Ereignisse, die Module mit api.on() abonnieren können
export const MODULE_EVENTS = ['profile:updated', 'document:changed', 'document:new', 'document:loaded', 'tab:changed'];

export class ModuleHost {
    /**
     * app: Zugriff auf die App (aus main.js), siehe createApp() dort:
     *   profile, cutlist, project, setProfile(data, opts), setCutlist(items),
     *   setProject(partial), switchTab(key), currentTab(), markChanged(),
     *   requestRedraw()
     */
    constructor(app) {
        this.app = app;
        this.catalog = [];        // Einträge, siehe makeEntry()
        this.data = {};           // Modul-ID → gespeicherte Daten (Projektdatei)
        this.tabs = [];           // { key, moduleId, label, shortLabel, title, button, view, onShow, onHide }
        this.actions = [];        // { moduleId, id, label, title, onClick }
        this.templates = [];      // { moduleId, key, id, name, category, description, params, build }
        this.drawHooks = [];      // { moduleId, fn }
        this.pdfHooks = [];       // { moduleId, fn }
        this.docTypes = [];       // Dokumentarten für "Neu": { moduleId, id, name, description, icon, mainTab, coreTabs, hideCutlist, onNew, exports }
        this.licenses = {};       // Modul-ID → Lizenzschlüssel (aus lizenzen.json)
        this.folderState = 'none'; // 'none' | 'unsupported' | 'waiting' (Freigabe nötig) | 'ready'
        this.ui = new ModuleUI(this);
    }

    // --- Laden -------------------------------------------------------------

    async loadAll() {
        await this.loadBuiltin();
        await this.loadFolder(false);
        this.ui.refresh();
    }

    async loadBuiltin() {
        let list = [];
        try {
            const res = await fetch(new URL('../../modules/index.json', import.meta.url), { cache: 'no-cache' });
            list = (await res.json()).modules || [];
        } catch (e) {
            console.warn('modules/index.json nicht lesbar', e);
        }
        for (const item of list) {
            const entry = this.makeEntry({ id: item.id, source: 'builtin', file: item.file, defaultOn: item.default !== false });
            try {
                const mod = await import(new URL(`../../modules/${item.file}`, import.meta.url));
                await this.addModule(entry, mod.default);
            } catch (e) {
                this.fail(entry, e);
            }
        }
    }

    /**
     * Installierte Module aus dem Speicherordner. interactive = true nur aus
     * einem Klick heraus (der Browser fragt dann nach der Erlaubnis).
     */
    async loadFolder(interactive) {
        if (!FolderStorage.isSupported()) { this.folderState = 'unsupported'; return; }
        const root = await FolderStorage.getRoot();
        if (!root) { this.folderState = 'none'; return; }
        if (!(await FolderStorage.ensurePermission(root, interactive))) {
            this.folderState = this.rememberedFolderIds().length > 0 ? 'waiting' : 'none';
            return;
        }
        this.folderState = 'ready';
        const dir = await FolderStorage.modulesDir(root, false);
        if (!dir) { this.rememberFolderIds(); return; }

        try {
            this.licenses = JSON.parse(await FolderStorage.readText(dir, LICENSE_FILE)) || {};
        } catch (e) {
            this.licenses = {};
        }

        for await (const [name, handle] of dir.entries()) {
            if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.js')) continue;
            if (this.catalog.some(c => c.source === 'folder' && c.file === name)) continue;
            const entry = this.makeEntry({ id: name.replace(/\.js$/i, ''), source: 'folder', file: name, defaultOn: true });
            try {
                const code = await (await handle.getFile()).text();
                await this.addModule(entry, await importCode(code));
            } catch (e) {
                this.fail(entry, e);
            }
        }
        this.rememberFolderIds();
    }

    makeEntry({ id, source, file, defaultOn }) {
        const entry = {
            id, source, file, defaultOn,
            name: id, version: '', author: '', description: '',
            def: null,          // das Modul-Objekt (export default)
            status: 'off',      // 'active' | 'off' | 'error' | 'license'
            error: '',
            license: null,      // { publisher, product, demo } aus dem Modul
            licenseResult: null,// Ergebnis von verifyLicense
            cleanup: []         // Funktionen, die die Beiträge wieder entfernen
        };
        this.catalog.push(entry);
        return entry;
    }

    fail(entry, error) {
        entry.status = 'error';
        entry.error = error && error.message ? error.message : String(error);
        console.error(`Modul „${entry.id}“:`, error);
    }

    /** Modul prüfen, Metadaten übernehmen und – falls eingeschaltet – starten. */
    async addModule(entry, def) {
        validateModule(def);
        if (this.catalog.some(c => c !== entry && c.id === def.id && c.def)) {
            throw new Error(`Ein Modul mit der ID „${def.id}“ ist bereits geladen`);
        }
        Object.assign(entry, {
            id: def.id,
            name: String(def.name || def.id),
            version: String(def.version || ''),
            author: String(def.author || ''),
            description: String(def.description || ''),
            def,
            license: def.license ? {
                publisher: String(def.license.publisher || ''),
                product: String(def.license.product || def.id),
                demo: def.license.demo === true
            } : null
        });
        if (this.isEnabled(entry)) await this.start(entry);
    }

    async start(entry) {
        if (!entry.def || entry.status === 'active') return;
        entry.error = '';
        if (entry.license) {
            entry.licenseResult = await verifyLicense(this.licenses[entry.id], entry.license);
            if (!entry.licenseResult.valid && !entry.license.demo) {
                entry.status = 'license';
                return;
            }
        }
        try {
            await entry.def.register(this.makeApi(entry));
            entry.status = 'active';
        } catch (e) {
            this.stop(entry);
            this.fail(entry, e);
        }
        this.app.requestRedraw();
    }

    /** Alle Beiträge des Moduls entfernen (Abschalten ohne Neuladen). */
    stop(entry) {
        if (entry.def && typeof entry.def.dispose === 'function' && entry.status === 'active') {
            try { entry.def.dispose(); } catch (e) { console.error(`Modul „${entry.id}“ dispose:`, e); }
        }
        entry.cleanup.splice(0).reverse().forEach(fn => {
            try { fn(); } catch (e) { console.error(e); }
        });
        if (entry.status === 'active') entry.status = 'off';
        this.app.requestRedraw();
    }

    // --- Ein-/Ausschalten, Installieren, Lizenzen --------------------------

    enabledMap() {
        try { return JSON.parse(localStorage.getItem(ENABLED_KEY) || '{}') || {}; } catch (e) { return {}; }
    }

    isEnabled(entry) {
        const map = this.enabledMap();
        return entry.id in map ? map[entry.id] === true : entry.defaultOn;
    }

    async setEnabled(entry, on) {
        const map = this.enabledMap();
        map[entry.id] = !!on;
        try { localStorage.setItem(ENABLED_KEY, JSON.stringify(map)); } catch (e) { /* nur Komfort */ }
        if (on) await this.start(entry);
        else { this.stop(entry); entry.status = 'off'; }
        this.ui.refresh();
    }

    /** Ordner "Module" im Speicherordner (mit Erlaubnis aus einem Klick). */
    async modulesDirInteractive() {
        if (!FolderStorage.isSupported()) throw new Error('Module installieren geht nur mit Ordnerzugriff (Chrome oder Edge, auch als installierte App).');
        const root = await FolderStorage.getRoot();
        if (!root) throw new Error('Bitte zuerst in den Einstellungen (⚙️ in der Statusleiste) unter „Allgemein“ einen Speicherordner wählen.');
        if (!(await FolderStorage.ensurePermission(root, true))) throw new Error('Kein Zugriff auf den Speicherordner.');
        return FolderStorage.modulesDir(root, true);
    }

    /**
     * Moduldatei (.js) prüfen und in den Speicherordner kopieren. Ersetzt
     * eine ältere Version desselben Moduls und startet die neue sofort.
     */
    async install(file) {
        const code = await file.text();
        const def = await importCode(code);
        validateModule(def);
        const dir = await this.modulesDirInteractive();
        // Bereits installierte Module (und Lizenzen) zuerst kennen
        if (this.folderState !== 'ready') await this.loadFolder(true);
        const existing = this.catalog.find(c => c.id === def.id);
        if (existing && existing.source === 'builtin') {
            throw new Error(`„${def.id}“ ist ein mitgeliefertes Modul und kann nicht ersetzt werden.`);
        }
        const fileName = `${def.id}.js`;
        await FolderStorage.writeFile(dir, fileName, code);

        if (existing) {
            this.stop(existing);
            this.catalog.splice(this.catalog.indexOf(existing), 1);
            if (existing.file !== fileName) {
                try { await FolderStorage.removeFile(dir, existing.file); } catch (e) { /* schon weg */ }
            }
        }
        const entry = this.makeEntry({ id: def.id, source: 'folder', file: fileName, defaultOn: true });
        // Neu installiert = eingeschaltet
        const map = this.enabledMap();
        map[def.id] = true;
        try { localStorage.setItem(ENABLED_KEY, JSON.stringify(map)); } catch (e) { /* nur Komfort */ }
        try {
            await this.addModule(entry, def);
        } catch (e) {
            this.fail(entry, e);
        }
        this.rememberFolderIds();
        this.ui.refresh();
        return entry;
    }

    async remove(entry) {
        if (entry.source !== 'folder') return;
        const dir = await this.modulesDirInteractive();
        this.stop(entry);
        try { await FolderStorage.removeFile(dir, entry.file); } catch (e) { /* schon weg */ }
        this.catalog.splice(this.catalog.indexOf(entry), 1);
        this.rememberFolderIds();
        this.ui.refresh();
    }

    /** Lizenzschlüssel prüfen, im Speicherordner ablegen und Modul starten. */
    async setLicense(entry, key) {
        const result = await verifyLicense(key, entry.license);
        if (!result.valid) return result;
        const dir = await this.modulesDirInteractive();
        this.licenses[entry.id] = String(key).trim().replace(/\s+/g, '');
        await FolderStorage.writeFile(dir, LICENSE_FILE, JSON.stringify(this.licenses, null, 2));
        // Neu starten, damit das Modul die Lizenz sieht (Demo → Vollversion)
        this.stop(entry);
        entry.status = 'off';
        if (this.isEnabled(entry)) await this.start(entry);
        this.ui.refresh();
        return result;
    }

    rememberedFolderIds() {
        try { return JSON.parse(localStorage.getItem(FOLDER_IDS_KEY) || '[]') || []; } catch (e) { return []; }
    }

    rememberFolderIds() {
        const ids = this.catalog.filter(c => c.source === 'folder').map(c => c.id);
        try { localStorage.setItem(FOLDER_IDS_KEY, JSON.stringify(ids)); } catch (e) { /* nur Komfort */ }
    }

    // --- Modul-Daten in der Projektdatei -----------------------------------

    /** Für JSONExporter / Autosave: Daten aller Module (auch nicht geladener). */
    getAllData() {
        return Object.keys(this.data).length ? clone(this.data) : undefined;
    }

    /** Nach Laden einer Datei / Autosave. */
    loadData(modules) {
        this.data = modules && typeof modules === 'object' && !Array.isArray(modules) ? clone(modules) : {};
    }

    resetData() {
        this.data = {};
    }

    // --- Beiträge für die App ----------------------------------------------

    /** Aus CanvasRenderer.render(): ctx steht in Profil-Koordinaten (mm). */
    drawOverlays(ctx, info) {
        this.drawHooks.forEach(({ moduleId, fn }) => {
            ctx.save();
            try { fn(ctx, info); } catch (e) { console.error(`Modul „${moduleId}“ canvas.onDraw:`, e); }
            ctx.restore();
        });
    }

    /** PDF-Abschnitte der Module für die Auswahl beim PDF-Export: [{ key, label, standard }] */
    pdfSections() {
        const seen = new Set();
        return this.pdfHooks.filter(h => !seen.has(h.key) && seen.add(h.key))
            .map(({ key, label, standard }) => ({ key, label, standard }));
    }

    /**
     * Aus PDFExporter.export(): Module fügen eigene Seiten an. auswahl: Set der
     * gewählten Abschnitte (pdfSections().key) oder null = alle.
     */
    addPdfPages(pdf, auswahl = null) {
        this.pdfHooks.forEach(({ moduleId, fn, key }) => {
            if (auswahl && !auswahl.has(key)) return;
            try { fn(pdf); } catch (e) { console.error(`Modul „${moduleId}“ pdf.addPages:`, e); }
        });
    }

    // --- Schnittstelle für ein Modul ---------------------------------------

    makeApi(entry) {
        const host = this;
        const app = this.app;
        const moduleId = entry.id;
        const track = (fn) => entry.cleanup.push(fn);
        const lic = entry.licenseResult;

        const api = {
            apiVersion: MODULE_API_VERSION,
            appVersion: APP_VERSION,
            module: Object.freeze({ id: entry.id, name: entry.name, version: entry.version }),

            /** Lizenzstatus (bei Modulen ohne Lizenzpflicht immer gültig). */
            license: Object.freeze(entry.license ? {
                required: true,
                valid: !!(lic && lic.valid),
                demo: !(lic && lic.valid),
                licensee: lic ? lic.licensee : '',
                expires: lic ? lic.expires : null
            } : { required: false, valid: true, demo: false, licensee: '', expires: null }),

            profile: {
                /** Kopie des Profils: { points:[{x,y}], segments:[{startIndex,endIndex,type,backLength?}], conical } */
                get: () => clone(app.profile.toData()),
                /**
                 * Profil ersetzen (ein Rückgängig-Schritt).
                 * data: { points, segments, conical? } oder Ergebnis von build()
                 * opts: { fit: true } = ganzes Profil zeigen
                 */
                set: (data, opts = {}) => app.setProfile(validateProfile(data), opts),
                /** Profil aus Schenkeln bauen (Länge + Richtungsänderung), siehe docs/module.md */
                build: (steps, opts) => buildProfile(steps, opts),
                /** Abwicklung in mm: { front, back, blank, waste } */
                unfold: () => ({ ...app.profile.getUnfoldLengths() })
            },

            cutlist: {
                /** Positionen: [{ length (m), quantity, interlocking, note }] */
                get: () => app.cutlist.toJSON().map(cleanCutlistItem),
                set: (items) => app.setCutlist(validateCutlist(items)),
                add: (item) => app.setCutlist([...app.cutlist.toJSON().map(cleanCutlistItem), ...validateCutlist([item])])
            },

            project: {
                /** Projektdaten: projectNumber, projectName, projectAuthor, profileName,
                 *  materialType, materialSpec, materialThickness, materialColor */
                get: () => ({ ...app.project.getFormData() }),
                set: (partial) => app.setProject(partial || {}),
                /** Aussehen des Blechs in 3D wie in der 3D Vorschau: { key, color, metalness, roughness, lights } */
                material3d: (materialType, spec) => {
                    const f = app.project.getFormData();
                    const look = sheetLook(materialType ?? f.materialType, materialType === undefined ? f.materialSpec : spec);
                    // Module ohne Textur: Durchschnittsfarbe der mitgelieferten Textur, eingefärbt
                    const b = look.texture && Textures.builtin(look.texture.id);
                    if (b && b.color) {
                        const avg = parseInt(b.color.slice(1), 16);
                        const ch = (v, k) => (v >> k) & 255;
                        const mix = (k) => Math.round(ch(avg, k) * ch(look.color, k) / 255) << k;
                        look.color = mix(16) | mix(8) | mix(0);
                    }
                    return look;
                }
            },

            data: {
                /** Eigene Daten des Moduls in der Projektdatei (JSON-fähig) */
                get: () => (moduleId in host.data ? clone(host.data[moduleId]) : null),
                set: (value) => {
                    if (value === null || value === undefined) delete host.data[moduleId];
                    else host.data[moduleId] = clone(value);
                    app.markChanged();
                }
            },

            settings: {
                /** Einstellungen dieses Moduls pro Browser (Komfort, kann verloren gehen) */
                get: (key, def) => {
                    try {
                        const all = JSON.parse(localStorage.getItem(`openbender.module.${moduleId}`) || '{}');
                        return key in all ? all[key] : def;
                    } catch (e) { return def; }
                },
                set: (key, value) => {
                    try {
                        const all = JSON.parse(localStorage.getItem(`openbender.module.${moduleId}`) || '{}');
                        all[key] = value;
                        localStorage.setItem(`openbender.module.${moduleId}`, JSON.stringify(all));
                    } catch (e) { /* ohne Speicher weiter */ }
                }
            },

            ui: {
                /** Eigener Haupt-Tab. Rückgabe: { key, container, show(), setLabel(text) } */
                addTab: (def) => {
                    const tab = host.ui.addTab(entry, def || {});
                    track(() => host.ui.removeTab(tab));
                    return tab.handle;
                },
                /** Eintrag im Modul-Menü (🔌) */
                addAction: (def) => {
                    if (!def || typeof def.onClick !== 'function') throw new Error('addAction: onClick fehlt');
                    const action = { moduleId, id: String(def.id || def.label), label: String(def.label || def.id), title: String(def.title || ''), onClick: def.onClick };
                    host.actions.push(action);
                    host.ui.refresh();
                    track(() => { host.actions.splice(host.actions.indexOf(action), 1); host.ui.refresh(); });
                },
                switchTab: (key) => app.switchTab(key),
                currentTab: () => app.currentTab(),
                toast: (text, type = 'info', duration) => host.ui.toast(text, type, duration),
                confirm: (title, text) => host.ui.confirm(title, text),
                prompt: (def) => host.ui.prompt(def),
                modal: (def) => host.ui.modal(def),
                saveFile: (name, content, mime) => saveFile(name, content, mime),
                esc: escapeHtml
            },

            templates: {
                /** Profilvorlage mit Parametern (Menü 🔌 → „Profil aus Vorlage …“) */
                add: (def) => {
                    if (!def || typeof def.build !== 'function') throw new Error('templates.add: build fehlt');
                    const tpl = {
                        moduleId,
                        key: `${moduleId}:${def.id || def.name}`,
                        id: String(def.id || def.name),
                        name: String(def.name || def.id),
                        shortName: def.shortName ? String(def.shortName) : null,
                        category: String(def.category || entry.name),
                        description: String(def.description || ''),
                        params: Array.isArray(def.params) ? def.params : [],
                        build: def.build
                    };
                    host.templates.push(tpl);
                    host.ui.refresh();
                    track(() => { host.templates.splice(host.templates.indexOf(tpl), 1); host.ui.refresh(); });
                }
            },

            documents: {
                /**
                 * Eigene Dokumentart (Art von Ausmass) neben "Blechprofil": im
                 * Dialog "Neues Projekt" und "Neues Ausmass" der Leiste.
                 * def: { id, name, shortName (Name einer Karte ohne eigenen Namen,
                 * z.B. "Blindpaneel" → „Blindpaneel 3“), description, icon,
                 * mainTab (Key eines Tabs mit docType: id), coreTabs: ['cutlist', …],
                 * hideCutlist, onNew({ from }), preview(data), split(data),
                 * exports: { pdf(), dxf() } } – siehe docs/module.md
                 */
                addType: (def) => {
                    if (!def || !ID_PATTERN.test(def.id || '') || def.id === 'profile') throw new Error('documents.addType: ungültige id');
                    if (host.docTypes.some(t => t.id === def.id)) throw new Error(`Dokumentart „${def.id}“ gibt es schon`);
                    const type = {
                        moduleId,
                        id: def.id,
                        name: String(def.name || def.id),
                        shortName: def.shortName ? String(def.shortName) : null,
                        description: String(def.description || ''),
                        icon: String(def.icon || '📄'),
                        mainTab: def.mainTab ? String(def.mainTab) : null,
                        coreTabs: (Array.isArray(def.coreTabs) ? def.coreTabs : ['cutlist']).filter(t => ['profile', 'cutlist', 'zuschnitt', 'vorschau'].includes(t)),
                        hideCutlist: def.hideCutlist === true,
                        onNew: typeof def.onNew === 'function' ? def.onNew : null,
                        preview: typeof def.preview === 'function' ? def.preview : null,
                        split: typeof def.split === 'function' ? def.split : null,
                        exports: def.exports && typeof def.exports === 'object' ? def.exports : {}
                    };
                    host.docTypes.push(type);
                    if (app.docTypesChanged) app.docTypesChanged();
                    track(() => {
                        host.docTypes.splice(host.docTypes.indexOf(type), 1);
                        // Dokumentart verschwindet: anderes Ausmass bearbeiten (Daten bleiben)
                        if (app.docTypesChanged) app.docTypesChanged();
                        else if (app.docType() === type.id) app.applyDocType('profile');
                    });
                },
                /** Aktive Dokumentart: 'profile' oder die id einer Modul-Dokumentart */
                current: () => app.docType(),
                /**
                 * Alle Ausmasse des Projekts von Dokumentarten dieses Moduls, in der
                 * Reihenfolge der Leiste: [{ id, nr, type, name, active, data }]
                 * (data = eigene Daten des Moduls in diesem Ausmass, Kopie)
                 */
                entries: () => (app.documentEntries ? app.documentEntries(moduleId) : [])
            },

            canvas: {
                /** Zusätzlich zeichnen: fn(ctx, { scale, points, segments, conical }) in mm */
                onDraw: (fn) => {
                    const hook = { moduleId, fn };
                    host.drawHooks.push(hook);
                    app.requestRedraw();
                    track(() => host.drawHooks.splice(host.drawHooks.indexOf(hook), 1));
                },
                redraw: () => app.requestRedraw()
            },

            /**
             * Bibliotheken der App (oder null, falls nicht geladen):
             *   three – three.js r128 mit THREE.OrbitControls
             *   jsPDF – jsPDF 2.5.1 (Konstruktor) mit Plugin autoTable
             */
            libs: Object.freeze({
                get three() { return window.THREE || null; },
                get jsPDF() { return (window.jspdf && window.jspdf.jsPDF) || null; }
            }),

            dxf: {
                /**
                 * Neuer DXF-Schreiber (R12, mm). layers: { NAME: ACI-Farbe }.
                 * Methoden: line, polyline (mit bulge), circle, arc, text,
                 * toString(). Speichern mit api.ui.saveFile(name, text, 'application/dxf').
                 */
                create: (layers = {}) => new DxfWriter(layers),
                /**
                 * DXF-Text lesen: { units, layers: { NAME: { loops, open,
                 * branches, points, texts } }, warnings } – Konturen in mm,
                 * geschlossen im Gegenuhrzeigersinn. opts: { tolerance }.
                 */
                read: (text, opts = {}) => DxfReader.read(String(text || ''), opts)
            },

            pdf: {
                /**
                 * Eigene Seiten im PDF: fn(pdf), siehe docs/module.md. opts: { id, label, standard } –
                 * mit label erscheint der Abschnitt im Auswahldialog beim PDF-Export einzeln
                 */
                addPages: (fn, opts = {}) => {
                    const hook = {
                        moduleId, fn,
                        key: `${moduleId}:${opts.id || ''}`,
                        label: String(opts.label || entry.name || moduleId),
                        standard: opts.standard !== false
                    };
                    host.pdfHooks.push(hook);
                    track(() => host.pdfHooks.splice(host.pdfHooks.indexOf(hook), 1));
                }
            },

            /** Ereignis abonnieren: profile:updated, document:changed, document:new, document:loaded, tab:changed */
            on: (event, fn) => {
                if (!MODULE_EVENTS.includes(event)) throw new Error(`Unbekanntes Ereignis „${event}“`);
                const safe = (payload) => {
                    try { fn(payload); } catch (e) { console.error(`Modul „${moduleId}“ Ereignis ${event}:`, e); }
                };
                globalEventBus.on(event, safe);
                track(() => globalEventBus.off(event, safe));
            }
        };
        return Object.freeze(api);
    }
}

// --- Hilfsfunktionen ------------------------------------------------------

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function importCode(code) {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
        return (await import(url)).default;
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function validateModule(def) {
    if (!def || typeof def !== 'object') throw new Error('Die Datei hat kein „export default { … }“');
    if (!ID_PATTERN.test(def.id || '')) throw new Error('„id“ fehlt oder ist ungültig (a–z, 0–9, -, 2–41 Zeichen)');
    if (typeof def.register !== 'function') throw new Error('Funktion „register(api)“ fehlt');
    const needs = Number(def.apiVersion || 1);
    if (needs > MODULE_API_VERSION) {
        throw new Error(`Modul braucht Schnittstelle ${needs}, diese OpenBender-Version hat ${MODULE_API_VERSION} – bitte OpenBender aktualisieren`);
    }
    if (def.license && !def.license.publisher) throw new Error('license.publisher fehlt');
}

/** Datei speichern: Speichern-unter-Dialog, sonst Download. */
async function saveFile(name, content, mime = 'text/plain') {
    const body = mime === 'text/csv' && typeof content === 'string' ? '﻿' + content : content;
    const blob = body instanceof Blob ? body : new Blob([body], { type: mime });
    // ERPNext: Ablage im Projekt statt Speichern-unter (js/export/Ausgabe.js)
    if (ErpStorage.isActive()) return Ausgabe.speichern(name, blob, mime);
    if (typeof window.showSaveFilePicker === 'function') {
        try {
            const handle = await window.showSaveFilePicker({ suggestedName: name });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return true;
        } catch (e) {
            if (e && e.name === 'AbortError') return false;
        }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
}
