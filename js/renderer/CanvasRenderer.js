import { globalEventBus } from '../utils/EventBus.js';
import { Geometry } from '../utils/Geometry.js';
import { DimensionLayout } from '../utils/DimensionLayout.js';

// Seitlicher Versatz (mm) für die schematische Umschlag-Darstellung: Ein
// Umschlag/Saum (siehe HEM_OPEN_ANGLE_THRESHOLD_DEG in Profile.js) wird nicht
// mit seinem tatsächlichen, oft nur wenige Grad abweichenden Winkel
// gezeichnet, sondern vereinfacht parallel zur Vorgänger-Linie versetzt
// dargestellt – das entspricht der üblichen Darstellung eines Saums in der
// Abwicklung und bleibt auch bei sehr spitzen Winkeln sauber lesbar.
const HEM_FOLD_OFFSET_MM = 2.5;

// Realistischer minimaler Biegeradius (mm) für Ecken, die rechnerisch fast
// spitz aufeinandertreffen, aber kein Umschlag/Saum sind (z.B. eine
// Mittelrippe: zwei Schenkel, die sich beide gegenseitig als Vorgänger-Linie
// nehmen). Eine Biegemaschine kann keinen mathematisch scharfen Punkt
// erzeugen – daher wird dort eine kleine Rundung gezeichnet statt einer Spitze.
const PEAK_ROUNDING_RADIUS_MM = 1.5;

// Schriftgröße (Welt-mm) für Maß- und Winkel-Beschriftungen. Wird sowohl beim
// Zeichnen als auch beim Vermessen für die Platzierung (siehe
// DimensionLayout) verwendet – muss daher an einer Stelle stehen.
const LABEL_FONT_SIZE = 6.5;

// Konisches Profil: Linienfarben für vorderes und hinteres Profilende. Das
// gerade nicht bearbeitete Ende wird blass im Hintergrund gezeichnet.
const FRONT_PROFILE_COLOR = '#2c3e50';
const BACK_PROFILE_COLOR = '#c0392b';
const GHOST_PROFILE_ALPHA = 0.3;

export class CanvasRenderer {
    constructor(canvas, profile, view, drawingController, selectionController) {
        this.canvas = canvas;
        this.profile = profile;
        this.view = view;
        this.drawingController = drawingController;
        this.selectionController = selectionController;

        this.showDimensions = true; // Standardmäßig Maße & Winkel anzeigen
        this.lastLabels = []; // Zuletzt gezeichnete Label-Positionen für Hit-Testing (siehe LabelEditController)
        // Zusätzliches Zeichnen durch Module (ModuleHost.drawOverlays), in mm
        this.overlayDrawer = null;
        this.initBusEvents();
    }

    // Leistung: mehrere Änderungen innerhalb eines Bildschirmbilds (z.B.
    // profile:updated + selection:changed bei einer Mausbewegung) führen zu
    // genau einem Neuzeichnen im nächsten Frame.
    initBusEvents() {
        globalEventBus.on('profile:updated', () => this.requestRender());
        globalEventBus.on('view:changed', () => this.requestRender());
        globalEventBus.on('selection:changed', () => this.requestRender());
    }

    requestRender() {
        if (this.renderScheduled) return;
        this.renderScheduled = true;
        requestAnimationFrame(() => {
            this.renderScheduled = false;
            this.render();
        });
    }

    setShowDimensions(show) {
        this.showDimensions = show;
        this.render();
    }

