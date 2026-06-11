import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeYouTubeMetadata, parseJson3Transcript } from './yt-dlp-client.mjs';

test('normalizeYouTubeMetadata maps yt-dlp json into the social-fetch contract', () => {
  const normalized = normalizeYouTubeMetadata({
    id: 'k5-57282taI',
    title: 'Trust is making yourself punishable',
    description: 'Short clip about trust.',
    timestamp: 1749659400,
    channel_id: 'UC123',
    uploader_id: '@hormozi',
    channel_handle: '@hormozi',
    channel: 'Alex Hormozi',
    channel_is_verified: true,
    channel_url: 'https://www.youtube.com/@hormozi',
    duration: 41,
    webpage_url: 'https://www.youtube.com/watch?v=k5-57282taI',
    thumbnail: 'https://img.youtube.com/example.jpg',
    like_count: 1234,
    comment_count: 56,
    view_count: 78901,
  }, 'https://youtu.be/k5-57282taI');

  assert.equal(normalized.platform, 'youtube');
  assert.equal(normalized.id, 'k5-57282taI');
  assert.equal(normalized.title, 'Trust is making yourself punishable');
  assert.equal(normalized.author.displayName, 'Alex Hormozi');
  assert.equal(normalized.author.username, '@hormozi');
  assert.equal(normalized.author.isVerified, true);
  assert.equal(normalized.media.duration, 41);
  assert.equal(normalized.media.videoUrl, 'https://www.youtube.com/watch?v=k5-57282taI');
  assert.equal(normalized.stats.plays, 78901);
});

test('parseJson3Transcript keeps offsets and joins segmented text', () => {
  const segments = parseJson3Transcript(JSON.stringify({
    events: [
      {
        tStartMs: 120,
        segs: [{ utf8: 'Trust ' }, { utf8: 'is ' }, { utf8: 'earned.' }],
      },
      {
        tStartMs: 1820,
        segs: [{ utf8: 'Make betrayal expensive.' }],
      },
    ],
  }));

  assert.equal(segments.length, 2);
  assert.equal(segments[0].offset, 120);
  assert.equal(segments[0].text, 'Trust is earned.');
  assert.equal(segments[1].offset, 1820);
  assert.equal(segments[1].text, 'Make betrayal expensive.');
});

test('parseJson3Transcript ignores blank and malformed events', () => {
  const segments = parseJson3Transcript(JSON.stringify({
    events: [
      { tStartMs: 0, segs: [{ utf8: '   ' }] },
      { bogus: true },
      { tStartMs: 900, segs: [{ utf8: 'Real line' }] },
    ],
  }));

  assert.equal(segments.length, 1);
  assert.equal(segments[0].offset, 900);
  assert.equal(segments[0].text, 'Real line');
});
