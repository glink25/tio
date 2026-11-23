globalThis.crypto = {
  randomUUID: tioUUID,
  subtle: {
    digest: async (name, bytes) => {
      if (name !== 'SHA-256') throw Error('Unsupported digest');
      return Uint8Array.from(
        JSON.parse(tioDigest(JSON.stringify(Array.from(new Uint8Array(bytes))))),
      ).buffer;
    },
  },
};
globalThis.TextEncoder = class {
  encode(value) {
    return Uint8Array.from(JSON.parse(tioEncode(value)));
  }
};
globalThis.TextDecoder = class {
  decode(value) {
    return tioDecode(JSON.stringify(Array.from(value || [])));
  }
};
globalThis.atob = tioAtob;
globalThis.btoa = tioBtoa;
globalThis.queueMicrotask = (callback) => Promise.resolve().then(callback);
globalThis.setTimeout = (callback, ms) => {
  tioSleep(ms || 0).then(callback);
  return 0;
};
globalThis.clearTimeout = () => {};
globalThis.structuredClone = function clone(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') throw Error('DataCloneError');
    return value;
  }
  if (seen.has(value)) return seen.get(value);
  if (value instanceof ArrayBuffer) {
    const copy = value.slice(0);
    seen.set(value, copy);
    return copy;
  }
  if (ArrayBuffer.isView(value)) {
    const buffer = clone(value.buffer, seen);
    const copy =
      value instanceof DataView
        ? new DataView(buffer, value.byteOffset, value.byteLength)
        : new value.constructor(buffer, value.byteOffset, value.length);
    seen.set(value, copy);
    return copy;
  }
  if (value instanceof Date) return new Date(value.getTime());
  const copy =
    value instanceof Map
      ? new Map()
      : value instanceof Set
        ? new Set()
        : Array.isArray(value)
          ? []
          : {};
  seen.set(value, copy);
  if (value instanceof Map) {
    for (const [key, item] of value) copy.set(clone(key, seen), clone(item, seen));
  } else if (value instanceof Set) {
    for (const item of value) copy.add(clone(item, seen));
  } else {
    for (const key of Object.keys(value)) {
      Object.defineProperty(copy, key, {
        value: clone(value[key], seen),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return copy;
};
