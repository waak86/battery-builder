import { showStatus, showLoading } from './ui.js';

export const ocRef = {
    instance: null,
    initialized: false,
};

export async function initOC() {
    if (ocRef.initialized) return;

    try {
        ocRef.instance = await opencascade({
            locateFile: () => 'vendor/opencascade.wasm.wasm'
        });
        ocRef.initialized = true;
        console.log('OpenCascade initialized successfully');
        showLoading(false);
    } catch (error) {
        console.error('Failed to initialize OpenCascade:', error);
        showStatus('Failed to initialize 3D engine. Please ensure opencascade.wasm.js and opencascade.wasm.wasm are in vendor/.', 'error');
        showLoading(false);
    }
}
