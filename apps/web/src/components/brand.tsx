export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-label="Tio"
      className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-accent font-serif font-bold text-on-accent ${small ? 'size-8 text-2xl' : 'size-9 text-3xl'}`}
    >
      t
    </span>
  );
}
