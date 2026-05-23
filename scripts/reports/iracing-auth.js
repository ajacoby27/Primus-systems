// scripts/reports/iracing-auth.js
import { createHash } from 'node:crypto';

// iRacing /auth expects base64( sha256( password + lowercase(email) ) ).
export function encodePassword(email, password) {
  return createHash('sha256')
    .update(password + String(email).toLowerCase())
    .digest('base64');
}

// Logs in and returns a Cookie header string for subsequent /data requests.
export async function login(email, password) {
  const res = await fetch('https://members-ng.iracing.com/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: encodePassword(email, password) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`iRacing auth HTTP ${res.status}: ${text.slice(0, 200)}`);
  let body = {};
  try { body = JSON.parse(text); } catch { /* some errors return non-JSON */ }
  if (body.authcode === 0 || body.authcode === '0') {
    throw new Error(`iRacing auth rejected: ${body.message || 'check creds / 2FA / verification'}`);
  }
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie()
                    : [res.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookies.map(c => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('iRacing auth returned no cookie');
  return cookie;
}
