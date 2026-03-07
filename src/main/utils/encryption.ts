/**
 * Encryption utilities using Electron's safeStorage
 * Provides consistent encryption/decryption across all stores
 */

// Lazy import safeStorage to avoid Electron dependency in tests
let _safeStorage: {
  isEncryptionAvailable: () => boolean;
  encryptString: (s: string) => Buffer;
  decryptString: (b: Buffer) => string;
} | null = null;

function getSafeStorage(): {
  isEncryptionAvailable: () => boolean;
  encryptString: (s: string) => Buffer;
  decryptString: (b: Buffer) => string;
} {
  if (_safeStorage === null) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      _safeStorage = require('electron').safeStorage;
    } catch {
      // Electron not available (e.g., in tests)
      _safeStorage = {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.from(''),
        decryptString: () => '',
      };
    }
  }
  return _safeStorage!;
}

/**
 * Encrypt a string using safeStorage
 * Returns base64-encoded encrypted string
 */
export function encryptString(plaintext: string): string | undefined {
  if (!plaintext) return undefined;
  const safeStorage = getSafeStorage();
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plaintext).toString('base64');
  }
  // Fallback: base64 encode (not secure, but better than plaintext)
  return Buffer.from(plaintext).toString('base64');
}

/**
 * Decrypt a base64-encoded encrypted string
 */
export function decryptString(encrypted: string): string | undefined {
  if (!encrypted) return undefined;
  try {
    const safeStorage = getSafeStorage();
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    }
    // Fallback: base64 decode
    return Buffer.from(encrypted, 'base64').toString('utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Check if encryption is available
 */
export function isEncryptionAvailable(): boolean {
  return getSafeStorage().isEncryptionAvailable();
}
