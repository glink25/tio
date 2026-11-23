import logo from '../brand/logo.svg?raw';

export function Brand({ small = false, hero = false }: { small?: boolean; hero?: boolean }) {
  return (
    <span
      className={`brand-mark shrink-0 ${hero ? 'brand-mark--hero' : small ? 'size-8' : 'size-9'}`}
    >
      <span className="sr-only">Tio</span>
      <span className="contents" aria-hidden="true" dangerouslySetInnerHTML={{ __html: logo }} />
    </span>
  );
}
