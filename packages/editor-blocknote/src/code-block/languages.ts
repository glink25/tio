// Names and aliases are cheap metadata; grammars live behind dynamic imports.
export const languages = {
  text: { name: 'Plain text', aliases: ['txt', 'plaintext', 'none'] },
  javascript: { name: 'JavaScript', aliases: ['js'] },
  typescript: { name: 'TypeScript', aliases: ['ts'] },
  jsx: { name: 'JSX' },
  tsx: { name: 'TSX' },
  html: { name: 'HTML' },
  css: { name: 'CSS' },
  json: { name: 'JSON' },
  yaml: { name: 'YAML', aliases: ['yml'] },
  python: { name: 'Python', aliases: ['py'] },
  shellscript: { name: 'Shell', aliases: ['sh', 'bash', 'shell'] },
  sql: { name: 'SQL' },
  go: { name: 'Go' },
  rust: { name: 'Rust', aliases: ['rs'] },
  java: { name: 'Java' },
  c: { name: 'C' },
  cpp: { name: 'C++', aliases: ['c++'] },
  markdown: { name: 'Markdown', aliases: ['md'] },
  mermaid: { name: 'Mermaid' },
} satisfies Record<string, { name: string; aliases?: string[] }>;
export function languageId(value: string): string {
  const normalized = value.trim().toLowerCase();
  return (
    Object.entries(languages).find(
      ([id, info]) => id === normalized || ('aliases' in info && info.aliases.includes(normalized)),
    )?.[0] ?? normalized
  );
}