    render() {
        if (!this.canvas) return;
        const ctx = this.canvas.getContext('2d');

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.restore();

        ctx.save();
        ctx.translate(this.view.offsetX, this.view.offsetY);
        ctx.scale(this.view.scale, this.view.scale);

        // 1. Gitter
        this.drawGrid(ctx);

        // 2. Fest gezeichnete Segmente. Beim konischen Profil zuerst das
        //    nicht bearbeitete Ende blass im Hintergrund.
        const editingBack = this.profile.isEditingBack();
        const activePoints = this.profile.getActivePoints();
        let ghostPoints = null;
        if (this.profile.conical) {
            ghostPoints = editingBack ? this.profile.points : this.profile.computeBackGeometry().points;
            this.drawSegments(ctx, ghostPoints, editingBack ? FRONT_PROFILE_COLOR : BACK_PROFILE_COLOR, true);
        }
        this.drawSegments(ctx, activePoints, editingBack ? BACK_PROFILE_COLOR : FRONT_PROFILE_COLOR);

        // 3. PUNKTE & NUMMERIERUNGEN ZUERST ZEICHNEN (Landet im Hintergrund)
        this.drawPoints(ctx, activePoints);

        // 4. Temporäres Vorschau-Segment
        if (this.drawingController && this.drawingController.tempPoint && this.profile.points.length > 0) {
            let activeIndex = -1;
            if (this.selectionController && this.selectionController.selectedType === 'point') {
                activeIndex = this.selectionController.selectedIndex;
            } else if (typeof this.drawingController.activePointIndex === 'number' && this.drawingController.activePointIndex >= 0) {
                activeIndex = this.drawingController.activePointIndex;
            } else {
                activeIndex = this.profile.points.length - 1;
            }

            const startPoint = this.profile.points[activeIndex];
            const tempPoint = this.drawingController.tempPoint;
            if (startPoint) {
                this.drawPreviewSegment(ctx, startPoint, tempPoint, activeIndex);
            }
        }

        // 5. MAßE & WINKEL ZUM SCHLUSS ZEICHNEN (Liegen jetzt über den Punktnummern)
        if (this.showDimensions) {
            // Hit-Testing beim Anklicken eines Labels (siehe
            // LabelEditController) nutzt die hier platzierten Labels, in
            // Weltkoordinaten wie EventHandler.getWorldPos().
            this.lastLabels = this.drawDimensions(ctx, activePoints, ghostPoints);
        } else {
            this.lastLabels = [];
        }

        // 6. Erweiterungen von Modulen (api.canvas.onDraw), in Profil-mm
        if (this.overlayDrawer) {
            this.overlayDrawer(ctx, {
                scale: this.view.scale,
                points: activePoints.map(p => ({ x: p.x, y: p.y })),
                segments: this.profile.segments.map(s => ({ startIndex: s.startIndex, endIndex: s.endIndex, type: s.type })),
                conical: this.profile.conical,
                side: editingBack ? 'back' : 'front'
            });
        }

        // Maßstab unten links auf das Canvas zeichnen
        this.drawScaleBar();

        ctx.restore();
    }

