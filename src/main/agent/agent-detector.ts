import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DetectedAgent {
  backend: string;
  name: string;
  cliPath: string;
  acpArgs: string[];
  version?: string;
}

/**
 * Agent metadata for detection
 * Different CLIs have different ACP activation conventions:
 * - Claude Code: --experimental-acp
 * - Gemini: --experimental-acp
 * - Qwen: --acp
 * - Goose: acp (subcommand, not flag)
 * Note: Codex uses npx @zed-industries/codex-acp bridge, no local binary to detect
 */
const AGENTS_TO_DETECT = [
  { backend: 'claude-code', name: 'Claude Code', cli: 'claude', acpArgs: ['--experimental-acp'] },
  { backend: 'gemini', name: 'Gemini CLI', cli: 'gemini', acpArgs: ['--experimental-acp'] },
  { backend: 'qwen', name: 'Qwen Code', cli: 'qwen', acpArgs: ['--acp'] },
  { backend: 'goose', name: 'Goose', cli: 'goose', acpArgs: ['acp'] },
];

export async function detectAgents(): Promise<DetectedAgent[]> {
  const results = await Promise.allSettled(
    AGENTS_TO_DETECT.map(async (agent) => {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const { stdout } = await execAsync(`${whichCmd} ${agent.cli}`, { timeout: 1000 });
      const cliPath = stdout.trim().split('\n')[0];
      return {
        backend: agent.backend,
        name: agent.name,
        cliPath,
        acpArgs: agent.acpArgs,
      };
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<DetectedAgent> => r.status === 'fulfilled')
    .map((r) => r.value);
}
