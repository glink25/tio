import { sign } from 'node:crypto';
export async function apple(path, body, method = body ? 'POST' : 'GET') {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: process.env.ASC_ISSUER_ID,
      iat: now - 30,
      exp: now + 900,
      aud: 'appstoreconnect-v1',
    }),
  ).toString('base64url');
  const input = header + '.' + payload;
  const token =
    input +
    '.' +
    sign('sha256', Buffer.from(input), {
      key: Buffer.from(process.env.ASC_PRIVATE_KEY_BASE64 ?? '', 'base64'),
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
  const url = path.startsWith('https://api.appstoreconnect.apple.com/')
    ? path
    : 'https://api.appstoreconnect.apple.com' + path;
  const response = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('App Store Connect ' + response.status + ' ' + path);
  return response.status === 204 ? null : response.json();
}
export async function list(path) {
  const all = [];
  while (path) {
    const page = await apple(path);
    all.push(...page.data);
    path = page.links?.next;
  }
  return all;
}
