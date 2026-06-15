import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTranscript, parseWebVtt, normalizeMetadata, normalizeTranscript, shouldFallbackToSupadata, normalizeThreadReaderTranscript } from './provider-client.mjs';

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
  assert.equal(normalized.id, 'DLDXI0fylTC');
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

test('normalizeMetadata maps x author info from nested user_results', () => {
  const normalized = normalizeMetadata('x', {
    rest_id: '2065217179101147279',
    legacy: {
      id_str: '2065217179101147279',
      full_text: 'The opener tweet',
      created_at: 'Thu Jun 11 15:04:19 +0000 2026',
      favorite_count: 12,
      reply_count: 3,
      retweet_count: 4,
      user_id_str: '1337',
    },
    core: {
      user_results: {
        result: {
          rest_id: '1337',
          is_blue_verified: true,
          core: {
            name: 'Nicolas Dessaigne',
            screen_name: 'dessaigne',
          },
        },
      },
    },
  });

  assert.equal(normalized.author.id, '1337');
  assert.equal(normalized.author.username, 'dessaigne');
  assert.equal(normalized.author.displayName, 'Nicolas Dessaigne');
  assert.equal(normalized.author.isVerified, true);
  assert.equal(normalized.author.url, 'https://x.com/dessaigne');
});

test('normalizeMetadata recovers full note-tweet body over the truncated legacy.full_text', () => {
  const normalized = normalizeMetadata('x', {
    rest_id: '99',
    legacy: { id_str: '99', full_text: 'This is the teaser that gets cut o…' },
    note_tweet: {
      note_tweet_results: {
        result: { text: 'This is the teaser that gets cut off, but the note tweet carries the complete long-form body in full.' },
      },
    },
  });
  assert.match(normalized.description, /complete long-form body in full\.$/);
  assert.equal(normalized.articleDetected, false);
  assert.equal(normalized.type, 'post');
});

test('normalizeMetadata flags an X article so the caller asks for a manual transcript', () => {
  const normalized = normalizeMetadata('x', {
    rest_id: '100',
    legacy: { id_str: '100', full_text: 'Taste is a muscle, not a gift. (teaser)' },
    article: { article_results: { result: { title: 'Taste Is a Muscle, Not a Gift' } } },
  });
  assert.equal(normalized.articleDetected, true);
  assert.equal(normalized.type, 'article');
});

test('normalizeThreadReaderTranscript extracts the full ordered x thread', () => {
  const normalized = normalizeThreadReaderTranscript(`
    <div id="tweet_1" class="content-tweet allow-preview" data-action="click->thread#showTweet" dir="auto">
      First point.
      <sup class="tw-permalink"><i class="fas fa-link"></i></sup>
    </div>
    <div id="tweet_2" class="content-tweet allow-preview" data-action="click->thread#showTweet" dir="auto">
      Second point &amp; payoff.
      <sup class="tw-permalink"><i class="fas fa-link"></i></sup>
    </div>
  `);

  assert.equal(normalized.state, 'ok');
  assert.equal(normalized.segments.length, 2);
  assert.equal(normalized.segments[0].text, 'First point.');
  assert.equal(normalized.segments[1].text, 'Second point & payoff.');
  assert.match(normalized.text, /First point\.\n\nSecond point & payoff\./);
});

test('shouldFallbackToSupadata only triggers for long failed videos when a key exists', () => {
  assert.equal(shouldFallbackToSupadata({
    durationSeconds: 147,
    transcriptState: 'error',
    supadataApiKey: 'secret',
  }), true);

  assert.equal(shouldFallbackToSupadata({
    durationSeconds: 112,
    transcriptState: 'error',
    supadataApiKey: 'secret',
  }), false);

  assert.equal(shouldFallbackToSupadata({
    durationSeconds: 147,
    transcriptState: 'ok',
    supadataApiKey: 'secret',
  }), false);

  assert.equal(shouldFallbackToSupadata({
    durationSeconds: 147,
    transcriptState: 'error',
    supadataApiKey: '',
  }), false);
});

test('getTranscript falls back to Supadata only after ScrapeCreators fails on a long video', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://api.scrapecreators.com/')) {
      return new Response(JSON.stringify({ error: 'video-too-long' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).startsWith('https://api.supadata.ai/v1/transcript')) {
      return new Response(JSON.stringify({
        content: [{ text: 'fallback transcript line', offset: 0 }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected url: ${url}`);
  };

  try {
    const result = await getTranscript(
      { scrapeCreatorsApiKey: 'scrape', supadataApiKey: 'supadata' },
      'instagram',
      'https://www.instagram.com/reel/example/',
      { durationSeconds: 147 },
    );

    assert.equal(result.provider, 'supadata');
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.state, 'ok');
    assert.match(result.text, /fallback transcript line/);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /api\.scrapecreators\.com/);
    assert.match(calls[1], /api\.supadata\.ai/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getTranscript falls back to Thread Reader for x threads when provider transcript is empty', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://api.scrapecreators.com/')) {
      return new Response(JSON.stringify({ success: true, transcript: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).startsWith('https://threadreaderapp.com/thread/2065217179101147279.html')) {
      return new Response(`
        <div id="tweet_1" class="content-tweet allow-preview" dir="auto">
          First tweet.
          <sup class="tw-permalink"><i class="fas fa-link"></i></sup>
        </div>
        <div id="tweet_2" class="content-tweet allow-preview" dir="auto">
          Second tweet.
          <sup class="tw-permalink"><i class="fas fa-link"></i></sup>
        </div>
      `, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    throw new Error(`unexpected url: ${url}`);
  };

  try {
    const result = await getTranscript(
      { scrapeCreatorsApiKey: 'scrape', supadataApiKey: null },
      'x',
      'https://x.com/dessaigne/status/2065217179101147279',
      { postId: '2065217179101147279' },
    );

    assert.equal(result.provider, 'threadreader');
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.state, 'ok');
    assert.match(result.text, /First tweet\.\n\nSecond tweet\./);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /api\.scrapecreators\.com/);
    assert.match(calls[1], /threadreaderapp\.com/);
  } finally {
    global.fetch = originalFetch;
  }
});
