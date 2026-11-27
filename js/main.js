import { Profile } from './models/Profile.js';
import { View } from './models/View.js';

import { ModeManager } from './controllers/ModeManager.js';
import { DrawingController } from './controllers/DrawingController.js';
import { SelectionController } from './controllers/SelectionController.js';
import { LabelEditController } from './controllers/LabelEditController.js';
import { HistoryController } from './controllers/HistoryController.js';
import { CutlistController, laengeM } from './controllers/CutlistController.js';
import { ProjectController } from './controllers/ProjectController.js';
import { Preview3DController } from './controllers/Preview3DController.js';
import { CuttingController } from './controllers/CuttingController.js';
import { FileBrowserController } from './controllers/FileBrowserController.js';
import { FolderStorage } from './storage/FolderStorage.js';
import { ErpStorage } from './storage/ErpStorage.js';
import { ruestauftragErstellen, pruefschluessel } from './storage/ErpRuestauftrag.js';
import { ModuleHost } from './modules/ModuleHost.js';

import { CanvasRenderer } from './renderer/CanvasRenderer.js';
import { EventHandler } from './interactions/EventHandler.js';
import { ZoomHandler } from './interactions/ZoomHandler.js';

import { JSONExporter } from './export/JSONExporter.js';
import { DXFExporter } from './export/DXFExporter.js';
import { PDFExporter } from './export/PDFExporter.js';
import { Ausgabe } from './export/Ausgabe.js';
import { PNGExporter } from './export/PNGExporter.js';

