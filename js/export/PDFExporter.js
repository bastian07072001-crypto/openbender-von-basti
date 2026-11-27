import { DXFExporter } from './DXFExporter.js';
import { Geometry } from '../utils/Geometry.js';
import { DimensionLayout } from '../utils/DimensionLayout.js';
import { fmtMm, fmtM, fmtLen, posFarbeRgb, posName, describeLanes, describeSections, describeSheetLanes, formatDate, coilsSummary, itemShapes, pieceKey, listGroups, ERP_FEATURES_ENABLED } from '../controllers/CuttingController.js';

// Muss zum gleichnamigen Wert in CanvasRenderer.js / Preview3DController.js
// passen, damit 2D-Editor, 3D-Vorschau und PDF-Export den Umschlag konsistent
// darstellen.
const HEM_FOLD_OFFSET_MM = 2.5;

// Realistischer minimaler Biegeradius (mm) für eine Mittelrippe (zwei
// Schenkel, die sich beide gegenseitig als Vorgänger-Linie nehmen) – siehe
// CanvasRenderer.js. Muss zum gleichnamigen Wert dort passen.
const PEAK_ROUNDING_RADIUS_MM = 1.5;

export class PDFExporter {
    // cuttingData: CuttingController.getPdfData() – ergänzt eine Seite mit
    // der Zuschnittliste (abhakbare Formular-Checkboxen) und Quittierung.
    // moduleHost: Erweiterungsmodule hängen eigene Seiten an (api.pdf.addPages).
    // auswahl: Set der gewählten Zusatzinhalte ('zuschnitt:liste', 'zuschnitt:grafik' und
    // die Abschnitte der Module) oder null = alles; Profil und Stückliste sind immer dabei.
    // opts (mehrere Profile in einem PDF): { doc } = an ein bestehendes Dokument anhängen (neue Seite),
    // { offen: true } = noch nicht nummerieren und speichern (danach PDFExporter.abschliessen).
    static export(profile, canvas, cutlistData = [], projectHeader = {}, cuttingData = null, moduleHost = null, auswahl = null, opts = {}) {
        const gewaehlt = (key) => !auswahl || auswahl.has(key);
        if (!profile || !profile.points || profile.points.length < 2) {
            if (!opts.doc) alert('Das Profil ist noch leer oder unvollständig.');
            return;
        }

        const doc = opts.doc || this.neu();
        if (opts.doc) doc.addPage();

        const pageWidth = doc.internal.pageSize.getWidth();   // 210 mm
        const pageHeight = doc.internal.pageSize.getHeight(); // 297 mm
        const margin = 15;

        // --- 1. PROFIL-ABWICKLUNG BERECHNEN ---
        // Blechbedarf mit der Zuschnittbreite; beim konischen Profil die
        // grössere Abwicklung, Verschnitt separat ausgewiesen (siehe
        // Profile.getUnfoldLengths).
        const unfold = profile.getUnfoldLengths();
        const conical = !!profile.conical;

        // --- 2. BLATTKOPF & PROJEKTDATEN ---
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(44, 62, 80);
        doc.text('Produktionsdatenblatt', margin, 18);

        const currentDate = new Date().toLocaleDateString('de-CH');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text(`Datum: ${currentDate}`, pageWidth - margin, 18, { align: 'right' });

        doc.setFillColor(248, 249, 250);
        doc.rect(margin, 22, pageWidth - (margin * 2), 34, 'F');
        doc.setDrawColor(220, 224, 230);
        doc.rect(margin, 22, pageWidth - (margin * 2), 34, 'S');

        const matSpecText = projectHeader.materialSpec ? ` (${projectHeader.materialSpec})` : '';
        const fullMaterial = `${projectHeader.materialType || '-'}${matSpecText}`;
        const thicknessText = projectHeader.materialThickness ? `${parseFloat(projectHeader.materialThickness).toFixed(2)} mm` : '-';

        doc.setFontSize(9);
        doc.setTextColor(50, 50, 50);

        // Spalte 1: Projektdaten
        doc.setFont('helvetica', 'bold');
        doc.text('Projekt-Nr.:', margin + 4, 28);
        doc.text('Projekt-Name:', margin + 4, 34);
        doc.text('Blechprofil:', margin + 4, 40);
        doc.text('Zeichner:', margin + 4, 46);

        doc.setFont('helvetica', 'normal');
        doc.text(`${projectHeader.projectNumber || '-'}`, margin + 32, 28);
        doc.text(`${projectHeader.projectName || '-'}`, margin + 32, 34);
        doc.text(`${projectHeader.profileName || '-'}`, margin + 32, 40);
        doc.text(`${projectHeader.projectAuthor || '-'}`, margin + 32, 46);

        // Spalte 2: Material
        const col2X = margin + 100;
        doc.setFont('helvetica', 'bold');
        doc.text('Material:', col2X, 28);
        doc.text('Materialstärke:', col2X, 34);
        doc.text('Farbe / Beschichtung:', col2X, 40);
        doc.text(conical ? 'Abwicklung vorne:' : 'Abwicklung:', col2X, 46);
        if (conical) doc.text('Abwicklung hinten:', col2X, 52);

        doc.setFont('helvetica', 'normal');
        doc.text(`${fullMaterial}`, col2X + 38, 28);
        doc.text(`${thicknessText}`, col2X + 38, 34);
        doc.text(`${projectHeader.materialColor || '-'}`, col2X + 38, 40);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(41, 128, 185);
        doc.text(`${Math.round(unfold.front)} mm`, col2X + 38, 46);
        if (conical) doc.text(`${Math.round(unfold.back)} mm`, col2X + 38, 52);


        // --- 3. VEKTOR-PROFIL SKIZZE ZEICHNEN ---
        // Konisches Profil: zwei vollständig bemasste Skizzen (vorne/hinten)
        // im gleichen Massstab, damit der Grössenunterschied sichtbar bleibt.
        const sketchBounds = {
            x: margin,
            y: 60,
            width: pageWidth - (margin * 2), // 180 mm
            height: 85                       // 85 mm Höhe
        };

        let sketchBottom;
        if (conical) {
            sketchBottom = this.drawConicalSketches(doc, profile, sketchBounds);
        } else {
            this.drawVectorProfile(doc, profile, sketchBounds);
            sketchBottom = sketchBounds.y + sketchBounds.height;
        }


        // --- 4. ZUSCHNITTLISTE & BERECHNUNGEN ---
        const startYTable = sketchBottom + 8;

        // Ohne Stückliste: keine Tabelle und kein Materialbedarf (keine Scheinzeile)
        const mitListe = cutlistData.length > 0;
        if (mitListe) {
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(44, 62, 80);
            doc.text('Zuschnittliste', margin, startYTable - 4);
        }

        let totalMaterialMeters = 0;
        let totalSquareMeters = 0;
        let totalWasteSquareMeters = 0;

        const tableBody = cutlistData.map((item, index) => {
            const pos = index + 1;
            let lengthM = parseFloat(item.length) || 0;

            if (lengthM > 50) {
                lengthM = lengthM / 1000;
            }

            const quantity = parseInt(item.quantity) || 1;
            const interlocking = item.interlocking ? 'Ja' : 'Nein';
            const note = item.note || '-';

            const itemLfm = lengthM * quantity;
            totalMaterialMeters += itemLfm;

            const itemSqM = (unfold.blank / 1000) * lengthM * quantity;
            totalSquareMeters += itemSqM;
            const itemWasteSqM = (unfold.waste / 1000) * lengthM * quantity;
            totalWasteSquareMeters += itemWasteSqM;

            const row = [
                pos.toString(),
                `${lengthM.toFixed(3)} m`, // 3 Stellen: millimetergenau
                `${quantity} Stk.`,
                interlocking,
                note,
                `${itemSqM.toFixed(2)} m²`
            ];
            if (conical) row.push(`${itemWasteSqM.toFixed(2)} m²`);
            return row;
        });


        const tableHead = ['Pos.', 'Zuschnittlänge', 'Stückzahl', 'Steckbar', 'Anmerkung', 'Blechbedarf (m²)'];
        const columnStyles = {
            0: { cellWidth: 12, halign: 'center' },
            1: { cellWidth: 32, halign: 'right' },
            2: { cellWidth: 22, halign: 'right' },
            3: { cellWidth: 20, halign: 'center' },
            4: { cellWidth: 'auto' },
            5: { cellWidth: 28, halign: 'right' }
        };
        if (conical) {
            tableHead.push('davon Verschnitt (m²)');
            columnStyles[6] = { cellWidth: 28, halign: 'right' };
        }

        if (mitListe) {
            doc.autoTable({
                startY: startYTable,
                head: [tableHead],
                          body: tableBody,
                          theme: 'grid',
                          headStyles: {
                              fillColor: [41, 128, 185],
                              textColor: [255, 255, 255],
                              fontStyle: 'bold'
                          },
                          styles: { fontSize: 9, cellPadding: 2.5 },
                          margin: { left: margin, right: margin },
                          columnStyles
            });


            // --- 5. ZUSAMMENFASSUNG ---
            let finalY = doc.lastAutoTable.finalY + 6;

            const summaryHeight = conical ? 20 : 14;
            if (finalY + summaryHeight + 6 > pageHeight - margin) {
                doc.addPage();
                finalY = margin;
            }

            doc.setFillColor(245, 247, 250);
            doc.rect(margin, finalY, pageWidth - (margin * 2), summaryHeight, 'F');
            doc.setDrawColor(220, 224, 230);
            doc.rect(margin, finalY, pageWidth - (margin * 2), summaryHeight, 'S');

            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(44, 62, 80);
            doc.text('Gesamter Materialbedarf:', margin + 5, finalY + 8.5);

            doc.setFont('helvetica', 'normal');
            doc.text(`${totalMaterialMeters.toFixed(2)} lfm (Laufmeter)   |   ${totalSquareMeters.toFixed(2)} m² (Quadratmeter)`, margin + 58, finalY + 8.5);
            if (conical) {
                doc.setFontSize(9);
                doc.setTextColor(100, 100, 100);
                doc.text(`davon Verschnitt (konisches Profil): ${totalWasteSquareMeters.toFixed(2)} m²`, margin + 58, finalY + 14.5);
            }
        }


        // --- 6. ZUSCHNITTLISTE (eigene Seite) ---
        const zuschnitt = { liste: gewaehlt('zuschnitt:liste'), grafik: gewaehlt('zuschnitt:grafik') };
        if (cuttingData && (zuschnitt.liste || zuschnitt.grafik)) {
            doc.addPage();
            this.drawCuttingPage(doc, cuttingData, projectHeader, margin, pageWidth, pageHeight, zuschnitt);
        }


        // --- 6b. SEITEN AUS MODULEN ---
        if (moduleHost) {
            moduleHost.addPdfPages({
                doc,
                margin,
                pageWidth,
                pageHeight,
                project: { ...projectHeader },
                profile: JSON.parse(JSON.stringify(profile.toData())),
                unfold: { ...unfold },
                cutlist: JSON.parse(JSON.stringify(cutlistData)),
                // Neue Seite mit Titel im Stil der App; Rückgabe: y unter dem Titel
                newPage: (title) => {
                    doc.addPage();
                    doc.setFontSize(16);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(44, 62, 80);
                    if (title) doc.text(String(title), margin, 18);
                    doc.setFontSize(9);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(100, 100, 100);
                    const projectLine = [projectHeader.projectNumber, projectHeader.projectName, projectHeader.profileName].filter(Boolean).join(' · ');
                    if (projectLine) doc.text(projectLine, pageWidth - margin, 18, { align: 'right' });
                    doc.setTextColor(50, 50, 50);
                    return 26;
                }
            }, auswahl);
        }


        if (opts.offen) return doc;
        this.abschliessen(doc, DXFExporter.fileName(projectHeader, '', new Date(), 'pdf'));
        return doc;
    }

