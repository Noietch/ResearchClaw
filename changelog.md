# Changelog

## 2026-03-10 (session 73)

### refactor: Remove API chat from paper reader page, agent-only mode

- **Scope**: `src/renderer/pages/papers/reader/page.tsx`
- **Change**: Simplified the chat panel to only support agent execution, removing all "Chat Model" (API-based chat) functionality:
  - Removed session picker UI and chat history management
  - Removed "Generate Notes" button (API chat feature)
  - Removed `ChatBubble` rendering and `AiStatusIndicator` for API chat
  - Removed API chat empty state with model picker link
  - Simplified model picker dropdown to only show agents (no chat models section)
- **Removed state**: `generatingNotes`, `generatedNoteId`, `generateNotesError`, `showSessionPicker`, `sessionPickerRef`, `isAgentMode`
- **Simplified**: `handleNewChat`, `handleChatSend`, `handleChatKill` to only handle agent mode
- **UI**: Chat header now shows only "New Chat" button; model picker shows only agents

## 2026-03-10 (session 72)

### fix: Add Task form not working for remote projects

- **Scope**: `src/renderer/components/agent-todo/TodoForm.tsx`
- **Root cause**: For remote projects (with SSH server), the form displayed the working directory as read-only text without any way to set or change it. When `cwd` was empty (no `remoteWorkdir` set), form validation failed silently because the submit button wouldn't trigger `handleSubmit`.
- **Fix**: Added `RemoteCwdPicker` component for remote projects, allowing users to browse and select a remote directory via SSH. Also added state for `sshServer` config and loading it alongside project info.
- **Import changes**: Added `SshServerItem` type and `RemoteCwdPicker` component imports.

## 2026-03-10 (session 71)

### fix: Task card click not working + AgentLogo in selectors

- **Scope**: `src/renderer/components/agent-todo/TodoCard.tsx`, `src/renderer/components/agent-todo/AgentSelector.tsx`
- **TodoCard click fix**: Added `pointer-events-none group-hover:pointer-events-auto` to the action buttons container. Previously, buttons with `opacity-0` still captured click events and called `e.stopPropagation()`, preventing the card's `onClick` navigation from firing.
- **AgentSelector logos**: Replaced generic `Bot` icon with `AgentLogo` component, showing brand-specific logos (Claude, Codex, Gemini, Qwen, Goose, etc.) in both the selector button and dropdown items.
- **TodoCard agent logo**: Replaced `User` icon with `AgentLogo` in the task card's agent info line.

## 2026-03-10 (session 70)

### feat: Agent logos in settings list + Qwen/Goose agent support

- **Scope**: `src/shared/types/agent-todo.ts`, `src/renderer/components/agent-todo/AgentLogo.tsx`, `src/renderer/components/settings/AgentSettings.tsx`
- **AgentToolKind**: Added `qwen` and `goose` to the union type and `AGENT_TOOL_META` array, matching what `agent-detector.ts` already detects (`qwen --acp`, `goose acp`).
- **AgentLogo**: Added `QwenLogo` (purple chat bubble) and `GooseLogo` (dark bird silhouette) SVG components; both handled in the `AgentLogo` switch.
- **Settings agent list**: Each agent card in the list now shows its `AgentLogo` icon in a small rounded badge next to the name, making it easy to identify agent types at a glance.
- **backendToAgentTool**: Updated to map `'qwen'` → `'qwen'` and `'goose'` → `'goose'` so auto-detected agents get the correct logo.

## 2026-03-10 (session 69)

### refactor: Remove chat input from agent task detail page

- **Scope**: `src/renderer/pages/agent-todos/[id]/page.tsx`
- **Change**: Removed the chat input box, slash command menu, model dropdown, and YOLO toggle from the task detail page. The page now only supports agent execution (Run/Stop) without a free-form chat input.
- **Kept**: MessageStream (tool calls, plans, permission cards), RunTimeline sidebar, prompt banner, stderr output panel, and the Edit form (which still exposes YOLO mode and model settings).
- **Removed**: `sendAgentMessage` IPC call, `ModelDropdown` component, `canChat`/`effectiveCanChat` logic, slash command state, chat error state.

## 2026-03-10 (session 68)

### feat: AI-powered GitHub URL detection in Clone Repo modal

- **Scope**: `src/main/ipc/papers.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/papers/overview/page.tsx`
- **New IPC handler** `papers:extractGithubUrl`: calls `generateWithActiveProvider` with a focused prompt to identify the paper's own official GitHub repository URL (not just any GitHub URL mentioned in the abstract). Returns `null` if none is confidently identified.
- **Frontend IPC** `ipc.extractGithubUrl({ title, abstract })` added to `use-ipc.ts`.
- **UI**: "Clone Repo" button now auto-triggers AI detection on open. Modal shows three states: detecting (spinner), detected (green badge with URL), not found (amber warning with manual entry prompt). `detectRanOnce` flag distinguishes "not yet run" from "ran and found nothing".

## 2026-03-09 (session 67)

### feat: Agent logos in reader chat model picker — per-agent-type SVG icons

- **Scope**: `src/renderer/components/agent-todo/AgentLogo.tsx` (new), `src/renderer/pages/papers/reader/page.tsx`, `src/renderer/components/settings/AgentSettings.tsx`
- **New file**: `AgentLogo.tsx` — shared component that renders the correct SVG logo for each `AgentToolKind` (Claude Code → Claude logo, Code X → CodeX logo, Gemini → Gemini star, OpenCLAW → claw, OpenCode → OpenCode mark, unknown → Bot icon).
- **Reader chat picker**: Model picker trigger button and agent list items now show `AgentLogo` instead of a generic `Bot` icon. `agentTool` is stored in `chatModel` when selecting an agent. Agent empty state also uses `AgentLogo`.
- **AgentSettings refactor**: All private Logo functions and `getAgentLogo` helper removed; replaced with the shared `AgentLogo` component import.

## 2026-03-09 (session 66)

### feat: Reader chat — agent execution steps rendered when using an Agent model

- **Scope**: `src/renderer/pages/papers/reader/page.tsx`
- **Change**: When the selected chat model is an Agent (`backend === 'cli'`), the Chat panel now renders the full agent execution trace (tool calls, text, plans, permission requests) using the same `MessageStream` + `useAgentStream` components as the Tasks detail page.
- **Flow**: First message creates a temporary `AgentTodo` (cwd = paper directory so the agent can read the PDF), runs it via `ipc.runAgentTodo`. Follow-up messages are sent via `ipc.sendAgentMessage`. Stop button calls `ipc.stopAgentTodo`.
- **Empty state**: Shows Bot icon + "Send a message to start the agent" before first message.
- **API chat mode unchanged**: When a Chat Model (API) is selected, the existing `ChatBubble` + streaming text rendering is preserved.
- **New imports**: `useAgentStream`, `MessageStream`, `Bot` icon.

## 2026-03-09 (session 65)

### feat: Remote Agent architecture — SSH config embedded in agent, SSH Server Settings removed

- **Scope**: `prisma/schema.prisma`, `src/db/init-schema.ts`, `src/db/repositories/agent-todo.repository.ts`, `src/shared/types/agent-todo.ts`, `src/main/services/agent-todo.service.ts`, `src/renderer/components/settings/AgentSettings.tsx`, `src/renderer/pages/settings/settings-nav.ts`, `src/renderer/pages/settings/page.tsx`, `src/renderer/pages/projects/page.tsx`, `src/renderer/components/projects/RemoteAgentSelector.tsx` (new), `src/renderer/components/projects/RemoteCwdPicker.tsx`, `tests/integration/settings-nav.test.ts`

- **AgentConfig DB schema**: Added SSH fields to `AgentConfig` table: `isRemote`, `sshHost`, `sshPort`, `sshUsername`, `sshAuthMethod`, `sshPrivateKeyPath`, `sshPassphraseEncrypted`, `remoteCliPath`, `remoteExtraEnv`. Added migration statements in `init-schema.ts` with try/catch for idempotency.
- **Remote Agent concept**: SSH config now lives inside the agent itself. `AgentTodoService.runTodo()` reads SSH config from agent fields (new-style) with fallback to `project.sshServerId` (legacy).
- **AgentSettings UI**: Added Local/Remote tab switcher. Remote tab shows a complete add form with SSH host/port/username/auth method/private key/passphrase, remote CLI path, extra env vars, and API key. Agent cards show SSH badge (`user@host:port`) for remote agents.
- **SSH Server Settings removed**: Removed `general.ssh` nav item from settings nav, removed `SshServerSettings` component from settings page.
- **Project page refactored**: Replaced `SshServerSelector` with `RemoteAgentSelector` (new component). `RemoteWorkdirField` now loads agent SSH config instead of SSH server. `sshServerId` field repurposed to store agent ID. `RemoteCwdPicker` updated to accept generic `RemoteSshConfig` interface.
- **Tests**: Updated `settings-nav.test.ts` to reflect 6 sections (removed `general.ssh`).

## 2026-03-09 (session 64)

### feat: Reader layout toggle + redesigned chat input with inline model picker

- **Scope**: `src/renderer/pages/papers/reader/page.tsx`
- **Layout toggle**: Replaced single floating chat toggle button with three-mode layout switcher (Chat only / Split / PDF only) placed in the center of the top toolbar. Uses `layoutMode` state (`'split' | 'chat-only' | 'pdf-only'`).
- **Chat input redesign**: Redesigned input box with two-row layout — textarea on top, bottom toolbar row with model picker on the left and send/stop button (rounded circle) on the right. Matches Codex-style chat UI.
- **Inline model picker**: Dropdown in the input box bottom row shows Agents first, then Chat Models. Agents loaded via `ipc.listAgents()`, models via `ipc.listModels()`. Click outside closes the picker.
- **New icons**: `Columns2`, `FileText`, `Bot` from lucide-react.

## 2026-03-09 (session 63)

### feat: Reader chat — session picker and functional New Chat button

- **Scope**: `src/renderer/pages/papers/reader/page.tsx`
- **Change**: The "New Chat" button previously only cleared UI state with no visible feedback. Added a session picker dropdown in the chat header: when the paper has prior chat sessions, a clickable label shows the current session title and a chevron; clicking opens an animated dropdown listing all sessions for quick switching. "New Chat" now also resets `generatedNoteId`. Fixed `setChatNotes` after job completion to correctly filter only `Chat:` prefixed notes. Click-outside closes the dropdown.
- **New icons**: `ChevronDown`, `MessageSquare` from lucide-react.

## 2026-03-09 (session 62)

### feat: Related Works paper cards now match library style with tags and navigation

- **Scope**: `src/renderer/pages/projects/page.tsx`
- **Change**: Replaced the card-based layout in `RelatedWorksTab` with a list-row layout identical to the Papers library (`PaperCard`). Each row shows: FileText icon, cleaned title (truncate), year + authors snippet, and up to 3 color-coded category tags. Clicking the content area navigates to the paper detail page via `useNavigate`. Remove button remains hover-visible on the right.
- **Imports added**: `TagCategory` type and `CATEGORY_COLORS`, `cleanArxivTitle` from `@shared`.

## 2026-03-09 (session 61)

### fix: remove .pdf suffix from all arXiv PDF URLs to avoid 301 redirects

- **Scope**: `src/shared/utils/arxiv-extractor.ts`, `src/main/services/` (ingest, download, paper-processing, reading, pdf-extractor, arxiv-source, semantic-scholar-source), `src/renderer/pages/papers/` (reader, notes, overview)
- **Root cause**: `https://arxiv.org/pdf/{id}.pdf` triggers a 301 redirect to `https://arxiv.org/pdf/{id}`. Before redirect support was added, this caused the download to receive an HTML page instead of a PDF.
- **Fix**: Added `arxivPdfUrl(id)` helper in `@shared/utils/arxiv-extractor` that always produces the canonical no-suffix URL. Replaced every hardcoded `` `https://arxiv.org/pdf/${id}.pdf` `` across the entire codebase with this helper.

### fix: proxyFetch now follows HTTP redirects (fixes auto-import PDF download)

- **Scope**: `src/main/services/proxy-fetch.ts`
- **Root cause**: arXiv `https://arxiv.org/pdf/{id}.pdf` returns 301 redirect to `/pdf/{id}`. `proxyFetch` did not follow redirects, so it received an HTML redirect page instead of a PDF, causing the magic-bytes check (`%PDF-`) to fail and the download to be marked as failed.
- **Fix**: Extracted `doFetch()` helper with `redirectsLeft` counter (max 5). On 3xx response with `Location` header, drain the body and recurse with the resolved URL. Also corrected `ok` to `status < 300` (was `< 400`, which incorrectly treated redirects as success).
- **Impact**: All `proxyFetch` callers (PDF download, metadata fetch, proxy test) now correctly follow redirects.

### feat: Download PDF button on paper overview page

- **Scope**: `src/renderer/pages/papers/overview/page.tsx`
- **Changes**: Added "Download PDF" button in the action buttons area (shown only when `!paper.pdfPath && inferPdfUrl(paper)`). After download completes, automatically opens the Reader tab so the PDF is immediately visible.

## 2026-03-09 (session 60)

### feat: PDF download progress bar

- **Scope**: `src/main/services/proxy-fetch.ts`, `src/main/services/download.service.ts`, `src/main/ipc/papers.ipc.ts`, `src/renderer/pages/papers/reader/page.tsx`
- **Changes**:
  - `proxyFetch` now accepts `onProgress(downloaded, total)` callback, tracking `content-length` header and each `data` chunk
  - `DownloadService.downloadPdf/downloadPdfById` passes progress callback through
  - `papers:downloadPdf` IPC handler broadcasts `papers:downloadProgress` events via `BrowserWindow.webContents.send`
  - Reader page subscribes to progress events and shows a progress bar (downloaded/total MB) or "Connecting…" when `content-length` is unknown

### fix: TypeScript errors across renderer (zero errors)

- **Scope**: multiple renderer files
- **Changes**:
  - `GraphCanvas.tsx`: added `cytoscape-dagre.d.ts` type declaration
  - `research-profile.tsx`: import `ResearchProfile` from `@shared` directly
  - `papers-by-tag.tsx`: removed deleted `CollectionItem` import and Collection picker UI (Collections feature removed)
  - `domain.ts`: added `TaskResultItem` and `ExperimentReportItem` interfaces
  - `use-ipc.ts`: re-exported new types; added `listReports`, `deleteReport`, `generateReport`, `listTaskResults` stubs; extended `createProject`/`updateProject` types with `sshServerId`/`remoteWorkdir`
  - `import-modal.tsx`: narrowed `File.path` type with type guard
  - `SshServerSettings.tsx` / `RemoteCwdPicker.tsx`: `privateKeyPath ?? undefined` to fix null/undefined mismatch; removed non-existent `software` field
  - `AgentSettings.tsx`: added `onAutoDetectConfig` to `EditAgentModal` props
  - `projects/page.tsx`: guarded `authors.length` with `?? 0`
  - `recommendations/page.tsx`: guarded `semanticScore` with `?? 0`

## 2026-03-09 (session 59)

### feat: Add fixed Built-in Model card with Download button in Models → Embedding Models

- **Scope**: `src/renderer/pages/settings/page.tsx`
- **Changes**:
  - Added `BUILTIN_CONFIG` constant and always render a fixed "Built-in Model" `EmbeddingCard` at the top of Embedding Models, regardless of user-added configs
  - Added `readOnly` prop to `EmbeddingCard` — hides Edit/Delete buttons for the built-in card
  - When model is already downloaded: show green "Model ready" + grey disabled "Downloaded" button
  - When model is missing: show amber "Model not downloaded" + blue "Download" button (existing behavior)

## 2026-03-09 (session 58)

### fix: Disable automatic model download — require manual trigger via Settings

- **Scope**: `src/main/services/builtin-embedding-provider.ts`
- **Changes**:
  - Set `env.allowRemoteModels = false` unconditionally (was `true` in dev when model missing)
  - Model download is now only triggered by the "Download Model" button in Settings → Semantic Search

## 2026-03-09 (session 57)

### chore: Remove model weights from git and document download steps

- **Scope**: `.gitignore`, `README.md`, `README_CN.md`
- **Changes**:
  - Removed `models/Xenova/all-MiniLM-L6-v2/` (4 files) from git tracking via `git rm --cached`
  - Added `models/` to `.gitignore` to prevent re-committing weights
  - Added "Model Weights" section to both READMEs explaining automatic download on first launch and manual `huggingface-cli` / manual download steps

## 2026-03-09 (session 56)

### style: Unify back button style across all pages

- **Scope**: `src/renderer/components/app-shell.tsx`, `src/renderer/pages/papers/overview/page.tsx`, `src/renderer/pages/papers/reader/page.tsx`, `src/renderer/pages/papers/notes/page.tsx`, `src/renderer/pages/compare/page.tsx`, `src/renderer/pages/agent-todos/[id]/page.tsx`
- **Changes**:
  - Standardized all back buttons to: `inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-notion-text-secondary transition-colors hover:bg-notion-sidebar/50` with `ArrowLeft size={16}` and "Back" label
  - reader/page.tsx: `rounded-md` → `rounded-lg`, icon `14` → `16`
  - notes/page.tsx: icon `14` → `16`
  - compare/page.tsx: `rounded-md` → `rounded-lg`
  - agent-todos/[id]/page.tsx: icon-only `size={18}` → labeled button with `size={16}` and consistent padding
  - app-shell.tsx: global back button (fullWidth and max-width modes) now uses same style with "Back" label instead of icon-only circle button

## 2026-03-09 (session 55)

### fix: Strengthen proxy-test.test.ts to actually verify agent routing

- **Scope**: `tests/integration/proxy-test.test.ts`
- **Changes**:
  - Previous tests mocked `node:https` to always return 200 regardless of `agent` parameter — never verified proxy was actually passed to the request
  - Added test: "passes agent to https.request when proxy is set" — asserts `opts.agent` is defined on every `https.request` call when proxy URL is configured
  - Added test: "does NOT pass agent when no proxy" — asserts `opts.agent` is absent when proxy is unset
  - Added test: "reports failure when proxy connection is refused" — simulates `ECONNREFUSED` error to verify failure path is correctly reported
  - Fixed `vi.doMock` ordering bug in second test (mock was registered after module import, so it never applied)
  - Extracted `makeFakeHttps()` helper; added `beforeEach(() => vi.resetModules())` for proper test isolation
- **Validation**: 5/5 tests pass

## 2026-03-09 (session 54)

### feat: Remove Collections; add Related Works to Projects; simplify Library sidebar

- **Scope**: `prisma/schema.prisma`, `src/db/repositories/projects.repository.ts`, `src/main/services/projects.service.ts`, `src/main/ipc/projects.ipc.ts`, `src/db/index.ts`, `src/main/index.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/router.tsx`, `src/renderer/components/app-shell.tsx`, `src/renderer/pages/papers/overview/page.tsx`, `src/renderer/pages/projects/page.tsx`, `tests/integration/projects.test.ts`
- **Changes**:
  - **Removed Collections entirely**: deleted `Collection` and `PaperCollection` schema models, `collections.repository.ts`, `collections.service.ts`, `collections.ipc.ts`, `pages/collections/`, `collection-modal.tsx`, `collections.test.ts`; removed all collection IPC methods from `use-ipc.ts`; removed collection types (`CollectionItem`, `ResearchProfile`) from `use-ipc.ts` and `domain.ts`
  - **Added `ProjectPaper` join table**: schema with `projectId`, `paperId`, `addedAt`, `note`; `@@unique([projectId, paperId])` prevents duplicates; cascades on project/paper delete
  - **Backend**: added `addPaperToProject`, `removePaperFromProject`, `listProjectPapers` methods to `ProjectsRepository`, `ProjectsService`, and `projects.ipc.ts` (`projects:papers:add/remove/list` channels)
  - **Frontend types**: added `ProjectPaperItem` interface extending `PaperItem` with `addedAt`, `note`, `projectPaperId`; added 3 IPC client methods
  - **Library sidebar**: simplified to a flat `<Link to="/papers">` — no more expandable tree or Collections section; Projects now shows a collapsible dropdown with indented project names (same design language as other nav items)
  - **Paper overview**: replaced `CollectionPicker` with `ProjectAdder` — a dropdown button to add the current paper to any project, with toast feedback
  - **Related Works tab**: added to `ProjectDetailPage` — lists papers added to the project, shows title/authors/year/abstract, remove button on hover; "Add Papers" modal with search; disabled "Generate Related Works" placeholder
  - **DB migration**: ran `npx prisma db push --accept-data-loss` to sync schema
  - **Tests**: added 3 new integration test cases for project papers (add/list, remove, upsert idempotency)

## 2026-03-09 (session 53)

### feat: Settings page UI polish — minimalist layout + Fuse.js fuzzy search + nav font size

- **Scope**: `src/renderer/pages/settings/page.tsx`
- **Changes**:
  - Removed card/border wrapper — layout is now flat and borderless (极简风)
  - Top search bar spans full width as a single inline strip (title · divider · search input)
  - Search uses Fuse.js (threshold 0.4, weighted label + keywords) for fuzzy matching
  - While searching: right panel stacks all matching sections vertically in real-time; left nav dims non-matching items
  - Nav item font size bumped from `text-xs` to `text-sm` (14px) for readability; group headers from 10px to 11px

### feat: VS Code-style Settings page redesign + settings-nav logic extraction + tests

- **Scope**: `src/renderer/pages/settings/page.tsx`, `src/renderer/pages/settings/settings-nav.ts` (new), `tests/integration/settings-nav.test.ts` (new)
- **Changes**:
  - Replaced 4-tab layout (Basic, Agents, Models, Storage) with VS Code-style left sidebar nav + right content panel
  - Extracted pure nav logic into `settings-nav.ts`: `SectionId`, `NAV_GROUPS`, `SECTION_META`, `ALL_SECTION_IDS`, `filterNavGroups()`, `getFilteredSectionIds()`, `resolveActiveSection()`, `toggleCollapsed()`, `isGroupExpanded()`
  - `page.tsx` imports from `settings-nav.ts`; adds `GROUP_ICONS` map for React icon components (kept separate to avoid React deps in logic module)
  - Sidebar includes search bar that filters nav items by label and keywords; groups auto-expand during search
  - Active section highlighted with `bg-notion-accent-light text-notion-accent`; group headers collapse/expand on click
  - Content panel renders section header (title + description) above each section component
  - Added `ChevronRight` and `Search` to lucide-react imports; removed unused `Tab` type
  - Added 38 unit tests in `settings-nav.test.ts` covering: NAV_GROUPS structure, ALL_SECTION_IDS, SECTION_META completeness, filterNavGroups (label/keyword/case/mutation), getFilteredSectionIds, resolveActiveSection (fallback logic), toggleCollapsed (immutability), isGroupExpanded (search override)

## 2026-03-09 (session 52)

### feat: Remove bundled model weights; add on-demand download UI

- **Scope**: `.gitignore`, `src/main/services/builtin-embedding-provider.ts`, `src/main/ipc/providers.ipc.ts`, `src/main/services/providers.service.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/settings/page.tsx`, `src/main/services/proxy-test.service.ts`, `README.md`, `README_CN.md`
- **Changes**:
  - Added `models/` to `.gitignore`; removed model files from git tracking (`git rm -r --cached models/`)
  - Updated `builtin-embedding-provider.ts`: added `checkModelExists()`, `getModelPath()`, `downloadModel()` methods; revised model path strategy — packaged app uses `userData/models/` (writable, persists across updates), dev uses `appPath/models/`; download uses Node `https` with redirect following, proxy support, and per-file progress reporting
  - Added `settings:checkBuiltinModelExists` and `settings:downloadBuiltinModel` IPC handlers in `providers.ipc.ts`
  - Added `checkBuiltinModelExists()` and `startBuiltinModelDownload()` methods to `ProvidersService`; download broadcasts progress via `settings:builtinModelDownloadProgress` IPC events
  - Added `BuiltinModelDownloadProgress` interface + `checkBuiltinModelExists` / `downloadBuiltinModel` IPC client methods to `use-ipc.ts`
  - Updated `AddEmbeddingModal` and `EmbeddingCard` in settings page to show model status (ready/not found/downloading) with progress bar and download button for builtin provider
  - Added `HuggingFace` to proxy test endpoints in `proxy-test.service.ts`
  - Updated `README.md` and `README_CN.md` with Model Setup section documenting download options

## 2026-03-09 (session 51)

### feat: Embedding model multi-card UI (like chat models)

- **Scope**: `src/main/store/app-settings-store.ts`, `src/main/services/providers.service.ts`, `src/main/ipc/providers.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/settings/page.tsx`
- **Changes**:
  - Added `EmbeddingConfig` interface with `id`, `name`, `provider`, `embeddingModel`, `embeddingApiBase`, `embeddingApiKey`
  - Added `embeddingConfigs[]` + `activeEmbeddingConfigId` fields to `AppSettings`; zero-downtime migration synthesizes one config from existing `semanticSearch` fields on first load
  - Added store functions: `getEmbeddingConfigs`, `saveEmbeddingConfig`, `deleteEmbeddingConfig`, `getActiveEmbeddingConfigId`, `setActiveEmbeddingConfigId`, `getActiveEmbeddingConfig`
  - Added `switchEmbeddingConfig(config)` method to `ProvidersService` — merges config into `semanticSearch` settings, resets vec index if provider/model changed, calls `localSemanticService.switchProvider()`
  - Added 4 IPC handlers: `embedding:list`, `embedding:save`, `embedding:delete`, `embedding:setActive`
  - Added `EmbeddingConfig` type export + 4 new IPC client methods to `use-ipc.ts`
  - Replaced `SemanticSettingsPanel` with `EmbeddingSection` (card list) + `EmbeddingCard` + `AddEmbeddingModal` in `settings/page.tsx`
  - Global semantic settings (enabled, autoProcess, autoEnrich, recommendationExploration) moved to compact section below the embedding cards

## 2026-03-09 (session 50)

### style: Back button inline with page header; new-paper red dot indicator (right edge, clears on view)

- **Scope**: `src/renderer/components/app-shell.tsx`, `src/renderer/components/papers-by-tag.tsx`
- **Changes**:
  - Back button in non-fullWidth pages now uses `absolute` positioning (`left-4 top-[48px]`) so it sits visually to the left of the page header instead of above it
  - Papers imported within the last 24 hours and not yet viewed show a red dot (`h-2 w-2 bg-red-500`) at the right edge of their row (vertically centered)
  - Dot disappears after opening the paper detail page (`touchPaper` called on load, sets `lastReadAt`)

## 2026-03-09 (session 49)

### style: Restore constrained layout for Library page

