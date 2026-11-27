import { FolderStorage, MODULE_DIR } from '../storage/FolderStorage.js';
import { TEMPLATE_DIR } from '../templates/UserTemplates.js';
import { SETTINGS_DIR } from '../utils/Materials.js';
import { Toast } from '../utils/Toast.js';
import { FeldMeldung } from '../utils/FeldMeldung.js';
import { isProjectFile, flattenProjectFile } from '../models/ProjectStore.js';

/**
 * Eigene Öffnen-/Speichern-Ansicht im Stil eines Cloud-Speichers: Kacheln
 * mit Profil-Vorschau, Ordner zum Durchklicken, neue Ordner anlegen,
 * Speichern direkt in den aktuellen Ordner. Arbeitet auf dem in den
 * Optionen gewählten Speicherordner (FolderStorage). Ohne Ordnerzugriff
 * (Browser ohne File System Access API) bleibt es beim klassischen
 * Download / Datei-Auswahl (siehe main.js).
 *
 * options:
 *   getSaveContent()    -> { json, suggestedName }  (zu speichernde Datei)
 *   onOpen(data, name)  -> geladene Datei übernehmen
 *   onClassicSave()     -> klassischer Download (Ausweg im Dialog)
 *   onClassicOpen()     -> klassische Datei-Auswahl (Ausweg im Dialog)
 *   preview(data)       -> optional { thumbnail: SVG-Text, text } für Dateien
 *                          anderer Dokumentarten (Module); null = Blechprofil
 *
 * ERP-Modus (setErp, nur wenn ERPNext die Seite ausliefert): statt des
 * Speicherordners die Projektablage aus ERPNext. Wurzel "Projektordner" mit
 * den offenen Projekten, im Projekt die openBender-Dateien (Nextcloud:
 * Unterordner "Zeichnungen"). erp = {
 *   rootLabel, unterordner,
 *   list(path)                     -> { folders: [{ name, disabled, title }], files, schreibbar } | null
 *   open(entry, path)              -> Datei laden und übernehmen
 *   save(path, base, { existing, isCurrent }) -> speichern (wirft Error mit Meldung)
 *   istAktuell(entry, path)        -> ist das die geöffnete Datei?
 * }
 */
