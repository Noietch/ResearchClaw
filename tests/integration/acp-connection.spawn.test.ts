import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldUseWindowsShellSpawn } from '../../src/main/agent/acp-connection';

function makeSpawnErrorChild(error: Error): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  (child as unknown as Record<string, unknown>).stdin = new PassThrough();
  (child as unknown as Record<string, unknown>).stdout = new PassThrough();
  (child as unknown as Record<string, unknown>).stderr = new PassThrough();
  (child as unknown as Record<string, unknown>).killed = false;
  (child as unknown as Record<string, unknown>).pid = 12345;
  (child as unknown as { kill: ChildProcess['kill'] }).kill = vi.fn(() => true);
  queueMicrotask(() => {
    child.emit('error', error);
  });
  return child;
}

describe('AcpConnection Windows spawn handling', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unmock('fs');
    vi.unmock('child_process');
    vi.restoreAllMocks();
  });

  it('uses a shell for Windows command shims and bare commands', () => {
    expect(shouldUseWindowsShellSpawn('C:\\tools\\npx.cmd', 'win32')).toBe(true);
    expect(shouldUseWindowsShellSpawn('codex', 'win32')).toBe(true);
    expect(shouldUseWindowsShellSpawn('C:\\Program Files\\nodejs\\node.exe', 'win32')).toBe(false);
    expect(shouldUseWindowsShellSpawn('/usr/bin/npx', 'linux')).toBe(false);
  });

  it.skipIf(process.platform !== 'win32')(
    'prefers .cmd shims over extensionless npm wrappers on Windows',
    async () => {
      vi.resetModules();
      vi.doMock('fs', () => ({
        existsSync: vi.fn((candidate: string) => {
          const normalized = candidate.toLowerCase();
          return (
            normalized === path.join('C:\\tools', 'codex').toLowerCase() ||
            normalized === path.join('C:\\tools', 'codex.cmd').toLowerCase()
          );
        }),
      }));

      const { resolveCommandPath } = await import('../../src/main/utils/shell-env');

      expect(resolveCommandPath('codex', { PATH: 'C:\\tools' })).toBe(
        path.join('C:\\tools', 'codex.cmd'),
      );
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'resolves cmd.exe explicitly from SystemRoot when ComSpec is unavailable',
    async () => {
      vi.resetModules();
      vi.doMock('fs', () => ({
        existsSync: vi.fn(
          (candidate: string) => candidate.toLowerCase() === 'c:\\windows\\system32\\cmd.exe',
        ),
      }));

      const { resolveWindowsShellPath } = await import('../../src/main/utils/shell-env');

      expect(resolveWindowsShellPath({}, 'win32')?.toLowerCase()).toBe(
        'c:\\windows\\system32\\cmd.exe',
      );
      expect(resolveWindowsShellPath({ SystemRoot: 'C:\\Windows' }, 'win32')?.toLowerCase()).toBe(
        'c:\\windows\\system32\\cmd.exe',
      );
    },
  );

  it('rejects spawn startup errors without bubbling uncaught exceptions', async () => {
    vi.resetModules();

    const spawnError = Object.assign(new Error('spawn C:\\WINDOWS\\system32\\cmd.exe ENOENT'), {
      code: 'ENOENT',
    });
    const spawnMock = vi.fn(() => makeSpawnErrorChild(spawnError));

    vi.doMock('child_process', async (importOriginal) => {
      const original = await importOriginal<typeof import('child_process')>();
      return {
        ...original,
        spawn: spawnMock,
      };
    });

    const uncaughtException = vi.fn();
    process.once('uncaughtException', uncaughtException);

    try {
      const { AcpConnection } = await import('../../src/main/agent/acp-connection');
      const conn = new AcpConnection();
      const stderr = vi.fn();
      conn.on('stderr', stderr);

      await expect(conn.spawn('npx @zed-industries/codex-acp', [], process.cwd())).rejects.toThrow(
        /Failed to start ACP agent .*ENOENT/,
      );

      expect(spawnMock).toHaveBeenCalledOnce();
      const spawnOptions = spawnMock.mock.calls[0]?.[2] as
        | { shell?: boolean | string; env?: NodeJS.ProcessEnv }
        | undefined;
      if (process.platform === 'win32') {
        expect(spawnOptions?.shell).toBe(true);
        expect(spawnOptions?.env?.ComSpec ?? spawnOptions?.env?.COMSPEC).toMatch(/cmd\.exe/i);
      }
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(uncaughtException).not.toHaveBeenCalled();
    } finally {
      process.removeListener('uncaughtException', uncaughtException);
    }
  });
});
