// scripts/reports/iracing-client.js
// Authenticated client for the iRacing /data API.
// Most endpoints return { link } pointing at the real JSON on S3; some return
// chunked data via data.chunk_info. This wraps both, plus 429 backoff.
const BASE = 'https://members-ng.iracing.com';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function createClient(cookie) {
  async function raw(path, params = {}) {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Cookie: cookie } });
    if (res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset')) || 0;
      const waitMs = Math.max(2000, reset * 1000 - Date.now());
      console.warn(`rate-limited on ${path}, waiting ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      return raw(path, params);
    }
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    return res.json();
  }

  // Follow the single-link indirection.
  async function get(path, params) {
    const j = await raw(path, params);
    if (j && j.link) {
      const r = await fetch(j.link);
      if (!r.ok) throw new Error(`link fetch ${path} -> HTTP ${r.status}`);
      return r.json();
    }
    return j;
  }

  // Follow chunked results. Returns a flat array of rows. If the payload is not
  // chunked, returns whatever `data` array is present (or the object itself).
  async function getChunked(path, params) {
    const j = await get(path, params);
    const data = j && j.data ? j.data : j;
    const ci = data && data.chunk_info;
    if (!ci || !Array.isArray(ci.chunk_file_names) || ci.chunk_file_names.length === 0) {
      return Array.isArray(data) ? data : (Array.isArray(j) ? j : []);
    }
    const out = [];
    for (const name of ci.chunk_file_names) {
      const r = await fetch(ci.base_download_url + name);
      if (!r.ok) throw new Error(`chunk fetch -> HTTP ${r.status}`);
      out.push(...await r.json());
      await sleep(150);
    }
    return out;
  }

  return { raw, get, getChunked };
}
