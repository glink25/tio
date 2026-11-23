import { platform, type FolderGrant, type FolderHandle } from '../platform';
export type { FolderHandle } from '../platform';
export const isGrant = (handle?: FolderHandle): handle is FolderGrant =>
  handle?.kind === 'native-folder';
export const folderSupported = () => platform().folder.supported();
export const pickFolder = () => platform().folder.pick();
export const sameFolder = (a: FolderHandle, b: FolderHandle) => platform().folder.same(a, b);
