import { Profile } from '../models/Profile.js';
import { profileThumbnail } from './FileBrowserController.js';
import { laengeM } from './CutlistController.js';
import { Toast } from '../utils/Toast.js';

const ZU_KEY = 'openbender.profilliste.zu';   // Bedienkomfort: Leiste zugeklappt?

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Anzeigename eines Eintrags: der eingetragene Name, sonst „Profil <Nr.>“
 * (bzw. der Name der Art, z.B. „Blindpaneel 3“)
 */
export const profilName = (entry, index, typName = 'Profil') => (entry.fields.profileName || '').trim() || `${typName} ${index + 1}`;
const istProfil = (entry) => !entry.type || entry.type === 'profile';

/** Abwicklung (mm) aus gespeicherter Geometrie: { front, back, conical } */
export function abwicklungVon(profileData) {
    try {
        const p = new Profile();
        p.loadData(JSON.parse(JSON.stringify(profileData)));
        const u = p.getUnfoldLengths();
        return { front: u.front, back: u.back, conical: !!p.conical };
    } catch (e) {
        return { front: 0, back: 0, conical: false };
    }
}

/** Kennzahlen eines Profils für Karte und Projektübersicht */
export function profilInfo(entry, index) {
    const f = entry.fields;
    const abw = abwicklungVon(entry.profile);
    const stueck = (entry.cutlist || []).reduce((n, it) => n + (parseInt(it.quantity) || 0), 0);
    const lfm = (entry.cutlist || []).reduce((n, it) => n + laengeM(it.length) * (parseInt(it.quantity) || 0), 0);
    const material = [f.materialType, f.materialSpec].filter(Boolean).join(' ')
        + (f.materialThickness ? `${f.materialType ? ' · ' : ''}${f.materialThickness} mm` : '');
    return { name: profilName(entry, index), material, abw, stueck, lfm, positionen: (entry.cutlist || []).length };
}

/**
 * Leiste links mit den Ausmassen des Projekts: Blechprofile und Einträge der
 * Dokumentarten von Modulen (z.B. Blindpaneele). Karte je Eintrag, neu,
 * duplizieren, umbenennen, löschen (mit Rückgängig), Reihenfolge. Zugeklappt
 * bleibt ein schmaler Streifen mit den Nummern. Auf dem Handy ist die Leiste
 * ein Einschub (Menü ⋯).
 *
 * Gibt es nur Blechprofile (kein Modul mit eigener Dokumentart), heisst alles
 * wie bisher „Profil“; sonst „Ausmass“.
 *
 * options: { store, ui, setProfileName(name), onChanged(), onSelected(),
 *            onAdd() – Knopf „Neu“ (Art wählen, anlegen),
 *            mehrereArten() – gibt es Dokumentarten von Modulen?,
 *            typInfo(entry) – { usable, name, icon, preview: { thumbnail, text } | null } }
 */
export class ProfileListController {
    constructor(options) {
        this.options = options;
        this.store = options.store;
        this.el = document.getElementById('profil-leiste');
        this.liste = this.el.querySelector('.pl-liste');
        this.timer = null;
        this.typInfo = options.typInfo || (() => ({ usable: true, name: 'Blechprofil', icon: '', preview: null }));

        let zu = false;
        try { zu = localStorage.getItem(ZU_KEY) === '1'; } catch (e) { /* nur Komfort */ }
        document.body.classList.toggle('profilliste-zu', zu);

        this.el.addEventListener('click', (e) => this.onClick(e));
        this.el.addEventListener('dblclick', (e) => {
            const karte = e.target.closest('[data-profil]');
            if (karte && !e.target.closest('[data-aktion]')) this.rename(karte.dataset.profil);
        });
        const schleier = document.getElementById('profil-leiste-schleier');
        if (schleier) schleier.addEventListener('click', () => this.setOffen(false));

        // Höhe von Reitern und Toolbar: die Leiste beginnt darunter
        const kopf = () => {
            const tb = document.getElementById('toolbar');
            if (tb) document.documentElement.style.setProperty('--kopf-hoehe', `${Math.round(tb.getBoundingClientRect().bottom)}px`);
        };
        kopf();
        window.addEventListener('resize', kopf);
        if (typeof ResizeObserver !== 'undefined') {
            const tb = document.getElementById('toolbar');
            if (tb) new ResizeObserver(kopf).observe(tb);
        }
        this.render();
    }

    /** Leiste ein-/ausblenden */
    setVisible(visible) {
        document.body.classList.toggle('mit-profilliste', !!visible);
        this.platzGeaendert();
    }

    /** Handy: Einschub öffnen / schliessen */
    setOffen(offen) {
        document.body.classList.toggle('profilliste-offen', !!offen);
        if (offen) this.render();
    }