    // --- SEGMENTE ZEICHNEN ---
    // Umschläge: Geometry.computeFoldLayout liefert für jedes beteiligte
    // Segment die (ggf. durch den Falz verschobenen) Endpunkte plus die runde
    // Kappe. Jedes Segment wird genau einmal als Linie gezeichnet – gleiche
    // Geometrie wie PDF, DXF und 3D, Kontur immer lückenlos.
    // ghost = blasses Hintergrund-Profil (anderes Profilende beim konischen
    // Profil): dünner, ohne Auswahl-Hervorhebung.
    drawSegments(ctx, points = this.profile.points, color = FRONT_PROFILE_COLOR, ghost = false) {
        if (!this.profile || !this.profile.segments) return;

        const segments = this.profile.segments;
        const layout = Geometry.computeFoldLayout(points, segments, HEM_FOLD_OFFSET_MM);
        const isSegSelected = (index) => !ghost && !!(this.selectionController &&
            this.selectionController.selectedType === 'segment' &&
            this.selectionController.selectedIndex === index);

        // Sonderfall Mittelrippe / Umschlag-auf-Umschlag: Die Basis eines
        // Umschlags ist selbst ein Umschlag. Hier ergibt die schematische
        // Falz-Darstellung keinen Sinn, beide Schenkel werden mit einer
        // kleinen realistischen Rundung verbunden. Da
        // Geometry.findPredecessorSegment() nie einen Kreis erzeugt, wird
        // jedes Paar nur einmal (von der "Kind"-Seite) behandelt.
        const peakConsumed = new Set();
        const roundedPeaks = [];

        segments.forEach((seg, index) => {
            if (seg.type !== 'hem') return;
            const prevSeg = Geometry.getHemBaseSegment(segments, seg);
            if (!prevSeg || prevSeg.type !== 'hem') return;

            const prevIndex = segments.indexOf(prevSeg);
            const vertexIndex = seg.hemVertexIndex;
            const p1 = points[prevSeg.endIndex === vertexIndex ? prevSeg.startIndex : prevSeg.endIndex];
            const vertex = points[vertexIndex];
            const p2 = points[seg.hemTipIndex];

            if (p1 && vertex && p2) {
                roundedPeaks.push({ p1, vertex, p2, isSelected: isSegSelected(index) || isSegSelected(prevIndex) });
            }
            peakConsumed.add(index);
            peakConsumed.add(prevIndex);
        });

        const strokePath = (pts, isSelected) => {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            if (ghost) ctx.globalAlpha = GHOST_PROFILE_ALPHA;
            ctx.strokeStyle = isSelected ? '#e67e22' : color;
            ctx.lineWidth = (isSelected ? 4 : (ghost ? 2 : 3)) / this.view.scale;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
            ctx.restore();
        };

        segments.forEach((seg, index) => {
            if (peakConsumed.has(index) && !layout.hemIndices.has(index)) return;

            const p1 = Geometry.foldEndpoint(layout, index, seg.startIndex, points);
            const p2 = Geometry.foldEndpoint(layout, index, seg.endIndex, points);
            if (!p1 || !p2) return;

            strokePath([p1, p2], isSegSelected(index));
        });

        layout.folds.forEach(fold => strokePath(fold.cap, isSegSelected(fold.segIndex)));

        roundedPeaks.forEach(peak => this.drawRoundedPeak(ctx, peak, color, ghost));
    }

    // --- MITTELRIPPE: KLEINE RUNDUNG STATT SCHARFER SPITZE ---
    // Zwei Schenkel, die sich beide gegenseitig als Vorgänger-Linie nehmen
    // (z.B. eine Mittelrippe), treffen rechnerisch sehr spitz aufeinander.
    // Eine Biegemaschine kann das nicht als mathematisch scharfen Punkt
    // fertigen – daher wird hier ein kleiner, realistischer Biegeradius
    // gezeichnet (siehe Geometry.computeRoundedCorner).
    drawRoundedPeak(ctx, { p1, vertex, p2, isSelected }, color = FRONT_PROFILE_COLOR, ghost = false) {
        const corner = Geometry.computeRoundedCorner(p1, vertex, p2, PEAK_ROUNDING_RADIUS_MM);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(corner.start.x, corner.start.y);
        corner.points.forEach(pt => ctx.lineTo(pt.x, pt.y));
        ctx.lineTo(p2.x, p2.y);

        if (ghost) ctx.globalAlpha = GHOST_PROFILE_ALPHA;
        ctx.strokeStyle = isSelected ? '#e67e22' : color;
        ctx.lineWidth = (isSelected ? 6 : (ghost ? 2 : 3)) / this.view.scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
    }

