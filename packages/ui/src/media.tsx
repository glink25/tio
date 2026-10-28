import type { BuiltinIconName, CoverPresetId } from '@tio/core';
import {
  FileText,
  Book,
  NotebookPen,
  Folder,
  Star,
  Heart,
  Flag,
  Bookmark,
  Lightbulb,
  Target,
  Rocket,
  Coffee,
  Leaf,
  Sun,
  Moon,
  Cloud,
  Code,
  Terminal,
  Globe,
  House,
  Calendar,
  Check,
  Music,
  Camera,
} from 'lucide-react';
import { useEffect, useState } from 'react';

export const builtinIcons = {
  file: FileText,
  book: Book,
  notebook: NotebookPen,
  folder: Folder,
  star: Star,
  heart: Heart,
  flag: Flag,
  bookmark: Bookmark,
  lightbulb: Lightbulb,
  target: Target,
  rocket: Rocket,
  coffee: Coffee,
  leaf: Leaf,
  sun: Sun,
  moon: Moon,
  cloud: Cloud,
  code: Code,
  terminal: Terminal,
  globe: Globe,
  home: House,
  calendar: Calendar,
  check: Check,
  music: Music,
  camera: Camera,
} satisfies Record<BuiltinIconName, typeof FileText>;
export const coverPresets = {
  red: '#ea5757',
  amber: '#f8c35c',
  blue: '#219bc0',
  cream: '#fff0e2',
  green: '#6c9c85',
  gray: '#a5a7aa',
  dawn: 'linear-gradient(135deg, #fdba74, #f9a8d4, #c4b5fd)',
  ocean: 'linear-gradient(135deg, #164e63, #67e8f9)',
  sunset: 'linear-gradient(135deg, #7c3aed, #db2777, #fb923c)',
  forest: 'linear-gradient(135deg, #14532d, #a3b18a)',
  lavender: 'linear-gradient(135deg, #818cf8, #e9d5ff)',
  sand: 'linear-gradient(135deg, #a8a29e, #fef3c7)',
} satisfies Record<CoverPresetId, string>;
export type MediaResolver = (ref: string) => Promise<string>;
export function useMediaUrl(ref: string | undefined, resolve?: MediaResolver, attempt = 0) {
  const [result, setResult] = useState({ ref: '', url: '' });
  useEffect(() => {
    let active = true;
    if (ref?.startsWith('asset:') && resolve)
      void resolve(ref)
        .then((url) => {
          if (active) setResult({ ref, url });
        })
        .catch(() => {
          if (active) setResult({ ref, url: '' });
        });
    return () => {
      active = false;
    };
  }, [ref, resolve, attempt]);
  if (!ref) return '';
  return ref.startsWith('asset:') ? (result.ref === ref ? result.url : '') : ref;
}
