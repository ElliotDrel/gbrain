import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAllowedCommandSync } from '../lib/allowed-child-process.mjs';

describe('allowed-child-process', () => {
  test('rejects non-allowlisted commands', () => {
    expect(() => runAllowedCommandSync('sh', ['-c', 'echo nope'])).toThrow(
      'command not allowlisted: sh',
    );
  });

  test('rejects python3 outside -m yt_dlp', () => {
    expect(() => runAllowedCommandSync('python3', ['-c', 'print(1)'])).toThrow(
      'python3 is only allowlisted for -m yt_dlp',
    );
  });

  test('rejects process.execPath without explicit allowNodeEntrypoint', () => {
    expect(() => runAllowedCommandSync(process.execPath, ['-e', 'process.stdout.write("x")'])).toThrow(
      'process.execPath requires allowNodeEntrypoint',
    );
  });

  test('rejects process.execPath flag injection even with allowNodeEntrypoint', () => {
    expect(() => runAllowedCommandSync(process.execPath, ['-e', 'process.stdout.write("x")'], {
      allowNodeEntrypoint: '/tmp/allowed-script.mjs',
    })).toThrow('process.execPath is only allowlisted for explicit script entrypoints');
  });

  test('allows process.execPath only for the exact allowlisted script path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allowed-child-process-'));
    const scriptPath = path.join(dir, 'ok.mjs');
    fs.writeFileSync(scriptPath, 'process.stdout.write("ok")\n');
    try {
      const result = runAllowedCommandSync(process.execPath, [scriptPath], {
        allowNodeEntrypoint: scriptPath,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('ok');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