    toggleZu() {
        // Handy: der Knopf schliesst den Einschub
        if (document.body.classList.contains('profilliste-offen')) { this.setOffen(false); return; }
        const zu = !document.body.classList.contains('profilliste-zu');
        document.body.classList.toggle('profilliste-zu', zu);
        try { localStorage.setItem(ZU_KEY, zu ? '1' : '0'); } catch (e) { /* nur Komfort */ }
        this.render();
        this.platzGeaendert();
    }

    // Zeichenfläche, 3D und Beschriftungen an den neuen Platz anpassen
    platzGeaendert() {
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }

    /** Neu zeichnen, zusammengefasst (bei jeder Profil- oder Formularänderung aufgerufen) */
    schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.render(), 250);
    }

    render() {
        clearTimeout(this.timer);
        if (!this.el) return;
        const store = this.store;
        store.sync();
        const zu = document.body.classList.contains('profilliste-zu') && !document.body.classList.contains('profilliste-offen');
        // Begriffe: nur Blechprofile möglich → „Profil“, sonst „Ausmass“
        const ausmass = !!(this.options.mehrereArten && this.options.mehrereArten()) || store.entries.some(e => !istProfil(e));
        const titel = this.el.querySelector('.pl-titel');
        if (titel && titel.firstChild) titel.firstChild.textContent = ausmass ? 'Ausmasse ' : 'Profile ';
        this.el.setAttribute('aria-label', ausmass ? 'Ausmasse des Projekts' : 'Profile des Projekts');
        const neu = this.el.querySelector('[data-aktion="neu"]');
        if (neu) {
            neu.title = ausmass ? 'Neues Ausmass im Projekt (Blechprofil, Blindpaneel …)' : 'Neues Blechprofil im Projekt';
            const t = neu.querySelector('.pl-neu-text');
            if (t) t.textContent = ausmass ? ' Neues Ausmass' : ' Neues Profil';
        }
        const handy = document.querySelector('#mobile-menu [data-action="profile"]');
        if (handy) handy.textContent = ausmass ? '☰ Ausmasse des Projekts …' : '☰ Profile des Projekts …';
        const anzahl = this.el.querySelector('.pl-anzahl');
        if (anzahl) anzahl.textContent = `(${store.count})`;
        const toggle = this.el.querySelector('[data-aktion="zu"]');
        if (toggle) {
            toggle.textContent = zu ? '▸' : '◂';
            toggle.title = zu ? 'Liste aufklappen' : 'Liste zuklappen';
            toggle.setAttribute('aria-expanded', String(!zu));
        }

        if (zu) {
            // schmaler Streifen: nur die Nummern, das aktive hervorgehoben
            this.liste.innerHTML = store.entries.map((e, i) => {
                const k = this.karte(e, i);
                return `<button type="button" class="pl-chip ${e.id === store.activeId ? 'active' : ''} ${k.usable ? '' : 'gesperrt'}" data-profil="${esc(e.id)}" title="${esc(k.name)}${k.zeile1 ? ` · ${esc(k.zeile1)}` : ''}">${i + 1}</button>`;
            }).join('');
            return;
        }

        const einzig = store.count <= 1;
        this.liste.innerHTML = store.entries.map((e, i) => {
            const k = this.karte(e, i);
            const aktiv = e.id === store.activeId;
            const aktionen = aktiv ? `<div class="pl-aktionen">
                    <button type="button" data-aktion="hoch" title="Nach oben" ${i === 0 ? 'disabled' : ''}>▲</button>
                    <button type="button" data-aktion="runter" title="Nach unten" ${i === store.count - 1 ? 'disabled' : ''}>▼</button>
                    <button type="button" data-aktion="name" title="Umbenennen (auch Doppelklick)">✎</button>
                    <button type="button" data-aktion="kopie" title="Duplizieren">⧉</button>
                    <button type="button" data-aktion="weg" title="${einzig ? 'Der letzte Eintrag bleibt im Projekt' : 'Löschen'}" ${einzig ? 'disabled' : ''}>🗑</button>
                </div>` : '';
            // nicht bearbeitbar (Modul fehlt): grau, ohne Aktionen ausser Reihenfolge/Löschen
            return `<div class="pl-karte ${aktiv ? 'active' : ''} ${k.usable ? '' : 'gesperrt'}" data-profil="${esc(e.id)}" role="button" tabindex="0" aria-current="${aktiv}"${k.usable ? '' : ' aria-disabled="true"'}>
                <div class="pl-bild">${k.bild}</div>
                <div class="pl-text">
                    <strong><span class="pl-nr">${i + 1}</span> ${esc(k.name)}</strong>
                    ${k.art ? `<small class="pl-art">${esc(k.art)}</small>` : ''}
                    <small>${esc(k.zeile1)}</small>
                    ${k.zeile2 ? `<small>${esc(k.zeile2)}</small>` : ''}
                </div>
                ${!aktiv && !k.usable ? `<div class="pl-aktionen"><button type="button" data-aktion="weg" title="Löschen" ${einzig ? 'disabled' : ''}>🗑</button></div>` : ''}
                ${aktionen}
            </div>`;
        }).join('');
    }

    /** Inhalt einer Karte: { name, art, zeile1, zeile2, bild, usable } */
    karte(e, i) {
        if (istProfil(e)) {
            const info = profilInfo(e, i);
            const abw = info.abw.conical ? `${Math.round(info.abw.front)} / ${Math.round(info.abw.back)} mm` : `${Math.round(info.abw.front)} mm`;
            const gemischt = this.store.entries.some(x => !istProfil(x));
            return {
                name: info.name, art: gemischt ? 'Blechprofil' : '', usable: true,
                zeile1: info.material || 'Material offen',
                zeile2: `Abw. ${abw}${info.stueck ? ` · ${info.stueck} Stk.` : ''}`,
                bild: profileThumbnail({ profile: e.profile })
            };
        }
        const t = this.typInfo(e);
        const vorschau = t.preview || null;
        return {
            name: profilName(e, i, t.kurz || t.name),
            art: t.usable ? `${t.icon ? t.icon + ' ' : ''}${t.name}` : `${t.name} – Modul nicht aktiv`,
            usable: t.usable,
            zeile1: vorschau && vorschau.text ? vorschau.text : (t.usable ? '' : 'Daten bleiben erhalten'),
            zeile2: '',
            bild: vorschau && vorschau.thumbnail ? vorschau.thumbnail : `<span class="fb-thumb-empty">${esc(t.icon || '📄')}</span>`
        };
    }

    onClick(e) {
        const aktion = e.target.closest('[data-aktion]');
        const karte = e.target.closest('[data-profil]');
        const id = karte ? karte.dataset.profil : this.store.activeId;
        if (aktion) {
            if (aktion.disabled) return;
            const a = aktion.dataset.aktion;
            if (a === 'zu') this.toggleZu();
            else if (a === 'neu') this.add();
            else if (a === 'hoch' || a === 'runter') { if (this.store.move(id, a === 'hoch' ? -1 : 1)) this.changed(); }
            else if (a === 'name') this.rename(id);
            else if (a === 'kopie') { this.store.duplicate(id); this.changed(); }
            else if (a === 'weg') this.remove(id);
            return;
        }
        if (karte && karte.dataset.profil !== this.store.activeId) {
            const entry = this.store.entries[this.store.indexOf(karte.dataset.profil)];
            if (entry && !istProfil(entry) && !this.typInfo(entry).usable) {
                Toast.show(`„${esc(this.typInfo(entry).name)}“ lässt sich nur mit dem zugehörigen Modul bearbeiten (🔌 Module verwalten). Die Daten bleiben in der Datei erhalten.`, 'warning', 5000);
                return;
            }
        }
        if (karte && this.store.select(karte.dataset.profil)) {
            this.render();
            if (this.options.onSelected) this.options.onSelected();
            this.setOffen(false);
        }
    }

    changed() {
        this.render();
        this.options.onChanged();
    }

    async add() {
        this.setOffen(false);
        if (await this.options.onAdd()) this.changed();
    }

    async rename(id) {
        const store = this.store;
        store.sync();
        const index = store.indexOf(id);
        const entry = store.entries[index];
        if (!entry) return;
        const werte = await this.options.ui.prompt({
            title: istProfil(entry) ? 'Profil umbenennen' : 'Umbenennen',
            okLabel: 'Übernehmen',
            fields: [{ key: 'name', label: istProfil(entry) ? 'Blechprofil-Name' : 'Name', type: 'text', value: entry.fields.profileName || '', placeholder: istProfil(entry) ? `Profil ${index + 1}` : profilName(entry, index, this.typInfo(entry).kurz || this.typInfo(entry).name) }]
        });
        if (!werte) return;
        const name = String(werte.name || '').trim();
        if (id === store.activeId) this.options.setProfileName(name);   // Feld in „Stückliste & Projekt“
        else entry.fields.profileName = name;
        this.changed();
    }

    remove(id) {
        const store = this.store;
        const index = store.indexOf(id);
        const name = index >= 0 ? this.karte(store.entries[index], index).name : '';
        const usable = (type) => type === 'profile' || this.typInfo({ type }).usable;
        const weg = store.remove(id, usable);
        if (!weg) {
            Toast.show('Das ist das einzige bearbeitbare Ausmass im Projekt – es bleibt.', 'info', 4000);
            return;
        }
        this.changed();
        Toast.show(`„${esc(name)}“ gelöscht`, 'info', 7000, {
            label: 'Rückgängig',
            onClick: () => {
                const vorher = store.activeId;
                store.restore(weg, usable);
                this.changed();
                if (store.activeId !== vorher && this.options.onSelected) this.options.onSelected();
            }
        });
    }
}
