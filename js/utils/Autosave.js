/**
 * Automatisches Zwischenspeichern im Browser (localStorage), damit nach einem
 * Neuladen oder Absturz der letzte Stand wieder da ist. Gilt nur für diesen
 * Browser auf diesem Gerät – ersetzt nicht das Speichern als JSON-Datei.
 *
 * Gespeichert wird dasselbe Format wie die JSON-Datei (ProjectStore.toFile).
 * localStorage kann fehlen oder gesperrt sein (privates Fenster, volle
 * Quote) – dann wird still ohne Autosave weitergearbeitet.
 */
const STORAGE_KEY = 'openbender.autosave';

export class Autosave {
    constructor(getData, delayMs = 500) {
        this.getData = getData;
        this.delayMs = delayMs;
        this.timer = null;
    }

    // Mehrere Änderungen kurz hintereinander (z.B. Punkt ziehen) werden zu
    // einem Schreibvorgang zusammengefasst.
    schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.saveNow(), this.delayMs);
    }

    saveNow() {
        clearTimeout(this.timer);
        this.timer = null;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.getData()));
        } catch (e) {
            // Kein Speicher verfügbar – Autosave ist nur eine Komfortfunktion
        }
    }

    static load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }
}
