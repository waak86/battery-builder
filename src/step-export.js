import { ocRef } from './oc.js';
import { showStatus } from './ui.js';

export function downloadSTEP(shape, filename) {
    const oc = ocRef.instance;
    if (!oc || !shape) return;

    try {
        const writer = new oc.STEPControl_Writer();
        writer.Transfer(shape, 0);
        writer.Write(filename);

        const fileData = oc.FS.readFile(filename);
        const blob = new Blob([fileData], { type: 'application/step' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        oc.FS.unlink(filename);

        showStatus(`Downloaded ${filename} successfully!`, 'success');
    } catch (error) {
        console.error('STEP export error:', error);
        showStatus('Error exporting STEP file: ' + error.message, 'error');
    }
}
