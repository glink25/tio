import { builtinIconNames, type BuiltinIconName } from '@tio/core';

const storageKey = 'tio.media.recent-icons';
const limit = 18;

export function readRecentIcons(): BuiltinIconName[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return [
      ...new Set(
        stored.filter((name): name is BuiltinIconName =>
          builtinIconNames.some((known) => known === name),
        ),
      ),
    ].slice(0, limit);
  } catch {
    return [];
  }
}

export function rememberIcon(name: BuiltinIconName) {
  const next = [name, ...readRecentIcons().filter((recent) => recent !== name)].slice(0, limit);
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Recent choices are optional browser preferences.
  }
}
