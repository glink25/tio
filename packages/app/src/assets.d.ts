declare module '*.css';
declare module '*.svg' {
  const source: string;
  export default source;
}
declare module '*.md?raw' {
  const content: string;
  export default content;
}
