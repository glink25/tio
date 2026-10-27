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