const LAST_PATH_KEY = 'openbender.fileBrowserPath';
const INVALID_NAME = /[\\/:*?"<>|]/;

export class FileBrowserController {
    constructor(options) {
        this.options = options;
        this.mode = 'open';
        this.root = null;
        this.path = [];
        this.entries = { folders: [], files: [] };
        this.creatingFolder = false;
        this.currentDoc = null; // { path, name } der zuletzt geöffneten/gespeicherten Datei

        try { this.path = JSON.parse(localStorage.getItem(LAST_PATH_KEY) || '[]') || []; } catch (e) { this.path = []; }

        this.overlay = document.getElementById('file-browser-overlay');
        this.body = document.getElementById('fb-body');
        this.titleEl = document.getElementById('fb-title');
        this.breadcrumb = document.getElementById('fb-breadcrumb');
        this.filter = document.getElementById('fb-filter');
        this.saveBar = document.getElementById('fb-savebar');
        this.fileName = document.getElementById('fb-filename');
        this.classicLink = document.getElementById('fb-classic');
        this.dialog = this.overlay ? this.overlay.querySelector('.file-browser') : null;
        this.erp = null;
        this.initEvents();
    }

    /** ERP-Modus einschalten (siehe oben) */
    setErp(erp) {
        this.erp = erp;
        this.path = [];
    }

    // Nach "Neu": Speichern schlägt wieder einen Namen aus den Projektdaten vor
    forgetDocument() {
        this.currentDoc = null;
    }

    initEvents() {
        if (!this.overlay) return;
        document.getElementById('fb-close').addEventListener('click', () => this.close());
        this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.close(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen() && !this.creatingFolder) this.close();
        });
        document.getElementById('fb-new-folder').addEventListener('click', () => {
            this.creatingFolder = true;
            this.renderBody();
        });
        document.getElementById('fb-save').addEventListener('click', () => this.save());
        this.fileName.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.save(); });
        this.filter.addEventListener('input', () => this.renderBody());
        this.classicLink.addEventListener('click', (e) => {
            e.preventDefault();
            this.close();
            if (this.mode === 'save') this.options.onClassicSave();
            else this.options.onClassicOpen();
        });

        this.breadcrumb.addEventListener('click', (e) => {
            const crumb = e.target.closest('[data-depth]');
            if (!crumb) return;
            this.navigate(this.path.slice(0, Number(crumb.dataset.depth)));
        });

        this.body.addEventListener('click', (e) => this.onBodyClick(e));
        this.body.addEventListener('keydown', (e) => {
            if (e.target.id === 'fb-new-folder-name') {
                if (e.key === 'Enter') this.createFolder(e.target.value);
                if (e.key === 'Escape') { this.creatingFolder = false; this.renderBody(); }
                return;
            }
            const tile = e.target.closest('.fb-tile');
            if (tile && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                tile.click();
            }
        });
    }

    isOpen() {
        return this.overlay && !this.overlay.classList.contains('hidden');
    }

    /**
     * Öffnen ('open') oder Speichern ('save'). Muss aus einem Klick heraus
     * aufgerufen werden (Browser fragt evtl. nach der Ordner-Berechtigung).
     */
    async open(mode, startPath = null) {
        this.mode = mode;
        this.creatingFolder = false;
        this.filter.value = '';
        this.titleEl.textContent = mode === 'save' ? 'Speichern' : 'Öffnen';
        this.classicLink.textContent = mode === 'save' ? 'Stattdessen als Datei herunterladen' : 'Stattdessen Datei vom Gerät wählen';
        this.saveBar.classList.toggle('hidden', mode !== 'save');
        this.overlay.classList.remove('hidden');
        const btnNewFolder = document.getElementById('fb-new-folder');
        if (btnNewFolder) btnNewFolder.hidden = !!this.erp;
        this.classicLink.hidden = !!this.erp;

        if (this.erp) {
            if (mode === 'save') this.fileName.value = this.options.getSaveContent().suggestedName;
            if (startPath) this.path = [...startPath];
            await this.navigate(this.path);
            return;
        }

        if (mode === 'save') {
            const { suggestedName } = this.options.getSaveContent();
            this.fileName.value = this.currentDoc ? this.currentDoc.name.replace(/\.json$/i, '') : suggestedName;
            if (this.currentDoc) this.path = [...this.currentDoc.path];
        }

        this.root = await FolderStorage.getRoot();
        if (!this.root) {
            this.renderMessage('Noch kein Speicherordner gewählt.', '📁 Speicherordner wählen', () => this.chooseRoot(), true);
            return;
        }
        if (!(await FolderStorage.ensurePermission(this.root, true))) {
            this.renderMessage(`Kein Zugriff auf den Ordner „${rootName(this.root)}“.`, 'Zugriff erlauben', () => this.open(mode), true);
            return;
        }
        await this.navigate(this.path);
    }

    close() {
        if (this.overlay) this.overlay.classList.add('hidden');
    }

    async chooseRoot() {
        try {
            this.root = await FolderStorage.chooseRoot();
            this.path = [];
            await this.navigate([]);
            document.dispatchEvent(new CustomEvent('openbender:storage-changed'));
        } catch (e) {
            if (e && e.name !== 'AbortError') Toast.show('Ordner konnte nicht gewählt werden.', 'warning');
        }
    }

    async navigate(path) {
        if (this.erp) return this.navigateErp(path);
        try {
            this.dir = await FolderStorage.resolve(this.root, path);
            this.path = path;
        } catch (e) {
            // Ordner existiert nicht mehr – zurück zum Speicherordner
            this.dir = this.root;
            this.path = [];
        }
        try { localStorage.setItem(LAST_PATH_KEY, JSON.stringify(this.path)); } catch (e) { /* nur Komfort */ }

        this.creatingFolder = false;
        this.setOhneOrdner(false);
        this.renderBreadcrumb();
        this.body.innerHTML = '<p class="fb-message">Wird geladen …</p>';
        try {
            this.entries = await FolderStorage.list(this.dir);
            // Modul-Ordner (installierte Module) gehört nicht zu den Profilen
            if (this.path.length === 0) this.entries.folders = this.entries.folders.filter(f => f.name !== MODULE_DIR && f.name !== TEMPLATE_DIR && f.name !== SETTINGS_DIR);
            // Projektdateien (mehrere Profile): Kachel zeigt das zuletzt bearbeitete Profil
            this.entries.files.forEach(f => { if (f.data) f.data = flattenProjectFile(f.data) || f.data; });
        } catch (e) {
            this.renderMessage('Der Ordner konnte nicht gelesen werden.', 'Erneut versuchen', () => this.navigate(this.path));
            return;
        }
        this.renderBody();
    }

    async navigateErp(path) {
        this.path = path;
        this.creatingFolder = false;
        this.setOhneOrdner(false);
        this.renderBreadcrumb();
        this.body.innerHTML = '<p class="fb-message">Wird geladen …</p>';
        let entries;
        try {
            entries = await this.erp.list(path);
        } catch (e) {
            this.renderMessage(e.message || 'Die Ablage konnte nicht gelesen werden.', 'Erneut versuchen', () => this.navigate(this.path));
            return;
        }
        // Projekt nicht (mehr) offen: zurück zu den Projektordnern
        if (!entries) return this.navigate([]);
        entries.files.forEach(f => { if (f.data) f.data = flattenProjectFile(f.data) || f.data; });
        this.entries = entries;
        this.renderBody();
    }

    /**
     * Hinweis statt Dateiliste. ohneOrdner: noch kein (erreichbarer) Speicherordner –
     * der Dialog wird kompakt, Suchen/Neuer Ordner verschwinden, und die einzelne
     * Datei (öffnen bzw. herunterladen) steht als gleichwertiger zweiter Weg daneben.
     */
    renderMessage(text, buttonLabel, action, ohneOrdner = false) {
        this.breadcrumb.innerHTML = '';
        this.setOhneOrdner(ohneOrdner);
        const zweiterWeg = this.mode === 'save' ? '⬇ Als einzelne Datei herunterladen' : '📄 Einzelne Datei vom Gerät öffnen';
        this.body.innerHTML = `<div class="fb-empty"><p>${escapeHtml(text)}</p>
            <p class="fb-hint">Im Speicherordner liegen die Profile als JSON-Dateien (z.B. auf der Festplatte oder einem Netzlaufwerk) und stehen an allen Arbeitsplätzen mit demselben Ordner zur Verfügung.</p>
            <div class="fb-empty-actions">
                <button type="button" class="dxf-btn dxf-btn-primary" id="fb-message-action">${escapeHtml(buttonLabel)}</button>
                ${ohneOrdner ? `<button type="button" class="dxf-btn" id="fb-message-classic">${zweiterWeg}</button>` : ''}
            </div></div>`;
        document.getElementById('fb-message-action').addEventListener('click', action);
        const classic = document.getElementById('fb-message-classic');
        if (classic) classic.addEventListener('click', () => this.classicLink.click());
    }

    setOhneOrdner(an) {
        if (this.dialog) this.dialog.classList.toggle('fb-ohne-ordner', an);
    }

    renderBreadcrumb() {
        const parts = this.erp
            ? [this.erp.rootLabel, ...this.path, ...(this.path.length && this.erp.unterordner ? [this.erp.unterordner] : [])]
            : [rootName(this.root), ...this.path];
        this.breadcrumb.innerHTML = parts.map((name, depth) => depth === parts.length - 1
            ? `<span class="fb-crumb fb-crumb-current">${escapeHtml(name)}</span>`
            : `<button type="button" class="fb-crumb" data-depth="${depth}">${escapeHtml(name)}</button><span class="fb-sep">›</span>`
        ).join('');
    }

    renderBody() {
        const query = this.filter.value.trim().toLowerCase();
        const match = (text) => !query || text.toLowerCase().includes(query);
        const { folders, files } = this.entries;

        let html = '<div class="fb-grid">';
        if (this.path.length > 0) {
            html += `<div class="fb-tile fb-folder fb-up" tabindex="0" data-up="1"><div class="fb-icon">⬑</div><div class="fb-name">Zurück</div></div>`;
        }
        if (this.creatingFolder) {
            html += `<div class="fb-tile fb-folder fb-new"><div class="fb-icon">📁</div>
                <input type="text" id="fb-new-folder-name" class="fb-new-input" placeholder="Ordnername" aria-label="Name des neuen Ordners">
                <div class="fb-new-actions"><button type="button" class="dxf-btn dxf-btn-primary" data-create="1">Anlegen</button></div></div>`;
        }
        folders.filter(f => match(f.name)).forEach(f => {
            html += `<div class="fb-tile fb-folder${f.disabled ? ' fb-disabled' : ''}" tabindex="0" data-folder="${escapeHtml(f.name)}"${f.title ? ` title="${escapeHtml(f.title)}"` : ''}><div class="fb-icon">📁</div><div class="fb-name">${escapeHtml(f.name)}</div></div>`;
        });
        files.filter(f => match(f.name) || match(fileMeta(f).text)).forEach(f => {
            // Dokumentart eines Moduls (z.B. Blindpaneele): Vorschau vom Modul
            let custom = null;
            if (f.data && f.data.docType && f.data.docType !== 'profile' && this.options.preview) {
                try { custom = this.options.preview(f.data); } catch (e) { custom = null; }
            }
            const meta = fileMeta(f, custom && custom.text);
            const current = this.erp ? this.erp.istAktuell(f, this.path)
                : this.currentDoc && this.currentDoc.name === f.name && sameArray(this.currentDoc.path, this.path);
            html += `<div class="fb-tile fb-file${current ? ' fb-current' : ''}" tabindex="0" data-file="${escapeHtml(f.name)}" title="${escapeHtml(f.name)}">
                <div class="fb-thumb">${custom && custom.thumbnail ? custom.thumbnail : profileThumbnail(f.data)}</div>
                <div class="fb-name">${escapeHtml(f.name.replace(/\.json$/i, ''))}</div>
                <div class="fb-meta">${escapeHtml(meta.text) || '&nbsp;'}</div>
                <div class="fb-date">${formatDateTime(f.modified)}</div>
            </div>`;
        });
        html += '</div>';

        if (this.erp && this.path.length === 0 && this.mode === 'save') {
            html += '<p class="fb-message">Zum Speichern zuerst das Projekt öffnen.</p>';
        } else if (this.erp && this.entries.schreibbar === false && this.mode === 'save') {
            html += '<p class="fb-message">Dieser Projektordner ist nur lesbar (archiviert oder ausserhalb der Projektablage).</p>';
        }
        if (folders.length === 0 && files.length === 0 && !this.creatingFolder) {
            html += `<p class="fb-message">${this.erp && this.path.length ? `Im Ordner „${escapeHtml(this.erp.unterordner || this.path[this.path.length - 1])}“ liegen noch keine openBender-Dateien.` : 'Dieser Ordner ist leer.'}${this.mode === 'save' && (!this.erp || this.path.length) ? ' Unten einen Namen eingeben und speichern.' : ''}</p>`;
        }
        this.body.innerHTML = html;

        const input = document.getElementById('fb-new-folder-name');
        if (input) input.focus();
    }

    async onBodyClick(e) {
        if (e.target.closest('[data-create]')) {
            this.createFolder(document.getElementById('fb-new-folder-name').value);
            return;
        }
        const tile = e.target.closest('.fb-tile');
        if (!tile || tile.classList.contains('fb-new')) return;

        if (tile.classList.contains('fb-disabled')) {
            Toast.show(tile.title || 'Dieser Ordner ist nicht verfügbar.', 'warning');
            return;
        }
        if (tile.dataset.up) {
            this.navigate(this.path.slice(0, -1));
        } else if (tile.dataset.folder !== undefined) {
            this.navigate([...this.path, tile.dataset.folder]);
        } else if (tile.dataset.file !== undefined) {
            const entry = this.entries.files.find(f => f.name === tile.dataset.file);
            if (!entry) return;
            if (this.mode === 'save') {
                // Datei antippen = deren Namen übernehmen (überschreiben)
                this.fileName.value = entry.name.replace(/\.json$/i, '');
                this.fileName.focus();
            } else {
                this.openFile(entry);
            }
        }
    }

    async createFolder(rawName) {
        const name = (rawName || '').trim();
        if (!name || name.startsWith('.') || INVALID_NAME.test(name)) {
            FeldMeldung.zeigen(document.getElementById('fb-new-folder-name'), 'Ungültiger Ordnername (keine Zeichen wie / \\ : * ? " < > |).');
            return;
        }
        try {
            await FolderStorage.createFolder(this.dir, name);
            await this.navigate([...this.path, name]);
        } catch (e) {
            Toast.show('Ordner konnte nicht angelegt werden.', 'warning');
        }
    }

    async openFile(entry) {
        if (this.erp) {
            try {
                await this.erp.open(entry, [...this.path]);
            } catch (e) {
                Toast.show(`Öffnen fehlgeschlagen: ${e.message || e}`, 'warning', 7000);
                return;
            }
            this.close();
            return;
        }
        let data = entry.data;
        try {
            data = await FolderStorage.readJson(entry.handle);
        } catch (e) {
            Toast.show(`„${entry.name}“ ist keine gültige openBender-Datei.`, 'warning');
            return;
        }
        if (!isProjectFile(data)) {
            Toast.show(`„${entry.name}“ ist keine openBender-Datei.`, 'warning');
            return;
        }
        this.currentDoc = { path: [...this.path], name: entry.name };
        this.close();
        this.options.onOpen(data, entry.name);
    }

    async save() {
        const base = this.fileName.value.trim().replace(/\.json$/i, '');
        if (!base || base.startsWith('.') || INVALID_NAME.test(base)) {
            FeldMeldung.zeigen(this.fileName, 'Bitte einen gültigen Dateinamen eingeben (keine Zeichen wie / \\ : * ? " < > |).');
            return;
        }
        if (this.erp) return this.saveErp(base);
        if (!this.dir) return;
        const name = `${base}.json`;

        const isCurrent = this.currentDoc && this.currentDoc.name === name && sameArray(this.currentDoc.path, this.path);
        if (!isCurrent && await FolderStorage.exists(this.dir, name)) {
            if (!window.confirm(`„${name}“ gibt es in diesem Ordner schon. Überschreiben?`)) return;
        }

        try {
            await FolderStorage.writeFile(this.dir, name, this.options.getSaveContent().json);
        } catch (e) {
            Toast.show('Speichern fehlgeschlagen – Ordner noch erreichbar?', 'warning');
            return;
        }
        this.currentDoc = { path: [...this.path], name };
        if (this.options.onSaved) this.options.onSaved(name);
        this.close();
        Toast.show(`Gespeichert: ${[rootName(this.root), ...this.path, name].join(' / ')}`, 'info');
    }
}

