import { globalEventBus } from '../utils/EventBus.js';

export class HistoryController {
    constructor(profile) {
        this.profile = profile;
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistorySize = 50; // Maximale Anzahl an Rückgängig-Schritten
        this.isExecuting = false; // Verhindert Endlosschleifen beim Wiederherstellen
        this.isBatching = false;  // Zusammenhängende Änderung (z.B. Punkt ziehen) läuft

        this.initBusEvents();
        // Ersten Initialzustand speichern
        this.saveState();
    }

    initBusEvents() {
        // Horcht auf Profil-Änderungen und speichert den Zustand automatisch
        globalEventBus.on('profile:updated', () => {
            if (!this.isExecuting && !this.isBatching) {
                this.saveState();
            }
        });

        // Zusammenhängende Änderungen (z.B. Punkt ziehen) als EINEN Schritt
        // speichern statt jede Zwischenposition einzeln.
        globalEventBus.on('history:begin', () => this.beginBatch());
        globalEventBus.on('history:end', () => this.endBatch());
    }

    /**
     * Startet eine zusammenhängende Änderung: bis endBatch() werden keine
     * Zwischenstände gespeichert.
     */
    beginBatch() {
        if (this.isBatching) return;
        this.saveState(); // Ausgangszustand sicherstellen (Duplikate werden ignoriert)
        this.isBatching = true;
    }

    /**
     * Beendet die zusammenhängende Änderung und speichert den Endzustand als
     * einen einzigen Schritt (keiner, falls sich nichts geändert hat).
     */
    endBatch() {
        if (!this.isBatching) return;
        this.isBatching = false;
        this.saveState();
    }

    /**
     * Speichert einen Snapshot des aktuellen Profils
     */
    saveState() {
        const snapshot = JSON.stringify({
            points: this.profile.points || [],
            segments: this.profile.segments || []
        });

        // Duplikate vermeiden (wenn sich nichts geändert hat)
        if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === snapshot) {
            return;
        }

        this.undoStack.push(snapshot);
        if (this.undoStack.length > this.maxHistorySize) {
            this.undoStack.shift();
        }

        // Sobald eine neue Aktion ausgeführt wird, wird der Redo-Stapel geleert
        this.redoStack = [];
        this.updateButtonStates();
    }

    /**
     * Verlauf verwerfen, aktueller Zustand wird der neue Anfang
     * (nach Öffnen einer Datei oder „Neu“)
     */
    reset() {
        this.isBatching = false;
        this.undoStack = [];
        this.redoStack = [];
        this.saveState();
    }

    /** Verlauf eines Profils mitnehmen (Projekt mit mehreren Profilen: je Profil ein eigener Verlauf) */
    exportState() {
        this.endBatch();
        return { undo: this.undoStack.slice(), redo: this.redoStack.slice() };
    }

    /** Verlauf eines Profils wieder einsetzen; ohne gemerkten Verlauf beginnt er beim aktuellen Stand */
    restore(state) {
        if (!state || !Array.isArray(state.undo) || state.undo.length === 0) { this.reset(); return; }
        this.isBatching = false;
        this.undoStack = state.undo.slice();
        this.redoStack = (state.redo || []).slice();
        this.updateButtonStates();
    }

    /**
     * Macht die letzte Aktion rückgängig
     */
    undo() {
        this.endBatch(); // Laufende Änderung zuerst abschliessen
        if (this.undoStack.length <= 1) return; // Mindestens ein Zustand (Initialzustand) muss bleiben

        this.isExecuting = true;

        // Aktuellen Zustand auf den Redo-Stapel verschieben
        const currentState = this.undoStack.pop();
        this.redoStack.push(currentState);

        // Vorherigen Zustand laden
        const previousState = JSON.parse(this.undoStack[this.undoStack.length - 1]);
        this.applyState(previousState);

        this.isExecuting = false;
        this.updateButtonStates();

        globalEventBus.emit('selection:changed');
        globalEventBus.emit('profile:updated');
    }

    /**
     * Wiederholt eine rückgängig gemachte Aktion
     */
    redo() {
        this.endBatch();
        if (this.redoStack.length === 0) return;

        this.isExecuting = true;

        const nextState = this.redoStack.pop();
        this.undoStack.push(nextState);

        this.applyState(JSON.parse(nextState));

        this.isExecuting = false;
        this.updateButtonStates();

        globalEventBus.emit('selection:changed');
        globalEventBus.emit('profile:updated');
    }

    /**
     * Überträgt die Snapshots auf das Profile-Objekt
     */
    applyState(state) {
        this.profile.points = JSON.parse(JSON.stringify(state.points));
        this.profile.segments = JSON.parse(JSON.stringify(state.segments));
    }

    /**
     * Aktiviert / Deaktiviert die Undo/Redo-Buttons im UI
     */
    updateButtonStates() {
        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');

        if (btnUndo) {
            btnUndo.disabled = this.undoStack.length <= 1;
            btnUndo.classList.toggle('disabled', this.undoStack.length <= 1);
        }
        if (btnRedo) {
            btnRedo.disabled = this.redoStack.length === 0;
            btnRedo.classList.toggle('disabled', this.redoStack.length === 0);
        }
    }
}
