import { MATERIAL_SPECS } from '../utils/MaterialData.js';
import { thicknessesFor } from '../utils/CoilCatalog.js';
import { Materials, CHANGED_EVENT } from '../utils/Materials.js';

export class ProjectController {
    constructor() {
        this.initEvents();
    }

    /**
     * Auswahl „Material“ aus der Materialliste (mitgelieferte und eigene).
     * Ein Material, das hier unbekannt ist (z.B. eigenes Material eines
     * anderen Betriebs in einer geöffneten Datei), bleibt als markierter
     * Eintrag erhalten, damit beim Speichern nichts verloren geht.
     */
    renderMaterialOptions(keep) {
        const select = document.getElementById('material-type');
        if (!select) return;
        const value = keep !== undefined ? keep : select.value;
        select.innerHTML = '';
        const add = (v, text, parent = select) => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = text;
            parent.appendChild(opt);
        };
        add('', '-- Material wählen --');
        const list = Materials.list();
        list.filter(m => m.builtin).forEach(m => add(m.name, m.name));
        const own = list.filter(m => !m.builtin);
        if (own.length) {
            const group = document.createElement('optgroup');
            group.label = 'Eigene Materialien';
            own.forEach(m => add(m.name, m.name, group));
            select.appendChild(group);
        }
        if (value && !list.some(m => m.name === value)) add(value, `${value} (nicht in den Einstellungen)`);
        select.value = value || '';
    }

    initEvents() {
        this.renderMaterialOptions('');
        // Materialien geladen oder in den Einstellungen geändert: Auswahl neu, Werte bleiben
        document.addEventListener(CHANGED_EVENT, () => {
            const f = this.getFormData();
            this.renderMaterialOptions(f.materialType);
            this.updateMaterialSpecs(f.materialType, f.materialSpec);
            this.updateThicknessOptions(f.materialThickness, true);
        });
        const matSelect = document.getElementById('material-type');
        if (matSelect) {
            matSelect.addEventListener('change', (e) => {
                const thickness = this.getFormData().materialThickness;
                this.updateMaterialSpecs(e.target.value);
                this.updateThicknessOptions(thickness, false);
            });
        }
        const specSelect = document.getElementById('material-spec');
        if (specSelect) {
            specSelect.addEventListener('change', () => {
                this.updateThicknessOptions(this.getFormData().materialThickness, false);
            });
        }
    }

    /**
     * Materialstärke nur aus den lieferbaren Dicken von Material +
     * Ausführung wählbar. Ist die bisherige Dicke dort nicht lieferbar, wird
     * nach einem Materialwechsel die übliche Dicke vorgewählt. Beim Laden
     * (keepUnlisted) bleibt eine nicht lieferbare Dicke als markierter
     * Eintrag erhalten, damit ältere Dateien nichts verlieren.
     */
    updateThicknessOptions(current, keepUnlisted) {
        const select = document.getElementById('material-thickness');
        if (!select) return;
        const material = document.getElementById('material-type')?.value || '';
        const spec = document.getElementById('material-spec')?.value || '';
        const { list, sheetOnly, standard } = thicknessesFor(material, spec);
        const t = parseFloat(current) || 0;
        const listed = list.some(th => Math.abs(th - t) < 1e-6);

        select.innerHTML = '';
        const addOption = (value, text) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = text;
            select.appendChild(opt);
            return opt;
        };

        if (t > 0 && !listed && keepUnlisted) {
            addOption(String(t), `${t.toFixed(2)} mm (nicht im Sortiment)`);
        }
        if (list.length === 0 && select.options.length === 0) {
            addOption('', '-- zuerst Material wählen --');
        }
        list.forEach(th => addOption(String(th), `${th.toFixed(2)} mm${sheetOnly.includes(th) ? ' (nur Tafel)' : ''}`));

        if (listed) select.value = String(list.find(th => Math.abs(th - t) < 1e-6));
        else if (t > 0 && keepUnlisted) select.value = String(t);
        else if (list.length > 0) select.value = String(standard);
        select.disabled = list.length === 0 && !(t > 0 && keepUnlisted);
    }

    updateMaterialSpecs(selectedMaterial, selectedSpec = '') {
        const specGroup = document.getElementById('group-material-spec');
        const specSelect = document.getElementById('material-spec');

        if (!specGroup || !specSelect) return;

        const specs = [...(MATERIAL_SPECS[selectedMaterial] || [])];
        // Ausführung, die es (nicht mehr) gibt – z.B. Datei mit fremdem Material oder
        // geänderte Ausführungen eines eigenen Materials –, als markierten Eintrag
        // erhalten statt still die erste zu wählen
        const unlisted = selectedSpec && !specs.includes(selectedSpec) ? selectedSpec : '';
        if (unlisted) specs.push(unlisted);

        if (specs.length > 0) {
            specSelect.innerHTML = '';
            specs.forEach(spec => {
                const opt = document.createElement('option');
                opt.value = spec;
                opt.textContent = spec === unlisted && MATERIAL_SPECS[selectedMaterial] ? `${spec} (nicht im Sortiment)` : spec;
                if (spec === selectedSpec) opt.selected = true;
                specSelect.appendChild(opt);
            });
            // 'flex' bzw. '' sorgt dafür, dass sich das Element ins Grid/Flex-Layout einfügt:
            specGroup.style.display = 'flex';
        } else {
            specSelect.innerHTML = '';
            specGroup.style.display = 'none';
        }
    }

    getFormData() {
        return {
            projectNumber: document.getElementById('project-number')?.value || '',
            projectName: document.getElementById('project-name')?.value || '',
            projectAuthor: document.getElementById('project-author')?.value || '',
            profileName: document.getElementById('profile-name')?.value || '',
            materialType: document.getElementById('material-type')?.value || '',
            materialSpec: document.getElementById('material-spec')?.value || '',
            materialThickness: parseFloat(document.getElementById('material-thickness')?.value) || 0,
            materialColor: document.getElementById('material-color')?.value || ''
        };
    }

    setFormData(data = {}) {
        if (document.getElementById('project-number')) document.getElementById('project-number').value = data.projectNumber || '';
        if (document.getElementById('project-name')) document.getElementById('project-name').value = data.projectName || '';
        if (document.getElementById('project-author')) document.getElementById('project-author').value = data.projectAuthor || '';
        if (document.getElementById('profile-name')) document.getElementById('profile-name').value = data.profileName || '';
        if (document.getElementById('material-color')) document.getElementById('material-color').value = data.materialColor || '';

        const elMat = document.getElementById('material-type');
        if (elMat) {
            this.renderMaterialOptions(data.materialType || '');
            // Dateien vor 0.23: Titanzink „Patiniert“ heisst jetzt „Vorbewittert“
            const spec = data.materialType === 'Titanzink' && data.materialSpec === 'Patiniert' ? 'Vorbewittert' : data.materialSpec;
            this.updateMaterialSpecs(data.materialType, spec);
        }
        this.updateThicknessOptions(data.materialThickness, true);
    }
}
