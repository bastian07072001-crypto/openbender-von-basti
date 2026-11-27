import { globalEventBus } from '../utils/EventBus.js';

export class ZoomHandler {
    constructor(canvas, view) {
        this.canvas = canvas;
        this.view = view;

        this.initialPinchDistance = null;
        this.lastTouchCenter = null;

        this.initEvents();
    }

    initEvents() {
        if (!this.canvas) return;

        // Mousewheel Zoom (Desktop)
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
            this.zoomAtPoint(e.clientX, e.clientY, zoomFactor);
        }, { passive: false });

        // Touch Zoom (iPad / Tablet)
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                this.initialPinchDistance = this.getTouchDistance(e.touches);
                this.lastTouchCenter = this.getTouchCenter(e.touches);
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && this.initialPinchDistance) {
                e.preventDefault();

                const currentDistance = this.getTouchDistance(e.touches);
                const currentCenter = this.getTouchCenter(e.touches);

                if (currentDistance === 0) return;

                // 1. Skalierung anhand des Abstands-Verhältnisses berechnen
                const factor = currentDistance / this.initialPinchDistance;
                this.initialPinchDistance = currentDistance; // Kontinuierlich nachführen für flüssigen Zoom

                // 2. Zoom um den Fingermittelpunkt ausführen
                const rect = this.canvas.getBoundingClientRect();
                const focusX = currentCenter.x - rect.left;
                const focusY = currentCenter.y - rect.top;

                if (typeof this.view.zoomAt === 'function') {
                    this.view.zoomAt(focusX, focusY, factor);
                } else {
                    this.view.scale = Math.max(0.1, Math.min(20, this.view.scale * factor));
                }

                // 3. Gleichzeitiges Verschieben mit 2 Fingern (Zwei-Finger-Pan) ermöglichen
                if (this.lastTouchCenter) {
                    const dx = currentCenter.x - this.lastTouchCenter.x;
                    const dy = currentCenter.y - this.lastTouchCenter.y;

                    if (typeof this.view.pan === 'function') {
                        this.view.pan(dx, dy);
                    } else if (this.view.offsetX !== undefined) {
                        this.view.offsetX += dx;
                        this.view.offsetY += dy;
                    }
                }

                this.lastTouchCenter = currentCenter;
                globalEventBus.emit('view:changed');
            }
        }, { passive: false });

        this.canvas.addEventListener('touchend', (e) => {
            if (e.touches.length < 2) {
                this.initialPinchDistance = null;
                this.lastTouchCenter = null;
            }
        });
    }

    getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    }

    getTouchCenter(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }

    zoomAtPoint(clientX, clientY, factor) {
        const rect = this.canvas.getBoundingClientRect();
        const screenX = clientX - rect.left;
        const screenY = clientY - rect.top;

        if (typeof this.view.zoomAt === 'function') {
            this.view.zoomAt(screenX, screenY, factor);
        } else {
            this.view.scale = Math.max(0.1, Math.min(20, this.view.scale * factor));
        }

        globalEventBus.emit('view:changed');
    }

    zoomIn() {
        const rect = this.canvas.getBoundingClientRect();
        this.zoomAtPoint(rect.width / 2 + rect.left, rect.height / 2 + rect.top, 1.2);
    }

    zoomOut() {
        const rect = this.canvas.getBoundingClientRect();
        this.zoomAtPoint(rect.width / 2 + rect.left, rect.height / 2 + rect.top, 0.8);
    }
}
