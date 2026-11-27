/**
 * Aussehen des Blechs in 3D je Material (Farbe, Metallglanz, Rauheit) und
 * die Beleuchtung dazu. Gemeinsam für die 3D Vorschau und Module
 * (api.project.material3d), damit alle 3D-Ansichten gleich aussehen.
 */
export const MATERIAL_PRESETS = {
    // Default-Stahl (Klassisches Rohstahl-Grau)
    steel: {
        color: 0x6e7882,
        metalness: 0.2,
        roughness: 0.4
    },
    // Edelstahl (Sehr hell, hoher Spiegelglanz)
    crni: {
        color: 0xd6dadf,
        metalness: 0.70,
        roughness: 0.5
    },
    // Aluminium (Seidenmattes, helles Silber-Grau)
    alu: {
        color: 0xd6dadf,
        metalness: 0.65,
        roughness: 0.5
    },
    // Verzinktes Blech (Typischer Zinkblumen-Farbton)
    galvanized: {
        color: 0xa3acb4,
        metalness: 0.75,
        roughness: 0.35
    },
    // Titanzink (Matte, leicht blaustichige Patina/Grau)
    zinc: {
        color: 0x6e7882,
        metalness: 0.5,
        roughness: 0.6
    },
    // Kupferblech (Typischer warmer Rotgold-/Kupfer-Farbton)
    copper: {
        color: 0xd97950,
        metalness: 0.5,
        roughness: 0.25
    }
};

export const MATERIAL_MAP = {
    'Stahl': 'steel',
    'CrNi-Stahl': 'crni',
    'Prefalz': 'alu',
    'Aluminium': 'alu',
    'Stahlblech': 'galvanized',
    'Titanzink': 'zinc',
    'Kupfer': 'copper'
};

/** Licht der 3D Vorschau: Umgebungs-, Haupt- und Fülllicht */
export const SHEET_LIGHTS = {
    ambient: { color: 0xd3d3d3, intensity: 0.7 },
    main: { color: 0x708090, intensity: 1.2, position: [500, 1000, 750] },
    fill: { color: 0xfaebd7, intensity: 0.7, position: [-500, -500, -500] },
    background: 0xf5f5f5
};

/**
 * Aussehen für Material (und Ausführung) aus den Projektdaten (Kopie), Standard
 * Stahl. Eine eigene Darstellung der Ausführung („Material|Ausführung“ in
 * MATERIAL_MAP, siehe Materials.js) geht vor der des Materials.
 */
export function sheetLook(materialName, spec) {
    const bySpec = spec ? MATERIAL_MAP[`${materialName}|${spec}`] : null;
    const key = bySpec && MATERIAL_PRESETS[bySpec] ? bySpec
        : MATERIAL_PRESETS[MATERIAL_MAP[materialName]] ? MATERIAL_MAP[materialName]
            : (MATERIAL_PRESETS[materialName] ? materialName : 'steel');
    const preset = MATERIAL_PRESETS[key];
    return { key, ...preset, ...(preset.texture ? { texture: { ...preset.texture } } : {}), lights: JSON.parse(JSON.stringify(SHEET_LIGHTS)) };
}

/**
 * THREE-Material für ein Aussehen (sheetLook bzw. MATERIAL_PRESETS-Eintrag).
 * Einzige Stelle, die das Blech-Material baut (3D Vorschau, Einstellungen).
 * Eine Textur (look.texture) wird nachgeladen; onChange meldet, wenn sie da
 * ist (z.B. zum Neuzeichnen). Die Geometrie braucht Texturkoordinaten in mm
 * (u quer über die Abwicklung, v längs), siehe applySheetLook.
 */
export function sheetMaterial(look, onChange) {
    const mat = new THREE.MeshStandardMaterial({
        roughness: look.roughness,
        metalness: look.metalness,
        envMapIntensity: ENV_INTENSITY,
        side: THREE.DoubleSide
    });
    applySheetLook(mat, look, onChange);
    return mat;
}

