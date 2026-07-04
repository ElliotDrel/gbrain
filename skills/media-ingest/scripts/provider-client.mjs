#!/usr/bin/env node
// Provider HTTP client kept separate from local file I/O so code-safety audits
// can distinguish intentional API traffic from local dedup/provenance logic.

const SCRAPECREATORS_BASE = 'https://api.scrapecreators.com';
const SUPADATA_BASE = 'https://api.supadata.ai/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INTERNAL_ERROR_RETRY_DELAYS_MS = [5_000, 30_000, 60_000];
const PLATFORM_ALIASES = { x: 'twitter' };
const THREAD_READER_BASE = 'https://threadreaderapp.com/thread';

async function getJson(base, apiKey, endpoint, params) {
  const u = new URL(base + endpoint);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null) u.searchParams.set(k, String(v));
  }
  const res = await fetch(u, { headers: { 'x-api-key': apiKey } });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { status: res.status, body };
}

function isRetryableResponse(res) {
  return res?.status >= 500;
}

async function getScrapeCreators(apiKey, endpoint, params) {
  return getJson(SCRAPECREATORS_BASE, apiKey, endpoint, params);
}

async function getWithRetry(apiKey, endpoint, params, context) {
  let last = await getScrapeCreators(apiKey, endpoint, params);
  for (const delayMs of INTERNAL_ERROR_RETRY_DELAYS_MS) {
    if (!isRetryableResponse(last)) return last;
    console.error(`[scrapecreators-client] ${context} hit HTTP ${last.status}; retrying in ${Math.floor(delayMs / 1000)}s`);
    await sleep(delayMs);
    last = await getScrapeCreators(apiKey, endpoint, params);
  }
  return last;
}

function isoFromUnixSeconds(value) {
  return Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;
}

