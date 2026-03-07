# Release Notes

---

## v0.0.1 — Initial Release

**Release Date:** 2026-03-07
**Platforms:** macOS arm64 (Apple Silicon), macOS x64 (Intel)

Vibe Research is a standalone desktop application for researchers who want to manage, read, and deeply understand academic papers — without relying on cloud services. Everything runs locally on your machine.

---

### Overview

Vibe Research combines a structured paper library with AI-assisted reading tools, intelligent search, and a lightweight project management workspace. The goal is to reduce the friction between discovering a paper and actually understanding it.

---

### Features

#### Paper Library

**Import from Chrome History**
- Automatically scans your Chrome browsing history for arXiv paper visits
- Configurable time window: last 1 day, 7 days, 30 days, or all time
- Preview scan results before committing to import — shows new vs. already-imported papers
- Deduplicates by arXiv ID so re-importing the same history is safe
- Cancellable mid-import

**Import by URL or arXiv ID**
- Accepts arXiv abstract URLs (`arxiv.org/abs/...`), PDF URLs (`arxiv.org/pdf/...`), bare arXiv IDs (e.g. `2401.12345`), and generic PDF URLs
- Automatically fetches paper title, authors, abstract, and publication year from arXiv
- Falls back gracefully for non-arXiv PDFs (uses filename as title)

**Import from Local Papers Directory**
- Scans a local folder structured as arXiv ID subdirectories
- Fetches metadata from arXiv for each detected paper
- Skips papers already in the database

**Metadata**
- Title, authors, publication year, abstract stored per paper
- arXiv papers are prefixed with their ID (e.g. `[2401.12345] Attention Is All You Need`) for easy identification
- Source URL tracked per paper (arXiv, Chrome history, manual)

**PDF Management**
- PDF downloaded automatically after import
- Stored locally at `~/.vibe-research/papers/{arxivId}/paper.pdf`
- Skips re-download if file already exists and is non-empty
- PDF viewer built into the reader with adjustable panel width

**Paper Actions**
- Star rating (1–5 stars)
- Delete single paper or batch-delete multiple papers (with cascade to reading notes)
- Open source URL in browser
- Download PDF on demand if not yet fetched

---

#### AI-Powered Reading

**Structured Reading Notes**
Each paper has a structured note with five sections:
- Research Problem
- Core Method
- Key Findings
- Limitations
- Future Work

Notes are editable inline and auto-saved.

**AI Note Generation**
- One-click AI fill: generates all five sections from the paper's title, abstract, and PDF content
- Uses a configurable chat model
- PDF text is extracted and included in the prompt context (up to ~8,000 tokens)
- Responds in the same language as the paper / user instruction

**AI Chat**
- Persistent chat session per paper
- Full streaming responses with real-time token display
- Chat history is saved and reloaded on revisit
- PDF content injected into context automatically when available
- Supports abort mid-stream (Stop button)
- Responds in the same language as the user

**Generate Notes from Chat**
- After a chat session, generate structured reading notes from the conversation transcript
- Notes are linked back to the source chat session
- Avoids regenerating if notes already exist for that chat

**Code Link Notes**
- Reading notes can be of type `code` — link a paper to its implementation repository
- Stores repo URL and commit hash alongside the note

---

#### Multi-Layer Tag System

**Three-Category Taxonomy**
Tags are organized into three categories:
- **Domain** — research field (e.g. `nlp`, `cv`, `robotics`)
- **Method** — technique or algorithm (e.g. `transformer`, `diffusion`, `rag`)
- **Topic** — cross-cutting theme (e.g. `safety-alignment`, `code-generation`, `benchmark`)

**Auto-Tagging**
- Single paper: tag on demand from the paper card or reader
- Batch: tag all untagged papers in the library at once (3 concurrent workers)
- Cancellable batch operation with live progress display
- Uses a lightweight model for cost efficiency
- Keyword-based fallback if the AI call fails — ensures every paper gets at least one tag

**Tag Management Modal**
- View all tags grouped by category with paper counts
- Rename a tag (propagates to all papers)
- Recategorize a tag (domain / method / topic)
- Delete a tag (removes from all papers)
- Merge tags: consolidate duplicates or synonyms into a single canonical tag

**AI Consolidation Suggestions**
- Analyzes the full tag vocabulary and suggests:
  - Tags to merge (e.g. `llm` → `language-model`)
  - Tags to recategorize
- Each suggestion includes a human-readable reason
- Apply suggestions selectively — one at a time or all at once

**Library View**
- Papers grouped by tag in the library
- Collapsible tag groups
- Untagged papers shown in a dedicated group

---

#### Intelligent Search

**Agentic Search**
Search is powered by an AI agent that plans and refines its own strategy:

1. Agent receives the natural language query
2. Decides which tools to call: `searchByTitle`, `searchByTag`, `searchByText`, `listAllTags`
3. Iterates up to 5 tool-call steps, broadening or pivoting as needed
4. Returns deduplicated results with a relevance reason per paper
5. Provides a final reasoning summary

