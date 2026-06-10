#!/usr/bin/env node
// Supadata HTTP client kept separate from local file I/O so code-safety audits
// can distinguish intentional API traffic from local dedup/provenance logic.

const BASE = 'https://api.supadata.ai/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INTERNAL_ERROR_RETRY_DELAYS_MS = [5_000, 30_000, 60_000];

async function get(apiKey, endpoint, params) {
  const u = new URL(BASE + endpoint);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null) u.searchParams.set(k, String(v));
  }
  const res = await fetch(u, { headers: { 'x-api-key': apiKey } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function isInternalErrorResponse(res) {
  return res?.status === 500 && res?.body?.error === 'internal-error';
}

async function getWithInternalErrorRetry(apiKey, endpoint, params, context) {
  let last = await get(apiKey, endpoint, params);
  for (const delayMs of INTERNAL_ERROR_RETRY_DELAYS_MS) {
    if (!isInternalErrorResponse(last)) return last;
    console.error(`[supadata-client] ${context} hit internal-error; retrying in ${Math.floor(delayMs / 1000)}s`);
    await sleep(delayMs);
    last = await get(apiKey, endpoint, params);
  }
  return last;
}

function segmentsOf(body) {
  if (Array.isArray(body?.content)) {
    return body.content
      .filter((item) => item && item.text != null)
      .map((item) => ({ text: String(item.text).trim(), offset: item.offset ?? item.start ?? null }));
  }
  if (typeof body?.content === 'string' && body.content.trim()) {
    return [{ text: body.content.trim(), offset: null }];
  }
  return [];
}

function plainOf(segments) {
  return segments.map((segment) => segment.text).join(' ').trim();
}

export async function getMetadata(apiKey, url) {
  return get(apiKey, '/metadata', { url });
}

export async function getTranscript(apiKey, url) {
  const first = await getWithInternalErrorRetry(
    apiKey,
    '/transcript',
    { url, text: false, mode: 'auto' },
    'transcript request',
  );
  if (first.status === 200) {
    const segments = segmentsOf(first.body);
    const text = plainOf(segments);
    return { state: text ? 'ok' : 'empty', text, segments, error: null };
  }
  if (first.status === 202 && first.body?.jobId) {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await sleep(3000);
      const polled = await getWithInternalErrorRetry(
        apiKey,
        `/transcript/${encodeURIComponent(first.body.jobId)}`,
        {},
        'transcript job poll',
      );
      if (polled.status !== 200) {
        return { state: 'error', text: '', segments: [], error: `job poll HTTP ${polled.status}: ${JSON.stringify(polled.body)}` };
      }
      if (polled.body?.status === 'completed') {
        const segments = segmentsOf(polled.body);
        const text = plainOf(segments);
        return { state: text ? 'ok' : 'empty', text, segments, error: null };
      }
      if (polled.body?.status === 'failed') {
        return { state: 'error', text: '', segments: [], error: `transcript job failed: ${JSON.stringify(polled.body)}` };
      }
    }
    return { state: 'error', text: '', segments: [], error: 'transcript job timed out after 120s' };
  }
  return { state: 'error', text: '', segments: [], error: `HTTP ${first.status}: ${JSON.stringify(first.body)}` };
}
