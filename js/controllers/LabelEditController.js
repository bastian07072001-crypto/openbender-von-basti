import { globalEventBus } from '../utils/EventBus.js';
import { Geometry } from '../utils/Geometry.js';
import { FeldMeldung } from '../utils/FeldMeldung.js';

/**
 * Ermöglicht das Bearbeiten einer Schenkellänge oder eines Winkels direkt
 * über einen Klick/Tap auf das jeweilige Maß-Label im Canvas: ein kleines
 * Eingabefeld erscheint an der Stelle des Labels, in dem der neue Wert per
 * Tastatur/Bildschirmtastatur eingegeben und das Maß optional gesperrt
 * werden kann (siehe Geometry.applyConstrainedDrag für die Auswirkung einer
 * Sperre beim späteren Ziehen im Auswahl/Verschieben-Modus).
 */
export class LabelEditController {
    constructor(profile, view, canvas, canvasRenderer) {
        this.profile = profile;
        this.view = view;
        this.canvas = canvas;
        this.canvasRenderer = canvasRenderer;

        this.currentLabel = null;
        this.pendingLocked = false;
        this.isOpen = false;

        this.buildPopup();
        this.initOutsideClickHandling();
    }

    buildPopup() {
        this.popupEl = document.getElementById('label-edit-popup');
        if (!this.popupEl) return;

        this.inputEl = document.getElementById('label-edit-input');
        this.unitEl = document.getElementById('label-edit-unit');
        this.lockBtnEl = document.getElementById('label-edit-lock-btn');
        this.okBtnEl = document.getElementById('label-edit-ok-btn');

        if (this.lockBtnEl) {
            this.lockBtnEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.pendingLocked = !this.pendingLocked;
                this.updateLockButton();
            });
        }

        if (this.okBtnEl) {
            this.okBtnEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.applyValue();
            });
        }

        if (this.inputEl) {
            this.inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.applyValue();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    this.close();
                }
            });

            // Verhindert, dass ein Klick ins Eingabefeld selbst als
            // "Außerhalb geklickt" gewertet wird (siehe initOutsideClickHandling).
            this.inputEl.addEventListener('mousedown', (e) => e.stopPropagation());
            this.inputEl.addEventListener('touchstart', (e) => e.stopPropagation());
        }

        if (this.popupEl) {
            this.popupEl.addEventListener('mousedown', (e) => e.stopPropagation());
            this.popupEl.addEventListener('touchstart', (e) => e.stopPropagation());
        }

        this.buildNumpad();
    }

    /**
     * Eigener Zahlenblock für Geräte mit Fingerbedienung (iPad, Handy): Das
     * iPad zeigt auch bei inputmode="numeric" die ganze Bildschirmtastatur.
     * Das Feld ist dann schreibgeschützt (keine Tastatur), getippt wird hier.
     * Der erste Tipp ersetzt den angezeigten Wert (wie markierter Text). Nur
     * ganze mm bzw. Grad; ✓ im Block übernimmt (der ✓ oben ist dann ausgeblendet).
     */
    buildNumpad() {
        if (!this.popupEl || !this.inputEl) return;
        this.fingerbedienung = window.matchMedia('(pointer: coarse)').matches;
        if (!this.fingerbedienung) return;

        this.inputEl.type = 'text';
        this.inputEl.readOnly = true;
        this.inputEl.setAttribute('inputmode', 'none');
        this.popupEl.classList.add('mit-zahlenblock');

        const block = document.createElement('div');
        block.className = 'label-numpad';
        // nur ganze mm bzw. Grad – statt Punkt der Bestätigen-Knopf
        block.innerHTML = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '✓', '0', '⌫']
            .map(k => `<button type="button" data-taste="${k}"${k === '⌫' ? ' aria-label="Löschen"' : ''}${k === '✓' ? ' class="numpad-ok" aria-label="Übernehmen"' : ''}>${k}</button>`).join('');
        this.popupEl.appendChild(block);
        block.addEventListener('click', (e) => {
            const b = e.target.closest('[data-taste]');
            if (!b) return;
            e.preventDefault();
            e.stopPropagation();
            this.taste(b.dataset.taste);
        });
    }

    taste(k) {
        if (k === '✓') {
            this.applyValue();
            return;
        }
        let v = this.ersetzen ? '' : this.inputEl.value;
        this.ersetzen = false;
        this.inputEl.classList.remove('markiert');
        if (k === '⌫') v = v.slice(0, -1);
        else if (v.length < 5) v = (v === '0' ? '' : v) + k;
        this.inputEl.value = v;
        FeldMeldung.entfernen(this.inputEl);
    }

    initOutsideClickHandling() {
        const handleOutside = (e) => {
            if (!this.isOpen) return;

            // Der öffnende Klick selbst bubbelt noch bis hierher durch –
            // siehe Kommentar in open().
            if (this.suppressNextOutsideClose) {
                this.suppressNextOutsideClose = false;
                return;
            }

            if (this.popupEl && this.popupEl.contains(e.target)) return;
            this.close();
        };

        // WICHTIG: Bubble-Phase (kein capture), damit ein Klick auf das
        // Canvas zuerst dessen eigenen mousedown-Handler durchläuft (siehe
        // EventHandler.js: prüft this.labelEditController.isOpen und
        // schluckt den Klick, statt z.B. einen neuen Punkt zu erzeugen)
        // und erst danach hier das Popup schließt. Mit capture-Phase würde
        // das Popup schon VOR dem Canvas-Handler schließen – der Klick
        // würde dann fälschlich als normale Canvas-Interaktion durchgehen.
        document.addEventListener('mousedown', handleOutside);
        document.addEventListener('touchstart', handleOutside);
    }

    /**
     * Prüft, ob worldPos innerhalb der (knapp bemessenen) Trefferbox eines
     * zuletzt gezeichneten Labels liegt (siehe CanvasRenderer.lastLabels).
     * Gibt bei Treffer { label, dist } zurück, wobei dist der Abstand zu
     * label.x/y ist – wird vom Aufrufer (EventHandler) mit dem Abstand zu
     * einem evtl. ebenfalls getroffenen Punkt verglichen, damit bei eng
     * beieinander liegenden Elementen (z.B. ein Winkel-Label direkt neben
     * seinem Scheitelpunkt) jeweils das NÄHERE gewinnt, statt dass Labels
     * oder Punkte pauschal Vorrang hätten. Ohne Treffer: null.
     */
    findLabelHit(worldPos) {
        const labels = (this.canvasRenderer && this.canvasRenderer.lastLabels) || [];
        // Bewusst knapp: nur wenig größer als die reine Textbox. Eine
        // großzügige Toleranz würde bei eng beieinander liegenden Labels
        // (siehe DimensionLayout) zu überlappenden
        // Trefferzonen führen.
        const toleranceWorld = 2 / (this.view.scale || 1);

        let best = null;
        for (let i = labels.length - 1; i >= 0; i--) {
            const label = labels[i];
            const halfW = label.width / 2 + toleranceWorld;
            const halfH = label.height / 2 + toleranceWorld;

            if (Math.abs(worldPos.x - label.x) <= halfW && Math.abs(worldPos.y - label.y) <= halfH) {
                const dist = Math.hypot(worldPos.x - label.x, worldPos.y - label.y);
                if (!best || dist < best.dist) best = { label, dist };
            }
        }

        return best;
    }

    /**
     * Öffnet das Eingabefeld, falls worldPos ein Label trifft. Gibt true
     * zurück, wenn ein Label getroffen wurde (Aufrufer sollte den Klick dann
     * nicht mehr als normale Canvas-Interaktion behandeln). Für den
     * Auswahlmodus (Konkurrenz mit Punkten) nutzt EventHandler stattdessen
     * findLabelHit() direkt, um Abstände vergleichen zu können.
     */
    tryOpenAt(worldPos) {
        const hit = this.findLabelHit(worldPos);
        if (!hit) return false;
        this.open(hit.label);
        return true;
    }

    open(label) {
        if (!this.popupEl || !this.inputEl) return;

        this.currentLabel = label;
        this.pendingLocked = !!label.locked;

        const currentValue = this.getCurrentValue(label);
        if (currentValue === null) return;

        this.inputEl.value = Math.round(currentValue);
        if (this.unitEl) this.unitEl.textContent = label.type === 'angle' ? '°' : 'mm';
        this.updateLockButton();

        // Hinteres Profilende: Längen sind reine Masse ohne Sperre (Sperren
        // wirken nur beim Ziehen vorne). Winkel gelten für beide Enden.
        if (this.lockBtnEl) {
            this.lockBtnEl.classList.toggle('hidden', this.isBackLength(label));
        }

        // Weltposition des Labels in Bildschirm-/Seitenkoordinaten umrechnen,
        // um das Popup exakt an dieser Stelle zu positionieren.
        const rect = this.canvas.getBoundingClientRect();
        const screenX = rect.left + label.x * this.view.scale + this.view.offsetX;
        const screenY = rect.top + label.y * this.view.scale + this.view.offsetY;

        this.popupEl.style.left = `${screenX}px`;
        this.popupEl.style.top = `${screenY}px`;
        this.popupEl.classList.remove('hidden');
        this.isOpen = true;
        this.inBildHalten(screenX, screenY);

        // Der Klick, der open() gerade ausgelöst hat, bubbelt im selben
        // Event-Zyklus noch bis zu document hoch (siehe
        // initOutsideClickHandling) – ohne diese Sperre würde er das gerade
        // geöffnete Popup sofort wieder als "Klick außerhalb" schließen.
        this.suppressNextOutsideClose = true;

        // Zahlenblock (Fingerbedienung): kein Fokus, sonst öffnet iPadOS die Tastatur
        if (this.fingerbedienung) {
            this.ersetzen = true;
            this.inputEl.classList.add('markiert');
            return;
        }

        // Fokus leicht verzögert, damit der auslösende Klick/Tap nicht sofort
        // wieder als "außerhalb" gewertet wird und das Popup schließt.
        setTimeout(() => {
            this.inputEl.focus();
            this.inputEl.select();
        }, 0);
    }

    /**
     * Popup ganz im sichtbaren Bereich halten: Masse am Bildrand (z.B. auf
     * dem Tablet nach dem Einpassen) liessen sonst den ✓-Knopf aus dem Bild
     * ragen. Das Popup sitzt zentriert über dem Label (translate -50 %/-130 %).
     */
    inBildHalten(x, y) {
        const rand = 8;
        const w = this.popupEl.offsetWidth;
        const h = this.popupEl.offsetHeight;
        const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const nx = Math.min(Math.max(x, rand + w / 2), vw - rand - w / 2);
        const ny = Math.min(Math.max(y, rand + 1.3 * h), vh - rand + 0.3 * h);
        this.popupEl.style.left = `${nx}px`;
        this.popupEl.style.top = `${ny}px`;
    }

    close() {
        FeldMeldung.entfernen(this.inputEl);
        if (this.popupEl) this.popupEl.classList.add('hidden');
        this.isOpen = false;
        this.currentLabel = null;
    }

    updateLockButton() {
        if (!this.lockBtnEl) return;
        this.lockBtnEl.textContent = this.pendingLocked ? '🔒' : '🔓';
        this.lockBtnEl.classList.toggle('active', this.pendingLocked);
        this.lockBtnEl.title = this.pendingLocked ? 'Mass gesperrt (Klick zum Entsperren)' : 'Mass sperren';
    }

    isBackLength(label) {
        return label.type === 'length' && this.profile.isEditingBack();
    }

    getCurrentValue(label) {
        if (label.type === 'length') {
            const seg = this.profile.segments[label.segmentIndex];
            if (!seg) return null;
            if (this.profile.isEditingBack()) return this.profile.getBackLength(seg);
            const p1 = this.profile.points[seg.startIndex];
            const p2 = this.profile.points[seg.endIndex];
            if (!p1 || !p2) return null;
            return Math.hypot(p2.x - p1.x, p2.y - p1.y);
        }

        if (label.type === 'angle') {
            const geom = this.getAngleGeometry(label);
            if (!geom) return null;
            return this.calculateAngleBetween(geom.p1, geom.vertex, geom.p2);
        }

        return null;
    }

    // Ermittelt p1 (Vorgänger-Richtung), vertex und p2 (der bei einer
    // Bearbeitung rotierte ferne Punkt) für ein Winkel-Label.
    getAngleGeometry(label) {
        const angleSeg = this.profile.segments[label.angleSegmentIndex];
        if (!angleSeg) return null;

        const vertexIndex = label.vertexIndex;
        const vertex = this.profile.points[vertexIndex];
        const p2 = this.profile.points[angleSeg.endIndex];

        const prevSeg = this.profile.segments.find(other =>
            other !== angleSeg && (other.startIndex === vertexIndex || other.endIndex === vertexIndex)
        );
        if (!prevSeg || !vertex || !p2) return null;

        const p1Index = (prevSeg.startIndex === vertexIndex) ? prevSeg.endIndex : prevSeg.startIndex;
        const p1 = this.profile.points[p1Index];
        if (!p1) return null;

        return { p1, vertex, p2, angleSeg };
    }

    calculateAngleBetween(p1, vertex, p2) {
        const v1 = { x: p1.x - vertex.x, y: p1.y - vertex.y };
        const v2 = { x: p2.x - vertex.x, y: p2.y - vertex.y };

        const dot = v1.x * v2.x + v1.y * v2.y;
        const mag1 = Math.hypot(v1.x, v1.y);
        const mag2 = Math.hypot(v2.x, v2.y);
        if (mag1 === 0 || mag2 === 0) return 0;

        let cosTheta = dot / (mag1 * mag2);
        cosTheta = Math.max(-1, Math.min(1, cosTheta));
        return (Math.acos(cosTheta) * 180) / Math.PI;
    }

    applyValue() {
        if (!this.currentLabel || !this.inputEl) return;

        const parsed = parseFloat(this.inputEl.value.replace(',', '.'));
        if (!Number.isFinite(parsed)) {
            FeldMeldung.zeigen(this.inputEl, 'Bitte eine gültige Zahl eingeben.');
            return;
        }
        // Nur Ganzzahlen: volle mm bzw. volle Grad reichen für die Praxis
        const newValue = Math.round(parsed);
        const vorher = this.profile.merken();

        if (this.currentLabel.type === 'length') {
            if (newValue < 1) {
                FeldMeldung.zeigen(this.inputEl, 'Länge muss mindestens 1 mm betragen.');
                return;
            }
            if (this.isBackLength(this.currentLabel)) {
                this.profile.setBackLength(this.currentLabel.segmentIndex, newValue);
            } else {
                this.applyLength(this.currentLabel, newValue);
            }
        } else if (this.currentLabel.type === 'angle') {
            if (newValue <= 0 || newValue >= 180) {
                FeldMeldung.zeigen(this.inputEl, 'Winkel muss grösser als 0° und kleiner als 180° sein.');
                return;
            }
            this.applyAngle(this.currentLabel, newValue);
        }

        this.profile.reclassifySegments();
        // Linien dürfen sich nicht kreuzen: Änderung verwerfen, Feld bleibt offen
        if (this.profile.neueKreuzung(vorher)) {
            this.profile.zurueckholen(vorher);
            FeldMeldung.zeigen(this.inputEl, `Mit ${newValue}${this.currentLabel.type === 'angle' ? '°' : ' mm'} würden sich Linien kreuzen.`);
            if (!this.fingerbedienung) this.inputEl.focus();
            return;
        }
        globalEventBus.emit('profile:updated');
        this.close();
    }

    // Ändert die Länge eines Schenkels, OHNE irgendeinen Winkel des Profils
    // zu verändern: p1 (Vorgänger-Ende) bleibt fest, p2 wird entlang der
    // bestehenden Richtung neu positioniert. Der gesamte nachfolgende Teil
    // der Kette ab p2 (alles, was über Segmente von p2 aus erreichbar ist,
    // ohne über p1 zu laufen) wird dabei um denselben Versatz starr
    // mitverschoben – eine reine Translation ändert keine Winkel und keine
    // Längen innerhalb dieses nachfolgenden Teils, nur dessen Lage im Raum.
    applyLength(label, newValue) {
        const seg = this.profile.segments[label.segmentIndex];
        if (!seg) return;

        const p1 = this.profile.points[seg.startIndex];
        const p2 = this.profile.points[seg.endIndex];
        if (!p1 || !p2) return;

        const newP2 = Geometry.pointAtLength(p1, p2, newValue);
        const dx = newP2.x - p2.x;
        const dy = newP2.y - p2.y;

        const downstream = Geometry.collectDownstreamPoints(this.profile, seg.endIndex, seg.startIndex);
        downstream.forEach(idx => {
            const pt = this.profile.points[idx];
            pt.x += dx;
            pt.y += dy;
        });

        seg.lengthLocked = this.pendingLocked;
        seg.lockedLength = this.pendingLocked ? newValue : undefined;
    }

    // Ändert einen Winkel, OHNE irgendeine Länge oder einen anderen Winkel
    // des Profils zu verändern: vertex bleibt fest, der gesamte
    // nachfolgende Teil der Kette ab p2 wird als starrer Körper um vertex
    // gedreht (Drehwinkel = neuer minus alter Richtungswinkel von vertex zu
    // p2). Eine reine Rotation um vertex ändert weder Abstände noch Winkel
    // innerhalb des mitgedrehten Teils, nur dessen Ausrichtung im Raum.
    applyAngle(label, newValue) {
        const geom = this.getAngleGeometry(label);
        if (!geom) return;

        const vertexIndex = label.vertexIndex;
        const oldDirAngle = Math.atan2(geom.p2.y - geom.vertex.y, geom.p2.x - geom.vertex.x);

        const newP2 = Geometry.pointAtAngle(geom.p1, geom.vertex, geom.p2, newValue);
        const newDirAngle = Math.atan2(newP2.y - geom.vertex.y, newP2.x - geom.vertex.x);

        let delta = newDirAngle - oldDirAngle;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;

        const downstream = Geometry.collectDownstreamPoints(this.profile, geom.angleSeg.endIndex, vertexIndex);
        downstream.forEach(idx => {
            const pt = this.profile.points[idx];
            const rotated = Geometry.rotatePointAround(geom.vertex, pt, delta);
            pt.x = rotated.x;
            pt.y = rotated.y;
        });

        geom.angleSeg.angleLocked = this.pendingLocked;
        geom.angleSeg.lockedAngle = this.pendingLocked ? newValue : undefined;
    }
}
