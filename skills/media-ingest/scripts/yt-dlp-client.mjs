#!/usr/bin/env node
// Free-first local fetcher for social/video URLs via yt-dlp. If this path
// fails for any reason (binary missing, no subtitles, extractor error), the
// caller should fall back to the paid provider path.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseWebVtt } from './provider-client.mjs';
import { runAllowedCommand } from '../../../lib/allowed-child-process.mjs';
const CANDIDATES = [
  { cmd: 'yt-dlp', prefix: [] },
  { cmd: 'python3', prefix: ['-m', 'yt_dlp'] },
];

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function titleFallback(platform, author) {
  const label = platform === 'x' ? 'post' : 'video';
  return `${platform.charAt(0).toUpperCase() + platform.slice(1)} ${label} by ${author || 'unknown'}`;
}

function isoFromUploadDate(value) {
  const raw = String(value || '');
  if (!/^\d{8}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00.000Z`;
}

function normalizeYtDlpMetadata(platform, info, url) {
  const authorName = firstDefined(info.channel, info.uploader, info.creator, info.uploader_id, info.channel_id);
  const authorUsername = firstDefined(
    info.uploader_id,
    info.channel_handle,
    info.creator,
    info.channel_id,
  );
  return {
    platform,
    id: firstDefined(info.id, info.display_id),
    title: firstDefined(info.title, titleFallback(platform, authorName)),
    description: info.description || '',
    createdAt: firstDefined(
      Number.isFinite(info.timestamp) ? new Date(info.timestamp * 1000).toISOString() : null,
      isoFromUploadDate(info.upload_date),
    ),
    type: info._type === 'playlist' ? 'playlist' : (platform === 'x' ? 'post' : 'video'),
    author: {
      id: firstDefined(info.channel_id, info.uploader_id, info.playlist_uploader_id) || null,
      username: authorUsername,
      displayName: authorName,
      isVerified: info.channel_is_verified ?? null,
      url: firstDefined(info.channel_url, info.uploader_url, info.webpage_url_domain ? `https://${info.webpage_url_domain}/` : null),
    },
    media: {
      duration: Number.isFinite(info.duration) ? info.duration : null,
      videoUrl: firstDefined(info.webpage_url, url),
      imageUrl: firstDefined(info.thumbnail, info.thumbnails?.[0]?.url, info.thumbnail_url),
    },
    stats: {
      likes: info.like_count ?? null,
      comments: info.comment_count ?? null,
      plays: info.view_count ?? null,
    },
  };
}

function parseJson3Transcript(raw) {
  let body = {};
  try {
    body = JSON.parse(String(raw || ''));
  } catch {
    return [];
  }
  const events = Array.isArray(body?.events) ? body.events : [];
  return events
    .map((event) => {
      const parts = Array.isArray(event?.segs)
        ? event.segs.map((seg) => String(seg?.utf8 || '')).join('')
        : '';
      const text = parts.replace(/\s+/g, ' ').trim();
      if (!text) return null;
      return {
        text,
        offset: Number.isFinite(event?.tStartMs) ? event.tStartMs : null,
      };
    })
    .filter(Boolean);
}

function plainOf(segments) {
  return segments.map((segment) => segment.text).join(' ').trim();
}

async function runCandidate(candidate, args) {
  try {
    const result = await runAllowedCommand(candidate.cmd, [...candidate.prefix, ...args], {
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { ok: true, ...result };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, missing: true, error };
    return {
      ok: false,
      missing: false,
      error,
      stdout: typeof error?.stdout === 'string' ? error.stdout : '',
      stderr: typeof error?.stderr === 'string' ? error.stderr : '',
    };
  }
}

function pickSubtitleFile(dir, id) {
  const entries = fs.readdirSync(dir);
  const candidates = entries
    .filter((name) => name.startsWith(`${id}.`))
    .filter((name) => !name.includes('live_chat'))
    .filter((name) => name.endsWith('.vtt') || name.endsWith('.json3'));
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const score = (name) => {
      if (name.includes('.en.')) return 0;
      if (name.includes('.en-')) return 1;
      if (name.endsWith('.vtt')) return 2;
      return 3;
    };
    return score(a) - score(b) || a.localeCompare(b);
  });
  return path.join(dir, candidates[0]);
}

export { normalizeYtDlpMetadata, parseJson3Transcript };

export async function tryYtDlpFetch(url, { platform = 'youtube' } = {}) {
  let missingCount = 0;
  for (const candidate of CANDIDATES) {
    const metaRun = await runCandidate(candidate, [
      '--ignore-config',
      '--skip-download',
      '--no-warnings',
      '--dump-single-json',
      url,
    ]);
    if (!metaRun.ok) {
      if (metaRun.missing) {
        missingCount += 1;
        continue;
      }
      return {
        ok: false,
        reason: `metadata command failed: ${metaRun.stderr || metaRun.error?.message || 'unknown error'}`,
      };
    }

    let info = {};
    try {
      info = JSON.parse(metaRun.stdout);
    } catch (error) {
      return { ok: false, reason: `metadata json parse failed: ${error.message}` };
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-ingest-yt-dlp-'));
    try {
      const subRun = await runCandidate(candidate, [
        '--ignore-config',
        '--skip-download',
        '--no-warnings',
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        'en.*,en,-live_chat',
        '--sub-format',
        'vtt/json3/best',
        '--output',
        path.join(tmpDir, '%(id)s.%(ext)s'),
        url,
      ]);
      if (!subRun.ok) {
        return {
          ok: false,
          reason: `subtitle command failed: ${subRun.stderr || subRun.error?.message || 'unknown error'}`,
        };
      }

      const subtitleFile = pickSubtitleFile(tmpDir, info.id);
      if (!subtitleFile) {
        return { ok: false, reason: 'yt-dlp found no subtitle file to parse' };
      }

      const raw = fs.readFileSync(subtitleFile, 'utf8');
      const segments = subtitleFile.endsWith('.vtt') ? parseWebVtt(raw) : parseJson3Transcript(raw);
      const text = plainOf(segments);
      if (!text) return { ok: false, reason: 'subtitle file parsed to empty transcript' };

      return {
        ok: true,
        provider: 'yt-dlp',
        metadata: normalizeYtDlpMetadata(platform, info, url),
        transcript: {
          state: 'ok',
          text,
          segments,
          error: null,
          provider: 'yt-dlp',
          fallbackUsed: false,
        },
      };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  if (missingCount === CANDIDATES.length) {
    return { ok: false, reason: 'yt-dlp unavailable on this machine' };
  }
  return { ok: false, reason: 'yt-dlp local fetch failed' };
}
