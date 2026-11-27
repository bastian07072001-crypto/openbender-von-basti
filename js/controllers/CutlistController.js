import { globalEventBus } from '../utils/EventBus.js';
import { Toast } from '../utils/Toast.js';

// Stücklisten-Längen sind in m; Werte über 50 gelten als mm (wie im Zuschnitt und in der 3D-Vorschau)
export const laengeM = (wert) => { const v = parseFloat(wert) || 0; return v > 50 ? v / 1000 : v; };
const laengeHinweis = (wert) => ((parseFloat(wert) || 0) > 50 ? `= ${laengeM(wert).toFixed(3)} m` : '');
// Zahl aus einem Textfeld: Punkt oder Komma als Dezimalzeichen (Chrome zeigt type="number"
// je nach Spracheinstellung mit Komma – die App schreibt Zahlen mit Punkt)
const zahlAusText = (text) => parseFloat(String(text).replace(',', '.'));
// Längenfeld: nur Ziffern und ein Dezimalzeichen (Komma oder Punkt), kein Minus,
// keine Tausendertrennzeichen ("1'250" würde sonst still zu 1)
const nurZahl = (text) => {
    let gesehen = false;
    return String(text).replace(/[^0-9.,]/g, '').replace(/[.,]/g, (z) => (gesehen ? '' : ((gesehen = true), z)));
};

export class CutlistController {
    constructor(profile) {
        this.profile = profile;
        this.items = []; // Listeneinträge { id: ..., length: 2.50, quantity: 1, interlocking: false, note: '' }

        this.initUIEvents();
        this.initBusEvents();
    }

    initUIEvents() {
        // Richtige ID aus index.html: btn-add-row
        const btnAdd = document.getElementById('btn-add-row');
        if (btnAdd) {
            btnAdd.addEventListener('click', () => this.addItem());
        }
    }

    initBusEvents() {
        // Sobald sich das Profil im Editor ändert, m² neu berechnen
        globalEventBus.on('profile:updated', () => this.updateSummary());
    }

    /**
     * Escaped Sonderzeichen, bevor ein Wert per innerHTML in die Tabelle eingefügt wird.
     * Verhindert kaputte HTML-Attribute und Code-Injection über Anmerkungen oder
     * importierte JSON-Dateien.
     */
    escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Fügt ein neues Item zum Daten-Model hinzu und rendert die Tabelle neu
     */
    addItem(data = {}) {
        const newItem = {
            id: Date.now() + Math.random(),
            length: data.length !== undefined ? parseFloat(data.length) : 2.50,
            quantity: data.quantity !== undefined ? parseInt(data.quantity) : 1,
            interlocking: data.interlocking || false,
            note: data.note || ''
        };

        this.items.push(newItem);
        this.renderTable();
        // neue Zeile sichtbar machen, Länge gleich eintippen (nicht beim Laden ganzer Listen)
        if (data.length === undefined) {
            const rows = document.querySelectorAll('#cutlist-body tr');
            const last = rows[rows.length - 1];
            if (last) {
                last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                const input = last.querySelector('.input-length');
                if (input) input.focus({ preventScroll: true });
            }
        }
    }

