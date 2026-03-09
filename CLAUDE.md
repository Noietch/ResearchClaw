# Repository Rules for Claude Code

This file defines default engineering constraints for all changes in this repository.

## Project Overview

**Vibe Research** is a standalone Electron desktop app for researchers. It is NOT a Claude Code plugin.

```
src/
  main/       # Electron main process (IPC handlers, services, stores)
  renderer/   # Vite + React UI
  shared/     # Shared types, utils, prompts (no Node/Electron deps)
  db/         # Prisma client + repositories
prisma/       # schema.prisma
tests/        # Integration tests (service layer, no Electron needed)
scripts/      # build-main.mjs, build-release.sh
```

**Path aliases** (tsconfig + esbuild + vite + vitest):

- `@shared` → `src/shared/index.ts`
- `@db` → `src/db/index.ts`
- `@/*` → `src/renderer/*`

## Scope and Priority

- Scope: Entire repository (`vibe-research`).
- Priority: These rules are the default for every implementation unless the user gives explicit one-off overrides in a task.

## Mandatory standards

1. **Tests must cover real business chain**
   - Must include realistic sample import flow (Chrome history sample data).
   - Must cover paper -> reading card workflow.
   - Health/help-only tests are insufficient for feature acceptance.

2. **Every coding session must update `changelog.md`**
   - Append a concise entry under the relevant version/date section in `changelog.md` (root of repo).
   - Entry must summarize what changed and affected scope. No separate per-file entries needed.

3. **Formatting + lint/review checks must pass before commit**
   - Pre-commit checks are required.
   - **Always run `npm run lint` before every commit** to ensure code formatting is correct.
   - If lint fails, run `npx prettier . --write` to auto-fix formatting issues.
   - **Always run `npm run test` before every commit** to ensure all tests pass.
   - Tests that require API keys should use `requiresModelIt` helper to skip in CI environments.

4. **Database schema changes require migration**
   - When adding new features that modify `prisma/schema.prisma`, always run `npx prisma db push` to sync the database.
   - Remind user to run migration if schema changes are detected.
   - **Note**: Database path is `{VIBE_RESEARCH_STORAGE_DIR}/vibe-research.db` (defaults to `~/.vibe-research/vibe-research.db`). Update `.env` DATABASE_URL accordingly before running CLI commands.

5. **Commit working code immediately**
   - When a feature is functionally complete and passes type checks, commit it right away.
   - Use `git add` and `git commit` promptly to preserve work.
   - This prevents accidental loss of code from git operations (checkout, reset, etc.).
   - Commit message format: `feat/fix/refactor: brief description`

6. **Only commit and push files you modified**
   - Always use `git add <specific files>` — never `git add .` or `git add -A`.
   - Do not stage or push files you did not touch, even if they appear in `git status`.

7. **README must be updated in both Chinese and English**
   - `README.md` contains both English and Chinese sections.
   - When updating README, always update both language sections to keep them synchronized.

8. **Branch and PR workflow**
   - **Main branch (`main`) is protected and must only be updated via Pull Requests.**
   - Never push directly to `main` branch.
   - All feature development must be done in feature branches (e.g., `feat/feature-name`, `fix/bug-name`).
   - When feature work is complete, create a PR to merge into `main`.
   - Feature branches can be pushed directly for collaboration and backup.

9. **Long-running operations must use background jobs**
   - Any IPC operation that may take more than a few seconds (LLM streaming, comparison, recommendation generation, etc.) must run as a background job in the main process.
   - The main process keeps job state in memory and broadcasts progress via `BrowserWindow.webContents.send`.
   - The renderer must **never** auto-kill a background job on component unmount — users should be able to navigate away and return to see results.
   - Provide a `getActiveJobs` / status query handler so the renderer can recover in-progress or completed job state when the page remounts.
   - Users may manually cancel a job via an explicit Stop/Cancel button.

## Expected coding sequence

1. Create changelog entry for the coding session.
2. Implement feature and tests.
3. Fill changelog test design + validation results.
4. Run formatting/lint/test checks.
5. Commit only when checks pass.

## UI Design Language

Notion-inspired design: clean whites, soft grays, light blue accents, smooth micro-interactions.

### 1. Color System

All colors use `notion-*` Tailwind tokens:

- **Backgrounds**: `bg-white` (cards) · `bg-notion-sidebar` #f7f7f5 (sidebar) · `bg-notion-accent-light` #e8f4f8 (hover/selected)
- **Text**: `text-notion-text` #37352f · `text-notion-text-secondary` #6b6b6b · `text-notion-text-tertiary` #9b9a97
- **Accent**: `text-notion-accent` / `bg-notion-accent` #2eaadc (links, active states, buttons)
- **Border**: `border-notion-border` #e8e8e5 (default) → `border-notion-accent/30` (hover) → `border-notion-accent/50` (selected)
- **Semantic**: red `#eb5757` (errors/delete) · green `#0f7b0f` (success) · orange `#fa8c16` (warnings) · yellow `#dfab01` · purple `#9065b0` · pink `#e255a1`
- **Tag backgrounds**: `bg-notion-tag-blue/green/orange/purple/pink/yellow/red` (pastel variants for taxonomy labels)

### 2. Card Pattern

```tsx
<div className="group bg-white border border-notion-border rounded-lg p-4
  hover:bg-notion-accent-light hover:border-notion-accent/30
  transition-colors duration-150 cursor-pointer">
```

- Default: white + gray border
- Hover: light blue bg + blue border
- Selected: `bg-notion-accent-light border-notion-accent/50`
- Shadows: `shadow-notion` (default) · `shadow-notion-hover` (hover)

### 3. Layout & Spacing

- Sidebar: collapsible `w-60` / `w-[72px]` with `bg-notion-sidebar`
- Content: `max-w-3xl` or `max-w-4xl` centered containers
- Padding: `p-4` (cards) · `p-6` (modals/sections)
- Gaps: `gap-1.5` (tight lists) · `gap-2`–`gap-3` (standard) · `gap-4`+ (sections)

### 4. Typography

- Page title: `text-2xl font-bold tracking-tight text-notion-text`
- Section header: `text-sm font-medium text-notion-text`
- Metadata / labels: `text-xs text-notion-text-tertiary`
- Long text: `truncate` (single line) · `line-clamp-2` (two lines)

### 5. Buttons & Interactive States

- Primary action: `bg-notion-accent text-white rounded-lg px-3 py-1.5 text-sm`
- Filter/toggle: `rounded-lg px-3 py-1.5 text-sm` + `bg-notion-sidebar-hover` when active
- Icon button: `flex h-7 w-7 items-center justify-center rounded-lg hover:bg-notion-sidebar-hover`
- Destructive: `hover:bg-red-50 hover:text-red-500`
- Hover reveals: `opacity-0 group-hover:opacity-100 transition-opacity`
- Disabled: `disabled:opacity-50`

### 6. Animations (framer-motion)

- **Modal**: backdrop fade + card scale+slide — always 150ms
  ```tsx
  // Backdrop
  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}
  className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
  // Card
  initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
  className="rounded-xl bg-white p-6 shadow-xl"
  ```
- **List items**: `AnimatePresence` with staggered `y` slide-in
- **Nav indicator**: spring animation with `layoutId` (`stiffness: 500, damping: 30`)
- Always support **ESC** to close modals

### 7. IME Input Handling

All `onKeyDown` Enter handlers must guard: `if (e.nativeEvent.isComposing) return`
