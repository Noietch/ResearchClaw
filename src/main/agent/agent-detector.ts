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

const AGENTS_TO_DETECT = [
  { backend: 'claude', name: 'Claude Code', cli: 'claude', acpArgs: ['--experimental-acp'] },
  { backend: 'codex', name: 'Codex', cli: 'codex', acpArgs: [] },
  { backend: 'gemini', name: 'Gemini CLI', cli: 'gemini', acpArgs: ['--experimental-acp'] },
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
