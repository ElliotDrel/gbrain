// Tests for canonical-url.mjs — run: node --test skills/media-ingest/scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, resolve } from './canonical-url.mjs';

test('instagram: reel / reels / p / tv + share token + mobile all collapse to one id', () => {
  const variants = [
    'https://www.instagram.com/reel/DZGb63Tx43_/',
    'https://instagram.com/reels/DZGb63Tx43_/?igsh=AbC123',
    'https://m.instagram.com/reel/DZGb63Tx43_/',
    'http://www.instagram.com/reel/DZGb63Tx43_',
  ];
  for (const v of variants) {
    const c = canonicalize(v);
    assert.equal(c.platform, 'instagram', v);
    assert.equal(c.id, 'DZGb63Tx43_', v);
    assert.equal(c.canonicalUrl, 'https://www.instagram.com/reel/DZGb63Tx43_/', v);
  }
});

test('instagram: /p/ and /tv/ preserve their type in the canonical url', () => {
  assert.equal(canonicalize('https://www.instagram.com/p/ABC-1_2/').canonicalUrl, 'https://www.instagram.com/p/ABC-1_2/');
  assert.equal(canonicalize('https://www.instagram.com/tv/XYZ/').canonicalUrl, 'https://www.instagram.com/tv/XYZ/');
});

test('youtube: watch / youtu.be / shorts / embed + tracking params -> same video id', () => {
  for (const v of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
    'https://youtu.be/dQw4w9WgXcQ?si=abcd',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
  ]) {
    const c = canonicalize(v);
    assert.equal(c.platform, 'youtube', v);
    assert.equal(c.id, 'dQw4w9WgXcQ', v);
    assert.equal(c.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', v);
  }
});

test('tiktok: full video url -> numeric id, keeps @user', () => {
  const c = canonicalize('https://www.tiktok.com/@some.user/video/7300000000000000000?lang=en');
  assert.equal(c.platform, 'tiktok');
  assert.equal(c.id, '7300000000000000000');
  assert.equal(c.canonicalUrl, 'https://www.tiktok.com/@some.user/video/7300000000000000000');
});

test('x / twitter: status id, twitter.com and x.com converge', () => {
  for (const v of ['https://twitter.com/jack/status/20?s=20', 'https://x.com/jack/status/20']) {
    const c = canonicalize(v);
    assert.equal(c.platform, 'x', v);
    assert.equal(c.id, '20', v);
    assert.equal(c.canonicalUrl, 'https://x.com/i/status/20', v);
  }
});

test('non-post / junk / opaque share links return null from canonicalize', () => {
  for (const v of [
    'https://example.com/whatever',
    'not a url',
    'ftp://instagram.com/reel/x/',
    'https://vm.tiktok.com/ZMabc123/',     // short link: id not in string
    'https://www.instagram.com/share/reel/xyz/', // opaque share path
    'https://www.instagram.com/someuser/', // profile, not a post
  ]) {
    assert.equal(canonicalize(v), null, v);
  }
});

test('resolve: a direct link skips the network entirely', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; throw new Error('should not be called'); };
  const r = await resolve('https://www.instagram.com/reel/DZGb63Tx43_/', { fetchImpl });
  assert.equal(called, false);
  assert.equal(r.id, 'DZGb63Tx43_');
  assert.equal(r.resolvedFrom, undefined);
});

test('resolve: a tiktok short link is followed (free) and canonicalized', async () => {
  const fetchImpl = async () => ({
    url: 'https://www.tiktok.com/@creator/video/7300000000000000001?_r=1',
    body: { cancel() {} },
  });
  const r = await resolve('https://vm.tiktok.com/ZMShOrt/', { fetchImpl });
  assert.equal(r.platform, 'tiktok');
  assert.equal(r.id, '7300000000000000001');
  assert.equal(r.resolvedFrom, 'https://vm.tiktok.com/ZMShOrt/');
});

test('resolve: refuses to follow unknown hosts', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { url: 'x', body: null }; };
  assert.equal(await resolve('https://evil.example.com/abc', { fetchImpl }), null);
  assert.equal(called, false);
});

test('resolve: network failure degrades to null (metadata backstop covers it)', async () => {
  const fetchImpl = async () => { throw new Error('timeout'); };
  assert.equal(await resolve('https://vm.tiktok.com/ZMabc/', { fetchImpl }), null);
});

test('resolve: redirect that lands on a non-post page returns null', async () => {
  const fetchImpl = async () => ({ url: 'https://www.tiktok.com/@creator', body: { cancel() {} } });
  assert.equal(await resolve('https://vm.tiktok.com/ZMabc/', { fetchImpl }), null);
});
