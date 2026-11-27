/**
 * Ausgabe von Dateien (PDF, DXF, Modul-Dateien).
 *
 * Öffentliche App: Download wie bisher.
 * ERPNext (ErpStorage aktiv): Ablage im Projekt der Datei – mit Nextcloud im
 * Projektordner, Unterordner "Zeichnungen" (wie die openBender-Dateien),
 * sonst als Anhang am Projekt. Gibt es den Namen schon, wird gefragt:
 * ersetzen, als neue Version (name_v02 …) oder abbrechen. Ohne gewähltes
 * Projekt wird heruntergeladen.
 *
 * ui (ModuleUI) setzt main.js für die Rückfrage; ohne ui: window.confirm.
 */
import { ErpStorage } from '../storage/ErpStorage.js';
import { Toast } from '../utils/Toast.js';

export const Ausgabe = {
    ui: null,

    /**
     * Datei ausgeben. inhalt: Blob oder Text. Promise: true = abgelegt bzw.
     * heruntergeladen, false = abgebrochen.
     */
    async speichern(name, inhalt, mime = 'application/octet-stream') {
        const blob = inhalt instanceof Blob ? inhalt : new Blob([inhalt], { type: mime });
        if (ErpStorage.isActive()) {
            const erledigt = await imProjektAblegen(name, blob, mime, this.ui);
            if (erledigt !== null) return erledigt;
        }
        herunterladen(name, blob);
        return true;
    }
};

/** Klassischer Download über einen Link */
export function herunterladen(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// null = nicht abgelegt (kein Projekt) → Download
async function imProjektAblegen(name, blob, mime, ui) {
    const cfg = ErpStorage.config;
    if (!cfg.projekt) {
        Toast.show('Kein Projekt gewählt – die Datei wird heruntergeladen.', 'warning', 5000);
        return null;
    }
    const inhalt = await alsBase64(blob);
    const ablegen = (modus) => ErpStorage.call('ausgabe_speichern', { projekt: cfg.projekt, name, inhalt, mime, modus }, true);
    try {
        let r = await ablegen('neu');
        if (r && r.vorhanden) {
            const wahl = await nachfragen(ui, r.name || name);
            if (!wahl) return false;
            r = await ablegen(wahl);
        }
        const wo = cfg.ablage === 'nextcloud' ? `${cfg.unterordner || 'Zeichnungen'} im Projektordner` : `Anhang am Projekt ${cfg.projekt}`;
        if (mime === 'application/pdf' && ui && ui.modal) {
            await pdfOeffnenFragen(ui, r.name, wo, blob);
        } else {
            Toast.show(`Gespeichert: ${r.name} (${wo})`, 'info', 5000);
        }
        return true;
    } catch (e) {
        Toast.show(`Ablage im Projekt fehlgeschlagen: ${e.message || e}. Die Datei wird heruntergeladen.`, 'warning', 8000);
        return null;
    }
}

// Nach dem Ablegen: PDF gleich ansehen? Geöffnet wird das eben erstellte PDF
// (im Browser, neuer Tab) – direkt im Klick, damit kein Popup-Blocker greift.
async function pdfOeffnenFragen(ui, name, wo, blob) {
    await ui.modal({
        title: 'PDF gespeichert',
        html: `<p class="info-panel-desc">„${escapeHtml(name)}“ liegt jetzt in ${escapeHtml(wo)}. Soll das PDF geöffnet werden?</p>`,
        buttons: [
            { label: 'Nein', value: false },
            { label: 'PDF öffnen', value: true, primary: true }
        ],
        onOpen: (body) => {
            const overlay = body.closest('.module-dialog-overlay');
            const knopf = overlay && [...overlay.querySelectorAll('[data-btn]')].find(b => b.textContent === 'PDF öffnen');
            if (!knopf) return;
            knopf.addEventListener('click', () => {
                const url = URL.createObjectURL(blob);
                const fenster = window.open(url, '_blank');
                if (!fenster) herunterladen(name, blob);
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            }, { capture: true, once: true });
        }
    });
}

async function nachfragen(ui, name) {
    const text = `„${name}“ gibt es im Projekt schon.`;
    if (ui && ui.modal) {
        return ui.modal({
            title: 'Datei vorhanden',
            html: `<p class="info-panel-desc">${escapeHtml(text)} Ersetzen oder als neue Version (mit _v02 …) ablegen?</p>`,
            buttons: [
                { label: 'Abbrechen', value: null },
                { label: 'Neue Version', value: 'version' },
                { label: 'Ersetzen', value: 'ersetzen', primary: true }
            ]
        });
    }
    return window.confirm(`${text} Ersetzen?`) ? 'ersetzen' : null;
}

function alsBase64(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
