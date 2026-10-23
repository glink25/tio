import { mountBridgedEditor, mountEditor } from './index';
// The native host loads this local bundle and supplies a trusted transport.
Object.assign(globalThis, { TioEditor: { mountBridgedEditor, mountEditor } });
window.dispatchEvent(new Event('tio-editor-ready'));