    // --- LIVE-VORSCHAU BEIM ZIEHEN (TEMP POINT) ---
    drawPreviewSegment(ctx, startPt, tempPt, activeIndex) {
        // Gestrichelte Vorschau-Linie
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(startPt.x, startPt.y);
        ctx.lineTo(tempPt.x, tempPt.y);
        ctx.strokeStyle = '#3498db';
        ctx.lineWidth = 2 / this.view.scale;
        ctx.setLineDash([6 / this.view.scale, 4 / this.view.scale]);
        ctx.stroke();
        ctx.restore();

        // Vorschau-Endpunkt
        const previewRadius = 5 / this.view.scale;
        ctx.save();
        ctx.beginPath();
        ctx.arc(tempPt.x, tempPt.y, previewRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#e67e22';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 / this.view.scale;
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Vorschau-Länge anzeigen
        const length = Math.hypot(tempPt.x - startPt.x, tempPt.y - startPt.y);
        const midX = (startPt.x + tempPt.x) / 2;
        const midY = (startPt.y + tempPt.y) / 2;

        const lengthText = `${Math.round(length)} mm`;

        this.drawText(ctx, lengthText, midX, midY - 3, '#2980b9');

        // Vorschau-Winkel zum verbundenen Segment ermitteln
        const connectedSeg = this.profile.segments.find(
            seg => seg.startIndex === activeIndex || seg.endIndex === activeIndex
        );

        if (connectedSeg) {
            const prevPtIndex = (connectedSeg.startIndex === activeIndex) ? connectedSeg.endIndex : connectedSeg.startIndex;
            const prevPt = this.profile.points[prevPtIndex];

            if (prevPt) {
                const angle = this.calculateAngleBetween(prevPt, startPt, tempPt);
                this.drawAngleArc(ctx, prevPt, startPt, tempPt, angle, true);
            }
        }
    }

    // --- BEMASSUNG (Maßlinien, Winkel, Labels) ---
    // Platzierung komplett in DimensionLayout (gleiche Regeln wie im PDF);
    // hier nur noch zeichnen. Gibt die Labels für das Hit-Testing zurück.
    // ghostPoints: blasses anderes Profilende (konisches Profil) – die
    // Bemassung weicht auch dessen Linien aus.
    drawDimensions(ctx, points = this.profile.points, ghostPoints = null) {
        if (!this.profile || !this.profile.segments) return [];

        // Längensperren gelten nur fürs vordere Ende (Ziehen im Auswahlmodus),
        // hinten daher ohne Schloss anzeigen. Kopien, damit Indizes gleich bleiben.
        const segments = this.profile.isEditingBack()
            ? this.profile.segments.map(seg => ({ ...seg, lengthLocked: false }))
            : this.profile.segments;

        const s = this.view.scale;

        // Leistung: Beim Verschieben der Ansicht ändert sich das Profil nicht –
        // die Platzierung der Masse wird dann wiederverwendet.
        const cacheKey = JSON.stringify([points, segments, ghostPoints, Math.round(s * 1000)]);
        let layout = this.dimensionCache && this.dimensionCache.key === cacheKey ? this.dimensionCache.layout : null;
        if (!layout) layout = DimensionLayout.compute(points, segments, {
            textHeight: LABEL_FONT_SIZE,
            measure: (text) => {
                ctx.save();
                ctx.font = `${LABEL_FONT_SIZE}px sans-serif`;
                const w = ctx.measureText(text).width;
                ctx.restore();
                return w;
            },
            decorate: (text, locked) => locked ? `🔒 ${text}` : text,
            dimOffset: 5,
            offsetStep: 8,
            maxOffsetSteps: 3,
            extGap: 1.2,
            extOverhang: 1.5,
            arrowSize: 2,
            textGap: 1,
            arcRadius: (minLen) => Math.max(2.5, Math.min(7, minLen * 0.3)),
            squareSize: 3,
            pointRadius: 5 / s,
            foldOffset: HEM_FOLD_OFFSET_MM,
            backgroundPoints: ghostPoints
        });
        this.dimensionCache = { key: cacheKey, layout };

        const LENGTH_COLOR = '#27ae60';
        const ANGLE_COLOR = '#8e44ad';
        const thin = 1 / s;

        layout.lengths.forEach(dim => {
            dim.lines.forEach(([a, b]) => this.strokePolyline(ctx, [a, b], LENGTH_COLOR, thin));
            dim.arrows.forEach(arrow => this.fillArrow(ctx, arrow.tip, arrow.dir, 2, LENGTH_COLOR));
        });

        layout.angles.forEach(angle => {
            if (angle.arc) this.strokePolyline(ctx, angle.arc, ANGLE_COLOR, thin);
            if (angle.square) this.strokePolyline(ctx, angle.square, ANGLE_COLOR, thin);
            if (angle.leader) this.strokePolyline(ctx, angle.leader, ANGLE_COLOR, thin);
        });

        layout.labels.forEach(label => {
            if (label.hitOnly) return;
            const color = label.type === 'angle' ? ANGLE_COLOR : LENGTH_COLOR;
            this.drawText(ctx, label.text, label.x, label.y, color);
        });

        return layout.labels;
    }

    strokePolyline(ctx, pts, color, lineWidth) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
    }

