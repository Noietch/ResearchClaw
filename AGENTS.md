# AGENTS.md

This file defines repository-wide instructions for Codex when working in this project.

## Scope

- Applies to the entire repository rooted here.
- These rules are the default unless the user gives a task-specific override.
- Direct system, developer, and user instructions take precedence over this file.

## Project Overview

**Vibe Research** is a standalone Electron desktop app for researchers. It is **not** a Codex plugin.

```text
src/
  main/       # Electron main process (IPC handlers, services, stores)
  renderer/   # Vite + React UI
  shared/     # Shared types, utils, prompts (no Node/Electron deps)
  db/         # Prisma client + repositories
prisma/       # schema.prisma
tests/        # Integration tests (service layer, no Electron needed)
scripts/      # build-main.mjs, build-release.sh
```

## Path Aliases

- `@shared` → `src/shared/index.ts`
- `@db` → `src/db/index.ts`
- `@/*` → `src/renderer/*`

## Working Principles

- Keep changes focused and minimal; fix root causes instead of layering surface patches.
- Follow the existing code style and architecture in the touched area.
- Do not change unrelated files or fix unrelated issues unless the user asks.
- Update documentation when behavior, usage, or developer workflow changes.

## Required Workflow

1. Review the relevant code path before editing.
2. Implement the feature or fix with the smallest clean change.
3. Add or update tests when the change affects behavior.
4. Update `changelog.md` for every coding session.
5. Run the most relevant validation commands available.
6. If the user explicitly asks for a commit, stage only the files you changed.

## Testing Expectations

- Tests should cover real business behavior, not only shallow health checks.
- Prefer realistic workflows, including sample import flow with Chrome history sample data when relevant.
- Cover the paper → reading card workflow when the affected feature touches that path.
- When possible, validate the smallest relevant scope first, then broader checks if needed.

## Changelog Rule

- Every coding session should append a concise entry to `changelog.md`.
- The entry should summarize what changed and the affected scope.
- No per-file breakdown is required.

## Validation Expectations

- Run applicable formatting, lint, type-check, and test commands when practical.
- Prefer targeted validation first.
- If validation cannot be run, say so clearly in the final handoff.

## Database Rules

- If you modify `prisma/schema.prisma`, keep schema sync in mind.
- Recommended command: `npx prisma db push`
- Remind the user to sync the database after schema changes.
- Database path is `{VIBE_RESEARCH_STORAGE_DIR}/vibe-research.db`
- Default database path is `~/.vibe-research/vibe-research.db`
- Ensure `.env` `DATABASE_URL` matches before running Prisma CLI commands.

## Git and Commit Rules

- Do not stage unrelated files.
- When staging is requested, use explicit file paths.
- Never use blanket staging like `git add .` or `git add -A`.
- Only commit when the user explicitly asks for it or the active higher-priority instruction requires it.
- Suggested commit message style: `feat: ...`, `fix: ...`, `refactor: ...`

## Branch and PR Workflow

- **Main branch (`main`) is protected and must only be updated via Pull Requests.**
- Never push directly to `main` branch.
- All feature work should be done in feature branches (e.g., `feat/paper-ingest-and-search`).
- When feature work is complete, create a PR to merge into `main`.
- Feature branches can be pushed directly for collaboration and backup.

## README Rules

- `README.md` contains both English and Chinese sections.
- If you update `README.md`, keep both language sections synchronized.

## UI Design Standards

### Card Components

Use a light blue + white visual system for card-style components such as paper cards, reading cards, and list items.

- Base: `bg-white border border-notion-border rounded-lg`
- Hover: `hover:bg-notion-accent-light hover:border-notion-accent/30`
- Active: `bg-notion-accent-light border-notion-accent/50`

Color intent:

- Card background: `bg-white` (`#ffffff`)
- Hover background: `bg-notion-accent-light` (`#e8f4f8`)
- Default border: `border-notion-border` (`#e8e8e5`)
- Accent border: `border-notion-accent/30`
- Accent text: `text-notion-accent` (`#2eaadc`)

Card design principles:

- Default to white backgrounds.
- Use light blue hover and selected states.
- Keep borders subtle by default and more prominent on interaction.
- Use `shadow-notion` for default elevation and `shadow-notion-hover` on hover when appropriate.

Example pattern:

```tsx
<div className="group bg-white border border-notion-border rounded-lg p-4 hover:bg-notion-accent-light hover:border-notion-accent/30 transition-colors duration-150 cursor-pointer">
  {/* Card content */}
</div>
```

## UI Animation Standards

For modals and popups, prefer `framer-motion` with a 150ms fade + scale/slide pattern.

```tsx
import { motion, AnimatePresence } from 'framer-motion';

<AnimatePresence>
  {isOpen && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.15 }}
        className="rounded-xl bg-white p-6 shadow-xl"
      >
        {/* Modal content */}
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>;
```

Animation rules:

- Background uses fade in/out.
- Modal card uses fade + scale + upward motion.
- Standard duration is `0.15` seconds.
- Always support closing modals with the `Escape` key.

## Final Handoff Expectations

When finishing a task, Codex should clearly state:

- what changed,
- which files were touched,
- what validation was run,
- any follow-up the user should do (especially Prisma sync after schema changes).
