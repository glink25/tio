import { sign } from 'node:crypto';
export async function googleToken(scope) {
  const account = JSON.parse(
    Buffer.from(process.env.ANDROID_PLAY_SERVICE_ACCOUNT_BASE64 ?? '', 'base64'),
  );
  const now = Math.floor(Date.now() / 1000);
  const input =
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url') +
    '.' +
    Buffer.from(
      JSON.stringify({
        iss: account.client_email,
        scope,
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    ).toString('base64url');
  const assertion =
    input + '.' + sign('RSA-SHA256', Buffer.from(input), account.private_key).toString('base64url');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Google authentication failed');
  return (await response.json()).access_token;
}
