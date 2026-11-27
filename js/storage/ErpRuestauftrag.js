/**
 * Rüstauftrag in ERPNext erstellen (nur ERP-Betrieb, siehe ErpStorage).
 *
 * Dialog: Profile wählen (oder alle), Bestandsampel je Material, Inhalte des
 * Rüst-PDFs wählen. Danach: PDF erzeugen, Rüstauftrag anlegen (DocType
 * "Ruestauftrag" der App openbender_erp), PDF im Projekt ablegen.
 * Ein Profil, das schon in einem (nicht stornierten) Rüstauftrag steht, ist
 * gesperrt; der Prüfschlüssel zeigt, ob es seither geändert wurde.
 *
 * ctx (von main.js):
 *   ui                    ModuleUI (modal)
 *   erp                   window.OPENBENDER_ERP
 *   dateiBereit()         -> Promise<string|null>  Datei gespeichert? Kennung der Datei
 *   profileSammeln()      -> Promise<[Profil]>      je Blechprofil: { id, name, ok, grund, material_typ,
 *                                                   sorte, dicke, lieferform, zuschnitt, stueck, kg, gemeinsam,
 *                                                   positionen, schluessel }
 *   pdfTeile()            -> [{ key, label, standard }]  wählbare PDF-Inhalte
 *   pdfErstellen(ids, auswahl) -> Promise<Blob>
 *   dateiInhalt()         -> Projektdatei (Objekt), wird als Kopie an den Auftrag gehängt
 *   dateiStand()          -> Stand der gespeicherten Datei (ETag bzw. Änderungszeit)
 *   toast(text, art)
 */
import { ErpStorage } from './ErpStorage.js';

const API = 'openbender_erp.ruestauftrag.';
const PDF_AUSWAHL_KEY = 'openbender.ruestauftrag.pdf';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kg = (x) => `${(Math.round((Number(x) || 0) * 10) / 10).toFixed(1)} kg`;

/** Prüfschlüssel (cyrb53): ändert sich, wenn sich Profil, Stückliste, Material oder Zuschnitt ändern */
export function pruefschluessel(text) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

const materialKey = (p) => [p.material_typ, p.sorte || '', Number(p.dicke) || 0, p.lieferform].join('|');
const materialText = (p) => [p.material_typ, p.sorte, p.dicke ? `${p.dicke} mm` : ''].filter(Boolean).join(' ');

