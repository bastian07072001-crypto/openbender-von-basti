/**
 * Eigene Profilvorlagen: aus einem gezeichneten Profil erstellt, im
 * Speicherordner im Unterordner "Vorlagen" abgelegt (eine JSON-Datei pro
 * Vorlage) und im Dialog "Profil aus Vorlage" verwendet.
 *
 * Eine Vorlage speichert das Profil als Folge von Schenkeln (Länge und
 * Richtungsänderung, wie api.profile.build) und welche Längen und Winkel
 * beim Verwenden veränderbar sind:
 *
 *   { format: 'openbender-vorlage', version: 1, name, category, description,
 *     created, start: { x, y }, direction, conical,
 *     steps: [{ length, turn, backLength? }],
 *     params: [{ key, label, kind: 'length' | 'angle', index, value }] }
 *
 *   kind 'length': Länge von Schenkel index
 *   kind 'angle':  Innenwinkel zwischen Schenkel index-1 und index (wie im
 *                  Editor angezeigt); die Knickrichtung bleibt wie gezeichnet
 */
import { FolderStorage } from '../storage/FolderStorage.js';
import { ErpStorage } from '../storage/ErpStorage.js';
import { buildProfile } from '../modules/ModuleData.js';

export const TEMPLATE_DIR = 'Vorlagen';
const FORMAT = 'openbender-vorlage';

const deg = (rad) => rad * 180 / Math.PI;
const round = (v, f = 100) => Math.round(v * f) / f;

/**
 * Gezeichnetes Profil als Schenkelfolge. Nur zusammenhängende Linienzüge
 * ohne Verzweigung. Ergebnis { start, direction, steps } oder { error }.
 */
export function profileToSteps(profileData) {
    const points = profileData.points || [];
    const segments = profileData.segments || [];
    if (segments.length === 0) return { error: 'Das Profil hat noch keine Schenkel.' };

    const adj = new Map();
    segments.forEach((s, i) => {
        [s.startIndex, s.endIndex].forEach(p => {
            if (!adj.has(p)) adj.set(p, []);
            adj.get(p).push(i);
        });
    });
    if ([...adj.values()].some(list => list.length > 2)) {
        return { error: 'Das Profil verzweigt sich – als Vorlage gehen nur durchgehende Linienzüge.' };
    }
    const ends = [...adj.entries()].filter(([, list]) => list.length === 1).map(([p]) => p);
    if (ends.length !== 2) return { error: 'Das Profil ist kein offener Linienzug.' };

    // Beim Punkt 0 beginnen, falls er ein Ende ist (so wie gezeichnet)
    let current = ends.includes(0) ? 0 : Math.min(...ends);
    const used = new Set();
    const chain = [current];
    const chainSegs = [];
    while (true) {
        const next = (adj.get(current) || []).find(i => !used.has(i));
        if (next === undefined) break;
        used.add(next);
        chainSegs.push(segments[next]);
        const s = segments[next];
        current = s.startIndex === current ? s.endIndex : s.startIndex;
        chain.push(current);
    }
    if (used.size !== segments.length) return { error: 'Das Profil besteht aus mehreren Teilen.' };

    // Richtung wie auf dem Bildschirm: 0° = rechts, 90° = oben (y im Profil nach unten)
    const dirs = [];
    const steps = [];
    for (let i = 1; i < chain.length; i++) {
        const a = points[chain[i - 1]], b = points[chain[i]];
        const dx = b.x - a.x, dy = b.y - a.y;
        dirs.push(deg(Math.atan2(-dy, dx)));
        const step = { length: round(Math.hypot(dx, dy)), turn: 0 };
        const back = chainSegs[i - 1].backLength;
        if (profileData.conical && Number.isFinite(back) && back > 0) step.backLength = round(back);
        steps.push(step);
    }
    for (let i = 1; i < steps.length; i++) {
        let t = dirs[i] - dirs[i - 1];
        while (t > 180) t -= 360;
        while (t <= -180) t += 360;
        steps[i].turn = round(t, 1000);
    }
    const p0 = points[chain[0]];
    return { start: { x: round(p0.x), y: round(p0.y) }, direction: round(dirs[0], 1000), conical: profileData.conical === true, steps };
}

