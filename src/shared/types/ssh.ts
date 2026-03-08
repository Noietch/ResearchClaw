/**
 * SSH Server Configuration
 * Stored in ~/.vibe-research/ssh-servers.json
 */
export interface SshServerConfig {
  id: string;
  label: string; // e.g., "Lab GPU Server"
  host: string;
  port: number; // default 22
  username: string;
  authMethod: 'password' | 'privateKey';
  passwordEncrypted?: string; // safeStorage encrypted, base64
  privateKeyPath?: string; // local path to private key file
  passphraseEncrypted?: string; // encrypted passphrase for private key
  defaultCwd?: string; // last used remote directory
}

/**
 * SSH Connection config (decrypted, for actual connection)
 */
export interface SshConnectConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

/**
 * Remote directory entry from SFTP
 */
export interface RemoteDirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  modifyTime: number;
}

/**
 * Remote agent detection result
 */
export interface RemoteAgentInfo {
  name: string;
  path: string;
  version?: string;
}

/**
 * SSH connection test result
 */
export interface SshTestResult {
  success: boolean;
  error?: string;
  serverInfo?: {
    host: string;
    port: number;
    username: string;
    homeDir?: string;
  };
}
