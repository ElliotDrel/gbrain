#!/usr/bin/env node
// ScrapeCreators HTTP client kept separate from local file I/O so code-safety
// audits can distinguish intentional API traffic from local dedup/provenance
// logic. The filename stays put for compatibility with existing references.

const BASE = 'https://api.scrapecreators.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INTERNAL_ERROR_RETRY_DELAYS_MS = [5_000, 30_000, 60_000];
const PLATFORM_ALIASES = { x: 'twitter' };

async function get(apiKey, endpoint, params) {
  const u = new URL(BASE + endpoint);
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

async function getWithRetry(apiKey, endpoint, params, context) {
  let last = await get(apiKey, endpoint, params);
  for (const delayMs of INTERNAL_ERROR_RETRY_DELAYS_MS) {
    if (!isRetryableResponse(last)) return last;
    console.error(`[scrapecreators-client] ${context} hit HTTP ${last.status}; retrying in ${Math.floor(delayMs / 1000)}s`);
    await sleep(delayMs);
    last = await get(apiKey, endpoint, params);
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
    id: firstDefined(media.id, media.shortcode),
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

function normalizeTwitterMetadata(body) {
  const legacy = body?.legacy || {};
  const media = legacy?.extended_entities?.media?.[0] || legacy?.entities?.media?.[0] || {};
  return {
    platform: 'x',
    id: firstDefined(body.rest_id, legacy.id_str),
    title: titleFallback('x', legacy.user_id_str, media.type || 'post'),
    description: legacy.full_text || '',
    createdAt: isoFromTwitter(legacy.created_at),
    type: media.type || 'post',
    author: {
      id: legacy.user_id_str || null,
      username: null,
      displayName: null,
      isVerified: null,
      url: legacy.user_id_str ? `https://x.com/i/user/${legacy.user_id_str}` : null,
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
  return { state: text ? 'ok' : 'empty', text, segments, error: null };
}

function normalizeTikTokTranscript(body) {
  const segments = parseWebVtt(body?.transcript || '');
  const text = plainOf(segments);
  return { state: text ? 'ok' : 'empty', text, segments, error: null };
}

function normalizeYouTubeTranscript(body) {
  const segments = Array.isArray(body?.transcript)
    ? body.transcript
      .filter((item) => item?.text)
      .map((item) => ({ text: String(item.text).trim(), offset: item.startMs != null ? Number(item.startMs) : null }))
    : [];
  const text = firstDefined(body?.transcript_only_text, plainOf(segments)) || '';
  return { state: text ? 'ok' : 'empty', text: text.trim(), segments, error: null };
}

function normalizePlainTranscript(body) {
  const text = String(body?.transcript || '').trim();
  const segments = text ? [{ text, offset: null }] : [];
  return { state: text ? 'ok' : 'empty', text, segments, error: null };
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
      return { state: 'error', text: '', segments: [], error: `unsupported platform: ${platform}` };
  }
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

export { parseWebVtt, normalizeMetadata, normalizeTranscript };

export async function getMetadata(apiKey, platform, url) {
  const routes = routesFor(platform);
  if (!routes) return { status: 400, body: { error: `unsupported platform: ${platform}` } };
  const res = await get(apiKey, routes.metadata, { url });
  if (res.status === 200) return { ...res, body: normalizeMetadata(platform, res.body) };
  return res;
}

export async function getTranscript(apiKey, platform, url) {
  const routes = routesFor(platform);
  if (!routes) return { state: 'error', text: '', segments: [], error: `unsupported platform: ${platform}` };
  const first = await getWithRetry(apiKey, routes.transcript, { url }, 'transcript request');
  if (first.status === 200) return normalizeTranscript(platform, first.body);
  return { state: 'error', text: '', segments: [], error: `HTTP ${first.status}: ${JSON.stringify(first.body)}` };
}
