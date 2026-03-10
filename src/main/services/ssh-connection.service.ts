import * as ssh2 from 'ssh2';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SshConnectConfig, RemoteDirEntry, RemoteAgentInfo, SshTestResult } from '@shared';

function expandPath(p: string): string {
  return p.replace(/^~/, os.homedir());
}

export interface SshSpawnHandle {
  channel: ssh2.ClientChannel;
  sshClient: ssh2.Client;
  kill: () => void;
}

/**
 * SSH Connection Service
 *
 * Provides utilities for SSH connections and remote process execution.
 */
export const SshConnectionService = {
  /**
   * Test SSH connection to a server.
   */
  async testConnection(config: SshConnectConfig): Promise<SshTestResult> {
    const client = new ssh2.Client();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        client.end();
        resolve({
          success: false,
          error: 'Connection timeout (30s)',
        });
      }, 30000);

      client
        .on('ready', () => {
          clearTimeout(timeout);

          // Try to get home directory
          client.exec('echo $HOME', (err, stream) => {
            if (err) {
              client.end();
              resolve({
                success: true,
                serverInfo: {
                  host: config.host,
                  port: config.port,
                  username: config.username,
                },
              });
              return;
            }

            let homeDir = '';
            stream
              .on('data', (data: Buffer) => {
                homeDir += data.toString();
              })
              .on('close', () => {
                client.end();
                resolve({
                  success: true,
                  serverInfo: {
                    host: config.host,
                    port: config.port,
                    username: config.username,
                    homeDir: homeDir.trim() || undefined,
                  },
                });
              });
          });
        })
        .on('error', (err) => {
          clearTimeout(timeout);
          resolve({
            success: false,
            error: err.message,
          });
        });

      const connConfig: ssh2.ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 30000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
      };

      if (config.password) {
        connConfig.password = config.password;
      } else if (config.privateKeyPath) {
        try {
          connConfig.privateKey = fs.readFileSync(expandPath(config.privateKeyPath));
          if (config.passphrase) {
            connConfig.passphrase = config.passphrase;
          }
        } catch (err) {
          resolve({
            success: false,
            error: `Failed to read private key: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }
      } else {
        resolve({
          success: false,
          error: 'No authentication method provided (password or privateKey required)',
        });
        return;
      }

      client.connect(connConfig);
    });
  },

  /**
   * Spawn a remote process via SSH.
   * Returns a handle with the channel (duplex stream), SSH client, and kill function.
   */
  async spawnRemoteProcess(
    config: SshConnectConfig,
    command: string,
    cwd: string,
    env?: Record<string, string>,
  ): Promise<SshSpawnHandle> {
    const client = new ssh2.Client();

    return new Promise((resolve, reject) => {
      client
        .on('ready', () => {
          // Build the command with cd and env exports
          let fullCommand = `cd ${shellEscape(cwd)}`;

          if (env && Object.keys(env).length > 0) {
            // SSH servers often don't accept env channel requests
            // So we prefix the command with exports
            const envExports = Object.entries(env)
              .map(([key, value]) => `export ${key}=${shellEscape(value)}`)
              .join(' && ');
            fullCommand = `${envExports} && ${fullCommand}`;
          }

          fullCommand = `${fullCommand} && ${command}`;

          client.exec(fullCommand, { pty: false }, (err, channel) => {
            if (err) {
              client.end();
              reject(err);
              return;
            }

            const handle: SshSpawnHandle = {
              channel,
              sshClient: client,
              kill: () => {
                // Send SIGTERM to the remote process
                // For SSH, we close the channel which sends EOF
                // The remote shell will handle the signal
                channel.close();
                client.end();
              },
            };

            resolve(handle);
          });
        })
        .on('error', (err) => {
          reject(err);
        });

      const connConfig: ssh2.ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 30000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
      };

      if (config.password) {
        connConfig.password = config.password;
      } else if (config.privateKeyPath) {
        connConfig.privateKey = fs.readFileSync(expandPath(config.privateKeyPath));
        if (config.passphrase) {
          connConfig.passphrase = config.passphrase;
        }
      }

      client.connect(connConfig);
    });
  },

  /**
   * List directory contents via SFTP.
   */
  async listDirectory(config: SshConnectConfig, dirPath: string): Promise<RemoteDirEntry[]> {
    const client = new ssh2.Client();

    return new Promise((resolve, reject) => {
      client
        .on('ready', () => {
          client.sftp((err, sftp) => {
            if (err) {
              client.end();
              reject(err);
              return;
            }

            sftp.readdir(dirPath, (err, list) => {
              client.end();

              if (err) {
                reject(err);
                return;
              }

              const entries: RemoteDirEntry[] = list.map((item) => ({
                name: item.filename,
                path: path.posix.join(dirPath, item.filename),
                isDirectory: item.attrs.isDirectory(),
                isFile: item.attrs.isFile(),
                size: item.attrs.size,
                modifyTime: item.attrs.mtime * 1000, // Convert to milliseconds
              }));

              // Sort: directories first, then by name
              entries.sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) {
                  return a.isDirectory ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
              });

              resolve(entries);
            });
          });
        })
        .on('error', reject);

      const connConfig: ssh2.ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 30000,
      };

      if (config.password) {
        connConfig.password = config.password;
      } else if (config.privateKeyPath) {
        connConfig.privateKey = fs.readFileSync(expandPath(config.privateKeyPath));
        if (config.passphrase) {
          connConfig.passphrase = config.passphrase;
        }
      }

      client.connect(connConfig);
    });
  },

  /**
   * Read a remote file via SFTP.
   */
  async readRemoteFile(config: SshConnectConfig, filePath: string): Promise<string> {
    const client = new ssh2.Client();

    return new Promise((resolve, reject) => {
      client
        .on('ready', () => {
          client.sftp((err, sftp) => {
            if (err) {
              client.end();
              reject(err);
              return;
            }

            const chunks: Buffer[] = [];
            const stream = sftp.createReadStream(filePath);

            stream.on('data', (chunk: Buffer) => {
              chunks.push(chunk);
            });

            stream.on('end', () => {
              client.end();
              resolve(Buffer.concat(chunks).toString('utf-8'));
            });

            stream.on('error', (err) => {
              client.end();
              reject(err);
            });
          });
        })
        .on('error', reject);

      const connConfig: ssh2.ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 30000,
      };

      if (config.password) {
        connConfig.password = config.password;
      } else if (config.privateKeyPath) {
        connConfig.privateKey = fs.readFileSync(expandPath(config.privateKeyPath));
        if (config.passphrase) {
          connConfig.passphrase = config.passphrase;
        }
      }

      client.connect(connConfig);
    });
  },

  /**
   * Write a remote file via SFTP.
   */
  async writeRemoteFile(
    config: SshConnectConfig,
    filePath: string,
    content: string,
  ): Promise<void> {
    const client = new ssh2.Client();

    return new Promise((resolve, reject) => {
      client
        .on('ready', () => {
          client.sftp((err, sftp) => {
            if (err) {
              client.end();
              reject(err);
              return;
            }

            const stream = sftp.createWriteStream(filePath);

            stream.on('finish', () => {
              client.end();
              resolve();
            });

            stream.on('error', (err) => {
              client.end();
              reject(err);
            });

            stream.end(content, 'utf-8');
          });
        })
        .on('error', reject);

      const connConfig: ssh2.ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 30000,
      };

      if (config.password) {
        connConfig.password = config.password;
      } else if (config.privateKeyPath) {
        connConfig.privateKey = fs.readFileSync(expandPath(config.privateKeyPath));
        if (config.passphrase) {
          connConfig.passphrase = config.passphrase;
        }
      }

      client.connect(connConfig);
    });
  },

  /**
   * Detect available agent CLIs on the remote server.
   */
  async detectRemoteAgents(config: SshConnectConfig): Promise<RemoteAgentInfo[]> {
    const client = new ssh2.Client();

    return new Promise((resolve, reject) => {
      client
        .on('ready', () => {
          // Check common agent CLI paths
          const agentsToCheck = [
            { name: 'claude', path: 'claude', versionArg: '--version' },
            { name: 'gemini', path: 'gemini', versionArg: '--version' },
            { name: 'qwen', path: 'qwen', versionArg: '--version' },
            { name: 'goose', path: 'goose', versionArg: '--version' },
            { name: 'codex', path: 'codex', versionArg: '--version' },
          ];

          // Build a command to check all at once
          const checkCommands = agentsToCheck
            .map((a) => {
              return `command -v ${a.path} >/dev/null 2>&1 && echo "FOUND:${a.name}:$(which ${a.path}):$(${a.path} ${a.versionArg} 2>&1 | head -n1)" || true`;
            })
            .join('; ');

          client.exec(checkCommands, (err, stream) => {
            if (err) {
              client.end();
              reject(err);
              return;
            }

            let output = '';
            stream
              .on('data', (data: Buffer) => {
                output += data.toString();
              })
              .on('close', () => {
                client.end();

                const results: RemoteAgentInfo[] = [];
                const lines = output.split('\n').filter((l) => l.startsWith('FOUND:'));

                for (const line of lines) {
                  const parts = line.substring(6).split(':');
                  if (parts.length >= 2) {
                    results.push({
                      name: parts[0],
                      path: parts[1],
                      version: parts.slice(2).join(':').trim() || undefined,
                    });
                  }
                }

                resolve(results);
              });
          });
        })
        .on('error', reject);

      const connConfig: ssh2.ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 30000,
      };

      if (config.password) {
        connConfig.password = config.password;
      } else if (config.privateKeyPath) {
        connConfig.privateKey = fs.readFileSync(expandPath(config.privateKeyPath));
        if (config.passphrase) {
          connConfig.passphrase = config.passphrase;
        }
      }

      client.connect(connConfig);
    });
  },
};

/**
 * Escape a string for safe use in a shell command.
 */
function shellEscape(str: string): string {
  // Use single quotes and escape any single quotes within
  return `'${str.replace(/'/g, "'\\''")}'`;
}
