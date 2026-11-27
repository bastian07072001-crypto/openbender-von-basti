/**
 * Materialliste von openBender: mitgelieferte Materialien (MaterialData.js,
 * CoilCatalog.js, SheetLook.js) und eigene Materialien des Betriebs, dazu
 * die Darstellung in 3D (Farbe, Metallglanz, Rauheit) je Material.
 *
 * Eigene Materialien und die Darstellung liegen in einer Datei
 *   Speicherordner/Einstellungen/materialien.json
 * bzw. im ERP-Betrieb in ERPNext (OpenBender Einstellungen, für den ganzen
 * Betrieb). Kein Ablegen im Browser: ohne Ablage gelten nur die
 * mitgelieferten Materialien.
 *
 * apply() trägt die eigenen Materialien in dieselben Tabellen ein, die
 * Stückliste, Zuschnitt und 3D schon benutzen (MATERIAL_SPECS,
 * MATERIAL_COILS, MATERIAL_SHEETS, MATERIAL_PRESETS, MATERIAL_MAP). So
 * brauchen diese Stellen nichts von eigenen Materialien zu wissen.
 *
 * Dateiformat:
 *   { format: 'openbender-materialien', version: 1,
 *     materialien: [{ name, specs: ['Blank', …], density,
 *                     thicknesses: [0.6, …], coilWidths: [200, …], coilKg: [100, …],
 *                     sheets: [[1000, 2000], …], look: { color, metalness, roughness } }],
 *     darstellung: { '<Materialname>': { color, metalness, roughness } } }
 *
 *   color: '#rrggbb'. Rollen = jede Breite × jede Dicke × jedes Rollengewicht,
 *   Tafeln = jedes Format × jede Dicke, für alle Ausführungen gleich.
 *   look.texture ist für später vorgesehen (eigene Texturen) und wird hier
 *   unverändert durchgereicht.
 */
import { MATERIAL_SPECS } from './MaterialData.js';
import { MATERIAL_COILS, MATERIAL_SHEETS } from './CoilCatalog.js';
import { MATERIAL_PRESETS, MATERIAL_MAP } from './SheetLook.js';
import { FolderStorage } from '../storage/FolderStorage.js';
import { ErpStorage } from '../storage/ErpStorage.js';
import { BUILTIN_SPEC_TEXTURES, TEXTURE_SIZE, Textures } from './Textures.js';

export const SETTINGS_DIR = 'Einstellungen';
const FILE = 'materialien.json';
const FORMAT = 'openbender-materialien';
export const CHANGED_EVENT = 'openbender:materials-changed';

const clone = (v) => JSON.parse(JSON.stringify(v));

// Stand der mitgelieferten Tabellen beim Laden (zum Zurücksetzen vor apply)
const BUILTIN = {
    specs: clone(MATERIAL_SPECS),
    coils: clone(MATERIAL_COILS),
    sheets: clone(MATERIAL_SHEETS),
    presets: clone(MATERIAL_PRESETS),
    map: clone(MATERIAL_MAP)
};
export const BUILTIN_NAMES = Object.keys(BUILTIN.specs);

const DEFAULT_LOOK = { color: '#8a939c', metalness: 0.4, roughness: 0.45 };

