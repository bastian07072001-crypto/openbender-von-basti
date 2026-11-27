import { Geometry } from '../utils/Geometry.js';
import { DimensionLayout } from '../utils/DimensionLayout.js';
import { globalEventBus } from '../utils/EventBus.js';
import { sheetLook, sheetMaterial, sheetEnvironment, applySheetLook } from '../utils/SheetLook.js';
import { CHANGED_EVENT } from '../utils/Materials.js';

// Seitlicher Versatz (mm) für die schematische Umschlag-Darstellung – muss
// zum gleichnamigen Wert in CanvasRenderer.js passen, damit 2D- und
// 3D-Ansicht den Umschlag konsistent darstellen.
const HEM_FOLD_OFFSET_MM = 2.5;

// Realistischer minimaler Biegeradius (mm) für eine Mittelrippe (zwei
// Schenkel, die sich beide gegenseitig als Vorgänger-Linie nehmen) – siehe
// CanvasRenderer.js. Muss zum gleichnamigen Wert dort passen.
const PEAK_ROUNDING_RADIUS_MM = 1.5;

// Standardlänge des Blechs, solange in der Stückliste nichts steht
const DEFAULT_SHEET_LENGTH_MM = 500;

// Innerer Biegeradius (mm) für die gerundeten Kanten der 3D-Darstellung
const BEND_RADIUS_MM = 2;

// Stützpunkte pro gerundeter Kante. Fest, damit vorderer und hinterer
// Querschnitt immer gleich viele Punkte haben (Verbindung Punkt zu Punkt).
const BEND_SAMPLES = 8;

const LENGTH_COLOR = '#27ae60';
const ANGLE_COLOR = '#8e44ad';
const TITLE_COLORS = { front: '#2c3e50', back: '#c0392b' };

// Textsprites: Schriftgrösse und Rand in Pixeln (die Bemassung misst damit ihren Platz)
const SPRITE_FONT_PX = 64;
const SPRITE_PAD = 8;

export class Preview3DController {
    constructor(containerId, profile) {
        this.container = document.getElementById(containerId);
        this.profile = profile;
        this.sheetThickness = null;                 // aus den Projektdaten, sonst 1 mm
        this.sheetLength = DEFAULT_SHEET_LENGTH_MM; // aus der Stückliste, sonst 500 mm
        this.showDimensions = true;

        if (this.container) {
            this.initThree();
        }

        // Hält die 3D-Ansicht auch dann aktuell, wenn das Profil verändert
        // wird, während der 3D-Tab bereits aktiv ist (z.B. "Neu"-Button, der
        // dort ebenfalls anklickbar bleibt, oder JSON-Import) – ohne dies
        // wurde nur beim WECHSEL auf den Tab neu gebaut (siehe main.js
        // switchTab), sodass ein bereits sichtbares altes Profil stehen
        // blieb. Kein Rebuild, während der Tab nicht sichtbar ist, um
        // während normaler 2D-Bearbeitung nicht unnötig Arbeit zu leisten.
        globalEventBus.on('profile:updated', () => {
            if (this.isVisible()) {
                this.update3DModel();
            }
        });
        // Darstellung in den Einstellungen geändert
        document.addEventListener(CHANGED_EVENT, () => this.setMaterialType(this.materialName, this.materialSpec));
    }

    isVisible() {
        return !!(this.container && this.container.offsetParent !== null);
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf5f5f5);

        const width = this.container.clientWidth || 800;
        const height = this.container.clientHeight || 600;

        this.camera = new THREE.PerspectiveCamera(45, width / height, 1, 10000);
        this.camera.position.set(500, 500, 1500);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(width, height);
        this.container.appendChild(this.renderer.domElement);
        // Umgebung zum Spiegeln, sonst wird glänzendes Metall schwarz
        this.scene.environment = sheetEnvironment(this.renderer);

        // 1. Umgebungslicht
        const ambientLight = new THREE.AmbientLight(0xD3D3D3, 0.7);
        this.scene.add(ambientLight);

        // 2. Hauptlicht
        const mainLight = new THREE.DirectionalLight(0x708090, 1.2);
        mainLight.position.set(500, 1000, 750);
        this.scene.add(mainLight);