const textureCache = new Map(); // URL → Promise<THREE.Texture>

function loadTexture(url) {
    if (!textureCache.has(url)) {
        textureCache.set(url, new Promise((resolve, reject) => {
            new THREE.TextureLoader().load(url, resolve, undefined, () => {
                textureCache.delete(url);
                reject(new Error(`Textur nicht ladbar: ${url}`));
            });
        }));
    }
    return textureCache.get(url);
}

/** Aussehen auf ein bestehendes Material übertragen (Farbe, Glanz, Textur) */
export function applySheetLook(mat, look, onChange) {
    mat.color.set(look.color);
    mat.metalness = look.metalness;
    mat.roughness = look.roughness;
    const tex = look.texture && look.texture.id ? look.texture : null;
    const key = tex ? JSON.stringify(tex) : '';
    if (mat.userData.textureKey === key) { mat.needsUpdate = true; return; }
    mat.userData.textureKey = key;
    const clear = () => {
        if (mat.map) mat.map.dispose();
        mat.map = null;
        mat.alphaTest = 0;
        mat.needsUpdate = true;
    };
    if (!tex) { clear(); return; }
    // Adresse über Textures.js (eigene Texturen liegen im Speicherordner bzw. in ERPNext)
    import('./Textures.js')
        .then(({ Textures }) => Textures.url(tex.id))
        .then(url => (url ? loadTexture(url) : null))
        .then(base => {
            if (mat.userData.textureKey !== key) return; // inzwischen geändert
            if (!base) { clear(); return; }
            if (mat.map) mat.map.dispose();
            const t = base.clone();
            t.needsUpdate = true;
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = 8; // schräg gesehen schärfer (wird auf das Mögliche begrenzt)
            const img = base.image || {};
            const aspect = img.width ? img.height / img.width : 1;
            const w = Math.max(1, Number(tex.size) || 1000);
            // Texturkoordinaten in mm: u quer, v längs; Bildbreite = size mm
            if (tex.rotate) {
                t.center.set(0, 0);
                t.rotation = Math.PI / 2;
                t.repeat.set(1 / (w * aspect), 1 / w);
            } else {
                t.repeat.set(1 / w, 1 / (w * aspect));
            }
            mat.map = t;
            mat.alphaTest = tex.alpha ? 0.5 : 0;
            mat.needsUpdate = true;
            if (onChange) onChange();
        })
        .catch(e => { console.warn(e.message || e); if (mat.userData.textureKey === key) clear(); });
}

// Stärke der Spiegelung der Umgebung im Blech
const ENV_INTENSITY = 0.9;

/**
 * Umgebung, die sich im Blech spiegelt (heller Himmel oben, grauer Boden
 * unten). Ohne Umgebung hat Metall nichts zu spiegeln und wird bei hohem
 * Metallglanz schwarz. Für scene.environment; je Renderer einmal erzeugt.
 */
const envCache = new WeakMap();
export function sheetEnvironment(renderer) {
    if (envCache.has(renderer)) return envCache.get(renderer);
    let tex = null;
    try {
        const scene = new THREE.Scene();
        const geo = new THREE.SphereGeometry(100, 32, 16);
        const colors = [];
        const pos = geo.attributes.position;
        const top = new THREE.Color(0xf4f6f8), horizon = new THREE.Color(0xc9ced3), bottom = new THREE.Color(0x6b7078);
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i) / 100;
            const c = y >= 0 ? horizon.clone().lerp(top, y) : horizon.clone().lerp(bottom, -y);
            colors.push(c.r, c.g, c.b);
        }
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
        const pmrem = new THREE.PMREMGenerator(renderer);
        tex = pmrem.fromScene(scene, 0.02).texture;
        pmrem.dispose();
        geo.dispose();
    } catch (e) {
        console.warn('3D-Umgebung:', e);
    }
    envCache.set(renderer, tex);
    return tex;
}
