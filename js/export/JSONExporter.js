export class JSONExporter {
    // Dateiformat 1.3: profile.conical und seg.backLength (konisches Profil).
    // 1.4: cutting – Zuschnitt (gewählte Rolle, abgehakte Teile, Quittierung).
    // 1.5: modules – Daten der Erweiterungsmodule { Modul-ID: Daten }, auch
    //      von Modulen, die gerade fehlen oder ausgeschaltet sind.
    //      docType – Dokumentart ('profile' = Blechprofil oder die einer
    //      Modul-Dokumentart, z.B. 'blindpaneele'); fehlt = Blechprofil.
    // Ältere Dateien ohne diese Felder laden weiterhin.
    static buildData(profile, cutlistData = [], projectHeader = {}, cuttingData = null, modulesData = undefined, docType = 'profile') {
        const data = {
            version: "1.5",
            timestamp: new Date().toISOString(),
            docType,
            project: projectHeader,
            profile: profile.toData(),
            cutlist: cutlistData,
            cutting: cuttingData
        };
        if (modulesData) data.modules = modulesData;
        return data;
    }

    static export(profile, cutlistData = [], projectHeader = {}, cuttingData = null, modulesData = undefined, docType = 'profile') {
        this.download(this.buildData(profile, cutlistData, projectHeader, cuttingData, modulesData, docType));
    }

    /** Projektdatei (ProjectStore.toFile) als JSON herunterladen */
    static download(data) {
        const projectHeader = data.project || {};

        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const rawFileName = projectHeader.projectNumber || projectHeader.projectName || 'kantprofil';
        const sanitizedFileName = rawFileName.toLowerCase().replace(/[^a-z0-9]/gi, '_');

        const a = document.createElement('a');
        a.href = url;
        a.download = `${sanitizedFileName}_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    static import(file, callback) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                callback(null, data);
            } catch (err) {
                callback(err, null);
            }
        };
        reader.onerror = (err) => callback(err, null);
        reader.readAsText(file);
    }
}
