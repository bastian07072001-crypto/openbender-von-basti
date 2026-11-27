/**
 * Anschluss an ERPNext (Frappe-App "openbender_erp").
 *
 * Aktiv nur, wenn die Seite von ERPNext ausgeliefert wird: die Frappe-App
 * setzt vor main.js das Objekt window.OPENBENDER_ERP. In der öffentlichen
 * App fehlt es – dann ist hier alles ohne Wirkung.
 *
 *   window.OPENBENDER_ERP = {
 *     csrf: '…',                  // CSRF-Token der ERPNext-Sitzung
 *     projekt: 'PROJ-0029',       // Projekt (Name des Dokuments) oder null
 *     projektTitel: 'Musterhaus', // project_name
 *     datei: 'Ortblech.json',     // zu öffnende Datei im Projekt (ERPNext-Ablage: OBD-…) oder null
 *     ablage: 'nextcloud',        // oder 'erpnext'
 *     unterordner: 'Zeichnungen',
 *     zurueck: '/app/project/PROJ-0029'
 *   }
 *
 * Ablage (config.ablage): "nextcloud" = echte .json-Dateien im Projektordner
 * der Nextcloud, Unterordner config.unterordner (z.B. "Zeichnungen"), über die
 * App bb_nextcloud; "erpnext" = DocType "OpenBender Datei". Der Datei-Browser
 * (FileBrowserController, ERP-Modus) zeigt beides gleich: Projektordner →
 * offene Projekte → Dateien.
 */
const API = '/api/method/openbender_erp.api.';

export const ErpStorage = {
    get config() {
        return (typeof window !== 'undefined' && window.OPENBENDER_ERP) || null;
    },

    isActive() {
        return !!this.config;
    },

    // method: Name in openbender_erp.api (z.B. 'dateien') oder voller Pfad mit Punkt
    // (z.B. 'openbender_erp.ruestauftrag.erstellen')
    async call(method, args = {}, post = false) {
        const cfg = this.config || {};
        const url = method.includes('.') ? `/api/method/${method}` : API + method;
        let res;
        if (post) {
            res = await fetch(url, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': cfg.csrf || '', Accept: 'application/json' },
                body: JSON.stringify(args)
            });
        } else {
            const q = new URLSearchParams(Object.entries(args).filter(([, v]) => v !== null && v !== undefined));
            res = await fetch(`${url}?${q}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        }
        let body = null;
        try { body = await res.json(); } catch (e) { /* keine JSON-Antwort */ }
        if (!res.ok) throw new Error(fehlertext(body) || `ERPNext antwortet mit Fehler ${res.status}`);
        return body ? body.message : null;
    },

    /** Oberverzeichnis: offene Projekte [{ name, project_name, ordner }] (ordner null = kein Nextcloud-Ordner) */
    projektordner() {
        return this.call('projektordner');
    },

    /**
     * Dateien eines Projekts: { dateien: [{ name, titel, projekt, modified, stand, inhalt? }], schreibbar }
     * mitInhalt: auch den Inhalt (für die Vorschau-Kacheln)
     */
    list(projekt, mitInhalt = false) {
        return this.call('dateien', { projekt, mit_inhalt: mitInhalt ? 1 : 0 });
    },

    /** Projekte für die Auswahl: [{ name, project_name, status }] */
    projekte() {
        return this.call('projekte');
    },

    /** Aktive Mitarbeiter: [{ name, employee_name, designation }] */
    mitarbeiter() {
        return this.call('mitarbeiter');
    },

    /** { name, titel, projekt, stand, inhalt (Objekt) } */
    load(name, projekt) {
        return this.call('datei_laden', { name, projekt: projekt || null });
    },

    /**
     * Neu (name leer) oder die geöffnete Datei überschreiben. stand = Stand beim
     * Öffnen: hat inzwischen jemand anders gespeichert, lehnt ERPNext ab.
     * ueberschreiben: vorhandene Datei gleichen Namens ersetzen (nach Rückfrage).
     * Antwort: { name, titel, projekt, stand }
     */
    save({ name, projekt, titel, inhalt, stand, ueberschreiben }) {
        return this.call('datei_speichern', {
            name: name || null, projekt: projekt || null, titel, inhalt: JSON.stringify(inhalt),
            stand: stand || null, ueberschreiben: ueberschreiben ? 1 : 0
        }, true);
    }
};

// Frappe liefert Fehler als _server_messages (JSON-Liste mit JSON-Strings) oder exception
function fehlertext(body) {
    if (!body) return '';
    try {
        if (body._server_messages) {
            const msgs = JSON.parse(body._server_messages).map(m => {
                try { return JSON.parse(m).message; } catch (e) { return m; }
            });
            return msgs.join(' ').replace(/<[^>]+>/g, '');
        }
    } catch (e) { /* weiter unten */ }
    if (body.exception) return String(body.exception).replace(/^[\w.]+:\s*/, '');
    return '';
}