    /**
     * Entfernt ein Item anhand des Array-Index
     */
    removeItem(index) {
        const [weg] = this.items.splice(index, 1);
        this.renderTable();
        if (!weg) return;
        // Rückgängig: Zeile an derselben Stelle wieder einfügen
        Toast.show(`Position ${index + 1} gelöscht`, 'info', 7000, {
            label: 'Rückgängig',
            onClick: () => {
                this.items.splice(Math.min(index, this.items.length), 0, weg);
                this.renderTable();
                // als Änderung melden (Autosave, Zuschnitt): wie eine Eingabe in der Stückliste
                const tbody = document.getElementById('cutlist-body');
                if (tbody) tbody.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    }

    /**
     * Rendert die komplette Stücklisten-Tabelle synchron zum Daten-Array (this.items)
     */
    renderTable() {
        // Richtige ID aus index.html: cutlist-body
        const tbody = document.getElementById('cutlist-body');
        if (!tbody) return;

        tbody.innerHTML = '';

        // data-label / cell-*: Beschriftung der Felder, wenn die Zeile auf dem
        // Handy als Karte dargestellt wird (siehe styles.css, max-width 640px)
        this.items.forEach((item, index) => {
            const tr = document.createElement('tr');

            tr.innerHTML = `
            <td class="cell-pos" style="text-align: center; font-weight: bold;">${index + 1}</td>
            <td data-label="Länge (m)">
            <input type="text" class="input-length" value="${this.escapeHtml(item.length)}" inputmode="decimal" autocomplete="off">
            <small class="laenge-hinweis">${laengeHinweis(item.length)}</small>
            </td>
            <td data-label="Stückzahl">
            <div class="qty-control" style="display: flex; align-items: center; justify-content: center; gap: 5px;">
            <button type="button" class="qty-btn btn-minus">−</button>
            <input type="number" class="input-qty" value="${this.escapeHtml(item.quantity)}" min="1" inputmode="numeric" style="text-align: center; width: 60px;">
            <button type="button" class="qty-btn btn-plus">+</button>
            </div>
            </td>
            <td data-label="Steckbar" style="text-align: center;">
            <input type="checkbox" class="touch-checkbox input-interlocking" ${item.interlocking ? 'checked' : ''}>
            </td>
            <td data-label="Anmerkung">
            <input type="text" class="input-note" placeholder="Bemerkung..." value="${this.escapeHtml(item.note)}">
            </td>
            <td class="cell-delete" style="text-align: center;">
            <button type="button" class="btn-delete-row" title="Zeile löschen" style="color: #e74c3c; font-size: 1.2rem; border: none; background: none; cursor: pointer;">🗑️</button>
            </td>
            `;

            // --- Event Listener für diese Zeile ---

            // 1. Zuschnittlänge
            const inputLength = tr.querySelector('.input-length');
            const hinweis = tr.querySelector('.laenge-hinweis');
            inputLength.addEventListener('input', (e) => {
                const el = e.target;
                const sauber = nurZahl(el.value);
                if (sauber !== el.value) {
                    // nicht zulässige Zeichen entfernen, Schreibmarke bleibt an ihrer Stelle
                    const pos = nurZahl(el.value.slice(0, el.selectionStart ?? el.value.length)).length;
                    el.value = sauber;
                    el.setSelectionRange(pos, pos);
                }
                hinweis.textContent = laengeHinweis(zahlAusText(el.value));
            });
            inputLength.addEventListener('change', (e) => {
                const v = Math.max(0, zahlAusText(e.target.value) || 0);
                this.items[index].length = v;
                e.target.value = String(v);   // mit Punkt anzeigen
                hinweis.textContent = laengeHinweis(v);
                this.updateSummary();
            });

            // 2. Stückzahl Minus
            tr.querySelector('.btn-minus').addEventListener('click', () => {
                if (this.items[index].quantity > 1) {
                    this.items[index].quantity--;
                    this.renderTable();
                }
            });

            // 3. Stückzahl Plus
            tr.querySelector('.btn-plus').addEventListener('click', () => {
                this.items[index].quantity++;
                this.renderTable();
            });

            // 4. Stückzahl Direkteingabe
            const inputQty = tr.querySelector('.input-qty');
            inputQty.addEventListener('change', (e) => {
                this.items[index].quantity = Math.max(1, parseInt(e.target.value) || 1);
                this.renderTable();
            });

            // 5. Steckbar Checkbox
            const chkInterlocking = tr.querySelector('.input-interlocking');
            chkInterlocking.addEventListener('change', (e) => {
                this.items[index].interlocking = e.target.checked;
                // Steckbar angewählt: Steckprofil automatisch berechnen (main.js)
                if (e.target.checked) globalEventBus.emit('cutlist:interlocking-checked');
            });

            // 6. Bemerkung
            const inputNote = tr.querySelector('.input-note');
            inputNote.addEventListener('input', (e) => {
                this.items[index].note = e.target.value;
            });

            // 7. Löschen-Button
            tr.querySelector('.btn-delete-row').addEventListener('click', () => {
                this.removeItem(index);
            });

            tbody.appendChild(tr);
        });

        this.updateSummary();
    }

    /**
     * Berechnet die Gesamtlaufmeter (lfm) und die Gesamtfläche (m²)
     */
    updateSummary() {
        // 1. Zuschnittbreite in mm (konisch: grössere Abwicklung, der
        //    Verschnitt zählt zum Bedarf und wird separat ausgewiesen)
        const unfold = this.profile ? this.profile.getUnfoldLengths() : { blank: 0, waste: 0 };

        // 2. Summen berechnen
        let totalLfm = 0;
        let totalSqm = 0;
        let totalWasteSqm = 0;

        this.items.forEach(item => {
            const lengthM = laengeM(item.length);
            const qty = parseInt(item.quantity) || 0;

            const itemLfm = lengthM * qty;
            totalLfm += itemLfm;

            // Fläche: Zuschnittbreite (m) * Länge (m) * Stückzahl
            totalSqm += (unfold.blank / 1000) * lengthM * qty;
            totalWasteSqm += (unfold.waste / 1000) * lengthM * qty;
        });

        // 3. UI-Elemente aktualisieren
        const elLfm = document.getElementById('summary-total-lfm');
        const elSqm = document.getElementById('summary-total-sqm');

        if (elLfm) elLfm.textContent = `${totalLfm.toFixed(2)} lfm`;
        if (elSqm) elSqm.textContent = `${totalSqm.toFixed(2)} m²`;

        const elWaste = document.getElementById('summary-waste');
        if (elWaste) {
            const conical = !!(this.profile && this.profile.conical);
            elWaste.classList.toggle('hidden', !conical);
            elWaste.textContent = `davon Verschnitt ${totalWasteSqm.toFixed(2)} m²`;
        }
    }

    /**
     * Für den JSON-Export
     */
    toJSON() {
        return this.items;
    }

    /**
     * Für den JSON-Import.
     * Normalisiert jedes Item wie addItem() statt Fremddaten roh zu übernehmen
     * (unerwartete Typen/Felder aus einer manipulierten oder beschädigten
     * Projektdatei landen so nicht ungeprüft im Datenmodell bzw. im DOM).
     */
    fromJSON(cutlistData) {
        if (Array.isArray(cutlistData)) {
            this.items = cutlistData.map(data => ({
                id: Date.now() + Math.random(),
                length: parseFloat(data?.length) || 0,
                quantity: Math.max(1, parseInt(data?.quantity) || 1),
                interlocking: !!data?.interlocking,
                note: data?.note !== undefined && data?.note !== null ? String(data.note) : ''
            }));
        } else {
            this.items = [];
        }
        this.renderTable();
    }

}