const hexToInt = (hex) => parseInt(String(hex).replace('#', ''), 16) || 0;
export const intToHex = (n) => `#${(Number(n) >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
const clamp01 = (v, d) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : d);
const nums = (list) => (Array.isArray(list) ? list.map(Number).filter(v => Number.isFinite(v) && v > 0) : []);
const uniqSorted = (list) => [...new Set(list)].sort((a, b) => a - b);

/** Aussehen prüfen: { color: '#rrggbb', metalness, roughness, texture? } */
function cleanLook(look, fallback = DEFAULT_LOOK) {
    const l = look && typeof look === 'object' ? look : {};
    const out = {
        color: /^#[0-9a-f]{6}$/i.test(l.color || '') ? l.color.toLowerCase() : fallback.color,
        metalness: clamp01(l.metalness, fallback.metalness),
        roughness: clamp01(l.roughness, fallback.roughness)
    };
    const t = cleanTexture(l.texture);
    if (t) out.texture = t;
    return out;
}

/** Textur eines Aussehens: { id, size (mm), rotate, alpha } oder null */
function cleanTexture(t) {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id || t.id.length > 200) return null;
    const size = Number(t.size);
    return {
        id: t.id,
        size: Number.isFinite(size) ? Math.min(10000, Math.max(10, size)) : 1000,
        rotate: !!t.rotate,
        alpha: !!t.alpha
    };
}

/** Eigenes Material prüfen und vereinheitlichen; wirft bei ungültigen Angaben */
export function cleanMaterial(m) {
    const name = String((m && m.name) || '').trim();
    if (!name) throw new Error('Das Material braucht einen Namen.');
    if (name.length > 40) throw new Error('Der Name ist zu lang (höchstens 40 Zeichen).');
    if (/[|\u0000-\u001f\u007f]/.test(name)) throw new Error('Der Name darf kein „|“ und keine Zeilenumbrüche enthalten.');
    const specs = [...new Set((Array.isArray(m.specs) ? m.specs : []).map(s => String(s).replace(/[\u0000-\u001f\u007f|]/g, ' ').trim().slice(0, 40)).filter(Boolean))];
    const density = Number(m.density);
    if (!(density > 0 && density < 30)) throw new Error('Bitte eine Dichte zwischen 0 und 30 kg/dm³ angeben.');
    const thicknesses = uniqSorted(nums(m.thicknesses).filter(t => t < 20));
    if (thicknesses.length === 0) throw new Error('Bitte mindestens eine Dicke angeben.');
    const coilWidths = uniqSorted(nums(m.coilWidths).filter(w => w <= 5000));
    const coilKg = uniqSorted(nums(m.coilKg).filter(k => k <= 10000));
    const sheets = (Array.isArray(m.sheets) ? m.sheets : [])
        .map(s => (Array.isArray(s) ? [Number(s[0]), Number(s[1])] : null))
        .filter(s => s && s[0] > 0 && s[1] > 0 && s[0] <= 5000 && s[1] <= 20000)
        .map(([w, l]) => [Math.min(w, l), Math.max(w, l)]);
    const sheetKeys = new Set();
    const uniqSheets = sheets.filter(s => { const k = s.join('x'); if (sheetKeys.has(k)) return false; sheetKeys.add(k); return true; })
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (coilWidths.length === 0 && uniqSheets.length === 0) throw new Error('Bitte Rollenbreiten oder Tafelformate angeben.');
    return {
        name,
        specs: specs.length ? specs : ['Standard'],
        density,
        thicknesses,
        coilWidths,
        coilKg: coilWidths.length ? (coilKg.length ? coilKg : [100]) : [],
        sheets: uniqSheets,
        look: cleanLook(m.look)
    };
}

/** Datei vereinheitlichen; fehlerhafte Einträge fallen weg (mit Hinweis in der Konsole) */
export function cleanData(data) {
    const out = { format: FORMAT, version: 1, materialien: [], darstellung: {} };
    if (!data || typeof data !== 'object') return out;
    const names = new Set(BUILTIN_NAMES.map(n => n.toLowerCase()));
    (Array.isArray(data.materialien) ? data.materialien : []).forEach(m => {
        try {
            const c = cleanMaterial(m);
            if (names.has(c.name.toLowerCase())) throw new Error(`„${c.name}“ gibt es schon`);
            names.add(c.name.toLowerCase());
            out.materialien.push(c);
        } catch (e) {
            console.warn('Eigenes Material übersprungen:', e.message);
        }
    });
    // Darstellung: „Material“ (nur mitgelieferte; eigene haben look) oder
    // „Material|Ausführung“ (eigene Darstellung einer Ausführung)
    const d = data.darstellung && typeof data.darstellung === 'object' ? data.darstellung : {};
    const own = new Map(out.materialien.map(m => [m.name, m]));
    Object.entries(d).forEach(([key, look]) => {
        const [name, spec, rest] = key.split('|');
        if (rest !== undefined) return;
        const base = own.has(name) ? own.get(name).look : BUILTIN_NAMES.includes(name) ? builtinLook(name) : null;
        if (!base) return;
        if (spec === undefined) {
            if (!own.has(name)) out.darstellung[name] = cleanLook(look, base);
        } else if (spec) {
            out.darstellung[key] = cleanLook(look, base);
        }
    });
    return out;
}

/** Mitgeliefertes Aussehen eines Materials ({ color: '#…', metalness, roughness }) */
export function builtinLook(name) {
    const key = BUILTIN.map[name] || 'steel';
    const p = BUILTIN.presets[key] || BUILTIN.presets.steel;
    return { color: intToHex(p.color), metalness: p.metalness, roughness: p.roughness };
}

// Ein Material bekommt einen eigenen Eintrag in MATERIAL_PRESETS, sobald es
// eigenes Aussehen hat (Aluminium und Prefalz teilen sonst „alu“)
const presetKey = (name) => `mat:${name}`;

function resetTables() {
    [[MATERIAL_SPECS, BUILTIN.specs], [MATERIAL_COILS, BUILTIN.coils], [MATERIAL_SHEETS, BUILTIN.sheets],
        [MATERIAL_PRESETS, BUILTIN.presets], [MATERIAL_MAP, BUILTIN.map]].forEach(([target, source]) => {
        Object.keys(target).forEach(k => delete target[k]);
        Object.assign(target, clone(source));
    });
}

function setLook(name, look) {
    MATERIAL_PRESETS[presetKey(name)] = {
        color: hexToInt(look.color),
        metalness: look.metalness,
        roughness: look.roughness,
        ...(look.texture ? { texture: look.texture } : {})
    };
    MATERIAL_MAP[name] = presetKey(name); // name = „Material“ oder „Material|Ausführung“
}

let current = cleanData(null);
let state = { source: 'none', loaded: false, readOnly: false, error: '' };
let loadSeq = 0;              // nur der zuletzt gestartete Ladevorgang zählt
let saveChain = Promise.resolve(); // Speichervorgänge der Reihe nach

function apply(data) {
    current = cleanData(data);
    resetTables();
    current.materialien.forEach(m => {
        MATERIAL_SPECS[m.name] = [...m.specs];
        const coils = m.coilWidths.flatMap(w => m.thicknesses.flatMap(t => m.coilKg.map(kg => [w, t, kg])));
        const sheets = m.sheets.flatMap(([w, l]) => m.thicknesses.map(t => [w, l, t]));
        MATERIAL_COILS[m.name] = { density: m.density, specs: Object.fromEntries(m.specs.map(s => [s, coils.map(c => [...c])])) };
        if (sheets.length) MATERIAL_SHEETS[m.name] = Object.fromEntries(m.specs.map(s => [s, sheets.map(c => [...c])]));
        setLook(m.name, m.look);
    });
    Object.entries(current.darstellung).forEach(([name, look]) => { if (!name.includes('|')) setLook(name, look); });
    // mitgelieferte Darstellung der Ausführungen (Textur), dann eigene der Ausführungen
    Object.keys(BUILTIN_SPEC_TEXTURES).forEach(key => {
        const [name, spec] = key.split('|');
        if (!current.darstellung[key]) setLook(key, builtinSpecLook(name, spec));
    });
    Object.entries(current.darstellung).forEach(([name, look]) => { if (name.includes('|')) setLook(name, look); });
    document.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

/** Grund-Aussehen des Materials (eigene Darstellung „Alle Ausführungen“ oder mitgeliefert) */
function baseLook(name) {
    const m = current.materialien.find(x => x.name === name);
    if (m) return m.look;
    return current.darstellung[name] || builtinLook(name);
}

/**
 * Mitgelieferte Darstellung einer Ausführung: Glanz und Rauheit des Materials,
 * dazu die Textur (Originalfarben, also Farbe weiss). null ohne Vorgabe.
 */
function builtinSpecLook(name, spec) {
    const id = BUILTIN_SPEC_TEXTURES[`${name}|${spec}`];
    if (!id) return null;
    const b = Textures.builtin(id);
    return { ...baseLook(name), color: '#ffffff', texture: { id, size: TEXTURE_SIZE, rotate: false, alpha: !!(b && b.alpha) } };
}

// --- Ablage ------------------------------------------------------------------

async function settingsDir(interactive, create) {
    if (!FolderStorage.isSupported()) return { error: 'Eigene Materialien brauchen einen Speicherordner (Chrome oder Edge am PC) oder den ERPNext-Betrieb.' };
    const root = await FolderStorage.getRoot();
    if (!root) return { error: 'Bitte zuerst unter „Allgemein“ einen Speicherordner wählen.' };
    if (!(await FolderStorage.ensurePermission(root, interactive))) return { error: 'Kein Zugriff auf den Speicherordner.', waiting: true };
    try {
        return { dir: await root.getDirectoryHandle(SETTINGS_DIR, { create }) };
    } catch (e) {
        return { dir: null };
    }
}

const Ordner = {
    async load(interactive) {
        const { dir, error, waiting } = await settingsDir(interactive, false);
        if (error) return { data: null, error, waiting };
        if (!dir || !(await FolderStorage.exists(dir, FILE))) return { data: null };
        return { data: JSON.parse(await FolderStorage.readText(dir, FILE)) };
    },
    async save(data) {
        const { dir, error } = await settingsDir(true, true);
        if (!dir) throw new Error(error || 'Der Ordner „Einstellungen“ konnte nicht angelegt werden.');
        await FolderStorage.writeFile(dir, FILE, JSON.stringify(data, null, 2));
    }
};

const Erp = {
    async load() {
        const r = await ErpStorage.call('materialien');
        return { data: (r && r.daten) || null, readOnly: !(r && r.darf_aendern) };
    },
    async save(data) {
        await ErpStorage.call('materialien_speichern', { daten: JSON.stringify(data) }, true);
    }
};

export const Materials = {
    /** Laden (beim Start nicht interaktiv; aus einem Klick interactive = true) */
    async load(interactive = false) {
        const erp = ErpStorage.isActive();
        const seq = ++loadSeq;
        try {
            const r = erp ? await Erp.load() : await Ordner.load(interactive);
            if (seq !== loadSeq) return { ...state };
            state = {
                source: erp ? 'erp' : (r.error ? (r.waiting ? 'waiting' : 'none') : 'folder'),
                loaded: !r.error,
                readOnly: !!r.readOnly,
                error: r.error || ''
            };
            apply(r.data);
        } catch (e) {
            if (seq !== loadSeq) return { ...state };
            console.warn('Materialien laden:', e);
            state = { source: erp ? 'erp' : 'folder', loaded: false, readOnly: true, error: `Eigene Materialien konnten nicht geladen werden: ${e.message || e}` };
            apply(null);
        }
        return state;
    },

    state() {
        return { ...state };
    },

    /** Können Änderungen gespeichert werden? */
    canSave() {
        return state.loaded && !state.readOnly;
    },

    /** Daten (Kopie) zum Bearbeiten */
    data() {
        return clone(current);
    },

    /** Neue Daten übernehmen und ablegen; wirft mit verständlicher Meldung */
    async save(data) {
        // Nie speichern, solange die Liste nicht geladen ist (Ordner wartet auf
        // Freigabe, Datei fehlerhaft, ERPNext nicht erreichbar): das würde die
        // eigenen Materialien mit einer leeren Liste überschreiben
        if (!this.canSave()) throw new Error(state.readOnly ? 'Keine Berechtigung, Materialien zu ändern.' : 'Die eigenen Materialien sind nicht geladen – Speichern nicht möglich.');
        const clean = cleanData(data);
        const run = saveChain.then(async () => {
            if (ErpStorage.isActive()) await Erp.save(clean);
            else await Ordner.save(clean);
            loadSeq++; // ein noch laufender Ladevorgang darf das nicht mehr überschreiben
            apply(clean);
        });
        saveChain = run.catch(() => {});
        return run;
    },

    /** Nur anzeigen, nicht speichern (Vorschau der Schieberegler) */
    preview(data) {
        apply(data);
    },

    isBuiltin(name) {
        return BUILTIN_NAMES.includes(name);
    },

    /** Alle Materialien für Auswahllisten: [{ name, builtin }] */
    list() {
        return [
            ...BUILTIN_NAMES.map(name => ({ name, builtin: true })),
            ...current.materialien.map(m => ({ name: m.name, builtin: false }))
        ];
    },

    custom(name) {
        return current.materialien.find(m => m.name === name) || null;
    },

    /** Aktuelles Aussehen eines Materials ({ color: '#…', metalness, roughness }) */
    /** Aktuelles Aussehen; mit spec das der Ausführung (eigenes oder das des Materials) */
    look(name, spec) {
        const copy = (l) => JSON.parse(JSON.stringify(l));
        if (spec && current.darstellung[`${name}|${spec}`]) return copy(current.darstellung[`${name}|${spec}`]);
        const def = spec ? builtinSpecLook(name, spec) : null;
        if (def) return copy(def);
        const m = this.custom(name);
        if (m) return copy(m.look);
        return current.darstellung[name] ? copy(current.darstellung[name]) : builtinLook(name);
    },

    /** Hat die Ausführung eine eigene Darstellung? */
    hasSpecLook(name, spec) {
        return !!(spec && current.darstellung[`${name}|${spec}`]);
    },

    /** Hat die Ausführung eine mitgelieferte Darstellung (Textur)? */
    hasBuiltinSpecLook(name, spec) {
        return !!(spec && BUILTIN_SPEC_TEXTURES[`${name}|${spec}`]);
    },

    /** Wo die Materialien liegen – für Hinweistexte */
    ort() {
        if (ErpStorage.isActive()) return 'Eigene Materialien und die Darstellung liegen in ERPNext (OpenBender Einstellungen) und gelten für den ganzen Betrieb.';
        return 'Eigene Materialien und die Darstellung liegen im Speicherordner (Unterordner „Einstellungen“, Datei materialien.json) und gelten für alle Arbeitsplätze mit demselben Ordner.';
    }
};
