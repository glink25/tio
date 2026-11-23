import type { ConnectionIdentity } from '@tio/core';

export function Identity({ identity }: { identity?: ConnectionIdentity }) {
  if (!identity) return null;
  return (
    <>
      <img
        className="size-6 shrink-0 rounded-full"
        src={identity.avatarUrl ?? identity.icon}
        alt=""
        onError={(event) => {
          if (event.currentTarget.getAttribute('src') !== identity.icon)
            event.currentTarget.src = identity.icon;
        }}
      />
      <span className="truncate">
        {identity.provider}/{identity.name}
      </span>
    </>
  );
}

/** Identity names and provider details share one presentation, without duplicate values. */
export function ConnectionInfo({ identity }: { identity?: ConnectionIdentity }) {
  if (!identity) return null;
  const seen = new Set([identity.name, identity.provider, `${identity.provider}/${identity.name}`]);
  const details = identity.details.filter((detail) => {
    if (seen.has(detail.value)) return false;
    seen.add(detail.value);
    return true;
  });
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
        <Identity identity={identity} />
      </div>
      {details.map((detail) => (
        <p key={detail.label} className="mt-1 text-xs break-words text-muted">
          {detail.label} · {detail.value}
        </p>
      ))}
    </div>
  );
}