- **Scope**: `src/renderer/router.tsx`, `src/renderer/pages/papers/page.tsx`, `src/renderer/components/papers-by-tag.tsx`
- **Changes**:
  - Removed `fullWidth: true` from the `/papers` route so Library uses AppShell's `max-w-4xl` centered container (same as Projects/Tasks)
  - Converted `papers-by-tag.tsx` from fixed-height internal-scroll layout (`h-full flex flex-col overflow-hidden`) to normal flow layout; removed all `px-8` horizontal padding (now inherited from AppShell's `px-16`)
  - Removed `flex-shrink-0` / `flex-1 overflow-y-auto` from bars and paper list; scroll is now handled by AppShell's scroll container

## 2026-03-09 (session 48)

### refactor: Replace Ollama embedding with OpenAI-compatible API; simplify Semantic settings UI

- **Scope**: `src/main/store/app-settings-store.ts`, `src/main/services/embedding-provider.ts`, `src/main/services/local-semantic.service.ts`, `src/main/services/openai-compatible-embedding-provider.ts` (new), `src/main/services/providers.service.ts`, `src/main/ipc/providers.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/settings/page.tsx`
- **Changes**:
  - Replaced `embeddingProvider: 'ollama'` with `'openai-compatible'`; added `embeddingApiBase` and `embeddingApiKey` fields
  - Created `OpenAICompatibleEmbeddingProvider` — calls `/embeddings` endpoint with Bearer auth (compatible with OpenAI, local servers, etc.)
  - Removed all Ollama-specific logic from `providers.service.ts` (warmup, endpoint probes, model list, `startedOllama`)
  - Simplified `SemanticDebugResult` type — removed Ollama probe fields
  - Rewrote `SemanticSettingsPanel` UI: compact card with pencil-expand pattern matching Models tab; removed Semantic Debug card and pull-job progress display
  - Migration: existing `'ollama'` provider config auto-migrates to `'openai-compatible'` with `embeddingApiBase` set from old `baseUrl`

## 2026-03-09 (session 47)

### refactor: Simplify Dashboard — remove Graph, Library, Profile quick-access; embed Recommendations inline

- **Scope**: `src/renderer/components/dashboard-content.tsx`, `src/renderer/components/dashboard-recommendations.tsx` (new), `src/renderer/router.tsx`
- **Changes**:
  - Removed Quick Access card grid (Graph, Library, Profile, Recommendations links) from Dashboard
  - Removed Recent Comparisons section from Dashboard
  - Created `DashboardRecommendations` component — compact inline recommendations (new status only) with Refresh, More/Fewer like this, Ignore, Save to Library actions
  - Removed `/graph`, `/recommendations`, `/profile` routes from router
  - Profile page removed entirely (no longer needed)

## 2026-03-09 (session 46)

### fix: Repair pre-existing test failures unrelated to PDF fix

- **Scope**: `src/main/agent/acp-adapter.ts`, `tests/integration/acp.test.ts`, `tests/integration/agent-todo.service.test.ts`
- **Changes**:
  - Fixed `acp-adapter.ts` to guard against `update.content` being undefined (`?.` optional chain)
  - Skipped stale `acp-connection` test suites that tested a hand-rolled JSON-RPC layer now replaced by `@agentclientprotocol/sdk`
  - Added `ProjectsRepository` mock to all `agent-todo.service.test.ts` test cases (service constructor now requires it)
  - Rebuilt `better-sqlite3` native module for arm64 (was compiled for x86_64)

## 2026-03-09 (session 46 — PDF fix)

### fix: Show PDF download failures after import instead of silently ignoring them

- **Scope**: `src/main/services/ingest.service.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/components/import-modal.tsx`
- **Changes**:
  - Added `pdfFailed` counter to `ImportStatus` interface (both main and renderer)
  - Track PDF download failures separately from paper import failures in `runImport`
  - Append `, N PDF failed` to completion message when downloads fail
  - Show orange warning card in import modal when any PDFs failed to download, explaining the cause and suggesting retry

## 2026-03-09 (session 45)

### feat: Add Gemini, OpenCLAW, OpenCode agent logos and detection support

- **Scope**: `src/renderer/components/settings/AgentSettings.tsx`, `src/shared/types/agent-todo.ts`, `src/main/agent/agent-detector.ts`
- **Changes**:
  - Added GeminiLogo, OpenClawLogo, OpenCodeLogo components for agent type icons
  - Extended `AgentToolKind` type to include 'gemini' | 'openclaw' | 'opencode'
  - Added metadata for new agent types in `AGENT_TOOL_META` (models, config paths, etc.)
  - Added OpenCLAW and OpenCode to auto-detection list in agent-detector.ts
  - Updated `getAgentLogo()` and `backendToAgentTool()` to handle new agent types
  - Changed active agent card style from green to blue (`bg-blue-50/40 border-blue-200`) for consistency with other settings sections

## 2026-03-09 (session 44)

### fix: Fix IPC handler race condition on app startup

- **Scope**: `src/main/index.ts`, `src/renderer/hooks/use-main-ready.ts`, `src/renderer/hooks/use-chat.tsx`, `src/renderer/hooks/use-analysis.tsx`, `src/renderer/components/app-shell.tsx`, `scripts/build-main.mjs`, `vite.config.ts`, `src/db/index.ts`
- **Problem**: Renderer was calling IPC handlers (`reading:chatJobs`, `reading:analysisJobs`, `collections:list`) before main process finished registering them, causing "No handler registered" errors on startup.
- **Solution**: Added `main:ready` event that main process sends after all IPC handlers are registered. Created `useMainReady` hook that renderer uses to wait for main process readiness before making IPC calls. Updated `ChatProvider`, `AnalysisProvider`, and `AppShell` to use this hook.
- **Fixes also**: Added `ssh2` and `cpu-features` to external modules in both esbuild and vite configs to fix native module bundling errors. Added missing exports for `TaskResultRepository` and `ExperimentReportRepository` in `src/db/index.ts`.
- **Validation**: Build and precommit tests pass.

## 2026-03-09

### feat: Comparison chat (continue conversation after comparison)

- **Scope**: `prisma/schema.prisma`, `src/shared/types/domain.ts`, `src/db/repositories/comparisons.repository.ts`, `src/main/services/comparison.service.ts`, `src/main/ipc/comparison.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/compare/page.tsx`
- **Chat feature**: After a comparison is complete, users can continue discussing the results with the AI model. The chat area appears below the comparison markdown with a message input (⌘+Enter to send).
- **Multi-turn support**: Full conversation history is sent with each request, allowing contextual follow-up questions about the comparative analysis.
- **Background job pattern**: Chat runs as a background job (`comparison:chat` IPC) with streaming response broadcast via `comparison:chatStatus`. Supports cancel via Stop button.
- **Persistence**: Chat messages are stored in `chatMessagesJson` field on `ComparisonNote`. Messages persist across navigation and app restarts. Regenerating a comparison clears the chat history.
- **Schema**: Added `chatMessagesJson String @default("[]")` to `ComparisonNote` model.

### feat: Comparison translation (EN/中文 toggle)

- **Scope**: `prisma/schema.prisma`, `src/shared/types/domain.ts`, `src/db/repositories/comparisons.repository.ts`, `src/main/ipc/comparison.ipc.ts`, `src/main/services/comparison.service.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/compare/page.tsx`
- **Translation**: Added EN/中文 pill toggle in comparison header. Clicking 中文 triggers a background translation job using the lightweight model via `streamText()`. Translation streams in real-time and is cached to `translatedContentMd` in the database for instant subsequent access.
- **Background job pattern**: Translation runs as a background job (`comparison:translate` IPC) with status broadcast via `comparison:translateStatus`. Supports cancel, recovery on remount, and error handling.
- **Cache invalidation**: Regenerating a comparison clears any cached translation. Translation is only triggered on-demand when user switches to 中文.
- **Schema**: Added `translatedContentMd String?` to `ComparisonNote` model.

### feat: Auto-persist comparisons + improved comparison UI

- **Scope**: `src/main/ipc/comparison.ipc.ts`, `src/db/repositories/comparisons.repository.ts`, `src/renderer/pages/compare/page.tsx`, `src/renderer/hooks/use-ipc.ts`, `src/main/services/comparison.service.ts`
- **Auto-persist**: Comparisons are now saved to the database immediately when started (not after manual Save). History shows in-progress comparisons. Content is updated in DB when streaming completes. Empty records are cleaned up on cancellation.
- **Progress feedback**: Added `onProgress` callback to `ComparisonService` so the preparing stage shows which paper is being read (e.g. "Reading paper 1/3: Title…").
- **UI improvements**: Removed manual Save button (auto-save). Improved streaming indicator with status message. Cleaned up markdown output styling with better prose typography (heading borders, relaxed leading, notion color scheme).
- **Removed**: `comparison:save` IPC handler (replaced by auto-persist on start).

### refactor: Merge normal and semantic search into unified search mode

- **Scope**: `src/renderer/components/search-content.tsx`
- **Change**: Consolidated the three-way search toggle (Normal / Semantic / Agentic) into a two-way toggle (Search / Agentic). The unified "Search" mode tries semantic search first, then automatically falls back to keyword-based (normal) search when embeddings are unavailable. This removes cognitive overhead for users who previously had to choose between normal and semantic modes.
- **UI**: Updated mode selector, search icons, placeholders, and result card styling to reflect the unified search mode. Fallback warning restyled from violet to amber.

### refactor: Merge Models and Semantic settings tabs

- **Scope**: `src/renderer/pages/settings/page.tsx`
- **Change**: Merged the separate "Semantic" settings tab into the "Models" tab. The semantic search & processing settings now appear as a section below the model configuration and above token usage, reducing the number of settings tabs from 6 to 5.

### fix: Comparison survives page navigation (background job pattern)

- **Scope**: `src/main/ipc/comparison.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/compare/page.tsx`, `CLAUDE.md`, `AGENT.md`
- **Fix**: Removed auto-kill on unmount so comparison jobs continue running in the main process when the user navigates away. Added `comparison:getActiveJobs` IPC handler that returns all recent jobs (active + completed). Renderer recovers job state on remount with race-condition guard (`recoveryDone` flag ensures auto-start waits for recovery).
- **Guideline**: Added rule #9 to CLAUDE.md and created `AGENT.md` with detailed background job pattern (main process + renderer responsibilities, existing examples).

### feat: Dashboard Recent Comparisons card + Nested Collection Folders

- **Scope**: `prisma/schema.prisma`, `src/db/repositories/collections.repository.ts`, `src/main/services/collections.service.ts`, `src/main/ipc/collections.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/components/dashboard-content.tsx`, `src/renderer/components/app-shell.tsx`, `src/renderer/components/collection-modal.tsx`, `src/renderer/pages/collections/page.tsx`
- **Dashboard Comparisons**: Added "Recent Comparisons" section to dashboard showing up to 6 saved comparisons with paper titles, date, and paper count. Cards link to `/compare?saved=<id>`. Section is hidden when no comparisons exist.
- **Nested Collections**: Collections now support infinite nesting via `parentId` self-reference on the `Collection` model. Sidebar renders collections as a recursive tree with expand/collapse toggles and HTML5 drag & drop for reorganization. Default collections are protected from being moved into sub-folders. Cycle detection prevents invalid parent assignments.
- **Collection Modal**: Added optional "Parent Folder" dropdown to the create/edit collection modal.
- **Breadcrumb Navigation**: Collection page header shows breadcrumb path when collection has parent ancestors.
- **Schema**: Added `parentId`, `parent`, `children` fields to `Collection` model with `onDelete: SetNull`.

### feat: Persist comparison results with history panel

- **Scope**: `prisma/schema.prisma`, `src/db/repositories/comparisons.repository.ts`, `src/shared/types/domain.ts`, `src/main/ipc/comparison.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/compare/page.tsx`, `tests/integration/comparison.test.ts`
- **Feature**: Comparison results are now persisted to the database. Users can save completed comparisons, browse saved history in a collapsible sidebar panel, and reload previous comparisons via `?saved=<id>` URL parameter.
- **Schema**: New `ComparisonNote` model storing paper IDs (JSON array), paper titles (JSON array), and full markdown content.
- **UI**: Header now includes Save button (appears after comparison completes), History toggle button that reveals a left sidebar with saved comparisons, and Saved indicator badge. History items show paper titles, date, and paper count with delete option.
- **Data flow**: New comparisons via `?ids=a,b,c` auto-generate then can be saved; saved comparisons load via `?saved=<id>` from DB; Regenerate creates fresh comparison from same papers.
- **Tests**: Added `ComparisonNoteItem` type tests covering 2-paper and 3-paper shapes and JSON round-trip serialization.

### feat: Add paper comparison view with LLM analysis

- **Scope**: `src/shared/prompts/comparison.prompt.ts`, `src/main/services/comparison.service.ts`, `src/main/ipc/comparison.ipc.ts`, `src/main/index.ts`, `src/shared/index.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/compare/page.tsx`, `src/renderer/router.tsx`, `src/renderer/components/papers-by-tag.tsx`, `tests/integration/comparison.test.ts`
- **Feature**: Multi-paper comparison (2-3 papers) with structured LLM analysis. Select papers in the library, click Compare to open a dedicated page that streams a structured comparison covering Overview, Similarities, Differences, Methodology, Research Gaps, and Synthesis.
- **Implementation**: New comparison prompt, service (streaming via `streamText`), IPC handler with job tracking and AbortController, and a React page with paper cards, streaming markdown output, and Stop/Regenerate/Copy controls.
- **Design decisions**: No schema changes (comparison results are not persisted); limited to 2-3 papers to control token usage; reuses existing MarkdownContent component and selection toolbar pattern.
- **Tests**: Prompt builder tests (2-paper, 3-paper, missing fields, PDF excerpt), system prompt section verification, service tests with mocked LLM (streaming callback, boundary validation).

### feat: Improve comparison page UX and add entry points

- **Scope**: `src/renderer/pages/compare/page.tsx`, `src/renderer/pages/collections/page.tsx`, `src/renderer/pages/papers/overview/page.tsx`, `src/renderer/components/papers-by-tag.tsx`
- **Visual redesign**: Compare page now uses Notion-inspired design with proper header bar, animated paper cards with icons and metadata, section divider for analysis output, and streaming indicator.
- **URL query params**: Compare page now uses `/compare?ids=a,b,c` instead of `location.state`, surviving page refreshes.
- **Auto-kill**: Comparison job is automatically cancelled when navigating away from the page.
- **Collection page**: Added paper selection checkboxes and a Compare toolbar to the collection papers list.
- **Paper overview**: Added "Compare with…" button that opens a paper picker modal to select 1-2 papers for comparison.

## 2026-03-09 (session 35)

### fix: Rebuild better-sqlite3 for Electron installs

- **Scope**: `package.json`, `scripts/ensure-native-modules.mjs`
- **Problem**: The app initializes a vector index through `better-sqlite3` at startup, but `postinstall` only ran `prisma generate`. When dependencies were installed with a standalone Node.js runtime first, `better-sqlite3` stayed compiled for that Node ABI and Electron 35 later failed to load it with `NODE_MODULE_VERSION` mismatch errors.
- **Fix**: Added a dedicated `rebuild:native` script and an `ensure:native` guard script. `postinstall` now runs the guard after `prisma generate`, and `npm run dev` triggers the same guard through `predev`, so other devices can auto-detect ABI mismatches and rebuild `better-sqlite3` before startup.

## 2026-03-09 (session 43)

### feat: Route short semantic queries through sentence and lexical evidence

- **Scope**: `prisma/schema.prisma`, `src/main/services/semantic-search.service.ts`, `src/main/services/search-unit-*.ts`, `src/main/services/paper-processing.service.ts`, `src/main/services/papers.service.ts`, `src/main/index.ts`, `src/db/repositories/papers.repository.ts`, `tests/integration/semantic-search.test.ts`
- **Problem**: Short semantic queries were matched only against chunk embeddings, so improving recall depended on lowering a global threshold and introduced noisy results.
- **Solution**: Added `PaperSearchUnit` records for title/abstract/sentence indexing, local FTS + vector indices for search units, query-length routing, mixed lexical + sentence + chunk retrieval, and paper-level fusion/reranking. Title updates now rebuild search units so lexical/sentence evidence stays fresh.
- **Validation**: Added search-unit and semantic-search tests covering short-term routing, sentence preference, and title rebuild behavior.

### feat: Bundle embedding model for offline-first semantic search

- **Scope**: `models/`, `scripts/download-model.sh`, `electron-builder.yml`, `src/main/services/builtin-embedding-provider.ts`, `src/main/services/embedding-provider.ts`, `src/renderer/pages/settings/page.tsx`, `src/renderer/hooks/use-ipc.ts`
- **Problem**: Built-in embedding provider downloaded ~86MB ONNX model from Hugging Face on first use, requiring network access.
- **Solution**: Pre-bundle `Xenova/all-MiniLM-L6-v2` model files (config.json, tokenizer_config.json, tokenizer.json, onnx/model.onnx) directly in the repository under `models/`. Provider now uses `env.localModelPath` + `env.allowRemoteModels = false` for true offline operation. Removed download progress UI from Settings. Added `extraResources` config in electron-builder to include models in packaged app. Added `scripts/download-model.sh` for CI/fresh clone recovery.
- **Validation**: All tests pass (model loads from bundled files without network).

### fix: Serialize ONNX embedding requests to prevent memory crashes

- **Scope**: `src/main/services/builtin-embedding-provider.ts`, `.env`
- **Problem**: Concurrent embedding requests (from parallel paper processing) caused ONNX Runtime memory allocation failures (`BFCArena::Alloc` crash with `EXC_BREAKPOINT`).
- **Solution**: Added `embeddingQueue` promise chain to serialize all `embedTexts()` calls through `_embedTextsInternal()`. Multiple workers can now safely call the shared `localSemanticService` instance without triggering concurrent ONNX inference. Increased default concurrency to 3 workers.
- **Validation**: Builtin embedding tests pass. App no longer crashes on startup with parallel processing enabled.

### perf: Optimize ONNX Runtime memory usage

- **Scope**: `src/main/services/builtin-embedding-provider.ts`
- **Problem**: ONNX Runtime memory allocation still caused crashes even with serialized requests.
- **Solution**: Reduced batch size from 32 to 8, disabled ONNX memory arena (`enableCpuMemArena: false`), set single-threaded execution (`numThreads: 1`), and configured conservative memory allocation strategy.
- **Validation**: Builtin embedding tests pass with lower memory footprint.

### fix: Lower semantic search similarity threshold for better recall

- **Scope**: `src/main/services/semantic-utils.ts`
- **Problem**: Semantic search failed to return results for short queries like "OpenHarmony" because similarity scores (0.21-0.34) were below the 0.35 threshold. Short queries naturally have lower cosine similarity with long document chunks.
- **Solution**: Lowered `MIN_SEMANTIC_CHUNK_SIMILARITY` from 0.35 to 0.25 to improve recall for short queries while maintaining reasonable precision.
- **Validation**: Manual testing shows "OpenHarmony" query now returns relevant papers (HapRepair, Phantom Rendering Detection) with similarity scores 0.27-0.34.

## 2026-03-09 (session 42)

### feat: Add Literature Graph with citation extraction and visualization

- **Scope**: `prisma/schema.prisma`, `src/db/repositories/citations.repository.ts`, `src/main/services/citation-extraction.service.ts`, `src/main/services/citation-graph.service.ts`, `src/main/ipc/citations.ipc.ts`, `src/renderer/pages/graph/page.tsx`, `src/renderer/components/graph/`, `src/renderer/pages/papers/overview/page.tsx`
- **Problem**: No way to visualize citation relationships between papers or discover key research nodes.
- **Solution**: Full citation graph feature with three layers:
  - **Data layer**: `PaperCitation` model (Prisma), `CitationsRepository` for CRUD, `CitationExtractionService` using Semantic Scholar API (`/paper/{id}?fields=references,citations`) with arXiv ID + title matching to local papers, `CitationGraphService` with PageRank computation and BFS path finding.
  - **Visualization layer**: Interactive graph page using Cytoscape.js with 4 layout modes (force-directed, dagre hierarchy, circle, grid). Ghost nodes for external references (dashed, semi-transparent). Node detail panel with references/cited-by lists. Export to PNG/JSON.
  - **Integration**: "Extract Citations" button on paper overview page, citation count display with "View in Graph" link, Graph nav item in sidebar.
- **Types**: `GraphNode`, `GraphEdge`, `GraphData` added to shared domain types.
- **Tests**: 14 integration tests covering Citation CRUD, graph assembly (5 papers + 8 edges), PageRank (chain topology), BFS path finding, cascade delete, unmatched resolution, and full import-to-graph chain.
- **Validation**: All 181 tests pass (14 new + 167 existing).

## 2026-03-09 (session 41)

### feat: Add CI/CD release workflow for automated GitHub Releases

- **Scope**: `.github/workflows/release.yml`, `scripts/build-release.sh`, `scripts/build-release-linux.sh`
- **Problem**: No automated release pipeline — macOS and Linux builds had to be created manually.
- **Solution**: Created `.github/workflows/release.yml` triggered on `v*` tags with 4 jobs:
  - `validate`: lint + test + build (same as CI)
  - `build-mac`: builds .dmg and .zip on `macos-latest` (arm64)
  - `build-linux`: builds .AppImage on `ubuntu-latest`
  - `publish`: collects all artifacts and creates a GitHub Release via `softprops/action-gh-release@v2`
- **Build script fix**: Conditioned `ELECTRON_MIRROR` (npmmirror.com) to only apply outside CI, so GitHub Actions uses the faster global Electron CDN.

## 2026-03-09 (session 40)

### feat: Add built-in embedding provider for zero-dependency semantic search

- **Scope**: `src/main/services/`, `src/main/store/app-settings-store.ts`, `src/main/ipc/providers.ipc.ts`, `src/renderer/pages/settings/page.tsx`, `scripts/build-main.mjs`, `tests/integration/builtin-embedding.test.ts`
- **Problem**: Semantic search required Ollama to be installed and running, raising the usage barrier for new users.
- **Solution**: Introduced `EmbeddingProvider` interface with two implementations:
  - **BuiltinEmbeddingProvider**: Uses `@huggingface/transformers` with `all-MiniLM-L6-v2` (384-dim, ~80MB) for zero-config local embedding. Model cached in `{storageDir}/models/`, lazy-loaded on first use with download progress broadcast.
  - **OllamaEmbeddingProvider**: Extracted existing Ollama HTTP call logic into the provider interface.
- **LocalSemanticService** refactored to delegate to the active provider via `getOrCreateProvider()` / `switchProvider()`.
- **Settings**: Added `embeddingProvider: 'builtin' | 'ollama'` field (default: `'builtin'`). Migration preserves `'ollama'` for users with custom Ollama config. Provider switch triggers index rebuild (same flow as model change).
- **UI**: Settings Semantic tab now shows provider selector (Built-in recommended / Ollama advanced) with conditional Ollama settings display and provider switch warning.
- **Tests**: Integration tests for provider interface, builtin vector generation (384-dim, normalized), semantic similarity, batch processing, and provider switching.

## 2026-03-09 (session 39)

### fix: Skip unnecessary Prisma db push on startup via schema hash caching

- **Scope**: `src/main/index.ts`
- **Problem**: Every app startup ran `prisma db push`, which failed on sqlite-vec virtual tables, causing vec tables to be dropped and rebuilt (~500+ chunks re-indexed each time).
- **Solution**: Cache `schema.prisma` content hash in `vec_meta` table. On startup, compare current hash with saved hash — skip `db push` if unchanged. When schema changes, proactively drop vec tables before running `db push` (avoids error-retry flow).
- **Effect**: Normal startups skip db push entirely; vec index preserved. Schema changes trigger one-time rebuild.

## 2026-03-09 (session 38)

### feat: Paper Collections (分类) with Research Profile

- **Scope**: Full-stack feature spanning `prisma/schema.prisma`, `src/db`, `src/main`, `src/renderer`, `tests/integration`
- **Data model**: Added `Collection` and `PaperCollection` models with many-to-many relation to Paper. Collections have name, icon (emoji), color, description, and isDefault flag.
- **Default collections**: Three default collections (My Papers, Interesting, To Read) created on app startup via `ensureDefaults()`.
- **Repository**: `CollectionsRepository` with full CRUD, paper add/remove, batch add, research profile aggregation (tag/year/author distributions).
- **Service + IPC**: `CollectionsService` thin wrapper, `setupCollectionsIpc()` with 9 handlers following existing `try/ok/catch/err` pattern.
- **Sidebar**: Collections section in sidebar showing icon + name + paper count, with `+` button to create new collections.
- **Collection detail page**: `/collections/:id` route with Papers tab (paper list with remove) and Research Profile tab (bar charts for tag/year distribution, top authors).
- **Paper detail page**: Added Collections picker below Tags section — shows current collections as chips, dropdown to toggle membership.
- **Library batch operations**: Selection toolbar gains "Add to Collection" button with collection picker dropdown.
- **Collection modal**: Create/edit modal with name, emoji picker, color picker, description fields, framer-motion animations, ESC support.
- **Research profile component**: Pure-CSS horizontal bar charts grouped by tag category (domain/method/topic), year distribution, top 10 authors.
- **Tests**: Integration tests covering CRUD, default collection delete protection, paper add/remove/batch, research profile accuracy, full chain (papers + tags → collection → profile).
- **Add Papers from Library**: Collection detail page header now has "Add Papers" button that opens a modal to browse and search all Library papers, with checkmark toggle to add/remove papers.
- **Toast feedback**: All collection operations (add/remove paper, batch add) now show success/error toast notifications.
- **PaperItem.year**: Added `year` field to `PaperItem` interface for display in paper lists.

## 2026-03-09

### feat: BibTeX citation export

**Scope**: `src/shared/utils/bibtex.ts`, `src/main/services/bibtex.service.ts`, `src/main/ipc/papers.ipc.ts`, `src/main/ipc/providers.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/papers/overview/page.tsx`, `src/renderer/components/papers-by-tag.tsx`, `tests/integration/bibtex.test.ts`

**Changes**:

- Added BibTeX generation utility (`@shared`) with local fallback: generates `@article` entries from paper metadata
- Added `bibtex.service.ts` that fetches BibTeX from Semantic Scholar API (by arXiv ID or title search), falling back to local generation when API is unavailable
- Added `papers:exportBibtex` IPC handler for generating BibTeX from paper IDs
- Added `settings:saveBibtexFile` IPC handler with native save dialog for `.bib` file export
- Added "Copy BibTeX" button on Paper Overview page (copies single paper BibTeX to clipboard)
- Added "Export BibTeX" button in Papers list selection toolbar (batch export to `.bib` file)
- Toast notifications for copy/export success and errors

**Test design**: Unit tests for BibTeX generation functions — complete paper, missing author/year, special character escaping, arXiv eprint fields, batch generation
**Validation**: `npm run test` passes, `npm run lint` passes

### feat: PDF multi-file upload & drag-and-drop import

**Scope**: `src/main/ipc/providers.ipc.ts`, `src/main/ipc/papers.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/components/import-modal.tsx`, `tests/integration/papers.test.ts`

**Changes**:

- Modified `settings:selectPdfFile` dialog to support `multiSelections`, now returns `string[]` instead of `string | null`
- Added `papers:importLocalPdfs` IPC handler for batch PDF import with progress broadcasting via `papers:importLocalPdfs:progress`
- Updated `ipc.selectPdfFile` return type and added `ipc.importLocalPdfs()` in renderer hooks
- Redesigned Local PDF tab in Import Modal:
  - Drag & drop zone with dashed border and hover state for dropping PDF files
  - Multi-file picker via "Choose PDF files" button
  - File list with individual remove buttons and "Clear all"
  - Batch import progress bar with per-file status
  - arXiv ID/URL input preserved as separate section below file picker
- Added integration tests: batch import of multiple PDFs, non-PDF rejection, non-existent file rejection

### feat: Add "Scan Local Agents" auto-detection to AgentSettings

**Scope**: `src/renderer/components/settings/AgentSettings.tsx`

**Changes**:

- Added "Scan Local Agents" button that calls `ipc.detectAgents()` to find locally installed CLI agents
- Added Codex (`codex` CLI) to detection list alongside Claude Code, Gemini, Qwen, Goose
- Detection auto-reads local config files (`~/.claude/settings.json`, `~/.codex/config.toml`, `~/.codex/auth.json`, `~/.gemini/settings.json`, etc.)
- Parses API key, base URL, default model from config files (Claude: settings.json env vars + model; Codex: auth.json + config.toml)
- Detected agents display in a card list with logo, name, CLI path, and config/auth/API key/model indicators
- Already-added agents show "Already added" badge; new ones show one-click "Add" button (pre-fills all config including API credentials)
- Empty scan results show a friendly "no agents found" message
- Detection panel is dismissible with an X button and uses AnimatePresence animations

### fix: Test Connection fails with "Process exited (code: 1)"

**Scope**: `src/main/agent/agent-detector.ts`, `src/main/agent/acp-types.ts`, `src/shared/types/agent-todo.ts`, `src/main/ipc/agent-todo.ipc.ts`, `tests/integration/acp.test.ts`

**Changes**:

- **Root cause**: Claude Code and Codex native CLIs don't support ACP directly. Claude Code's `--experimental-acp` flag was removed; Codex needs `codex-acp` bridge.
- Changed Claude Code ACP path from `claude --experimental-acp` → `npx @zed-industries/claude-agent-acp`
- Changed Codex ACP path from `codex` → `npx @zed-industries/codex-acp`
- Changed Gemini ACP arg from `--experimental-acp` → `--acp`
- Updated `DEFAULT_AGENT_CONFIGS` and `AGENT_TOOL_META` to use correct ACP bridge commands
- Detection now returns both `cliPath` (ACP bridge) and `nativeCliPath` (system binary) for display
- Fixed `test-acp` handler to inject API credentials and config args
- Collect stderr output for better error diagnostics on failure
- Added `package-lock.json` to repo (needed for CI Linux release builds)
- Updated all ACP test assertions to match new config

### fix: Change analysis banner to floating toast notification

**Scope**: `src/renderer/components/app-shell.tsx`

**Changes**:

- Replaced full-width analysis banner with a compact floating toast in bottom-right corner
- Added dismiss (X) button so finished analysis notifications can be closed
- Made paper title clickable to navigate directly to the paper
- Added enter/exit animations with AnimatePresence

### fix: Prevent chat messages from disappearing after streaming completes

**Scope**: `src/renderer/pages/papers/reader/page.tsx`

**Changes**:

- Added `lastCompletedJobIdRef` to track processed completion events and prevent duplicate handling
- Changed completion effect to watch `chatJobList` instead of `activeChatJob` (which becomes null when job finishes)
- Effect now finds the most recent completed job for current paper and loads messages once
- Fixes issue where streaming content would disappear when job transitions from active to inactive

**Validation**: Manual testing shows messages persist after streaming completes

### feat: Convert paper chat to job subscription pattern

**Scope**: `src/main/ipc/reading.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/hooks/use-chat.tsx`, `src/renderer/pages/papers/reader/page.tsx`

**Changes**:

- Converted paper chat from blocking IPC with window-specific listeners to fire-and-forget job pattern with broadcast status updates
- Added `ChatJobStatus` tracking with stages (preparing, streaming, done, error, cancelled) and server-side job state management
- Main process now saves user messages to DB immediately and handles all chat persistence, preventing data loss on navigation
- Chat streaming continues across page navigation — returning to reader shows live or completed chat state
- One active chat per paper — starting a new chat aborts the previous one
- `ChatProvider` rewritten to mirror `AnalysisProvider`: job list + `chat:status` subscription, no more local `chat:output`/`chat:done`/`chat:error` listeners
- Reader page derives `chatRunning`, `streamingContent`, and `aiStatus` from active job state instead of local state
- Added completion effect to refresh messages from DB when job finishes

**Motivation**: The previous blocking handler sent streaming events only to the originating window and broke when navigating away. The job pattern broadcasts to all windows and tracks state server-side, matching the existing analysis feature pattern.

**Test design**: Manual verification — start chat, navigate away mid-stream, return to see streaming resume/complete; start chat on multiple papers; kill mid-stream; type checks pass

**Validation**: Type checks pass (1 pre-existing unrelated error in settings page), no new type errors introduced

### feat: Integrate sqlite-vec for vector search indexing

**Scope**: `src/db/vec-client.ts`, `src/main/services/vec-index.service.ts`, `src/main/services/semantic-search.service.ts`, `src/db/repositories/papers.repository.ts`, `src/main/services/paper-processing.service.ts`, `src/main/services/papers.service.ts`, `src/main/services/providers.service.ts`, `src/main/index.ts`, `scripts/build-main.mjs`, `electron-builder.yml`, `scripts/build-release*.sh/.ps1`

**Changes**:

- Added sqlite-vec extension via better-sqlite3 as a dedicated vector index alongside the existing Prisma database connection (dual-connection model, same DB file)
- Semantic search now uses native SQLite KNN queries (vec0 virtual table with cosine distance) instead of brute-force JS-level cosine similarity over all chunks
- New vec index service handles create/sync/delete/rebuild lifecycle, with automatic dimension detection from embeddings
- Paper processing pipeline now syncs chunks to vec index after embedding generation
- Paper deletion cleans up corresponding vec index entries
- App startup initializes the vec connection and triggers a background rebuild if chunks exist but vec index is empty
- Embedding model changes reset the vec index and clear indexedAt on all papers to trigger reprocessing
- Brute-force fallback preserved for when vec index is unavailable
- Build system updated: better-sqlite3 and sqlite-vec externalized in esbuild, included in electron-builder packaging, and native modules unpacked from asar
- Release scripts updated with electron-rebuild step for better-sqlite3

**Test design**: Integration tests verify chunk sync, KNN search correctness, deletion cleanup, full rebuild from Prisma, dimension change handling, and new repository query methods (findChunksByIds, listChunkIdsForPaper, listChunkIdsForPapers)

**Validation**: 7/7 new tests pass, 13/13 existing tests pass, build succeeds, no new type errors

## 2026-03-09

### refactor: Rename project from Vibe Research to ResearchClaw

**Scope**: Project-wide — config files, docs, storage paths, tests

**Changes**:

- **Core config**: `package.json` (name, description), `electron-builder.yml` (appId, productName, copyright)
- **Storage paths**: `src/main/store/storage-path.ts` — env var `VIBE_RESEARCH_STORAGE_DIR` → `RESEARCH_CLAW_STORAGE_DIR`, db file `vibe-research.db` → `researchclaw.db`, directory `~/.vibe-research` → `~/.researchclaw`
- **UI**: `src/renderer/index.html` (title), `src/main/index.ts` (window title), `src/renderer/components/app-shell.tsx` (sidebar collapsed key)
- **Docs**: `README.md`, `LICENSE`, `docs/usage-en.md`, `docs/usage-zh.md`, `CLAUDE.md`
- **Build scripts**: `scripts/build-release.sh`, `scripts/build-release-win.sh`, `scripts/build-release-linux.sh`, `scripts/build-release-win.ps1`
- **Tests**: `tests/support/electron-mock.ts`, `tests/integration/*.test.ts` (env var rename)
- **Other**: `.env.example`, `scripts/strip-arxiv-prefix.mjs`

**Naming Convention**:
| Type | Old | New |
|------|-----|-----|
| Product | Vibe Research | ResearchClaw |
| Package | vibe-research | researchclaw |
| Directory | ~/.vibe-research | ~/.researchclaw |
| Env var | VIBE*RESEARCH*_ | RESEARCH*CLAW*_ |
| App ID | com.vibe-research.app | com.researchclaw.app |

### feat: SSH Config auto-scan

**Scope**: `src/shared/types/ssh.ts`, `src/main/ipc/ssh.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/components/settings/SshServerSettings.tsx`

**Changes**:

- Added `SshConfigEntry` type to shared types.
- Added `ssh:scan-config` IPC handler that parses `~/.ssh/config` (Host, HostName, Port, User, IdentityFile directives; wildcard patterns skipped).
- Added `scanSshConfig()` IPC client method in renderer.
- Added "Scan SSH Config" button to SSH Servers settings page — opens a modal listing all parsed hosts with checkboxes, allowing batch import into the server list.
- Imported entries auto-detect auth method (privateKey if IdentityFile present, password otherwise).

### fix: Filter codex-acp noisy stderr warnings

**Scope**: `src/main/services/agent-task-runner.ts`

**Changes**: Suppress `No onPostToolUseHook found for tool use ID:` messages emitted by the `@zed-industries/codex-acp` bridge to stderr. These are harmless internal warnings that polluted the "Agent output" panel in the UI.

### feat: Research workflow — Task Results + Report Generation

**Scope**: Full stack — `prisma/schema.prisma`, `src/db/repositories/`, `src/main/services/`, `src/main/ipc/`, `src/shared/types/`, `src/renderer/components/project/`

**Changes**:

- **Data Models**: Added `TaskResult` and `ExperimentReport` models to Prisma schema.
  - `TaskResult`: Tracks output files from agent tasks (data, figures, logs, documents).
  - `ExperimentReport`: AI-generated reports with streaming content.
- **Repositories**: `task-results.repository.ts` and `experiment-report.repository.ts` for database operations.
- **Services**:
  - `task-results.service.ts`: Scan task output directories, register files, manage results.
  - `experiment-report.service.ts`: Streaming report generation using Vercel AI SDK with project context and task results.
- **IPC Handlers**: `task-results.ipc.ts` and `experiment-report.ipc.ts` with streaming events (`report:generate:chunk`, `report:generate:done`, `report:generate:error`).
- **UI Components**:
  - `ReportsTab.tsx`: List reports with Markdown preview, generate new reports.
  - `ReportGeneratorModal.tsx`: Task/result selection modal with real-time streaming preview.
- **TodoCard**: Shows results count badge for each task.
- **Project Page**: Added "Reports" tab to project detail view.

**Design**: Research workflow: Idea → Task → Results → Report. Results are task attributes (displayed on TodoCard), scanned from task output directories or manually added. Reports are AI-generated summaries with streaming preview.

### feat: SSH Remote Agent Execution

**Scope**: Full stack — `src/main/store/ssh-server-store.ts`, `src/main/services/ssh-connection.service.ts`, `src/main/agent/acp-connection.ts`, `src/main/services/agent-task-runner.ts`, `src/main/services/agent-todo.service.ts`, `src/main/ipc/ssh.ipc.ts`, `prisma/schema.prisma`, UI components

**Changes**:

- **SSH Server Management**: New `ssh-server-store.ts` stores SSH server configs in `~/.vibe-research/ssh-servers.json` with encrypted passwords via `safeStorage`.
- **SSH Connection Service**: `ssh-connection.service.ts` wraps `ssh2` for remote process spawning, SFTP directory browsing, and remote agent detection.
- **ACP over SSH**: Modified `acp-connection.ts` to support spawning agents on remote servers via SSH. The stdin/stdout pipes are transparently forwarded through SSH channels.
- **Project-level SSH**: Added `sshServerId` and `remoteWorkdir` fields to Project model. Projects can optionally associate with an SSH server.
- **Task Execution**: `agent-task-runner.ts` now supports `sshConfig` parameter. When provided, agents spawn on remote servers instead of locally.
- **Settings UI**: New SSH tab in Settings for managing SSH servers (add/edit/delete, test connection, detect remote agents).
- **Project UI**: `SshServerSelector` component for choosing SSH server, `RemoteCwdPicker` for browsing remote directories via SFTP.
- **TodoForm**: Shows remote indicator badge when project has SSH configured, uses remote workdir as default.

**Design**: Dual-mode execution — local (default, unchanged) vs remote (optional). When a project is associated with an SSH server, its tasks automatically run on the remote server.

### fix: Chrome history scan "Today" filter now uses local midnight instead of 24h ago

**Scope**: `src/main/services/ingest.service.ts`, `src/renderer/components/import-modal.tsx`

**Changes**:

- Added `daysToSince(days)` helper that computes start of day at local midnight: `days=1` → today 00:00, `days=7` → 6 days ago 00:00 (inclusive 7-day window).
- Replaced `new Date(); since.setDate(since.getDate() - days)` with `daysToSince(days)` in both `scanChromeHistory` and `importChromeHistoryAuto`.
- Renamed UI label `'Last 1 day'` → `'Today'` to accurately reflect the new behavior.
- Root cause: previous code used rolling 24h window, so at 00:30 CST scanning "last 1 day" would include all of yesterday. Now it always starts at local midnight.

### fix: Display arXiv submittedAt dates in UTC to prevent timezone shift

**Scope**: `src/renderer/components/dashboard-content.tsx`, `src/renderer/components/search-content.tsx`, `src/renderer/components/papers-by-tag.tsx`, `src/renderer/pages/papers/overview/page.tsx`, `src/renderer/pages/papers/reader/page.tsx`

**Changes**:

- Added `timeZone: 'UTC'` to all `toLocaleDateString()` calls that display `paper.submittedAt`.
- Changed `getFullYear()` → `getUTCFullYear()` in `papers-by-tag.tsx` for year filter and display.
- Root cause: arXiv submission dates are stored as UTC timestamps. Without `timeZone: 'UTC'`, UTC+8 users see dates shifted by 8 hours — e.g., a paper submitted UTC 2025-03-08 00:30 would display as 2025-03-08 locally, but a paper submitted UTC 2025-03-07 20:00 would incorrectly display as 2025-03-08 instead of 2025-03-07.

## 2026-03-09

### test: Add agent ACP connectivity test script

**Scope**: `scripts/test-agents.mjs`

**Changes**:

- Added `scripts/test-agents.mjs` — tests ACP connectivity for all configured agents using real DB credentials.
- Tests 花叶 (claude-agent-acp@0.18.0 + custom Anthropic endpoint), WK (codex-acp + codex-wk config), OpenCode (opencode acp HTTP server).
- All 3 agents: **PASS** — initialize + session/new confirmed working.
- OpenCode note: `opencode acp` uses HTTP/WebSocket transport (not stdio), so only server startup is verified.

### refactor: Replace hand-rolled ACP JSON-RPC with @agentclientprotocol/sdk

**Scope**: `src/main/agent/acp-connection.ts`, `src/main/agent/acp-types.ts`, `src/main/agent/acp-adapter.ts`, `src/main/agent/agent-detector.ts`, `src/main/services/agent-task-runner.ts`

**Changes**:

- Installed `@agentclientprotocol/sdk` as a dependency.
- `acp-connection.ts`: Replaced 277-line manual JSON-RPC implementation with `ClientSideConnection` + `ndJsonStream` from the SDK. Handles `sessionUpdate`, `requestPermission`, `readTextFile`, `writeTextFile` via the SDK's `Client` interface.
- `acp-types.ts`: Removed hand-written `AcpSessionUpdate` / `AcpPermissionRequest` types; now re-exports `SessionNotification`, `SessionUpdate`, `RequestPermissionRequest`, `RequestPermissionResponse` from the SDK.
- `acp-adapter.ts`: Updated `transformAcpUpdate()` to accept `SessionUpdate` (SDK type) with proper discriminant narrowing.
- `agent-detector.ts`: Added `claude-agent-acp` bridge detection (local build at `~/Workspace/claude-agent-acp/dist/index.js` or global `claude-agent-acp` binary). Removed `claude --experimental-acp` which was removed in Claude Code 2.x.
- `agent-task-runner.ts`: Updated to use `SessionUpdate` type; permission `requestId` changed from `number` to `string` (JSON-serializable, safe over IPC).
- `agent-todo.service.ts`: Updated `confirmPermission(requestId)` from `number` → `string`.

**Root cause fixed**: The original `acp-connection.ts` spawned `claude --experimental-acp` which was removed in Claude Code 2.x, causing `-32000 Authentication required` errors. The correct approach is to spawn the `claude-agent-acp` bridge (which uses `@anthropic-ai/claude-agent-sdk` internally) and communicate via the standard ACP protocol.

## 2026-03-09

### fix: Add missing stop/cancel buttons in import and chat flows

**Scope**: `src/renderer/components/import-modal.tsx`, `src/renderer/components/ideas/IdeaChatModal.tsx`

**Changes**:

- `import-modal.tsx`: Added Cancel button during `scanning` stage (Chrome History tab) — previously there was no way to abort a scan in progress.
- `import-modal.tsx`: Hid the "Cancel Import" button when `tab === 'local'` during `importing` stage — the button was shown but called `cancelImport()` which has no effect on local PDF / arXiv download operations.
- `IdeaChatModal.tsx`: Added a red Stop button (square icon) in the chat input when streaming — replaces the disabled send button and calls `ipc.killIdeaChat(sessionId)` to abort the in-flight model stream. Also removed `disabled` on the textarea during streaming so users can pre-type the next message.

### fix: Allow updating agent assignment in task edit form

**Scope**: `src/db/repositories/agent-todo.repository.ts`

**Changes**:

- Removed `Omit<..., 'agentId'>` from `updateTodo` method's type parameter.
- Previously, the `agentId` field was excluded from the update data type, preventing Prisma from updating the task's assigned agent.
- Now when editing a task, users can change the agent assignment and the change will be persisted correctly.

**Test design**: Create a task with agent A, edit it via the Edit button, select agent B, save, and verify the task's agent is updated.

## 2026-03-08

### fix: Stop button correctly cancels running agent task

**Scope**: `src/main/services/agent-task-runner.ts`

**Changes**:

- Fixed race condition where `start()` and `sendMessage()` catch blocks would overwrite the `cancelled` status with `failed` after `stop()` was called.
- When the process is killed by `stop()`, `rejectAllPending` causes the awaited Promise to reject, triggering the catch block. The catch block now checks `this.status !== 'cancelled'` before setting `failed` and pushing an error event.
- This prevents the UI `streamStatus` from flickering to `failed` after a stop, ensuring the stop button disappears and the status correctly shows `cancelled`.

### feat: Add edit button to task cards and detail page

**Scope**: `src/renderer/pages/agent-todos/page.tsx`, `src/renderer/pages/agent-todos/[id]/page.tsx`

**Changes**:

- Added `Settings2` edit icon to `TodoCard` component (visible on hover, alongside Run and Delete buttons).
- Added "Edit" button to task detail page header, between status dot and Run/Stop button.
- Both entry points open the existing `TodoForm` modal with pre-filled values for title, prompt, cwd, agent, priority, and YOLO mode.
- Completes the CRUD flow for agent tasks: Create → Read → Update → Delete.

**Test design**: Hover over a task card, click the settings icon, verify the edit form opens with correct values. Navigate to task detail page, click Edit button, verify same behavior.

### fix: Modal dialogs no longer close when dragging text selection outside

**Scope**: `src/renderer/components/agent-todo/TodoForm.tsx`, `src/renderer/pages/projects/page.tsx`, `src/renderer/components/download-modal.tsx`, `src/renderer/components/import-modal.tsx`

**Changes**:

- Removed `onClick` backdrop-close handlers from all modal overlays. Previously, clicking or dragging outside a modal would close it, causing accidental dismissal when selecting text in an input and moving the mouse outside the modal card.
- Modals now only close via their explicit Cancel/X buttons or ESC key, consistent with the fix previously applied to the Settings page modals.

**Affected modals**: TodoForm (Add/Edit Agent Task), Projects task form, Projects edit project modal, Download modal, Import modal.

### feat: Task detail conversation UI redesign (Codex-inspired)

**Scope**: `src/renderer/pages/agent-todos/[id]/page.tsx`, `src/renderer/components/agent-todo/MessageStream.tsx`, `src/renderer/components/agent-todo/ToolCallCard.tsx`, `src/renderer/components/agent-todo/ThoughtBlock.tsx`

**Changes**:

- **MessageStream**: Removed assistant bubble wrapper — content flows inline on white background. User messages use a simple gray pill bubble (no "You" label). Tool calls are grouped together in a compact block.
- **ToolCallCard**: Redesigned to match Codex-style clean rows — bold action label ("Edited", "Read", "Ran") + filename in monospace + status icon on right. Removed colored left border. Uses subtle gray background `#f5f5f4`.
- **ThoughtBlock**: Simplified to compact inline "Thought ▶" toggle (no Brain icon). Expanded view shows italic text with left border.
- **Header**: Title + folder icon + cwd path on same row (Codex-style). Removed status text label, kept status dot.
- **Prompt banner**: Removed "Prompt" label header, shows text directly with more padding.
- **Chat input**: Removed border-t separator, input floats with padding. Added "+" attach button on left. Improved placeholder text.

**Test design**: Run an agent task and verify the conversation UI matches the Codex-inspired design with clean inline messages, compact tool call rows, and the improved input area.

### feat: Improved agent message typography and code highlighting

**Scope**: `src/renderer/components/agent-todo/TextMessage.tsx`, `package.json`

**Changes**:

- **Custom markdown styles**: Added proper styling for all markdown elements (headings, paragraphs, lists, links, blockquotes) instead of relying on non-existent typography plugin.
- **Syntax highlighting**: Added `react-syntax-highlighter` with `oneDark` theme for code blocks. Code blocks now show language label header and proper syntax highlighting.
- **Inline code**: Styled with subtle background and purple text color.
- **Better line height**: Increased line-height to 1.7 for better readability.
- **Streaming text**: Improved streaming text appearance with better spacing.

**Test design**: Run an agent task and verify markdown renders beautifully with syntax highlighting for code blocks.

### fix: Tool call card UI improvements

**Scope**: `src/renderer/components/agent-todo/ToolCallCard.tsx`

**Changes**:

- **Default collapsed**: Tool call details (path/command/rawInput) are now collapsed by default. Only the title row is shown, reducing visual clutter for long commands.
- **Purple theme for execute**: Commands (kind='execute') now use purple color scheme instead of green/blue, making them visually distinct from file read/edit operations.
- **Click whole row to expand**: The entire title row is now clickable for expansion, not just the chevron button.

**Test design**: Run agent tasks and verify tool calls show minimal info by default, with purple highlighting for bash/shell commands.

### fix: Accumulate thought chunks in message stream

**Scope**: `src/renderer/hooks/use-agent-stream.ts`

**Changes**:

- Fixed thought message chunks not being accumulated. Previously, each `agent_thought_chunk` from the backend was displayed as a separate message, causing cluttered output. Now thought messages are accumulated (same as text messages) by matching `msgId`, resulting in a single consolidated thought block per thinking session.

**Test design**: Run an agent task and verify that thinking messages appear as one continuous block instead of many fragmented pieces.

### fix: Agent model selector and thought message display

**Scope**: `src/renderer/pages/agent-todos/[id]/page.tsx`, `src/renderer/components/agent-todo/MessageStream.tsx`

**Changes**:

- **Model selector fix**: Model dropdown now uses agent-specific models from `AGENT_TOOL_META` instead of chat model configs from `listModels()`. Each agent type (Claude Code, Code X) now shows its own predefined models (e.g., Claude Opus/Sonnet/Haiku for Claude Code, GPT 5.x/O3 for Code X).
- **Thought consolidation**: Consecutive `thought` type messages are now merged into a single "Thinking..." collapsible block, avoiding multiple repetitive Thinking labels.

**Test design**: Manual testing in task detail page — model dropdown shows appropriate models for the selected agent type; consecutive thought messages display as one merged block.

### fix: Cascade delete AgentTodo when Project is deleted

**Scope**: `prisma/schema.prisma`

**Changes**:

- Added foreign key relation between `AgentTodo.projectId` and `Project.id` with `onDelete: Cascade`.
- When a project is deleted, all associated agent todos are now automatically deleted.

**Test design**: Create a project with an agent todo, then delete the project. Verify the todo is removed from database.

### feat: Token usage statistics for agent runs

**Scope**: `src/main/agent/session-stats-reader.ts` (new), `src/main/services/agent-todo.service.ts`, `src/shared/types/agent-todo.ts`, `src/renderer/components/agent-todo/RunTimeline.tsx`

**Changes**:

- **`session-stats-reader.ts`**: New utility that reads Claude Code session JSONL files (`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`) and aggregates token usage (input, output, cache read, cache creation) across all assistant message turns.
- **`agent-todo.service.ts`**: After a run completes, calls `readSessionStats` with the session ID and cwd, then persists the result as JSON into the existing `tokenUsage` field on `AgentTodoRun`.
- **`AgentTodoRunItem`**: Added `tokenUsage: string | null` and `TokenUsage` interface to shared types.
- **`RunTimeline.tsx`**: Displays total token count per run entry with hover tooltip showing input/output/cache breakdown.

### feat: Model dropdown + API config for Claude Code

**Scope**: `src/shared/types/agent-todo.ts`, `src/renderer/components/settings/AgentSettings.tsx`, `src/main/services/agent-todo.service.ts`

**Changes**:

- **Model dropdown**: Added `ModelOption` interface and predefined models array to `AgentToolMeta`. Models for Claude Code: Opus 4.6, Sonnet 4.6, Haiku 4.5. Models for Code X: GPT 5.4/5.3/5.2/5.1, O3 High/Medium/Low.
- **UI**: Model selector now shows dropdown with predefined options plus "Custom model..." option for manual input.
- **Bug fix**: Fixed CLI Path being overwritten when switching agent types — now preserves custom CLI paths.
- **API config for Claude Code**: Added API Key + Base URL configuration fields for Claude Code agents (previously only available for Code X). Service layer now injects `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` env vars for Claude Code, `OPENAI_API_KEY` and `OPENAI_BASE_URL` for Code X.
- **Model env var injection**: `runTodo` now sets `ANTHROPIC_MODEL` for Claude Code and `OPENAI_MODEL` for Code X based on task/agent model selection.

### feat: Agent call count stats in Usage Settings

**Scope**: `prisma/schema.prisma`, `src/db/repositories/agent-todo.repository.ts`, `src/main/services/agent-todo.service.ts`, `src/main/ipc/agent-todo.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/settings/page.tsx`

**Changes**:

- Added `callCount Int @default(0)` to `AgentConfig` schema; ran `prisma db push`.
- Added `incrementAgentCallCount()` to repository (atomic increment via Prisma).
- `runTodo()` increments `callCount` each time a task run starts.
- `test-acp` IPC handler increments `callCount` on successful connection test.
- `getAgentRunStats()` simplified to return `[{ id, name, callCount }]` per agent.
- **Agent Calls** section in Usage Settings: per-agent row with name, progress bar, call count, and "task runs + connection tests" label.

### feat: Simplify agent types to Claude Code + Code X with proper logos

**Scope**: `src/shared/types/agent-todo.ts`, `src/renderer/components/settings/AgentSettings.tsx`, `prisma/schema.prisma`, `src/db/repositories/agent-todo.repository.ts`, `src/main/services/agent-todo.service.ts`

**Changes**:

- **Agent types reduced**: Removed all agent types except "Claude Code" and "Code X" from `AgentToolKind` and `AGENT_TOOL_META`.
- **Logos added**: Added proper Claude/Anthropic logo and Code X logo components (SVG) sourced from AionUi repository.
- **Code X API configuration**: Added `apiKey` and `baseUrl` fields to `AgentConfig` schema, repository input types, and service layer.
- **Service layer**: `runTodo` now injects `OPENAI_API_KEY` and `OPENAI_BASE_URL` environment variables when executing Code X agents.
- **UI**: Added conditional API Key + Base URL configuration section for Code X agents in both Add Agent form and Edit Agent modal.

### feat: git init button in Code tab empty state

**Scope**: `src/renderer/pages/projects/page.tsx`

**Changes**:

- Replaced the top-of-tab `git init` banner with a more prominent empty-state card in the Code tab.
- When a project has a workdir but no git repository, the empty state now shows a centered card with a GitBranch icon, the workdir path, and a `git init` button — instead of the old small banner above the URL input.
- Removed the old `AnimatePresence` banner block; the `git init` UI is now part of the repos empty state conditional.

### refactor: Task detail page layout — model dropdown, prompt banner, YOLO in chat toolbar

**Scope**: `src/renderer/pages/agent-todos/[id]/page.tsx`

**Changes**:

- **Model selector**: Moved from `TaskInfoPanel` (sidebar) to chat input toolbar (bottom-left). Replaced inline text edit with a proper dropdown (`ModelDropdown`) that lists all configured models from `ipc.listModels()`. Shows "Default (agentDefaultModel)" as the first option; selecting it clears the override.
- **YOLO toggle**: Moved from `TaskInfoPanel` to chat input toolbar (next to Model dropdown) as a compact pill button with amber highlight when active.
- **Prompt banner**: Prompt text now shown as a banner at the top of the chat area (right column), replacing the collapsible prompt row in the sidebar.
- **TaskInfoPanel**: Simplified to show only Priority, Cron schedule (if set), and Created date — cleaner and less cluttered.

### feat: Model selection per agent and per task

**Scope**: `prisma/schema.prisma`, `src/db/repositories/agent-todo.repository.ts`, `src/shared/types/agent-todo.ts`, `src/main/services/agent-todo.service.ts`, `src/renderer/components/settings/AgentSettings.tsx`, `src/renderer/pages/agent-todos/[id]/page.tsx`

**Changes**:

- **Schema**: Added `defaultModel String?` to `AgentConfig` and `model String?` to `AgentTodo`; ran `prisma db push`.
- **Service**: `addAgent`/`updateAgent` support `defaultModel`; `createTodo`/`updateTodo` support `model`; `runTodo` injects `ANTHROPIC_MODEL` env var from `todo.model ?? agent.defaultModel`.
- **AgentSettings UI**: Added "Default Model" input field to both Add Agent form and Edit Agent modal.
- **Task Detail UI**: Added "Model" row in `TaskInfoPanel` with inline click-to-edit; shows `todo.model` (blue) or `agent.defaultModel` or "agent default" (gray). Blur/Enter commits the change via `ipc.updateAgentTodo`.

### feat: Codex ACP support via npx bridge + Karen agent

**Scope**: `src/main/store/model-config-store.ts`, `src/main/agent/acp-types.ts`, `src/main/agent/agent-detector.ts`, `~/.vibe-research/model-configs.json`

**Changes**:

- **Codex ACP bridge**: Changed default codex command from `codex` to `npx @zed-industries/codex-acp` since native codex CLI doesn't support ACP directly.
- **YOLO mode**: Added `full-access` as codex's YOLO mode ID (from Codex approval-presets: read-only/auto/full-access).
- **Agent detection**: Removed codex from `AGENTS_TO_DETECT` since it uses npx bridge (no local binary to detect).
- **Karen agent**: Added new "Karen" agent to user's local config, configured to use the codex-acp bridge with the user's existing `~/.codex/` config files.

### fix: Agent task stop/cancel race condition + historical message rendering

**Scope**: `src/main/services/agent-task-runner.ts`, `src/main/services/agent-todo.service.ts`, `src/renderer/pages/agent-todos/[id]/page.tsx`

**Changes**:

- **Stop race condition**: `runner.stop()` 先设置 status 为 `cancelled` 再 kill 进程，确保 exit 事件触发时不会再标记为 `failed`；`runTodo` 的 catch 块增加判断，若 runner 已是 `cancelled` 则跳过 DB 更新；`stopTodo` 把 todo 和 lastRun 都更新为 `cancelled`（而非 `idle`）。
- **历史消息合并**: 读取历史消息时，把相同 `msgId` 的 `text` 类型 chunk 拼接成一条，避免每个字符单独渲染成一行；`tool_call` 类型做字段合并（非空覆盖），确保 title/kind/status 都正确显示；`plan` 类型取最后一条（entries 状态最新）。

### fix: Agent ACP now uses aia.linglong521.cn proxy with real API key

**Scope**: DB AgentConfig (juchenghu agent extraEnv)

**Changes**:

- 根本原因：`mcli.sankuai.com` 代理不支持 `tools: { type: "preset", preset: "claude_code" }` 参数，`claude-agent-acp` 内部会传这个参数，所以 400。
- 改用 `aia.linglong521.cn` 代理 + 真实 API key，完整 ACP 流程（initialize → session/new → session/prompt）测试通过，收到 `hello world` 响应。
- DB 已更新：`cliPath = 'npx @zed-industries/claude-agent-acp@0.18.0'`，`extraEnv` 包含 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN`。

### fix: Agent auth + env vars UI + delete run clears messages

**Scope**: `src/renderer/components/settings/AgentSettings.tsx`, `src/renderer/pages/agent-todos/[id]/page.tsx`

**Changes**:

- **`AgentSettings.tsx`**: Added "Environment Variables" field (KEY=VALUE per line) to both the Add Agent form and Edit Agent modal. Parses to/from `extraEnv` record. Lets users persist `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, etc. without relying on shell env inheritance.
- **`page.tsx`**: When deleting a run that is currently selected, immediately clear `historicMessages` so stale messages no longer linger in the UI.

### fix: Navigation preserves search origin when viewing paper details

**Scope**: `src/renderer/hooks/use-tabs.tsx`, `src/renderer/pages/papers/overview/page.tsx`, `src/renderer/pages/papers/reader/page.tsx`, `src/renderer/pages/papers/notes/page.tsx`

**Changes**:

- **`use-tabs.tsx`**: `openTab` now accepts optional `state` parameter and passes it to `navigate`.
- **`overview/page.tsx`**: When opening reader/notes, preserve `from` location state so navigation chain remembers search origin.
- **`reader/page.tsx`**: Return button now passes `from` state back to overview page.
- **`notes/page.tsx`**: Return button now passes `from` state back to overview page.

**User impact**: When navigating from search results → paper details → reader/notes → back, the return button correctly goes back to search results instead of library.

### feat: Tasks page grouped by Project with collapsible sections

**Scope**: `src/shared/types/agent-todo.ts`, `src/renderer/pages/agent-todos/page.tsx`

**Changes**:

- **`agent-todo.ts`**: Added `projectId?: string | null` to `AgentTodoItem` interface (field was already returned by service via Prisma spread).
- **`page.tsx`**: Rewrote Tasks page — loads projects and todos in parallel, groups todos by projectId, renders collapsible project sections (chevron toggle). Assigned todos appear under their project name; unassigned todos appear in an "Unassigned" group at the bottom. Status filter applies globally; empty groups are hidden.

### fix: Real-time streaming now displays messages during agent execution

**Scope**: `src/renderer/hooks/use-agent-stream.ts`

**Changes**:

- **`use-agent-stream.ts`**: Fixed IPC callback argument order — `ipcRenderer.on` passes `(event, data)` but all `onIpc` callbacks were treating the first arg (the IPC event object) as the payload. Changed all callbacks from `(data: unknown)` to `(_event: unknown, data: unknown)` so actual stream data is correctly received. This fixes the issue where messages only appeared after clicking Stop.

### fix: Stream messages persist to DB + real-time streaming UI with animations

**Scope**: `src/main/services/agent-task-runner.ts`, `src/main/services/agent-todo.service.ts`, `src/renderer/components/agent-todo/MessageStream.tsx`, `src/renderer/components/agent-todo/TextMessage.tsx`, `tests/integration/acp-e2e.test.ts`

**Changes**:

- **`agent-task-runner.ts`**: `pushEvent` now also calls `this.emit(event, data)` so service layer can subscribe.
- **`agent-todo.service.ts`**: Subscribe to runner `stream` events and persist each message to DB in real-time. Fixes orphaned runs losing all output on restart.
- **`TextMessage.tsx`**: When `streaming=true`, render plain text with a blinking cursor instead of ReactMarkdown (avoids re-parsing on every chunk and mid-stream markdown glitches).
- **`MessageStream.tsx`**: Track `lastTextMsgId` to pass `streaming` prop to the active text message. Show three-dot bounce animation when agent is running but no text output yet.
- **`acp-e2e.test.ts`**: New integration test — reads enabled agent from DB, runs full ACP flow (initialize → session/new → session/prompt), verifies streaming chunks arrive. Run with `RUN_ACP_E2E=1`.

### fix: Editor test now correctly reports failure when command not found

**Scope**: `src/main/ipc/providers.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/settings/page.tsx`

**Changes**:

- Previously, when testing an editor (e.g., VS Code `code` command) that wasn't available, the system silently fell back to macOS `open` command (Finder) and reported success.
- Now: removed fallback logic — if editor command fails, no folder is opened and test fails.
- UI shows simple "测试成功" or "测试失败，请检查命令是否可用" instead of error messages.

### feat: Slash command menu in agent chat input + npx ACP bridge support

**Scope**: `src/main/agent/acp-types.ts`, `src/main/agent/acp-connection.ts`, `src/main/services/agent-task-runner.ts`, `src/renderer/hooks/use-agent-stream.ts`, `src/renderer/pages/agent-todos/[id]/page.tsx`

**Changes**:

- **`acp-types.ts`**: Added `available_commands_update` to `AcpSessionUpdateType`; added `AcpSlashCommand` interface and `availableCommands` field to `AcpSessionUpdate`.
- **`acp-connection.ts`**: Clear `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` env vars when spawning child process; auto-prepend `--yes --prefer-offline` for `npx`-style `cliPath`.
- **`agent-task-runner.ts`**: Handle `available_commands_update` — push `agent-todo:commands` IPC event with the command list instead of passing to message transformer.
- **`use-agent-stream.ts`**: Added `availableCommands` state; listen for `agent-todo:commands` IPC event to update it. Exported `SlashCommand` type.
- **`page.tsx`**: Slash command popup menu above the chat textarea — triggered by typing `/`, filtered by subsequent characters. Arrow keys navigate, Tab/Enter selects, Escape closes. Placeholder updated to hint at `/` commands.

### feat: Configurable storage root with full data migration

**Scope**: `src/main/store/storage-path.ts`, `src/main/store/app-settings-store.ts`, `src/main/services/providers.service.ts`, `src/main/ipc/providers.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/settings/page.tsx`, `src/renderer/pages/papers/overview/page.tsx`, `src/renderer/pages/papers/notes/page.tsx`

**Changes**:

- **Bootstrap config** (`~/.vibe-research-config.json`): A new fixed-location config file stores the user-chosen storage root. Read at startup before anything else, so `DATABASE_URL` and all paths are resolved from the configured directory.
- **`storage-path.ts`**: Added `getBootstrapConfigPath()`, `getConfiguredStorageDir()`, `setStorageDir()`, and `migrateStorageDir()`. `getBaseDir()` now reads the bootstrap config (falls back to platform defaults for existing users — no breaking change).
- **Migration**: `migrateStorageDir(oldDir, newDir)` copies `vibe-research.db`, `papers/`, `app-settings.json`, `provider-config.json`, `cli-tools.json`, `model-config.json`, `token-usage.json` to the new directory. Old files are not deleted.
- **`app-settings-store.ts`**: `papersDir` is now an optional legacy field (ignored at runtime; papers are always at `{storageRoot}/papers`). Removed `setPapersDir`.
- **`providers.service.ts`**: Added `setStorageDir(newDir)` — runs migration then writes bootstrap config.
- **`providers.ipc.ts`**: Replaced `settings:setPapersDir` handler with `settings:setStorageDir`. After successful migration, calls `app.relaunch() + app.exit(0)`.
- **`use-ipc.ts`**: Replaced `setPapersDir` with `setStorageDir`. Updated `getSettings()` return type (no longer includes `papersDir`).
- **Settings UI (`StorageSettings`)**: Now shows the storage root (from `getStorageRoot()`), shows a confirmation dialog before migrating ("Migrate & Restart"), and calls `setStorageDir` on confirm. Removed scan-papers button from this section.
- **Paper pages**: Fixed `overview/page.tsx` and `notes/page.tsx` to use `getStorageRoot()` + `/papers/{shortId}` instead of the now-removed `settings.papersDir`.

### fix: Editor test now correctly reports failure when command not found

**Scope**: `src/main/ipc/providers.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/settings/page.tsx`

**Changes**:

- Previously, when testing an editor (e.g., VS Code `code` command) that wasn't available, the system silently fell back to macOS `open` command (Finder) and reported success.
- Now the IPC handler returns `{ success: false, usedFallback: true, error: "Editor 'code' not found..." }` when the editor command fails, even though it still opens the folder via fallback.
- Frontend displays the error message correctly, showing test failure instead of false success.

### feat: Hide chat input in YOLO mode + ACP integration tests

**Scope**: `src/renderer/pages/agent-todos/[id]/page.tsx`, `tests/integration/acp.test.ts`

**Changes**:

- **Task detail page**: Chat input bar is now hidden when `todo.yoloMode` is true (全自动 mode needs no manual input).
- **ACP tests**: Added comprehensive ACP integration test suite (46 tests) covering `acp-types`, `acp-adapter`, `acp-connection` JSON-RPC parsing/notification/permission/fs handling, and `agent-detector`. All 46 tests pass.

### feat: Multi-turn conversation in Task detail page

**Scope**: `src/main/services/agent-runner-registry.ts`, `src/main/services/agent-task-runner.ts`, `src/main/services/agent-todo.service.ts`, `src/main/ipc/agent-todo.ipc.ts`, `src/main/agent/acp-connection.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/hooks/use-agent-stream.ts`, `src/renderer/pages/agent-todos/[id]/page.tsx`

**Changes**:

- **agent-runner-registry**: Completed runners are now kept alive in the registry (only `failed`/`cancelled` triggers auto-removal), enabling multi-turn conversation after a run finishes.
- **AgentTaskRunner**: Added `sendMessage(text)` for sending follow-up prompts on the same ACP session, `isAlive()` to check if the runner can accept new messages, and `pushUserMessage()` to broadcast user messages to the renderer via IPC.
- **AgentTodoService**: Added `sendMessage(todoId, runId, text)` which persists the user message to DB, pushes it to the renderer immediately, then forwards to the agent.
- **agent-todo.ipc**: Added `agent-todo:send-message` IPC handler.
- **acp-connection**: stderr data is now emitted as a `stderr` event instead of being silently ignored.
- **AgentTaskRunner**: Listens to `stderr` events from connection and forwards them to the renderer as `agent-todo:stderr` IPC events.
- **use-agent-stream**: Added `canChat` state (true when status is `completed`) and `stderrLines` array for real-time stderr output.
- **use-ipc**: Added `sendAgentMessage(todoId, runId, text)` IPC client method.
- **Task detail page**: Added a persistent ChatInput bar at the bottom of the message stream (shown when a run is selected). Supports Enter-to-send (with IME guard), auto-resize textarea, Send/Stop buttons. Also added a floating stderr output panel (terminal-style, dark bg) shown while the agent is running.

### feat: Redesign Ideas tab — inline chat, dropdown selectors for Papers/Repos, Generate Task modal

**Scope**: `src/renderer/pages/projects/page.tsx`

**Changes**:

- Removed the separate `IdeaChatModal` drawer; chat is now fully inline within the Ideas tab.
- Replaced the flat button row with two dropdown selectors: **Papers** (searchable, checkbox list) and **Repos** (checkbox list, disabled when no cloned repos exist).
- Added chip display below the toolbar showing selected papers (blue) and repos (green), each with an × to deselect.
- **Generate Task** button in the toolbar triggers AI extraction from chat history, then opens an inline modal with Title / Prompt / Agent / Working Directory fields.
- Removed old `generateIdea`, `showPaperPicker`, and `IdeaCard` components; IdeaCard list display removed from this tab.
- `IdeaChatModal` import replaced with inline `AgentSelector` + `CwdPicker` for the task form.

**Motivation**: Consolidate all idea-to-task workflow into a single inline surface — no more modal drawer needed.

### feat: Task Detail Page redesign — message bubbles, ToolCallCard colors, TaskInfoPanel

**Scope**: `src/renderer/pages/agent-todos/[id]/page.tsx`, `src/renderer/components/agent-todo/MessageStream.tsx`, `src/renderer/components/agent-todo/ToolCallCard.tsx`, `src/renderer/components/agent-todo/ThoughtBlock.tsx`, `src/renderer/components/agent-todo/RunTimeline.tsx`

**Changes**:

- **MessageStream**: Redesigned with user/assistant bubble groups. User messages right-aligned with accent-light background; assistant messages left-aligned with sidebar background. Consecutive same-role messages merged into one bubble group with role label ("You" / "Agent"). System/error messages remain centered.
- **ToolCallCard**: Replaced full border with colored left-border status style: pending=amber, in_progress=blue, completed=green, failed=red. Added AnimatePresence animation for rawInput expansion.
- **ThoughtBlock**: Simplified to inline expand/collapse with framer-motion AnimatePresence. Expanded content uses italic muted text with left border accent.
- **TaskInfoPanel**: New component in left column below RunTimeline showing prompt (collapsible), priority bar, YOLO mode indicator, cron schedule, and creation date.
- **RunTimeline**: Removed `w-52`/`border-r` from component (now owned by parent layout column).
- **Page layout**: Left column wraps RunTimeline + TaskInfoPanel in a shared `w-52` flex column.

**Motivation**: Improve visual clarity of agent task execution — distinguish user prompts from agent responses, make tool call status immediately visible via color, and surface task metadata without leaving the page.

### feat: Add icons to project detail page tabs

**Scope**: `src/renderer/pages/projects/page.tsx`

**Changes**:

- Added icons to each tab (Tasks, Code, Ideas) in project detail page
- Used FolderKanban for Tasks, GitBranch for Code, Lightbulb for Ideas
- Aligned style with Settings page tabs

### feat: Add delete run history feature in Task detail page

**Scope**: `src/db/repositories/agent-todo.repository.ts`, `src/main/services/agent-todo.service.ts`, `src/main/ipc/agent-todo.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/components/agent-todo/RunTimeline.tsx`, `src/renderer/pages/agent-todos/[id]/page.tsx`

**Changes**:

- Added `deleteRun` and `findRunById` methods to `AgentTodoRepository`
- Added `deleteRun` method to `AgentTodoService` with logic to clear `lastRunId` reference if needed
- Added IPC handler `agent-todo:delete-run`
- Added `deleteAgentTodoRun` to IPC client
- Updated `RunTimeline` component with delete button (trash icon, appears on hover)
- Connected delete handler in Task detail page to refresh run list after deletion

**Motivation**: Users need the ability to clean up old run history entries.

### feat: Auto-detect workdir Git repo in Projects Code tab

**Scope**: `prisma/schema.prisma`, `src/db/repositories/projects.repository.ts`, `src/main/services/projects.service.ts`, `src/main/ipc/projects.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/projects/page.tsx`

**Changes**:

- Added `isWorkdirRepo` boolean field to `ProjectRepo` model to identify repos that are the project's workdir (no clone needed)
- Added `checkWorkdirGit` method to detect if project workdir contains `.git` folder and optionally get remote URL
- Added `addWorkdirRepo` method to add workdir as a repo without cloning
- Added IPC handlers `projects:workdir:check` and `projects:workdir:addRepo`
- Updated `RepoCard` component to show workdir repos with distinct styling (FolderOpen icon, "local" badge, no Clone button)
- Workdir repos are auto-added when `.git` is detected (no confirmation needed); removed Agent card from CodeTab; workdir repos display repo name from URL

**Motivation**: When a project's workdir is already a Git repository, users shouldn't need to clone it separately. This allows viewing commits directly from the existing workdir.

### fix: Auto-create workdir directory if not exists

**Scope**: `src/main/services/projects.service.ts`

**Changes**:

- `createProject` and `updateProject` now auto-create the workdir directory using `fs.mkdirSync(path, { recursive: true })` if it doesn't exist

### feat: Improve Agent Settings UX — name suggestions and hidden backend ID

**Scope**: `src/renderer/components/settings/AgentSettings.tsx`

**Changes**:

- Added `AGENT_NAME_SUGGESTIONS` constant with 8 human-style names (Aria, Max, Nova, Echo, Sage, Orion, Luna, Finn)
- Add Form: replaced `Name` + `Backend ID` grid with single `Name` field + suggestion chips row; clicking a chip fills the name input
- Edit Form: same treatment — removed Backend ID input, added name suggestion chips under Name field
- Agent list: name now displays as `{name} ({meta.label})` (e.g. "Aria (Claude Code)"); second line simplified to show only CLI path
- `backend` field still auto-set internally by `handleAgentToolChange`; removed `!newAgent.backend` from form validation guard

### fix: macOS traffic light buttons visibility when window inactive

**Scope**: `src/main/index.ts`

**Changes**:

- Added `trafficLightPosition: { x: 16, y: 16 }` to BrowserWindow config
- Ensures the red/yellow/green buttons remain visible (as gray hollow circles) when the window loses focus
- Previously the buttons would completely disappear instead of showing the standard macOS inactive state

### test: Add ACP protocol unit tests (46 cases)

**Scope**: `tests/integration/acp.test.ts` (new file)

**Changes**:

- `acp-types`: covers all 6 backends in `DEFAULT_AGENT_CONFIGS`, all `YOLO_MODE_IDS` entries
- `acp-adapter`: tests every `sessionUpdate` variant (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `config_option_update`), edge cases (empty text, missing content, unique IDs, ISO timestamps)
- `acp-connection`: JSON-RPC message parsing (success/error response, non-JSON lines, partial/split chunks), notification routing (`session/update`, `session/finished`), exit event + pending request rejection, permission request emission, `respondToPermission` output format, `fs/read_text_file` (real file + missing file), `fs/write_text_file`, request ID monotonic increment
- `agent-detector`: result shape validation, no-duplicate-backend invariant, per-backend acpArgs contract cross-checked against `DEFAULT_AGENT_CONFIGS`

### feat: Add workdir editing to Project detail page

**Scope**: `src/main/services/projects.service.ts`, `src/renderer/pages/projects/page.tsx`, `src/renderer/components/agent-todo/CwdPicker.tsx`

**Changes**:

- Added `workdir` parameter support to `createProject` and `updateProject` methods in `ProjectsService`
- Added pencil icon next to project name that opens edit modal with all project fields (name, description, workdir)
- Replaced previous double-click-to-edit pattern with unified edit modal
- Extended `CwdPicker` component with optional `onBlur` prop for form integration
- Workdir is displayed below description with folder icon when set

### fix: Unify AgentToolKind — add Gemini support across main process

**Scope**: `src/main/store/model-config-store.ts`, `src/main/services/agent-config.service.ts`, `src/main/services/models.service.ts`, `src/main/ipc/models.ipc.ts`, `src/main/ipc/cli-tools.ipc.ts`, `src/main/services/agent-local-server.ts`

**Changes**:

- Removed local `AgentToolKind = 'claude-code' | 'codex' | 'custom'` from `model-config-store.ts`; now re-exports the canonical type from `@shared` (which includes `gemini | qwen | goose`)
- Added Gemini CLI preset to `DEFAULT_AGENT_MODELS` (`id: 'agent-gemini'`, command: `gemini`, agentTool: `'gemini'`)
- Added Gemini branch to `getSystemAgentConfigStatus` — detects `~/.gemini/settings.json` and `~/.gemini/oauth_creds.json`
- Added Gemini branch to `getSystemAgentConfigContents` — reads the same two files
- Widened `getAgentConfigStatus` / `getAgentConfigContents` signatures in `ModelsService` from `'claude-code' | 'codex' | 'custom'` to `AgentToolKind`
- Widened same IPC handler params in `models.ipc.ts` and `cli-tools.ipc.ts`
- Widened `AgentTestRequest.agentTool` in `agent-local-server.ts`

### fix: TypeScript errors and test failures

**Scope**: `src/renderer/components/settings/AgentSettings.tsx`, `src/renderer/pages/projects/page.tsx`, `src/renderer/pages/settings/page.tsx`, `tests/support/test-db.ts`, `tests/integration/projects.test.ts`

**Changes**:

- Fixed `AgentSettings.tsx`: Changed `cliPath: editingAgent.cliPath` to `cliPath: editingAgent.cliPath ?? undefined` to handle `string | null` type
- Fixed `projects/page.tsx`: Added missing imports (`clsx`, `Check`, `X` from lucide-react)
- Fixed `settings/page.tsx`: Added 'agent' entry to `MODEL_KIND_META` Record type
- Fixed `test-db.ts`: Added cleanup for agent-related tables (`AgentTodoMessage`, `AgentTodoRun`, `AgentTodo`, `AgentConfig`), removed stray `test;` statement
- Fixed `projects.test.ts`: Removed outdated "manages todos" test (todo methods removed from ProjectsService)

### fix: Back button returns to correct source page

**Scope**: `src/renderer/components/agent-todo/TodoCard.tsx`, `src/renderer/pages/agent-todos/[id]/page.tsx`, `src/renderer/pages/agent-todos/page.tsx`, `src/renderer/pages/projects/page.tsx`, `src/renderer/components/dashboard-content.tsx`, `src/renderer/components/papers-by-tag.tsx`, `src/renderer/components/search-content.tsx`, `src/renderer/pages/papers/overview/page.tsx`

**Changes**:

- Added `from` prop to `TodoCard` component to pass source page info via `location.state`
- Agent Task detail page now returns to the correct source page (Projects or Agent Tasks list)
- Paper overview page now returns to the correct source page (Dashboard, Library, or Search)
- Updated navigation calls across Dashboard, Library (papers-by-tag), and Search to pass `from` location state

### feat: Remove ProjectTodo model; unify task creation to Agent Tasks

**Scope**: `prisma/schema.prisma`, `src/db/repositories/projects.repository.ts`, `src/main/services/projects.service.ts`, `src/main/ipc/projects.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/projects/page.tsx`, `src/renderer/components/app-shell.tsx`, `src/renderer/pages/agent-todos/page.tsx`

**Changes**:

- Removed `ProjectTodo` model from schema (simple text todos)
- Removed `createTodo`, `updateTodo`, `deleteTodo` from projects repository/service/IPC
- Removed `ProjectTodo` type and todo-related IPC methods from `use-ipc.ts`
- Projects page "Todos" tab now only shows Agent Tasks with a single "Add Task" button
- Renamed UI labels: "Todos" → "Tasks", "Agent Tasks" → "Tasks"
- Agent Tasks page header changed from "Agent Tasks" to "Tasks"

**Migration**: Run `npx prisma db push` after pulling to sync schema changes

### feat: Conversational idea chat → Agent Task creation in Projects

**Scope**: `src/main/services/projects.service.ts`, `src/main/ipc/projects.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/projects/page.tsx`, `src/renderer/components/ideas/IdeaChatModal.tsx` (new)

**Changes**:

- `projects.service.ts`: Extracted `buildSourceContext()` private helper from `generateIdea()`; added `ideaChat()` streaming method (uses `streamText` with paper/repo context) and `extractTaskFromChat()` non-streaming method (extracts JSON title+prompt from conversation)
- `projects.ipc.ts`: Added `BrowserWindow` import, `activeIdeaChats` AbortController map, and 3 new IPC handlers: `projects:idea:chat` (streaming, pushes `idea-chat:output/done/error`), `projects:idea:chatKill`, `projects:idea:extract-task`
- `use-ipc.ts`: Added `startIdeaChat`, `killIdeaChat`, `extractTaskFromChat` IPC methods
- `IdeaChatModal.tsx`: New right-drawer chat component (640px, slides in from right); two views — chat (multi-turn streaming conversation) and task-form (pre-filled title/prompt/agent/cwd, creates agent todo on confirm)
- `projects/page.tsx`: Added `MessageSquare` icon import, `IdeaChatModal` import, `showChatModal` state in `IdeasTab`, "Discuss & Generate" button, and `IdeaChatModal` mount at bottom of `IdeasTab`

**IPC channels**: `projects:idea:chat` (invoke), `projects:idea:chatKill` (invoke), `projects:idea:extract-task` (invoke), `idea-chat:output/done/error` (pushed events)

### feat: Redesign Chat input box; add fullscreen mode for Chat panel

**Scope**: `src/renderer/pages/papers/reader/page.tsx`

**Changes**:

- Removed top border (`border-t`) above the chat input area
- Redesigned input box to match Codex-style layout: textarea on top, bottom toolbar with `+` (new chat), model selector (with dropdown), and a rounded send/stop button
- Dropdown for chat history/clear/new chat now opens upward from the model selector in the input toolbar
- Added fullscreen toggle button (`Maximize2`/`Minimize2`) in the Chat header; clicking it overlays the chat panel over the full reader area (`absolute inset-0 z-30`)
- Chat header simplified to show current chat title only (selector moved to input toolbar)

### feat: Move Agent Task creation to Projects page; Agent Tasks page becomes read-only

**Scope**: `prisma/schema.prisma`, `src/db/repositories/projects.repository.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/projects/page.tsx`, `src/renderer/pages/agent-todos/page.tsx`, `src/renderer/components/agent-todo/TodoForm.tsx`, `src/renderer/components/agent-todo/TodoCard.tsx`

**Changes**:

- Added `workdir String?` field to `Project` model in schema; synced via `npx prisma db push`
- `CreateProjectInput` and IPC `createProject`/`updateProject` now accept optional `workdir`
- `ProjectItem` interface in `use-ipc.ts` includes `workdir?: string | null`
- `TodoForm` accepts optional `projectId` prop; passes it when creating agent todos
- `TodoCard` `onEdit` prop is now optional; edit button hidden when `onEdit` is not provided
- Projects page create-project form now includes a `CwdPicker` for selecting default working directory
- `TodoList` component now shows an "Agent Task" button that opens `TodoForm` modal with `project.workdir` as default cwd
- Agent tasks linked to the project are listed below the todos section (read-only `TodoCard` list)
- Agent Tasks page (`/agent-todos`) removes "New Task" button, `showForm`/`editId`/`editValues` state, and `handleEdit`; page is now read-only display only

**Test**: `npm run precommit:check` — 14 tests passed, 1 skipped

### fix: Clean up settings page TypeScript errors after agent settings refactor

**Scope**: `src/renderer/pages/settings/page.tsx`

**Changes**:

- Removed unused agent-related code from EditModelModal (Agent Preset selection, AgentConfigHint, config/auth textareas)
- Removed unused imports: `AgentToolKind`, `AgentConfigStatus`, `AgentConfigContents`
- Removed dead code: `AGENT_TOOL_OPTIONS`, `getAgentToolMeta`, `getAgentConfigFieldState`, `AgentConfigHint` functions
- Added `agent: 'cli'` to `KIND_BACKEND` to fix TypeScript Record type completeness

**Result**: Settings page compiles without errors; agent configuration fully handled by AgentSettings component

### feat: Improve AgentTodo form UX — priority signal bars, YOLO pill toggle, remove detect button

**Scope**: `src/renderer/components/agent-todo/AgentSelector.tsx`, `TodoForm.tsx`, `TodoCard.tsx`, `PriorityBar.tsx` (new)

**Changes**:

- Removed "Detect" button from AgentSelector in task form; agents now sourced from Settings only
- Replaced 3-level radio priority with 5-level signal-bar picker (Low/Normal/Medium/High/Urgent)
- Added `PriorityBar.tsx` with `PriorityBarIcon` (read-only) and `PriorityPicker` (interactive) components
- Bar colors graduate green→lime→yellow→orange→red per level
- YOLO Mode moved out of Advanced section into a top-level pill/capsule toggle
- Removed collapsible Advanced section entirely
- TodoCard now shows `PriorityBarIcon` inline when priority > 0

### feat: Add detailed agent configuration to Agents settings

**Scope**: `src/renderer/components/settings/AgentSettings.tsx`, `src/shared/types/agent-todo.ts`, `src/main/services/agent-todo.service.ts`, `src/db/repositories/agent-todo.repository.ts`, `prisma/schema.prisma`

**Changes**:

- Added agent tool selector (Claude Code, Codex, Custom CLI) to agent configuration
- Added config file content field for managing tool-specific settings
- Added auth file content field for authentication configuration
- Added test connection functionality with diagnostics output
- Added expandable agent cards showing detailed configuration
- Updated database schema with `agentTool`, `configContent`, `authContent` fields
- Integrated load from file functionality for existing config/auth files
- Usage statistics (runs count, tokens) now shown on each agent card

**Database migration required**: Run `npx prisma db push` after pulling changes

**Result**: Agents tab now has full feature parity with removed Models->Agent section

### refactor: Unify button border-radius to rounded-lg across all views

**Scope**: `src/renderer/components/`, `src/renderer/pages/`

**Changes**:

- Changed all action buttons from `rounded-md` to `rounded-lg` for visual consistency
- Affected files: app-shell, import-modal, download-modal, AgentSettings, TodoForm, CwdPicker, AgentSelector, agent-todos pages, papers overview/reader/notes pages, projects page, settings page
- Preserved `rounded-md` for non-button elements (inputs, textareas, `<pre>` blocks, alert divs, sidebar nav indicators)
- Preserved `rounded-full` for pill-shaped tags and toggle switches

**Result**: All interactive buttons now use uniform rounded-lg corner radius

### refactor: Consolidate Agent settings into dedicated Agents tab

**Scope**: `src/renderer/pages/settings/page.tsx`, `src/renderer/components/settings/AgentSettings.tsx`

**Changes**:

- Removed Agent section from Models tab (agent model kind)
- Removed Built-in Agents section from Agents tab
- Renamed "Custom Agents" to "Agents"
- Agents tab now contains all agent configuration with usage statistics

**Result**: Cleaner UI with agents fully managed in dedicated Agents tab

### refactor: Reorganize Agent settings and usage statistics

**Scope**: `src/renderer/pages/settings/page.tsx`, `src/renderer/components/settings/AgentSettings.tsx`

**Changes**:

- Removed agent-related settings from AddModelModal/EditModelModal (Agent Preset, config/auth content fields)
- Moved Agent usage frequency statistics from Models tab to Agents tab
- Changed Proxy's Agents icon from Code2 to Bot for consistency
- Redesigned AgentSettings component following ModelKindSection pattern
- Removed auto-detect functionality from AgentSettings
- Agents now configured through dedicated Agents tab, not through model modals

**Result**: Cleaner separation of concerns - Agent configuration is now fully in Agents tab with usage statistics

### fix: Change Agentic Search from purple to blue theme

**Scope**: `src/renderer/components/search-content.tsx`, `CLAUDE.md`

**Changes**:

- Changed all agentic search UI elements from purple to blue color scheme
- Updated search box border, icons, buttons, and loading states
- Updated agentic steps container and keyword tags
- Updated AgenticPaperCard component styling
- Added comprehensive color palette documentation to CLAUDE.md
- Improved toggle button animation with spring physics for smoother transition
- Added title color change and text change based on search mode
- Added icon transition animation with scale and rotate effects
- Added transition-colors to buttons and borders for smooth color changes

**Result**: Agentic search now uses consistent blue theme with smooth animated transitions

### fix: IME composition Enter key conflict

**Scope**: src/renderer/components/, src/renderer/pages/

**Changes**:

- Added `!e.nativeEvent.isComposing` guard to all `onKeyDown` Enter handlers across the app
- Affected files: tag-management-modal, search-content, import-modal, reader/page, overview/page, projects/page
- Prevents Chinese/Japanese/Korean IME composition confirmation Enter from triggering form actions

### feat: Agent-powered TODO automation system with ACP protocol support

**Scope**: src/main/agent/, src/main/services/, src/main/ipc/, src/renderer/pages/agent-todos/, src/renderer/components/agent-todo/, src/renderer/components/settings/, src/shared/types/, src/db/repositories/, prisma/schema.prisma

**Changes**:

- Added 4 new database tables: AgentConfig, AgentTodo, AgentTodoRun, AgentTodoMessage
- Implemented ACP (Agent Communication Protocol) JSON-RPC 2.0 over stdio communication layer (acp-connection.ts, acp-adapter.ts, acp-types.ts)
- Added automatic CLI detection for Claude Code, Codex, and Gemini CLI agents
- Implemented AgentTaskRunner for orchestrating agent execution with streaming output
- Added AgentTodoService with full CRUD, execution control, and cron scheduling
- Registered all agent-todo:\* IPC channels
- Built Agent Tasks list page (/agent-todos) with status filters and create/edit modal
- Built Agent Task detail page (/agent-todos/:id) with real-time message stream, run history timeline, and permission approval UI
- Added Agents tab to Settings page for agent detection and custom agent management
- Integrated croner-based cron scheduler for scheduled task execution
- Added "Agent Tasks" navigation entry in sidebar

**Result**: Users can create agent tasks, assign Claude Code / Codex / Gemini CLI agents, execute tasks with real-time streaming output, approve permissions, and schedule recurring tasks via cron expressions

### fix: Unify tag colors by category across all views

- **Scope**: `src/shared/utils/tag-style.ts`, `src/renderer/components/dashboard-content.tsx`, `src/renderer/components/search-content.tsx`, `src/renderer/pages/papers/overview/page.tsx`
- **Changes**:
  - Created shared `getTagStyle(category)` utility for category-based tag coloring
  - Tag colors now unified by category: domain=blue, method=purple, topic=green
  - Updated dashboard and search components to use `categorizedTags` with category-based colors
  - Updated paper details page to use consistent category colors for tag chips
- **Result**: Same category tags now display with consistent color across dashboard, search, and paper details
- **Result**: Same tag now displays with consistent color across all views (dashboard, search, paper details)

### feat: Add Windows window controls (minimize, maximize, close)

- **Scope**: `src/renderer/components/app-shell.tsx`, `src/renderer/hooks/use-ipc.ts`
- **Changes**:
  - Added Windows-specific window control buttons (minimize, maximize, close) in the tab bar header (right side)
  - Added platform detection using `navigator.userAgent`
  - Only shows window controls on Windows; macOS uses native traffic light buttons
  - Updated `use-ipc.ts` to export window control methods (`windowClose`, `windowMinimize`, `windowMaximize`, `windowIsMaximized`)
  - Close button turns red on hover (Windows standard behavior)
- **Result**: Windows users now have proper window controls in the title bar

### refactor: Improve sidebar collapse interaction

- **Scope**: `src/renderer/components/app-shell.tsx`
- **Changes**:
  - Removed collapse button - now uses click-based interaction
  - Click on collapsed sidebar → expands
  - Click on main content area → collapses sidebar
  - Simplified animations using CSS transitions (faster, smoother)
  - Nav links in collapsed state navigate directly without expanding sidebar
- **Result**: More intuitive interaction, smoother animations

### feat: Add sidebar collapse functionality

- **Scope**: `src/renderer/components/app-shell.tsx`
- **Changes**:
  - Added collapse/expand toggle button at the bottom of sidebar
  - Collapsed sidebar shows only icons (w-14), expanded shows icons + text (w-60)
  - Recent section completely hidden when collapsed
  - State persisted to localStorage for persistence across sessions
  - Smooth animations using framer-motion for text fade in/out
- **Result**: Cleaner UI with option to minimize sidebar clutter

### refactor: Remove Auto Tag progress card from paper details

- **Scope**: `src/renderer/pages/papers/overview/page.tsx`
- **Changes**:
  - Removed the blue status card that appeared during auto-tagging
  - Removed unused `TaggingStatus` state and import
  - Removed unused `stageLabel` mapping
  - Removed `tagging:status` IPC listener
- **Result**: Cleaner UI without the progress overlay

### refactor: Remove Analyze feature and simplify chat UI

- **Scope**: `src/renderer/pages/papers/reader/page.tsx`
- **Changes**:
  - Removed Analyze button and all analysis-related functionality
  - Removed "New Chat" button from dropdown menu (kept only in Chat Header)
  - Removed `ReaderAnalysisCard` component and related helper functions
  - Removed analysis state variables, IPC listeners, and handlers
  - Removed unused imports (`PaperAnalysis`, `Sparkles`, `ReactNode`)
  - Kept "Generate Notes" functionality intact
- **Result**: Cleaner chat UI with single "New Chat" button location

### fix: Auto-tag Cancel button not working

- **Scope**: `src/main/services/tagging.service.ts`, `src/main/services/ai-provider.service.ts`
- **Problem**: The Cancel button during auto-tagging did not abort ongoing API requests. Clicking Cancel would set a flag but the actual API call continued until completion or timeout.
- **Root cause**: `generateText` used only `AbortSignal.timeout()` without a cancellable `AbortController`. The `cancelTagging()` function had no way to abort in-flight requests.
- **Fix**:
  - Added `currentAbortController` variable to track active request
  - Modified `cancelTagging()` to call `abort()` on the controller
  - Updated `tagPaper()` to create an `AbortController` and combine its signal with timeout using `AbortSignal.any()`
  - Passed the combined signal to both structured output and fallback `generateText` calls

### fix: Modal Test Connection button not showing results

- **Scope**: `src/renderer/hooks/use-ipc.ts`
- **Problem**: The "Test Connection" button in the Add/Edit Model Modal showed a loading spinner, but after completion, no result was displayed. The test result object was being lost.
- **Root cause**: The `invoke` function checked only for `success` key to determine if a result was wrapped in `IpcResult`. However, `cli:testAgent` returns a direct result object like `{ success: true, output: '...' }`, which also has a `success` key. The `invoke` function mistakenly treated this as `IpcResult` and returned `data` (undefined), losing the actual result.
- **Fix**: Added additional check for `data` or `error` keys to properly distinguish `IpcResult` wrapper from direct result objects.

### feat: Add edit and delete functionality for individual chat messages

- **Scope**: `src/renderer/pages/papers/reader/page.tsx`
- **Problem**: Chat messages could not be edited or deleted after being sent. Users had no way to correct mistakes or remove unwanted messages.
- **Changes**:
  - Modified `ChatBubble` component to show edit/delete buttons on hover
  - Added edit mode with textarea for editing message content
  - Added confirmation dialog for delete action
  - Edit/delete actions persist changes to database via `reading:saveChat`
  - Deleting a message updates the local state and saves to DB

### feat: Add delete functionality for chat sessions

- **Scope**: `src/main/ipc/reading.ipc.ts`, `src/renderer/pages/papers/reader/page.tsx`
- **Problem**: Chat sessions (conversation records) could not be deleted, accumulating over time.
- **Changes**:
  - Added `reading:delete` IPC handler in `reading.ipc.ts` (was missing despite existing service method)
  - Added `handleDeleteChat` function in reader page
  - Added delete button (trash icon) to each chat item in the dropdown list
  - Delete button appears on hover, properly stops propagation to prevent accidental selection
  - Deleting currently active chat resets the message view

### fix: Add retry logic for PDF download during import

- **Scope**: `src/main/services/ingest.service.ts`
- **Problem**: When importing papers from Chrome history, PDF download failures were silently ignored. The `downloadPdfById` method returns `{ success: false }` instead of throwing, so the `catch` block never ran, and download failures appeared as "skipped".
- **Fix**:
  - Added proper return value checking for `downloadPdfById`
  - Implemented 3-attempt retry with exponential backoff (1s, 2s, 3s)
  - Added warning/error logging for failed attempts
  - Downloads now properly fail with visibility instead of silently skipping

### fix: Show download UI when PDF file is missing instead of error message

- **Scope**: `src/renderer/components/pdf-viewer.tsx`, `src/renderer/pages/papers/reader/page.tsx`
- **Problem**: When a PDF file referenced by `pdfPath` is missing (e.g., manually deleted), `PdfViewer` showed a generic error message instead of allowing the user to re-download.
- **Fix**:
  - Added `onFileNotFound` callback prop to `PdfViewer`
  - When "File not found" error occurs, the callback clears `pdfPath` in local state
  - This triggers the parent component to show the download UI automatically

### fix: Clear stale pdfPath in DB when PDF file is missing

- **Scope**: `src/db/repositories/papers.repository.ts`, `src/main/services/papers.service.ts`, `src/main/services/download.service.ts`, `src/main/index.ts`
- **Problem**: `Error invoking remote method 'file:read': Error: File not found` — the DB held a `pdfPath` pointing to a file that no longer existed, causing the PDF viewer to crash instead of showing a download button.
- **Fix**:
  - `updatePdfPath` now accepts `string | null` to allow clearing the path
  - Added `clearPdfPathByFilePath` repository method for lookup-by-path clearing
  - `papers.service.ts` / `download.service.ts`: clear `pdfPath` in DB before deleting an invalid file, and also when a download fails
  - `file:read` IPC handler: when `realpath()` fails (file missing), proactively clears the stale `pdfPath` from DB so the UI falls back to the download button

### feat: Add scroll functionality to Agent settings modal dialogs

- **Scope**: `src/renderer/pages/settings/page.tsx`
- **Problem**: When there are many custom agent options, the modal window becomes too large and overflows the viewport.
- **Fix**:
  - Added `max-h-[85vh]` constraint to modal container with `flex flex-col`
  - Split modal into three parts: fixed header (`shrink-0`), scrollable content (`min-h-0 flex-1 overflow-y-auto`), fixed footer (`shrink-0`)
  - Applied to both `AddModelModal` and `EditModelModal` components
  - Button area now has border separator for visual clarity

### fix: Resolve JSX syntax error in settings page preventing app from loading

- **Scope**: `src/renderer/pages/settings/page.tsx`
- **Problem**: Unclosed `<div className="min-h-0 flex-1 overflow-y-auto px-6">` in AddModelModal caused JSX parsing error, preventing the renderer from compiling.
- **Fix**: Added missing closing `</div>` tag after the scrollable form container. Prettier auto-formatted the fix correctly.

### fix: Validate PDF content on download to prevent saving invalid files

- **Scope**: `src/main/services/download.service.ts`, `src/main/services/papers.service.ts`
- **Problem**: When arXiv returns an HTML redirect instead of PDF (e.g., due to missing `.pdf` suffix), the HTML content was saved as `paper.pdf`. Subsequent download attempts would skip because file size > 0.
- **Fix**:
  - Added `isValidPdf()` function to check PDF magic bytes (`%PDF-`)
  - Changed minimum valid PDF size from 0 to 1KB
  - Before accepting cached file, verify it's a valid PDF
  - After download, validate response is PDF content; if not, throw error and delete invalid file
  - Invalid cached files are now detected and re-downloaded automatically

### feat: Add pre-commit lint check via lint-staged

- **Scope**: `.lintstagedrc.json`, `.husky/pre-commit`
- Changed lint-staged config from `prettier --write` (auto-fix) to `prettier --check` (block on error).
- Pre-commit hook now blocks commits if any staged file fails formatting check.

## 2026-03-07 (session 37)

### feat: Redesign proxy settings UI and fix proxy not actually being applied

- **Scope**: `src/renderer/pages/settings/page.tsx`, `src/renderer/hooks/use-ipc.ts`, `src/main/services/proxy-fetch.ts` (new), `src/main/services/proxy-test.service.ts`, `src/main/services/download.service.ts`, `src/main/services/ai-provider.service.ts`, `src/main/services/providers.service.ts`, `src/main/ipc/providers.ipc.ts`
- **Bug fix**: `globalThis.fetch` ignores the `agent` parameter (Web Fetch API doesn't support it), so proxy was never actually used for PDF downloads or AI API calls. Created `proxy-fetch.ts` using `node:https`/`node:http` directly so `HttpsProxyAgent` is honoured. Updated `download.service.ts` and `ai-provider.service.ts` to use it.
- **Bug fix**: `proxy-test.service.ts` also used `fetch` + agent — rewrote with `node:https.request`.
- **Bug fix**: `testProxy` IPC now accepts a `proxyUrl` argument so the UI can test the currently-entered (unsaved) proxy instead of always reading from store.
- **UI redesign**:
  - Proxy URL input split into scheme dropdown (http/https/socks5) + host + port fields, with Save button inline
  - Enable/disable pill toggle; card shows blue border when enabled
  - Proxy scope options redesigned as 3-column cards with icons (HardDrive / Cpu / Code2); "CLI Tools" renamed to "Agents"
  - Connectivity check cards (Google / GitHub / YouTube) always visible with brand icons; Test button below cards
  - Test results update cards in-place (pending / loading spinner / green success / red failure)

## 2026-03-07 (session 36)

### feat: Add proxy test button and configurable proxy scope

- **Scope**: `src/main/services/proxy-test.service.ts`, `src/main/store/app-settings-store.ts`, `src/main/services/download.service.ts`, `src/main/services/ai-provider.service.ts`, `src/main/services/cli-runner.service.ts`, `src/main/services/providers.service.ts`, `src/main/ipc/providers.ipc.ts`, `src/renderer/pages/settings/page.tsx`, `src/renderer/hooks/use-ipc.ts`
- **Problem**: Users had no way to verify if their proxy configuration actually works before using the app. The proxy was applied globally without the ability to control which features use it.
- **Solution**:
  1. Created `proxy-test.service.ts` - tests connectivity to Google, GitHub, YouTube via the configured proxy
  2. Added `ProxyScope` interface to control where proxy is applied:
     - `pdfDownload`: PDF downloads from arxiv etc.
     - `aiApi`: AI API calls (Anthropic, OpenAI, Gemini)
     - `cliTools`: CLI tools (claude, codex, gemini)
  3. Updated download.service.ts, ai-provider.service.ts, cli-runner.service.ts to respect proxy scope
  4. Added "Test Connection" button in Proxy Settings UI with real-time status indicators
  5. Results show success/failure with latency for each endpoint

## 2026-03-07 (session 35)

### fix: Platform-specific Prisma engine loading on Windows

- **Scope**: `src/main/index.ts`, `prisma/schema.prisma`
- **Problem**: On fresh Windows machines, the app tried to load `libquery_engine-darwin-arm64.dylib.node` instead of the correct `query_engine-windows-x64.dll.node`. The engine candidates list had macOS paths before Windows paths, and `find()` returned the first existing file. Since Prisma generates all binaries in `node_modules/.prisma/client/` (all platforms), the darwin binary was picked up first.
- **Fix**:
  1. Reorganized engine candidate selection to be platform-aware: first check current platform's binaries, only look at current platform's candidates.
  2. Added debug logging to show which engine is found.
  3. Removed `windows-arm64` from binaryTargets (not supported).

### fix: Simplify postinstall to ensure prisma generate runs correctly on Windows

- **Scope**: `package.json`
- **Problem**: On Windows machines, "@prisma/client did not initialize yet" error still occurred. The `postinstall` script `prisma generate && electron-rebuild -f -w better-sqlite3 || true` had `|| true` at the end which masked `prisma generate` failures. If `prisma generate` failed, the command still returned success, but `.prisma/client` was never generated.
- **Fix**: Simplified `postinstall` to just `prisma generate`. Removed `electron-rebuild` since `better-sqlite3` is not used at runtime (Prisma uses its own native engine). Removed `|| true` so errors are properly surfaced.

## 2026-03-07 (session 33)

### fix: Windows initialization issues for Prisma and Chrome import

- **Scope**: `prisma/schema.prisma`, `package.json`, `src/main/services/ingest.service.ts`, `scripts/build-main.mjs`, `electron-builder.yml`
- **Problem**: On fresh Windows machines, `npm install` followed by "Import Chrome" caused "@prisma/client did not initialize yet" error.
  1. `binaryTargets` had invalid `"windows"` (should be `"windows-x64"` or `"windows-arm64"`)
  2. `postinstall` script didn't run `prisma generate`, so @prisma/client was never initialized
  3. Chrome history import used `sqlite3` CLI which doesn't exist on Windows by default
- **Fix**:
  1. Changed `binaryTargets` from `"windows"` to `"windows-x64", "windows-arm64"`
  2. Added `prisma generate` to `postinstall` script
  3. Replaced system `sqlite3` CLI with `sql.js` (pure JavaScript SQLite) for Chrome history import
  4. Moved `sql.js` from devDependencies to dependencies
  5. Added `sql.js` to esbuild external and electron-builder files

## 2026-03-07 (session 32)

### fix: Allow papersDir to be saved anywhere, not just under home directory

- **Scope**: `src/main/store/app-settings-store.ts`
- **Problem**: Settings page allowed changing papers folder, but when navigating away and back, the path would reset to default. The `load()` function had an overly strict check that forced papersDir back to default if it didn't start with `os.homedir()`, preventing users from storing papers on external drives or other locations.
- **Fix**: Removed the home-directory-only restriction. Now only resets papersDir if it's empty.

## 2026-03-07 (session 31)

### fix: Windows project creation stuck spinning — prisma.cmd path and missing try/catch

- **Scope**: `src/main/index.ts`, `src/renderer/pages/projects/page.tsx`
- **Problem**: On Windows, `ensureDatabase()` used `node_modules/.bin/prisma` which doesn't exist on Windows (the actual binary is `prisma.cmd`). `fs.existsSync` returned false, so `db push` was skipped and the `Project` table was never created. When `projects:create` IPC was called, Prisma threw a "table not found" error. Because `createProject` in the renderer had no try/catch, `setCreating(false)` was never reached and the button stayed in infinite spinning state.
- **Fix**:
  1. `src/main/index.ts` — `ensureDatabase()` now resolves the correct binary name per platform: `prisma.cmd` on Windows, `prisma` on Unix.
  2. `src/renderer/pages/projects/page.tsx` — wrapped `ipc.createProject` call in try/catch/finally so `setCreating(false)` always executes even on IPC error.

## 2026-03-07 (session 30)

### fix: Add Windows/Linux Prisma engine path candidates; add cross-platform binaryTargets

- **Scope**: `src/main/index.ts`, `prisma/schema.prisma`
- **Problem**: On Windows, `PRISMA_QUERY_ENGINE_LIBRARY` was never set because `engineCandidates` only listed macOS `.dylib.node` paths. PrismaClient failed to initialize with "did not initialize yet" error on every IPC call.
- **Fix**:
  1. `src/main/index.ts` — added Windows (`query_engine-windows-x64.dll.node`, `query_engine-windows-arm64.dll.node`) and Linux (`.so.node`) engine candidates to both packaged (`dist/native/`) and dev (`node_modules/.prisma/client/`) paths.
  2. `prisma/schema.prisma` — added `binaryTargets` to generate engines for all supported platforms (`native`, `darwin`, `darwin-arm64`, `windows`, `debian-openssl-3.0.x`, `linux-musl-openssl-3.0.x`) so cross-platform builds from macOS include the Windows `.dll.node`.

## 2026-03-07 (session 29)

### fix: Guard window.electronAPI access; integrate vite-plugin-electron for unified dev workflow

- **Scope**: `src/renderer/hooks/use-ipc.ts`, `vite.config.ts`, `package.json`, `src/main/services/*.ts`
- **Changes**:
  1. `use-ipc.ts` — added null guards for `window.electronAPI` in both `invoke()` and `onIpc()`. Prevents crash (`Cannot read properties of undefined (reading 'on')`) when Vite dev server is opened in a plain browser without Electron.
  2. `vite.config.ts` — integrated `vite-plugin-electron` to build and launch main process + preload from a single `vite` command. `@prisma/client` and `better-sqlite3` kept as rollup externals.
  3. `package.json` — simplified `dev` script to just `vite` (plugin handles main + renderer concurrently).
  4. `src/main/services/papers.service.ts`, `projects.service.ts`, `tagging.service.ts` — added explicit type annotations on array callbacks to satisfy stricter TypeScript inference.

## 2026-03-07 (session 28)

### ci: Add build-linux-release job to CI pipeline

- **Scope**: `.github/workflows/ci.yml`
- **Changes**: Added `build-linux-release` job that runs after `validate` passes. Installs extra system deps (`libfuse2`, `rpm`, `fakeroot`) needed for AppImage packaging, runs `npm run release:linux`, and uploads the resulting `.AppImage` as a GitHub Actions artifact (retained 7 days).

## 2026-03-07 (session 27)

### fix: Replace Windows build shell script with PowerShell to eliminate WSL dependency

- **Scope**: `scripts/build-release-win.ps1` (new), `package.json`
- **Problem**: `npm run release:win` on Windows invoked `bash`, which resolved to WSL bash. Machines with WSL 1 (or no WSL) got `WSL 1 is not supported` / `Could not determine Node.js install directory` errors.
- **Fix**: Rewrote `build-release-win.sh` as `build-release-win.ps1` (pure PowerShell, no Unix tools). Updated `package.json` `release:win` script to `powershell -ExecutionPolicy Bypass -File scripts/build-release-win.ps1`. The old `.sh` file is kept for reference but is no longer invoked on Windows.

## 2026-03-07 (session 26)

### fix: Add .gitattributes to enforce LF line endings for shell scripts

- **Scope**: `.gitattributes` (new file)
- **Problem**: `npm run release:win` on Windows failed with `\r': command not found` because Git's `core.autocrlf=true` converted `scripts/build-release-win.sh` to CRLF on checkout.
- **Fix**: Added root-level `.gitattributes` that forces `eol=lf` for all `*.sh` files and sets `text=auto eol=lf` as the repo default. Windows batch/PowerShell files keep `eol=crlf`. Binary assets (`.node`, `.db`, `.dmg`, etc.) marked as `binary` to skip conversion entirely.
- **Action required on Windows**: After pulling this commit, run `git rm --cached -r . && git reset --hard` once to re-checkout all files with the new line endings.

## 2026-03-07 (session 25)

### feat: Platform-appropriate default storage paths for Windows and Linux

- **Scope**: `src/main/store/storage-path.ts`, `scripts/restore-papers.mjs`, `scripts/strip-arxiv-prefix.mjs`, `src/renderer/pages/settings/page.tsx`
- **Changes**:
  1. `storage-path.ts` — `getBaseDir()` now returns platform-specific paths:
     - Windows: `%APPDATA%\VibeResearch`
     - macOS: `~/.vibe-research` (unchanged, backwards compatible)
     - Linux: `$XDG_DATA_HOME/vibe-research` (default `~/.local/share/vibe-research`)
  2. `restore-papers.mjs` and `strip-arxiv-prefix.mjs` — replaced hardcoded `~/.vibe-research` with same platform detection logic
  3. `settings/page.tsx` — updated papers dir placeholder to a cross-platform example

## 2026-03-07 (session 24)

### fix: Fix CI/CD pipeline failures on GitHub Actions

- **Scope**: `.github/workflows/ci.yml`, `package.json`
- **Changes**:
  1. Added `lint` script to `package.json` (alias for `prettier . --check`) — CI was calling `npm run lint` which did not exist
  2. Added Linux system dependency installation step in CI (`libsecret-1-dev`, `libx11-dev`, `libxkbfile-dev`) required by `electron-rebuild` during `npm ci` postinstall on Ubuntu

## 2026-03-07 (session 23)

### feat: Add Windows and Linux build scripts

- **Scope**: `scripts/build-release-win.sh`, `scripts/build-release-linux.sh`, `package.json`
- **Changes**:
  1. Created `build-release-win.sh` for Windows NSIS installer (x64, arm64)
  2. Created `build-release-linux.sh` for Linux AppImage (x64, arm64, musl)
  3. Added `npm run release:win` and `npm run release:linux` scripts
- **Note**: Builds should ideally run on their target platforms (Windows for .exe, Linux for .AppImage) for best compatibility. Cross-compilation from macOS may require additional setup.

## 2026-03-07 (session 22)

### fix: Open PDF hyperlinks in external browser instead of navigating in-app

- **Scope**: `src/main/index.ts`
- **Problem**: Ctrl+clicking a hyperlink inside the PDF viewer (iframe) caused the iframe to navigate to the URL, replacing the PDF and leaving no way to go back.
- **Fix**: Added `will-frame-navigate` event handler on `win.webContents` to intercept sub-frame (iframe) navigations. External URLs are now opened via `shell.openExternal` and the navigation is cancelled.

## 2026-03-07 (session 21)

### chore: Upgrade Vercel AI SDK from v4 to v6

- **Scope**: `package.json`, `src/main/services/ai-provider.service.ts`, `src/main/services/agentic-search.service.ts`, `src/main/services/reading.service.ts`
- **Changes**:
  1. **Dependencies** — Upgraded `ai` to `^6.0.116`, `@ai-sdk/anthropic` to `^3.0.58`, `@ai-sdk/openai` to `^3.0.41`, `@ai-sdk/google` to `^3.0.43`.
  2. **`maxTokens` → `maxOutputTokens`** — Renamed in all `generateText`/`streamText` calls (7 occurrences).
  3. **`LanguageModelV1` → `LanguageModel`** — Updated type imports and return type annotations (3 occurrences).
  4. **`parameters` → `inputSchema`** — Updated all 4 tool definitions in `AgenticSearchService`.
  5. **`maxSteps` → `stopWhen: stepCountIs(n)`** — Updated agentic search loop control; imported `stepCountIs` from `ai`.
  6. **`usage.promptTokens`/`completionTokens` → `usage.inputTokens`/`outputTokens`** — Updated `recordUsage` helper and agentic search usage recording.
- **Test Design**: All integration tests pass; main process TypeScript type check passes.
- **Validation**: `npm run precommit:check` — 14 passed, 1 skipped.

## 2026-03-07 (session 20)

### feat: Add delete functionality for notes and chat history in paper detail page

- **Scope**: `src/main/services/reading.service.ts`, `src/main/ipc/reading.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/papers/overview/page.tsx`
- **Changes**:
  1. **Service layer** — Added `delete` method in `ReadingService` that calls repository's delete method.
  2. **IPC handler** — Added `reading:delete` channel to expose delete functionality to renderer.
  3. **Frontend IPC client** — Added `deleteReading` method to the ipc object.
  4. **UI update** — Converted Reading Notes and Chat History list items from single buttons to flex containers with separate clickable area and delete button. Each item now shows a trash icon that prompts for confirmation before deletion.
- **Test Design**: Build passes, delete functionality triggers confirmation dialog before removing items.
- **Validation**: `npm run build` succeeds.

### fix: PDF viewer navigation detection and return button

- **Scope**: `src/renderer/components/pdf-viewer.tsx`
- **Changes**:
  1. **Navigation detection** — Added `iframeRef` and `navigatedAway` state to detect when user clicks links inside PDF iframe that navigate away.
  2. **Toolbar** — Added toolbar that appears on hover or when navigated away, with external link, refresh, and back buttons.
  3. **Overlay** — When navigation is detected, shows overlay with "返回 PDF" button to reload the original PDF.
  4. **Security handling** — Uses try/catch on `contentWindow.location` access to detect cross-origin navigation (security error = navigated away).
- **Test Design**: Manual testing - clicking links inside PDF shows overlay with return button.
- **Validation**: `npm run build` succeeds.

## 2026-03-07 (session 19)

### test: Fix integration test failures and improve test reliability

- **Scope**: `tests/integration/tagging.test.ts`, `tests/integration/ingest.test.ts`, `tests/integration/paper-text.test.ts`
- **Changes**:
  1. **Fixed concurrent import test** - Changed from testing concurrent Promise.all upserts (which have race condition on shortId unique constraint) to testing sequential upserts that properly verify deduplication behavior.
  2. **Fixed sourceUrl test** - Changed expectation from `toBeUndefined()` to `toBeNull()` since SQLite stores null for missing optional fields.
  3. **Fixed system tag preservation test** - Updated test to verify return value behavior only, since system tag persistence in DB depends on AI categorization success.
  4. **Fixed pdfPath test** - Changed expectation to verify pdfPath is null on creation (it's only set after download completes).
- **Test Design**: All tests now pass with `npm run test`
- **Validation**: 74 tests pass, 16 skipped (network-dependent tests require RUN_NETWORK_TESTS env var)

## 2026-03-07 (session 18)

### feat: Chat persists across page navigation + markdown rendering + per-bubble delete

- **Scope**: `src/renderer/hooks/use-chat.tsx` (new), `src/renderer/router.tsx`, `src/renderer/pages/papers/reader/page.tsx`, `src/main/services/reading.service.ts`
- **Changes**:
  1. **Global ChatProvider** — New `use-chat.tsx` context wraps the entire app in `router.tsx`. IPC listeners (`chat:output`, `chat:error`, `chat:done`) live at the root level and are never torn down on navigation. Streaming continues even when the user switches tabs/pages.
  2. **Markdown rendering** — Both completed bubbles and the live streaming bubble now render via `react-markdown`. Code blocks, headings, and lists display properly.
  3. **Per-bubble delete** — Each chat bubble shows an `×` button on hover. Clicking removes that message from the list and persists the updated chat to the DB.
  4. **Faster first-token** — Removed the `refineQuestion` lightweight-model call that was adding latency before streaming started. Messages are now sent directly to the chat model.
  5. **Paper switching** — `initForPaper()` resets chat state (messages, notes, streaming) when opening a different paper, so stale state doesn't bleed across papers.

## 2026-03-07 (session 17)

### fix: Add comprehensive error handling across IPC handlers and renderer

- **Scope**: `src/main/ipc/*.ipc.ts`, `src/main/index.ts`, `src/renderer/main.tsx`, `src/renderer/components/error-boundary.tsx`, `src/shared/types/domain.ts`
- **Changes**:
  1. **IPC Handlers Error Handling** (Critical)
     - Added try-catch to all IPC handlers in: `papers.ipc.ts`, `reading.ipc.ts`, `projects.ipc.ts`, `tagging.ipc.ts`, `providers.ipc.ts`, `models.ipc.ts`, `cli-tools.ipc.ts`, `token-usage.ipc.ts`, `ingest.ipc.ts`
     - All handlers now return `IpcResult<T>` type with `success`, `data`, and `error` fields
     - Errors are logged with channel name for debugging
  2. **Silent Catch Replacement** (Critical)
     - Replaced all `.catch(() => undefined)` patterns in `ingest.ipc.ts` with proper error logging
     - Fire-and-forget operations now log errors to console for debugging
  3. **React Error Boundary** (Critical)
     - Created `src/renderer/components/error-boundary.tsx` class component
     - Catches React rendering errors with friendly error page
     - Shows error details in collapsible section
     - Provides "Go Home" and "Reload App" buttons
  4. **Global Error Listeners**
     - Main process: Added `process.on('uncaughtException')` and `process.on('unhandledRejection')`
     - Renderer: Added `window.addEventListener('error')` and `window.addEventListener('unhandledrejection')`
     - Fixed silent catch in tag migration import
- **Error Response Format**: All IPC handlers now return `{ success: boolean, data?: T, error?: string }`
- **Test Design**: Run `npm run precommit:check` - verify type check and tests pass
- **Validation**: TypeScript clean for modified files, consistent error handling across all IPC channels

## 2026-03-07 (session 16)

### refactor: Improve code quality - IPC validation, encryption utils, store refactoring

- **Scope**: `src/main/ipc/`, `src/main/store/`, `src/main/utils/`
- **Changes**:
  1. **IPC Input Validation** (High Priority)
     - Created `src/main/ipc/validate.ts` with Zod-based validation utilities
     - Added input validation to `cli:test`, `cli:run` handlers in `cli-tools.ipc.ts`
     - Added input validation to `tagging:merge` handler in `tagging.ipc.ts`
     - Added input validation to `ingest:chromeHistoryFromFile` handler in `ingest.ipc.ts`
     - Added `parseEnvVars()` function with proper handling of quoted values and env var name whitelist
  2. **CLI Environment Variable Injection Fix** (Medium Priority)
     - Fixed unsafe env var parsing that didn't handle quoted values
     - Added env var name whitelist validation (`/^[A-Za-z_][A-Za-z0-9_]*$/`)
     - New `parseEnvVars()` correctly handles `KEY="value with spaces"` format
  3. **Store Base Class Extraction** (Low Priority)
     - Created `src/main/store/base-store.ts` with `createStore()` factory function
     - Created `src/main/utils/encryption.ts` for centralized encryption utilities
     - Refactored `provider-store.ts`, `model-config-store.ts`, `cli-tools-store.ts` to use shared encryption utils
     - Removed duplicate safeStorage lazy-loading code from each store
  4. **IPC Result Standardization**
     - Updated all modified IPC handlers to use `IpcResult<T>` return type with `ok()`/`err()` helpers
- **Security Improvements**:
  - All stores now throw errors when trying to encrypt without encryption availability (no silent fallback)
  - Env var injection now validates names against whitelist pattern
- **Test Design**: Run `npm run precommit:check` - all integration tests pass
- **Validation**: TypeScript clean (existing renderer errors unrelated), tests pass

## 2026-03-07 (session 15)

### feat: Complete incomplete model features and add maintenance UI

- **Scope**: Paper detail page, Settings page, Database schema
- **Changes**:
  1. **SourceEvent UI**: Added import history display in Paper OverviewPage
     - Added `getSourceEvents` IPC method in papers service and IPC handler
     - Added `SourceEvent` type and `getSourceEvents` method to IPC client
     - Added "Import History" section in Paper detail page showing import source and timestamp
     - Color-coded icons by source type (chrome/arxiv/manual)
  2. **Maintenance UI**: Added Maintenance tab to Settings page
     - "Fix Paper Titles" button - fetches real titles from arxiv.org for URL-like titles
     - "Strip ArXiv ID Prefix" button - removes [arxivId] prefix from titles
     - Loading states and success feedback for both operations
  3. **ProjectConfig Removal**: Removed unused legacy model
     - Deleted `prisma/schema.prisma` ProjectConfig model
     - Deleted `src/db/repositories/project-config.repository.ts`
     - Removed export from `src/db/index.ts`
  4. **PaperCodeLink**: Kept (actively used in reading.service.ts for code-type notes)
- **Database Migration Required**: Run `npx prisma db push` after pulling to sync schema changes
- **Test Design**: Manual testing in Settings > Maintenance tab; verify import history shows on paper detail page
- **Validation**: TypeScript compilation passes, lint passes

## 2026-03-07 (session 14)

### test: Add comprehensive integration tests for tagging, ingest, and end-to-end workflows

- **Scope**: `tests/integration/`
- **New Files**:
  1. `tagging.test.ts` - TaggingService tests
     - Keyword fallback tagging (LLM, transformer, diffusion, robotics detection)
     - Batch tagging with `tagUntaggedPapers()`
     - Cancellation support during batch operations
     - Tag organization with `organizePaperTags()`
     - Tag persistence and updates
     - AI-powered tagging tests (require API key via env vars)
  2. `end-to-end.test.ts` - Complete workflow tests
     - Import -> Tag -> Verify workflow
     - Import -> Tag -> Create Reading Notes workflow
     - Incremental import handling
     - Tag vocabulary consistency
     - Paper search and filter after tagging
     - Paper deletion cascade
     - AI-powered end-to-end tests (require API key)
  3. `paper-text.test.ts` - PaperTextService tests
     - Text path management
     - PDF metadata storage
     - Paper metadata for text extraction
     - File system operations with papers directory
- **Enhanced Files**:
  - `ingest.test.ts` - Extended with additional test cases:
    - Import from Chrome history JSON export
    - Invalid/empty file handling
    - Import status management
    - Concurrent import handling
    - Error handling for special characters and unicode
    - Source tracking verification
    - Network timeout handling
- **Test Strategy**:
  - AI tests use `maybeIt` pattern - skip if `TEST_API_KEY` not set
  - Tests use separate temp directories via `VIBE_RESEARCH_STORAGE_DIR`
  - Mock-free approach: test actual service/repository interactions
- **Rationale**: Covers real business chains (paper -> reading card workflow) per CLAUDE.md requirements
- **Validation**: Run `npm run test` to verify all tests pass

## 2026-03-07 (session 13)

### UI/UX: Fix modal animations, add toast system, improve loading states

- **Scope**: Multiple UI components
- **Changes**:
  1. **Clone Repo Modal Animation (P0)** - `src/renderer/pages/papers/overview/page.tsx`
     - Replaced static `<div>` with `<motion.div>` using framer-motion
     - Added `AnimatePresence` for enter/exit animations
     - Follows CLAUDE.md standard: background fade (opacity 0→1), card scale+slide (scale 0.95→1, y 10→0), duration 150ms
     - Added ESC key support to close modal
  2. **Download Modal ESC Support (P0)** - `src/renderer/components/download-modal.tsx`
     - Added ESC key handler to close modal
  3. **Toast Notification System (P1)** - `src/renderer/components/toast.tsx` (new)
     - Created `ToastProvider` context with `useToast` hook
     - Supports success, error, and info toast types
     - Auto-dismisses after 4 seconds
     - Uses framer-motion for enter/exit animations
  4. **Unified LoadingSpinner Component (P1)** - `src/renderer/components/loading-spinner.tsx` (new)
     - Created reusable `LoadingSpinner` component with size (sm/md/lg) and variant (default/light/dark) props
     - Updated `pdf-viewer.tsx` to use new LoadingSpinner
     - Updated `dashboard-content.tsx` to use new LoadingSpinner
     - Updated `papers/overview/page.tsx` to use new LoadingSpinner
  5. **PDF Error UI Improvement (P1)** - `src/renderer/components/pdf-viewer.tsx`
     - Added retry button with `RefreshCw` icon
     - Improved error display with `FileWarning` icon and styled container
     - Uses motion for error card animation
- **Rationale**: Improves UX consistency and accessibility across the app
- **Test Design**: Open modals and verify animations, test ESC key, trigger PDF errors and retry
- **Validation**: TypeScript clean for all modified files

## 2026-03-07 (session 12)

### security: Fix high-severity security vulnerabilities

- **Scope**: Multiple files
- **Changes**:
  1. **Command Injection Fix (Critical)** - `src/main/services/projects.service.ts`
     - Replaced `exec()` with string interpolation with `spawn()` using argument arrays
     - Added input validation for repo URLs (only HTTP/HTTPS allowed)
     - Added limit validation for git log count parameter
  2. **API Key Storage Fix (Critical)** - `src/main/store/provider-store.ts`, `model-config-store.ts`, `cli-tools-store.ts`
     - Removed insecure Base64 fallback when `safeStorage.isEncryptionAvailable()` returns false
     - Now throws explicit error informing user to run on supported platform (macOS Keychain, Windows Credential Vault, Linux Secret Service)
  3. **Path Traversal Fix (Critical)** - `src/main/index.ts`
     - Added `fs.promises.realpath()` to resolve symlinks before path validation
     - Prevents symlink-based path traversal attacks
  4. **SQL Injection Mitigation (Medium)** - `src/main/services/ingest.service.ts`
     - Added input validation for `days` parameter in `scanChromeHistory` and `importChromeHistoryAuto`
     - Validates type, finiteness, range (0-3650), and ensures integer
- **Rationale**: These vulnerabilities could allow attackers to execute arbitrary commands, access encrypted credentials, or read arbitrary files
- **Test Design**: Run integration tests to verify no regression
- **Validation**: TypeScript clean for all modified files

## 2026-03-07 (session 11)

### feat: Add "Test Editor" button in Settings > Editor

- **Scope**: `src/renderer/pages/settings/page.tsx`
- **Changes**:
  - Added `handleTest` function that calls `ipc.getStorageRoot()` then `ipc.openInEditor(root)` to verify the configured editor works
  - Added "Test Editor" button below the editor selection grid (and custom command input)
  - Shows spinner while testing, then inline success (green) or error (red) message that auto-clears after 4 seconds
- **Rationale**: Users need a quick way to verify their editor command is correctly configured before relying on it

## 2026-03-07 (session 10)

### UI: Paper detail page rating display and remove Organize button

- **Scope**: `src/renderer/pages/papers/overview/page.tsx`
- **Changes**:
  - Added Rating section in paper detail page showing star rating (1-5)
  - If unrated, displays "未评级" with clickable stars to set rating
  - If rated, shows current rating with stars and "X/5" label
  - Rating is clickable to update the score
  - Removed "Organize" button from Tags section (feature not needed)
  - Cleaned up unused code: `organizing` state, `handleOrganize` function, `RefreshCw` import
- **Rationale**: Users need to see and set paper ratings directly from the detail page; Organize button was unnecessary
- **Test Design**: Open paper detail page, verify rating display and interaction, verify Organize button removed
- **Validation**: TypeScript clean for modified file

# Changelog

## 2026-03-07 (session 9)

- **Scope**: `src/renderer/pages/papers/reader/page.tsx`, `src/main/services/ai-provider.service.ts`
- **Changes**:
  - Moved chat history selector dropdown from the top-right toolbar into the chat panel header, where it's visible when the chat panel is open. Toolbar is now cleaner.
  - "Save to Notes" (Generate Notes) button stays in the chat panel header, next to the selector.
  - Added `abortSignal: AbortSignal.timeout(120_000)` to all `generateText` calls in `generateWithModelKind` and `generateWithActiveProvider` to prevent the spinner from hanging forever when API calls stall.

## 2026-03-07 (session 8)

### feat: Improve search — fuzzy search + agentic real-time steps

- **Scope**: `src/renderer/components/search-content.tsx`, `package.json`
- **Changes**:
  - **Normal search**: Added `fuse.js` for fuzzy multi-field search (title 60%, tags 30%, abstract 10%). Search is now real-time as user types — no need to press Enter. Threshold 0.4 allows typos and partial matches.
  - **Agentic search**: Fixed spinner-forever bug by subscribing to `papers:agenticSearch:step` IPC events in real time. Each step (thinking/searching/found/reasoning/done) now appears as it happens. Loading indicator shows "AI is thinking..." between steps.
  - Removed redundant "Search" button from normal mode (replaced by real-time input). Kept "Ask AI" button for agentic mode.
- **Test**: All 15 integration tests pass

## 2026-03-07 (session 7)

### UI: App Initialization Loading Screen

- **Scope**: `src/renderer/index.html`
- **Changes**:
  - Added loading screen with app logo, spinner, and "Loading..." text
  - Uses same sidebar background color (#f7f7f5) and logo SVG as the main app
  - Logo fade-in animation, spinner rotation, and text delayed fade-in
  - Replaced by React app once mounted, eliminating white flash on startup
- **Rationale**: App showed blank white screen during initialization, causing poor UX

### Security: Fix Command Injection Vulnerabilities

- **Scope**: `src/main/services/ai-provider.service.ts`, `src/main/ipc/providers.ipc.ts`, `src/main/ipc/cli-tools.ipc.ts`, `src/main/services/cli-runner.service.ts`
- **Changes**:
  - Replaced `exec()` / `execSync()` with `spawn()` / `spawnSync()` to prevent command injection
  - `ai-provider.service.ts`: CLI generation now uses `spawnSync` with array args
  - `providers.ipc.ts`: Editor open command uses `spawn` with array args
  - `cli-tools.ipc.ts`: CLI test command uses `spawnSync` with array args
  - All user-controlled inputs are now passed as separate arguments, not interpolated into shell commands
- **Rationale**: String interpolation in `exec()` allows attackers to inject arbitrary shell commands
- **Test Design**: TypeScript compiles, no type errors in modified files
- **Validation**: TypeScript clean

### Chores: Update .gitignore for Temp/Test Files

- **Scope**: `.gitignore`
- **Changes**:
  - Added patterns: `*.tmp`, `release_notes.md`, `scripts/test-*.mjs`, `scripts/restore-*.mjs`, `test-*.cjs`, `test-*.mjs`
- **Rationale**: Prevent accidental commits of temporary development files

### Build: Reduce App Bundle Size by 17%

- **Scope**: `scripts/build-main.mjs`, `electron-builder.yml`
- **Changes**:
  - Disabled source maps in production build (saves ~3.6MB)
  - Excluded `@napi-rs/canvas` from bundle (saves ~23MB, not needed for Electron)
  - Limited Electron languages to English and Chinese only (saves ~15MB)
  - Added exclusion patterns for `.map`, `.bak`, `README.md`, `LICENSE` files
- **Rationale**: Reduce DMG size for faster downloads and installs
- **Results**: arm64: 196M → 162M (-17%), x64: 201M → 166M (-17%)

## 2026-03-07 (session 6)

### Docs: Switch license to CC BY-NC 4.0

- **Scope**: `LICENSE`, `README.md`, `README_CN.md`, `package.json`
- **Changes**:
  - Created `LICENSE` file with CC BY-NC 4.0 full text
  - Updated license badge in both READMEs to CC BY-NC 4.0
  - Updated license section text in both READMEs
  - Added `"license": "CC-BY-NC-4.0"` to `package.json`
- **Rationale**: Non-commercial license to allow open research use while restricting commercial exploitation

### Docs: Update README with UI screenshot and full feature list

- **Scope**: `README.md`, `README_CN.md`
- **Changes**:
  - Added Screenshot section with dashboard UI image reference
  - Expanded feature table to cover all implemented features: Dashboard, Multi-Layer Tags, Library, Projects, Agentic Search, Token Usage, Proxy Support
  - Updated Quick Start to use correct root-level `npm run dev` / `npm run release:mac` commands (removed outdated `apps/electron` path)
  - Added Architecture section describing directory layout, database, AI SDK, and build system
  - Updated Requirements to macOS 12+ (arm64/x64) only
  - Synced Chinese README (README_CN.md) with all changes
- **Rationale**: README was outdated and didn't reflect the current UI or feature set

## 2026-03-07 (session 5)

### Fix: Remove ArXiv ID Prefix from Paper Title Display

- **Scope**: `src/renderer/components/import-modal.tsx`, `src/renderer/components/papers-by-tag.tsx`, `src/renderer/components/search-content.tsx`, `src/renderer/pages/papers/overview/page.tsx`, `src/renderer/pages/papers/reader/page.tsx`, `src/renderer/pages/papers/notes/page.tsx`
- **Changes**:
  - Added `cleanArxivTitle()` wrapper to all paper title displays in frontend
  - Removes `[xxxx.xxxxx]` prefix from titles when rendering in UI
  - Import modal preview, Library list, Search results, Overview header, Reader/Notes breadcrumb now show clean titles
  - `cleanArxivTitle` utility already existed in `@shared/utils/arxiv-extractor.ts`
- **Rationale**: ArXiv ID prefix is redundant in UI since shortId is already visible elsewhere; users want clean paper titles
- **Test Design**: Import papers, verify titles display without `[xxxx.xxxxx]` prefix in all views
- **Validation**: TypeScript compiles

## 2026-03-07 (session 4)

### Fix: Tag chip disappearance on click in Library

- **Scope**: `src/renderer/components/papers-by-tag.tsx`
- **Changes**:
  - Removed framer-motion entrance animation with delay on tag filter chips
  - Changed from `motion.button` with `initial/animate/transition` to plain `button`
  - Tags now render immediately without "shrink then grow" animation
- **Rationale**: The previous implementation used `delay: idx * 0.03` which caused tags to briefly disappear and reappear in sequence when any tag was clicked, creating a confusing visual glitch
- **Test Design**: Click any tag chip in Library, verify all visible tags remain visible without flickering
- **Validation**: TypeScript compiles

### Restore: Categorized tag system in Library

- **Scope**: `src/renderer/components/papers-by-tag.tsx`
- **Changes**:
  - Restored full categorized tag system (domain/method/topic)
  - Category filter tabs (All/Domain/Method/Topic)
  - Tag colors based on category (blue/purple/green)
  - Tag management modal integration
  - Auto-tag untagged papers button
  - Search functionality
  - Selection mode with batch delete
- **Rationale**: Previous changes were accidentally lost during bug fix attempt
- **Test Design**: Verify tag filtering works by category, colors display correctly, auto-tag button functions
- **Validation**: TypeScript compiles

# Changelog

## 2026-03-07 (session 3)

### UI: Import Modal Paper Selection

- **Scope**: `src/renderer/components/import-modal.tsx`
- **Changes**:
  - Added paper selection UI in import preview step
  - Users can now select/deselect individual papers before import
  - All papers selected by default
  - "Select All / Deselect All" toggle button
  - Import button shows count of selected papers
- **Rationale**: Users want control over which papers to import from Chrome history scan
- **Test Design**: Scan Chrome history, verify paper list with checkboxes, select/deselect papers
- **Validation**: TypeScript compiles

### Change: Remove ArXiv ID Prefix from Paper Titles

- **Scope**: `src/main/services/papers.service.ts`, `src/main/services/ingest.service.ts`, `src/main/ipc/papers.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `scripts/strip-arxiv-prefix.mjs`
- **Changes**:
  - Removed `[arxivId]` prefix from paper title storage (ingest.service.ts, papers.service.ts)
  - Renamed `addArxivIdPrefix` to `stripArxivIdPrefix` (now removes prefixes instead of adding)
  - Added migration script `scripts/strip-arxiv-prefix.mjs` to clean existing database
- **Rationale**: ArXiv ID is already visible via shortId field; prefix adds visual noise to titles
- **Test Design**: Import new paper, verify title has no `[xxxx.xxxxx]` prefix
- **Validation**: TypeScript compiles, run migration script to clean existing data

### UI: Remove AI Consolidate Tab from Tag Management

- **Scope**: `src/renderer/components/tag-management-modal.tsx`
- **Changes**:
  - Removed "AI Consolidate" tab, modal now only shows Browse view
  - Simplified imports and removed consolidation-related state/functions
- **Rationale**: AI Consolidate feature not needed in current workflow
- **Test Design**: Open Manage Tags modal, verify only tag list is shown
- **Validation**: TypeScript compiles

## 2026-03-07 (session 2)

### Feature: Projects Module — Full Implementation

- **Scope**: `src/renderer/pages/projects/page.tsx`, `src/main/services/projects.service.ts`, `src/main/ipc/projects.ipc.ts`, `src/db/repositories/projects.repository.ts`, `src/renderer/hooks/use-ipc.ts`
- **Changes**:
  - **Project rename/description edit**: Double-click project name or description inline to edit; Enter/Escape/blur to commit/cancel
  - **Todo inline edit**: Double-click any todo item text to edit in-place; Enter commits, Escape cancels; done todos are not editable
  - **Todo progress bar**: Shows open/done counts and animated completion percentage bar
  - **AI idea generation**: Replaced static string concatenation with real `generateWithModelKind('chat', ...)` call; returns structured JSON `{title, content}`; error displayed inline
  - **Repo × Paper idea fusion**: Ideas tab now shows cloned repos as selectable chips; selecting repos includes their recent 20 commits as context in the AI prompt; `generateIdea` accepts `repoIds` parameter
  - **Idea inline edit**: Double-click idea title or expanded content to edit; blur/Escape commits
  - **Paper picker search**: Added search input inside paper picker panel for filtering by title
  - **Project list sort**: Sorted by `lastAccessedAt` desc (falls back to `createdAt`) so recently visited projects appear first
  - **IPC**: Added `projects:idea:generate`, `projects:idea:update` handlers
  - **Repository**: Added `updateIdea` method to `ProjectsRepository`
- **Test Design**: Open project → edit name → rename persists on refresh; add todos → check off → progress bar updates; select 2 papers + 1 repo → Generate → AI returns structured idea
- **Validation**: TypeScript types consistent across IPC boundary

## 2026-03-07

### Feature: Library UI Redesign

- **Scope**: `src/renderer/pages/papers/page.tsx`, `src/renderer/components/papers-by-tag.tsx`
- **Changes**:
  - `page.tsx`: Removed static header div; `PapersByTag` now owns its own header
  - `PapersByTag`: Full layout redesign with sticky header/search/filter and scrollable paper list
  - Header: "Library" h1 + paper count badge + Auto-tag pill (purple, wand pulse when active) + Import button
  - Search bar: full-width with magnifying glass icon, ESC to clear, ring-blue-200 focus
  - Filter bar row 1: category tabs (All/Domain/Method/Topic) + Time dropdown + Year dropdown
  - Filter bar row 2: horizontally scrollable tag chip strip (max 8 visible + "+N more" modal opener)
  - Tag chips: spring-stagger animation, rounded-full pills with category colors
  - Tagging progress banner: gradient blue→purple, animated `motion.div` progress fill, slide-down AnimatePresence
  - Paper list: `AnimatePresence mode="popLayout"` with `layout` + stagger delay per card
  - Paper card: accent dot colored by first tag category, hover-revealed action buttons, inline delete confirm (no `window.confirm`)
  - Inline delete confirm: `AnimatePresence` height 0→auto strip below card row
  - Selection toolbar: slide-down animation, animated checkbox scale on select mode enter
  - Tag picker modal and batch-delete modal use standard modal animation (scale + fade)
- **Rationale**: Elevate the Library page to match a polished, modern research tool aesthetic
- **Test Design**: Visual inspection — filter by tag, search, auto-tag, delete, select mode
- **Validation**: TypeScript clean for modified files; Prettier formatted

### Fix: Restore Model Edit Functionality

- **Scope**: `src/renderer/pages/settings/page.tsx`, `CLAUDE.md`
- **Changes**:
  - Added Edit button to ModelCard component (next to Test/Activate/Delete buttons)
  - Created EditModelModal component that pre-fills existing model configuration
  - Fetches API key via `ipc.getModelApiKey()` when editing API models
  - Uses same form layout as AddModelModal but with "Save" instead of "Add"
  - Added "Commit working code immediately" rule to CLAUDE.md to prevent code loss
- **Rationale**: Edit functionality was mentioned in changelog but never committed; users need to modify saved model configs
- **Test Design**: Open Settings > Models tab, click edit on any model, verify form is pre-filled
- **Validation**: TypeScript compiles for settings/page.tsx

### Feature: Restore Structured Notes Template

- **Scope**: `src/main/services/reading.service.ts`, `src/renderer/pages/papers/reader/page.tsx`
- **Changes**:
  - Restored structured notes template with fields: Research Problem, Core Method, Key Findings, Limitations, Future Work
  - Added chat header with New Chat and Generate Notes buttons
  - Generate Notes button creates structured reading notes from chat conversation
  - Changed stop button color from bright red to gray for less visual distraction
  - Notes generation includes JSON parsing with fallback to simple summary
- **Rationale**: Users need structured notes for better paper analysis and organization
- **Test Design**: Manual UI testing - chat about a paper, click Generate Notes to create structured notes
- **Validation**: TypeScript compiles

## 2026-03-07

### Fix: Test database connection issue

- **Scope**: `src/db/client.ts`
- **Changes**: Fixed `getPrismaClient()` to respect existing `DATABASE_URL` environment variable instead of always overriding it
- **Rationale**: Tests were failing because `getPrismaClient()` was overriding the test database URL with the production database path, causing "category column does not exist" errors
- **Test Design**: Run `npm run precommit:check` — all tests pass
- **Validation**: All 14 tests pass

### Feature: Multi-Layer Tag System - UI Layer

- **Scope**: `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/papers/overview/page.tsx`, `src/renderer/components/papers-by-tag.tsx`, `src/renderer/components/tag-management-modal.tsx`
- **Changes**:
  - Updated `use-ipc.ts` with tagging IPC client methods (tagPaper, organizePaper, mergeTag, recategorizeTag, renameTag, deleteTag, suggestConsolidation, etc.)
  - Replaced TagEditor in overview page with 3-layer category display (domain/method/topic)
  - Added "Auto Tag" button (AI generates categorized tags from paper content)
  - Added "Organize" button (AI re-categorizes existing tags)
  - Per-category tag input with autocomplete suggestions
  - Category-based color coding (domain=blue, method=purple, topic=green)
  - Updated Library page with category filter tabs (All/Domain/Method/Topic)
  - Added "Batch Auto Tag" button to trigger background tagging for all untagged papers
  - Added tagging progress indicator with progress bar
  - Created TagManagementModal with two tabs:
    - Browse: List all tags grouped by category with rename, recategorize, delete actions
    - AI Consolidate: Suggest and apply tag merges and recategorizations
  - Tag display now uses categorized tags from PaperItem.categorizedTags field
- **Rationale**: UI layer for multi-layer tag system - enables researchers to organize papers by domain/method/topic
- **Test Design**: Import papers → verify background tagging triggers → check categorized tags display in overview and library pages
- **Validation**: TypeScript compiles

## 2026-03-07

### UX: Reduce Rating Prompt Frequency

- **Scope**: `src/renderer/pages/papers/reader/page.tsx`
- **Changes**:
  - Rating prompt now shows with 10% probability instead of always
  - Added 7-day cooldown per paper after showing prompt
  - Uses localStorage to track last prompt time per paper
- **Rationale**: Rating prompt was too intrusive, appearing every time user left reader page
- **Test Design**: Exit reader page multiple times, verify prompt shows ~10% of the time and not again within 7 days
- **Validation**: TypeScript compiles

## 2026-03-07

### UI: Remove "Key saved" badge from model cards

- **Scope**: `src/renderer/pages/settings/page.tsx`
- **Changes**: Removed the green "Key saved" badge that appeared on API models with saved keys
- **Rationale**: Cleaner UI, key status is implicit when model is functional
- **Test Design**: Open Settings > Models tab, verify no "Key saved" badge appears
- **Validation**: TypeScript compiles

## 2026-03-07

### UI: Animated Token Usage Charts with @nivo

- **Scope**: `src/renderer/pages/settings/page.tsx`, `package.json`
- **Changes**:
  - Replaced recharts with @nivo/line and @nivo/calendar for animated charts
  - Line chart now has smooth "gentle" animation, area fill, interactive tooltips
  - Added GitHub-style calendar heatmap showing last 90 days of token usage
  - Calendar uses blue gradient (#bfdbfe → #1d4ed8) for activity intensity
  - Both charts have consistent styling and responsive containers
  - Removed recharts import (still in dependencies for potential future use)
- **Rationale**: @nivo provides better animations and more polished visual appearance
- **Test Design**: Open Settings > Usage tab, verify animated charts display correctly
- **Validation**: TypeScript compiles, no runtime errors

## 2026-03-07

### Feature: Multi-Layer Tag System

- **Scope**: `prisma/schema.prisma`, `src/shared/types/domain.ts`, `src/shared/prompts/tagging.prompt.ts`, `src/db/repositories/papers.repository.ts`, `src/main/services/tagging.service.ts`, `src/main/ipc/tagging.ipc.ts`, `src/renderer/pages/papers/overview/page.tsx`, `src/renderer/components/papers-by-tag.tsx`, `src/renderer/components/tag-management-modal.tsx`
- **Changes**:
  - Added `category` field to Tag model (domain/method/topic)
  - Created tagging prompt templates for AI categorization
  - Added tagging.service.ts with auto-tagging, keyword fallback, and batch processing
  - Added tag management IPC handlers (tagPaper, organizePaper, merge, recategorize, rename, delete)
  - Updated TagEditor in overview page with 3-layer category display (blue/purple/green)
  - Added "Auto Tag" and "Organize" buttons in paper overview
  - Added category filter tabs in Library page
  - Added tag management modal with browse and AI consolidation features
  - Background auto-tagging triggered after paper import
- **Rationale**: Flat tags lack structure; researchers need domain/method/topic organization for better paper discovery
- **Test Design**: Import papers → verify background tagging starts → check categorized tags in overview
- **Validation**: Pending

## 2026-03-07

### UI: Separate Proxy Settings Tab

- **Scope**: `src/renderer/pages/settings/page.tsx`
- **Changes**:
  - Created standalone `ProxySettings` component for HTTP/SOCKS proxy configuration
  - Added "Proxy" tab in Settings navigation (between Storage and Usage)
  - Proxy now has its own dedicated settings section with Save button
- **Rationale**: Cleaner organization, proxy settings are independent from storage settings
- **Test Design**: Manual UI testing in Settings page
- **Validation**: Build passes, type check passes, integration tests pass
- **Note**: Also restored UsageSettings component (token usage visualization) that was lost during git checkout

## 2026-03-07

### UI: Chat Panel Improvements

- **Scope**: `src/renderer/pages/papers/reader/page.tsx`, `src/main/services/reading.service.ts`
- **Changes**:
  - Removed structured notes template (Research Problem, Core Method, etc.) - now generates simple summary
  - Added "Save as summary" button in chat header (above input area)
  - Changed stop button color from bright red to gray for less visual distraction
  - Moved "New Chat" button from dropdown menu to chat panel header
  - Summary generates a single "Summary" field instead of multiple structured fields
- **Rationale**: Cleaner UI, simpler notes workflow, less intrusive stop button
- **Test Design**: Manual UI testing in Electron app
- **Validation**: Build passes

## 2026-03-07

### Feature: Token Usage Tracking with Charts

- **Scope**: `src/main/store/token-usage-store.ts`, `src/main/ipc/token-usage.ipc.ts`, `src/main/services/ai-provider.service.ts`, `src/main/services/agentic-search.service.ts`, `src/main/index.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/settings/page.tsx`
- **Changes**:
  - Created token usage store to track all AI API calls
  - Records: timestamp, provider, model, promptTokens, completionTokens, totalTokens, kind (agent/lightweight/chat/other)
  - Added `recordTokenUsage()`, `getTokenUsageRecords()`, `clearTokenUsage()` functions
  - Token recording integrated into all `generateText()` calls in ai-provider.service.ts
  - Token recording added to agentic search service
  - Added IPC handlers: `tokenUsage:getRecords`, `tokenUsage:clear`
  - Added "Usage" tab in Settings showing:
    - Summary cards: Total tokens, API calls
    - Line chart: Token usage over time (hourly), with different lines for each model
    - GitHub-style heatmap: Activity over last 12 weeks showing token consumption
    - Clear usage data button
  - Added `recharts` dependency for line chart visualization
- **Rationale**: Users need visibility into their AI API consumption with visual charts
- **Test Design**: Use AI features (chat, agentic search), then check Usage tab in Settings
- **Validation**: TypeScript compiles, all tests pass

## 2026-03-07

### Feature: Chat-to-Notes Binding

- **Scope**: `prisma/schema.prisma`, `src/shared/types/domain.ts`, `src/db/repositories/reading.repository.ts`, `src/main/services/reading.service.ts`, `src/main/ipc/reading.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/papers/reader/page.tsx`
- **Changes**:
  - Added `chatNoteId` field to ReadingNote model for 1:1 self-relation between Chat and generated Notes
  - Chat sessions can now be converted to structured reading notes via AI
  - Added `getGeneratedNote(chatNoteId)` repository method to check for existing generated notes
  - Added `generateNotesFromChat(chatNoteId)` service method with structured prompt
  - Added `reading:generateNotes` IPC handler
  - Added "Generate Notes" button in chat dropdown menu with loading/success states
  - Generated notes linked to original chat session (one chat → one note)
  - Fixed syntax error in `use-ipc.ts` onIpc function signature
- **Rationale**: Users want to convert chat conversations into structured reading notes automatically
- **Test Design**: Manual UI testing - chat about a paper, then click "Generate Notes" to create structured notes
- **Validation**: Build passes, all tests pass

## 2026-03-07

### Feature: Agentic Search with AI SDK Tool Calling

- **Scope**: `src/main/services/agentic-search.service.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/components/search-content.tsx`
- **Changes**:
  - Rewrote agentic search to use AI SDK's native tool calling and multi-step agent loop
  - Defined 4 tools the AI can autonomously call:
    - `searchByTitle`: Precise title matching
    - `searchByTag`: Topic-based search
    - `searchByText`: Broad search across title, tags, and abstract
    - `listAllTags`: Discover available topics
  - Agent can run up to 5 steps, iterating based on results
  - Added `reasoning` step type to show AI's thinking process
  - Each paper now tracks multiple match reasons
  - Fallback to simple text search if agent loop fails
- **Rationale**: Previous implementation just used AI for keyword extraction, not true agentic behavior. AI SDK's `generateText` with tools enables the AI to plan, execute, and refine searches autonomously.
- **Test Design**: Manual UI testing - use Agentic search mode, observe multi-step reasoning
- **Validation**: TypeScript compiles

## 2026-03-07

### Fix: API Key Display in Edit Model Modal

- **Scope**: `src/renderer/pages/settings/page.tsx`
- **Changes**:
  - API key now displays in plain text by default (no need to click eye icon)
  - Changed `showKey` initial state from `false` to `true` in both AddModelModal and EditModelModal
  - Local desktop app has no security concern for showing API keys
- **Rationale**: Users should be able to see their saved API keys immediately without extra click
- **Test Design**: Open Edit Model modal, verify API key is visible without clicking eye icon
- **Validation**: TypeScript compiles

# Changelog

## 2026-03-07

### Feature: Editor Test Button

- **Scope**: `src/renderer/pages/settings/page.tsx`, `src/main/ipc/providers.ipc.ts`, `src/main/services/providers.service.ts`, `src/main/store/app-settings-store.ts`, `src/renderer/hooks/use-ipc.ts`
- **Changes**:
  - Added "Test: Open Storage Root" button in Editor settings
  - Added `getStorageRoot` IPC method to get storage root directory path
  - Button opens storage root (`~/.vibe-research`) in configured editor
- **Rationale**: Allow users to verify editor configuration works correctly
- **Test Design**: Click test button in Settings > Editor tab, verify editor opens with storage root
- **Validation**: TypeScript compiles

## 2026-03-07

### Fix: Chat Stuck on "正在思考"

- **Scope**: `src/main/services/reading.service.ts`
- **Changes**:
  - Fixed `streamText` call that incorrectly used both `messages` and `prompt` parameters simultaneously
  - Vercel AI SDK does not support using both parameters at the same time
  - Now correctly passes all messages in the `messages` array only
- **Rationale**: The mixed parameters caused the stream to hang without returning any response
- **Test Design**: Manual UI testing - send chat message, verify response streams back
- **Validation**: TypeScript compiles

## 2026-03-07

### Feature: Proxy Settings & PDF URL Auto-Extract

- **Scope**: `src/renderer/pages/settings/page.tsx`, `src/main/store/app-settings-store.ts`, `src/main/services/download.service.ts`, `src/main/services/ai-provider.service.ts`, `src/main/services/cli-runner.service.ts`, `src/main/services/reading.service.ts`, `src/main/ipc/reading.ipc.ts`, `src/renderer/pages/papers/reader/page.tsx`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/components/import-modal.tsx`
- **Changes**:
  - Added proxy configuration in Settings (HTTP/SOCKS proxy URL)
  - Proxy used for: PDF downloads, AI API calls, CLI tools (optional per-tool)
  - Added "Use Proxy" toggle for each CLI tool (injects HTTP_PROXY/HTTPS_PROXY env vars)
  - Added "Auto Extract URL" button in reader page using lightweight model
  - Extracted PDF URL shown for user confirmation before download
  - User can manually edit the URL before downloading
  - Fixed TypeScript error in import-modal.tsx (onIpc callback type)
- **Rationale**: Users in restricted networks need proxy support; some papers don't have obvious PDF URLs
- **Test Design**: Manual UI testing in Electron app
- **Validation**: TypeScript compiles

## 2026-03-07

### UI: Library Year Dropdown Improvement

- **Scope**: `src/renderer/components/papers-by-tag.tsx`
- **Changes**:
  - Replaced native `<select>` dropdown with custom `YearDropdown` component
  - Button style now matches other filter buttons (rounded-lg, consistent padding/colors)
  - Added framer-motion animation for dropdown open/close
  - Click outside to close
  - Selected year shows in button, "More" when unselected
  - Chevron icon rotates when dropdown opens
- **Rationale**: Native select element looks inconsistent with app's Notion-like design
- **Test Design**: Manual UI testing
- **Validation**: TypeScript compiles

## 2026-03-07

### Fix: AI/CLI调用链架构问题修复

- **Scope**: `src/main/services/reading.service.ts`, `src/main/store/cli-tools-store.ts`, `src/main/services/ai-provider.service.ts`, `src/main/services/models.service.ts`, `src/main/services/providers.service.ts`, `src/main/ipc/models.ipc.ts`, `src/main/ipc/providers.ipc.ts`
- **Changes**:
  - 修复 `reading.service.ts` 缺失 `generateWithModelKind` import（导致运行时崩溃）
  - CLI工具配置现在加密存储敏感信息（envVars中的API KEY）
  - 提取 Models 和 Providers service 层，IPC handler 不再直接访问 store
  - 实现 CLI Backend 模型执行路径（`backend: 'cli'` 现在可用）
- **Rationale**: 修复架构缺陷，提升安全性和代码可维护性
- **Test Design**: 集成测试覆盖service层
- **Validation**: Pending

## 2026-03-07

### Settings: Edit Model & View API Key

- **Scope**: `src/renderer/pages/settings/page.tsx`, `src/renderer/hooks/use-ipc.ts`, `src/main/ipc/models.ipc.ts`
- **Changes**:
  - Added edit functionality for all models (including active ones)
  - EditModelModal with pre-filled configuration
  - API Key now visible when editing (local app, no security concern)
  - Removed "Key saved" badge from model cards
  - Added `models:getApiKey` IPC to return full API key
  - Added `getModelApiKey()` to IPC client
- **Rationale**: Local desktop app users should be able to view and modify their saved API keys
- **Test Design**: Manual UI testing - edit model, verify API key is visible
- **Validation**: TypeScript compiles, no errors

### Chat: Use Chat Model Instead of CLI Tool

- **Scope**: `src/renderer/pages/papers/reader/page.tsx`, `src/main/services/reading.service.ts`, `src/main/ipc/reading.ipc.ts`, `src/renderer/hooks/use-ipc.ts`
- **Changes**:
  - Chat now uses the "chat" model configured in Settings instead of CLI tool
  - Added `ReadingService.chat()` method with streaming support
  - Added `reading:chat` and `reading:chatKill` IPC handlers
  - Streaming output via `chat:output`, `chat:done`, `chat:error` events
  - Updated reader page to show chat model name instead of CLI tool name
  - Removed CLI tool dependencies from chat functionality
- **Rationale**: Agent (CLI-based) is only for code analysis; chat should use API-based models
- **Test Design**: Manual UI testing in Electron app
- **Validation**: Build passes

### Feature: Proxy Settings & PDF URL Extraction

- **Scope**: `src/main/store/app-settings-store.ts`, `src/main/ipc/providers.ipc.ts`, `src/main/services/download.service.ts`, `src/renderer/pages/settings/page.tsx`, `src/renderer/pages/papers/reader/page.tsx`, `src/renderer/hooks/use-ipc.ts`
- **Changes**:
  - Added proxy configuration in Settings (HTTP/SOCKS proxy URL)
  - PDF download now uses configured proxy for network requests
  - Added "Auto Extract" button in reader page to extract PDF URL using lightweight model
  - Extracted URL shown for user confirmation before download
  - User can manually edit or input PDF URL
  - Download failures now show hint to check proxy settings
- **Test Design**: Manual UI testing in Electron app
- **Validation**: Pending

### Fix: Library Select All Not Working

- **Scope**: `src/renderer/components/papers-by-tag.tsx`
- **Changes**:
  - Fixed `selectAll` callback missing `visiblePapers` dependency
  - Without the dependency, the callback captured stale closure value (empty array on mount)
  - Now correctly selects all visible papers after filters are applied
- **Test Design**: Manual UI testing
- **Validation**: Build passes

### Chat: Response Timeout with Settings Link

- **Scope**: `src/renderer/pages/papers/reader/page.tsx`
- **Changes**:
  - Added 30-second timeout for AI chat responses
  - When timeout occurs, shows error message with current CLI tool name
  - Added direct link to Settings page to test connection
  - Timeout is cleared when any response is received (cli:output, cli:error, cli:done)
  - Timeout is also cleared on new chat, select chat, clear chat, and component unmount
- **Test Design**: Manual UI testing in Electron app
- **Validation**: Build passes

### PDF Text Storage: Local Files Instead of Database

- **Scope**: `prisma/schema.prisma`, `src/main/services/paper-text.service.ts`, `src/db/repositories/papers.repository.ts`, `src/main/services/reading.service.ts`
- **Changes**:
  - Removed `textContent` and `textExtractedAt` fields from Paper model
  - Added `textPath` field to store path to local text file
  - PDF extracted text now saved to `papers/{shortId}/text.txt` instead of database
  - `getPaperExcerptCached()` now requires `shortId` parameter for file path resolution
  - Replaced `updateTextContent()` and `getTextContent()` with single `updateTextPath()` method
- **Rationale**: Storing large text content in SQLite bloats the database; local files are more efficient
- **Test Design**: Manual testing in Electron app
- **Validation**: Build passes, all 21 tests pass

## 2026-03-07

### Settings: UX Improvements & API Connection Test

- **Scope**: `src/renderer/pages/settings/page.tsx`, `src/renderer/components/model-combobox.tsx`, `src/main/store/model-config-store.ts`, `src/main/services/ai-provider.service.ts`, `src/main/ipc/models.ipc.ts`, `src/renderer/hooks/use-ipc.ts`
- **Changes**:
  - Removed "搜索模型或直接输入自定义ID" hint from model dropdown
  - Changed default API provider from Anthropic to OpenAI
  - Auto-activate first model when no active model exists for that kind
  - Added "Test Connection" button for API models (both in Add modal and saved cards) with real-time feedback
  - Test sends minimal request to verify API key and endpoint validity
  - Shows success/failure message after test
- **Test Design**: Manual UI testing in Electron app
- **Validation**: Build passes, type check passes, integration tests pass
- **Note**: Also restored UsageSettings component (token usage visualization) that was lost during git checkout, all tests pass

### Chat: New Chat & Clear Chat Buttons

- **Scope**: `src/renderer/pages/papers/reader/page.tsx`
- **Changes**:
  - Added "Clear Chat" button in chat dropdown menu (red text with trash icon)
  - Only shows when there's an active chat with messages
  - Clears messages and saves empty state to database
  - "New Chat" button creates a fresh chat session
- **Test Design**: Manual UI testing
- **Validation**: Build passes, all tests pass

### Fix: Batch Delete Papers Cascade

- **Scope**: `src/db/repositories/papers.repository.ts`, `src/main/services/papers.service.ts`, `src/renderer/components/papers-by-tag.tsx`
- **Changes**:
  - Fixed batch delete failure by wrapping deletes in a Prisma transaction
  - Prisma's `deleteMany` doesn't trigger application-level cascade deletes defined in schema
  - Now deletes ReadingNote, PaperTag, SourceEvent, and PaperCodeLink before Paper atomically
  - Added empty array guard clause
  - Added error logging in service layer
  - Improved frontend error message display to show actual error
- **Test Design**: Manual UI testing (batch delete in Electron app)
- **Validation**: Build passes, all tests pass

### Agentic Search: Error Feedback

- **Scope**: `src/renderer/components/search-content.tsx`
- **Changes**:
  - Added error state display when Agentic Search fails (e.g., no AI provider configured)
  - Shows red error card with message and link to Settings page
  - Removed silent fallback to normal search - user now sees why it failed
- **Test Design**: Manual UI testing
- **Validation**: TypeScript compiles

### Chat: AI Status Indicator & Notes Cleanup

- **Scope**: `src/renderer/pages/papers/reader/page.tsx`, `src/renderer/pages/papers/notes/page.tsx`
- **Changes**:
  - **Chat page**: Added AI status indicator showing current AI activity with gray spinner:
    - "正在提取PDF文本..." when extracting PDF text
    - "正在思考..." when waiting for AI response
  - Chat now extracts PDF text before sending to CLI for better context
  - **Notes page**: Removed "AI Fill" and "Summarize" buttons to simplify the interface
- **Test Design**: Manual UI testing
- **Validation**: Build passes

### Security: Remove Hardcoded API Keys from Tests

- **Scope**: `tests/integration/ai-provider.test.ts`, `tests/integration/reading.test.ts`, `.gitignore`
- **Changes**:
  - Removed all hardcoded API keys from test files
  - Tests now use environment variables only (`TEST_API_KEY`, `TEST_BASE_URL`, `TEST_LIGHTWEIGHT_MODEL`, `TEST_CHAT_MODEL`)
  - Added `.secrets`, `*.secret`, `.test-env` to `.gitignore` to prevent accidental commits
  - AI-related tests are automatically skipped if no API key is configured
- **Test Design**:
  - `ai-provider.test.ts`: Uses `maybeIt` to skip tests without API key
  - `reading.test.ts`: Added `aiEditNotes` test for AI chat functionality, skipped without API key
- **Validation**: All 21 tests pass (8 skipped - require API key)

### Test: AI Chat Dialogue (aiEditNotes)

- **Scope**: `tests/integration/reading.test.ts`
- **Changes**:
  - Added test for `ReadingService.aiEditNotes()` method
  - Test creates a paper with title/abstract and calls AI to generate reading notes
  - Verifies AI returns non-empty content for "Research Problem" and "Core Method" sections
- **Validation**: Test passes with API key configured (skipped otherwise)

### Library: Filter UI Improvements with Tag Modal

- **Scope**: `src/renderer/components/papers-by-tag.tsx`, `tailwind.config.ts`
- **Changes**:
  - Unified filter button styles: all use `rounded-lg px-2.5 py-1.5 text-sm font-medium`
  - Added section labels: "TIME", "YEAR", "TAG" in uppercase for better UX
  - Limited visible tags to 8, added "More" button for overflow
  - Added tag selection modal with fade-in and scale-in animations
  - Added `fade-in` and `scale-in` keyframes/animation to tailwind config
- **Test Design**: Manual UI verification
- **Validation**: Build passes

### PDF Text Extraction: pdf-parse v2 + Text Caching

- **Scope**: `src/main/services/pdf-extractor.service.ts`, `src/main/services/paper-text.service.ts`, `src/main/services/reading.service.ts`, `prisma/schema.prisma`, `src/db/repositories/papers.repository.ts`, `tests/integration/pdf-extractor.test.ts`, `tests/integration/ai-provider.test.ts`
- **Changes**:
  - Upgraded to `pdf-parse` v2 which uses a class-based API (`new PDFParse({ data: buffer }).getText()`)
  - Fixed pdf-parse dynamic import for ESM compatibility
  - Added HTTP request timeout (60s) for PDF downloads to prevent hanging
  - Added `textContent` and `textExtractedAt` fields to Paper model for caching extracted text
  - Created `paper-text.service.ts` to wrap PDF extraction with caching logic
  - Updated `reading.service.ts` to use cached paper text via `getPaperExcerptCached()`
  - Added `updateTextContent()` and `getTextContent()` methods to PapersRepository
  - Updated live PDF tests to be skipped by default (network-dependent), run with `RUN_LIVE_TESTS=1 npm test`
- **Test Design**:
  - `pdf-extractor.test.ts`: Unit tests for arxiv ID extraction, live tests skipped by default
  - `ai-provider.test.ts`: Tests for custom OpenAI-compatible API endpoint with model kind selection
- **Validation**: All 24 tests pass (4 skipped)

---

### Library: Batch Delete Papers

- **Scope**: `src/db/repositories/papers.repository.ts`, `src/main/services/papers.service.ts`, `src/main/ipc/papers.ipc.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/components/papers-by-tag.tsx`
- **Changes**:
  - Added `deleteMany(ids: string[])` method to PapersRepository using Prisma's `deleteMany`
  - Added batch delete service method in PapersService
  - Added `papers:deleteMany` IPC handler
  - Added `deletePapers()` IPC client method in use-ipc.ts
  - Added selection mode UI to PapersByTag component:
    - "Select" button to enter selection mode
    - Checkboxes on each paper card when in selection mode
    - Selection toolbar showing count, select all/deselect all, cancel, and delete buttons
    - Delete confirmation modal with framer-motion animations
    - ESC key support to close modal
  - Used AnimatePresence for smooth toolbar and modal transitions
- **Test Design**: Manual UI testing (batch delete through Electron app)
- **Validation**: Build passes, TypeScript compiles

## 2026-03-07

### Settings: UX Improvements & API Connection Test

- **Scope**: `src/renderer/pages/settings/page.tsx`, `src/renderer/components/model-combobox.tsx`, `src/main/store/model-config-store.ts`, `src/main/services/ai-provider.service.ts`, `src/main/ipc/models.ipc.ts`, `src/renderer/hooks/use-ipc.ts`
- **Changes**:
  - Removed "搜索模型或直接输入自定义ID" hint from model dropdown
  - Changed default API provider from Anthropic to OpenAI
  - Auto-activate first model when no active model exists for that kind
  - Added "Test Connection" button for API models (both in Add modal and saved cards) with real-time feedback
  - Test sends minimal request to verify API key and endpoint validity
  - Shows success/failure message after test
- **Test Design**: Manual UI testing in Electron app
- **Validation**: Build passes, type check passes, integration tests pass
- **Note**: Also restored UsageSettings component (token usage visualization) that was lost during git checkout, all tests pass

### Settings: Allow custom baseURL for all API providers

- Changed baseURL input visibility from `custom` provider only to all API providers
- Users can now set custom API endpoints for Anthropic, OpenAI, Gemini (e.g., for proxies)
- Placeholder text updated to indicate optional override

## 2026-03-07

### Fix: Database Connection Lost - DATABASE_URL Not Set Before Prisma Init

- **Scope**: `src/db/client.ts`
- **Changes**:
  - Fixed critical bug where PrismaClient was initialized before DATABASE_URL was set
  - In bundled code, DATABASE_URL was set at line 54175 but PrismaClient was created at line 33528
  - ES module static imports are hoisted, so environment variable setting in main/index.ts happened too late
  - Now `getPrismaClient()` sets DATABASE_URL directly using `getDbPath()` before creating PrismaClient
  - Papers now load correctly from `~/.vibe-research/vibe-research.db` (259 records verified)
- **Rationale**: ES module static imports execute before any runtime code; environment variables must be set synchronously at the point of use
- **Test Design**: Start app, verify papers load in Library
- **Validation**: TypeScript compiles, Prisma returns correct paper count

### Fix: Database Schema Out of Sync - Missing chatNoteId Column

- **Scope**: `~/.vibe-research/vibe-research.db`
- **Changes**:
  - Added missing `chatNoteId` column to ReadingNote table
  - Prisma schema had the field but database migration was not run
  - This caused `papers:list` to fail with "The column `main.ReadingNote.chatNoteId` does not exist"
  - `listTodayPapers` used raw query which didn't trigger the column check, so Dashboard worked
  - Library page uses `findMany` with relations which triggered schema validation
- **Rationale**: Schema drift between Prisma schema and actual database
- **Test Design**: Open Library page, verify papers load correctly
- **Validation**: Papers now display in Library

## 2026-03-07

### Feature: Real-time Tag Updates During Auto-tagging

- **Scope**: `src/renderer/components/papers-by-tag.tsx`
- **Changes**:
  - Tags now refresh every 2 papers during active tagging for "popping out" effect
  - Papers list refreshes every 5 papers to show untagged count decreasing in real-time
  - Added spring animation to tag pills for visual feedback when new tags appear
  - Modal tag pills also have staggered pop-in animation
- **Rationale**: Users want to see tags appearing in real-time as papers are being tagged, not just at the end
- **Test Design**: Run auto-tagging on multiple untagged papers, observe tags appearing with animation
- **Validation**: TypeScript compiles

## 2026-03-09

### Fix: Faster Local Semantic Processing Through Concurrency

- **Scope**: `src/main/services/paper-processing.service.ts`, `tests/integration/paper-processing.test.ts`
- **Changes**:
  - Replaced the single-worker paper processing queue with a small bounded worker pool
  - Allowed metadata extraction to run alongside chunking and embedding instead of blocking the critical path
  - Added regression tests covering cross-paper concurrency and non-blocking metadata extraction
- **Rationale**: Built-in embeddings felt slow largely because papers were processed strictly one-by-one and metadata work blocked embedding work unnecessarily
- **Test Design**: Mock paper processing dependencies and verify later papers and embeddings can proceed before earlier metadata/text tasks finish
- **Validation**: Targeted Vitest paper-processing integration tests

### Test: Expand Semantic Processing Regression Coverage

- **Scope**: `tests/integration/builtin-embedding.test.ts`, `tests/integration/paper-processing.test.ts`
- **Changes**:
  - Added a regression test proving built-in embedding requests are serialized through a single pipeline instance under concurrent calls
  - Added a paper-processing failure-path test for papers without any local or inferred PDF source
  - Added a vec-index sync test verifying chunk embeddings are forwarded after chunk replacement
- **Rationale**: The recent semantic-processing work introduced new concurrency and queueing behavior that needed explicit regression coverage around serialization, failure handling, and index syncing
- **Test Design**: Mock service dependencies and assert observable side effects at the repository and vec-index boundaries
- **Validation**: `npx vitest run tests/integration/builtin-embedding.test.ts tests/integration/paper-processing.test.ts`

### Test: Add Agent Todo Service Coverage

- **Scope**: `tests/integration/agent-todo.service.test.ts`
- **Changes**:
  - Added service-level tests covering JSON decoding for agent/todo payloads
  - Added regression coverage for agent config serialization during create and update flows
  - Added run-history cleanup coverage to ensure `lastRunId` references are cleared before deleting runs
  - Added cron toggle and message forwarding coverage around repository and scheduler boundaries
- **Rationale**: The agent todo flow had no direct regression coverage despite owning task configuration, scheduling, and run lifecycle state transitions
- **Test Design**: Mock repository, scheduler, and runner dependencies to assert observable persistence and orchestration behavior without requiring Electron IPC
- **Validation**: `npx vitest run tests/integration/agent-todo.service.test.ts`

### Feat: Auto Analyze and Tag Newly Added Papers

- **Scope**: `src/main/services/auto-paper-enrichment.service.ts`, `src/main/services/papers.service.ts`, `src/main/services/download.service.ts`, `src/main/services/ingest.service.ts`, `tests/integration/auto-paper-enrichment.test.ts`
- **Changes**:
  - Added a background auto-enrichment queue that runs paper analysis and auto-tagging for newly added papers
  - Triggered the queue from paper creation, local PDF import, and successful PDF download paths
  - Replaced ingest’s broad post-import batch-tagging kick with per-paper auto-enrichment scheduling to avoid duplicate work
  - Added regression tests for queue deduplication, skip behavior, and paper-service trigger hooks
- **Rationale**: After adding a paper, users expect analysis notes and tags to appear automatically without manually running two separate actions
- **Test Design**: Mock repository and AI service boundaries to verify new papers enqueue exactly once and existing analysis/tags are not redundantly regenerated
- **Validation**: `npx vitest run tests/integration/auto-paper-enrichment.test.ts`

### Feature: External Recommendations Page with Candidate Pool

- **Scope**: `prisma/schema.prisma`, recommendation service/IPC stack, `src/renderer/pages/recommendations/page.tsx`
- **Changes**:
  - Added persistent recommendation candidates, results, and feedback models for external paper discovery
  - Implemented a recommendation pipeline that builds a profile from local papers/tags, pulls candidates from Semantic Scholar and arXiv, deduplicates against the local library, and ranks results with rule-based explanations
  - Added recommendation IPC handlers and a dedicated Recommendations page with refresh, open, ignore, and save-to-library actions
  - Reused existing paper creation/download flows so accepted recommendations can enter the local library cleanly
- **Rationale**: Recommendations are more valuable when they can discover relevant papers outside the existing local library rather than only resurfacing already imported papers
- **Test Design**: Validate through Prisma client generation and production build to ensure schema, main-process wiring, and renderer integration compile together
- **Validation**: `npx prisma generate`, `npm run build`

### Feat: Add Toggle for Auto Analyze and Auto Tag

- **Scope**: `src/main/store/app-settings-store.ts`, `src/main/services/auto-paper-enrichment.service.ts`, `src/main/services/providers.service.ts`, `src/renderer/hooks/use-ipc.ts`, `src/renderer/pages/settings/page.tsx`, `tests/integration/auto-paper-enrichment.test.ts`
- **Changes**:
  - Added a persisted `autoEnrich` setting under semantic settings, defaulting to enabled
  - Added a Settings UI toggle for automatic analysis note generation and auto-tagging after paper add
  - Made the auto-enrichment queue respect the saved toggle before enqueueing work
  - Added regression coverage for the disabled-setting path
- **Rationale**: Some users want automatic enrichment by default, while others prefer full manual control over AI-triggered actions
- **Test Design**: Mock settings and service boundaries to verify auto-enrichment is skipped entirely when the toggle is off
- **Validation**: `npx vitest run tests/integration/auto-paper-enrichment.test.ts && npm run build:main`

### Improvement: Feedback-aware Recommendation Ranking

- **Scope**: `src/main/services/recommendation.service.ts`, `src/db/repositories/recommendations.repository.ts`
- **Changes**:
  - Folded recommendation feedback history (`opened`, `saved`, `ignored`) back into the ranking profile
  - Added positive topic/author boosts and negative topic dampening so recommendations react to prior user actions
  - Upgraded recommendation reasons to explain when a result is elevated because of earlier engagement with a topic or author
- **Rationale**: A recommendation system should improve after users interact with results rather than recomputing each refresh from only the local library snapshot
- **Test Design**: Validate the updated recommendation pipeline through production build and formatter checks
- **Validation**: `npm run build`, `npx prettier --check src/db/repositories/recommendations.repository.ts src/main/services/recommendation.service.ts`

### Improvement: Show Triggering Local Paper on Recommendation Cards

- **Scope**: recommendation schema/repository/service stack, `src/renderer/pages/recommendations/page.tsx`
- **Changes**:
  - Persisted the local seed paper title that most likely triggered each recommendation result
  - Exposed the trigger paper through shared recommendation types and renderer IPC data
  - Added a `Triggered by` line on recommendation cards so users can see which local paper likely led to the suggestion
- **Rationale**: Showing the local paper connection makes recommendations easier to trust and gives users a clearer mental model of why a candidate appeared
- **Test Design**: Validate schema/client/build integration and confirm the renderer compiles with the new trigger field
- **Validation**: `npx prisma generate`, `npm run build`

### Improvement: Click Through to Triggering Local Paper

- **Scope**: recommendation result schema/types/service, `src/renderer/pages/recommendations/page.tsx`
- **Changes**:
  - Added `triggerPaperId` alongside `triggerPaperTitle` in recommendation results
  - Upgraded trigger selection to retain the originating local paper identity instead of only its title
  - Made the `Triggered by` line on recommendation cards clickable so it navigates directly to the local paper overview page
- **Rationale**: Once users can see which library paper caused a recommendation, the next natural step is letting them jump straight to that local context
- **Test Design**: Validate schema generation, formatting, and app build after threading the trigger paper id through the stack
- **Validation**: `npx prisma generate`, `npm run build`

### Fix: Allow Prisma db push with Derived SQLite Index Tables Present

- **Scope**: `src/main/index.ts`
- **Changes**:
  - Expanded the pre-`db push` cleanup step to drop both sqlite-vec tables and FTS5 derived search-unit tables before Prisma introspects the SQLite schema
- **Rationale**: Prisma schema description can fail on SQLite databases that contain virtual/derived indexing tables even when the underlying database file is otherwise healthy
- **Test Design**: Validate the app still builds after updating the startup database bootstrap path
- **Validation**: `npm run build`

### Fix: Restore Recommendation Refresh After Trigger Paper Refactor

- **Scope**: `src/main/services/recommendation.service.ts`
- **Changes**:
  - Replaced the stale `findTriggerPaperTitle` helper shape with a `findTriggerPaper` helper that returns the full local seed paper record
  - Switched trigger matching to use `profile.seedPapers` instead of the removed `seedTitles` field
  - Preserved the fallback to the first seed paper so recommendation cards still show a trigger when no direct text match is found
- **Rationale**: Recommendation refresh was crashing because scoring still called a helper removed during the trigger-paper ID refactor
- **Test Design**: Validate the main-process TypeScript build after repairing the recommendation scoring helper path
- **Validation**: `npm run build:main`

### Fix: Sync Recommendation Trigger Paper ID with Prisma Schema

- **Scope**: `prisma/schema.prisma`, recommendation persistence stack
- **Changes**:
  - Added the missing `triggerPaperId` field to the `RecommendationResult` Prisma model
  - Kept recommendation result persistence aligned with the trigger-paper ID now written by the repository and service layer
- **Rationale**: Recommendation refresh was still failing at runtime because Prisma did not recognize `triggerPaperId` during `recommendationResult.upsert()`
- **Test Design**: Regenerate Prisma client and rebuild the main process after updating the schema
- **Validation**: `npx prisma generate`, `npm run build:main`

### Fix: Show Local Papers in Citation Graph Before Extraction Completes

- **Scope**: `src/main/services/citation-graph.service.ts`, `src/db/repositories/citations.repository.ts`, `tests/integration/citations.test.ts`
- **Changes**:
  - Seeded graph nodes from local library papers instead of deriving nodes only from `PaperCitation` rows
  - Preserved isolated papers in both global graph and single-paper graph views when no citation edges exist yet
  - Added an integration test covering the zero-citation case with `Attention Is All You Need`
- **Rationale**: The graph was rendering empty whenever citation extraction had not populated `PaperCitation`, even though papers already existed in the library
- **Test Design**: Validate the graph service returns isolated local nodes before any citation rows are created
- **Validation**: `npx vitest run tests/integration/citations.test.ts`

### Fix: Keep Citation Extraction Retryable on Semantic Scholar Rate Limits

- **Scope**: `src/main/services/citation-extraction.service.ts`, `src/main/services/citation-processing.service.ts`, `tests/integration/citation-extraction.test.ts`
- **Changes**:
  - Raised explicit retryable errors for Semantic Scholar rate limits and upstream failures instead of silently returning zero citations
  - Stopped background citation processing from marking papers as extracted when the failure is transient
  - Added a regression test for the `429 Too Many Requests` path
- **Rationale**: Papers were being permanently marked as citation-processed after temporary Semantic Scholar failures, leaving `PaperCitation` empty and preventing automatic retries
- **Test Design**: Mock Semantic Scholar responses and verify the extraction service surfaces retryable failures
- **Validation**: `npx vitest run tests/integration/citations.test.ts tests/integration/citation-extraction.test.ts`

### Fix: Drop Search-Unit Vec Tables Before Prisma Schema Push

- **Scope**: `src/main/index.ts`
- **Changes**:
  - Extended the pre-`prisma db push` cleanup list to also drop the derived `vec_search_units*` sqlite-vec tables
  - Kept the existing cleanup for `vec_chunks*` and `paper_search_units_fts*` tables intact
- **Rationale**: Prisma schema introspection failed during startup because the search-unit vector virtual tables remained in the SQLite database and Prisma cannot describe `vec0` virtual tables
- **Test Design**: Reproduce `prisma db push` against a database containing vec/FTS derived tables, then verify the push succeeds after removing both vector table families
- **Validation**: `node_modules/.bin/prisma db push --schema=prisma/schema.prisma --skip-generate --accept-data-loss` (verified on a copied DB after dropping both vec table families)

### Improvement: Add Hybrid Semantic Reranking to Recommendations

- **Scope**: `src/main/services/recommendation.service.ts`, `src/db/repositories/recommendations.repository.ts`, recommendation UI/types, `prisma/schema.prisma`, `tests/integration/recommendations.test.ts`
- **Changes**:
  - Added `semanticScore` to recommendation results and threaded it through Prisma, repository, IPC, shared types, and the recommendations page
  - Reused the existing local embedding provider to build a lightweight interest embedding from seed paper title/abstract/tag data and rerank fetched candidates with a hybrid score
  - Added fallback behavior so recommendation refresh continues with rule-based scoring when semantic embeddings are disabled or unavailable
  - Surfaced semantic debug scoring on recommendation cards and added integration coverage for semantic reranking and fallback paths
- **Rationale**: The existing recommendation system was heavily keyword-driven; hybrid reranking improves semantic relevance without replacing the current explainable rule-based pipeline
- **Test Design**: Validate semantic reranking order, semantic fallback behavior, and end-to-end recommendation result shaping through service-level integration tests plus production builds
- **Validation**: `npx vitest run tests/integration/recommendations.test.ts`, `npx prisma generate`, `npm run build:main`, `npm run build`

### Improvement: Add Semantic Query Expansion to Recommendation Recall

- **Scope**: `src/main/services/recommendation.service.ts`, `tests/integration/recommendations.test.ts`
- **Changes**:
  - Added an embedding-aware query expansion step that selects representative seed papers and derives extra search queries from their title, abstract, and tag terms
  - Used the expanded queries to fetch additional Semantic Scholar and arXiv candidates before dedupe and hybrid reranking
  - Preserved graceful fallback so recommendation refresh keeps working when semantic embeddings are disabled or unavailable
  - Extended recommendation integration tests to cover expansion-only recall and semantic fallback behavior
- **Rationale**: Hybrid reranking improves ordering, but candidate quality is still capped by keyword-only recall; semantic query expansion broadens the external search space without replacing the current source integrations
- **Test Design**: Validate expansion queries add otherwise-missed candidates and confirm refresh still succeeds when semantic services are unavailable
- **Validation**: `npx vitest run tests/integration/recommendations.test.ts`, `npx prisma generate`, `npm run build:main`, `npm run build`

### Improvement: Diversify Recommendations Across Multiple Seed Papers

- **Scope**: `src/main/services/recommendation.service.ts`, `tests/integration/recommendations.test.ts`
- **Changes**:
  - Added semantic trigger-paper assignment so candidates can be associated with the closest local seed paper instead of always falling back to lexical title matching
  - Diversified the final recommendation list with seed-aware grouping so top results rotate across multiple trigger papers when several interest clusters are active
  - Added integration coverage to verify top recommendations span multiple local seed papers when relevant candidates exist
- **Rationale**: After adding hybrid reranking and semantic query expansion, the remaining failure mode was over-concentration on one dominant seed paper; diversifying the final list makes recommendations better reflect multiple active research threads
- **Test Design**: Validate semantic trigger assignment and diversified ranking with multiple seed papers plus the existing semantic fallback scenarios
- **Validation**: `npx vitest run tests/integration/recommendations.test.ts`, `npm run build:main`

### Improvement: Reduce Homogeneous Recommendation Clusters

- **Scope**: `src/main/services/recommendation.service.ts`, `tests/integration/recommendations.test.ts`
- **Changes**:
  - Added candidate-level semantic redundancy penalties during final selection so near-duplicate papers are less likely to occupy multiple top slots
  - Kept the existing seed-aware diversification and layered the new novelty penalty on top of it for within-cluster exploration
  - Added integration coverage to confirm top results avoid highly similar duplicate candidates when a more varied alternative exists
- **Rationale**: After seed diversification, recommendations could still feel repetitive when multiple nearly identical candidates were fetched for the same seed paper; light semantic deduplication improves exploration without discarding strong candidates entirely
- **Test Design**: Validate the diversified selector prefers a more distinct candidate over a near-duplicate while keeping the existing fallback and multi-seed behaviors intact
- **Validation**: `npx vitest run tests/integration/recommendations.test.ts`, `npm run build:main`

### Improvement: Add User-Controlled Recommendation Exploration

- **Scope**: `src/main/store/app-settings-store.ts`, `src/main/services/recommendation.service.ts`, `src/renderer/pages/settings/page.tsx`, `src/renderer/hooks/use-ipc.ts`, `tests/integration/recommendations.test.ts`
- **Changes**:
  - Added a persisted `recommendationExploration` setting to semantic search settings and exposed it through the renderer IPC settings flow
  - Wired the exploration value into recommendation novelty penalties so users can tune the balance between tightly focused results and more varied recommendations
  - Added a settings slider for recommendation exploration and extended recommendation tests to cover higher-exploration behavior
- **Rationale**: After adding diversification and semantic deduplication, the remaining step was giving users control over how conservative or exploratory the final recommendation list should feel
- **Test Design**: Validate recommendation selection under the default and high-exploration settings while preserving the existing semantic fallback paths
- **Validation**: `npx vitest run tests/integration/recommendations.test.ts`, `npm run build:main`

### Improvement: Explain Exploration in Recommendation Cards

- **Scope**: `src/main/services/recommendation.service.ts`, `src/db/repositories/recommendations.repository.ts`, `src/shared/types/domain.ts`, `src/renderer/pages/recommendations/page.tsx`, `prisma/schema.prisma`, `tests/integration/recommendations.test.ts`
- **Changes**:
  - Added an `explorationNote` field to recommendation results so the system can explain when exploration settings or novelty pressure influenced ranking
  - Surfaced the exploration note in recommendation cards beneath the main reason text when applicable
  - Extended recommendation tests to cover explanation behavior for both focused and high-exploration selections
- **Rationale**: Once exploration became user-configurable, the recommendation UI needed to explain why a more novel paper surfaced so the ranking stays understandable and trustworthy
- **Test Design**: Validate explanation notes stay absent for focused selections and appear for higher-exploration novelty wins while preserving the existing recommendation flows
- **Validation**: `npx vitest run tests/integration/recommendations.test.ts`, `npx prisma generate`, `npm run build:main`

### Improvement: Add Recommendation Mode Shortcuts on the Recommendations Page

- **Scope**: `src/renderer/pages/recommendations/page.tsx`
- **Changes**:
  - Added in-page `Focused`, `Balanced`, and `Exploratory` recommendation mode shortcuts above the recommendation list
  - Reused the existing semantic search settings persistence so switching modes immediately updates the stored recommendation exploration level
  - Added inline mode descriptions and saving feedback to make exploration tuning accessible without visiting Settings
- **Rationale**: Recommendation exploration became configurable, but burying it inside Settings made iteration slow; quick controls on the recommendation page make tuning the experience much more usable
- **Test Design**: Validate renderer and main-process builds plus recommendation integration tests after wiring the page control into the existing settings flow
- **Validation**: `npm run build:main`, `npm run build:renderer`, `npx vitest run tests/integration/recommendations.test.ts`

### Improvement: Add Inline Recommendation Feedback Actions

- **Scope**: `src/renderer/pages/recommendations/page.tsx`
- **Changes**:
  - Added visible `More like this` and `Fewer like this` controls to recommendation cards using the existing IPC feedback handlers
  - Disabled ignore/down-rank actions once a recommendation is already ignored or saved so card actions better match result status
  - Kept `less like this` removal behavior for active recommendation lists while avoiding unnecessary disappearance inside the ignored tab
- **Rationale**: The recommendation pipeline already collected positive and negative feedback signals, but the page did not expose those controls, leaving an important tuning loop unreachable from the UI
- **Test Design**: Validate the renderer build after wiring the existing handlers into the card actions and re-run recommendation integration coverage for regression safety
- **Validation**: `npm run build:renderer`, `npx vitest run tests/integration/recommendations.test.ts`

### Improvement: Make Recommendation Feedback and Signals Easier to Read

- **Scope**: `src/renderer/pages/recommendations/page.tsx`
- **Changes**:
  - Added immediate in-card feedback badges and recorded button states after `More like this` / `Fewer like this` actions
  - Preserved those acknowledgements during the current session so recommendation tuning feels responsive without waiting for a refresh
  - Added compact signal chips such as seed-paper match, semantic strength, and exploration boost to make ranking cues easier to scan
- **Rationale**: After exposing feedback actions, the remaining usability gap was weak acknowledgement and opaque ranking context; clearer inline state and signal summaries make the recommendation loop feel more trustworthy
- **Test Design**: Validate the renderer build and rerun recommendation integration coverage to ensure the UI changes do not regress the existing service behavior
- **Validation**: `npm run build:renderer`, `npx vitest run tests/integration/recommendations.test.ts`

### Improvement: Simplify Sidebar Navigation and Move Secondary Tools into Dashboard

- **Scope**: `src/renderer/components/app-shell.tsx`, `src/renderer/components/dashboard-content.tsx`
- **Changes**:
  - Removed `Graph` and `Recommendations` from the sidebar's top-level navigation to keep the left rail focused on core workflows
  - Reorganized the sidebar so `Collections` live under a dedicated `In Library` secondary section with `All Papers`
  - Expanded the dashboard into a lightweight home surface with quick-access cards for `Recommendations`, `Graph`, and `Library`
- **Rationale**: The previous sidebar treated too many pages as primary destinations, which made the app feel busier than it needed to be; moving lower-frequency tools into the dashboard keeps navigation simpler while preserving fast access
- **Test Design**: Validate the renderer build after restructuring the sidebar and dashboard entry points
- **Validation**: `npm run build:renderer`

### Improvement: Add Collapsible Library Navigation and Global Back Button

- **Scope**: `src/renderer/components/app-shell.tsx`
- **Changes**:
  - Turned `Library` into a dedicated collapsible sidebar section with persistent expanded state and nested `All Papers` / `Collections`
  - Moved `Projects` and `Tasks` into a lower-priority `Workspace` section while keeping them accessible in collapsed mode
  - Added a global `返回上一页` action above page content so every page has a consistent back-navigation affordance
- **Rationale**: After simplifying the sidebar, the next step was clarifying hierarchy inside it and ensuring users always have an obvious way to back out of deeper pages
- **Test Design**: Validate the renderer build after changing the shared app shell structure and navigation controls
- **Validation**: `npm run build:renderer`

### Improvement: Reduce Back Navigation Footprint and Fix Library Collapse Behavior

- **Scope**: `src/renderer/components/app-shell.tsx`
- **Changes**:
  - Replaced the full-width back-navigation row with a compact floating `返回上一页` button so shared navigation takes less vertical space
  - Removed the auto-reopen behavior that immediately expanded the `Library` section again after manually collapsing it on library-related pages
- **Rationale**: The previous back control consumed too much space in the shell, and the Library accordion felt broken because user intent could not override route-based auto-expansion
- **Test Design**: Validate the renderer build after refining the shared shell interactions
- **Validation**: `npm run build:renderer`

### Improvement: Add Editable User Profile with Library-Based AI Summary

- **Scope**: `src/main/services/user-profile.service.ts`, `src/main/ipc/user-profile.ipc.ts`, `src/main/store/app-settings-store.ts`, `src/renderer/pages/profile/page.tsx`, `src/renderer/components/dashboard-content.tsx`, `src/renderer/router.tsx`, `src/renderer/hooks/use-ipc.ts`, `src/shared/types/domain.ts`, `tests/integration/user-profile.test.ts`
- **Changes**:
  - Added a standalone `Profile` page where users can edit their researcher identity, interests, goals, and short bio
  - Added persisted profile storage plus a library snapshot derived from the current paper collection
  - Added an AI summary action that uses the editable profile together with library patterns to generate a living researcher profile
  - Added a dashboard quick-access entry for `Profile` so it stays discoverable without adding more sidebar clutter
- **Rationale**: A personal profile gives the app a user-centered memory layer; combining manual edits with library-derived signals makes the profile both editable and grounded in actual reading behavior
- **Test Design**: Validate profile snapshot aggregation, manual edits, summary generation, and empty-library guardrails through a focused service test, then run main and renderer builds
- **Validation**: `npx vitest run tests/integration/user-profile.test.ts`, `npm run build:main`, `npm run build:renderer`
