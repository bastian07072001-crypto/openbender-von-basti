/**
 * Entwickler-Beispiel – zeigt alle Teile der Modul-Schnittstelle an einem
 * kleinen, lauffähigen Modul (standardmässig ausgeschaltet):
 *
 *   - eigener Tab mit Oberfläche          api.ui.addTab
 *   - Daten in der Projektdatei           api.data
 *   - Einstellungen pro Browser           api.settings
 *   - Eintrag im Modul-Menü + Datei       api.ui.addAction, api.ui.saveFile
 *   - Zeichnen im Profil-Editor           api.canvas.onDraw
 *   - eigene PDF-Seite                    api.pdf.addPages
 *   - Ereignisse                          api.on
 *
 * Schnittstelle: docs/module.md
 */
export default {
    id: 'beispiel',
    name: 'Entwickler-Beispiel',
    version: '1.0.0',
    apiVersion: 1,
    author: 'OpenBender',
    description: 'Zeigt, wie ein Modul gebaut ist: eigener Tab mit Notizen zum Projekt, Hüllmasse im Editor, CSV-Export der Stückliste und eine Notizen-Seite im PDF.',

    register(api) {
        const esc = api.ui.esc;

        // --- Tab -------------------------------------------------------------
        const tab = api.ui.addTab({
            label: '📝 Beispiel',
            shortLabel: '📝',
            title: 'Entwickler-Beispiel',
            onShow: () => render()
        });

        const render = () => {
            const unfold = api.profile.unfold();
            const profile = api.profile.get();
            const items = api.cutlist.get();
            const project = api.project.get();
            const pieces = items.reduce((n, it) => n + it.quantity, 0);
            const notes = (api.data.get() || {}).notes || '';

            tab.container.innerHTML = `
                <h2>Entwickler-Beispiel</h2>
                <p>Dieses Modul liest das aktuelle Dokument über die Schnittstelle und speichert eigene Notizen in der Projektdatei.</p>
                <ul>
                    <li>Projekt: <strong>${esc(project.projectName || '–')}</strong>, Material: <strong>${esc(project.materialType || '–')}</strong></li>
                    <li>Profil: ${profile.points.length} Punkte, Abwicklung <strong>${Math.round(unfold.front)} mm</strong></li>
                    <li>Stückliste: ${items.length} Positionen, ${pieces} Stück</li>
                </ul>
                <label for="bsp-notes"><strong>Notizen zum Projekt</strong> (werden mit der Datei gespeichert und im PDF ausgegeben)</label>
                <textarea id="bsp-notes" rows="6" style="width:100%;box-sizing:border-box;margin-top:6px;padding:8px;font-size:1rem">${esc(notes)}</textarea>
                <label style="display:flex;gap:8px;align-items:center;margin-top:12px">
                    <input type="checkbox" id="bsp-bbox" ${api.settings.get('showBox', true) ? 'checked' : ''} style="width:20px;height:20px">
                    Hüllmasse (Breite × Höhe) im Profil-Editor zeigen
                </label>`;

            tab.container.querySelector('#bsp-notes').addEventListener('input', (e) => {
                api.data.set({ notes: e.target.value });
            });
            tab.container.querySelector('#bsp-bbox').addEventListener('change', (e) => {
                api.settings.set('showBox', e.target.checked);
                api.canvas.redraw();
            });
        };

        // Tab aktuell halten, wenn sich das Dokument ändert (nur wenn sichtbar)
        const refresh = () => { if (api.ui.currentTab() === tab.key) render(); };
        api.on('document:loaded', refresh);
        api.on('document:new', refresh);

        // --- Menü-Eintrag: Stückliste als CSV --------------------------------
        api.ui.addAction({
            id: 'csv',
            label: 'Stückliste als CSV',
            title: 'Positionen mit Länge, Stückzahl und Anmerkung als CSV-Datei (Excel)',
            onClick: async () => {
                const items = api.cutlist.get();
                if (items.length === 0) {
                    api.ui.toast('Die Stückliste ist leer.', 'warning');
                    return;
                }
                const rows = [['Pos.', 'Länge (m)', 'Stück', 'Steckbar', 'Anmerkung']];
                items.forEach((it, i) => rows.push([i + 1, it.length.toFixed(3), it.quantity, it.interlocking ? 'ja' : 'nein', it.note]));
                const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
                const name = `${api.project.get().projectNumber || 'stueckliste'}.csv`;
                await api.ui.saveFile(name, csv, 'text/csv');
            }
        });

        // --- Zeichnen im Editor: Hüllmasse -----------------------------------
        api.canvas.onDraw((ctx, { scale, points }) => {
            if (!api.settings.get('showBox', true) || points.length < 2) return;
            const xs = points.map(p => p.x), ys = points.map(p => p.y);
            const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
            // ctx steht in mm: Strichstärken durch scale teilen = feste Pixel
            ctx.strokeStyle = 'rgba(142, 68, 173, 0.6)';
            ctx.lineWidth = 1 / scale;
            ctx.setLineDash([6 / scale, 4 / scale]);
            ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(142, 68, 173, 0.9)';
            ctx.font = `${12 / scale}px sans-serif`;
            ctx.fillText(`${Math.round(maxX - minX)} × ${Math.round(maxY - minY)} mm`, minX, minY - 6 / scale);
        });

        // --- PDF: Notizen-Seite ----------------------------------------------
        api.pdf.addPages((pdf) => {
            const notes = ((api.data.get() || {}).notes || '').trim();
            if (!notes) return;                        // keine Notizen = keine Seite
            let y = pdf.newPage('Notizen');
            const lines = pdf.doc.splitTextToSize(notes, pdf.pageWidth - 2 * pdf.margin);
            pdf.doc.setFontSize(10);
            lines.forEach(line => {
                if (y > pdf.pageHeight - 20) y = pdf.newPage('Notizen (Fortsetzung)');
                pdf.doc.text(line, pdf.margin, y);
                y += 5;
            });
        });
    }
};
