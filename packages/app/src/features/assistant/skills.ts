import type { SkillInput } from '@glink25/chaty';

export const assistantSkills: SkillInput[] = [
  {
    id: 'tio-principles',
    name: 'Tio workspace principles',
    description: 'Pages, databases, references, workspace boundaries, and safe editing.',
    loader: async () => (await import('./skills/principles.md?raw')).default,
  },
  {
    id: 'tio-app-slice',
    name: 'Build and edit an App Slice',
    description: 'Design an embedded app with Tio SDK v1, permissions, and Playground files.',
    loader: async () => (await import('./skills/app-slice.md?raw')).default,
  },
  {
    id: 'tio-app-slice-drawing',
    name: 'App Slice drawing board',
    description: 'Build a touch-friendly canvas backed by a database of individual strokes.',
    loader: async () => (await import('./skills/drawing.md?raw')).default,
  },
];
