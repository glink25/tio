import { mountBridgedEditor, mountEditor, createWebSliceRuntimeDocument } from './index';
// The native host loads this local bundle and supplies a trusted transport.
Object.assign(globalThis, {
  TioEditor: { mountBridgedEditor, mountEditor, createWebSliceRuntimeDocument },
});
window.dispatchEvent(new Event('tio-editor-ready'));