    // Gefüllte Pfeilspitze: Spitze bei tip, zeigt in Richtung dir
    fillArrow(ctx, tip, dir, size, color) {
        const px = -dir.y, py = dir.x;
        const bx = tip.x - dir.x * size, by = tip.y - dir.y * size;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(bx + px * size * 0.35, by + py * size * 0.35);
        ctx.lineTo(bx - px * size * 0.35, by - py * size * 0.35);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
    }

    // --- WINKEL-VORSCHAU BEIM ZEICHNEN (nur Live-Vorschau) ---
    drawAngleArc(ctx, p1, vertex, p2, angleDeg, isPreview = true) {
        const a1 = Math.atan2(p1.y - vertex.y, p1.x - vertex.x);
        const a2 = Math.atan2(p2.y - vertex.y, p2.x - vertex.x);
        const radius = 7;

        let diff = a2 - a1;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;

        const color = isPreview ? '#e67e22' : '#8e44ad';

        ctx.save();
        ctx.beginPath();
        ctx.arc(vertex.x, vertex.y, radius, a1, a1 + diff, diff < 0);
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.4;
        if (isPreview) ctx.setLineDash([1, 1]);
        ctx.stroke();
        ctx.restore();

        const mid = a1 + diff / 2;
        const textDist = radius + 5;
        this.drawText(ctx, `${Math.round(angleDeg)}°`, vertex.x + Math.cos(mid) * textDist, vertex.y + Math.sin(mid) * textDist, color);
    }

