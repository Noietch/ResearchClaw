/**
 * Mock Electron modules for integration testing
 *
 * This file mocks the Electron API for use in Vitest integration tests.
 * Services that use BrowserWindow, ipcMain, etc. will use these mocks.
 */

// Mock BrowserWindow
const mockWebContents = {
  send: vi.fn(),
};

const mockBrowserWindow = {
  webContents: mockWebContents,
};

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromWebContents: vi.fn(() => mockBrowserWindow),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
  },
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return '/tmp/vibe-research-test';
      return '/tmp';
    }),
    getVersion: vi.fn(() => '0.0.1-test'),
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(str).toString('base64')),
    decryptString: vi.fn((encrypted: string) => Buffer.from(encrypted, 'base64').toString('utf-8')),
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({ toDataURL: vi.fn() })),
    createFromDataURL: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
  clipboard: {
    writeText: vi.fn(),
    readText: vi.fn(),
  },
  Menu: {
    buildFromTemplate: vi.fn(),
    setApplicationMenu: vi.fn(),
  },
  MenuItem: vi.fn(),
  Notification: vi.fn().mockImplementation(() => ({
    show: vi.fn(),
    on: vi.fn(),
  })),
  globalShortcut: {
    register: vi.fn(),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
  },
}));

// Re-export for convenience
export { mockBrowserWindow, mockWebContents };
