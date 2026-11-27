/**
 * Speicherordner auf dem Gerät (File System Access API, Chrome/Edge am PC).
 *
 * Die Profile liegen als normale JSON-Dateien in einem vom Benutzer
 * gewählten Ordner (Festplatte oder Netzlaufwerk) – Browser-Cache leeren
 * löscht nichts. Im Browser (IndexedDB) wird nur der Verweis auf den
 * gewählten Ordner gemerkt; geht er verloren, wählt man den Ordner neu.
 * Ein eingetippter Pfad ist aus Sicherheitsgründen in Browsern nicht möglich.
 */
const DB_NAME = 'openbender';
const STORE = 'handles';
const ROOT_KEY = 'storageRoot';

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function dbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export class FolderStorage {
    static isSupported() {
        return typeof window.showDirectoryPicker === 'function';
    }

    // Gemerkter Speicherordner (oder null)
    static async getRoot() {
        try {
            return await dbGet(ROOT_KEY);
        } catch (e) {
            return null;
        }
    }

    // Ordner auswählen lassen (braucht einen Klick des Benutzers) und merken
    static async chooseRoot() {
        const handle = await window.showDirectoryPicker({ id: 'openbender', mode: 'readwrite' });
        await dbSet(ROOT_KEY, handle);
        return handle;
    }

    // Für Tests/Spezialfälle: einen bereits vorhandenen Ordner merken
    static async setRoot(handle) {
        await dbSet(ROOT_KEY, handle);
    }

    /**
     * Lese-/Schreibrecht sicherstellen. Nach einem Neustart fragt der Browser
     * erneut nach (nur mit interactive = true, also aus einem Klick heraus).
     */
    static async ensurePermission(handle, interactive) {
        if (!handle) return false;
        if (typeof handle.queryPermission !== 'function') return true;
        const opts = { mode: 'readwrite' };
        if (await handle.queryPermission(opts) === 'granted') return true;
        if (!interactive) return false;
        const granted = (await handle.requestPermission(opts)) === 'granted';
        // z.B. eigene Materialien nachladen, die beim Start auf die Freigabe warteten
        if (granted) document.dispatchEvent(new CustomEvent('openbender:folder-granted'));
        return granted;
    }

    // Unterordner über einen Pfad (Liste von Namen) erreichen
    static async resolve(root, path) {
        let dir = root;
        for (const name of path) dir = await dir.getDirectoryHandle(name);
        return dir;
    }

    /**
     * Inhalt eines Ordners: Unterordner und JSON-Dateien. Dateien werden
     * gelesen, um Vorschau und Projektangaben zu zeigen; nicht lesbare oder
     * fremde JSON-Dateien erscheinen ohne Vorschau.
     */
    static async list(dir) {
        const folders = [];
        const files = [];
        for await (const [name, handle] of dir.entries()) {
            if (handle.kind === 'directory') {
                if (!name.startsWith('.')) folders.push({ name, handle });
            } else if (name.toLowerCase().endsWith('.json')) {
                const file = await handle.getFile();
                let data = null;
                try {
                    data = JSON.parse(await file.text());
                } catch (e) {
                    data = null;
                }
                files.push({ name, handle, modified: file.lastModified, size: file.size, data });
            }
        }
        folders.sort((a, b) => a.name.localeCompare(b.name, 'de'));
        files.sort((a, b) => b.modified - a.modified);
        return { folders, files };
    }

    static async createFolder(dir, name) {
        return dir.getDirectoryHandle(name, { create: true });
    }

    static async exists(dir, name) {
        try {
            await dir.getFileHandle(name);
            return true;
        } catch (e) {
            return false;
        }
    }

    static async writeFile(dir, name, content) {
        const handle = await dir.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return handle;
    }

    static async readJson(fileHandle) {
        const file = await fileHandle.getFile();
        return JSON.parse(await file.text());
    }

    static async readText(dir, name) {
        const handle = await dir.getFileHandle(name);
        return (await handle.getFile()).text();
    }

    static async removeFile(dir, name) {
        await dir.removeEntry(name);
    }

    /**
     * Ordner der installierten Module im Speicherordner (MODULE_DIR), bei
     * create = true wird er angelegt. null, wenn es ihn (noch) nicht gibt.
     */
    static async modulesDir(root, create = false) {
        try {
            return await root.getDirectoryHandle(MODULE_DIR, { create });
        } catch (e) {
            return null;
        }
    }
}

// Unterordner im Speicherordner für installierte Module (.js) und deren
// Lizenzen (lizenzen.json). Der Datei-Browser blendet ihn aus.
export const MODULE_DIR = 'Module';