import { NotificationController } from './ui/NotificationController.js';
import { globalEventBus } from './utils/EventBus.js';
import { Autosave } from './utils/Autosave.js';
import { ProjectStore, PROJECT_FIELDS, PROFILE_FIELDS, isProjectFile, readProjectFile } from './models/ProjectStore.js';
import { ProfileListController, profilName, profilInfo, abwicklungVon } from './controllers/ProfileListController.js';
import { Toast } from './utils/Toast.js';
import { TemplateController } from './templates/TemplateController.js';
import { SettingsController } from './ui/SettingsController.js';
import { Materials, CHANGED_EVENT as MATERIALS_CHANGED } from './utils/Materials.js';
import { Textures } from './utils/Textures.js';

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('canvas');
    if (!canvas) return;

    // Canvas-Größe an Eltern-Element anpassen
    const resizeCanvas = () => {
        const parent = canvas.parentElement;
        if (!parent) return;

        if (canvas.width !== parent.clientWidth || canvas.height !== parent.clientHeight) {
            canvas.width = parent.clientWidth;
            canvas.height = parent.clientHeight;
        }
    };
    resizeCanvas();

    // Models & View initialisieren
    const profile = new Profile();
    const view = new View(canvas);
    if (typeof view.reset === 'function') view.reset();

    // Toolbar-Werkzeuge & Zoom-Buttons ermitteln
    const btnModeLine = document.getElementById('btn-mode-line') || document.getElementById('btn-line') || document.getElementById('btn-mode-draw');
    const btnModeSelect = document.getElementById('btn-mode-select') || document.getElementById('btn-select');
    const btnDelete = document.getElementById('btn-delete');
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');

    const btnZoomIn = document.getElementById('btn-zoom-in') || document.getElementById('zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out') || document.getElementById('zoom-out');
    const btnZoomReset = document.getElementById('btn-zoom-reset') || document.getElementById('zoom-reset') || document.getElementById('btn-1-1');

    // Hilfsfunktion: Werkzeuge & Zoom-Buttons aktivieren / deaktivieren
    let toolsDisabledByTab = false;
    const setToolbarToolsDisabled = (disabled) => {
        toolsDisabledByTab = disabled;
        // ausserhalb des Profil-Tabs ausgeblendet statt nur gesperrt (styles.css: body.ohne-zeichenwerkzeuge)
        document.body.classList.toggle('ohne-zeichenwerkzeuge', disabled);
        const tools = [
            btnModeLine,
            btnModeSelect,
            btnDelete,
            btnUndo,
            btnRedo,
            btnZoomIn,
            btnZoomOut,
            btnZoomReset,
            document.getElementById('btn-zoom-fit')
        ];

        tools.forEach(btn => {
            if (btn) {
                btn.classList.toggle('disabled', disabled);
            }
        });
        updateConicalUI();
    };

    // Konisches Profil: Checkbox in der Statusleiste, Umschalter vorne/hinten
    // in der Toolbar. Am hinteren Ende wird nicht gezeichnet und nicht
    // gelöscht (gleicher Aufbau beider Enden), daher Linie/Löschen gesperrt.
    // Als Funktionsdeklaration, weil schon setToolbarToolsDisabled sie braucht.
    function updateConicalUI() {
        const chkConical = document.getElementById('chk-conical');
        const btnSide = document.getElementById('btn-profile-side');
        const editingBack = profile.isEditingBack();

        if (chkConical) chkConical.checked = profile.conical;
        const btnSwapEnds = document.getElementById('btn-swap-ends');
        if (btnSwapEnds) btnSwapEnds.classList.toggle('hidden', !profile.conical);
        if (btnSide) {
            btnSide.classList.toggle('hidden', !profile.conical);
            btnSide.classList.toggle('side-back', editingBack);
            btnSide.classList.toggle('disabled', toolsDisabledByTab);
            btnSide.innerHTML = editingBack
                ? '<span class="lbl-long">Profil: hinten</span><span class="lbl-short">Hinten</span>'
                : '<span class="lbl-long">Profil: vorne</span><span class="lbl-short">Vorne</span>';
        }
        [btnModeLine, btnDelete].forEach(btn => {
            if (btn) btn.classList.toggle('disabled', toolsDisabledByTab || editingBack);
        });
    }

    // 3D Preview Controller (Behälter im HTML: id="three-container")
    const preview3DController = new Preview3DController('three-container', profile);

    // Tab-Umschaltung (Profil, Stückliste, 3D Vorschau, Zuschnitt)
    const tabBtnProfile = document.getElementById('tab-btn-profile');
    const tabBtnCutlist = document.getElementById('tab-btn-cutlist');
    const tabBtnVorschau = document.getElementById('tab-btn-vorschau');
    const tabBtnZuschnitt = document.getElementById('tab-btn-zuschnitt');

    const viewProfile = document.getElementById('view-profile');
    const viewCutlist = document.getElementById('view-cutlist');
    const viewVorschau = document.getElementById('view-vorschau');
    const viewZuschnitt = document.getElementById('view-zuschnitt');

    // Aktiver Tab: 'profile' | 'cutlist' | 'zuschnitt' | 'vorschau' oder ein
    // Modul-Tab ('mod-…', siehe ModuleUI.addTab)
    let currentTab = 'profile';
    let moduleHost = null;
    // Änderungen seit dem letzten Speichern oder Öffnen (Rückfrage bei „Neu“) und
    // Name der offenen Datei – beides steht im Fenstertitel (auf dem Handy: Punkt am Menüknopf)
    let ungespeichert = false;
    let dokName = null;
    // ERPNext: Start erst nach dem Laden der Module (siehe moduleHost.loadAll unten)
    let erpStart = null;
    const dokStatus = () => {
        const name = dokName ? dokName.replace(/\.json$/i, '') : 'Unbenannt';
        const more = document.getElementById('btn-more');
        if (more) more.classList.toggle('ungespeichert', ungespeichert);
        document.title = `${ungespeichert ? '● ' : ''}${name} – OpenBender`;
    };
    const setUngespeichert = (wert) => { ungespeichert = wert; dokStatus(); };
    // Ganzes Profil zeigen (fitProfileToView, weiter unten gesetzt); nach dem Öffnen
    // in einem anderen Tab erst, wenn der Profil-Tab sichtbar wird (Zeichenfläche hat dann ihre Grösse)
    let einpassen = () => {};
    let einpassenBeimZeigen = false;
    let templateController = null;
    let settings = null;       // Einstellungen (SettingsController, nach den Modulen erstellt)
    let moduleStart = false;   // alle Module beim Start geladen?

    const switchTab = (activeTab) => {
        currentTab = activeTab;
        // Statusleiste: Profil-Optionen nur im Tab „Profil zeichnen“ (.profile-tab-only)
        document.body.dataset.tab = activeTab;
        const sb = document.getElementById('status-bar');
        if (sb) sb.classList.remove('options-open');
        if (moduleHost) moduleHost.ui.onTabSwitched(activeTab);

        // Buttons entkoppeln
        if (tabBtnProfile) tabBtnProfile.classList.toggle('active', activeTab === 'profile');
        if (tabBtnCutlist) tabBtnCutlist.classList.toggle('active', activeTab === 'cutlist');
        if (tabBtnVorschau) tabBtnVorschau.classList.toggle('active', activeTab === 'vorschau');
        if (tabBtnZuschnitt) tabBtnZuschnitt.classList.toggle('active', activeTab === 'zuschnitt');

        // Views entkoppeln
        if (viewProfile) viewProfile.classList.toggle('active', activeTab === 'profile');
        if (viewCutlist) viewCutlist.classList.toggle('active', activeTab === 'cutlist');
        if (viewVorschau) viewVorschau.classList.toggle('active', activeTab === 'vorschau');
        if (viewZuschnitt) viewZuschnitt.classList.toggle('active', activeTab === 'zuschnitt');

        if (activeTab === 'profile') {
            setToolbarToolsDisabled(false);
            resizeCanvas();
            if (einpassenBeimZeigen) { einpassenBeimZeigen = false; einpassen(); }
            requestRedraw();
        } else if (activeTab === 'cutlist') {
            setToolbarToolsDisabled(true);
            if (cutlistController) cutlistController.updateSummary();
        } else if (activeTab === 'zuschnitt') {
            setToolbarToolsDisabled(true);
            cuttingController.render();
        } else if (activeTab === 'vorschau') {
            setToolbarToolsDisabled(true);
            if (preview3DController) {
                setTimeout(() => {
                    preview3DController.resize();

                    const projectData = projectController ? projectController.getFormData() : {};

                    // 'Kupfer', 'Stahl', 'Aluminium' etc. direkt übergeben:
                    preview3DController.setMaterialType(projectData.materialType, projectData.materialSpec);
                    preview3DController.setSheetThickness(projectData.materialThickness);
                    fillPositionSelect(selPosition);
                    preview3DController.setSheetLength(getSelectedLengthMm(selPosition));
                    preview3DController.update3DModel();
                    preview3DController.fitCamera();
                }, 50);
            }
        } else {
            // Modul-Tab: Zeichenwerkzeuge gesperrt wie bei den anderen Tabs
            setToolbarToolsDisabled(true);
        }
        updateUndoRedoButtons();
        globalEventBus.emit('tab:changed', activeTab);
    };

    // --- Dokumentarten ---
    // "Blechprofil" ist die Grundart; Module können weitere anmelden
    // (api.documents.addType). Die Dokumentart bestimmt, welche Tabs zu sehen
    // sind und was PDF/DXF ausgeben. Sie wird in der Projektdatei gespeichert.
    const PROFILE_DOC_TYPE = {
        id: 'profile',
        name: 'Blechprofil',
        description: 'Kantprofil zeichnen und bemassen, Stückliste, Zuschnitt, 3D-Vorschau, DXF und PDF',
        icon: '📐',
        mainTab: 'profile',
        coreTabs: ['profile', 'cutlist', 'zuschnitt', 'vorschau'],
        hideCutlist: false,
        exports: {}
    };
    let currentDocType = PROFILE_DOC_TYPE;
    document.body.dataset.docType = PROFILE_DOC_TYPE.id;
    const coreTabButtons = { profile: tabBtnProfile, cutlist: tabBtnCutlist, zuschnitt: tabBtnZuschnitt, vorschau: tabBtnVorschau };
    const cutlistTabLabel = tabBtnCutlist ? tabBtnCutlist.innerHTML : '';

    const findDocType = (id) => (id === 'profile'
        ? PROFILE_DOC_TYPE
        : (moduleHost && moduleHost.docTypes.find(t => t.id === id)) || null);

    // Start-Tab der aktiven Dokumentart
    const homeTab = () => currentDocType.mainTab || currentDocType.coreTabs[0] || 'profile';

    // Wechselt die Art, zeigt der Start-Tab der neuen Art (beim Wechsel zwischen
    // Einträgen gleicher Art wird applyDocType nicht aufgerufen, der Tab bleibt)
    function applyDocType(id) {
        const type = findDocType(id) || PROFILE_DOC_TYPE;
        currentDocType = type;
        document.body.dataset.docType = type.id;
        Object.entries(coreTabButtons).forEach(([key, btn]) => {
            if (btn) btn.classList.toggle('doc-hidden', !type.coreTabs.includes(key));
        });
        // Nur Projektdaten, ohne Stücklisten-Tabelle (z.B. Blindpaneele)
        if (viewCutlist) viewCutlist.classList.toggle('cutlist-table-hidden', type.hideCutlist);
        if (tabBtnCutlist) {
            tabBtnCutlist.innerHTML = type.hideCutlist
                ? '<span class="lbl-long">📋 Projekt</span><span class="lbl-short">📋 Projekt</span>'
                : cutlistTabLabel;
        }
        if (moduleHost) moduleHost.ui.applyDocType(type.id);
        switchTab(homeTab());
        return type;
    }

    // --- Ausmasse verschiedener Art im Projekt ---
    // Jeder Eintrag des Projekts hat seine Art (Blechprofil oder Dokumentart eines
    // Moduls). Einträge, deren Modul fehlt oder aus ist, bleiben mit ihren Daten in
    // der Datei, lassen sich aber nicht bearbeiten (graue Karte).
    const artBearbeitbar = (typeId) => !typeId || typeId === 'profile' || !!findDocType(typeId);
    const alleArten = () => [PROFILE_DOC_TYPE, ...(moduleHost ? moduleHost.docTypes : [])];
    const kopieVon = (v) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));

    // Einträge, die eine Dokumentart aufteilen will (api.documents.addType({ split })),
    // z.B. alte Blindpaneele-Datei mit mehreren Paneelen → ein Ausmass pro Paneel
    function ausmasseAufteilen() {
        if (!moduleHost) return false;
        let changed = false;
        moduleHost.docTypes.filter(t => t.split).forEach(t => {
            if (projectStore.splitEntries(t.id, t.moduleId, t.split)) changed = true;
        });
        return changed;
    }

    // Ist der aktive Eintrag nicht (mehr) bearbeitbar, den ersten bearbeitbaren
    // wählen; gibt es keinen, ein leeres Blechprofil ergänzen. Sonst die Art des
    // aktiven Eintrags anzeigen.
    function aktivenEintragPruefen({ meldung = true } = {}) {
        const aktiv = projectStore.active;
        if (artBearbeitbar(aktiv.type)) {
            if ((aktiv.type || 'profile') !== currentDocType.id) applyDocType(aktiv.type);
        } else {
            const ok = projectStore.entries.find(e => artBearbeitbar(e.type));
            if (ok) projectStore.select(ok.id);
            else projectStore.add('profile');
            if (meldung) {
                Toast.show(`Ausmasse der Art „${aktiv.type}“ lassen sich nur mit dem zugehörigen Modul bearbeiten (🔌 Module verwalten). Ihre Daten bleiben in der Datei erhalten.`
                    + (ok ? '' : ' Für die Arbeit wurde ein leeres Blechprofil ergänzt.'), 'warning', 7000);
            }
        }
        if (profileList) profileList.render();
    }

    // Leiste „Neues Profil“ / „Neues Ausmass“: Art wählen (nur wenn Module
    // weitere Arten anbieten), Eintrag hinter dem aktiven anlegen. Die Art
    // bekommt mit onNew({ from }) die Moduldaten des bisher aktiven Eintrags,
    // wenn er von derselben Art ist (Einstellungen als Vorschlag übernehmen).
    async function neuesAusmass() {
        const arten = alleArten();
        let typeId = 'profile';
        if (arten.length > 1) {
            typeId = await moduleHost.ui.openNewDialog(arten, {
                title: 'Neues Ausmass',
                text: 'Was möchtest du dem Projekt hinzufügen?',
                note: 'Das neue Ausmass kommt hinter das aktive. Projekt-Nr., Projekt-Name und Zeichner gelten für alle Ausmasse.'
            });
            if (!typeId) return false;
        }
        const vorher = projectStore.sync();
        projectStore.add(typeId);
        const type = findDocType(typeId);
        if (type && type.onNew) {
            const from = vorher.type === typeId && vorher.modules && type.moduleId ? kopieVon(vorher.modules[type.moduleId]) : null;
            try { type.onNew({ from }); } catch (e) { console.error(`Modul „${type.moduleId}“ onNew:`, e); }
        }
        return true;
    }

    // Knöpfe ↶ ↷ der Toolbar: Profil-Verlauf im Profil-Tab, Modul-Verlauf in
    // einem Modul-Tab mit eigenem Verlauf, sonst gesperrt
    function updateUndoRedoButtons() {
        const h = moduleHost && moduleHost.ui.historyFor(currentTab);
        // Rückgängig/Wiederholen bleiben in Tabs mit eigenem Verlauf sichtbar
        document.body.classList.toggle('mit-verlauf', !!h);
        const set = (btn, on) => {
            if (!btn) return;
            btn.disabled = !on;
            btn.classList.toggle('disabled', !on);
        };
        if (h) {
            set(btnUndo, h.canUndo());
            set(btnRedo, h.canRedo());
        } else if (currentTab === 'profile' && historyController) {
            historyController.updateButtonStates();
        } else {
            set(btnUndo, false);
            set(btnRedo, false);
        }
    }

    // PDF/DXF einer Modul-Dokumentart (api.documents.addType({ exports }))
    async function runDocExport(kind) {
        const fn = currentDocType.exports && currentDocType.exports[kind];
        if (typeof fn !== 'function') {
            Toast.show(`${kind.toUpperCase()} ist für „${currentDocType.name}“ noch nicht verfügbar.`, 'warning');
            return;
        }
        try {
            await fn();
        } catch (e) {
            console.error(`Modul „${currentDocType.moduleId}“ ${kind}:`, e);
            Toast.show(`Fehler im Modul: ${e.message || e}`, 'warning', 5000);
        }
    }

    // 3D-Ansicht: Blechlänge aus der Stückliste (Position wählbar),
    // ohne Stückliste 500 mm. Stücklisten-Längen sind in m, Werte > 50
    // werden wie im PDF als mm gelesen.
    const selPosition = document.getElementById('sel-3d-position');
    const cutlistLengthMm = (length) => {
        const value = parseFloat(length) || 0;
        return value > 50 ? value : value * 1000;
    };

    // Auswahlliste der Stücklisten-Positionen (3D-Ansicht und DXF-Dialog)
    const fillPositionSelect = (select) => {
        if (!select) return;
        const items = cutlistController.items;
        const previous = select.value;
        select.innerHTML = '';

        if (items.length === 0) {
            select.add(new Option('500 mm (keine Stückliste)', ''));
            select.disabled = true;
            return;
        }

        items.forEach((item, index) => {
            const meters = (cutlistLengthMm(item.length) / 1000).toFixed(3);
            const plug = item.interlocking ? ' · steckbar' : '';
            select.add(new Option(`Pos. ${index + 1}: ${meters} m${plug}`, String(index)));
        });
        select.disabled = false;
        select.value = (previous !== '' && Number(previous) < items.length) ? previous : '0';
    };

    const getSelectedLengthMm = (select) => {
        const item = cutlistController.items[Number(select && select.value)];
        const mm = item ? cutlistLengthMm(item.length) : 0;
        return mm > 0 ? mm : 500;
    };

    if (selPosition) {
        selPosition.addEventListener('change', () => {
            preview3DController.setSheetLength(getSelectedLengthMm(selPosition));
            preview3DController.update3DModel();
            preview3DController.fitCamera();
        });
    }

    const chk3dDimensions = document.getElementById('chk-3d-dimensions');
    if (chk3dDimensions) {
        chk3dDimensions.addEventListener('change', (e) => preview3DController.setShowDimensions(e.target.checked));
    }

    if (tabBtnProfile) tabBtnProfile.addEventListener('click', () => switchTab('profile'));
    if (tabBtnCutlist) tabBtnCutlist.addEventListener('click', () => switchTab('cutlist'));
    if (tabBtnVorschau) tabBtnVorschau.addEventListener('click', () => switchTab('vorschau'));
    if (tabBtnZuschnitt) tabBtnZuschnitt.addEventListener('click', () => switchTab('zuschnitt'));

    // UI Controller
    const notificationController = new NotificationController();

    // Project Controller
    const projectController = new ProjectController();

    // Cutlist Controller
    const cutlistController = new CutlistController(profile);

    // Datei-Browser (Öffnen/Speichern im Speicherordner), wird bei den
    // Toolbar-Buttons erzeugt
    let fileBrowser = null;
    // Leiste mit den Profilen des Projekts (nach den Modulen erzeugt)
    let profileList = null;

    // Zuschnitt-Optimierung (Tab "Zuschnitt")
    const cuttingController = new CuttingController(profile, cutlistController, projectController);

    // Letzten Stand aus dem Browser-Autosave wiederherstellen. Vor dem
    // Undo-Verlauf und dem Zeichen-Controller, damit diese mit dem
    // wiederhergestellten Profil starten (Rückgängig springt nicht zurück
    // zum leeren Startprofil).
    // Projekt mit mehreren Blechprofilen (js/models/ProjectStore.js): der Editor
    // arbeitet mit dem aktiven Profil, der Speicher hält die übrigen.
    // editorBereit: erst wenn alle Controller stehen, werden sie beim Laden
    // eines Profils mit angesprochen (beim Start nur Modell, Stückliste, Projekt, Zuschnitt).
    let editorBereit = false;
    let profilWechsel = false;   // läuft gerade ein Wechsel/Laden? Dann zählt nichts als Änderung
    const feldAuswahl = (obj, keys) => Object.fromEntries(keys.map(k => [k, (obj && obj[k]) ?? '']));
    const projectStore = new ProjectStore({
        capture: () => {
            if (editorBereit) projectStore.active.history = historyController.exportState();
            return {
                fields: feldAuswahl(projectController.getFormData(), PROFILE_FIELDS),
                profile: profile.toData(),
                cutlist: cutlistController.toJSON(),
                cutting: cuttingController.toJSON(),
                modules: moduleHost ? moduleHost.getAllData() : projectStore.active.modules
            };
        },
        apply: (entry) => {
            const kopie = (v) => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));
            profilWechsel = true;
            try {
                if (editorBereit) {
                    labelEditController.close();
                    selectionController.clearSelection();
                }
                profile.loadData(kopie(entry.profile));
                cutlistController.fromJSON(kopie(entry.cutlist) || []);
                projectController.setFormData({ ...projectController.getFormData(), ...entry.fields });
                cuttingController.fromJSON(kopie(entry.cutting));
                if (!editorBereit) return;
                updateConicalUI();
                cuttingController.refresh();
                moduleHost.loadData(entry.modules);
                historyController.restore(entry.history);
                drawingController.activePointIndex = profile.points.length - 1;
                drawingController.tempPoint = null;
                // Anzeigen und Module nachführen, ohne dass es als Änderung oder Verlaufsschritt zählt
                historyController.isExecuting = true;
                globalEventBus.emit('profile:updated');
                historyController.isExecuting = false;
                globalEventBus.emit('document:loaded');
                // Oberfläche der Art des Eintrags (Tabs, Toolbar, PDF/DXF)
                if ((entry.type || 'profile') !== currentDocType.id && artBearbeitbar(entry.type)) applyDocType(entry.type);
                if (currentTab === 'profile') requestAnimationFrame(() => { einpassen(); requestRedraw(); });
                else einpassenBeimZeigen = true;
                if (currentTab === 'cutlist') cutlistController.updateSummary();
                updateUndoRedoButtons();
            } finally {
                profilWechsel = false;
            }
        }
    });

    // Zuschnitt über mehrere Profile: Profile mit gleichem Material, gleicher Ausführung,
    // Dicke und Farbe kommen gemeinsam auf eine Rolle / Tafel. Der Zuschnitt-Stand
    // (Rolle, abgehakte Teile …) ist dann für alle Profile der Gruppe derselbe.
    const materialKey = (f) => [f.materialType, f.materialSpec, parseFloat(f.materialThickness) || 0, String(f.materialColor || '').trim().toLowerCase()].join('|');
    const abwCache = new WeakMap();   // Geometrie-Objekt eines nicht aktiven Profils → Abwicklung
    const zuschnittGruppe = () => {
        const f = projectController.getFormData();
        if (!f.materialType || !(parseFloat(f.materialThickness) > 0) || currentDocType.id !== 'profile') return null;
        const key = materialKey(f);
        const aktivId = projectStore.activeId;
        const gleiche = projectStore.entries.map((e, i) => ({ e, i })).filter(({ e }) => e.id === aktivId || ((e.type || 'profile') === 'profile' && materialKey(e.fields) === key));
        const members = gleiche.filter(({ e }) => e.id === aktivId || !(e.cutting && e.cutting.solo)).map(({ e, i }) => {
            if (e.id === aktivId) return { prof: i + 1, profId: e.id, name: profilName({ fields: f }, i), active: true };
            if (!abwCache.has(e.profile)) abwCache.set(e.profile, abwicklungVon(e.profile));
            const abw = abwCache.get(e.profile);
            return { prof: i + 1, profId: e.id, name: profilName(e, i), positions: e.cutlist || [], unfold: { front: abw.front, back: abw.back }, conical: abw.conical };
        });
        return { kandidaten: gleiche.length, members };
    };
    cuttingController.setGroupProvider(zuschnittGruppe);
    // Stand des gemeinsamen Zuschnitts an die übrigen Profile der Gruppe weitergeben
    globalEventBus.on('cutting:changed', () => {
        if (profilWechsel) return;
        const g = zuschnittGruppe();
        const stand = cuttingController.toJSON();
        if (!g || stand.solo) return;
        g.members.filter(m => !m.active).forEach(m => {
            const e = projectStore.entries[projectStore.indexOf(m.profId)];
            if (e) e.cutting = JSON.parse(JSON.stringify(stand));
        });
    });

    const restored = Autosave.load();
    let restoredSomething = false;
    if (isProjectFile(restored)) {
        try {
            projectController.setFormData(readProjectFile(restored).project);
            projectStore.load(restored);
            restoredSomething = projectStore.count > 1
                || profile.points.length > 2
                || cutlistController.items.length > 0
                || Object.values(projectController.getFormData()).some(v => v);
        } catch (e) {
            profile.clear();
            projectStore.reset();
        }
    }
    setUngespeichert(restoredSomething);
    updateConicalUI();

    // Modus auf Linienzeichnen setzen
    const modeManager = new ModeManager();
    modeManager.setMode('line');

    // Logical Controllers
    const drawingController = new DrawingController(profile);
    const selectionController = new SelectionController(profile);

    // History Controller für Undo / Redo
    const historyController = new HistoryController(profile);
    // Der Profil-Verlauf stellt die Knöpfe ↶ ↷ bei jeder Profiländerung;
    // ausserhalb des Profil-Tabs gilt der Verlauf des aktiven Tabs
    globalEventBus.on('profile:updated', () => { if (currentTab !== 'profile') updateUndoRedoButtons(); });

    if (profile.points.length > 0) {
        drawingController.setActivePoint(profile.points.length - 1);
    }

    // Renderer & Zoom-Handler initialisieren (selectionController übergeben)
    const renderer = new CanvasRenderer(canvas, profile, view, drawingController, selectionController);
    const zoomHandler = new ZoomHandler(canvas, view);

    // Label-Bearbeitung (Klick auf Maß-/Winkel-Label öffnet Eingabefeld,
    // siehe LabelEditController) – braucht den Renderer für dessen zuletzt
    // gezeichnete Label-Positionen (lastLabels).
    const labelEditController = new LabelEditController(profile, view, canvas, renderer);

    // Zentrale Render-Funktion. Die Bus-Ereignisse (profile:updated,
    // view:changed, selection:changed) abonniert der Renderer selbst und
    // zeichnet höchstens einmal pro Bildschirmbild.
    const requestRedraw = () => {
        renderer.requestRender();
    };

    globalEventBus.on('mode:changed', (newMode) => {
        modeManager.setMode(newMode);

        if (newMode === 'line' || newMode === 'draw') {
            selectionController.clearSelection();

            if (drawingController) {
                drawingController.setMode('draw');
            }
        }
        requestRedraw();
    });

    // Event Handler für Zeicheingaben & Klicks initialisieren
    const eventHandler = new EventHandler(canvas, view, drawingController, selectionController, labelEditController);

    // Fenster-Skalierung abfangen
    // Reiter und Toolbar: kurze Beschriftungen, sobald die langen nicht mehr
    // Platz haben (je nach Fensterbreite und Anzahl Modul-Reiter); auf dem
    // Handy (≤ 640 px) regelt das CSS allein
    let beschriftungGeplant = false;
    const beschriftungAnpassen = () => {
        if (beschriftungGeplant) return;
        beschriftungGeplant = true;
        requestAnimationFrame(() => {
            beschriftungGeplant = false;
            const body = document.body;
            body.classList.remove('kurze-reiter', 'kurze-toolbar', 'kompakte-toolbar');
            if (window.innerWidth <= 640) return;
            const reiter = [...document.querySelectorAll('.main-tab-btn')].filter(b => b.offsetWidth > 0);
            if (reiter.some(b => b.scrollWidth > b.clientWidth + 1)) body.classList.add('kurze-reiter');
            // Stufe 1: kurze Beschriftungen; Stufe 2 (bricht die Toolbar immer
            // noch um): Datei, Vorlagen und Module ins Menü „⋯“ wie auf dem Handy
            const leiste = document.getElementById('toolbar');
            const bricht = () => {
                const teile = leiste ? [...leiste.children].filter(e => e.offsetWidth > 0 && !e.classList.contains('spacer')) : [];
                return teile.length > 1 && teile.some(e => e.offsetTop > teile[0].offsetTop + 5);
            };
            if (bricht()) body.classList.add('kurze-toolbar');
            if (bricht()) body.classList.add('kompakte-toolbar');
        });
    };
    window.addEventListener('resize', beschriftungAnpassen);
    globalEventBus.on('tab:changed', beschriftungAnpassen);
    globalEventBus.on('profile:updated', beschriftungAnpassen);
    // Modul-Tabs (sichtbar, in der angezeigten Reihenfolge) für Strg+5 … 9; Kürzel im Tooltip
    const modulTabs = () => [...document.querySelectorAll('.module-tab-btn')].filter(b => b.offsetParent !== null);
    const modulKuerzel = () => modulTabs().forEach((b, i) => {
        if (!b.dataset.titel) b.dataset.titel = b.title;
        b.title = i < 5 ? `${b.dataset.titel} (Strg+${i + 5})` : b.dataset.titel;
    });
    globalEventBus.on('tab:changed', modulKuerzel);
    const reiterLeiste = document.querySelector('.main-tabs');
    if (reiterLeiste && typeof MutationObserver !== 'undefined') {
        new MutationObserver(() => { beschriftungAnpassen(); modulKuerzel(); }).observe(reiterLeiste, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    }
    beschriftungAnpassen();

    // Nach einer Grössenänderung des Fensters (oder Drehen des Geräts) das
    // ganze Profil wieder einpassen – nicht während einer Eingabe (auf dem
    // Handy ändert die eingeblendete Tastatur die Fensterhöhe).
    let einpassenTimer = null;
    window.addEventListener('resize', () => {
        resizeCanvas();
        requestRedraw();
        if (preview3DController) preview3DController.resize();
        clearTimeout(einpassenTimer);
        einpassenTimer = setTimeout(() => {
            const el = document.activeElement;
            if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
            if (labelEditController.isOpen) return;
            if (currentTab === 'profile') { einpassen(); requestRedraw(); }
            else einpassenBeimZeigen = true;
        }, 250);
    });

    // Zeichenfläche auch anpassen, wenn sich nur ihr Platz ändert (z.B. eine
    // Leiste wird höher), nicht nur beim Drehen/Skalieren des Fensters –
    // sonst wird das Bild verzerrt dargestellt.
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
        new ResizeObserver(() => {
            const parent = canvas.parentElement;
            if (parent.clientWidth === 0 || parent.clientHeight === 0) return; // Tab nicht sichtbar
            if (canvas.width === parent.clientWidth && canvas.height === parent.clientHeight) return;
            resizeCanvas();
            requestRedraw();
        }).observe(canvas.parentElement);
    }

        /******************************/
        // Toolbar Buttons verknüpfen //
        /******************************/

        // Neues Dokument der gewählten Art ('profile' = Blechprofil oder eine
        // Dokumentart eines Moduls, siehe api.documents.addType)
        const newDocument = (typeId = 'profile') => {
                labelEditController.close();
                profile.clear();
                updateConicalUI();
                selectionController.clearSelection();
                eventHandler.setMode('draw');
                globalEventBus.emit('mode:changed', 'line');

                if (drawingController) {
                    drawingController.activePointIndex = profile.points.length > 0 ? profile.points.length - 1 : -1;
                    drawingController.tempPoint = null;
                }

                if (cutlistController) {
                    if (typeof cutlistController.clear === 'function') {
                        cutlistController.clear();
                    } else if (typeof cutlistController.fromJSON === 'function') {
                        cutlistController.fromJSON([]);
                    }
                }

                cuttingController.reset();
                if (moduleHost) moduleHost.resetData();

                if (projectController) {
                    if (typeof projectController.clear === 'function') {
                        projectController.clear();
                    } else if (typeof projectController.reset === 'function') {
                        projectController.reset();
                    } else if (typeof projectController.setFormData === 'function') {
                        projectController.setFormData({
                            projectNumber: '',
                            projectName: '',
                            profileName: '',
                            projectAuthor: '',
                            materialType: '',
                            materialThickness: '',
                            materialColor: '',
                            materialSpec: ''
                        });
                    }
                }

                cuttingController.refresh();
                if (fileBrowser) fileBrowser.forgetDocument();
                requestRedraw();
                globalEventBus.emit('document:new');
                // die Ereignisse beim Leeren zählen nicht als Änderung
                dokName = null;
                projectStore.reset(typeId);
                historyController.reset();
                if (profileList) profileList.render();
                setTimeout(() => setUngespeichert(false), 100);

                const type = applyDocType(typeId);
                if (type.onNew) {
                    try { type.onNew({ from: null }); } catch (e) { console.error(`Modul „${type.moduleId}“ onNew:`, e); }
                }
        };

        // "Neu" öffnet die Auswahl der Dokumentart. Gibt es nur das
        // Blechprofil (keine Modul-Dokumentarten), direkt ein neues Profil.
        const btnNew = document.getElementById('btn-new');
        if (btnNew) {
            btnNew.addEventListener('click', async () => {
                if (ungespeichert && moduleHost && !(await moduleHost.ui.confirm('Neues Projekt beginnen?',
                    'Das ganze Projekt (alle Profile bzw. Ausmasse, Stücklisten und Projektdaten) wird geleert. Was seit dem letzten Speichern geändert wurde, geht verloren.'))) return;
                const types = alleArten();
                if (types.length === 1) {
                    newDocument('profile');
                    return;
                }
                const choice = await moduleHost.ui.openNewDialog(types, {
                    title: 'Neues Projekt',
                    text: 'Womit beginnt das neue Projekt? Weitere Ausmasse fügst du links in der Leiste hinzu.',
                    note: 'Das aktuelle Projekt wird geleert. Gespeicherte Dateien bleiben unverändert.'
                });
                if (choice) newDocument(choice);
            });
        }

        const updateModeUI = (activeMode) => {
            if (btnModeLine) {
                btnModeLine.classList.toggle('active', activeMode === 'line' || activeMode === 'draw');
            }
            if (btnModeSelect) {
                btnModeSelect.classList.toggle('active', activeMode === 'select');
            }
        };

        if (btnModeLine) {
            btnModeLine.addEventListener('click', () => {
                eventHandler.setMode('draw');
                globalEventBus.emit('mode:changed', 'line');
                updateModeUI('line');
            });
        }

        if (btnModeSelect) {
            btnModeSelect.addEventListener('click', () => {
                eventHandler.setMode('select');
                globalEventBus.emit('mode:changed', 'select');
                updateModeUI('select');
            });
        }

        // Konisches Profil
        const setActiveSide = (side) => {
            labelEditController.close();
            profile.setActiveSide(side);
            // Hinten kann nur ausgewählt/verschoben werden
            if (profile.isEditingBack() && eventHandler.currentMode !== 'select' && btnModeSelect) {
                btnModeSelect.click();
            }
            updateConicalUI();
            globalEventBus.emit('profile:updated');
        };

        const chkConical = document.getElementById('chk-conical');
        if (chkConical) {
            chkConical.addEventListener('change', (e) => {
                profile.setConical(e.target.checked);
                setActiveSide('front');
            });
        }

        const btnProfileSide = document.getElementById('btn-profile-side');
        if (btnProfileSide) {
            btnProfileSide.addEventListener('click', (e) => {
                e.preventDefault();
                setActiveSide(profile.isEditingBack() ? 'front' : 'back');
            });
        }

        // Steckbares Profil: hinteres Ende als weites Steckstück berechnen
        // (siehe PlugProfile). Danach bleiben die Längen von Hand änderbar.
        const applyPlugProfile = (side) => {
            const thickness = projectController.getFormData().materialThickness;
            if (!(thickness > 0)) {
                Toast.show('Bitte zuerst die Materialstärke unter „Stückliste & Projekt“ eintragen.', 'warning', 4000);
                return;
            }
            labelEditController.close();
            const kept = profile.applyPlugProfile(thickness, side);
            updateConicalUI();
            globalEventBus.emit('profile:updated');
            const keptText = kept > 0 ? ` ${kept} von Hand geänderte ${kept === 1 ? 'Länge bleibt' : 'Längen bleiben'} unverändert.` : '';
            Toast.show(`Steckprofil berechnet (Materialstärke ${thickness} mm): hinten = weites Stück.${keptText}`, 'info', 4000);
        };

        const btnPlugAuto = document.getElementById('btn-plug-auto');
        if (btnPlugAuto) btnPlugAuto.addEventListener('click', () => applyPlugProfile());

        // Vorderes und hinteres Profil tauschen, ohne ein Mass zu ändern
        const btnSwapEnds = document.getElementById('btn-swap-ends');
        if (btnSwapEnds) {
            btnSwapEnds.addEventListener('click', () => {
                labelEditController.close();
                profile.swapEnds();
                globalEventBus.emit('profile:updated');
            });
        }

        globalEventBus.on('cutlist:interlocking-checked', () => applyPlugProfile());

        // Undo / Redo: im Profil-Tab das Profil, in einem Modul-Tab mit eigenem
        // Verlauf (api.ui.addTab({ history })) dessen Verlauf
        const undoAction = () => {
            const h = moduleHost && moduleHost.ui.historyFor(currentTab);
            if (h) h.undo();
            else if (currentTab === 'profile') historyController.undo();
        };
        const redoAction = () => {
            const h = moduleHost && moduleHost.ui.historyFor(currentTab);
            if (h) h.redo();
            else if (currentTab === 'profile') historyController.redo();
        };
        if (btnUndo) {
            btnUndo.addEventListener('click', (e) => {
                e.preventDefault();
                undoAction();
            });
        }

        if (btnRedo) {
            btnRedo.addEventListener('click', (e) => {
                e.preventDefault();
                redoAction();
            });
        }

        // Tastenkürzel
        //   Alt+N Neu (Strg+N reserviert der Browser für ein neues Fenster)
        //   Strg+A Modus wechseln · Entf Löschen
        //   Strg+Plus / Strg+Minus Zoomen · Strg+Z / Strg+Y Rückgängig / Wiederholen
        //   Strg+P PDF · Strg+E DXF · Strg+S Speichern · Strg+O Laden
        //   Strg+1/2/3/4 Tab Profil / Stückliste / Zuschnitt / 3D Vorschau, Strg+5 … 9 Modul-Tabs
        // Die Kürzel lösen den jeweiligen Button aus, damit Verhalten und
        // Sperren (Klasse "disabled" ausserhalb des Profil-Tabs) identisch sind.
        const shortcutButtons = {
            p: 'btn-export-pdf',
            e: 'btn-export-dxf',
            s: 'btn-export-json',
            o: 'btn-import-json',
            '+': 'btn-zoom-in',
            '=': 'btn-zoom-in', // US-Tastatur: Plus liegt auf Shift+=
            '-': 'btn-zoom-out',
            '0': 'btn-zoom-fit',
            '1': 'tab-btn-profile',
            '2': 'tab-btn-cutlist',
            '3': 'tab-btn-zuschnitt',
            '4': 'tab-btn-vorschau'
        };

        const clickIfEnabled = (btn) => {
            if (btn && !btn.disabled && !btn.classList.contains('disabled') && !btn.classList.contains('doc-hidden')) {
                btn.click();
            }
        };

        window.addEventListener('keydown', (e) => {
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const modifier = isMac ? e.metaKey : e.ctrlKey;
            const inTextField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
            // Fenster offen (Einstellungen, Info, Dialoge): keine Tastenkürzel für die Zeichnung dahinter
            if (document.querySelector('.info-panel-overlay:not(.hidden)')) return;

            // Ziffern über den Tastencode, damit Ziffernblock und Layouts
            // mit Ziffern auf der Shift-Ebene (z.B. Französisch) gleich gehen.
            const digit = /^(Digit|Numpad)[1-9]$/.test(e.code) ? e.code.slice(-1) : null;
            const key = digit || e.key.toLowerCase();

            // Strg+5 … 9: Modul-Tabs in der angezeigten Reihenfolge
            if (modifier && !e.altKey && digit && Number(digit) >= 5) {
                const tab = modulTabs()[Number(digit) - 5];
                if (tab) { e.preventDefault(); tab.click(); }
                return;
            }

            // Programm-Kürzel gelten auch in Eingabefeldern (z.B. Strg+S in der
            // Stückliste); Strg+A/Z/Y und Entf bleiben dort Textbearbeitung.
            if (modifier && !e.altKey && shortcutButtons[key]) {
                e.preventDefault();
                clickIfEnabled(document.getElementById(shortcutButtons[key]));
                return;
            }

            // Neue Zeichnung: Alt+N (Mac: Option+N liefert ein Sonderzeichen,
            // daher über den Tastencode).
            if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyN') {
                e.preventDefault();
                clickIfEnabled(document.getElementById('btn-new'));
                return;
            }

            if (inTextField) {
                return;
            }

            // Rückgängig/Wiederholen: Profil im Profil-Tab, Modul-Verlauf in
            // dessen Tab, sonst nichts (z.B. Zuschnitt)
            if (modifier && (key === 'z' || key === 'y')) {
                e.preventDefault();
                if (key === 'y' || e.shiftKey) redoAction();
                else undoAction();
            } else if (modifier && key === 'a') {
                e.preventDefault();
                const toSelect = eventHandler.currentMode !== 'select';
                clickIfEnabled(toSelect ? btnModeSelect : btnModeLine);
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectionController && selectionController.selectedType) {
                    e.preventDefault();
                    selectionController.deleteSelected();
                }
            }
        });

        if (btnDelete) {
            btnDelete.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (selectionController) {
                    selectionController.deleteSelected();
                }
            });
        }

        // Zoom Buttons
        if (btnZoomIn) {
            btnZoomIn.addEventListener('click', (e) => {
                e.preventDefault();
                zoomHandler.zoomIn();
            });
        }

        if (btnZoomOut) {
            btnZoomOut.addEventListener('click', (e) => {
                e.preventDefault();
                zoomHandler.zoomOut();
            });
        }

        if (btnZoomReset) {
            btnZoomReset.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof view.reset === 'function') {
                    view.reset();
                }
                requestRedraw();
            });
        }

        // EXPORT & IMPORT
        // Geladene Datei übernehmen (klassische Datei-Auswahl und Datei-Browser)
        const applyLoadedData = (data, name = null) => {
            // Projektdaten zuerst (Module lesen sie beim Laden des Profils), dann das aktive Profil
            const info = readProjectFile(data);
            projectController.setFormData({ ...feldAuswahl({}, PROFILE_FIELDS), ...info.project });
            projectStore.load(data, artBearbeitbar);
            const fehlend = [...new Set(projectStore.entries.filter(e => !artBearbeitbar(e.type)).map(e => e.type))];
            ausmasseAufteilen();
            const anzahl = projectStore.count;
            aktivenEintragPruefen({ meldung: false });
            if (fehlend.length) {
                Toast.show(`Das Projekt enthält Ausmasse, deren Modul nicht aktiv ist (${fehlend.join(', ')}). Sie bleiben in der Datei erhalten, lassen sich aber erst mit dem Modul bearbeiten (🔌 Module verwalten).`
                    + (projectStore.count > anzahl ? ' Für die Arbeit wurde ein leeres Blechprofil ergänzt.' : ''), 'warning', 7000);
            }
            dokName = name;
            setTimeout(() => setUngespeichert(false), 100);
        };

        const projectFileData = () => projectStore.toFile(projectController.getFormData());
        const classicSave = () => {
            JSONExporter.download(projectFileData());
            setUngespeichert(false);
        };

        const btnImportJson = document.getElementById('btn-import-json');
        const fileInputJson = document.getElementById('file-input-json');
        const classicOpen = () => {
            if (!fileInputJson) return;
            fileInputJson.value = '';
            fileInputJson.click();
        };

        // Dateiname aus den Projektdaten vorschlagen (lesbar, ohne Sonderzeichen)
        const suggestedFileName = () => {
            const p = projectController.getFormData();
            const base = [p.projectNumber, p.projectName || p.profileName].filter(Boolean).join(' ') || 'Blechprofil';
            return base.replace(/[\\/:*?"<>|]+/g, '_').trim();
        };

        // Datei-Browser im Speicherordner (nur mit Ordnerzugriff, Chrome/Edge am PC)
        fileBrowser = new FileBrowserController({
            getSaveContent: () => ({ json: JSON.stringify(projectFileData(), null, 2), suggestedName: suggestedFileName() }),
            onOpen: (data, name) => applyLoadedData(data, name),
            onSaved: (name) => { dokName = name; setUngespeichert(false); },
            // Vorschau für Dateien einer Modul-Dokumentart (api.documents.addType({ preview }))
            preview: (data) => {
                const type = moduleHost && moduleHost.docTypes.find(t => t.id === data.docType);
                if (!type || !type.preview) return null;
                const own = data.modules ? data.modules[type.moduleId] : null;
                const result = type.preview(own === undefined ? null : JSON.parse(JSON.stringify(own)));
                return result && typeof result === 'object'
                    ? { thumbnail: typeof result.thumbnail === 'string' ? result.thumbnail : '', text: String(result.text || '') }
                    : null;
            },
            onClassicSave: classicSave,
            onClassicOpen: classicOpen
        });

        // ERPNext (js/storage/ErpStorage.js): Speichern und Öffnen gehen an die
        // Projektablage (Nextcloud-Projektordner/Zeichnungen bzw. "OpenBender
        // Datei") statt in den Speicherordner; der Datei-Browser zeigt sie als
        // Projektordner → offene Projekte → Dateien
        const erp = ErpStorage.config;
        let erpDatei = null;         // Kennung der geöffneten Datei (Nextcloud: Dateiname)
        let erpDateiProjekt = null;  // Projekt, in dem sie liegt
        let erpStand = null;         // Stand beim Öffnen/Speichern (ETag bzw. Änderungszeit)
        const erpProjektfelder = () => {
            if (!erp || !erp.projekt) return;
            projectController.setFormData({ ...projectController.getFormData(), projectNumber: erp.projekt, projectName: erp.projektTitel || '' });
        };
        // Adresse nachführen: Neuladen öffnet dieselbe Datei wieder
        const erpAdresse = () => {
            const q = {};
            if (erpDatei) {
                if (erpDateiProjekt) q.projekt = erpDateiProjekt;
                q.datei = erpDatei;
            } else if (erp.projekt) q.projekt = erp.projekt;
            try { history.replaceState(null, '', location.pathname + (Object.keys(q).length ? '?' + new URLSearchParams(q) : '')); } catch (e) { /* egal */ }
        };
        // Projekt-Nr. und Autor aus ERPNext wählen (Liste mit Suche), Projekt-Name
        // kommt aus dem Projekt und ist gesperrt
        let erpProjekte = [];
        let erpLeute = [];
        const erpProjektSetzen = (nr) => {
            const p = erpProjekte.find(x => x.name === nr);
            erp.projekt = nr || null;
            erp.projektTitel = p ? (p.project_name || '') : (nr ? erp.projektTitel : '');
            projectController.setFormData({ ...projectController.getFormData(), projectNumber: nr || '', projectName: erp.projektTitel || '' });
        };
        // Suchliste unter einem Eingabefeld (Projekt, Mitarbeiter): Tippen filtert
        // nach allen Wörtern (Nummer und Name), Antippen übernimmt
        const erpSuchliste = (input, eintraege, waehlen) => {
            const ohneAkzent = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const liste = document.createElement('div');
            liste.className = 'erp-suchliste';
            liste.hidden = true;
            input.parentElement.style.position = 'relative';
            input.parentElement.appendChild(liste);
            let treffer = [];
            let markiert = -1;
            // beim Antippen alle zeigen (der alte Wert ist markiert), beim Tippen filtern
            const zeigen = (alle = false) => {
                const woerter = alle ? [] : ohneAkzent(input.value).split(/\s+/).filter(Boolean);
                treffer = eintraege().filter(e => woerter.every(w => ohneAkzent(e.suche).includes(w))).slice(0, 40);
                markiert = -1;
                liste.innerHTML = treffer.length
                    ? treffer.map((e, i) => `<button type="button" class="erp-treffer" data-i="${i}"><strong>${escHtml(e.titel)}</strong>${e.text ? ` <span>${escHtml(e.text)}</span>` : ''}</button>`).join('')
                    : '<div class="erp-keine">Keine Treffer</div>';
                liste.hidden = false;
            };
            const verbergen = () => { liste.hidden = true; };
            input.addEventListener('focus', () => { input.select(); zeigen(true); });
            input.addEventListener('input', () => zeigen());
            input.addEventListener('blur', () => setTimeout(verbergen, 150));
            input.addEventListener('keydown', (ev) => {
                if (liste.hidden) return;
                if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                    ev.preventDefault();
                    markiert = Math.max(0, Math.min(treffer.length - 1, markiert + (ev.key === 'ArrowDown' ? 1 : -1)));
                    liste.querySelectorAll('.erp-treffer').forEach((b, i) => b.classList.toggle('aktiv', i === markiert));
                } else if (ev.key === 'Enter' && treffer.length) {
                    ev.preventDefault();
                    waehlen(treffer[markiert >= 0 ? markiert : 0]);
                    verbergen();
                    input.blur();
                } else if (ev.key === 'Escape') {
                    verbergen();
                }
            });
            // pointerdown statt click: das Feld verliert den Fokus erst danach
            liste.addEventListener('pointerdown', (ev) => {
                const b = ev.target.closest('.erp-treffer');
                if (!b) return;
                ev.preventDefault();
                waehlen(treffer[Number(b.dataset.i)]);
                verbergen();
                input.blur();
            });
        };
        const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        // Neue Datei: Autor = angemeldeter Mitarbeiter (falls noch leer)
        const erpAutorVorschlagen = () => {
            const autor = document.getElementById('project-author');
            if (!autor || autor.value.trim() || !erp.benutzer) return;
            const ich = erpLeute.find(m => m.user_id === erp.benutzer);
            if (!ich) return;
            projectController.setFormData({ ...projectController.getFormData(), projectAuthor: ich.employee_name });
        };
        const erpFelderEinrichten = async () => {
            const nr = document.getElementById('project-number');
            const name = document.getElementById('project-name');
            const autor = document.getElementById('project-author');
            if (!nr || !name || !autor) return;
            name.readOnly = true;
            name.title = 'Kommt aus dem Projekt in ERPNext';
            nr.placeholder = 'Projekt wählen …';
            autor.placeholder = 'Mitarbeiter wählen …';
            nr.autocomplete = 'off';
            autor.autocomplete = 'off';
            try {
                [erpProjekte, erpLeute] = await Promise.all([ErpStorage.projekte(), ErpStorage.mitarbeiter()]);
            } catch (e) {
                Toast.show('Projekte und Mitarbeiter aus ERPNext nicht verfügbar: ' + e.message, 'warning', 7000);
                return;
            }
            // Eigene Suchliste statt <datalist> (auf dem iPad nicht verfügbar):
            // Projekt nach Nummer oder Name, Mitarbeiter nach Name
            erpSuchliste(nr, () => erpProjekte.map(p => ({
                wert: p.name,
                titel: p.name,
                text: (p.project_name || '') + (p.status && p.status !== 'Open' ? ` (${p.status})` : ''),
                suche: `${p.name} ${p.project_name || ''}`
            })), (e) => {
                nr.value = e.wert;
                nr.dispatchEvent(new Event('change', { bubbles: true }));
            });
            erpSuchliste(autor, () => erpLeute.map(m => ({
                wert: m.employee_name,
                titel: m.employee_name,
                text: m.designation || '',
                suche: `${m.employee_name} ${m.designation || ''}`
            })), (e) => {
                autor.value = e.wert;
                autor.dispatchEvent(new Event('change', { bubbles: true }));
            });
            erpAutorVorschlagen();
            // nur Werte aus ERPNext zulassen; sonst der vorherige Wert
            let nrVorher = nr.value;
            let autorVorher = autor.value;
            nr.addEventListener('focus', () => { nrVorher = nr.value; });
            autor.addEventListener('focus', () => { autorVorher = autor.value; });
            nr.addEventListener('change', () => {
                const v = nr.value.trim();
                const p = erpProjekte.find(x => x.name === v) || erpProjekte.find(x => x.name.toLowerCase() === v.toLowerCase());
                if (v && !p) {
                    Toast.show(`Projekt „${v}“ gibt es in ERPNext nicht. Bitte aus der Liste wählen.`, 'warning', 5000);
                    nr.value = nrVorher;
                    return;
                }
                erpProjektSetzen(p ? p.name : '');
                nrVorher = nr.value;
                erpAdresse();
            });
            autor.addEventListener('change', () => {
                const v = autor.value.trim();
                const m = erpLeute.find(x => x.employee_name === v) || erpLeute.find(x => x.employee_name.toLowerCase() === v.toLowerCase());
                if (v && !m) {
                    Toast.show(`„${v}“ ist kein aktiver Mitarbeiter in ERPNext. Bitte aus der Liste wählen.`, 'warning', 5000);
                    autor.value = autorVorher;
                    return;
                }
                autor.value = m ? m.employee_name : '';
                autorVorher = autor.value;
            });
            // Projektname nachführen, falls die Liste erst nach dem Öffnen kam
            if (erp.projekt) erpProjektSetzen(erp.projekt);
        };
        const erpUebernehmen = (d) => {
            applyLoadedData(d.inhalt || {}, d.titel || d.name);
            erpDatei = d.name;
            erpDateiProjekt = d.projekt || null;
            erpStand = d.stand || null;
            // Massgebend ist das Projekt, in dem die Datei liegt
            if (d.projekt || erp.projekt) erpProjektSetzen(d.projekt || '');
            erpAdresse();
        };
        const erpOeffnen = async (name, projekt) => erpUebernehmen(await ErpStorage.load(name, projekt));
        // Stand beim Rüstauftrag (Kopie am Auftrag) öffnen: als neue, ungespeicherte Datei,
        // Speichern legt eine neue Datei an und überschreibt nie das Original
        const erpStandOeffnen = async (ruestauftrag) => {
            const d = await ErpStorage.call('openbender_erp.ruestauftrag.stand_laden', { name: ruestauftrag });
            applyLoadedData(d.inhalt || {}, `Stand ${d.name}`);
            erpDatei = null;
            erpDateiProjekt = null;
            erpStand = null;
            erpProjektSetzen(d.projekt || '');
            setTimeout(() => setUngespeichert(true), 150);
            Toast.show(`Stand beim Rüstauftrag ${d.name} als Kopie geöffnet${d.datei ? ` (Datei „${d.datei}“)` : ''}. Speichern legt eine neue Datei an.`, 'info', 9000);
        };
        const erpNeu = () => {
            newDocument('profile');
            erpDatei = null;
            erpDateiProjekt = null;
            erpStand = null;
            erpProjektfelder();
            erpAutorVorschlagen();
            erpAdresse();
            setTimeout(() => setUngespeichert(false), 150);
        };
        const erpGespeichert = (res) => {
            erpDatei = res.name;
            erpDateiProjekt = res.projekt || null;
            erpStand = res.stand || null;
            erpAdresse();
            dokName = res.titel || res.name;
            setUngespeichert(false);
            const wo = erp.ablage === 'nextcloud' && res.projekt ? ` in ${erpOrdnerName(res.projekt)}/${erp.unterordner || ''}` : '';
            Toast.show(`Gespeichert: ${res.titel || res.name}${wo}`, 'info');
        };

        // Datei-Browser im ERP-Modus: Projektordner (offene Projekte) → Dateien
        let erpOrdner = null;   // [{ name, project_name, ordner }]
        const erpOrdnerLaden = async (neu = false) => {
            if (!erpOrdner || neu) erpOrdner = await ErpStorage.projektordner();
            return erpOrdner;
        };
        const erpOrdnerName = (projekt) => {
            const o = (erpOrdner || []).find(x => x.name === projekt);
            return o ? (o.ordner || `${o.name} - ${o.project_name || ''}`.replace(/ - $/, '')) : projekt;
        };
        const erpProjektVonOrdner = (name) => {
            const o = (erpOrdner || []).find(x => (x.ordner || `${x.name} - ${x.project_name || ''}`.replace(/ - $/, '')) === name);
            return o ? o.name : null;
        };
        const erpBrowser = {
            rootLabel: 'Projektordner',
            unterordner: erp && erp.ablage === 'nextcloud' ? (erp.unterordner || 'Zeichnungen') : '',
            async list(path) {
                const ordner = await erpOrdnerLaden(path.length === 0);
                if (path.length === 0) {
                    return {
                        folders: ordner.map(o => {
                            const ohne = erp.ablage === 'nextcloud' && !o.ordner;
                            return { name: erpOrdnerName(o.name), disabled: ohne, title: ohne ? `${o.name}: kein Nextcloud-Ordner verknüpft` : '' };
                        }),
                        files: [],
                        schreibbar: false
                    };
                }
                const projekt = erpProjektVonOrdner(path[0]);
                if (!projekt) return null;
                const r = await ErpStorage.list(projekt, true);
                return {
                    folders: [],
                    files: (r.dateien || []).map(d => ({
                        name: `${d.titel || d.name}.json`,
                        id: d.name,
                        projekt,
                        modified: d.modified ? Date.parse(String(d.modified).replace(' ', 'T')) : Date.now(),
                        data: d.inhalt || null
                    })),
                    schreibbar: r.schreibbar !== false
                };
            },
            istAktuell(entry) {
                return !!erpDatei && entry.id === erpDatei && entry.projekt === erpDateiProjekt;
            },
            async open(entry) {
                erpUebernehmen(await ErpStorage.load(entry.id, entry.projekt));
            },
            async save(path, base, { existing, isCurrent }) {
                const projekt = erpProjektVonOrdner(path[0]);
                if (!projekt) throw new Error('Projekt nicht gefunden.');
                // Ablage-Projekt = Projekt der Datei; Projektfelder nachführen
                if (projekt !== erp.projekt) erpProjektSetzen(projekt);
                const res = await ErpStorage.save({
                    name: isCurrent ? erpDatei : null,
                    projekt,
                    titel: base,
                    inhalt: projectFileData(),
                    stand: isCurrent ? erpStand : null,
                    ueberschreiben: !!existing && !isCurrent
                });
                erpGespeichert(res);
            }
        };
        const erpPfad = async (projekt) => {
            if (!projekt) return [];
            try { await erpOrdnerLaden(); } catch (e) { return []; }
            return erpProjektVonOrdner(erpOrdnerName(projekt)) ? [erpOrdnerName(projekt)] : [];
        };
        const erpSpeichern = async () => {
            // Geöffnete Datei im selben Projekt: direkt speichern, sonst Speichern-Dialog im Projekt
            if (erpDatei && erp.projekt === erpDateiProjekt) {
                try {
                    erpGespeichert(await ErpStorage.save({ name: erpDatei, projekt: erpDateiProjekt, titel: dokName || erpDatei, inhalt: projectFileData(), stand: erpStand }));
                } catch (e) {
                    Toast.show('Speichern fehlgeschlagen: ' + e.message, 'warning', 8000);
                }
                return;
            }
            fileBrowser.open('save', await erpPfad(erp.projekt));
        };
        // Rüstauftrag: Daten je Blechprofil, Rüst-PDF und gespeicherte Datei
        const erpRuestauftragKontext = () => ({
            ui: moduleHost.ui,
            erp,
            toast: (text, art = 'info', dauer) => Toast.show(text, art, dauer),
            // Der Auftrag bezieht sich auf die gespeicherte Datei im Projekt
            dateiBereit: async () => {
                if (erpDatei && erp.projekt === erpDateiProjekt && !ungespeichert) return erpDatei;
                if (!erpDatei || erp.projekt !== erpDateiProjekt) {
                    Toast.show('Bitte die Datei zuerst im Projekt speichern, dann den Rüstauftrag erstellen.', 'warning', 6000);
                    erpSpeichern();
                    return null;
                }
                if (!(await moduleHost.ui.confirm('Zuerst speichern?', 'Der Rüstauftrag bezieht sich auf die gespeicherte Datei. Jetzt speichern und weiter?'))) return null;
                await erpSpeichern();
                return ungespeichert ? null : erpDatei;
            },
            profileSammeln: async () => {
                const liste = [];
                await mitJedemProfil((entry, i) => {
                    const f = projectController.getFormData();
                    const cd = cuttingController.getPdfData();
                    const r = cd && cd.result;
                    const s = r && r.selected;
                    const pos = cutlistController.toJSON().map(x => ({ length: x.length, quantity: x.quantity, interlocking: !!x.interlocking, note: x.note || '' }));
                    const p = {
                        id: entry.id,
                        name: profilName(entry, i),
                        material_typ: f.materialType || '',
                        sorte: f.materialSpec || '',
                        dicke: parseFloat(f.materialThickness) || 0,
                        positionen: pos,
                        stueck: pos.reduce((n, x) => n + (parseInt(x.quantity, 10) || 0), 0),
                        ok: !!(s && s.plan && s.plan.feasible && f.materialType && parseFloat(f.materialThickness) > 0)
                    };
                    if (p.ok) {
                        p.lieferform = r.sheet ? 'Tafel' : 'Rolle';
                        p.kg = s.plan.kg || 0;
                        // Gewicht der fertigen Teile (ohne Verschnitt) für die Etikette des Blechbündels
                        const u = profile.getUnfoldLengths();
                        const nettoBreite = Math.max(0, (u.blank || 0) - (u.waste || 0)) / 1000;
                        p.kg_netto = Math.round(pos.reduce((summe, x) => summe + nettoBreite * laengeM(x.length) * (parseInt(x.quantity, 10) || 0), 0)
                            * (s.kgPerM2 || 0) * 10) / 10;
                        p.zuschnitt = r.sheet
                            ? `${s.plan.sheetCount} × Tafel ${s.width} × ${s.length} mm`
                            : `Rolle ${s.width} mm, ${(s.plan.coilLength / 1000).toFixed(2)} m`;
                        p.gemeinsam = r.gemeinsam ? r.members.map(m => m.profId).sort().join(',') : '';
                    } else {
                        p.grund = 'kein Zuschnitt – Material, Dicke oder Stückliste fehlt';
                    }
                    p.schluessel = pruefschluessel(JSON.stringify({ g: profile.toData(), c: pos, m: [p.material_typ, p.sorte, p.dicke], z: p.zuschnitt || '' }));
                    liste.push(p);
                });
                return liste;
            },
            dateiInhalt: () => projectFileData(),
            dateiStand: () => erpStand,
            pdfTeile: () => [
                { key: 'zuschnitt:liste', label: 'Zuschnittliste (zum Abhaken)', standard: true },
                { key: 'zuschnitt:grafik', label: 'Zuschnitt-Visualisierung (Rolle bzw. Tafel)', standard: true },
                ...moduleHost.pdfSections()
            ],
            pdfErstellen: async (ids, auswahl) => {
                const projekt = projectController.getFormData();
                const doc = PDFExporter.neu();
                projectStore.sync();
                PDFExporter.projektSeite(doc, projekt, projectStore.entries
                    .map((e, i) => ({ e, i })).filter(({ e }) => ids.includes(e.id))
                    .map(({ e, i }) => ({ ...profilInfo(e, i), nr: i + 1 })));
                const gedruckt = new Set();
                await mitJedemProfil((entry) => {
                    if (!ids.includes(entry.id)) return;
                    let cd = cuttingController.getPdfData();
                    if (cd && cd.result.gemeinsam) {
                        const gruppe = cd.result.members.map(m => m.profId).sort().join(',');
                        if (gedruckt.has(gruppe)) cd = null;
                        else gedruckt.add(gruppe);
                    }
                    PDFExporter.export(profile, canvas, cutlistController.toJSON(), projectController.getFormData(), cd, moduleHost, auswahl, { doc, offen: true });
                });
                return PDFExporter.abschliessen(doc, 'ruestauftrag.pdf', { alsBlob: true });
            }
        });
        const erpOeffnenDialog = async () => {
            fileBrowser.open('open', await erpPfad(erp.projekt));
        };
        if (erp) {
            fileBrowser.setErp(erpBrowser);
            // Zurück zu ERPNext (Tablet/App ohne Zurück-Taste): zum Projekt bzw. nach /app
            const erpZurueck = async () => {
                if (ungespeichert && !(await moduleHost.ui.confirm('Zurück zu ERPNext?',
                    'Änderungen seit dem letzten Speichern gehen verloren. Zuerst speichern mit „Speichern“.'))) return;
                const ziel = erp.projekt ? `/app/project/${encodeURIComponent(erp.projekt)}` : (erp.zurueck || '/app');
                // in einem eigenen Tab aus ERPNext geöffnet: Tab schliessen, ERPNext ist noch offen
                if (window.opener && !window.opener.closed) {
                    try { window.opener.focus(); } catch (e) { /* egal */ }
                    window.close();
                }
                setTimeout(() => { window.location.href = ziel; }, 150);
            };
            const leiste = document.getElementById('btn-undo') && document.getElementById('btn-undo').parentElement;
            if (leiste) {
                const btnZ = document.createElement('button');
                btnZ.id = 'btn-erp-zurueck';
                btnZ.className = 'erp-zurueck';
                btnZ.title = 'Zurück zu ERPNext';
                btnZ.innerHTML = '<span class="lbl-long">← ERPNext</span><span class="lbl-short">←</span>';
                btnZ.addEventListener('click', erpZurueck);
                leiste.insertBefore(btnZ, leiste.firstChild);
            }
            const menu = document.getElementById('mobile-menu');
            if (menu) {
                const item = document.createElement('button');
                item.type = 'button';
                item.setAttribute('role', 'menuitem');
                item.textContent = '← Zurück zu ERPNext';
                item.addEventListener('click', () => { menu.classList.add('hidden'); erpZurueck(); });
                menu.insertBefore(item, menu.firstChild);
            }
            const stil = document.createElement('style');
            stil.textContent = `
                .erp-zurueck { font-weight: 600; }
                .erp-suchliste { position: absolute; left: 0; right: 0; top: 100%; z-index: 500; max-height: 50vh; overflow-y: auto;
                    background: #fff; border: 1px solid #ced4da; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.15); margin-top: 2px; }
                .erp-suchliste .erp-treffer { display: block; width: 100%; text-align: left; padding: 10px 12px; min-height: 44px;
                    border: 0; border-bottom: 1px solid #f1f3f5; background: #fff; font: inherit; color: #2c3e50; cursor: pointer; }
                .erp-suchliste .erp-treffer span { color: #6c757d; }
                .erp-suchliste .erp-treffer:hover, .erp-suchliste .erp-treffer.aktiv { background: #e8f8f5; }
                .erp-suchliste .erp-keine { padding: 10px 12px; color: #6c757d; }`;
            document.head.appendChild(stil);
            // Rüstauftrag (js/storage/ErpRuestauftrag.js): Knopf neben PDF und im Menü
            const btnPdf = document.getElementById('btn-export-pdf');
            if (btnPdf) {
                const btnRa = document.createElement('button');
                btnRa.id = 'btn-ruestauftrag';
                btnRa.className = 'desktop-only profile-doc-only';
                btnRa.title = 'Rüstauftrag in ERPNext erstellen (Profile wählen, Rüst-PDF, Bestand)';
                btnRa.textContent = 'Rüstauftrag';
                btnPdf.before(btnRa);
                btnRa.addEventListener('click', () => ruestauftragErstellen(erpRuestauftragKontext()));
                const menuPdf = document.querySelector('#mobile-menu [data-click="btn-export-pdf"]');
                if (menuPdf) {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.setAttribute('role', 'menuitem');
                    item.dataset.click = 'btn-ruestauftrag';
                    item.textContent = 'Rüstauftrag erstellen';
                    menuPdf.after(item);
                }
            }
            // PDF (Kern und Module, alle über jsPDF.save): Ablage im Projekt statt Download
            const JsPdf = window.jspdf && window.jspdf.jsPDF;
            if (JsPdf && JsPdf.API && !JsPdf.API.erpAblage) {
                JsPdf.API.erpAblage = true;
                JsPdf.API.save = function (name = 'openbender.pdf', opts) {
                    const fertig = Ausgabe.speichern(name, this.output('blob'), 'application/pdf');
                    return opts && opts.returnPromise ? fertig : this;
                };
            }
            // Info-Fenster: welcher Stand läuft (openBender und ERPNext-App)
            const versionZeile = document.querySelector('.info-panel-version');
            if (versionZeile && erp.appVersion) {
                const s = document.createElement('span');
                s.className = 'info-panel-erp-version';
                s.textContent = ` · ERPNext-App ${erp.appVersion}` + (erp.openbenderVersion ? ` (openBender ${erp.openbenderVersion})` : '');
                versionZeile.appendChild(s);
            }
        }
        // Beim Start (nach dem Laden der Module): gewählte Datei öffnen bzw. neue Datei mit Projektdaten
        if (erp) {
            // "Neu" im ERP-Betrieb: neue Datei im selben Projekt, Projektdaten bleiben
            globalEventBus.on('document:new', () => {
                erpDatei = null;
                erpDateiProjekt = null;
                erpStand = null;
                setTimeout(() => { erpProjektfelder(); erpAutorVorschlagen(); }, 0);
                erpAdresse();
            });
            erpStart = async () => {
                Ausgabe.ui = moduleHost.ui;   // Rückfrage, wenn eine Ausgabe-Datei schon existiert
                erpFelderEinrichten();
                try {
                    if (erp.ruestauftrag) await erpStandOeffnen(erp.ruestauftrag);
                    else if (erp.datei) await erpOeffnen(erp.datei, erp.projekt);
                    else erpNeu();
                } catch (e) {
                    Toast.show('Datei aus ERPNext konnte nicht geöffnet werden: ' + e.message, 'warning', 8000);
                }
            };
        }

        const btnExportJson = document.getElementById('btn-export-json');
        if (btnExportJson) {
            btnExportJson.addEventListener('click', () => {
                if (erp) erpSpeichern();
                else if (FolderStorage.isSupported()) fileBrowser.open('save');
                else classicSave();
            });
        }

        if (btnImportJson && fileInputJson) {
            btnImportJson.addEventListener('click', async () => {
                if (ungespeichert && moduleHost && !(await moduleHost.ui.confirm('Andere Datei öffnen?',
                    'Profil, Stückliste und Projektdaten werden ersetzt. Was seit dem letzten Speichern geändert wurde, geht verloren.'))) return;
                if (erp) erpOeffnenDialog();
                else if (FolderStorage.isSupported()) fileBrowser.open('open');
                else classicOpen();
            });

            fileInputJson.addEventListener('change', (event) => {
                const file = event.target.files[0];
                if (!file) return;

                JSONExporter.import(file, (err, data) => {
                    if (err) {
                        alert('Fehler beim Laden der Datei: ' + err.message);
                        return;
                    }
                    applyLoadedData(data, file.name);
                });
            });
        }

        // DXF: normales Profil direkt; konisches Profil über einen Dialog
        // (2D nebeneinander oder 3D-Drahtmodell mit Länge aus der Stückliste)
        const btnExportDXF = document.getElementById('btn-export-dxf');
        const dxfDialog = document.getElementById('dxf-dialog-overlay');
        const selDxfPosition = document.getElementById('sel-dxf-position');
        const closeDxfDialog = () => dxfDialog && dxfDialog.classList.add('hidden');
        const dxfMode = () => (document.querySelector('input[name="dxf-mode"]:checked') || {}).value || '2d';
        const updateDxfLengthState = () => {
            const row = document.getElementById('dxf-length-row');
            if (row) row.classList.toggle('disabled', dxfMode() !== '3d');
        };

        if (btnExportDXF) {
            btnExportDXF.addEventListener('click', async () => {
                if (currentDocType.id !== 'profile') {
                    runDocExport('dxf');
                    return;
                }
                // Projekt mit mehreren Profilen: aktives Profil oder alle (je Profil eine Datei)
                const anzahlProfile = profilEintraege().length;
                if (anzahlProfile > 1) {
                    const aktivName = profilName({ fields: projectController.getFormData() }, projectStore.indexOf(projectStore.activeId));
                    const werte = await moduleHost.ui.prompt({
                        title: 'DXF exportieren',
                        okLabel: 'Weiter',
                        fields: [{
                            key: 'umfang', label: 'Profile', type: 'select', value: 'aktiv',
                            options: [{ value: 'aktiv', label: `Nur das aktive Profil (${aktivName})` }, { value: 'alle', label: `Alle ${anzahlProfile} Blechprofile (je Profil eine Datei)` }],
                            help: 'Bei allen Profilen lädt der Browser mehrere Dateien herunter und fragt dafür eventuell einmal nach. Konische Profile: vorne und hinten nebeneinander (2D).'
                        }]
                    });
                    if (!werte) return;
                    if (werte.umfang === 'alle') {
                        await mitJedemProfil(async (entry, i) => {
                            if (profile.points.length < 2) return;
                            DXFExporter.export(profile, { ...projectController.getFormData(), profileName: profilName(entry, i) }, profile.conical ? { mode: '2d' } : {});
                            await new Promise(res => setTimeout(res, 350));
                        });
                        return;
                    }
                }
                if (!profile.conical || !dxfDialog) {
                    DXFExporter.export(profile, projectController.getFormData());
                    return;
                }
                fillPositionSelect(selDxfPosition);
                updateDxfLengthState();
                dxfDialog.classList.remove('hidden');
            });
        }

        if (dxfDialog) {
            document.querySelectorAll('input[name="dxf-mode"]').forEach(radio => radio.addEventListener('change', updateDxfLengthState));
            document.getElementById('dxf-dialog-export').addEventListener('click', () => {
                DXFExporter.export(profile, projectController.getFormData(), {
                    mode: dxfMode(),
                    lengthMm: getSelectedLengthMm(selDxfPosition)
                });
                closeDxfDialog();
            });
            document.getElementById('dxf-dialog-cancel').addEventListener('click', closeDxfDialog);
            document.getElementById('dxf-dialog-close').addEventListener('click', closeDxfDialog);
            dxfDialog.addEventListener('click', (e) => { if (e.target === dxfDialog) closeDxfDialog(); });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && !dxfDialog.classList.contains('hidden')) closeDxfDialog();
            });
        }

        const btnExportPNG = document.getElementById('btn-export-png');
    if (btnExportPNG) btnExportPNG.addEventListener('click', () => PNGExporter.export(canvas));

    const btnExportPdf = document.getElementById('btn-export-pdf');
    if (btnExportPdf) {
        btnExportPdf.addEventListener('click', () => {
            if (currentDocType.id !== 'profile') {
                runDocExport('pdf');
                return;
            }
            pdfMitAuswahl();
        });
    }

    // PDF: Profil und Stückliste sind immer dabei; Zuschnitt und die Abschnitte der
    // Module (api.pdf.addPages mit label) werden im Dialog per Checkbox gewählt.
    // Die Wahl merkt sich der Browser als Bedienkomfort (fehlt sie, gilt die Vorgabe).
    const PDF_AUSWAHL_KEY = 'openbender.pdf.auswahl';
    async function pdfMitAuswahl() {
        // leeres Profil: gleich die Meldung des Exports statt erst den Dialog
        const anzahlProfile = profilEintraege().length;
        const mehrere = currentDocType.id === 'profile' && anzahlProfile > 1;
        if (!mehrere && (!profile.points || profile.points.length < 2)) {
            PDFExporter.export(profile, canvas, [], {}, null, null);
            return;
        }
        const cuttingData = cuttingController.getPdfData();
        const ohneZuschnitt = 'nicht verfügbar – noch kein Zuschnitt (Stückliste und Material fehlen)';
        // bei „alle Profile“ entscheidet jedes Profil selbst, ob es einen Zuschnitt hat
        const teile = [
            { key: 'zuschnitt:liste', label: 'Zuschnittliste (zum Abhaken)', standard: true, disabled: !cuttingData && !mehrere, help: cuttingData || mehrere ? '' : ohneZuschnitt },
            { key: 'zuschnitt:grafik', label: 'Zuschnitt-Visualisierung (Rolle bzw. Tafel)', standard: true, disabled: !cuttingData && !mehrere, help: cuttingData || mehrere ? '' : ohneZuschnitt },
            ...(moduleHost ? moduleHost.pdfSections() : [])
        ];
        let gemerkt = {};
        try { gemerkt = JSON.parse(localStorage.getItem(PDF_AUSWAHL_KEY) || '{}') || {}; } catch (e) { gemerkt = {}; }
        const aktivName = profilName({ fields: projectController.getFormData() }, projectStore.indexOf(projectStore.activeId));
        const werte = await moduleHost.ui.prompt({
            title: 'PDF ausgeben',
            text: 'Das Produktionsdatenblatt mit Profil und Stückliste ist immer dabei. Welche Inhalte sollen zusätzlich ins PDF?',
            okLabel: 'PDF erstellen',
            fields: [
                // Projekt mit mehreren Profilen: Vorgabe ist immer das aktive Profil
                ...(mehrere ? [{
                    key: 'umfang', label: 'Profile', type: 'select', value: 'aktiv',
                    options: [{ value: 'aktiv', label: `Nur das aktive Profil (${aktivName})` }, { value: 'alle', label: `Alle ${anzahlProfile} Blechprofile des Projekts (mit Projektübersicht)` }]
                }] : []),
                ...teile.map(s => ({
                    key: s.key, label: s.label, type: 'check', disabled: s.disabled, help: s.help,
                    value: !s.disabled && (s.key in gemerkt ? !!gemerkt[s.key] : s.standard !== false)
                }))
            ]
        });
        if (!werte) return;
        // gesperrte Inhalte (z.B. noch kein Zuschnitt) nicht als „aus“ merken,
        // sonst fehlen sie später, wenn sie verfügbar sind
        const merken = Object.fromEntries(Object.entries(werte).filter(([k]) => k !== 'umfang' && !teile.some(t => t.key === k && t.disabled)));
        try { localStorage.setItem(PDF_AUSWAHL_KEY, JSON.stringify({ ...gemerkt, ...merken })); } catch (e) { /* ohne Speicher: nächstes Mal wieder die Vorgabe */ }
        const auswahl = new Set(Object.keys(werte).filter(k => werte[k] === true));
        if (werte.umfang !== 'alle') {
            PDFExporter.export(profile, canvas, cutlistController.toJSON(), projectController.getFormData(), cuttingData, moduleHost, auswahl);
            return;
        }

        // Alle Profile: Projektübersicht, dann je Profil dessen Seiten. Ein gemeinsamer
        // Zuschnitt (mehrere Profile auf einer Rolle) erscheint nur beim ersten Profil der Gruppe.
        const projekt = projectController.getFormData();
        const doc = PDFExporter.neu();
        projectStore.sync();
        PDFExporter.projektSeite(doc, projekt, projectStore.entries
            .map((e, i) => ({ e, i })).filter(({ e }) => (e.type || 'profile') === 'profile')
            .map(({ e, i }) => ({ ...profilInfo(e, i), nr: i + 1 })));
        const gedruckt = new Set();
        await mitJedemProfil(() => {
            let cd = cuttingController.getPdfData();
            if (cd && cd.result.gemeinsam) {
                const gruppe = cd.result.members.map(m => m.profId).sort().join(',');
                if (gedruckt.has(gruppe)) cd = null;
                else gedruckt.add(gruppe);
            }
            PDFExporter.export(profile, canvas, cutlistController.toJSON(), projectController.getFormData(), cd, moduleHost, auswahl, { doc, offen: true });
        });
        PDFExporter.abschliessen(doc, DXFExporter.fileName({ projectNumber: projekt.projectNumber, profileName: projekt.projectName || 'Projekt' }, '', new Date(), 'pdf'));
    }

    // Blechprofile des Projekts (ohne Ausmasse anderer Art)
    const profilEintraege = () => projectStore.entries.filter(e => (e.type || 'profile') === 'profile');

    /**
     * fn(entry, index) nacheinander mit jedem Blechprofil des Projekts als aktivem
     * Profil ausführen (PDF / DXF aller Profile); index = Platz in der Leiste.
     * Danach ist wieder das vorherige aktiv.
     */
    async function mitJedemProfil(fn) {
        const start = projectStore.activeId;
        try {
            for (const [i, e] of projectStore.entries.map(x => x).entries()) {
                if ((e.type || 'profile') !== 'profile') continue;
                projectStore.select(e.id);
                await fn(projectStore.active, i);
            }
        } finally {
            projectStore.select(start);
            if (profileList) profileList.render();
        }
    }

    // Checkbox Maßanzeige
    const chkShowDimensions = document.getElementById('chk-show-dimensions');
    if (chkShowDimensions) {
        chkShowDimensions.addEventListener('change', (e) => {
            renderer.setShowDimensions(e.target.checked);
        });
    }

    // Abwicklungs-Berechnung
    const totalLengthDisplay = document.getElementById('total-length-display');
    const updateTotalLength = () => {
        if (!totalLengthDisplay || !profile || !profile.segments) return;

        const unfold = profile.getUnfoldLengths();
        if (profile.conical) {
            totalLengthDisplay.innerHTML = `Abwicklung: vorne <strong>${Math.round(unfold.front)} mm</strong> · hinten <strong>${Math.round(unfold.back)} mm</strong>`;
        } else {
            totalLengthDisplay.innerHTML = `Abwicklung: <strong>${Math.round(unfold.front)} mm</strong>`;
        }
    };

    globalEventBus.on('profile:updated', updateTotalLength);
    updateTotalLength();

    // Optionen im Info-Panel: Speicherordner
    const optFolderName = document.getElementById('opt-folder-name');
    const optFolderNote = document.getElementById('opt-folder-note');
    const optFolderChoose = document.getElementById('opt-folder-choose');
    const updateStorageOption = async () => {
        if (!optFolderName) return;
        if (ErpStorage.isActive()) {
            const row = document.getElementById('opt-folder-row');
            if (row) row.classList.add('hidden');
            optFolderNote.textContent = 'ERPNext-Betrieb: Dateien liegen im Projektordner (Unterordner „Zeichnungen“), Vorlagen und eigene Materialien in ERPNext. Ein Speicherordner wird nicht gebraucht.';
            return;
        }
        if (!FolderStorage.isSupported()) {
            optFolderName.textContent = 'nicht verfügbar';
            if (optFolderChoose) optFolderChoose.classList.add('hidden');
            // Brave hat den Ordnerzugriff absichtlich abgeschaltet, lässt sich aber einschalten
            const isBrave = !!(navigator.brave && await navigator.brave.isBrave().catch(() => false));
            optFolderNote.textContent = isBrave
                ? 'Brave hat den Ordnerzugriff standardmässig abgeschaltet. Einschalten: in der Adresszeile brave://flags/#file-system-access-api öffnen, auf „Enabled“ stellen und Brave neu starten. Bis dahin wird per Download gespeichert und per Datei-Auswahl geladen.'
                : 'Ein Speicherordner geht nur mit Chrome oder Edge am PC (in Brave nach Einschalten unter brave://flags). Hier wird wie gewohnt per Download gespeichert und per Datei-Auswahl geladen.';
            return;
        }
        const root = await FolderStorage.getRoot();
        optFolderName.textContent = root ? (root.name || 'Speicherordner') : 'noch keiner gewählt';
        if (optFolderChoose) optFolderChoose.textContent = root ? 'Ändern' : 'Ordner wählen';
        const granted = root ? await FolderStorage.ensurePermission(root, false) : false;
        optFolderNote.textContent = root
            ? 'Speichern und Laden öffnen den Datei-Browser in diesem Ordner. Die Profile liegen als JSON-Dateien im Ordner – Browser-Cache leeren löscht nichts.'
                + (granted ? '' : ' Beim nächsten Öffnen fragt der Browser einmal nach der Erlaubnis.')
            : 'Ordner auf der Festplatte oder einem Netzlaufwerk wählen. openBender merkt sich die Auswahl.';
    };
    if (optFolderChoose) {
        optFolderChoose.addEventListener('click', async () => {
            try {
                await FolderStorage.chooseRoot();
                fileBrowser.forgetDocument();
                Textures.reset();
                Materials.load(true);
            } catch (e) {
                if (e && e.name !== 'AbortError') Toast.show('Ordner konnte nicht gewählt werden.', 'warning');
            }
            updateStorageOption();
        });
    }
    document.addEventListener('openbender:storage-changed', () => { updateStorageOption(); Textures.reset(); Materials.load(false); });
    // Eigene Materialien (Einstellungen → Material): beim Start laden; wartet der
    // Speicherordner auf die Freigabe, nach der ersten Freigabe (z.B. Datei-Browser)
    Materials.load(false);
    document.addEventListener('openbender:folder-granted', () => {
        if (Materials.state().source === 'waiting') Materials.load(false);
    });

    // Info-Panel (Version, Autor, Lizenz, Optionen)
    const btnInfo = document.getElementById('btn-info');
    const infoPanelOverlay = document.getElementById('info-panel-overlay');
    const infoPanelClose = document.getElementById('info-panel-close');
    if (btnInfo && infoPanelOverlay) {
        const openInfoPanel = () => infoPanelOverlay.classList.remove('hidden');
        const closeInfoPanel = () => infoPanelOverlay.classList.add('hidden');

        btnInfo.addEventListener('click', openInfoPanel);
        if (infoPanelClose) infoPanelClose.addEventListener('click', closeInfoPanel);

        // Klick auf den abgedunkelten Hintergrund schliesst das Panel ebenfalls
        infoPanelOverlay.addEventListener('click', (e) => {
            if (e.target === infoPanelOverlay) closeInfoPanel();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !infoPanelOverlay.classList.contains('hidden')) {
                closeInfoPanel();
            }
        });
    }

    // --- HANDY-LAYOUT (schmaler als 640 px, siehe styles.css) ---
    const isPhone = () => window.matchMedia('(max-width: 640px)').matches;

    // Ganzes Profil zeigen (beim konischen Profil beide Enden)
    const fitProfileToView = () => {
        const pts = profile.conical
            ? [...profile.points, ...profile.computeBackGeometry().points]
            : profile.points;
        view.fitToPoints(pts);
    };
    einpassen = fitProfileToView;
    const btnZoomFit = document.getElementById('btn-zoom-fit');
    if (btnZoomFit) btnZoomFit.addEventListener('click', () => { fitProfileToView(); requestRedraw(); });

    // Menü "⋯" mit den auf dem Handy ausgeblendeten Toolbar-Aktionen
    const btnMore = document.getElementById('btn-more');
    const mobileMenu = document.getElementById('mobile-menu');
    const toolbarEl = document.getElementById('toolbar');
    const closeMobileMenu = () => mobileMenu && mobileMenu.classList.add('hidden');

    if (btnMore && mobileMenu) {
        btnMore.addEventListener('click', (e) => {
            e.stopPropagation();
            const opening = mobileMenu.classList.contains('hidden');
            if (opening) {
                mobileMenu.style.top = `${toolbarEl.getBoundingClientRect().bottom + 4}px`;
                // Ansichts-Aktionen nur im Profil-Tab
                const profileActive = viewProfile && viewProfile.classList.contains('active');
                mobileMenu.querySelectorAll('[data-action="fit"], [data-click="btn-zoom-reset"]').forEach(item => {
                    item.classList.toggle('disabled', !profileActive);
                });
            }
            mobileMenu.classList.toggle('hidden', !opening);
        });

        mobileMenu.addEventListener('click', (e) => {
            const item = e.target.closest('button');
            if (!item) return;
            closeMobileMenu();
            if (item.dataset.action === 'fit') {
                fitProfileToView();
            } else if (item.dataset.action === 'profile') {
                profileList.setOffen(true);
            } else if (item.dataset.action === 'settings') {
                if (settings) settings.open();
            } else if (item.dataset.action === 'templates') {
                templateController.toggleMenu(btnMore);
            } else if (item.dataset.click) {
                const target = document.getElementById(item.dataset.click);
                if (target && !target.classList.contains('disabled')) target.click();
            }
        });
    }

    // Optionen der Statusleiste als Feld über der Leiste (⚙)
    const statusBar = document.getElementById('status-bar');
    const btnOptions = document.getElementById('btn-options');
    const setOptionsOpen = (open) => {
        if (!statusBar) return;
        statusBar.classList.toggle('options-open', open);
        if (btnOptions) btnOptions.setAttribute('aria-expanded', String(open));
    };

    if (btnOptions && statusBar) {
        btnOptions.addEventListener('click', (e) => {
            e.stopPropagation();
            setOptionsOpen(!statusBar.classList.contains('options-open'));
        });
        // Aktions-Buttons im Feld schliessen es, Häkchen nicht
        statusBar.querySelectorAll('.info-group .status-btn').forEach(btn => {
            btn.addEventListener('click', () => setOptionsOpen(false));
        });
    }

    // Tippen ausserhalb schliesst Menü und Optionsfeld
    document.addEventListener('pointerdown', (e) => {
        if (mobileMenu && !mobileMenu.classList.contains('hidden') && !mobileMenu.contains(e.target) && e.target !== btnMore) {
            closeMobileMenu();
        }
        if (statusBar && statusBar.classList.contains('options-open') && !statusBar.contains(e.target)) {
            setOptionsOpen(false);
        }
    });

    // Auf dem Handy beim Start das ganze Profil zeigen
    if (isPhone()) fitProfileToView();

    // Autosave: bei jeder Profiländerung und jeder Eingabe in Stückliste /
    // Projektdaten, zusätzlich beim Verlassen der Seite.
    const autosave = new Autosave(() => projectStore.toFile(projectController.getFormData()));
    // Jede Änderung am Dokument: Autosave planen und Module informieren
    // (Ereignis document:changed, siehe docs/module.md)
    const markChanged = () => {
        if (profilWechsel) return;
        if (!ungespeichert) setUngespeichert(true);
        autosave.schedule();
        globalEventBus.emit('document:changed');
    };
    globalEventBus.on('profile:updated', markChanged);
    globalEventBus.on('cutting:changed', markChanged);
    const viewZuschnittEl = document.getElementById('view-zuschnitt');
    if (viewZuschnittEl) viewZuschnittEl.addEventListener('input', markChanged);
    const viewCutlistEl = document.getElementById('view-cutlist');
    if (viewCutlistEl) {
        ['input', 'change', 'click'].forEach(type => viewCutlistEl.addEventListener(type, markChanged));
    }
    window.addEventListener('pagehide', () => autosave.saveNow());

    // Erweiterungsmodule (docs/module.md). Die App-Seite der Schnittstelle:
    // alles, was Module am Dokument ändern dürfen, geht über diese Funktionen.
    moduleHost = new ModuleHost({
        profile,
        cutlist: cutlistController,
        project: projectController,
        setProfile: (data, opts = {}) => {
            labelEditController.close();
            selectionController.clearSelection();
            profile.loadData(data);
            updateConicalUI();
            drawingController.setActivePoint(profile.points.length - 1);
            globalEventBus.emit('profile:updated');
            if (opts.fit) fitProfileToView();
        },
        setCutlist: (items) => {
            cutlistController.fromJSON(items);
            cuttingController.refresh();
            markChanged();
        },
        setProject: (partial) => {
            projectController.setFormData({ ...projectController.getFormData(), ...partial });
            cuttingController.refresh();
            markChanged();
        },
        switchTab,
        currentTab: () => currentTab,
        homeTab,
        refreshHistory: () => updateUndoRedoButtons(),
        docType: () => currentDocType.id,
        applyDocType,
        // Ausmasse der Dokumentarten eines Moduls (api.documents.entries)
        documentEntries: (moduleId) => {
            projectStore.sync();
            const arten = moduleHost.docTypes.filter(t => t.moduleId === moduleId).map(t => t.id);
            return projectStore.entries.map((e, i) => ({ e, i })).filter(({ e }) => arten.includes(e.type)).map(({ e, i }) => ({
                id: e.id, nr: i + 1, type: e.type, name: e.fields.profileName || '', active: e.id === projectStore.activeId,
                data: e.modules && e.modules[moduleId] !== undefined ? kopieVon(e.modules[moduleId]) : null
            }));
        },
        // Modul meldet eine Dokumentart an bzw. ab (eingeschaltet / ausgeschaltet)
        docTypesChanged: () => {
            // beim Start erst, wenn alle Module geladen sind (siehe loadAll unten)
            if (!profileList || !moduleStart) return;
            if (ausmasseAufteilen()) markChanged();
            if (!artBearbeitbar(projectStore.active.type) || (projectStore.active.type || 'profile') !== currentDocType.id) aktivenEintragPruefen();
            else profileList.render();
        },
        markChanged,
        requestRedraw
    });
    moduleHost.loadData(projectStore.active.modules);
    editorBereit = true;
    renderer.overlayDrawer = (ctx, info) => moduleHost.drawOverlays(ctx, info);

    // Ausmasse des Projekts: Leiste links
    profileList = new ProfileListController({
        store: projectStore,
        ui: moduleHost.ui,
        setProfileName: (name) => {
            projectController.setFormData({ ...projectController.getFormData(), profileName: name });
        },
        onChanged: markChanged,
        onAdd: neuesAusmass,
        mehrereArten: () => alleArten().length > 1,
        typInfo: (entry) => {
            const type = findDocType(entry.type);
            if (!type) return { usable: false, name: entry.type, kurz: entry.type, icon: '📄', preview: null };
            let preview = null;
            if (type.preview) {
                try {
                    const own = entry.modules ? entry.modules[type.moduleId] : null;
                    const r = type.preview(kopieVon(own));
                    if (r && typeof r === 'object') preview = { thumbnail: typeof r.thumbnail === 'string' ? r.thumbnail : '', text: String(r.text || '') };
                } catch (e) { console.error(`Modul „${type.moduleId}“ preview:`, e); }
            }
            return { usable: true, name: type.name, kurz: type.shortName || type.name, icon: type.icon, preview };
        },
        // Wechsel des aktiven Profils: keine Änderung am Projekt, aber der Autosave merkt sich das aktive
        onSelected: () => autosave.schedule()
    });
    profileList.setVisible(true);
    globalEventBus.on('profile:updated', () => profileList.schedule());
    globalEventBus.on('cutting:changed', () => profileList.schedule());
    // Änderungen in Modul-Tabs (z.B. Paneel geändert): Karte nachführen
    globalEventBus.on('document:changed', () => profileList.schedule());
    if (viewCutlistEl) ['input', 'change', 'click'].forEach(type => viewCutlistEl.addEventListener(type, () => profileList.schedule()));
    // Die Dokumentart des wiederhergestellten Stands gehört evtl. zu einem
    // Modul – erst nach dem Laden der Module setzen
    moduleHost.loadAll().then(() => {
        moduleStart = true;
        if (ausmasseAufteilen()) markChanged();
        aktivenEintragPruefen();
        if (erpStart) erpStart();
    });

    // Eigene Profilvorlagen (📐 Vorlagen, js/templates)
    templateController = new TemplateController({
        ui: moduleHost.ui,
        getProfileData: () => JSON.parse(JSON.stringify(profile.toData()))
    });

    // Einstellungen (⚙️ in der Statusleiste): Allgemein, Module, Material, Shortcuts
    settings = new SettingsController({
        moduleUI: moduleHost.ui,
        onShowGeneral: updateStorageOption,
        currentMaterial: () => { const f = projectController.getFormData(); return { type: f.materialType, spec: f.materialSpec }; }
    });
    // Materialien geändert: offenen Zuschnitt bzw. Stückliste neu rechnen
    document.addEventListener(MATERIALS_CHANGED, () => {
        if (currentTab === 'zuschnitt') cuttingController.render();
        else if (currentTab === 'cutlist' && cutlistController) cutlistController.updateSummary();
    });
    moduleHost.ui.openSettings = (tab) => settings.open(tab);
    moduleHost.ui.closeSettings = () => settings.close();
    const btnSettings = document.getElementById('btn-settings');
    if (btnSettings) btnSettings.addEventListener('click', () => settings.open());
    const infoOpenSettings = document.getElementById('info-open-settings');
    if (infoOpenSettings) {
        infoOpenSettings.addEventListener('click', () => {
            if (infoPanelOverlay) infoPanelOverlay.classList.add('hidden');
            settings.open();
        });
    }

    if (restoredSomething && !ErpStorage.isActive()) {
        Toast.show('Letzter Stand wurde wiederhergestellt.', 'info');
    }

    // Ersten Frame rendern
    requestRedraw();
});