// --- Hilfsfunktionen ---

// ERP-Modus: Speichern im geöffneten Projekt (Methode der Klasse, siehe unten angehängt)
FileBrowserController.prototype.saveErp = async function (base) {
    if (!this.path.length) {
        FeldMeldung.zeigen(this.fileName, 'Bitte zuerst das Projekt öffnen, in dem die Datei liegen soll.');
        return;
    }
    if (this.entries.schreibbar === false) {
        FeldMeldung.zeigen(this.fileName, 'Dieser Projektordner ist nur lesbar.');
        return;
    }
    const name = `${base}.json`;
    const existing = this.entries.files.find(f => f.name.toLowerCase() === name.toLowerCase()) || null;
    const isCurrent = !!existing && this.erp.istAktuell(existing, this.path);
    if (existing && !isCurrent && !window.confirm(`„${existing.name}“ gibt es in diesem Projekt schon. Überschreiben?`)) return;
    try {
        await this.erp.save([...this.path], base, { existing, isCurrent });
    } catch (e) {
        Toast.show(`Speichern fehlgeschlagen: ${e.message || e}`, 'warning', 8000);
        return;
    }
    this.close();
};

export function rootName(root) {
    return (root && root.name) || 'Speicherordner';
}

function sameArray(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDateTime(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Projekt, Profilname und Material für die Kachel (auch für die Suche)
function fileMeta(entry, docText) {
    const p = (entry.data && entry.data.project) || {};
    // Projekt mit mehreren Einträgen: „3 Profile“ bzw. bei verschiedenen Arten „5 Ausmasse“
    const arten = entry.data && entry.data.typeCounts ? Object.keys(entry.data.typeCounts) : [];
    const nurProfile = arten.every(t => t === 'profile');
    const count = entry.data && entry.data.profileCount > 1 ? `${entry.data.profileCount} ${nurProfile ? 'Profile' : 'Ausmasse'}` : '';
    const parts = [p.projectNumber, p.projectName, count || p.profileName, docText].filter(Boolean);
    const material = [p.materialType, p.materialSpec].filter(Boolean).join(' ');
    if (material) parts.push(material + (p.materialThickness ? ` ${p.materialThickness} mm` : ''));
    return { text: parts.join(' · ') };
}

/**
 * Kleine Vorschau des Profils als SVG (Linien zwischen den Punkten, wie im
 * Editor mit y nach unten). Konisch: hinteres Ende wird hier nicht gezeigt.
 */
export function profileThumbnail(data) {
    const profile = data && data.profile;
    const points = profile && Array.isArray(profile.points) ? profile.points : [];
    const segments = profile && Array.isArray(profile.segments) ? profile.segments : [];
    const valid = points.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    if (valid.length < 2 || segments.length === 0) {
        return '<div class="fb-thumb-empty">{ }</div>';
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    valid.forEach(p => {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
    const pad = Math.max(w, h) * 0.08;

    const lines = segments.map(seg => {
        const a = points[seg.startIndex], b = points[seg.endIndex];
        if (!a || !b) return '';
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" vector-effect="non-scaling-stroke"/>`;
    }).join('');

    return `<svg viewBox="${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <g fill="none" stroke="#2c3e50" stroke-width="2.5" stroke-linecap="round">${lines}</g>
    </svg>`;
}
