import { execFile as execFileCb, spawnSync as spawnSyncCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const EXACT_ALLOWLIST = new Set([
  'curl',
  'ffmpeg',
  'ffprobe',
  'python3',
  'yt-dlp',
]);

function assertStringArray(args) {
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
    throw new Error('allowed-child-process requires string argv only');
  }
}

function normalizeTimeout(timeout) {
  if (timeout === undefined) return undefined;
  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new Error(`invalid timeout: ${timeout}`);
  }
  return timeout;
}

function assertNodeEntrypoint(args, allowedEntrypoint) {
  if (!allowedEntrypoint) {
    throw new Error('process.execPath requires allowNodeEntrypoint');
  }
  const entrypoint = args[0];
  if (typeof entrypoint !== 'string' || !entrypoint || entrypoint.startsWith('-')) {
    throw new Error('process.execPath is only allowlisted for explicit script entrypoints');
  }
  if (entrypoint !== allowedEntrypoint) {
    throw new Error(`process.execPath entrypoint not allowlisted: ${entrypoint}`);
  }
}

function assertAllowed(cmd, args, options = {}) {
  if (cmd === process.execPath) {
    assertNodeEntrypoint(args, options.allowNodeEntrypoint);
    return;
  }
  if (!EXACT_ALLOWLIST.has(cmd)) {
    throw new Error(`command not allowlisted: ${cmd}`);
  }
  if (cmd === 'python3') {
    if (args[0] !== '-m' || args[1] !== 'yt_dlp') {
      throw new Error('python3 is only allowlisted for -m yt_dlp');
    }
  }
}

export async function runAllowedCommand(cmd, args, options = {}) {
  assertStringArray(args);
  assertAllowed(cmd, args, options);
  return await execFile(cmd, args, {
    timeout: normalizeTimeout(options.timeout),
    maxBuffer: options.maxBuffer,
    windowsHide: true,
    env: options.env,
    cwd: options.cwd,
  });
}

export function runAllowedCommandSync(cmd, args, options = {}) {
  assertStringArray(args);
  assertAllowed(cmd, args, options);
  return spawnSyncCb(cmd, args, {
    timeout: normalizeTimeout(options.timeout),
    encoding: options.encoding ?? 'utf8',
    env: options.env,
    cwd: options.cwd,
    windowsHide: true,
  });
}
