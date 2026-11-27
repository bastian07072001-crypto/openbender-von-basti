import { globalEventBus } from '../utils/EventBus.js';

export class ModeManager {
    constructor() {
        this.currentMode = 'line';
    }

    getMode() {
        return this.currentMode;
    }

    setMode(newMode) {
        this.currentMode = newMode;
        this.updateUI();
    }

    updateUI() {
        const btnLine = document.getElementById('btn-mode-line');
        const btnSelect = document.getElementById('btn-mode-select');

        if (btnLine) btnLine.classList.toggle('active', this.currentMode === 'line');
        if (btnSelect) btnSelect.classList.toggle('active', this.currentMode === 'select');
    }
}
