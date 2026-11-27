import { globalEventBus } from '../utils/EventBus.js';
import { Geometry } from '../utils/Geometry.js';

export class EventHandler {
    constructor(canvas, view, drawingController, selectionController, labelEditController = null) {
        this.canvas = canvas;
        this.view = view;
        this.drawingController = drawingController;
        this.selectionController = selectionController;
        this.labelEditController = labelEditController;

        this.currentMode = 'draw'; // 'draw' | 'select'

        this.isPanning = false;
        this.isDraggingPoint = false; // Punkt im Auswahlmodus verschieben
        this.isCreatingPoint = false;  // Neu: Neuer Punkt wird gerade live herumgezogen

        this.panStartX = 0;
        this.panStartY = 0;

        this.isMultiTouch = false;
        this.touchStartPos = null;
        this.hasMoved = false;

        this.initEvents();
        this.initBusEvents();
    }

    setMode(mode) {
        // Bei Moduswechsel alle Panning/Dragging/Creating-Zustände erzwingend zurücksetzen
        this.currentMode = (mode === 'line') ? 'draw' : mode;
        this.isPanning = false;
        this.endPointDrag();
        this.isCreatingPoint = false;
        this.touchStartPos = null;
        this.hasMoved = false;

        if (this.drawingController && typeof this.drawingController.setTempPoint === 'function') {
            this.drawingController.setTempPoint(null);
        }

        if (this.drawingController && typeof this.drawingController.setMode === 'function') {
            this.drawingController.setMode(this.currentMode);
        }
        if (this.currentMode === 'draw' && this.selectionController) {
            this.selectionController.clearSelection();
        }

        // Bei Moduswechsel Neuzeichnen anfordern
        globalEventBus.emit('selection:changed');
        globalEventBus.emit('profile:updated');
    }

    initBusEvents() {
        globalEventBus.on('mode:changed', (mode) => {
            this.setMode(mode);
        });
    }

