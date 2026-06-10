import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWebVtt, normalizeMetadata, normalizeTranscript } from './supadata-client.mjs';

test('parseWebVtt preserves timestamp offsets and text', () => {
  const segments = parseWebVtt(`WEBVTT

00:00:00.120 --> 00:00:01.840
Alright, pizza review time.

00:00:01.841 --> 00:00:03.761
Sal's Pizza Factory.
`);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].offset, 120);
  assert.equal(segments[0].text, 'Alright, pizza review time.');
  assert.equal(segments[1].offset, 1841);
});

test('normalizeMetadata maps instagram docs shape into the social-fetch contract', () => {
  const normalized = normalizeMetadata('instagram', {
    data: {
      xdt_shortcode_media: {
        id: '3657869083548472514',
        shortcode: 'DLDXI0fylTC',
        accessibility_caption: 'Jane talking about buns',
        product_type: 'clips',
        taken_at_timestamp: 1750374000,
        video_duration: 84.666,
        display_url: 'https://cdn.example.com/image.jpg',
        video_url: 'https://cdn.example.com/video.mp4',
        video_play_count: 425901,
        edge_media_preview_like: { count: 123 },
        edge_media_preview_comment: { count: 9 },
        edge_media_to_caption: {
          edges: [{ node: { text: 'Caption text here' } }],
        },
        owner: {
          id: '21393171',
          username: 'jane',
          full_name: 'Jane Doe',
          is_verified: true,
        },
      },
    },
  });

  assert.equal(normalized.platform, 'instagram');
  assert.equal(normalized.id, '3657869083548472514');
  assert.equal(normalized.author.displayName, 'Jane Doe');
  assert.equal(normalized.description, 'Caption text here');
  assert.equal(normalized.media.duration, 84.666);
  assert.equal(normalized.stats.plays, 425901);
});

test('normalizeTranscript maps youtube transcript arrays into timestamped segments', () => {
  const normalized = normalizeTranscript('youtube', {
    transcript: [
      { text: 'hello world', startMs: '160', endMs: '1920', startTimeText: '0:00' },
    ],
    transcript_only_text: 'hello world',
  });

  assert.equal(normalized.state, 'ok');
  assert.equal(normalized.text, 'hello world');
  assert.equal(normalized.segments.length, 1);
  assert.equal(normalized.segments[0].offset, 160);
});

test('normalizeTranscript maps instagram transcript arrays without timestamps', () => {
  const normalized = normalizeTranscript('instagram', {
    success: true,
    transcripts: [
      { id: '1', shortcode: 'ABC', text: 'First slide' },
      { id: '2', shortcode: 'ABC', text: 'Second slide' },
    ],
  });

  assert.equal(normalized.state, 'ok');
  assert.equal(normalized.segments.length, 2);
  assert.equal(normalized.segments[0].offset, null);
  assert.match(normalized.text, /First slide/);
  assert.match(normalized.text, /Second slide/);
});