    /** Leeres A4-Dokument */
    static neu() {
        const { jsPDF } = window.jspdf;
        return new jsPDF('p', 'mm', 'a4');
    }

    /** Seitenzahlen auf alle Seiten, dann speichern */
    // { alsBlob: true } = nicht speichern, sondern das PDF als Blob zurückgeben (z.B. Rüstauftrag)
    static abschliessen(doc, dateiname, { alsBlob = false } = {}) {
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 15;
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(150, 150, 150);
            doc.text(`Seite ${i} von ${pageCount}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
            doc.text('Erstellt mit openBender', margin, pageHeight - 8);
        }
        if (alsBlob) return doc.output('blob');
        doc.save(dateiname);
    }

    /**
     * Projektübersicht (erste Seite, wenn alle Profile ausgegeben werden).
     * zeilen: [{ name, material, abw: { front, back, conical }, positionen, stueck, lfm }]
     */
    static projektSeite(doc, project, zeilen) {
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 15;
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(44, 62, 80);
        doc.text('Projektübersicht', margin, 18);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text(`Datum: ${new Date().toLocaleDateString('de-CH')}`, pageWidth - margin, 18, { align: 'right' });

        doc.setFillColor(248, 249, 250);
        doc.setDrawColor(220, 224, 230);
        doc.rect(margin, 22, pageWidth - margin * 2, 22, 'FD');
        doc.setFontSize(9);
        doc.setTextColor(50, 50, 50);
        [['Projekt-Nr.:', project.projectNumber], ['Projekt-Name:', project.projectName], ['Zeichner:', project.projectAuthor]].forEach(([l, v], i) => {
            doc.setFont('helvetica', 'bold');
            doc.text(l, margin + 4, 28 + i * 6);
            doc.setFont('helvetica', 'normal');
            doc.text(String(v || '-'), margin + 32, 28 + i * 6);
        });

        const qm = (z) => (z.abw.conical ? Math.max(z.abw.front, z.abw.back) : z.abw.front) / 1000 * z.lfm;
        const summe = zeilen.reduce((a, z) => ({ stueck: a.stueck + z.stueck, lfm: a.lfm + z.lfm, qm: a.qm + qm(z) }), { stueck: 0, lfm: 0, qm: 0 });
        doc.autoTable({
            startY: 50,
            head: [['Nr.', 'Blechprofil', 'Material', 'Abwicklung', 'Pos.', 'Stück', 'Laufmeter', 'Blechbedarf']],
            body: zeilen.map((z, i) => [
                String(z.nr || i + 1), z.name, z.material || '-',
                z.abw.conical ? `${Math.round(z.abw.front)} / ${Math.round(z.abw.back)} mm` : `${Math.round(z.abw.front)} mm`,
                String(z.positionen), String(z.stueck), `${z.lfm.toFixed(2)} m`, `${qm(z).toFixed(2)} m²`
            ]),
            foot: [['', 'Total', '', '', '', String(summe.stueck), `${summe.lfm.toFixed(2)} m`, `${summe.qm.toFixed(2)} m²`]],
            theme: 'grid',
            headStyles: { fillColor: [41, 128, 185], textColor: [255, 255, 255], fontStyle: 'bold' },
            footStyles: { fillColor: [245, 247, 250], textColor: [44, 62, 80], fontStyle: 'bold' },
            styles: { fontSize: 9, cellPadding: 2.5 },
            margin: { left: margin, right: margin },
            columnStyles: { 0: { cellWidth: 11, halign: 'center' }, 3: { halign: 'right' }, 4: { cellWidth: 12, halign: 'right' }, 5: { cellWidth: 15, halign: 'right' }, 6: { cellWidth: 24, halign: 'right' }, 7: { cellWidth: 26, halign: 'right' } }
        });
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text('Blechbedarf = Abwicklung × Laufmeter (konisch: grössere Abwicklung). Es folgt je Profil das Produktionsdatenblatt.', margin, doc.lastAutoTable.finalY + 6);
    }

    /**
     * Zuschnitt-Seite: gewählte Rolle, Zuschnitt-Grafik, Zuschnittliste mit
     * interaktiven Checkboxen (PDF-Formularfelder, im Ausdruck leere Kästchen
     * zum Abhaken) und Quittierung (Name/Datum, ebenfalls als Formularfelder).
     */
    static drawCuttingPage(doc, cutting, projectHeader, margin, pageWidth, pageHeight, teile = { liste: true, grafik: true }) {
        const { result, rows, checked, signoff, signoffOutdated, dispose } = cutting;
        const coil = result.selected;
        const plan = coil.plan;
        const contentW = pageWidth - margin * 2;

        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(44, 62, 80);
        doc.text(teile.liste ? 'Zuschnittliste' : 'Zuschnitt-Plan', margin, 18);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        // gemeinsamer Zuschnitt mehrerer Profile: statt des Profilnamens die beteiligten Profile
        const wer = result.gemeinsam
            ? `Profile ${result.members.map(m => `${m.prof} ${m.name}`).join(', ')}`
            : projectHeader.profileName;
        const projectLine = doc.splitTextToSize([projectHeader.projectNumber, projectHeader.projectName, wer].filter(Boolean).join(' · '), pageWidth - margin * 2 - 60)[0];
        if (projectLine) doc.text(projectLine, pageWidth - margin, 18, { align: 'right' });

        // Rollen- bzw. Tafel-Angaben
        doc.setFillColor(248, 249, 250);
        doc.setDrawColor(220, 224, 230);
        doc.rect(margin, 22, contentW, 36, 'FD');
        const wasteLine = `${plan.wastePct.toFixed(1)} % (${(plan.waste / 1e6).toFixed(2)} m²)${ERP_FEATURES_ENABLED ? ` · Abschnitte entsorgen: ${dispose ? 'Ja' : 'Nein'}` : ''}`;
        const info = result.sheet ? [
            ['Tafel:', `${result.sort ? result.sort.name : '-'}, ${coil.width} × ${coil.length} × ${coil.thickness} mm`],
            ['Bedarf:', `${plan.sheetCount} ${plan.sheetCount === 1 ? 'Tafel' : 'Tafeln'} (${plan.kg.toFixed(1)} kg, ${coil.kgPerM2.toFixed(2)} kg/m²)`],
            ['Streifen:', `${describeSheetLanes(plan, result.itemsInfo).replace(/→/g, '->')}${plan.restStrip > 0.5 ? `, Reststreifen ${fmtMm(plan.restStrip)}` : ''}`],
            ['Verschnitt:', wasteLine]
        ] : [
            ['Rolle:', `${result.sort ? result.sort.name : '-'}, ${fmtMm(coil.width)} × ${coil.thickness} mm`],
            ['Rollenlänge:', `${fmtM(plan.coilLength)} (${plan.kg.toFixed(1)} kg, ${coil.kgPerM2.toFixed(2)} kg/m²)`],
            ['Rollen:', coilsSummary(coil.coils)],
            ['Ablängen:', describeSections(plan)],
            ['Aufspalten:', `${describeLanes(plan, result.itemsInfo).replace(/→/g, '->')}${plan.restStrip > 0.5 ? `, Reststreifen ${fmtMm(plan.restStrip)}` : ''}`],
            ['Verschnitt:', wasteLine]
        ];
        doc.setFontSize(9);
        doc.setTextColor(50, 50, 50);
        const zeile = info.length > 5 ? 5.4 : 6.5;   // Rolle: 6 Zeilen im gleichen Kasten
        info.forEach(([label, value], i) => {
            doc.setFont('helvetica', 'bold');
            doc.text(label, margin + 4, 28.5 + i * zeile);
            doc.setFont('helvetica', 'normal');
            doc.text(value, margin + 32, 28.5 + i * zeile);
        });

        const polygon = (pts) => {
            const deltas = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
            doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], 'FD', true);
        };
        // Gleiche Umrisse und Farben je Position wie in der App (itemShapes, posFill); abgehakte Teile grün
        const { front, back } = result.itemsInfo;
        const drawLanes = (lanes, ox, oy, sx, sy) => {
            let laneY = 0;
            doc.setLineWidth(0.15);
            lanes.forEach(lane => {
                lane.items.forEach(item => {
                    itemShapes(item, laneY, front, back).forEach(({ piece, poly }) => {
                        const pts = poly.map(([x, y]) => [ox + x * sx, oy + y * sy]);
                        const done = !!checked[pieceKey(piece)];
                        const c = done ? [130, 224, 170] : posFarbeRgb(piece);
                        doc.setFillColor(c[0], c[1], c[2]);
                        doc.setDrawColor(44, 62, 80);
                        polygon(pts);
                        const x0 = pts[0][0], x1 = pts[1][0];
                        const h = Math.min(Math.abs(pts[3][1] - pts[0][1]), Math.abs(pts[2][1] - pts[1][1]));
                        if (x1 - x0 > 14 && h > 3.5) {
                            doc.setFontSize(6);
                            doc.setTextColor(44, 62, 80);
                            const cy = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
                            doc.text(`Pos. ${posName(piece)}`, (x0 + x1) / 2, cy + 1, { align: 'center' });
                        }
                    });
                });
                laneY += lane.width;
            });
        };

        const gx = margin, gy = 64, gw = contentW;
        let graphicBottom = 58;
        if (!teile.grafik) {
            // ohne Grafik: Liste direkt unter den Angaben
        } else if (result.sheet) {
            // Tafeln massstäblich nebeneinander (höchstens 4 pro Reihe, Reihen
            // bis ca. 110 mm Höhe, sonst kleiner)
            const n = plan.sheets.length;
            const cols = Math.min(n, 4);
            const rowsCount = Math.ceil(n / cols);
            const gap = 5, labelH = 4;
            let scale = (gw - (cols - 1) * gap) / (cols * plan.along);
            scale = Math.min(scale, (110 - rowsCount * (labelH + gap)) / (rowsCount * plan.across), 45 / plan.across);
            const sw = plan.along * scale, sh = plan.across * scale;
            plan.sheets.forEach((sheet, i) => {
                const ox = gx + (i % cols) * (sw + gap);
                const oy = gy + labelH + Math.floor(i / cols) * (sh + labelH + gap);
                doc.setFontSize(7);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(44, 62, 80);
                doc.text(`Tafel ${i + 1}`, ox, oy - 1);
                doc.setFont('helvetica', 'normal');
                doc.setFillColor(225, 228, 232);
                doc.setDrawColor(127, 140, 141);
                doc.setLineWidth(0.3);
                doc.rect(ox, oy, sw, sh, 'FD');
                drawLanes(sheet.lanes, ox, oy, scale, scale);
            });
            graphicBottom = gy + rowsCount * (sh + labelH + gap) - gap;
            doc.setFontSize(7);
            doc.setTextColor(120, 120, 120);
            const dir = plan.orientation === 'quer' ? 'quer (Tafel hochkant gezeichnet)' : 'längs';
            doc.text(`Tafel ${coil.width} × ${coil.length} mm, Streifen ${dir} · grau: Verschnitt · grün: zugeschnitten · massstäblich`, gx, graphicBottom + 4);
        } else {
            // Rolle: Längs- und Querrichtung unterschiedlich skaliert
            const sx = gw / plan.coilLength;
            const gh = Math.max(22, Math.min(60, coil.width * sx));
            const sy = gh / coil.width;
            doc.setFillColor(225, 228, 232);
            doc.setDrawColor(127, 140, 141);
            doc.setLineWidth(0.3);
            doc.rect(gx, gy, gw, gh, 'FD');
            drawLanes(plan.lanes, gx, gy, sx, sy);
            // Querschnitte (Ablängen) über die ganze Breite
            doc.setDrawColor(36, 113, 163);
            doc.setLineWidth(0.6);
            (plan.sections || []).slice(1).forEach(sec => doc.line(gx + sec.start * sx, gy - 1.5, gx + sec.start * sx, gy + gh + 1.5));
            graphicBottom = gy + gh;
            doc.setFontSize(7);
            doc.setTextColor(120, 120, 120);
            doc.text(`Rollenlänge ${fmtM(plan.coilLength)} · Breite ${fmtMm(coil.width)} · blau: Querschnitte (zuerst ablängen) · grau: Verschnitt · grün: zugeschnitten · nicht massstäblich`, gx, graphicBottom + 4);
        }

        if (!teile.liste) return;

        // Zuschnittliste mit Formular-Checkboxen
        // "→" fehlt in den PDF-Standardschriften
        // eine Zeile pro Position (gleiche Länge und gleicher Zuschnitt), siehe listGroups
        const gruppen = listGroups(rows, result.sheet, checked);
        const body = gruppen.map(g => ['', `${g.pos}`, g.n === g.quantity ? String(g.n) : `${g.n} von ${g.quantity}`, g.ort.replace(/–/g, '-'), fmtLen(g.length), g.cut.replace(/→/g, '->')]);
        const checkFields = [];
        doc.autoTable({
            startY: graphicBottom + 9,
            head: [['Erledigt', 'Pos.', 'Stück', result.sheet ? 'Tafel/Str.' : 'Streifen', 'Länge', 'Zuschnitt']],
            body,
            theme: 'grid',
            headStyles: { fillColor: [41, 128, 185], textColor: [255, 255, 255], fontStyle: 'bold' },
            styles: { fontSize: 9, cellPadding: 2.2, minCellHeight: 8 },
            margin: { left: margin, right: margin },
            columnStyles: {
                0: { cellWidth: 18, halign: 'center' },
                1: { cellWidth: 14, halign: 'center' },
                2: { cellWidth: 16, halign: 'center' },
                3: { cellWidth: 34, halign: 'center' },
                4: { cellWidth: 22, halign: 'right' },
                5: { cellWidth: 'auto' }
            },
            didDrawCell: (data) => {
                if (data.section !== 'body' || data.column.index !== 0) return;
                const row = gruppen[data.row.index];
                const size = 4.5;
                checkFields.push({
                    key: row.keys[0],
                    done: row.done === row.n,
                    page: doc.internal.getCurrentPageInfo().pageNumber,
                    x: data.cell.x + (data.cell.width - size) / 2,
                    y: data.cell.y + (data.cell.height - size) / 2,
                    size
                });
            }
        });

        // Checkboxen nach der Tabelle setzen (auf der jeweiligen Seite)
        const lastPage = doc.internal.getCurrentPageInfo().pageNumber;
        checkFields.forEach(f => {
            doc.setPage(f.page);
            doc.setDrawColor(44, 62, 80);
            doc.setLineWidth(0.3);
            doc.rect(f.x, f.y, f.size, f.size, 'S');
            const box = new doc.AcroFormCheckBox();
            box.fieldName = `teil_${f.key}`;
            box.x = f.x;
            box.y = f.y;
            box.width = f.size;
            box.height = f.size;
            // jsPDF setzt Checkboxen standardmässig auf "an" – Zustand immer explizit
            const state = f.done ? 'On' : 'Off';
            box.appearanceState = state;
            box.value = state;
            doc.addField(box);
        });
        doc.setPage(lastPage);

        // Quittierung (erst mit der ERPNext-Einbindung)
        if (!ERP_FEATURES_ENABLED) return;
        let y = doc.lastAutoTable.finalY + 10;
        if (y + 26 > pageHeight - margin) {
            doc.addPage();
            y = margin + 5;
        }
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(44, 62, 80);
        doc.text('Quittierung', margin, y);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(50, 50, 50);

        const field = (name, label, x, width, value) => {
            doc.text(label, x, y + 9);
            const tf = new doc.AcroFormTextField();
            tf.fieldName = name;
            tf.x = x + 14;
            tf.y = y + 4.5;
            tf.width = width;
            tf.height = 7;
            tf.fontSize = 10;
            if (value) tf.value = value;
            doc.addField(tf);
            doc.setDrawColor(160, 160, 160);
            doc.line(x + 14, y + 11.5, x + 14 + width, y + 11.5);
        };
        field('quittung_name', 'Name:', margin, 80, signoff ? signoff.name : '');
        field('quittung_datum', 'Datum:', margin + 105, 45, signoff ? formatDate(signoff.date) : '');

        if (signoff && signoffOutdated) {
            doc.setTextColor(185, 119, 14);
            doc.text('Achtung: Der Zuschnitt wurde nach der Quittierung in openBender geändert.', margin, y + 19);
        }
    }

    static drawStraightSegment(doc, p1, p2, toPdfX, toPdfY) {
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.8);
        doc.line(toPdfX(p1.x), toPdfY(p1.y), toPdfX(p2.x), toPdfY(p2.y));
    }

    // Findet das jeweils andere Hem-Segment, wenn ein Umschlag-Segment seine
    // eigene Vorgänger-Linie ebenfalls als Umschlag vorfindet (Mittelrippe).
    static findMutualHemPartner(profile, seg) {
        const prevSeg = Geometry.getHemBaseSegment(profile.segments, seg);
        if (!prevSeg || prevSeg.type !== 'hem') return null;
        return prevSeg;
    }

    /**
     * Zeichnet eine Mittelrippen-Spitze mit kleiner Rundung statt scharfer
     * Ecke (siehe Geometry.computeRoundedCorner / CanvasRenderer.drawRoundedPeak).
     */
    static drawRoundedPeakPdf(doc, p1, vertex, p2, toPdfX, toPdfY) {
        const corner = Geometry.computeRoundedCorner(p1, vertex, p2, PEAK_ROUNDING_RADIUS_MM);

        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.8);

        let lastX = toPdfX(p1.x);
        let lastY = toPdfY(p1.y);

        const pathPoints = [corner.start, ...corner.points, p2];
        pathPoints.forEach(pt => {
            const px = toPdfX(pt.x);
            const py = toPdfY(pt.y);
            doc.line(lastX, lastY, px, py);
            lastX = px;
            lastY = py;
        });
    }

    static drawDimensionsPdf(doc, profile, scale, toPdfX, toPdfY) {
        const FONT_SIZE = 8;
        const paper = (mm) => mm / scale;

        doc.setFontSize(FONT_SIZE);
        doc.setFont('helvetica', 'bold');

        const layout = DimensionLayout.compute(profile.points, profile.segments || [], {
            textHeight: paper(FONT_SIZE * 0.3528),
            measure: (text) => paper(doc.getTextWidth(text)),
            decorate: (text) => text,
            dimOffset: paper(4),
            offsetStep: paper(4.5),
            maxOffsetSteps: 3,
            extGap: paper(0.8),
            extOverhang: paper(1),
            arrowSize: paper(1.4),
            textGap: paper(0.8),
            arcRadius: () => paper(4.5),
            squareSize: paper(2.2),
            pointRadius: paper(0.8),
            foldOffset: HEM_FOLD_OFFSET_MM
        });

        const LENGTH_COLOR = [0, 125, 0];
        const ANGLE_COLOR = [211, 84, 0];

        const polyline = (pts, color) => {
            doc.setDrawColor(color[0], color[1], color[2]);
            doc.setLineWidth(0.2);
            for (let i = 1; i < pts.length; i++) {
                doc.line(toPdfX(pts[i - 1].x), toPdfY(pts[i - 1].y), toPdfX(pts[i].x), toPdfY(pts[i].y));
            }
        };

        const arrow = (tip, dir, color) => {
            const size = 1.4; // Papier-mm
            const tx = toPdfX(tip.x), ty = toPdfY(tip.y);
            const bx = tx - dir.x * size, by = ty - dir.y * size;
            const px = -dir.y * size * 0.35, py = dir.x * size * 0.35;
            doc.setFillColor(color[0], color[1], color[2]);
            doc.triangle(tx, ty, bx + px, by + py, bx - px, by - py, 'F');
        };

        layout.lengths.forEach(dim => {
            dim.lines.forEach(line => polyline(line, LENGTH_COLOR));
            dim.arrows.forEach(a => arrow(a.tip, a.dir, LENGTH_COLOR));
        });

        layout.angles.forEach(angle => {
            if (angle.arc) polyline(angle.arc, ANGLE_COLOR);
            if (angle.square) polyline(angle.square, ANGLE_COLOR);
            if (angle.leader) polyline(angle.leader, ANGLE_COLOR);
        });

        doc.setFontSize(FONT_SIZE);
        doc.setFont('helvetica', 'bold');
        layout.labels.forEach(label => {
            if (label.hitOnly) return;
            const color = label.type === 'angle' ? ANGLE_COLOR : LENGTH_COLOR;
            doc.setTextColor(color[0], color[1], color[2]);
            doc.text(label.text, toPdfX(label.x), toPdfY(label.y), { align: 'center', baseline: 'middle' });
        });
    }

    static extent(points) {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        points.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });
        return { minX, maxX, minY, maxY, width: maxX - minX || 1, height: maxY - minY || 1 };
    }

    // Grösster Massstab, bei dem jedes der Profile in einen Rahmen der
    // Grösse width × height passt.
    static fitScale(pointLists, width, height, padding) {
        return Math.min(...pointLists.map(points => {
            const e = this.extent(points);
            return Math.min((width - padding * 2) / e.width, (height - padding * 2) / e.height);
        }));
    }

    /**
     * Konisches Profil: vorne und hinten als zwei Skizzen im gleichen
     * Massstab. Nebeneinander oder untereinander – je nachdem, was die
     * grössere Darstellung ergibt. Gibt die Unterkante der Skizzen zurück.
     */
    static drawConicalSketches(doc, profile, area) {
        const padding = 16;
        const gap = 6;
        const front = { points: profile.points, segments: profile.segments || [] };
        const back = { points: profile.computeBackGeometry().points, segments: profile.segments || [] };
        const lists = [front.points, back.points];

        const sideW = (area.width - gap) / 2;
        const sideH = area.height;
        const stackW = area.width;
        const stackH = 70;

        const sideScale = this.fitScale(lists, sideW, sideH, padding);
        const stackScale = this.fitScale(lists, stackW, stackH, padding);

        let boxes;
        let scale;
        if (stackScale > sideScale) {
            scale = stackScale;
            boxes = [
                { x: area.x, y: area.y, width: stackW, height: stackH },
                { x: area.x, y: area.y + stackH + gap, width: stackW, height: stackH }
            ];
        } else {
            scale = sideScale;
            boxes = [
                { x: area.x, y: area.y, width: sideW, height: sideH },
                { x: area.x + sideW + gap, y: area.y, width: sideW, height: sideH }
            ];
        }

        this.drawVectorProfile(doc, front, boxes[0], { scale, padding, title: 'Profil vorne', titleColor: [44, 62, 80] });
        this.drawVectorProfile(doc, back, boxes[1], { scale, padding, title: 'Profil hinten', titleColor: [192, 57, 43] });

        return boxes[1].y + boxes[1].height;
    }

    /**
     * Zeichnet das Profil nativ als Vektorgrafik inkl. korrekter Bemaßung mit Einheit & Winkeln.
     * profile braucht nur points und segments (beim konischen Profil auch
     * für das hintere Ende verwendet). opts: scale (fester Massstab),
     * padding, title + titleColor (Überschrift oben links im Rahmen).
     */
    static drawVectorProfile(doc, profile, bounds, opts = {}) {
        if (!profile.points || profile.points.length < 2) return;

        // 1. Zeichenrahmen / Hintergrund
        doc.setFillColor(252, 253, 254);
        doc.rect(bounds.x, bounds.y, bounds.width, bounds.height, 'F');
        doc.setDrawColor(220, 224, 230);
        doc.rect(bounds.x, bounds.y, bounds.width, bounds.height, 'S');

        if (opts.title) {
            const c = opts.titleColor || [44, 62, 80];
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(c[0], c[1], c[2]);
            doc.text(opts.title, bounds.x + 3, bounds.y + 5);
        }

        // 2. Bounding Box berechnen
        const { minX, minY, width: profileWidth, height: profileHeight } = this.extent(profile.points);

            const padding = opts.padding ?? 20; // mm Abstand
            const availWidth = bounds.width - (padding * 2);
            const availHeight = bounds.height - (padding * 2);

            const scale = opts.scale ?? Math.min(availWidth / profileWidth, availHeight / profileHeight);

            const drawnWidth = profileWidth * scale;
            const drawnHeight = profileHeight * scale;
            const offsetX = bounds.x + padding + (availWidth - drawnWidth) / 2;
            const offsetY = bounds.y + padding + (availHeight - drawnHeight) / 2;

            const toPdfX = (x) => offsetX + (x - minX) * scale;
            const toPdfY = (y) => offsetY + (y - minY) * scale;

            // 3. Segmente
            // Umschläge: gleiche Endpunkte + Kappen wie 2D/DXF/3D (siehe
            // Geometry.computeFoldLayout) – jedes Segment genau einmal.
            const foldLayout = Geometry.computeFoldLayout(profile.points, profile.segments || [], HEM_FOLD_OFFSET_MM);
            const drawPolyline = (pts) => {
                doc.setDrawColor(0, 0, 0);
                doc.setLineWidth(0.8);
                for (let i = 1; i < pts.length; i++) {
                    doc.line(toPdfX(pts[i - 1].x), toPdfY(pts[i - 1].y), toPdfX(pts[i].x), toPdfY(pts[i].y));
                }
            };
            foldLayout.folds.forEach(fold => drawPolyline(fold.cap));

            if (profile.segments) {
                profile.segments.forEach((seg, segIndex) => {
                    const p1 = profile.points[seg.startIndex];
                    const p2 = profile.points[seg.endIndex];

                    if (p1 && p2) {
                        // Umschlag/Saum schematisch (parallel + Kappe) zeichnen,
                        // normale Linien wie gehabt gerade. Mittelrippe
                        // (Vorgänger-Linie ist selbst ein Umschlag): kleine
                        // Rundung statt scharfer Spitze, nur einmal pro
                        // Scheitelpunkt gezeichnet.
                        // Kein Index-Vergleich nötig: findPredecessorSegment()
                        // ordnet jedem Segment höchstens einen Vorgänger zu,
                        // nie einen Kreis – dieser Zweig wird pro Paar also
                        // immer nur von der "Kind"-Seite (seg) aus betreten
                        // (siehe gleichnamiger Kommentar in CanvasRenderer.js).
                        const mutualPartner = seg.type === 'hem' ? this.findMutualHemPartner(profile, seg) : null;

                        const vertexPt = seg.type === 'hem' ? profile.points[seg.hemVertexIndex] : null;
                        const tipPt = seg.type === 'hem' ? profile.points[seg.hemTipIndex] : null;

                        if (mutualPartner && vertexPt && tipPt) {
                            const vertexIndex = seg.hemVertexIndex;
                            const farIndex = (mutualPartner.startIndex === vertexIndex) ? mutualPartner.endIndex : mutualPartner.startIndex;
                            const farPoint = profile.points[farIndex];
                            if (farPoint) {
                                this.drawRoundedPeakPdf(doc, farPoint, vertexPt, tipPt, toPdfX, toPdfY);
                            }
                        } else {
                            const a = Geometry.foldEndpoint(foldLayout, segIndex, seg.startIndex, profile.points);
                            const b = Geometry.foldEndpoint(foldLayout, segIndex, seg.endIndex, profile.points);
                            this.drawStraightSegment(doc, a, b, toPdfX, toPdfY);
                        }
                    }
                });
            }

            // 4. Punkte
            profile.points.forEach(p => {
                doc.setFillColor(41, 128, 185);
                doc.setDrawColor(255, 255, 255);
                doc.setLineWidth(0.3);
                doc.circle(toPdfX(p.x), toPdfY(p.y), 0.8, 'FD');
            });

            // 5. Bemaßung: gleiche Platzierung wie im 2D-Editor (siehe
            // DimensionLayout), Größen hier in Papier-mm, umgerechnet in
            // Profil-mm (÷ scale).
            this.drawDimensionsPdf(doc, profile, scale, toPdfX, toPdfY);
    }
}
