# Agent Guidelines

Supplementary engineering guidelines for AI agents working on this codebase.
These rules complement `CLAUDE.md` and apply equally to all agents.

## Background Job Pattern

Any IPC operation that may take more than a few seconds (LLM streaming, comparison, recommendation generation, embedding, etc.) **must** follow the background job pattern:

### Main Process (backend)

1. **Fire-and-forget execution** — The IPC handler returns immediately with a `{ jobId }` ack. The actual work runs in a detached `void (async () => { ... })()` block.
2. **In-memory job state** — Keep a `Map<jobId, JobStatus>` that tracks `stage`, `partialText`, `error`, `active`, timestamps, etc.
3. **Broadcast progress** — On every meaningful state change, call `BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, jobStatus))`.
4. **Provide a query handler** — Expose a `<feature>:getActiveJobs` (or similar) IPC handler that returns current job state so the renderer can recover on remount.
5. **Support cancellation** — Use `AbortController`; expose a `<feature>:kill` handler that calls `controller.abort()`.

### Renderer (frontend)

1. **Subscribe to broadcasts** — Use `onIpc(channel, handler)` to receive real-time status updates.
2. **Never auto-kill on unmount** — Component cleanup must **not** call the kill handler. Users navigate away and come back; the job must survive.
3. **Recover on mount** — On component mount, call the `getActiveJobs` handler to check for in-progress or recently-completed jobs that match the current context (e.g., same `paperIds`). Restore UI state from the recovered job before deciding whether to start a new one.
4. **Guard against race conditions** — Use a `recoveryDone` state flag so that auto-start logic waits until recovery completes before launching a new job.
5. **Manual cancel only** — Provide an explicit Stop/Cancel button that calls the kill handler.

### Existing examples

- **Paper processing** — `papers:processingStatus` broadcast, `papers:retryProcessing`
- **Comparison** — `comparison:start` / `comparison:status` broadcast / `comparison:getActiveJobs` / `comparison:kill`
- **Semantic model pull** — `settings:semanticModelPullStatus` broadcast
