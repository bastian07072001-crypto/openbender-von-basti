/**
 * Vorlagen-Menü der Toolbar (📐 Vorlagen) und Dialog "Als Vorlage speichern".
 * Die Auswahl "Profil aus Vorlage" (eigene Vorlagen und Vorlagen aus
 * Modulen) liegt in ModuleUI.openTemplates.
 */
import { escapeHtml } from '../modules/ModuleUI.js';
import { UserTemplates, profileToSteps, innerAngle, templatePreviewSvg } from './UserTemplates.js';

const LENGTH_NAMES = 'abcdefghijklmnopqrstuvwxyz';
const ANGLE_NAMES = 'αβγδεζηθικλμνξοπρστυφχψω';

export class TemplateController {
    /**
     * opts: { ui (ModuleUI), getProfileData () => { points, segments, conical } }
     */
    constructor({ ui, getProfileData }) {
        this.ui = ui;
        this.getProfileData = getProfileData;
        this.button = document.getElementById('btn-templates');
        this.menu = document.getElementById('template-menu');
        if (!this.button || !this.menu) return;

        this.menu.innerHTML = `
            <button type="button" role="menuitem" data-do="use">Profil aus Vorlage …</button>
            <button type="button" role="menuitem" data-do="save">Aktuelles Profil als Vorlage speichern …</button>`
            + (UserTemplates.importMoeglich() ? `
            <button type="button" role="menuitem" data-do="import">Vorlagen aus dem Speicherordner übernehmen …</button>` : '');
        this.button.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMenu(this.button);
        });
        this.menu.addEventListener('click', (e) => {
            const item = e.target.closest('button');
            if (!item) return;
            this.closeMenu();
            if (item.dataset.do === 'use') this.openPicker();
            else if (item.dataset.do === 'save') this.openSaveDialog();
            else if (item.dataset.do === 'import') this.importFromFolder();
        });
        document.addEventListener('pointerdown', (e) => {
            if (!this.menu.classList.contains('hidden') && !this.menu.contains(e.target) && e.target !== this.button) this.closeMenu();
        });
    }

    toggleMenu(anchor) {
        const opening = this.menu.classList.contains('hidden');
        if (opening) {
            const r = anchor.getBoundingClientRect();
            this.menu.style.top = `${r.bottom + 4}px`;
            this.menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 300))}px`;
        }
        this.menu.classList.toggle('hidden', !opening);
    }

    closeMenu() {
        this.menu.classList.add('hidden');
    }

    openPicker() {
        return this.ui.openTemplates();
    }

    // ERPNext: eigene Vorlagen aus dem Speicherordner einmalig hochladen
    async importFromFolder() {
        if (!(await this.ui.confirm('Vorlagen übernehmen?',
            'Die Vorlagen aus dem Speicherordner (Unterordner „Vorlagen“) werden nach ERPNext kopiert. Vorlagen mit einem Namen, den es in ERPNext schon gibt, werden übersprungen. Der Ordner bleibt unverändert.'))) return;
        try {
            const r = await UserTemplates.importFromFolder();
            const teile = [`${r.neu} übernommen`];
            if (r.vorhanden) teile.push(`${r.vorhanden} schon vorhanden`);
            if (r.fehler.length) teile.push(`${r.fehler.length} nicht möglich (${r.fehler.join('; ')})`);
            this.ui.toast(`Vorlagen: ${teile.join(', ')}.`, r.fehler.length ? 'warning' : 'info', 8000);
        } catch (e) {
            this.ui.toast(`Übernahme fehlgeschlagen: ${e.message || e}`, 'warning', 7000);
        }
    }

    // --- Als Vorlage speichern ---------------------------------------------

    async openSaveDialog() {
        const shape = profileToSteps(this.getProfileData());
        if (shape.error) {
            this.ui.toast(shape.error, 'warning');
            return;
        }
        const steps = shape.steps;
        // Vorschlag: alle Längen veränderbar, Winkel fest
        const rows = [];
        steps.forEach((s, i) => {
            if (i > 0) {
                rows.push({ kind: 'angle', index: i, value: innerAngle(s.turn), on: false, label: ANGLE_NAMES[(i - 1) % ANGLE_NAMES.length] });
            }
            rows.push({ kind: 'length', index: i, value: s.length, on: true, label: LENGTH_NAMES[i % LENGTH_NAMES.length] });
        });

        const rowHtml = (r, n) => `<div class="tplsave-row" data-n="${n}">
                <label class="tplsave-check"><input type="checkbox" data-n="${n}" ${r.on ? 'checked' : ''}>
                    <span>${r.kind === 'length' ? `Schenkel ${r.index + 1}` : `Winkel ${r.index}/${r.index + 1}`}</span></label>
                <span class="tplsave-value">${r.kind === 'length' ? `${r.value} mm` : `${r.value}°`}</span>
                <input type="text" class="tplsave-label" data-n="${n}" value="${escapeHtml(r.label)}" maxlength="40" aria-label="Bezeichnung" ${r.on ? '' : 'disabled'}>
            </div>`;

        const result = await this.ui.modal({
            title: 'Als Vorlage speichern',
            wide: true,
            html: `<p class="info-panel-desc">Die Vorlage merkt sich das gezeichnete Profil. Angehakte Längen und Winkel lassen sich beim Verwenden ändern, alles andere bleibt wie gezeichnet. ${escapeHtml(UserTemplates.ort())}</p>
                <div class="tplsave-layout">
                    <div class="tplsave-side">
                        <div class="module-form">
                            <label class="module-field"><span class="module-field-label">Name</span>
                                <input type="text" class="tplsave-name" maxlength="60" placeholder="z.B. Mauerabdeckung 2-teilig"></label>
                            <label class="module-field"><span class="module-field-label">Kategorie</span>
                                <input type="text" class="tplsave-category" maxlength="40" placeholder="Eigene Vorlagen"></label>
                            <label class="module-field"><span class="module-field-label">Beschreibung</span>
                                <input type="text" class="tplsave-desc" maxlength="200" placeholder="optional"></label>
                        </div>
                        <div class="tpl-preview tplsave-preview"></div>
                    </div>
                    <div class="tplsave-params">
                        <div class="tplsave-head"><span>Veränderbar</span><span>Gezeichnet</span><span>Bezeichnung</span></div>
                        ${rows.map(rowHtml).join('')}
                    </div>
                </div>
                <p class="module-form-error" hidden></p>`,
            buttons: [{ label: 'Abbrechen', value: false }, { label: 'Vorlage speichern', value: true, primary: true }],
            onOpen: (body) => {
                const draw = () => {
                    body.querySelector('.tplsave-preview').innerHTML = templatePreviewSvg(shape, rows);
                };
                body.addEventListener('change', (e) => {
                    const box = e.target.closest('input[type="checkbox"][data-n]');
                    if (!box) return;
                    const r = rows[Number(box.dataset.n)];
                    r.on = box.checked;
                    body.querySelector(`.tplsave-label[data-n="${box.dataset.n}"]`).disabled = !r.on;
                    draw();
                });
                body.addEventListener('input', (e) => {
                    const field = e.target.closest('.tplsave-label');
                    if (!field) return;
                    rows[Number(field.dataset.n)].label = field.value;
                    draw();
                });
                // Zeile hervorheben, über der man steht
                body.addEventListener('pointerover', (e) => {
                    const row = e.target.closest('.tplsave-row');
                    const n = row ? Number(row.dataset.n) : -1;
                    body.querySelectorAll('.tplsave-preview [data-n]').forEach(el => el.classList.toggle('hot', Number(el.dataset.n) === n));
                });
                draw();
                body.querySelector('.tplsave-name').focus();
            },
            beforeClose: async (value, body) => {
                if (!value) return true;
                const error = (text) => {
                    const box = body.querySelector('.module-form-error');
                    box.textContent = text;
                    box.hidden = false;
                    return false;
                };
                const name = body.querySelector('.tplsave-name').value.trim();
                if (!name) return error('Bitte einen Namen eingeben.');
                const params = [];
                const used = new Set();
                for (const r of rows.filter(x => x.on)) {
                    const label = r.label.trim();
                    if (!label) return error('Jeder veränderbare Wert braucht eine Bezeichnung.');
                    if (used.has(label)) return error(`Die Bezeichnung „${label}“ kommt mehrfach vor.`);
                    used.add(label);
                    params.push({ key: `${r.kind === 'length' ? 'l' : 'w'}${r.index + 1}`, label, kind: r.kind, index: r.index, value: r.value });
                }
                const template = {
                    name,
                    category: body.querySelector('.tplsave-category').value.trim() || 'Eigene Vorlagen',
                    description: body.querySelector('.tplsave-desc').value.trim(),
                    start: shape.start,
                    direction: shape.direction,
                    conical: shape.conical,
                    steps,
                    params
                };
                try {
                    if (await UserTemplates.exists(name)) {
                        const replace = await this.ui.confirm('Vorlage ersetzen?', `Es gibt schon eine Vorlage „${name}“. Soll sie ersetzt werden?`);
                        if (!replace) return false;
                    }
                    await UserTemplates.save(template);
                    forgetValues(`user:${UserTemplates.fileFor(name)}`);
                } catch (e) {
                    return error(e.message || String(e));
                }
                this.savedName = name;
                return true;
            }
        });
        if (result) this.ui.toast(`Vorlage „${this.savedName}“ gespeichert (📐 Vorlagen → Profil aus Vorlage).`);
    }
}

// Zuletzt eingegebene Werte einer ersetzten Vorlage vergessen (siehe
// ModuleUI.openTemplates), damit die neuen gezeichneten Masse gelten
function forgetValues(key) {
    try {
        const remembered = JSON.parse(localStorage.getItem('openbender.templateValues') || '{}') || {};
        delete remembered[key];
        localStorage.setItem('openbender.templateValues', JSON.stringify(remembered));
    } catch (e) { /* nur Komfort */ }
}
