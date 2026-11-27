/**
 * Texturen für die 3D-Darstellung der Materialien.
 *
 * - Mitgeliefert: Ordner textures/ der App (BUILTIN_TEXTURES), id „builtin:<name>“
 * - Eigene: Speicherordner/Einstellungen/Texturen/<datei>.webp, id „eigen:<datei>“,
 *   im ERP-Betrieb als Datei an „OpenBender Einstellungen“ in ERPNext, id „eigen:<File-Name>“
 *
 * Eigene Bilder werden beim Hinzufügen auf höchstens 1024 px verkleinert und
 * als WebP abgelegt; ein Alphakanal (z.B. Löcher im Lochblech) bleibt erhalten.
 *
 * Die Textur eines Materials steht in seinem Aussehen (Materials.js):
 *   look.texture = { id, size, rotate, alpha }
 *   size:   Breite des Bildes auf dem Blech in mm (Höhe im Seitenverhältnis)
 *   rotate: um 90° gedreht (Bild-Hochachse quer statt längs zum Profil)
 *   alpha:  Alphakanal als Löcher darstellen
 */
import { FolderStorage } from '../storage/FolderStorage.js';
import { ErpStorage } from '../storage/ErpStorage.js';

const DIR = 'Einstellungen';
const SUB = 'Texturen';
const MAX_PX = 1024;
const MAX_BYTES = 15 * 1024 * 1024;

// Bildbreite in mm als Vorgabe beim Wählen einer Textur
export const TEXTURE_SIZE = 300;

// color: Durchschnittsfarbe des Bildes (für Ansichten ohne Textur, z.B. Module)
export const BUILTIN_TEXTURES = [
    { id: 'builtin:kupfer-gewalzt', name: 'Kupfer gewalzt', file: 'textures/kupfer-gewalzt.webp', color: '#ae6f55' },
    { id: 'builtin:kupfer-patina', name: 'Kupfer Patina', file: 'textures/kupfer-patina.webp', color: '#89b6a2' },
    { id: 'builtin:hellgrau-gewalzt', name: 'Hellgrau gewalzt', file: 'textures/hellgrau-gewalzt.webp', color: '#b4b4b4' },
    { id: 'builtin:grau-gewalzt', name: 'Grau gewalzt', file: 'textures/grau-gewalzt.webp', color: '#7f7f7a' },
    { id: 'builtin:anthrazit-gewalzt', name: 'Anthrazit gewalzt', file: 'textures/anthrazit-gewalzt.webp', color: '#2d2c28' },
    { id: 'builtin:grau-kratzer', name: 'Grau mit Kratzern', file: 'textures/grau-kratzer.webp', color: '#a19e92' },
    { id: 'builtin:verzinkt-zinkblume', name: 'Verzinkt (Zinkblume)', file: 'textures/verzinkt-zinkblume.webp', color: '#c4c4c4' },
    { id: 'builtin:einhaengerblech-rot', name: 'Einhängerblech rot', file: 'textures/einhaengerblech-rot.webp', color: '#ac4333' },
    // Quadratlöcher im Alphakanal (16 Löcher auf der Bildbreite)
    { id: 'builtin:lochblech-quadrat', name: 'Lochblech Quadratloch', file: 'textures/lochblech-quadrat.webp', color: '#a6aba3', alpha: true }
];

/**
 * Mitgelieferte Darstellung der Ausführungen: Textur je „Material|Ausführung“.
 * Gilt, solange in den Einstellungen keine eigene Darstellung der Ausführung
 * gespeichert ist (Materials.js).
 */
export const BUILTIN_SPEC_TEXTURES = {
    'Kupfer|Blank': 'builtin:kupfer-gewalzt',
    'Kupfer|Verzinnt': 'builtin:hellgrau-gewalzt',
    'Kupfer|Patiniert': 'builtin:kupfer-patina',
    'CrNi-Stahl|Matt': 'builtin:hellgrau-gewalzt',
    'CrNi-Stahl|Matt +': 'builtin:hellgrau-gewalzt',
    'CrNi-Stahl|Verzinnt': 'builtin:grau-gewalzt',
    'Aluminium|Blank': 'builtin:hellgrau-gewalzt',
    'Aluminium|Eloxiert': 'builtin:hellgrau-gewalzt',
    'Aluminium|Lochblech': 'builtin:lochblech-quadrat',
    'Prefalz|Glatt': 'builtin:anthrazit-gewalzt',
    'Prefalz|Structa': 'builtin:anthrazit-gewalzt',
    'Stahlblech|Blank': 'builtin:grau-kratzer',
    'Stahlblech|Verzinkt': 'builtin:verzinkt-zinkblume',
    'Stahlblech|Farbbeschichtet': 'builtin:einhaengerblech-rot',
    'Stahlblech|Pluvicolor': 'builtin:anthrazit-gewalzt',
    'Titanzink|Blank': 'builtin:grau-kratzer',
    'Titanzink|Vorbewittert': 'builtin:grau-gewalzt'
};

const urlCache = new Map();   // id → Promise<string|null> (Blob-URLs der eigenen Texturen)
let ownCache = null;          // Promise<[{ id, name }]>

async function textureDir(interactive, create) {
    if (!FolderStorage.isSupported()) throw new Error('Eigene Texturen brauchen einen Speicherordner (Chrome oder Edge am PC) oder den ERPNext-Betrieb.');
    const root = await FolderStorage.getRoot();
    if (!root) throw new Error('Bitte zuerst unter „Allgemein“ einen Speicherordner wählen.');
    if (!(await FolderStorage.ensurePermission(root, interactive))) throw new Error('Kein Zugriff auf den Speicherordner.');
    try {
        const dir = await root.getDirectoryHandle(DIR, { create });
        return await dir.getDirectoryHandle(SUB, { create });
    } catch (e) {
        if (create) throw e;
        return null;
    }
}

