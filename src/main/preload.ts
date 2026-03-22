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

  /**
   * Listen for MessagePort transfers from main process (streaming).
   * The main process sends ports via webContents.postMessage('streaming:port', ...).
   * Each port carries a `tag` to identify the streaming session.
   *
   * In Electron, ports transferred via webContents.postMessage arrive on
   * ipcRenderer.on(channel, event) where event.ports contains MessagePort[].
   */
  onStreamingPort: (
    callback: (tag: string, port: MessagePort) => void,
  ): (() => void) => {
    const handler = (event: IpcRendererEvent, data: { tag: string }) => {
      if (event.ports && event.ports.length > 0) {
        callback(data?.tag ?? '', event.ports[0]);
      }
    };
    ipcRenderer.on('streaming:port', handler);
    return () => {
      ipcRenderer.removeListener('streaming:port', handler);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