    // --- PUNKTE RENDERN ---
    drawPoints(ctx, points = this.profile.points) {
        if (!points || points.length === 0) return;

        // 1. Prüfen, welcher Punkt selektiert oder aktiv ist
        const selectedPointIndex = (this.selectionController && this.selectionController.selectedType === 'point')
        ? this.selectionController.selectedIndex
        : -1;

        // Aktiver Zeichenpunkt (grüner Ring) nur vorne – hinten wird nicht gezeichnet
        let activeIndex = -1;
        if (!this.profile.isEditingBack() && this.drawingController && typeof this.drawingController.activePointIndex === 'number' && this.drawingController.activePointIndex >= 0) {
            activeIndex = this.drawingController.activePointIndex;
        }

        // 2. Punkte zeichnen
        points.forEach((pt, index) => {
            const isSelected = (index === selectedPointIndex);
            const isActive = (index === activeIndex);

            const radius = 5 / this.view.scale;
            const activeOutlineRadius = 10 / this.view.scale;

            const blueColor = '#2196F3';
            const greenColor = '#2ecc71';
            const orangeColor = '#e67e22'; // Farbe für angeklickte/ausgewählte Punkte

            ctx.save();

            if (isSelected) {
                // ORANGER Rahmen und Punkt für manuell SELEKTIERTE Punkte
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, activeOutlineRadius, 0, Math.PI * 2);
                ctx.strokeStyle = orangeColor;
                ctx.lineWidth = 2 / this.view.scale;
                ctx.setLineDash([3 / this.view.scale, 3 / this.view.scale]);
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = orangeColor;
                ctx.fill();
            } else if (isActive) {
                // Grüner Ring für den AKTIVEN Punkt im Zeichenmodus
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, activeOutlineRadius, 0, Math.PI * 2);
                ctx.strokeStyle = greenColor;
                ctx.lineWidth = 2 / this.view.scale;
                ctx.setLineDash([3 / this.view.scale, 3 / this.view.scale]);
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = greenColor;
                ctx.fill();
            } else {
                // Standard blauer Punkt
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = blueColor;
                ctx.fill();
            }

            ctx.restore();

            // Punkt-Nummerierung transparent im Hintergrund
            ctx.save();
            const fontSize = Math.max(8, 10 / this.view.scale);
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.fillStyle = 'rgba(100, 100, 100, 0.20)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';

            const textOffsetX = ((isActive || isSelected) ? activeOutlineRadius + 3 / this.view.scale : radius + 3 / this.view.scale);
            ctx.fillText(index.toString(), pt.x + textOffsetX, pt.y);
            ctx.restore();
        });
    }

    // --- GITTER RENDERN ---
    drawGrid(ctx) {
        const gridSize = 5; // Rasterabstand in mm / Weltkoordinaten

        const startX = Math.floor(-this.view.offsetX / this.view.scale / gridSize) * gridSize - gridSize;
        const endX = startX + (this.canvas.width / this.view.scale) + gridSize * 2;

        const startY = Math.floor(-this.view.offsetY / this.view.scale / gridSize) * gridSize - gridSize;
        const endY = startY + (this.canvas.height / this.view.scale) + gridSize * 2;

        ctx.save();
        ctx.lineWidth = 1 / this.view.scale;

        // FEINES RASTER
        ctx.strokeStyle = '#f0f0f0';
        for (let x = startX; x < endX; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, startY);
            ctx.lineTo(x, endY);
            ctx.stroke();
        }
        for (let y = startY; y < endY; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(startX, y);
            ctx.lineTo(endX, y);
            ctx.stroke();
        }

        // HAUPTACHSEN
        ctx.strokeStyle = '#d0d0d0';
        ctx.lineWidth = 1.5 / this.view.scale;

        ctx.beginPath();
        ctx.moveTo(startX, 0);
        ctx.lineTo(endX, 0);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, startY);
        ctx.lineTo(0, endY);
        ctx.stroke();

        ctx.restore();
    }

    setSelection(type, index) {
        if (this.selectionController) {
            if (type === 'point') {
                this.selectionController.selectPoint(index);
            } else if (type === 'segment') {
                this.selectionController.selectSegment(index);
            } else {
                this.selectionController.clearSelection();
            }
        }
        this.render();
    }

    // --- HILFSMETHODEN ---

    calculateAngleBetween(p1, vertex, p2) {
        const v1 = { x: p1.x - vertex.x, y: p1.y - vertex.y };
        const v2 = { x: p2.x - vertex.x, y: p2.y - vertex.y };

        const dot = v1.x * v2.x + v1.y * v2.y;
        const mag1 = Math.hypot(v1.x, v1.y);
        const mag2 = Math.hypot(v2.x, v2.y);

        if (mag1 === 0 || mag2 === 0) return 0;

        let cosTheta = dot / (mag1 * mag2);
        cosTheta = Math.max(-1, Math.min(1, cosTheta));

        const rad = Math.acos(cosTheta);
        return (rad * 180) / Math.PI;
    }

    drawText(ctx, text, x, y, color = '#000') {
        ctx.save();
        ctx.font = `${LABEL_FONT_SIZE}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    drawScaleBar() {
        const ctx = this.canvas ? this.canvas.getContext('2d') : null;
        if (!ctx) return;

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        const marginX = 20;
        const marginY = this.canvas.height - 25;
        const targetPixelWidth = 100;

        const scale = this.view ? this.view.scale : 1.0;
        const rawMM = targetPixelWidth / scale;

        let niceMM = 100;
        if (rawMM > 500) niceMM = Math.round(rawMM / 100) * 100;
        else if (rawMM > 100) niceMM = Math.round(rawMM / 50) * 50;
        else if (rawMM > 20) niceMM = Math.round(rawMM / 10) * 10;
        else if (rawMM > 5) niceMM = Math.round(rawMM / 5) * 5;
        else niceMM = Math.max(1, Math.round(rawMM));

        const actualPixelWidth = niceMM * scale;

        ctx.beginPath();
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';

        ctx.moveTo(marginX, marginY);
        ctx.lineTo(marginX + actualPixelWidth, marginY);

        ctx.moveTo(marginX, marginY - 4);
        ctx.lineTo(marginX, marginY + 4);
        ctx.moveTo(marginX + actualPixelWidth, marginY - 4);
        ctx.lineTo(marginX + actualPixelWidth, marginY + 4);
        ctx.stroke();

        ctx.fillStyle = '#333333';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${niceMM} mm`, marginX + 25, marginY - 6);

        ctx.restore();
    }
}
