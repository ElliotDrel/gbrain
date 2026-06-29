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

function assertAllowed(cmd, args) {
  if (cmd === process.execPath) return;
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
  assertAllowed(cmd, args);
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
  assertAllowed(cmd, args);
  return spawnSyncCb(cmd, args, {
    timeout: normalizeTimeout(options.timeout),
    encoding: options.encoding ?? 'utf8',
    env: options.env,
    cwd: options.cwd,
    windowsHide: true,
  });
}