        // 3. Fülllicht
        const fillLight = new THREE.DirectionalLight(0xfaebd7, 0.7);
        fillLight.position.set(-500, -500, -500);
        this.scene.add(fillLight);

        if (typeof THREE.OrbitControls !== 'undefined') {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        }

        this.animate();
    }

    animate = () => {
        requestAnimationFrame(this.animate);
        if (this.controls) this.controls.update();
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    };

    setMaterialType(materialName, spec) {
        this.materialName = materialName || '';
        this.materialSpec = spec || '';
        if (this.currentMesh && this.currentMesh.material) {
            applySheetLook(this.currentMesh.material, sheetLook(this.materialName, this.materialSpec));
        }
    }


    setSheetThickness(thickness) {
        const t = parseFloat(thickness);
        this.sheetThickness = t > 0 ? t : null;
    }

    setSheetLength(lengthMm) {
        this.sheetLength = lengthMm > 0 ? lengthMm : DEFAULT_SHEET_LENGTH_MM;
    }

    setShowDimensions(show) {
        this.showDimensions = !!show;
        if (this.dimGroup) this.dimGroup.visible = this.showDimensions;
    }

    clearModel() {
        if (this.currentMesh) {
            this.scene.remove(this.currentMesh);
            this.currentMesh.geometry.dispose();
            this.currentMesh.material.dispose();
            this.currentMesh = null;
        }
        if (this.dimGroup) {
            this.scene.remove(this.dimGroup);
            this.dimGroup.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (obj.material.map) obj.material.map.dispose();
                    obj.material.dispose();
                }
            });
            this.dimGroup = null;
        }
    }

    /**
     * Baut das Blech als Körper zwischen vorderem (z = +L/2) und hinterem
     * Querschnitt (z = −L/2). Beim konischen Profil ist der hintere
     * Querschnitt das hintere Profilende (Profile.computeBackGeometry),
     * sonst identisch mit dem vorderen – dann entsteht ein normales Prisma.
     */
    update3DModel() {
        if (!this.scene) return;
        this.clearModel();

        const front = this.profile.points;
        const segments = this.profile.segments || [];
        if (!front || front.length < 2 || segments.length === 0) return;

        const back = this.profile.conical ? this.profile.computeBackGeometry().points : front;
        const thickness = this.sheetThickness || 1.0;
        const length = this.sheetLength || DEFAULT_SHEET_LENGTH_MM;

        // Zentrierung über beide Profilenden (2D: y nach unten, 3D: y nach oben)
        const frontMesh = this.getSchematicMeshPoints(front);
        const backMesh = this.getSchematicMeshPoints(back);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        [...frontMesh, ...backMesh].forEach(p => {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, -p.y); maxY = Math.max(maxY, -p.y);
        });
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const toLocal = (p) => ({ x: p.x - cx, y: -p.y - cy });

        let frontRing = this.buildOutline(frontMesh.map(toLocal), thickness, BEND_RADIUS_MM);
        let backRing = this.buildOutline(backMesh.map(toLocal), thickness, BEND_RADIUS_MM);
        if (frontRing.length !== backRing.length) {
            // Sollte bei gleichem Aufbau nicht vorkommen – zur Sicherheit
            // beide Querschnitte gleich fein nachrechnen.
            const n = Math.max(frontRing.length, backRing.length);
            frontRing = this.resampleRing(frontRing, n);
            backRing = this.resampleRing(backRing, n);
        }

        const zFront = length / 2;
        const zBack = -length / 2;
        const geometry = this.buildLoftGeometry(frontRing, backRing, zFront, zBack);

        const material = sheetMaterial(sheetLook(this.materialName || '', this.materialSpec));

        this.currentMesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.currentMesh);

        const crossSize = Math.hypot(maxX - minX, maxY - minY);
        this.buildDimensions(front, back, toLocal, zFront, zBack, crossSize);
    }

    /**
     * Geschlossene Kontur eines Querschnitts: Aussenlinie vorwärts, um die
     * Blechstärke versetzte Innenlinie rückwärts. Kanten gerundet, mit fester
     * Punktzahl pro Kante (siehe roundedPolyline).
     */
    buildOutline(localPts, thickness, radius) {
        const innerPts = localPts.map((curr, i) => {
            const prev = localPts[i - 1] || curr;
            const next = localPts[i + 1] || curr;

            let nx1 = -(curr.y - prev.y), ny1 = curr.x - prev.x;
            const len1 = Math.hypot(nx1, ny1) || 1;
            nx1 /= len1; ny1 /= len1;

            let nx2 = -(next.y - curr.y), ny2 = next.x - curr.x;
            const len2 = Math.hypot(nx2, ny2) || 1;
            nx2 /= len2; ny2 /= len2;

            const nx = nx1 + nx2, ny = ny1 + ny2;
            const len = Math.hypot(nx, ny) || 1;
            return { x: curr.x + (nx / len) * thickness, y: curr.y + (ny / len) * thickness };
        });

        const outer = this.roundedPolyline(localPts, radius + thickness);
        const inner = this.roundedPolyline(innerPts.reverse(), radius);
        return [...outer, ...inner];
    }

    // Polylinie mit gerundeten Ecken (quadratische Bézierkurve je Ecke),
    // immer BEND_SAMPLES + 1 Punkte pro Ecke – auch wenn die Rundung
    // mangels Platz auf einen Punkt zusammenfällt.
    roundedPolyline(points, r) {
        const out = [points[0]];
        for (let i = 1; i < points.length - 1; i++) {
            const p0 = points[i - 1], p1 = points[i], p2 = points[i + 1];
            const d0 = Math.hypot(p0.x - p1.x, p0.y - p1.y);
            const d1 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const v0 = { x: (p0.x - p1.x) / (d0 || 1), y: (p0.y - p1.y) / (d0 || 1) };
            const v1 = { x: (p2.x - p1.x) / (d1 || 1), y: (p2.y - p1.y) / (d1 || 1) };

            const angle = Math.acos(Math.max(-1, Math.min(1, v0.x * v1.x + v0.y * v1.y)));
            let tanLen = Math.min(r / Math.tan(angle / 2), d0 / 2, d1 / 2);
            if (!Number.isFinite(tanLen) || tanLen < 0) tanLen = 0;

            const a = { x: p1.x + v0.x * tanLen, y: p1.y + v0.y * tanLen };
            const b = { x: p1.x + v1.x * tanLen, y: p1.y + v1.y * tanLen };
            for (let k = 0; k <= BEND_SAMPLES; k++) {
                const t = k / BEND_SAMPLES;
                const w0 = (1 - t) * (1 - t), w1 = 2 * (1 - t) * t, w2 = t * t;
                out.push({ x: w0 * a.x + w1 * p1.x + w2 * b.x, y: w0 * a.y + w1 * p1.y + w2 * b.y });
            }
        }
        out.push(points[points.length - 1]);
        return out;
    }

    // Geschlossene Kontur nach Bogenlänge gleichmässig in n Punkte teilen
    resampleRing(ring, n) {
        const closed = [...ring, ring[0]];
        const cum = [0];
        for (let i = 1; i < closed.length; i++) {
            cum.push(cum[i - 1] + Math.hypot(closed[i].x - closed[i - 1].x, closed[i].y - closed[i - 1].y));
        }
        const total = cum[cum.length - 1] || 1;
        const out = [];
        let seg = 1;
        for (let k = 0; k < n; k++) {
            const target = total * k / n;
            while (seg < closed.length - 1 && cum[seg] < target) seg++;
            const span = (cum[seg] - cum[seg - 1]) || 1;
            const t = (target - cum[seg - 1]) / span;
            const a = closed[seg - 1], b = closed[seg];
            out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
        return out;
    }

    /**
     * Körper aus zwei Querschnitten mit gleicher Punktzahl: Mantelflächen
     * Punkt zu Punkt, Stirnflächen je einzeln trianguliert. Ohne Index
     * (flache Schattierung wie bisher bei ExtrudeGeometry).
     */
    buildLoftGeometry(frontRing, backRing, zFront, zBack) {
        const pos = [];
        const uv = [];
        // Texturkoordinaten in mm: u quer über die Abwicklung, v längs (z)
        const tri = (a, za, ua, b, zb, ub, c, zc, uc) => {
            pos.push(a.x, a.y, za, b.x, b.y, zb, c.x, c.y, zc);
            uv.push(ua, za, ub, zb, uc, zc);
        };
        const uFront = this.ringU(frontRing);
        const uBack = this.ringU(backRing);

        const n = frontRing.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            tri(frontRing[i], zFront, uFront[i], backRing[i], zBack, uBack[i], backRing[j], zBack, uBack[j]);
            tri(frontRing[i], zFront, uFront[i], backRing[j], zBack, uBack[j], frontRing[j], zFront, uFront[j]);
        }

        const cap = (ring, z) => {
            // Doppelte aufeinanderfolgende Punkte stören die Triangulierung
            const pts = ring.filter((p, i) => {
                const q = ring[(i + ring.length - 1) % ring.length];
                return Math.hypot(p.x - q.x, p.y - q.y) > 1e-6;
            });
            if (pts.length < 3) return;
            const faces = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p.x, p.y)), []);
            // Stirnfläche: Textur nach x/y (nur die Blechdicke sichtbar)
            faces.forEach(([a, b, c]) => {
                pos.push(pts[a].x, pts[a].y, z, pts[b].x, pts[b].y, z, pts[c].x, pts[c].y, z);
                uv.push(pts[a].x, pts[a].y, pts[b].x, pts[b].y, pts[c].x, pts[c].y);
            });
        };
        cap(frontRing, zFront);
        cap(backRing, zBack);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geometry.computeVertexNormals();
        return geometry;
    }

    /**
     * u-Koordinate (mm) je Punkt eines Querschnitts: Bogenlänge ab dem Anfang
     * des Profils. Der Ring ist Aussenlinie vorwärts + Innenlinie rückwärts
     * (buildOutline, gleich viele Punkte); die Innenlinie wird ebenfalls ab dem
     * Anfang gemessen, damit ein Lochblech auf beiden Seiten deckungsgleich ist.
     */
    ringU(ring) {
        const n = ring.length;
        const cum = (pts) => {
            const out = [0];
            for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
            return out;
        };
        if (n % 2 !== 0) return cum(ring); // nachgerechneter Ring: einfach der Reihe nach
        const k = n / 2;
        const outer = cum(ring.slice(0, k));
        const inner = cum(ring.slice(k).reverse());
        return [...outer, ...inner.reverse()];
    }

    // Kamera leicht schräg von vorne ausrichten. Eingepasst wird das vordere Ende
    // (Querschnitt mit Bemassung und ein Stück Blech dahinter), der Rest läuft
    // perspektivisch nach hinten – sonst wird das Profil bei langen Blechen zum
    // Strich und die Masse unlesbar. Fast frontal, weil die Beschriftung immer
    // zur Kamera zeigt: von schräg wird die Stirnseite schmaler, die Texte nicht,
    // und sie rücken zusammen.
    fitCamera() {
        if (!this.currentMesh || !this.camera) return;
        const box = new THREE.Box3().setFromObject(this.currentMesh);
        const cross = Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
        // vordere Stirnseite mit einem kurzen Stück Blech; die Bemassung samt Textbreite
        // (Sprites zählen nur mit ihrem Mittelpunkt, darum ein Rand von einem Zehntel)
        box.min.z = Math.max(box.min.z, box.max.z - 0.3 * cross);
        if (this.dimGroup && this.dimGroup.visible) box.union(new THREE.Box3().setFromObject(this.dimGroup));
        box.expandByVector(new THREE.Vector3(0.1 * cross, 0.1 * cross, 0));
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const fov = this.camera.fov * Math.PI / 180;
        const aspect = this.camera.aspect || 1;
        // im Hochformat (Handy) begrenzt die Breite
        const halb = Math.min(fov / 2, Math.atan(Math.tan(fov / 2) * aspect));
        const dist = sphere.radius / Math.sin(halb);
        const dir = new THREE.Vector3(0.38, 0.32, 1).normalize();

        this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
        this.camera.near = Math.max(0.1, dist / 1000);
        this.camera.far = dist * 20;
        this.camera.updateProjectionMatrix();
        if (this.controls) {
            this.controls.target.copy(sphere.center);
            this.controls.update();
        } else {
            this.camera.lookAt(sphere.center);
        }
    }

    getOrderedPointIndices() {
        const segments = this.profile.segments;
        const points = this.profile.points;

        if (!points || points.length === 0) return [];
        if (!segments || segments.length === 0) return points.map((_, index) => index);

        const adjacency = new Map();
        points.forEach((_, index) => adjacency.set(index, []));

        segments.forEach(seg => {
            if (adjacency.has(seg.startIndex) && adjacency.has(seg.endIndex)) {
                adjacency.get(seg.startIndex).push(seg.endIndex);
                adjacency.get(seg.endIndex).push(seg.startIndex);
            }
        });

        let startNode = 0;
        for (const [node, neighbors] of adjacency.entries()) {
            if (neighbors.length === 1) {
                startNode = node;
                break;
            }
        }

        const visited = new Set();
        const orderedIndices = [];
        let currentNode = startNode;

        while (currentNode !== undefined && !visited.has(currentNode)) {
            visited.add(currentNode);
            orderedIndices.push(currentNode);

            const neighbors = adjacency.get(currentNode) || [];
            currentNode = neighbors.find(next => !visited.has(next));
        }

        if (orderedIndices.length < points.length) {
            return points.map((_, index) => index);
        }

        return orderedIndices;
    }

    /**
     * Punkte entlang der Profilkette (Reihenfolge aus getOrderedPointIndices),
     * aber Umschlag/Saum-Kanten (seg.type === 'hem')
     * werden nicht mit ihrem tatsächlichen (oft fast 180°) Winkel
     * übernommen, sondern durch eine fein unterteilte Kappe + versetzte
     * Linie ersetzt (siehe Geometry.computeFoldLayout, gleiche Darstellung
     * wie im 2D-Editor). Ohne das entsteht beim Wandstärken-Offset in
     * update3DModel() ein "Spike": Bei einer Kante, die fast exakt
     * gegenläufig zur Vorgänger-Kante ist, heben sich die gemittelten
     * Kantennormalen nahezu auf – die Normalisierung eines Vektors nahe Null
     * schießt den versetzten Punkt beliebig weit hinaus. Die feine
     * Unterteilung sorgt dafür, dass an keiner Stelle des Pfads mehr ein
     * einzelner scharfer Knick nahe 180° auftritt.
     *
     * Den "Vorgänger"-Punkt (p1) eines Umschlags über die Position im
     * durchlaufenen Pfad zu bestimmen (indices[i-2]) funktioniert NICHT,
     * sobald ein Umschlag am Anfang des Pfades liegt (z.B. ein Profil mit
     * Umschlägen an beiden Enden – die Traversierung startet zwangsläufig an
     * einem der beiden und durchläuft dessen Umschlag-Segment dann
     * "rückwärts", von der Umschlag-Spitze zum Scheitelpunkt hin, ohne dass
     * es einen Punkt "davor" gibt). Die Falz-Geometrie kommt daher aus der
     * Segment-Topologie (Geometry.computeFoldLayout, unabhängig von der
     * Durchlaufrichtung), die Kappe wird passend zur Richtung eingefügt.
     */
    getSchematicMeshPoints(points = this.profile.points) {
        const indices = this.getOrderedPointIndices();
        const segments = this.profile.segments;

        if (indices.length < 2) return indices.map(idx => points[idx]);

        const findSegment = (aIdx, bIdx) => segments.find(seg =>
            (seg.startIndex === aIdx && seg.endIndex === bIdx) ||
            (seg.startIndex === bIdx && seg.endIndex === aIdx)
        );

        // Umschläge: gleiche Endpunkte + Kappen wie 2D/PDF/DXF (siehe
        // Geometry.computeFoldLayout). Beim Durchlaufen des Pfads wird an
        // einem Falz zwischen zwei aufeinanderfolgenden Segmenten die Kappe
        // eingefügt – in der zum Durchlauf passenden Richtung.
        const layout = Geometry.computeFoldLayout(points, segments, HEM_FOLD_OFFSET_MM, 8);
        const findCap = (segA, segB) => {
            const fold = layout.folds.find(f =>
                (f.segIndex === segA && f.baseIndex === segB) || (f.segIndex === segB && f.baseIndex === segA)
            );
            return fold ? fold.cap : null;
        };
        const same = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;

        const result = [];
        let prevSegIndex = -1;
        let afterPeak = false;

        for (let i = 1; i < indices.length; i++) {
            const prevIdx = indices[i - 1];
            const currIdx = indices[i];
            const seg = findSegment(prevIdx, currIdx);

            if (!seg) {
                if (result.length === 0) result.push(points[prevIdx]);
                result.push(points[currIdx]);
                prevSegIndex = -1;
                afterPeak = false;
                continue;
            }

            const segIndex = segments.indexOf(seg);
            const start = Geometry.foldEndpoint(layout, segIndex, prevIdx, points);
            const end = Geometry.foldEndpoint(layout, segIndex, currIdx, points);

            if (result.length === 0) {
                result.push(start);
            } else {
                const cap = findCap(prevSegIndex, segIndex);
                const last = result[result.length - 1];
                if (cap) {
                    const ordered = same(cap[0], last) ? cap : [...cap].reverse();
                    ordered.slice(1).forEach(p => result.push(p));
                } else if (!afterPeak && !same(last, start)) {
                    result.push(start);
                }
            }
            afterPeak = false;
            prevSegIndex = segIndex;

            // Mittelrippen-Sonderfall (Basis ist selbst ein Umschlag, nicht
            // im Layout): beim Ankommen am Scheitelpunkt eine kleine Rundung
            // statt der scharfen Spitze einfügen; das nächste Segment läuft
            // vom letzten Bogenpunkt aus weiter.
            if (seg.type === 'hem' && !layout.hemIndices.has(segIndex) && currIdx === seg.hemVertexIndex) {
                const partner = Geometry.getHemBaseSegment(segments, seg);
                if (partner && partner.type === 'hem') {
                    const farIdx = (partner.startIndex === currIdx) ? partner.endIndex : partner.startIndex;
                    const farPoint = points[farIdx];
                    if (farPoint) {
                        const corner = Geometry.computeRoundedCorner(points[prevIdx], points[currIdx], farPoint, PEAK_ROUNDING_RADIUS_MM);
                        corner.points.forEach(p => result.push(p));
                        afterPeak = true;
                        continue;
                    }
                }
            }

            result.push(end);
        }

        return result;
    }

    /**
     * Bemassung beider Stirnseiten, gleiche Platzierung wie im 2D-Editor
     * (DimensionLayout): Masslinien mit Hilfslinien und Pfeilen. Vorne
     * zusätzlich die Winkel (sie gelten für beide Enden). Liegt knapp vor
     * der jeweiligen Stirnfläche; Texte als Sprites ohne Hintergrund.
     * Grössen wachsen mit dem Querschnitt, damit sie lesbar bleiben.
     */
    buildDimensions(front, back, toLocal, zFront, zBack, crossSize) {
        const group = new THREE.Group();
        group.name = 'dimensionsGroup';
        group.visible = this.showDimensions;

        const k = Math.max(1, crossSize / 150);
        const textHeight = 6.5 * k;
        // Platz so berechnen, wie createTextSprite zeichnet: fett, mit Rand (SPRITE_PAD) –
        // sonst sind die Texte grösser als der freigehaltene Platz und überlappen
        const measureCtx = document.createElement('canvas').getContext('2d');
        measureCtx.font = `bold ${SPRITE_FONT_PX}px sans-serif`;
        const zuWelt = textHeight / SPRITE_FONT_PX;
        const measure = (text) => (measureCtx.measureText(text).width + 2 * SPRITE_PAD) * zuWelt;
        const boxHeight = (SPRITE_FONT_PX + 2 * SPRITE_PAD) * zuWelt;

        const ends = [{ points: front, z: zFront + 0.5, side: 'front', title: 'vorne', angles: true }];
        if (this.profile.conical) {
            ends.push({ points: back, z: zBack - 0.5, side: 'back', title: 'hinten', angles: false });
        }

        ends.forEach(end => {
            const layout = DimensionLayout.compute(end.points, this.profile.segments, {
                textHeight: boxHeight,
                measure,
                decorate: (text) => text,
                dimOffset: 5 * k,
                offsetStep: 8 * k,
                maxOffsetSteps: 3,
                extGap: 1.2 * k,
                extOverhang: 1.5 * k,
                arrowSize: 2 * k,
                textGap: 1 * k,
                arcRadius: (minLen) => Math.max(2.5 * k, Math.min(7 * k, minLen * 0.3)),
                squareSize: 3 * k,
                pointRadius: 0.5 * k,
                foldOffset: HEM_FOLD_OFFSET_MM
            });

            const v3 = (p) => { const l = toLocal(p); return new THREE.Vector3(l.x, l.y, end.z); };
            const addLines = (polylines, color) => {
                const verts = [];
                polylines.forEach(pts => {
                    for (let i = 1; i < pts.length; i++) verts.push(v3(pts[i - 1]), v3(pts[i]));
                });
                if (verts.length === 0) return;
                const geom = new THREE.BufferGeometry().setFromPoints(verts);
                group.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color })));
            };

            addLines(layout.lengths.flatMap(dim => dim.lines), LENGTH_COLOR);
            const arrowVerts = [];
            layout.lengths.forEach(dim => dim.arrows.forEach(({ tip, dir }) => {
                const size = 2 * k;
                const base = { x: tip.x - dir.x * size, y: tip.y - dir.y * size };
                const px = -dir.y * size * 0.35, py = dir.x * size * 0.35;
                arrowVerts.push(v3(tip), v3({ x: base.x + px, y: base.y + py }), v3({ x: base.x - px, y: base.y - py }));
            }));
            if (arrowVerts.length > 0) {
                const geom = new THREE.BufferGeometry().setFromPoints(arrowVerts);
                group.add(new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: LENGTH_COLOR, side: THREE.DoubleSide })));
            }

            if (end.angles) {
                addLines(layout.angles.flatMap(a => [a.arc, a.square, a.leader].filter(Boolean)), ANGLE_COLOR);
            }

            layout.labels.forEach(label => {
                if (label.hitOnly) return;
                if (label.type === 'angle' && !end.angles) return;
                const sprite = this.createTextSprite(label.text, label.type === 'angle' ? ANGLE_COLOR : LENGTH_COLOR, textHeight);
                sprite.position.copy(v3(label));
                group.add(sprite);
            });

            // Beschriftung "vorne" / "hinten" oberhalb des Querschnitts
            let top = Infinity, left = Infinity;
            end.points.forEach(p => { top = Math.min(top, p.y); left = Math.min(left, p.x); });
            const title = this.createTextSprite(end.title, TITLE_COLORS[end.side], textHeight * 1.3);
            const anchor = toLocal({ x: left, y: top });
            title.position.set(anchor.x, anchor.y + textHeight * 3.5, end.z);
            group.add(title);
        });

        this.dimGroup = group;
        this.scene.add(group);
    }

    // Text als Sprite (zeigt immer zur Kamera), ohne Hintergrundkasten; ein
    // dünner heller Rand hält ihn auf dem Blech lesbar. heightWorld = Texthöhe in mm.
    createTextSprite(text, color, heightWorld) {
        const fontPx = SPRITE_FONT_PX;
        const pad = SPRITE_PAD;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = `bold ${fontPx}px sans-serif`;
        const width = Math.ceil(ctx.measureText(text).width) + pad * 2;
        canvas.width = width;
        canvas.height = fontPx + pad * 2;

        ctx.font = `bold ${fontPx}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 8;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.strokeText(text, width / 2, canvas.height / 2);
        ctx.fillStyle = color;
        ctx.fillText(text, width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
        const h = heightWorld * canvas.height / fontPx;
        sprite.scale.set(h * width / canvas.height, h, 1);
        return sprite;
    }

    resize() {
        if (!this.container || !this.renderer || !this.camera) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (width === 0 || height === 0) return;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
}