/** Innenwinkel aus einer Richtungsänderung (wie im Editor: 90° = rechtwinklig) */
export function innerAngle(turn) {
    return round(180 - Math.abs(turn), 100);
}

/** Schenkel einer Vorlage mit eingesetzten Werten (für api.profile.build) */
export function stepsWithValues(template, values) {
    const steps = template.steps.map(s => ({ ...s }));
    (template.params || []).forEach(p => {
        const v = Number(values[p.key]);
        if (!Number.isFinite(v)) return;
        if (p.kind === 'length' && steps[p.index]) {
            // konisch: hinten um gleich viel ändern wie vorne
            const step = steps[p.index];
            if (step.backLength) step.backLength = Math.max(1, step.backLength + v - step.length);
            step.length = v;
        }
        if (p.kind === 'angle' && steps[p.index]) {
            const sign = steps[p.index].turn < 0 ? -1 : 1;
            steps[p.index].turn = sign * (180 - v);
        }
    });
    return steps;
}

/** Eingabefelder der Vorlage (für den Vorlagen-Dialog) */
export function templateFields(template) {
    return (template.params || []).map(p => (p.kind === 'angle'
        ? { key: p.key, label: p.label, type: 'number', unit: '°', value: p.value, min: 0, max: 180 }
        : { key: p.key, label: p.label, type: 'number', unit: 'mm', value: p.value, min: 1 }));
}

/**
 * Vorschau-SVG des Profils mit Bezeichnungen: veränderbare Werte farbig mit
 * ihrer Bezeichnung, feste Werte grau mit der Schenkel-Nummer.
 * shape: { steps, start, direction }; rows: [{ kind, index, on, label }]
 */
