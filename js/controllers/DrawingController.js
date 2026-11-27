import { Toast } from '../utils/Toast.js';
import { globalEventBus } from '../utils/EventBus.js';

export class DrawingController {
    constructor(profile) {
        this.profile = profile;
        this.activePointIndex = -1;
        this.tempPoint = null;

        if (this.profile && this.profile.points.length > 0) {
            this.activePointIndex = this.profile.points.length - 1;
        }
    }

    setMode(mode) {
        if (mode === 'draw') {
            if (this.profile && this.profile.points.length > 0) {
                // Suche von hinten nach dem ersten äußeren Endpunkt
                let foundOuterIndex = -1;
                for (let i = this.profile.points.length - 1; i >= 0; i--) {
                    if (this.isOuterPoint(i)) {
                        foundOuterIndex = i;
                        break;
                    }
                }

                // Falls ein äußerer Punkt gefunden wurde, setze ihn als aktiv, sonst den letzten
                this.activePointIndex = (foundOuterIndex !== -1)
                ? foundOuterIndex
                : this.profile.points.length - 1;
            } else {
                this.activePointIndex = -1;
            }

            // Re-Render auslösen, damit der grüne Auswahlkreis auf dem aktiven Punkt erscheint
            globalEventBus.emit('profile:updated');
        }
    }

    setTempPoint(x, y) {
        if (x === null || y === null) {
            this.tempPoint = null;
        } else {
            this.tempPoint = { x, y };
        }
    }

    /**
     * Prüft, ob ein Punkt ein äußeres Ende der Profilkette ist.
     * Ein Endpunkt ist mit maximal 1 Segment verbunden (oder noch mit gar keinem).
     */
    isOuterPoint(pointIndex) {
        if (!this.profile || !this.profile.segments) return true;

        let connectionCount = 0;
        for (const seg of this.profile.segments) {
            if (seg.startIndex === pointIndex || seg.endIndex === pointIndex) {
                connectionCount++;
            }
        }

        return connectionCount <= 1;
    }

    setActivePoint(index) {
        if (this.profile && index >= 0 && index < this.profile.points.length) {
            // Nur zulassen, wenn der Punkt an einem äußeren Ende liegt
            if (this.isOuterPoint(index)) {
                this.activePointIndex = index;
                this.tempPoint = null; // Hier änderung
                globalEventBus.emit('profile:updated');
            }
        } else {
            this.activePointIndex = -1;
        }
    }

    addPoint(x, y, scale = 1.0) {
        if (!this.profile) return;
        // Neue Punkte nur vorne: beide Profilenden haben denselben Aufbau
        if (this.profile.isEditingBack()) return;

        const snapRadius = Math.max(10 / scale, 2);
        const existingIndex = this.profile.points.findIndex(pt =>
        Math.hypot(pt.x - x, pt.y - y) <= snapRadius
        );

        // Fall A: Ein existierender Punkt wurde angeklickt
        if (existingIndex !== -1) {
            // NUR als aktiven Punkt setzen, WENN es ein äußerer Endpunkt ist
            if (this.isOuterPoint(existingIndex)) {
                this.activePointIndex = existingIndex;
                this.tempPoint = null;
                globalEventBus.emit('profile:updated');
            }
            return;
        }

        // Fall B: ins Freie geklickt -> Neuer Punkt + Segment von activePointIndex
        // (nicht, wenn die neue Linie eine andere kreuzen würde)
        const vorher = this.profile.merken();
        const newPoint = { x, y };
        this.profile.points.push(newPoint);
        const newIndex = this.profile.points.length - 1;

        if (this.activePointIndex >= 0 && this.activePointIndex < newIndex) {
            this.profile.segments.push({
                type: 'line',
                startIndex: this.activePointIndex,
                endIndex: newIndex
            });
            this.profile.reclassifySegments();
            if (this.profile.neueKreuzung(vorher)) {
                this.profile.zurueckholen(vorher);
                Toast.show('Hier nicht möglich: Die neue Linie würde eine andere kreuzen.', 'warning');
                return;
            }
        }

        this.activePointIndex = newIndex;
        this.tempPoint = null;

        globalEventBus.emit('profile:updated');
    }
}