const isImageName = (n) => /\.(webp|png|jpe?g)$/i.test(n);
const baseName = (n) => n.replace(/\.[^.]+$/, '');
const safeName = (n) => String(n).trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 60) || 'Textur';

/** Bild verkleinern (höchstens MAX_PX) und als WebP (mit Alpha) bzw. PNG kodieren */
async function normalize(file) {
    if (file.size > MAX_BYTES) throw new Error('Das Bild ist zu gross (höchstens 15 MB).');
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch (e) {
        throw new Error('Das Bild lässt sich nicht lesen (PNG, JPG oder WebP).');
    }
    const s = Math.min(1, MAX_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * s)), h = Math.max(1, Math.round(bitmap.height * s));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    // durchsichtige Stellen? (dann als Löcher vorschlagen, z.B. Lochblech)
    const px = ctx.getImageData(0, 0, w, h).data;
    let alpha = false;
    for (let i = 3; i < px.length; i += 4) { if (px[i] < 128) { alpha = true; break; } }
    const toBlob = (type, q) => new Promise(res => canvas.toBlob(res, type, q));
    let blob = await toBlob('image/webp', 0.9);
    let ext = 'webp';
    if (!blob || blob.type !== 'image/webp') { blob = await toBlob('image/png'); ext = 'png'; }
    if (!blob) throw new Error('Das Bild konnte nicht umgewandelt werden.');
    return { blob, ext, alpha };
}

const blobToBase64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
});

const Ordner = {
    async list() {
        const dir = await textureDir(false, false).catch(() => null);
        if (!dir) return [];
        const out = [];
        for await (const [name, handle] of dir.entries()) {
            if (handle.kind === 'file' && isImageName(name)) out.push({ id: `eigen:${name}`, name: baseName(name) });
        }
        return out.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    },
    async url(file) {
        const dir = await textureDir(false, false);
        if (!dir) return null;
        const handle = await dir.getFileHandle(file);
        return URL.createObjectURL(await handle.getFile());
    },
    async add(name, blob, ext) {
        const dir = await textureDir(true, true);
        let file = `${name}.${ext}`;
        for (let i = 2; await FolderStorage.exists(dir, file); i++) file = `${name} ${i}.${ext}`;
        const handle = await dir.getFileHandle(file, { create: true });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        return `eigen:${file}`;
    },
    async remove(file) {
        const dir = await textureDir(true, false);
        if (dir) await dir.removeEntry(file);
    }
};

const Erp = {
    async list() {
        const r = (await ErpStorage.call('texturen')) || [];
        Erp.urls = new Map(r.map(t => [`eigen:${t.name}`, t.url]));
        return r.map(t => ({ id: `eigen:${t.name}`, name: baseName(t.file_name || t.name) }));
    },
    async url(name) {
        if (!Erp.urls) await Erp.list();
        return Erp.urls.get(`eigen:${name}`) || null;
    },
    async add(name, blob, ext) {
        const r = await ErpStorage.call('textur_speichern', { name: `${name}.${ext}`, inhalt: await blobToBase64(blob) }, true);
        Erp.urls = null;
        return `eigen:${r.name}`;
    },
    async remove(name) {
        await ErpStorage.call('textur_loeschen', { name }, true);
        Erp.urls = null;
    },
    urls: null
};

const ablage = () => (ErpStorage.isActive() ? Erp : Ordner);

export const Textures = {
    builtin(id) {
        return BUILTIN_TEXTURES.find(t => t.id === id) || null;
    },

    /** Alle Texturen: [{ id, name, builtin }] (eigene ohne Ablage: keine) */
    async list() {
        if (!ownCache) ownCache = ablage().list().catch(e => { console.warn('Texturen:', e); return []; });
        const own = await ownCache;
        return [
            ...BUILTIN_TEXTURES.map(t => ({ id: t.id, name: t.name, builtin: true })),
            ...own.map(t => ({ ...t, builtin: false }))
        ];
    },

    /** Adresse des Bildes (Pfad, Datei-URL oder Blob-URL) oder null */
    url(id) {
        if (!id) return Promise.resolve(null);
        const b = this.builtin(id);
        if (b) return Promise.resolve(b.file);
        if (!urlCache.has(id)) {
            const name = String(id).replace(/^eigen:/, '');
            urlCache.set(id, ablage().url(name).catch(e => { console.warn('Textur laden:', id, e); urlCache.delete(id); return null; }));
        }
        return urlCache.get(id);
    },

    /** Eigene Textur aus einer Bilddatei hinzufügen; Ergebnis: { id, alpha } (alpha: hat durchsichtige Stellen) */
    async add(file) {
        const { blob, ext, alpha } = await normalize(file);
        const id = await ablage().add(safeName(baseName(file.name)), blob, ext);
        ownCache = null;
        return { id, alpha };
    },

    async remove(id) {
        const name = String(id).replace(/^eigen:/, '');
        await ablage().remove(name);
        const cached = urlCache.get(id);
        urlCache.delete(id);
        if (cached) cached.then(u => { if (u && u.startsWith('blob:')) URL.revokeObjectURL(u); });
        ownCache = null;
    },

    /** Ablage gewechselt (anderer Speicherordner): Listen neu lesen */
    reset() {
        ownCache = null;
        urlCache.clear();
        Erp.urls = null;
    }
};
