import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export type IpcListener = (event: IpcRendererEvent, ...args: unknown[]) => void;

const electronAPI = {
  /** Invoke a main-process IPC handler and await the result */
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),

  /** Fire-and-forget: send a message to main process without waiting for reply */
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),

  /** Subscribe to IPC events pushed from main process (streaming) */
  on: (channel: string, listener: IpcListener) => {
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  /** Remove a specific listener */
  off: (channel: string, listener: IpcListener) => {
    ipcRenderer.removeListener(channel, listener);
  },

  /** One-time listener */
  once: (channel: string, listener: IpcListener) => {
    ipcRenderer.once(channel, listener);
  },

  /** Window controls */
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  /** Open URL in a new browser window */
  openBrowser: (url: string, title?: string) => ipcRenderer.invoke('browser:open', url, title),

  /** Read local file as base64 */
  readLocalFile: (path: string) => ipcRenderer.invoke('file:read', path),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
