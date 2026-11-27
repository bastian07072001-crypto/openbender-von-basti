/**
 * Projekt mit mehreren Blechprofilen.
 *
 * Eine Datei ist ein Projekt: Projektdaten (Nummer, Name, Zeichner) einmal,
 * darunter die Profile. Jedes Profil trägt, was bis Version 0.22 die ganze
 * Datei ausmachte: Geometrie, Material, Stückliste, Zuschnitt, Moduldaten.
 *
 * Der Editor arbeitet immer mit EINEM, dem aktiven Profil (Profile-Modell,
 * Stückliste, Zuschnitt, Module). Der Speicher hält die übrigen Profile und
 * tauscht beim Wechsel: Stand des aktiven Profils ablegen (capture), das
 * gewählte laden (apply).
 *
 * Ein Eintrag ist ein Ausmass einer bestimmten Art (type): ein Blechprofil
 * ('profile') oder eine Dokumentart eines Moduls (z.B. 'blindpaneele'). Die
 * Oberfläche (Tabs, Toolbar, PDF/DXF) richtet sich nach dem aktiven Eintrag.
 *
 * Dateiformat 2.1:
 *   { version: "2.1", timestamp,
 *     project: { projectNumber, projectName, projectAuthor },
 *     activeProfile: <id>,
 *     profiles: [ { id, type, name,
 *                   material: { type, spec, thickness, color },
 *                   profile: { points, segments, conical },
 *                   cutlist: [...], cutting: {...}, modules: {...} } ] }
 * 2.0 hatte die Art einmal für die ganze Datei (docType); sie gilt beim
 * Öffnen für alle Einträge. Dateien bis 1.5 (ein Profil, alles auf oberster
 * Ebene) werden als Projekt mit einem Eintrag übernommen. Die id eines
 * Eintrags bleibt beim Umbenennen gleich (Verknüpfung z.B. mit ERPNext).
 */

export const FILE_VERSION = '2.1';
export const PROFILE_TYPE = 'profile';
export const PROJECT_FIELDS = ['projectNumber', 'projectName', 'projectAuthor'];
export const PROFILE_FIELDS = ['profileName', 'materialType', 'materialSpec', 'materialThickness', 'materialColor'];

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, (obj && obj[k]) ?? '']));

export const newProfileId = () => {
    const bytes = new Uint8Array(6);
    (globalThis.crypto || { getRandomValues: (b) => b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); }) }).getRandomValues(bytes);
    return 'p-' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
};

/** Startprofil wie im Profile-Modell: eine Linie (0,0)–(0,50) */
const emptyGeometry = () => ({ points: [{ x: 0, y: 0 }, { x: 0, y: 50 }], segments: [{ type: 'line', startIndex: 0, endIndex: 1 }], conical: false });

const entryToFile = (e) => ({
    id: e.id,
    type: e.type || PROFILE_TYPE,
    name: e.fields.profileName || '',
    material: { type: e.fields.materialType || '', spec: e.fields.materialSpec || '', thickness: e.fields.materialThickness || '', color: e.fields.materialColor || '' },
    profile: e.profile,
    cutlist: e.cutlist || [],
    cutting: e.cutting ?? null,
    ...(e.modules ? { modules: e.modules } : {})
});

const entryFromFile = (p, fileType) => {
    const m = p.material || {};
    return {
        id: typeof p.id === 'string' && p.id ? p.id : newProfileId(),
        type: typeof p.type === 'string' && p.type ? p.type : fileType,
        fields: { profileName: p.name || '', materialType: m.type || '', materialSpec: m.spec || '', materialThickness: m.thickness || '', materialColor: m.color || '' },
        profile: p.profile && Array.isArray(p.profile.points) ? p.profile : emptyGeometry(),
        cutlist: Array.isArray(p.cutlist) ? p.cutlist : [],
        cutting: p.cutting ?? null,
        modules: p.modules && typeof p.modules === 'object' ? p.modules : undefined
    };
};

/** Ist das eine OpenBender-Datei (altes oder neues Format)? */
export const isProjectFile = (data) => !!data && typeof data === 'object'
    && (Array.isArray(data.profiles) ? data.profiles.length > 0 : !!data.profile);

/**
 * Datei (alt oder neu) → { docType, project, activeId, entries }
 * docType: Art des aktiven Eintrags (für Vorschau und Datei-Browser)
 */
