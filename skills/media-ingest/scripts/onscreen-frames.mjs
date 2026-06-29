#!/usr/bin/env node
// onscreen-frames.mjs -- deterministic half of the on-screen-text ingest flow.
//
// WHAT THIS DOES (deterministic, no model): given a short-form video URL (or a
// local mp4), download it and sample fixed-fps frames to PNGs, then print a JSON
// manifest of the frame paths. It does NOT read the frames -- that is the agent's
// job (read each PNG as an image via the Read tool). See ONSCREEN-TEXT.md for the
// full procedure and docs/onscreen-text-extraction-FINAL-REPORT.md for why this
// exact method (fixed-fps + vision read) was chosen over scene-detect / tesseract
// / gpt-4o.
//
// Usage:
//   node onscreen-frames.mjs <url-or-mp4> [--fps N] [--raw <path.txt>] [--video-url <fallback>]
//
// Output: a single JSON object on stdout, e.g.
//   { "ok": true, "input": "...", "mp4": "/tmp/.../v.mp4", "fps": 3,
//     "frameDir": "/tmp/...", "frames": ["/tmp/.../f_0001.png", ...], "count": 19,
//     "rawPath": "...", "heading": "## On-Screen Text (from video frames, 2026-06-25)" }
//
// Exit codes: 0 ok, 2 bad args, 3 missing tool, 4 download/input invalid, 5 extract failed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAllowedCommand } from '../../../lib/allowed-child-process.mjs';

// The durable ffmpeg/ffprobe/yt-dlp on this box live in ~/.local/bin (no sudo; see
// FINAL-REPORT section 3). Put them on PATH regardless of caller env.
process.env.PATH = `${path.join(os.homedir(), '.local/bin')}:${process.env.PATH || ''}`;

function emitFail(code, msg, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, error: msg, ...extra }) + '\n');
  process.exit(code);
}

function rmrf(dir) {
  if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
}

function parseArgs(argv) {
  const out = { fps: 3 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fps') out.fps = Number(argv[++i]);
    else if (a === '--raw') out.raw = argv[++i];
    else if (a === '--video-url') out.videoUrl = argv[++i];
    else positional.push(a);
  }
  out.input = positional[0];
  return out;
}

// Present AND working: pass each tool its OWN correct version flag and require a
// clean exit. ENOENT (absent) and a nonzero exit (broken) both count as "no".
async function have(cmd, flag) {
  try { await runAllowedCommand(cmd, [flag]); return true; } catch { return false; }
}

async function hasVideoStream(mp4) {
  // Guards the login-gate case: a gated "CDN url" often returns an HTML login page
  // that is size>0 but has no video stream. ffprobe says so cleanly before ffmpeg
  // would die with a confusing "moov atom not found".
  try {
    const { stdout } = await runAllowedCommand('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', mp4]);
    return stdout.includes('video');
  } catch { return false; }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) emitFail(2, 'usage: onscreen-frames.mjs <url-or-mp4> [--fps N] [--raw path] [--video-url url]');
  if (!Number.isFinite(args.fps) || args.fps <= 0) emitFail(2, `bad --fps: ${args.fps}`);

  if (!(await have('ffmpeg', '-version'))) {
    emitFail(3, 'ffmpeg unavailable (-version failed). Install the user-space static build (no sudo): ' +
      'curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz | tar xJ && ' +
      'cp ffmpeg-*-static/{ffmpeg,ffprobe} ~/.local/bin/');
  }
  const canProbe = await have('ffprobe', '-version');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'onscreen-frames-'));
  const frameDir = path.join(work, 'frames');
  fs.mkdirSync(frameDir, { recursive: true });
  // After this point, any failure must remove `work` (no frames will be read).
  const fail = (code, msg, extra) => { rmrf(work); emitFail(code, msg, extra); };

  // 1. Resolve the mp4: local file used as-is, otherwise download.
  let mp4;
  const isUrl = /^https?:\/\//i.test(args.input);
  if (!isUrl && fs.existsSync(args.input)) {
    mp4 = path.resolve(args.input);
  } else if (!isUrl) {
    fail(4, `input is neither an http(s) URL nor an existing file: ${args.input}`);
  } else {
    mp4 = path.join(work, 'video.mp4');
    if (!(await have('yt-dlp', '--version'))) fail(3, 'yt-dlp unavailable and input is a URL');
    let dlErr = null;
    try {
      await runAllowedCommand('yt-dlp', ['--no-warnings', '-f', 'mp4/best', '-o', mp4, args.input],
        { maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
    } catch (e) { dlErr = e; }
    if (dlErr || !fs.existsSync(mp4) || fs.statSync(mp4).size === 0) {
      if (args.videoUrl) {
        try { await runAllowedCommand('curl', ['-fsSL', '-o', mp4, args.videoUrl], { timeout: 120000 }); }
        catch (e2) { fail(4, `download failed (yt-dlp + --video-url fallback): ${e2.message}`); }
      } else {
        const tail = dlErr ? String(dlErr.message).trim().split('\n').pop() : 'empty download';
        fail(4, `yt-dlp failed and no --video-url fallback given: ${tail}`);
      }
    }
    if (!fs.existsSync(mp4) || fs.statSync(mp4).size === 0) fail(4, 'download produced no mp4');
  }

  // 1b. Confirm it is actually a video (catches HTML login pages from gated CDNs).
  if (canProbe && !(await hasVideoStream(mp4))) {
    fail(4, 'downloaded/!input file has no video stream (likely a login/HTML page, not a video). ' +
      'For gated reels pass the real CDN url via --video-url.');
  }

  // 2. Sample fixed-fps frames (robust for overlay-text reels; see FINAL-REPORT 4.2).
  //    %04d so frame names stay lexically sortable past 99; numeric sort regardless.
  try {
    await runAllowedCommand('ffmpeg', ['-v', 'error', '-i', mp4, '-vf', `fps=${args.fps}`,
      path.join(frameDir, 'f_%04d.png')], { timeout: 180000 });
  } catch (e) {
    fail(5, `ffmpeg frame extraction failed: ${e.message}`);
  }

  const frames = fs.readdirSync(frameDir).filter(f => f.endsWith('.png'))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10))
    .map(f => path.join(frameDir, f));
  if (frames.length === 0) fail(5, 'no frames extracted');

  const stamp = new Date().toISOString().slice(0, 10);
  process.stdout.write(JSON.stringify({
    ok: true,
    input: args.input,
    mp4,
    fps: args.fps,
    frameDir,
    frames,
    count: frames.length,
    rawPath: args.raw || null,
    heading: `## On-Screen Text (from video frames, ${stamp})`,
    next: 'Read each frame path as an image (Read tool), transcribe the on-screen text, dedup ' +
          'repeated cards, append under `heading` to rawPath, then `rm -rf` the parent of frameDir. ' +
          'See ONSCREEN-TEXT.md.',
  }) + '\n');
}

main().catch(e => emitFail(1, `unexpected: ${e.message}`));