    initEvents() {
        if (!this.canvas) return;

        // --- MAUS-EVENTS (DESKTOP) ---

        this.canvas.addEventListener('mousedown', (e) => {
            // War das Label-Eingabefeld offen, schluckt dieser erste Klick nur
            // das Schließen (siehe LabelEditController.initOutsideClickHandling)
            // – keine weitere Canvas-Interaktion für diesen Klick auslösen.
            if (this.labelEditController && this.labelEditController.isOpen) {
                return;
            }

            // Mittlere oder rechte Maustaste -> Panning
            if (e.button === 1 || e.button === 2) {
                this.isPanning = true;
                this.panStartX = e.clientX;
                this.panStartY = e.clientY;
                this.canvas.style.cursor = 'grabbing';
                return;
            }

            // Linke Maustaste
            if (e.button === 0) {
                const worldPos = this.getWorldPos(e.clientX, e.clientY);

                if (this.currentMode === 'select') {
                    // Punkt und Label können sehr nah beieinander liegen (ein
                    // Winkel-Label sitzt fast immer direkt neben seinem
                    // Scheitelpunkt) – daher gewinnt nicht pauschal das eine
                    // oder andere, sondern das jeweils NÄHERE Element (siehe
                    // findNearestPointHit / labelEditController.findLabelHit).
                    // Segmente (dünne Linien) haben dagegen keinen Vorrang vor
                    // Labels, da Beschriftungen praktisch immer direkt auf
                    // ihrer Linie sitzen.
                    const pointHit = this.findNearestPointHit(worldPos);
                    const labelHit = this.labelEditController ? this.labelEditController.findLabelHit(worldPos) : null;

                    if (labelHit && (!pointHit || labelHit.dist <= pointHit.dist)) {
                        this.labelEditController.open(labelHit.label);
                        return;
                    }

                    if (pointHit) {
                        this.selectionController.selectPoint(pointHit.index);
                        this.isDraggingPoint = true; // Drag-Start für Punkt
                        globalEventBus.emit('history:begin');

                        globalEventBus.emit('selection:changed');
                        globalEventBus.emit('profile:updated');
                        return;
                    }

                    const hit = (this.selectionController && typeof this.selectionController.findAtWorldPos === 'function')
                    ? this.selectionController.findAtWorldPos(worldPos, this.view.scale)
                    : null;

                    if (hit && hit.type === 'segment') {
                        this.selectionController.selectSegment(hit.index);

                        globalEventBus.emit('selection:changed');
                        globalEventBus.emit('profile:updated');
                        return;
                    }

                    this.selectionController.clearSelection();
                    this.isPanning = true;
                    this.panStartX = e.clientX;
                    this.panStartY = e.clientY;
                    this.canvas.style.cursor = 'grabbing';

                    // KRITISCH: Event aussenden, damit der Renderer die Auswahl sofort neu zeichnet
                    globalEventBus.emit('selection:changed');
                    globalEventBus.emit('profile:updated');

                } else if (this.currentMode === 'draw') {
                    // Klick auf ein Maß-/Winkel-Label -> Eingabefeld öffnen statt
                    // neuen Punkt zu setzen (im Zeichnen-Modus gibt es kein
                    // Punkt-Ziehen, daher kein Konflikt wie im Auswahlmodus).
                    if (this.labelEditController && this.labelEditController.tryOpenAt(worldPos)) {
                        return;
                    }

                    // Punkt setzen starten -> Live-Vorschau (TempPoint) aktivieren
                    this.isCreatingPoint = true;
                    if (this.drawingController && typeof this.drawingController.setTempPoint === 'function') {
                        this.drawingController.setTempPoint(worldPos.x, worldPos.y);
                    }
                    globalEventBus.emit('profile:updated');
                }
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            const worldPos = this.getWorldPos(e.clientX, e.clientY);

            // 1. Neuer Punkt wird herumgezogen (Zeichnen-Modus)
            if (this.isCreatingPoint && this.currentMode === 'draw') {
                if (this.drawingController && typeof this.drawingController.setTempPoint === 'function') {
                    this.drawingController.setTempPoint(worldPos.x, worldPos.y);
                }
                globalEventBus.emit('profile:updated');
                return;
            }

            // 2. Bestehender Punkt wird verschoben (Auswahl-Modus)
            if (this.isDraggingPoint && this.selectionController && this.selectionController.selectedType === 'point') {
                const ptIndex = this.selectionController.selectedIndex;
                if (ptIndex >= 0 && this.drawingController.profile.points[ptIndex]) {
                    // Berücksichtigt gesperrte Längen/Winkel: der Punkt
                    // "rutscht" dann nur innerhalb der erlaubten Freiheits-
                    // grade statt frei zur Mausposition zu springen (siehe
                    // Geometry.applyConstrainedDrag).
                    this.dragPoint(ptIndex, worldPos);
                    globalEventBus.emit('profile:updated');
                }
                return;
            }

            // 3. Canvas Verschieben (Panning)
            if (this.isPanning) {
                const dx = e.clientX - this.panStartX;
                const dy = e.clientY - this.panStartY;
                this.panStartX = e.clientX;
                this.panStartY = e.clientY;

                if (typeof this.view.pan === 'function') {
                    this.view.pan(dx, dy);
                } else {
                    this.view.offsetX += dx;
                    this.view.offsetY += dy;
                }
                globalEventBus.emit('view:changed');
            }
        });

        this.canvas.addEventListener('mouseup', (e) => {
            if (e.button === 0 && this.isCreatingPoint && this.currentMode === 'draw') {
                const worldPos = this.getWorldPos(e.clientX, e.clientY);
                this.isCreatingPoint = false;

                // TempPoint aufräumen
                if (this.drawingController && typeof this.drawingController.setTempPoint === 'function') {
                    this.drawingController.setTempPoint(null);
                }

                // Punkt nun fest zum Profil hinzufügen
                if (this.drawingController) {
                    this.drawingController.addPoint(worldPos.x, worldPos.y, this.view.scale);
                }
            }

            this.isPanning = false;
            this.endPointDrag();
            this.isCreatingPoint = false;
            this.canvas.style.cursor = 'default';
        });

        // Loslassen ausserhalb der Zeichenfläche beendet das Ziehen ebenfalls,
        // sonst bliebe der Undo-Schritt offen.
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) this.endPointDrag();
        });

        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());


        // --- TOUCH-EVENTS (TABLET / IPAD) ---

        this.canvas.addEventListener('touchstart', (e) => {
            // War das Label-Eingabefeld offen, schluckt dieser erste Tap nur
            // das Schließen (siehe LabelEditController.initOutsideClickHandling).
            if (this.labelEditController && this.labelEditController.isOpen) {
                return;
            }

            if (e.touches.length > 1) {
                this.isMultiTouch = true;
                this.isPanning = false;
                this.endPointDrag();
                this.isCreatingPoint = false;
                this.touchStartPos = null;

                if (this.drawingController && typeof this.drawingController.setTempPoint === 'function') {
                    this.drawingController.setTempPoint(null);
                }
                return;
            }

            this.isMultiTouch = false;
            this.hasMoved = false;

            const touch = e.touches[0];
            this.panStartX = touch.clientX;
            this.panStartY = touch.clientY;
            this.touchStartPos = { x: touch.clientX, y: touch.clientY };

            const worldPos = this.getWorldPos(touch.clientX, touch.clientY);

            if (this.currentMode === 'select') {
                // Näheres Element gewinnt (Punkt vs. Label), siehe Kommentar
                // in der Maus-Variante weiter oben.
                const pointHit = this.findNearestPointHit(worldPos);
                const labelHit = this.labelEditController ? this.labelEditController.findLabelHit(worldPos) : null;

                if (labelHit && (!pointHit || labelHit.dist <= pointHit.dist)) {
                    this.labelEditController.open(labelHit.label);
                    return;
                }

                if (pointHit) {
                    this.selectionController.selectPoint(pointHit.index);
                    this.isDraggingPoint = true; // Drag-Start für Touch
                    globalEventBus.emit('history:begin');

                    globalEventBus.emit('selection:changed');
                    globalEventBus.emit('profile:updated');
                    return;
                }

                const hit = (this.selectionController && typeof this.selectionController.findAtWorldPos === 'function')
                ? this.selectionController.findAtWorldPos(worldPos, this.view.scale)
                : null;

                if (hit && hit.type === 'segment') {
                    this.selectionController.selectSegment(hit.index);

                    globalEventBus.emit('selection:changed');
                    globalEventBus.emit('profile:updated');
                    return;
                }

                this.selectionController.clearSelection();
                this.isPanning = true;

                // KRITISCH: Touch-Auswahl ebenfalls neu zeichnen lassen
                globalEventBus.emit('selection:changed');
                globalEventBus.emit('profile:updated');

            } else if (this.currentMode === 'draw') {
                // Tap auf ein Maß-/Winkel-Label -> Eingabefeld öffnen statt
                // neuen Punkt zu setzen.
                if (this.labelEditController && this.labelEditController.tryOpenAt(worldPos)) {
                    return;
                }

                // Touch-Herumziehen starten
                this.isCreatingPoint = true;
                if (this.drawingController && typeof this.drawingController.setTempPoint === 'function') {
                    this.drawingController.setTempPoint(worldPos.x, worldPos.y);
                }
                globalEventBus.emit('profile:updated');
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length > 1) {
                this.isMultiTouch = true;
                this.isPanning = false;
                this.endPointDrag();
                this.isCreatingPoint = false;
                return;
            }

            const touch = e.touches[0];

            if (this.touchStartPos) {
                const dist = Math.hypot(touch.clientX - this.touchStartPos.x, touch.clientY - this.touchStartPos.y);
                if (dist > 8) {
                    this.hasMoved = true;
                }
            }

            const worldPos = this.getWorldPos(touch.clientX, touch.clientY);

            // 1. Touch: Neuer Punkt wird herumgezogen
            if (this.isCreatingPoint && this.currentMode === 'draw') {
                e.preventDefault();
                if (this.drawingController && typeof this.drawingController.setTempPoint === 'function') {
                    this.drawingController.setTempPoint(worldPos.x, worldPos.y);
                }
                globalEventBus.emit('profile:updated');
                return;
            }

            // 2. Touch: Bestehender Punkt verschieben
            if (this.isDraggingPoint && this.selectionController && this.selectionController.selectedType === 'point') {
                e.preventDefault();
                const ptIndex = this.selectionController.selectedIndex;
                if (ptIndex >= 0 && this.drawingController.profile.points[ptIndex]) {
                    // Berücksichtigt gesperrte Längen/Winkel, siehe Kommentar
                    // in der Maus-Variante weiter oben.
                    this.dragPoint(ptIndex, worldPos);
                    globalEventBus.emit('profile:updated');
                }
                return;
            }

            // 3. Touch: Canvas mit 1 Finger verschieben (nur wenn ins Leere gegriffen wurde)
            if (this.isPanning && this.hasMoved) {
                e.preventDefault();
                const dx = touch.clientX - this.panStartX;
                const dy = touch.clientY - this.panStartY;
                this.panStartX = touch.clientX;
                this.panStartY = touch.clientY;

                if (typeof this.view.pan === 'function') {
                    this.view.pan(dx, dy);
                } else {
                    this.view.offsetX += dx;
                    this.view.offsetY += dy;
                }
                globalEventBus.emit('view:changed');
            }
        }, { passive: false });

        this.canvas.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) {
                // Punkt beim Loslassen des Fingers festschreiben
                if (this.currentMode === 'draw' && this.isCreatingPoint && !this.isMultiTouch) {
                    const touch = e.changedTouches[0];
                    const worldPos = this.getWorldPos(touch.clientX, touch.clientY);

                    if (this.drawingController && typeof this.drawingController.setTempPoint === 'function') {
                        this.drawingController.setTempPoint(null);
                    }

                    if (this.drawingController) {
                        this.drawingController.addPoint(worldPos.x, worldPos.y, this.view.scale);
                    }
                }

                this.isPanning = false;
                this.endPointDrag();
                this.isCreatingPoint = false;
                this.isMultiTouch = false;
                this.touchStartPos = null;
                this.hasMoved = false;
            }
        });

        this.canvas.addEventListener('touchcancel', () => {
            this.isPanning = false;
            this.endPointDrag();
            this.isCreatingPoint = false;
            this.isMultiTouch = false;
            this.touchStartPos = null;
            this.hasMoved = false;

            if (this.drawingController && typeof this.drawingController.setTempPoint === 'function') {
                this.drawingController.setTempPoint(null);
            }
        });
    }

    // Verschiebt einen Punkt. Vorne frei bzw. gemäss gesperrter Längen/Winkel
    // (Geometry.applyConstrainedDrag); beim hinteren Ende eines konischen
    // Profils sind die Winkel fix, der Punkt gleitet nur entlang seines
    // Segments (Profile.dragBackPoint).
    // Eine Verschiebung, bei der sich Linien kreuzen würden, wird nicht
    // übernommen: der Punkt bleibt an der letzten gültigen Stelle.
    dragPoint(ptIndex, worldPos) {
        const profile = this.drawingController.profile;
        const vorher = profile.merken();
        if (profile.isEditingBack()) {
            profile.dragBackPoint(ptIndex, worldPos.x, worldPos.y);
        } else {
            Geometry.applyConstrainedDrag(profile, ptIndex, worldPos.x, worldPos.y);
            profile.reclassifySegments();
        }
        if (profile.neueKreuzung(vorher)) profile.zurueckholen(vorher);
    }

    // Beendet das Verschieben eines Punktes und schliesst den zugehörigen
    // Undo-Schritt ab (die ganze Verschiebung = ein Schritt).
    endPointDrag() {
        if (!this.isDraggingPoint) return;
        this.isDraggingPoint = false;
        globalEventBus.emit('history:end');
    }

    // Nächstgelegener Profilpunkt innerhalb der üblichen Fangtoleranz (siehe
    // SelectionController.findAtWorldPos), samt Abstand – wird im
    // Auswahlmodus gegen einen evtl. getroffenen Label-Kandidaten
    // verglichen, damit bei eng beieinander liegenden Elementen das jeweils
    // nähere gewinnt statt eines pauschalen Vorrangs.
    findNearestPointHit(worldPos) {
        const profile = this.drawingController && this.drawingController.profile;
        const points = profile ? profile.getActivePoints() : [];
        const tolerance = 25 / (this.view.scale || 1);

        let best = null;
        for (let i = 0; i < points.length; i++) {
            const dist = Math.hypot(points[i].x - worldPos.x, points[i].y - worldPos.y);
            if (dist <= tolerance && (!best || dist < best.dist)) {
                best = { index: i, dist };
            }
        }

        return best;
    }

    getWorldPos(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const screenX = clientX - rect.left;
        const screenY = clientY - rect.top;

        let worldPos;

        if (typeof this.view.screenToWorld === 'function') {
            worldPos = this.view.screenToWorld(screenX, screenY);
        } else {
            worldPos = {
                x: (screenX - this.view.offsetX) / this.view.scale,
                y: (screenY - this.view.offsetY) / this.view.scale
            };
        }

        // Snapping: Runden der Weltkoordinaten auf exakte Millimeter
        return {
            x: Math.round(worldPos.x),
            y: Math.round(worldPos.y)
        };
    }
}
