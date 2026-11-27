import { MathUtils } from '../utils/MathUtils.js';
import { globalEventBus } from '../utils/EventBus.js';

export class View {
    constructor(canvas) {
        this.canvas = canvas;

        // Transformation/Kamera (Pan & Zoom)
        this.offsetX = canvas ? canvas.width / 2 : 0;
        this.offsetY = canvas ? canvas.height / 2 : 0;
        this.scale = 2.0;
    }

    worldToScreen(worldX, worldY) {
        return {
            x: worldX * this.scale + this.offsetX,
            y: worldY * this.scale + this.offsetY
        };
    }

    screenToWorld(screenX, screenY) {
        return {
            x: (screenX - this.offsetX) / this.scale,
            y: (screenY - this.offsetY) / this.scale
        };
    }

    /**
     * Verschiebt die Ansicht um ein Bildschirm-Pixel-Delta (dx, dy).
     * Wird für 1-Finger-Pan (Touch) und Maus-Pan (mittlere/rechte Taste) genutzt.
     */
    pan(dx, dy) {
        this.offsetX += dx;
        this.offsetY += dy;
    }

    /**
     * Zoomt um den angegebenen Bildschirmpunkt (screenX, screenY), sodass der
     * darunterliegende Weltpunkt an derselben Bildschirmposition bleibt.
     * Wird für Mausrad-Zoom, Zoom-Buttons und Pinch-Zoom (Touch) verwendet.
     */
    zoomAt(screenX, screenY, factor) {
        const worldPos = this.screenToWorld(screenX, screenY);

        this.scale = MathUtils.clamp(this.scale * factor, 0.1, 20);

        this.offsetX = screenX - worldPos.x * this.scale;
        this.offsetY = screenY - worldPos.y * this.scale;
    }

    /**
     * Zoomt und verschiebt so, dass alle Punkte in die Zeichenfläche passen.
     * Rand: marginMm in Profil-mm (Masslinien und -texte haben eine feste
     * Grösse in mm, siehe CanvasRenderer) plus marginPx am Bildschirmrand.
     */
    fitToPoints(points, marginMm = 30, marginPx = 12) {
        const valid = (points || []).filter(Boolean);
        if (!this.canvas || valid.length === 0) return;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        valid.forEach(p => {
            minX = Math.min(minX, p.x - marginMm); maxX = Math.max(maxX, p.x + marginMm);
            minY = Math.min(minY, p.y - marginMm); maxY = Math.max(maxY, p.y + marginMm);
        });

        const availW = Math.max(1, this.canvas.width - marginPx * 2);
        const availH = Math.max(1, this.canvas.height - marginPx * 2);
        this.scale = MathUtils.clamp(Math.min(availW / Math.max(maxX - minX, 1), availH / Math.max(maxY - minY, 1)), 0.1, 20);
        this.offsetX = this.canvas.width / 2 - ((minX + maxX) / 2) * this.scale;
        this.offsetY = this.canvas.height / 2 - ((minY + maxY) / 2) * this.scale;
        globalEventBus.emit('view:changed');
    }

    reset() {
        if (!this.canvas) return;
        this.offsetX = this.canvas.width / 2;
        this.offsetY = this.canvas.height / 2;
        this.scale = 5.0; // Skalierungsfaktor beim Reset des Views
        globalEventBus.emit('view:changed');
    }

    zoomReset() {
        this.reset();
    }
}
