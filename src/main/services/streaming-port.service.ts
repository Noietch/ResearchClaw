/**
 * Streaming port service using Electron's MessageChannelMain.
 *
 * Electron's standard IPC (webContents.send / ipcRenderer.on) batches
 * messages at the Chromium layer, causing all streaming chunks to arrive
 * in a single batch on the renderer side. MessageChannelMain creates a
 * direct MessagePort pair that bypasses this batching, enabling true
 * chunk-by-chunk delivery for LLM streaming.
 */
import { MessageChannelMain, type WebContents } from 'electron';

export interface StreamingPort {
  /** Send a chunk of text to the renderer */
  sendChunk: (data: string) => void;
  /** Signal that streaming is complete */
  sendDone: () => void;
  /** Signal an error */
  sendError: (error: string) => void;
  /** Close the port and clean up */
  close: () => void;
}

/**
 * Create a MessagePort pair and transfer one end to the renderer.
 *
 * @param webContents - The BrowserWindow's webContents to send the port to
 * @param channelTag  - A tag sent with the port so the renderer can associate
 *                      it with the correct streaming session (e.g. paperId)
 * @returns A StreamingPort interface for the main process to send data through
 */
export function createStreamingPort(webContents: WebContents, channelTag: string): StreamingPort {
  const { port1, port2 } = new MessageChannelMain();

  // Transfer port2 to the renderer via postMessage.
  // The renderer receives this on the 'streaming:port' channel.
  webContents.postMessage('streaming:port', { tag: channelTag }, [port2]);

  // Start port1 so it can receive messages (if we ever need bidirectional)
  port1.start();

  let closed = false;

  return {
    sendChunk(data: string) {
      if (!closed) {
        port1.postMessage({ type: 'chunk', data });
      }
    },
    sendDone() {
      if (!closed) {
        port1.postMessage({ type: 'done' });
      }
    },
    sendError(error: string) {
      if (!closed) {
        port1.postMessage({ type: 'error', error });
      }
    },
    close() {
      if (!closed) {
        closed = true;
        port1.close();
      }
    },
  };
}
