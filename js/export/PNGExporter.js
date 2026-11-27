import { globalEventBus } from '../utils/EventBus.js';

export class PNGExporter {
    static export(canvas, filename = 'openbend_drawing.png') {
        if (!canvas) {
            globalEventBus.emit('notify', {
                message: 'Export fehlgeschlagen: Kein Canvas gefunden.',
                type: 'error'
            });
            return;
        }

        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();

        globalEventBus.emit('notify', {
            message: 'Zeichnung erfolgreich als PNG exportiert.',
            type: 'success'
        });
    }
}