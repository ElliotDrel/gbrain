// canonical-url.mjs — deterministic social/video URL canonicalizer.
//
// Purpose: collapse every shape of a post link (mobile host, /reel vs /reels,
// share tokens like ?igsh=, tracking params, short/share links that 30x) down to
// ONE canonical form + the post's stable id. The id is what social-fetch.mjs uses
// to dedup, so a clean canonicalizer means we catch duplicates no matter how the
// link was pasted — including share links — before spending a Supadata credit.
//
// Two entry points:
//   canonicalize(url)  -> { platform, id, canonicalUrl } | null   (PURE, no network)
//   resolve(url, opts) -> Promise<{ ...canonicalize, resolvedFrom? } | null>
//        tries canonicalize() first; if the link is an opaque share/short link,
//        follows HTTP redirects (FREE — not a Supadata call) and canonicalizes the
//        final URL. Only follows for known social/short hosts; swallows all errors.
//
// id semantics: the id returned matches the post's canonical shortcode/numeric id,
// which is what Supadata returns as metadata.id for these platforms — so matching
// `<platform>-<id>.txt` on disk is a true duplicate check.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Hosts we are willing to follow redirects for (after stripping www./m./mobile.).
// Everything else returns null from resolve() — we don't chase arbitrary URLs.
const RESOLVE_HOSTS = new Set([
  'vm.tiktok.com', 'vt.tiktok.com', 'tiktok.com',      // /t/<code> + share subdomains
  'instagram.com', 'instagr.am',                        // /share/...
  'facebook.com', 'fb.watch', 'fb.com',
  't.co', 'bit.ly', 'tinyurl.com', 'goo.gl',           // generic shorteners
]);

const stripHost = (h) => h.replace(/^(www\.|m\.|mobile\.)/, '').toLowerCase();

/**
 * Pure, deterministic. Returns { platform, id, canonicalUrl } or null.
 * No network — links whose id is not in the string (share/short links) return null.
 */
export function canonicalize(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = stripHost(u.hostname);
  const p = u.pathname;
  let m;

  // Instagram — /reel, /reels, /p, /tv
  if (host === 'instagram.com' || host === 'instagr.am') {
    if ((m = p.match(/^\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/))) {
      const type = m[1] === 'reels' ? 'reel' : m[1];
      return { platform: 'instagram', id: m[2], canonicalUrl: `https://www.instagram.com/${type}/${m[2]}/` };
    }
    return null; // /share/... is opaque -> resolve()
  }

  // TikTok — /@user/video/<id> (numeric)
  if (host === 'tiktok.com') {
    if ((m = p.match(/\/video\/(\d+)/))) {
      const user = (p.match(/\/(@[A-Za-z0-9_.]+)\//) || [])[1];
      return {
        platform: 'tiktok',
        id: m[1],
        canonicalUrl: user ? `https://www.tiktok.com/${user}/video/${m[1]}` : `https://www.tiktok.com/video/${m[1]}`,
      };
    }
    return null; // /t/<code> short -> resolve()
  }

  // YouTube — watch?v=, /shorts, /embed, /v, /live ; youtu.be/<id>
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = u.searchParams.get('v');
    if (v) return { platform: 'youtube', id: v, canonicalUrl: `https://www.youtube.com/watch?v=${v}` };
    if ((m = p.match(/^\/(?:shorts|embed|v|live)\/([A-Za-z0-9_-]+)/)))
      return { platform: 'youtube', id: m[1], canonicalUrl: `https://www.youtube.com/watch?v=${m[1]}` };
    return null;
  }
  if (host === 'youtu.be') {
    if ((m = p.match(/^\/([A-Za-z0-9_-]+)/)))
      return { platform: 'youtube', id: m[1], canonicalUrl: `https://www.youtube.com/watch?v=${m[1]}` };
    return null;
  }

  // X / Twitter — /<user>/status/<id> (numeric)
  if (host === 'twitter.com' || host === 'x.com') {
    if ((m = p.match(/^\/[^/]+\/status\/(\d+)/)))
      return { platform: 'x', id: m[1], canonicalUrl: `https://x.com/i/status/${m[1]}` };
    return null;
  }

  // Facebook — /videos/<id> or watch/?v=<id>
  if (host === 'facebook.com' || host === 'fb.com') {
    if ((m = p.match(/\/videos\/(\d+)/)))
      return { platform: 'facebook', id: m[1], canonicalUrl: `https://www.facebook.com/watch/?v=${m[1]}` };
    if ((m = (u.searchParams.get('v') || '').match(/^(\d+)$/)))
      return { platform: 'facebook', id: m[1], canonicalUrl: `https://www.facebook.com/watch/?v=${m[1]}` };
    return null; // fb.watch/<code> -> resolve()
  }

  return null;
}

/**
 * canonicalize(), then for opaque share/short links follow HTTP redirects (FREE)
 * and canonicalize the final URL. Returns null if it can't determine a post id.
 * opts.fetchImpl is injectable for tests.
 */
export async function resolve(input, opts = {}) {
  const direct = canonicalize(input);
  if (direct) return direct;

  const { fetchImpl = globalThis.fetch, timeoutMs = 6000 } = opts;
  if (!fetchImpl) return null;

  let host;
  try { host = stripHost(new URL(String(input).trim()).hostname); } catch { return null; }
  if (!RESOLVE_HOSTS.has(host)) return null;

  const src = String(input).trim();
  try {
    const res = await fetchImpl(src, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': UA },
    });
    try { await res.body?.cancel?.(); } catch { /* ignore */ } // don't download the page
    const c = canonicalize(res.url);
    return c ? { ...c, resolvedFrom: src } : null;
  } catch {
    return null; // network/timeout/blocked -> let the metadata backstop handle it
  }
}