function isoFromTwitter(value) {
  const time = Date.parse(value || '');
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function titleFallback(platform, author, kind) {
  const label = kind || (platform === 'x' ? 'post' : platform === 'youtube' ? 'video' : 'post');
  return `${platform.charAt(0).toUpperCase() + platform.slice(1)} ${label} by ${author || 'unknown'}`;
}

function vttTimeToMs(value) {
  const match = String(value).match(/^(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const millis = Number(match[4] || 0);
  return (((hours * 60) + minutes) * 60 + seconds) * 1000 + millis;
}

function plainOf(segments) {
  return segments.map((segment) => segment.text).join(' ').trim();
}

function parseWebVtt(vtt) {
  const text = String(vtt || '').replace(/\r/g, '').trim();
  if (!text) return [];
  const lines = text.split('\n');
  const segments = [];
  let pendingOffset = null;
  let pendingText = [];

  const flush = () => {
    const joined = pendingText.join(' ').trim();
    if (joined) segments.push({ text: joined, offset: pendingOffset });
    pendingOffset = null;
    pendingText = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === 'WEBVTT') {
      flush();
      continue;
    }
    if (/^\d+$/.test(line)) continue;
    if (/^(\d{2}:)?\d{2}:\d{2}\.\d{3}\s+-->/.test(line)) {
      flush();
      pendingOffset = vttTimeToMs(line.split(/\s+-->\s+/)[0]);
      continue;
    }
    pendingText.push(line);
  }
  flush();
  return segments;
}

function normalizeInstagramMetadata(body) {
  const media = body?.data?.xdt_shortcode_media || {};
  const caption = Array.isArray(media?.edge_media_to_caption?.edges)
    ? media.edge_media_to_caption.edges.map((edge) => edge?.node?.text).filter(Boolean).join('\n\n')
    : '';
  const owner = media.owner || {};
  return {
    platform: 'instagram',
    id: firstDefined(media.shortcode, media.id),
    title: firstDefined(media.accessibility_caption, caption.slice(0, 120), titleFallback('instagram', owner.username, media.product_type === 'clips' ? 'reel' : 'post')),
    description: caption,
    createdAt: isoFromUnixSeconds(media.taken_at_timestamp),
    type: media.product_type || media.__typename || null,
    author: {
      id: owner.id || null,
      username: owner.username || null,
      displayName: firstDefined(owner.full_name, owner.username),
      isVerified: owner.is_verified ?? null,
      url: owner.username ? `https://www.instagram.com/${owner.username}/` : null,
    },
    media: {
      duration: media.video_duration ?? null,
      videoUrl: media.video_url || null,
      imageUrl: firstDefined(media.display_url, media.thumbnail_src),
    },
    stats: {
      likes: media?.edge_media_preview_like?.count ?? null,
      comments: firstDefined(media?.edge_media_to_parent_comment?.count, media?.edge_media_preview_comment?.count),
      plays: firstDefined(media.video_play_count, media.video_view_count),
    },
  };
}

function normalizeTikTokMetadata(body) {
  const detail = body?.aweme_detail || {};
  const author = detail.author || {};
  const video = detail.video || {};
  const stats = detail.statistics || {};
  return {
    platform: 'tiktok',
    id: firstDefined(detail.aweme_id, body.id),
    title: firstDefined(detail.desc, titleFallback('tiktok', author.unique_id || author.nickname, 'video')),
    description: detail.desc || '',
    createdAt: isoFromUnixSeconds(detail.create_time),
    type: 'video',
    author: {
      id: firstDefined(author.uid, author.id),
      username: firstDefined(author.unique_id, author.sec_uid),
      displayName: firstDefined(author.nickname, author.unique_id),
      isVerified: author.is_verified ?? null,
      url: author.unique_id ? `https://www.tiktok.com/@${author.unique_id}` : null,
    },
    media: {
      duration: video.duration ?? null,
      videoUrl: firstDefined(video?.download_no_watermark_addr?.url_list?.[0], video?.play_addr?.url_list?.[0]),
      imageUrl: firstDefined(video?.cover?.url_list?.[0], video?.origin_cover?.url_list?.[0], video?.dynamic_cover?.url_list?.[0], video?.animated_cover?.url_list?.[0]),
    },
    stats: {
      likes: stats.digg_count ?? null,
      comments: stats.comment_count ?? null,
      plays: stats.play_count ?? null,
      shares: stats.share_count ?? null,
      saves: stats.collect_count ?? null,
    },
  };
}

function normalizeYouTubeMetadata(body) {
  const channel = body?.channel || {};
  return {
    platform: 'youtube',
    id: firstDefined(body.id, body.videoId),
    title: firstDefined(body.title, titleFallback('youtube', channel.handle || channel.title, body.type)),
    description: body.description || '',
    createdAt: body.publishDate || null,
    type: body.type || 'video',
    author: {
      id: channel.id || null,
      username: channel.handle || null,
      displayName: firstDefined(channel.title, channel.handle),
      isVerified: channel.isVerified ?? null,
      url: channel.url || null,
    },
    media: {
      duration: Number.isFinite(body.durationMs) ? body.durationMs / 1000 : null,
      videoUrl: body.url || null,
      imageUrl: body.thumbnail || null,
    },
    stats: {
      likes: body.likeCountInt ?? null,
      comments: body.commentCountInt ?? null,
      plays: body.viewCountInt ?? null,
    },
  };
}

// X has TWO long-form shapes, and they behave differently for ingest:
//   1. Note Tweets — the >280-char "longform" tweets. The FULL body lives in
//      note_tweet.note_tweet_results.result.text, NOT legacy.full_text (which is
//      truncated to the teaser). We CAN and DO recover it here — cheap win.
//   2. X Articles — the editorial long-form pieces (titled, rich-text essays).
//      The tweet is only a teaser card; the article body is a SEPARATE, gated
//      object the provider's tweet endpoint does not expose in full. These can't
//      be auto-extracted, so we FLAG them (articleDetected) and the caller asks
//      Elliot to paste the transcript manually.
// Field shapes are defensive/optional — any absent field is simply skipped. The
// exact ScrapeCreators article payload key is to be re-confirmed on the next
// credited run (account was out of credits when this was written, 2026-06-15);
// the detector checks every plausible carrier so it degrades safely either way.
function noteTweetText(body) {
  const result = body?.note_tweet?.note_tweet_results?.result
    || body?.legacy?.note_tweet?.note_tweet_results?.result;
  const text = result?.text;
  return typeof text === 'string' && text.trim() ? text : null;
}

function detectArticle(body) {
  const legacy = body?.legacy || {};
  return Boolean(
    body?.article
    || body?.article_results?.result
    || legacy?.article
    || body?.tweet?.article
    || body?.tweet?.article_results?.result,
  );
}

function normalizeTwitterMetadata(body) {
  const legacy = body?.legacy || {};
  const authorResult = body?.core?.user_results?.result || {};
  const authorLegacy = authorResult?.legacy || {};
  const authorCore = authorResult?.core || {};
  const media = legacy?.extended_entities?.media?.[0] || legacy?.entities?.media?.[0] || {};
  const authorUsername = firstDefined(authorCore.screen_name, authorLegacy.screen_name);
  const authorDisplayName = firstDefined(authorCore.name, authorLegacy.name, authorUsername);
  const authorId = firstDefined(authorResult?.rest_id, authorLegacy.id_str, legacy.user_id_str);
  const articleDetected = detectArticle(body);
  return {
    platform: 'x',
    id: firstDefined(body.rest_id, legacy.id_str),
    title: titleFallback('x', authorUsername || authorDisplayName || authorId, articleDetected ? 'article' : media.type || 'post'),
    description: firstDefined(noteTweetText(body), legacy.full_text) || '',
    articleDetected,
    createdAt: isoFromTwitter(legacy.created_at),
    type: articleDetected ? 'article' : media.type || 'post',
    author: {
      id: authorId || null,
      username: authorUsername || null,
      displayName: authorDisplayName || null,
      isVerified: firstDefined(authorResult?.is_blue_verified, authorLegacy.verified),
      url: authorUsername ? `https://x.com/${authorUsername}` : authorId ? `https://x.com/i/user/${authorId}` : null,
    },
    media: {
      duration: null,
      videoUrl: null,
      imageUrl: media.media_url_https || null,
    },
    stats: {
      likes: legacy.favorite_count ?? null,
      comments: legacy.reply_count ?? null,
      plays: Number(body?.views?.count) || null,
      shares: legacy.retweet_count ?? null,
      bookmarks: legacy.bookmark_count ?? null,
      quotes: legacy.quote_count ?? null,
    },
  };
}

function normalizeFacebookMetadata(body) {
  const author = body?.author || {};
  const video = body?.video || {};
  return {
    platform: 'facebook',
    id: firstDefined(body.post_id, video.id),
    title: titleFallback('facebook', author.name, video.id ? 'reel' : 'post'),
    description: body.description || '',
    createdAt: body.creation_time || null,
    type: video.id ? 'video' : 'post',
    author: {
      id: author.id || null,
      username: null,
      displayName: author.name || null,
      isVerified: author.is_verified ?? null,
      url: author.url || null,
    },
    media: {
      duration: firstDefined(video.duration, video.length),
      videoUrl: firstDefined(video.hd_url, video.sd_url),
      imageUrl: firstDefined(body.image_url, author.image),
    },
    stats: {
      likes: body.like_count ?? null,
      comments: body.comment_count ?? null,
      plays: body.view_count ?? null,
      shares: body.share_count ?? null,
    },
  };
}

function normalizeMetadata(platform, body) {
  switch (platform) {
    case 'instagram': return normalizeInstagramMetadata(body);
    case 'tiktok': return normalizeTikTokMetadata(body);
    case 'youtube': return normalizeYouTubeMetadata(body);
    case 'x': return normalizeTwitterMetadata(body);
    case 'facebook': return normalizeFacebookMetadata(body);
    default: return { ...body, platform };
  }
}

function normalizeInstagramTranscript(body) {
  const segments = Array.isArray(body?.transcripts)
    ? body.transcripts
      .map((item) => ({ text: String(item?.text || '').trim(), offset: null }))
      .filter((item) => item.text)
    : [];
  const text = plainOf(segments);
  return { state: text ? 'ok' : 'empty-no-speech', text, segments, error: null };
}

function normalizeTikTokTranscript(body) {
  const segments = parseWebVtt(body?.transcript || '');
  const text = plainOf(segments);
  return { state: text ? 'ok' : 'empty-no-speech', text, segments, error: null };
}

function normalizeYouTubeTranscript(body) {
  const segments = Array.isArray(body?.transcript)
    ? body.transcript
      .filter((item) => item?.text)
      .map((item) => ({ text: String(item.text).trim(), offset: item.startMs != null ? Number(item.startMs) : null }))
    : [];
  const text = firstDefined(body?.transcript_only_text, plainOf(segments)) || '';
  return { state: text ? 'ok' : 'empty-no-speech', text: text.trim(), segments, error: null };
}

function normalizePlainTranscript(body) {
  const text = String(body?.transcript || '').trim();
  const segments = text ? [{ text, offset: null }] : [];
  return { state: text ? 'ok' : 'empty-no-speech', text, segments, error: null };
}

function normalizeTranscript(platform, body) {
  switch (platform) {
    case 'instagram': return normalizeInstagramTranscript(body);
    case 'tiktok': return normalizeTikTokTranscript(body);
    case 'youtube': return normalizeYouTubeTranscript(body);
    case 'x':
    case 'facebook':
      return normalizePlainTranscript(body);
    default:
      return { state: 'empty-error', text: '', segments: [], error: `unsupported platform: ${platform}` };
  }
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || '')
    .replace(/<sup\b[\s\S]*?<\/sup>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeThreadReaderTranscript(html) {
  const segments = [];
  const regex = /<div id="tweet_(\d+)"(?:[^>"']+|"[^"]*"|'[^']*')*>([\s\S]*?)<\/div>/gi;
  for (const match of html.matchAll(regex)) {
    const text = stripHtml(match[2]);
    if (!text) continue;
    segments.push({ text, offset: null });
  }
  const text = segments.map((segment) => segment.text).join('\n\n').trim();
  return { state: text ? 'ok' : 'empty-no-speech', text, segments, error: null };
}

async function getThreadReaderTranscript(postId) {
  if (!postId) return { state: 'empty-error', text: '', segments: [], error: 'missing x post id', provider: 'threadreader', fallbackUsed: true };
  const res = await fetch(`${THREAD_READER_BASE}/${encodeURIComponent(postId)}.html`);
  const html = await res.text();
  if (!res.ok) {
    return {
      state: 'empty-error',
      text: '',
      segments: [],
      error: `HTTP ${res.status}: ${html.slice(0, 200).trim() || 'empty body'}`,
      provider: 'threadreader',
      fallbackUsed: true,
    };
  }
  const normalized = normalizeThreadReaderTranscript(html);
  if (normalized.state === 'ok') {
    return { ...normalized, provider: 'threadreader', fallbackUsed: true };
  }
  return {
    state: 'empty-error',
    text: '',
    segments: [],
    error: 'Thread Reader page did not expose tweet blocks',
    provider: 'threadreader',
    fallbackUsed: true,
  };
}

function supadataSegmentsOf(body) {
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

function isSupadataInternalErrorResponse(res) {
  return res?.status === 500 && res?.body?.error === 'internal-error';
}

async function getSupadata(apiKey, endpoint, params) {
  return getJson(SUPADATA_BASE, apiKey, endpoint, params);
}

async function getSupadataWithInternalErrorRetry(apiKey, endpoint, params, context) {
  let last = await getSupadata(apiKey, endpoint, params);
  for (const delayMs of INTERNAL_ERROR_RETRY_DELAYS_MS) {
    if (!isSupadataInternalErrorResponse(last)) return last;
    console.error(`[provider-client:supadata] ${context} hit internal-error; retrying in ${Math.floor(delayMs / 1000)}s`);
    await sleep(delayMs);
    last = await getSupadata(apiKey, endpoint, params);
  }
  return last;
}

async function getSupadataTranscript(apiKey, url) {
  const first = await getSupadataWithInternalErrorRetry(
    apiKey,
    '/transcript',
    { url, text: false, mode: 'auto' },
    'transcript request',
  );
  if (first.status === 200) {
    const segments = supadataSegmentsOf(first.body);
    const text = plainOf(segments);
    return { state: text ? 'ok' : 'empty-no-speech', text, segments, error: null, provider: 'supadata', fallbackUsed: true };
  }
  if (first.status === 202 && first.body?.jobId) {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await sleep(3000);
      const polled = await getSupadataWithInternalErrorRetry(
        apiKey,
        `/transcript/${encodeURIComponent(first.body.jobId)}`,
        {},
        'transcript job poll',
      );
      if (polled.status !== 200) {
        return { state: 'empty-error', text: '', segments: [], error: `job poll HTTP ${polled.status}: ${JSON.stringify(polled.body)}`, provider: 'supadata', fallbackUsed: true };
      }
      if (polled.body?.status === 'completed') {
        const resultBody = polled.body?.result || polled.body;
        const segments = supadataSegmentsOf(resultBody);
        const text = plainOf(segments);
        return { state: text ? 'ok' : 'empty-no-speech', text, segments, error: null, provider: 'supadata', fallbackUsed: true };
      }
      if (polled.body?.status === 'failed') {
        return { state: 'empty-error', text: '', segments: [], error: `transcript job failed: ${JSON.stringify(polled.body)}`, provider: 'supadata', fallbackUsed: true };
      }
    }
    return { state: 'empty-error', text: '', segments: [], error: 'transcript job timed out after 120s', provider: 'supadata', fallbackUsed: true };
  }
  return { state: 'empty-error', text: '', segments: [], error: `HTTP ${first.status}: ${JSON.stringify(first.body)}`, provider: 'supadata', fallbackUsed: true };
}

function shouldFallbackToSupadata({ durationSeconds, transcriptState, supadataApiKey }) {
  void durationSeconds;
  return transcriptState === 'empty-error' && !!supadataApiKey;
}

function platformName(platform) {
  return PLATFORM_ALIASES[platform] || platform;
}

function routesFor(platform) {
  switch (platform) {
    case 'instagram': return { metadata: '/v1/instagram/post', transcript: '/v2/instagram/media/transcript' };
    case 'tiktok': return { metadata: '/v2/tiktok/video', transcript: '/v1/tiktok/video/transcript' };
    case 'youtube': return { metadata: '/v1/youtube/video', transcript: '/v1/youtube/video/transcript' };
    case 'x': return { metadata: `/v1/${platformName(platform)}/tweet`, transcript: `/v1/${platformName(platform)}/tweet/transcript` };
    case 'facebook': return { metadata: '/v1/facebook/post', transcript: '/v1/facebook/post/transcript' };
    default: return null;
  }
}

export { parseWebVtt, normalizeMetadata, normalizeTranscript, shouldFallbackToSupadata, normalizeThreadReaderTranscript };

export async function getMetadata(apiKeys, platform, url) {
  const routes = routesFor(platform);
  if (!routes) return { status: 400, body: { error: `unsupported platform: ${platform}` } };
  const res = await getScrapeCreators(apiKeys.scrapeCreatorsApiKey, routes.metadata, { url });
  if (res.status === 200) return { ...res, body: normalizeMetadata(platform, res.body) };
  return res;
}

export async function getTranscript(apiKeys, platform, url, { durationSeconds = null, postId = null } = {}) {
  const routes = routesFor(platform);
  if (!routes) return { state: 'empty-error', text: '', segments: [], error: `unsupported platform: ${platform}`, provider: 'scrapecreators', fallbackUsed: false };
  const first = await getWithRetry(apiKeys.scrapeCreatorsApiKey, routes.transcript, { url }, 'transcript request');
  if (first.status === 200) {
    const normalized = normalizeTranscript(platform, first.body);
    if (platform === 'x' && normalized.state === 'empty-no-speech' && postId) {
      const fallback = await getThreadReaderTranscript(postId);
      if (fallback.state === 'ok') {
        return {
          ...fallback,
          primaryProvider: 'scrapecreators',
          primaryState: normalized.state,
        };
      }
      return {
        ...normalized,
        provider: 'scrapecreators',
        fallbackUsed: false,
        warning: `thread fallback failed: ${fallback.error}`,
      };
    }
    return { ...normalized, provider: 'scrapecreators', fallbackUsed: false };
  }

  const scrapeError = `HTTP ${first.status}: ${JSON.stringify(first.body)}`;
  if (shouldFallbackToSupadata({
    durationSeconds,
    transcriptState: 'error',
    supadataApiKey: apiKeys.supadataApiKey,
  })) {
    const durationNote = Number.isFinite(durationSeconds) ? ` for ${Math.round(durationSeconds)}s video` : '';
    console.error(`[social-fetch] ScrapeCreators transcript failed${durationNote}; trying Supadata fallback.`);
    const fallback = await getSupadataTranscript(apiKeys.supadataApiKey, url);
    if (fallback.state === 'empty-error') {
      return {
        ...fallback,
        error: `ScrapeCreators failed first: ${scrapeError}; Supadata fallback failed: ${fallback.error}`,
      };
    }
    return {
      ...fallback,
      primaryError: scrapeError,
    };
  }

  const suffix = !apiKeys.supadataApiKey
    ? '; Supadata fallback unavailable (no SUPADATA_API_KEY)'
    : '';
  return { state: 'empty-error', text: '', segments: [], error: `${scrapeError}${suffix}`, provider: 'scrapecreators', fallbackUsed: false };
}
