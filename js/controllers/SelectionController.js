import { globalEventBus } from '../utils/EventBus.js';
import { Toast } from '../utils/Toast.js';

export class SelectionController {
    constructor(profile) {
        this.profile = profile;

        this.selectedType = null; // 'point' | 'segment' | null
        this.selectedIndex = -1;
    }

    clearSelection() {
        this.selectedType = null;
        this.selectedIndex = -1;

        globalEventBus.emit('selection:changed');
    }

    selectPoint(index) {
        if (index >= 0 && index < this.profile.points.length) {
            this.selectedType = 'point';
            this.selectedIndex = index;

            globalEventBus.emit('selection:changed');
        }
    }

    selectSegment(index) {
        if (index >= 0 && index < this.profile.segments.length) {
            this.selectedType = 'segment';
            this.selectedIndex = index;

            globalEventBus.emit('selection:changed');
        }
    }

    /**
     * Erhöhte Toleranz für Touch- und Mauseingaben
     */
    findAtWorldPos(worldPos, scale = 1.0) {
        if (!this.profile) return null;

        // Fester Fangradius auf dem Bildschirm (20-25 Pixel), umgerechnet in Weltkoordinaten
        const pointTolerance = 25 / scale;
        const lineTolerance = 15 / scale;

        // Beim konischen Profil wird am gerade bearbeiteten Ende gesucht
        const points = this.profile.getActivePoints() || [];
        for (let i = 0; i < points.length; i++) {
            const pt = points[i];
            const dist = Math.hypot(pt.x - worldPos.x, pt.y - worldPos.y);
            if (dist <= pointTolerance) {
                return { type: 'point', index: i };
            }
        }

        const segments = this.profile.segments || [];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const p1 = points[seg.startIndex];
            const p2 = points[seg.endIndex];
            if (!p1 || !p2) continue;

            const dist = this.distToSegment(worldPos, p1, p2);
            if (dist <= lineTolerance) {
                return { type: 'segment', index: i };
            }
        }

        return null;
    }

    distToSegment(p, a, b) {
        const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);

        let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
        t = Math.max(0, Math.min(1, t));

        const projX = a.x + t * (b.x - a.x);
        const projY = a.y + t * (b.y - a.y);

        return Math.hypot(p.x - projX, p.y - projY);
    }

    deleteSelected() {
        if (this.selectedIndex === -1 || !this.selectedType) return false;

        // Aufbau beider Profilenden muss gleich bleiben: Löschen nur vorne
        if (this.profile.isEditingBack()) {
            Toast.show('Punkte und Linien können nur am vorderen Profilende gelöscht werden.', 'warning');
            return false;
        }

        if (this.selectedType === 'segment') {
            const segIndex = this.selectedIndex;
            this.profile.segments.splice(segIndex, 1);
            this.cleanupUnusedPoints();
        } else if (this.selectedType === 'point') {
            const ptIndex = this.selectedIndex;
            this.profile.segments = this.profile.segments.filter(
                seg => seg.startIndex !== ptIndex && seg.endIndex !== ptIndex
            );
            this.profile.points.splice(ptIndex, 1);
            this.profile.segments.forEach(seg => {
                if (seg.startIndex > ptIndex) seg.startIndex--;
                if (seg.endIndex > ptIndex) seg.endIndex--;
            });
        }

        this.clearSelection();
        globalEventBus.emit('profile:updated');
        return true;
    }

    cleanupUnusedPoints() {
        const usedPointIndices = new Set();
        this.profile.segments.forEach(s => {
            usedPointIndices.add(s.startIndex);
            usedPointIndices.add(s.endIndex);
        });

        for (let i = this.profile.points.length - 1; i >= 0; i--) {
            if (!usedPointIndices.has(i) && i !== 0) {
                this.profile.points.splice(i, 1);
                this.profile.segments.forEach(seg => {
                    if (seg.startIndex > i) seg.startIndex--;
                    if (seg.endIndex > i) seg.endIndex--;
                });
            }
        }
    }
}
