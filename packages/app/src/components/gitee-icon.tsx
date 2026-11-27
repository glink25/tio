const path =
  'M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm6.09 7.37H9.59c-.44 0-.8.36-.8.8v7.66c0 .44.36.8.8.8h5.28c.44 0 .8-.36.8-.8v-2.4h-4.14v-2.3h6.56v4.7a3.22 3.22 0 0 1-3.22 3.22H9.59a3.22 3.22 0 0 1-3.22-3.22V8.17a3.22 3.22 0 0 1 3.22-3.22h8.5z';

export const giteeIconUrl = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#c71d23" d="${path}"/></svg>`)}`;

export function GiteeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="currentColor" d={path} />
    </svg>
  );
}