export function readProjectFile(data) {
    const fileType = typeof data.docType === 'string' && data.docType ? data.docType : PROFILE_TYPE;
    if (Array.isArray(data.profiles) && data.profiles.length) {
        const entries = data.profiles.map(p => entryFromFile(p, fileType));
        // doppelte ids (von Hand bearbeitete Datei) eindeutig machen
        const seen = new Set();
        entries.forEach(e => { if (seen.has(e.id)) e.id = newProfileId(); seen.add(e.id); });
        const activeId = entries.some(e => e.id === data.activeProfile) ? data.activeProfile : entries[0].id;
        return { docType: entries.find(e => e.id === activeId).type, project: pick(data.project, PROJECT_FIELDS), activeId, entries };
    }
    // bis 1.5: ein Profil, Projekt- und Profilfelder gemischt in data.project
    const entry = {
        id: newProfileId(),
        type: fileType,
        fields: pick(data.project, PROFILE_FIELDS),
        profile: data.profile || emptyGeometry(),
        cutlist: Array.isArray(data.cutlist) ? data.cutlist : [],
        cutting: data.cutting ?? null,
        modules: data.modules && typeof data.modules === 'object' ? data.modules : undefined
    };
    return { docType: fileType, project: pick(data.project, PROJECT_FIELDS), activeId: entry.id, entries: [entry] };
}

/**
 * Ansicht des aktiven Profils im alten Aufbau ({ project, profile, cutlist, … })
 * – für Vorschaubilder im Datei-Dialog und alles, was nur ein Profil braucht.
 * profileCount: Anzahl Profile im Projekt.
 */
export function flattenProjectFile(data) {
    if (!isProjectFile(data)) return null;
    const { docType, project, activeId, entries } = readProjectFile(data);
    const e = entries.find(x => x.id === activeId) || entries[0];
    return {
        docType, project: { ...project, ...e.fields }, profile: e.profile, cutlist: e.cutlist, cutting: e.cutting, modules: e.modules,
        profileCount: entries.length,
        // Anzahl je Art, z.B. { profile: 3, blindpaneele: 2 }
        typeCounts: entries.reduce((n, x) => ({ ...n, [x.type]: (n[x.type] || 0) + 1 }), {})
    };
}

export class ProjectStore {
    /**
     * capture(): Stand des aktiven Profils aus dem Editor → { fields, profile, cutlist, cutting, modules }
     * apply(entry): Profil in den Editor laden
     */
    constructor({ capture, apply }) {
        this.capture = capture;
        this.apply = apply;
        this.reset();
    }

    /** Leeres Projekt mit einem Eintrag der Art type (der Editor ist dann schon leer – nichts laden) */
    reset(type = PROFILE_TYPE) {
        this.entries = [{ id: newProfileId(), type, fields: pick({}, PROFILE_FIELDS), profile: emptyGeometry(), cutlist: [], cutting: null, modules: undefined }];
        this.activeId = this.entries[0].id;
    }

    get active() { return this.entries.find(e => e.id === this.activeId) || this.entries[0]; }
    get count() { return this.entries.length; }
    indexOf(id) { return this.entries.findIndex(e => e.id === id); }

    /** Stand des Editors in das aktive Profil übernehmen (vor Speichern, Wechseln, Anzeigen) */
    sync() {
        const e = this.active;
        if (e) Object.assign(e, clone(this.capture()));
        return e;
    }

    /**
     * Projektdatei laden; lädt den aktiven Eintrag in den Editor.
     * usable(type): kann die Art bearbeitet werden (Modul aktiv)? Sonst wird
     * der erste bearbeitbare Eintrag aktiv. Rückgabe: { docType, project }
     */
    load(data, usable = () => true) {
        const { project, activeId, entries } = readProjectFile(clone(data));
        this.entries = entries;
        this.activeId = activeId;
        if (!usable(this.active.type)) {
            const ok = entries.find(e => usable(e.type));
            if (ok) this.activeId = ok.id;
        }
        this.apply(this.active);
        return { docType: this.active.type, project };
    }

    /** Inhalt für Datei und Autosave */
    toFile(projectFields) {
        this.sync();
        return {
            version: FILE_VERSION,
            timestamp: new Date().toISOString(),
            project: pick(projectFields, PROJECT_FIELDS),
            activeProfile: this.activeId,
            profiles: clone(this.entries.map(entryToFile))
        };
    }

    /** Anderes Profil bearbeiten */
    select(id) {
        if (id === this.activeId || this.indexOf(id) < 0) return false;
        this.sync();
        this.activeId = id;
        this.apply(this.active);
        return true;
    }