export async function ruestauftragErstellen(ctx) {
    const { ui, erp } = ctx;
    if (!erp.projekt) {
        ctx.toast('Bitte zuerst bei Projekt-Nr. das Projekt wählen.', 'warning');
        return;
    }
    const datei = await ctx.dateiBereit();
    if (!datei) return;

    let profile, status, bestand;
    try {
        profile = await ctx.profileSammeln();
        status = await ErpStorage.call(API + 'profile_status', { projekt: erp.projekt, datei }) || {};
        // Bestand je Material (aller Profile mit Zuschnitt), Ampel rechnet der Dialog
        const abfragen = [];
        profile.filter(p => p.ok).forEach(p => {
            if (!abfragen.some(a => materialKey(a) === materialKey(p))) {
                abfragen.push({ material_typ: p.material_typ, material: p.material_typ, sorte: p.sorte, dicke: p.dicke, lieferform: p.lieferform, kg: 0 });
            }
        });
        bestand = abfragen.length ? await ErpStorage.call(API + 'bestand', { abfragen: JSON.stringify(abfragen) }, true) : { materialien: [] };
    } catch (e) {
        ctx.toast('Rüstauftrag: Daten aus ERPNext nicht verfügbar – ' + (e.message || e), 'warning');
        return;
    }
    profile.forEach(p => {
        const s = status[p.id];
        if (s) {
            p.ok = false;
            p.grund = `schon in ${s.ruestauftrag} (${s.status})` + (s.schluessel && s.schluessel !== p.schluessel ? ' – seither geändert' : '');
            p.bestellt = s.ruestauftrag;
        }
    });
    // Gemeinsamer Zuschnitt (eine Rolle bzw. dieselben Tafeln für mehrere Profile):
    // nur zusammen bestellen, sonst würde das Material doppelt gebucht.
    profile.forEach(p => {
        if (!p.ok || !p.gemeinsam) return;
        const bestellt = profile.filter(q => q.gemeinsam === p.gemeinsam && q.bestellt);
        if (bestellt.length) {
            p.ok = false;
            p.grund = `teilt den Zuschnitt mit schon bestellten Profilen (${[...new Set(bestellt.map(q => q.bestellt))].join(', ')}). `
                + 'Im Tab Zuschnitt «gemeinsam zuschneiden» ausschalten, dann einzeln bestellen.';
        }
    });
    if (!profile.length) {
        ctx.toast('Dieses Projekt hat keine Blechprofile.', 'warning');
        return;
    }

    const teile = ctx.pdfTeile();
    let gemerkt = {};
    try { gemerkt = JSON.parse(localStorage.getItem(PDF_AUSWAHL_KEY) || '{}') || {}; } catch (e) { gemerkt = {}; }
    const knapp = Number(bestand.knapp ?? 20);
    const vorrat = (p) => (bestand.materialien || []).find(m => materialKey({ ...m, material_typ: m.material_typ || m.material }) === materialKey(p));

    const profilZeile = (p) => `<label class="ra-profil${p.ok ? '' : ' ra-gesperrt'}">
            <input type="checkbox" data-profil="${esc(p.id)}" ${p.ok ? 'checked' : 'disabled'}>
            <span class="ra-name">${esc(p.name)}</span>
            <span class="ra-info">${p.ok
                ? `${esc(materialText(p))} · ${esc(p.lieferform)} · ${esc(p.zuschnitt)} · ${kg(p.kg)}${p.gemeinsam ? ` · gemeinsamer Zuschnitt mit ${profile.filter(q => q.gemeinsam === p.gemeinsam && q !== p).length} weiteren, nur zusammen` : ''}`
                : esc(p.grund || 'kein Zuschnitt')}</span>
        </label>`;

    const html = `
        <p class="info-panel-desc">Projekt ${esc(erp.projekt)}${erp.projektTitel ? ` – ${esc(erp.projektTitel)}` : ''}. Welche Profile sollen gerüstet werden?</p>
        <label class="ra-alle"><input type="checkbox" data-alle checked> Alle wählbaren Profile</label>
        <div class="ra-liste">${profile.map(profilZeile).join('')}</div>
        <h3 class="ra-titel">Material und Lager</h3>
        <div class="ra-bestand"></div>
        <p class="opt-note">${esc(bestand.hinweis || '')}</p>
        <h3 class="ra-titel">Rüst-PDF für die Werkstatt</h3>
        <p class="opt-note">Produktionsdatenblatt mit Profil und Stückliste ist immer dabei.</p>
        <div class="ra-pdf">${teile.map(t => `<label class="ra-check"><input type="checkbox" data-pdf="${esc(t.key)}" ${(t.key in gemerkt ? gemerkt[t.key] : t.standard !== false) ? 'checked' : ''}> ${esc(t.label)}</label>`).join('')}</div>
        <label class="module-field"><span class="module-field-label">Bezeichnung (optional)</span>
            <input type="text" class="ra-bezeichnung" maxlength="140" placeholder="z.B. Dachrand Nord, 1. Etappe"></label>
        <style>
            .ra-alle { display:block; margin:6px 0; font-weight:600; }
            .ra-liste { max-height:38vh; overflow:auto; border:1px solid #e9ecef; border-radius:8px; }
            .ra-profil { display:flex; gap:10px; align-items:baseline; padding:8px 10px; border-bottom:1px solid #f1f3f5; cursor:pointer; }
            .ra-profil:last-child { border-bottom:0; }
            .ra-profil .ra-name { font-weight:600; min-width:9em; }
            .ra-profil .ra-info { color:#6c757d; font-size:.9em; }
            .ra-gesperrt { opacity:.55; cursor:not-allowed; }
            .ra-titel { font-size:1rem; margin:16px 0 6px; }
            .ra-bestand table { width:100%; border-collapse:collapse; font-size:.92em; }
            .ra-bestand th, .ra-bestand td { text-align:left; padding:5px 6px; border-bottom:1px solid #f1f3f5; }
            .ra-bestand td.zahl, .ra-bestand th.zahl { text-align:right; white-space:nowrap; }
            .ra-ampel { display:inline-block; width:.8em; height:.8em; border-radius:50%; margin-right:6px; vertical-align:middle; }
            .ra-ampel.gruen { background:#27ae60; } .ra-ampel.orange { background:#e67e22; } .ra-ampel.rot { background:#c0392b; }
            .ra-check { display:block; margin:4px 0; }
        </style>`;

    let gewaehlt = null, pdfAuswahl = null, bezeichnung = '';
    const ok = await ui.modal({
        title: 'Rüstauftrag erstellen',
        wide: true,
        html,
        buttons: [{ label: 'Abbrechen', value: false }, { label: 'Rüstauftrag erstellen', value: true, primary: true }],
        onOpen: (body) => {
            const auswahl = () => profile.filter(p => p.ok && body.querySelector(`[data-profil="${CSS.escape(p.id)}"]`).checked);
            const bestandZeigen = () => {
                const gruppen = new Map();
                const gezaehlt = new Set();
                auswahl().forEach(p => {
                    const k = materialKey(p);
                    if (!gruppen.has(k)) gruppen.set(k, { p, kg: 0 });
                    if (p.gemeinsam && gezaehlt.has(p.gemeinsam)) return;
                    if (p.gemeinsam) gezaehlt.add(p.gemeinsam);
                    gruppen.get(k).kg += Number(p.kg) || 0;
                });
                const zeilen = [...gruppen.values()].map(({ p, kg: bedarf }) => {
                    const m = vorrat(p);
                    const lager = m ? Number(m.bestand) || 0 : 0;
                    const artikel = m && m.artikel && m.artikel.length ? m.artikel.map(a => a.item_name || a.name).join(', ') : '';
                    let ampel = 'gruen', text = 'Genug im Lager';
                    if (!artikel) { ampel = 'rot'; text = 'Kein Artikel mit openBender verknüpft'; }
                    else if (lager < bedarf) { ampel = 'rot'; text = 'Zu wenig im Lager'; }
                    else if (lager < bedarf * (1 + knapp / 100)) { ampel = 'orange'; text = 'Knapp'; }
                    return `<tr><td>${esc(materialText(p))} · ${esc(p.lieferform)}<br><span class="opt-note">${esc(artikel || '–')}</span></td>
                        <td class="zahl">${kg(bedarf)}</td><td class="zahl">${artikel ? kg(lager) : '–'}</td>
                        <td><span class="ra-ampel ${ampel}"></span>${esc(text)}</td></tr>`;
                });
                body.querySelector('.ra-bestand').innerHTML = zeilen.length
                    ? `<table><tr><th>Material</th><th class="zahl">Bedarf</th><th class="zahl">Lager</th><th>Stand</th></tr>${zeilen.join('')}</table>`
                    : '<p class="opt-note">Kein Profil gewählt.</p>';
            };
            body.addEventListener('change', (e) => {
                if (e.target.matches('[data-alle]')) {
                    body.querySelectorAll('[data-profil]:not(:disabled)').forEach(c => { c.checked = e.target.checked; });
                }
                // Profile mit gemeinsamem Zuschnitt immer zusammen
                const p = e.target.matches('[data-profil]') && profile.find(x => x.id === e.target.dataset.profil);
                if (p && p.gemeinsam) {
                    profile.filter(q => q.ok && q.gemeinsam === p.gemeinsam).forEach(q => {
                        body.querySelector(`[data-profil="${CSS.escape(q.id)}"]`).checked = e.target.checked;
                    });
                }
                bestandZeigen();
            });
            bestandZeigen();
        },
        beforeClose: (value, body) => {
            if (!value) return true;
            gewaehlt = profile.filter(p => p.ok && body.querySelector(`[data-profil="${CSS.escape(p.id)}"]`).checked);
            if (!gewaehlt.length) {
                ctx.toast('Bitte mindestens ein Profil wählen.', 'warning');
                return false;
            }
            pdfAuswahl = new Set([...body.querySelectorAll('[data-pdf]')].filter(c => c.checked).map(c => c.dataset.pdf));
            const merken = Object.fromEntries([...body.querySelectorAll('[data-pdf]')].map(c => [c.dataset.pdf, c.checked]));
            try { localStorage.setItem(PDF_AUSWAHL_KEY, JSON.stringify(merken)); } catch (e) { /* nur Komfort */ }
            bezeichnung = body.querySelector('.ra-bezeichnung').value.trim();
            return true;
        }
    });
    if (!ok || !gewaehlt) return;

    let res, pdf;
    try {
        ctx.toast('Rüstauftrag wird erstellt …', 'info');
        pdf = await ctx.pdfErstellen(gewaehlt.map(p => p.id), pdfAuswahl);
        res = await ErpStorage.call(API + 'erstellen', {
            daten: JSON.stringify({
                projekt: erp.projekt,
                datei,
                titel: bezeichnung,
                profile: gewaehlt.map(p => ({
                    profil_id: p.id, profil: p.name, schluessel: p.schluessel, material_typ: p.material_typ, sorte: p.sorte,
                    dicke: p.dicke, lieferform: p.lieferform, zuschnitt: p.zuschnitt, stueck: p.stueck, kg: Math.round(p.kg * 10) / 10, kg_netto: p.kg_netto || 0,
                    gemeinsam: p.gemeinsam, positionen: p.positionen
                })),
                pdf: { inhalt: await alsBase64(pdf) },
                // unveränderliche Kopie der Datei am Auftrag (falls sie später geändert oder gelöscht wird)
                inhalt: ctx.dateiInhalt(),
                stand: ctx.dateiStand()
            })
        }, true);
    } catch (e) {
        ctx.toast('Rüstauftrag nicht erstellt: ' + (e.message || e), 'warning', 9000);
        return;
    }
    await ui.modal({
        title: `Rüstauftrag ${res.name} erstellt`,
        html: `<p class="info-panel-desc">${gewaehlt.length} Profil${gewaehlt.length === 1 ? '' : 'e'} im Auftrag. Das Rüst-PDF liegt im Projekt${erp.ablage === 'nextcloud' ? ` (${esc(erp.unterordner || 'Zeichnungen')})` : ''}.</p>`,
        buttons: [{ label: 'Schliessen', value: false }, { label: 'In ERPNext öffnen', value: 'erp' }, { label: 'Rüst-PDF öffnen', value: 'pdf', primary: true }],
        onOpen: (body) => {
            const overlay = body.closest('.module-dialog-overlay');
            overlay.querySelectorAll('[data-btn]').forEach(b => b.addEventListener('click', () => {
                if (b.textContent === 'Rüst-PDF öffnen') {
                    const url = URL.createObjectURL(pdf);
                    window.open(url, '_blank');
                    setTimeout(() => URL.revokeObjectURL(url), 60000);
                } else if (b.textContent === 'In ERPNext öffnen') {
                    window.open(`/app/ruestauftrag/${encodeURIComponent(res.name)}`, '_blank');
                }
            }, { capture: true, once: true }));
        }
    });
}

function alsBase64(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}
