import { mountBridgedEditor, mountEditor, createAppSliceRuntimeDocument } from './index';
// The native host loads this local bundle and supplies a trusted transport.
Object.assign(globalThis, {
  TioEditor: { mountBridgedEditor, mountEditor, createAppSliceRuntimeDocument },
});
window.dispatchEvent(new Event('tio-editor-ready'));