    /**
     * Neuer leerer Eintrag der Art type hinter dem aktiven. Ist der aktive von
     * derselben Art, wird sein Material als Vorschlag übernommen.
     */
    add(type = PROFILE_TYPE) {
        const from = this.sync();
        const gleich = from.type === type;
        const entry = {
            id: newProfileId(),
            type,
            fields: { ...pick({}, PROFILE_FIELDS), ...(gleich ? { materialType: from.fields.materialType, materialSpec: from.fields.materialSpec, materialThickness: from.fields.materialThickness, materialColor: from.fields.materialColor } : {}) },
            profile: emptyGeometry(), cutlist: [], cutting: null, modules: undefined
        };
        this.entries.splice(this.indexOf(this.activeId) + 1, 0, entry);
        this.activeId = entry.id;
        this.apply(entry);
        return entry;
    }

    /** Kopie eines Profils (neue id, Name mit „Kopie“) direkt dahinter; wird aktiv */
    duplicate(id) {
        this.sync();
        const src = this.entries[this.indexOf(id)];
        if (!src) return null;
        const entry = { ...clone({ ...src, history: undefined }), id: newProfileId() };
        delete entry.history;
        entry.fields.profileName = `${src.fields.profileName || (src.type === PROFILE_TYPE ? 'Profil' : 'Ausmass')} (Kopie)`;
        this.entries.splice(this.indexOf(id) + 1, 0, entry);
        this.activeId = entry.id;
        this.apply(entry);
        return entry;
    }

    /**
     * Eintrag entfernen (der letzte bleibt). Wird der aktive entfernt, wird der
     * nächste bearbeitbare aktiv (usable wie bei load). Rückgabe für „Rückgängig“: { entry, index }
     */
    remove(id, usable = () => true) {
        if (this.entries.length <= 1) return null;
        this.sync();
        const index = this.indexOf(id);
        if (index < 0) return null;
        if (id === this.activeId && !this.entries.some(e => e.id !== id && usable(e.type))) return null;
        const [entry] = this.entries.splice(index, 1);
        if (id === this.activeId) {
            const rest = [...this.entries.slice(index), ...this.entries.slice(0, index).reverse()];
            this.activeId = rest.find(e => usable(e.type)).id;
            this.apply(this.active);
        }
        return { entry, index };
    }

    /** Entfernten Eintrag wieder einsetzen und aktiv machen (nicht bearbeitbare nur einsetzen) */
    restore({ entry, index }, usable = () => true) {
        this.sync();
        this.entries.splice(Math.min(index, this.entries.length), 0, entry);
        if (!usable(entry.type)) return;
        this.activeId = entry.id;
        this.apply(entry);
    }

    /**
     * Einträge der Art type aufteilen (z.B. alte Blindpaneele-Datei mit mehreren
     * Paneelen → ein Ausmass pro Paneel). fn(moduleData) liefert [{ name, data }]
     * oder null; bei mehr als einem Teil ersetzt jeder Teil den Eintrag (der erste
     * behält die id). Rückgabe: wurde etwas aufgeteilt?
     */
    splitEntries(type, moduleId, fn) {
        this.sync();
        let changed = false, activeSplit = false;
        const out = [];
        this.entries.forEach(e => {
            let parts = null;
            if (e.type === type) {
                try { parts = fn(clone(e.modules ? e.modules[moduleId] : undefined) ?? null); } catch (err) { parts = null; }
            }
            if (!Array.isArray(parts) || parts.length < 2) { out.push(e); return; }
            changed = true;
            if (e.id === this.activeId) activeSplit = true;
            const base = clone({ ...e, history: undefined });
            delete base.history;
            parts.forEach((part, k) => out.push({
                ...clone(base),
                id: k === 0 ? e.id : newProfileId(),
                fields: { ...base.fields, profileName: String(part && part.name != null ? part.name : base.fields.profileName || '') },
                modules: { ...(base.modules || {}), [moduleId]: clone(part && part.data) }
            }));
        });
        if (changed) {
            this.entries = out;
            if (activeSplit) this.apply(this.active);
        }
        return changed;
    }

    /** Reihenfolge ändern: dir = -1 (nach oben) oder +1 (nach unten) */
    move(id, dir) {
        const i = this.indexOf(id), j = i + dir;
        if (i < 0 || j < 0 || j >= this.entries.length) return false;
        [this.entries[i], this.entries[j]] = [this.entries[j], this.entries[i]];
        return true;
    }
}