Live step-by-step display shows the agent's thinking as it works.

**Search Tools Available to the Agent**
| Tool | Description |
|------|-------------|
| `searchByTitle` | Keyword match against paper titles |
| `searchByTag` | Match papers by tag name |
| `searchByText` | Broad match across title, tags, and abstract |
| `listAllTags` | Enumerate available tags to discover topics |

**Fallback**
If the agent fails (e.g. no model configured), falls back to a simple full-text search.

---

#### Projects

A lightweight research project workspace alongside the paper library.

**Projects**
- Create, rename, and delete projects
- Each project tracks a `lastAccessedAt` timestamp for recency sorting

**Todo Lists**
- Per-project task list
- Create, check off, and delete todos

**Repository Links**
- Link Git repositories to a project
- Clone a remote repo directly from the app (uses system `git`)
- View recent commits for a linked local repo

**Ideas**
- Capture research ideas within a project as free-form text notes
- Create and delete ideas

---

#### AI Provider Configuration

**Supported Providers**
| Provider | Models |
|----------|--------|
| Anthropic | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001 |
| OpenAI | gpt-4o, gpt-4o-mini, gpt-4-turbo, o1, o3-mini |
| Google | gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash |
| Custom | Any OpenAI-compatible endpoint |

**Model Roles**
Each AI feature is assigned to one of three model roles, configurable independently:
- **Agent** — agentic search (tool-use capable model recommended)
- **Chat** — reading notes, AI chat, note generation
- **Lightweight** — auto-tagging, tag consolidation, PDF URL extraction

**Security**
- API keys encrypted at rest using Electron's `safeStorage` (OS keychain-backed)
- Keys never written to disk in plaintext

**Connection Test**
- Test any configured provider with a single click before using it

---

#### Token Usage Tracking

All AI API calls are tracked locally.

**Dashboard Widgets**
- **Line chart**: token usage over time (prompt + completion tokens)
- **Calendar heatmap**: GitHub-style activity grid for the last 90 days — daily token volume at a glance
- **Summary cards**: total tokens consumed, total API calls

**Breakdown**
- By provider (Anthropic, OpenAI, etc.)
- By model
- By usage kind (agent, chat, lightweight)

**Storage**
- Stored in `~/.vibe-research/token-usage.json`
- Capped at 1,000 most recent records to prevent unbounded growth
- Clearable from settings

---

#### Proxy Support

- HTTP and SOCKS5 proxy configurable in Settings
- Applied to: PDF downloads, arXiv metadata fetches, AI API calls
- Useful in environments where direct internet access is restricted

---

#### CLI Tools Integration

- Register external command-line tools (e.g. a custom script, a note-taking CLI)
- Run registered tools from within the app
- Tool output streamed back to the UI

---

#### Dashboard

- Recent papers and projects (sorted by last accessed)
- Quick-open: click any recent item to jump directly to it
- Tab-based navigation — open multiple papers simultaneously without losing context

---

#### Settings

- AI provider and model configuration
- Proxy configuration
- CLI tools registration
- Storage directory: open in configured editor or Finder
- Token usage history: view and clear

---

### Technical Details

| Component | Technology |
|-----------|-----------|
| Desktop shell | Electron 35 |
| UI framework | React 19 + Vite 6 |
| Styling | Tailwind CSS + Framer Motion |
| Database | SQLite via Prisma ORM |
| AI SDK | Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`) |
| PDF extraction | pdf-parse |
| Build | esbuild (main process), Vite (renderer) |
| Packaging | electron-builder |

**Data Storage**

All data is stored locally. Nothing leaves your machine except API calls to configured AI providers.

```
~/.vibe-research/
  vibe-research.db          # SQLite database (papers, notes, tags, projects)
  papers/
    {arxivId}/
      paper.pdf             # Downloaded PDF
      notes/                # Reserved for future file-based notes
  provider-config.json      # Encrypted AI provider settings
  token-usage.json          # Token usage history
```

---

### Installation

Download the DMG for your platform from the releases page:

| File | Platform |
|------|----------|
| `vibe-research-0.0.1-arm64.dmg` | Apple Silicon (M1 / M2 / M3 / M4) |
| `vibe-research-0.0.1-x64.dmg` | Intel Mac |

Open the DMG, drag Vibe Research to Applications, and launch.

> **macOS Gatekeeper**: On first launch, right-click the app and choose "Open" to bypass the unsigned app warning. This is expected for apps distributed outside the Mac App Store.

---

### Known Limitations

- **macOS only** in v0.0.1. Windows and Linux support is planned.
- Chrome history import requires the system `sqlite3` CLI to be available (`brew install sqlite` if missing).
- Repository clone and commit history features require `git` to be installed and available in `PATH`.
- Agentic search uses up to 5 tool-call steps; very large libraries (10,000+ papers) may see slower search times.
- PDF text extraction is limited to the first ~8,000 tokens of content for AI context.

---

### Feedback

Bug reports and feature requests are welcome. Please open an issue on the project repository.