export function templatePreviewSvg(shape, rows) {
    const profile = buildProfile(shape.steps, { start: shape.start, direction: shape.direction });
    const pts = profile.points;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(p => {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    const size = Math.max(maxX - minX, maxY - minY, 1);
    const font = size * 0.065;
    const stroke = size * 0.012;
    const gap = font * 0.5;

    // Beschriftung neben dem Schenkel (links in Zeichenrichtung) bzw. auf der
    // Innenseite des Knicks; Textanker je nach Seite, damit lange
    // Bezeichnungen vom Profil weg laufen
    const labels = [];
    rows.forEach((r, n) => {
        const text = r.on ? (r.label.trim() || '?') : (r.kind === 'length' ? String(r.index + 1) : '');
        if (!text) return;
        let ax, ay, dx, dy;
        if (r.kind === 'length') {
            const a = pts[r.index], b = pts[r.index + 1];
            const u = unit(b.x - a.x, b.y - a.y);
            ax = (a.x + b.x) / 2; ay = (a.y + b.y) / 2;
            dx = u.y; dy = -u.x;
        } else {
            const a = pts[r.index - 1], v = pts[r.index], b = pts[r.index + 1];
            const u1 = unit(a.x - v.x, a.y - v.y), u2 = unit(b.x - v.x, b.y - v.y);
            let bx = u1.x + u2.x, by = u1.y + u2.y;
            if (Math.hypot(bx, by) < 1e-6) { bx = -u1.y; by = u1.x; }
            const u = unit(bx, by);
            ax = v.x; ay = v.y; dx = u.x; dy = u.y;
        }
        // Winkel weiter weg vom Knick, damit der Text keinen Schenkel kreuzt
        const dist = r.kind === 'angle' ? font * 1.5 : gap;
        const anchor = dx > 0.35 ? 'start' : (dx < -0.35 ? 'end' : 'middle');
        const x = ax + dx * dist;
        const y = ay + dy * dist + (Math.abs(dx) <= 0.35 ? Math.sign(dy) * font * 0.5 : 0);
        const w = text.length * font * 0.6;
        const left = anchor === 'start' ? x : (anchor === 'end' ? x - w : x - w / 2);
        minX = Math.min(minX, left); maxX = Math.max(maxX, left + w);
        minY = Math.min(minY, y - font * 0.6); maxY = Math.max(maxY, y + font * 0.6);
        labels.push(`<text data-n="${n}" class="${r.on ? 'on' : 'off'}" x="${x}" y="${y}" font-size="${font}" text-anchor="${anchor}" dominant-baseline="central">${esc(text)}</text>`);
    });

    const pad = font * 0.6;
    const vb = `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
    return `<svg viewBox="${vb}" class="tplsave-svg" xmlns="http://www.w3.org/2000/svg">
        <path d="${path}" fill="none" stroke="#2c3e50" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${pts[0].x}" cy="${pts[0].y}" r="${stroke * 1.8}" fill="#e67e22"/>
        ${labels.join('')}</svg>`;
}

/** Zeilen für templatePreviewSvg: veränderbare Werte mit Bezeichnung, übrige Schenkel nummeriert */
export function templatePreviewRows(template) {
    const rows = (template.params || []).map(p => ({ kind: p.kind, index: p.index, on: true, label: p.label }));
    template.steps.forEach((s, i) => {
        if (!rows.some(r => r.kind === 'length' && r.index === i)) rows.push({ kind: 'length', index: i, on: false, label: '' });
    });
    return rows;
}

function esc(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function unit(x, y) {
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
}

function validTemplate(t) {
    return t && t.format === FORMAT && Array.isArray(t.steps) && t.steps.length > 0 && typeof t.name === 'string';
}

export function fileNameFor(name) {
    return `${String(name).trim().replace(/[\\/:*?"<>|]+/g, '_') || 'Vorlage'}.json`;
}

/**
 * Zugriff auf den Ordner "Vorlagen" im Speicherordner.
 * interactive = true nur aus einem Klick (der Browser fragt evtl. nach).
 */
async function templateDir(interactive, create) {
    if (!FolderStorage.isSupported()) return { error: 'Eigene Vorlagen brauchen einen Speicherordner (Chrome oder Edge, auch als installierte App).' };
    const root = await FolderStorage.getRoot();
    if (!root) return { error: 'Bitte zuerst in den Einstellungen (⚙️ in der Statusleiste) unter „Allgemein“ einen Speicherordner wählen.' };
    if (!(await FolderStorage.ensurePermission(root, interactive))) return { error: 'Kein Zugriff auf den Speicherordner.' };
    try {
        return { dir: await root.getDirectoryHandle(TEMPLATE_DIR, { create }) };
    } catch (e) {
        return { dir: null };
    }
}

// Ablage im Speicherordner (Unterordner "Vorlagen", eine JSON-Datei je Vorlage)
const Ordner = {
    async list(interactive = false) {
        const { dir } = await templateDir(interactive, false);
        if (!dir) return [];
        const out = [];
        for await (const [name, handle] of dir.entries()) {
            if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.json')) continue;
            try {
                const t = JSON.parse(await (await handle.getFile()).text());
                if (validTemplate(t)) out.push({ file: name, template: t });
            } catch (e) { /* fremde oder beschädigte Datei überspringen */ }
        }
        out.sort((a, b) => a.template.name.localeCompare(b.template.name, 'de'));
        return out;
    },

    async exists(name) {
        const { dir } = await templateDir(true, false);
        return dir ? FolderStorage.exists(dir, fileNameFor(name)) : false;
    },

    async save(data) {
        const { dir, error } = await templateDir(true, true);
        if (!dir) throw new Error(error || 'Der Ordner „Vorlagen“ konnte nicht angelegt werden.');
        await FolderStorage.writeFile(dir, fileNameFor(data.name), JSON.stringify(data, null, 2));
    },

    async remove(file) {
        const { dir, error } = await templateDir(true, false);
        if (!dir) throw new Error(error || 'Ordner „Vorlagen“ nicht gefunden.');
        await FolderStorage.removeFile(dir, file);
    }
};

// Ablage in ERPNext (DocType "OpenBender Vorlage", für den ganzen Betrieb).
// file = Name des Dokuments (= Name der Vorlage)
const Erp = {
    async list() {
        const r = await ErpStorage.call('vorlagen');
        Erp.darfAendern = !!(r && r.darf_aendern);
        return ((r && r.vorlagen) || [])
            .filter(v => validTemplate(v.vorlage))
            .map(v => ({ file: v.name, template: v.vorlage, readOnly: !Erp.darfAendern }))
            .sort((a, b) => a.template.name.localeCompare(b.template.name, 'de'));
    },
    async exists(name) {
        return !!(await ErpStorage.call('vorlage_existiert', { name: String(name).trim() }));
    },
    async save(data) {
        await ErpStorage.call('vorlage_speichern', { vorlage: JSON.stringify(data) }, true);
    },
    async remove(file) {
        await ErpStorage.call('vorlage_loeschen', { name: file }, true);
    },
    darfAendern: false
};

const ablage = () => (ErpStorage.isActive() ? Erp : Ordner);

export const UserTemplates = {
    /** Alle eigenen Vorlagen: [{ file, template, readOnly? }] (ohne Ablage: []) */
    async list(interactive = false) {
        try {
            return await ablage().list(interactive);
        } catch (e) {
            if (ErpStorage.isActive()) console.warn('Vorlagen aus ERPNext:', e);
            return [];
        }
    },

    async exists(name) {
        return ablage().exists(name);
    },

    /** Speichern; wirft einen Fehler mit verständlicher Meldung */
    async save(template) {
        const data = { format: FORMAT, version: 1, created: new Date().toISOString(), ...template };
        await ablage().save(data);
    },

    async remove(file) {
        await ablage().remove(file);
    },

    /** Schlüssel einer Vorlage (für die gemerkten Eingabewerte) */
    fileFor(name) {
        return ErpStorage.isActive() ? String(name).trim() : fileNameFor(name);
    },

    /** Wo die eigenen Vorlagen liegen – für Hinweistexte */
    ort() {
        return ErpStorage.isActive()
            ? 'Die Vorlage wird in ERPNext gespeichert und steht allen im Betrieb zur Verfügung, auf PC und Tablet.'
            : 'Die Vorlage wird im Speicherordner im Unterordner „Vorlagen“ abgelegt.';
    },

    ortListe() {
        return ErpStorage.isActive()
            ? 'Eigene Vorlagen liegen in ERPNext (OpenBender Vorlage) und stehen allen im Betrieb zur Verfügung.'
            : 'Vorlagen liegen im Speicherordner im Unterordner „Vorlagen“ und stehen so allen Arbeitsplätzen mit demselben Ordner zur Verfügung.';
    },

    /** ERPNext: Übernahme der Vorlagen aus dem Speicherordner möglich? */
    importMoeglich() {
        return ErpStorage.isActive() && FolderStorage.isSupported();
    },

    /**
     * ERPNext: Vorlagen aus dem Speicherordner nach ERPNext kopieren.
     * Vorhandene Namen werden nicht überschrieben. Ergebnis { neu, vorhanden, fehler }
     */
    async importFromFolder() {
        const lokal = await Ordner.list(true);
        const { error } = lokal.length ? {} : await templateDir(true, false);
        if (error) throw new Error(error);
        const out = { neu: 0, vorhanden: 0, fehler: [] };
        for (const { template } of lokal) {
            try {
                if (await Erp.exists(template.name)) { out.vorhanden++; continue; }
                await Erp.save(template);
                out.neu++;
            } catch (e) {
                out.fehler.push(`${template.name}: ${e.message || e}`);
            }
        }
        return out;
    }
};
