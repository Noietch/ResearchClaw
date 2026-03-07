<p align="center">
  <img src="assets/logo.svg" width="160" alt="Vibe Research Logo">
</p>

<h1 align="center">Vibe Research</h1>

<p align="center">
  <strong>AI-Powered Research Desktop App</strong>
</p>

<p align="center">
  Literature management, smart reading notes, and research idea generation — all in one native app
</p>

<p align="center">
  <strong>English</strong> | <a href="README_CN.md">中文</a>
</p>

<p align="center">
  <a href="https://github.com/Noietch/VibeResearch/stargazers"><img src="https://img.shields.io/github/stars/Noietch/VibeResearch?style=for-the-badge&logo=github" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-CC%20BY--NC%204.0-lightgrey?style=for-the-badge" alt="License"></a>
  <a href="https://github.com/Noietch/VibeResearch/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge" alt="PRs Welcome"></a>
</p>

---

## What is Vibe Research?

**Vibe Research** is a standalone **Electron desktop app** for researchers. It combines AI-powered paper management, interactive reading, and idea generation in a clean interface — no browser, no server, no plugin required.

## Screenshot

![Vibe Research Dashboard](assets/screenshot.png)

_Dashboard showing today's papers with AI-generated tags (transformer, nlp, planning, instruction-following, etc.)_

## Key Features

| Feature               | Description                                                                              |
| :-------------------- | :--------------------------------------------------------------------------------------- |
| **Dashboard**         | Browse today's arXiv papers with AI-categorized tags at a glance                         |
| **Paper Import**      | Batch import from Chrome history, or download single papers by arXiv ID/URL              |
| **AI Reading**        | Open PDFs with side-by-side chat; AI fills structured reading cards                      |
| **Note Editing**      | Rich-text editor with Vibe (AI) / Manual mode toggle                                     |
| **Multi-Layer Tags**  | Auto-tag papers by domain / method / topic; manage tags with batch operations            |
| **Library**           | Filter papers by category, tag, year; search across title and abstract                   |
| **Projects**          | Organize papers and repos into research projects; generate AI ideas from your collection |
| **Agentic Search**    | AI autonomously searches your library using multi-step tool calling                      |
| **Token Usage**       | Track API usage with animated line charts and GitHub-style activity heatmap              |
| **Multi-Provider AI** | Configure Anthropic, OpenAI, Gemini, or any OpenAI-compatible API                        |
| **CLI Tools**         | Run Claude Code, Codex, or Gemini CLI directly inside the app                            |
| **Proxy Support**     | HTTP/SOCKS proxy for downloads and API calls (useful in restricted networks)             |

## Quick Links

- **[Installation Guide](docs/install.md)** — Get started in 5 minutes
- **[Usage Guide](docs/usage-en.md)** — Learn how to use each feature

## Requirements

- macOS 12+ (arm64 / x64), Windows 10+ (x64 / arm64), or Linux (x64 / arm64)
- Node.js >= 18 (for building from source)

## Quick Start

```bash
# Clone and install
git clone https://github.com/Noietch/VibeResearch.git
cd VibeResearch
npm install

# Development mode
npm run dev

# Build and package
npm run release:mac    # macOS → .dmg (arm64 + x64)
npm run release:win    # Windows → NSIS installer (x64 + arm64)
npm run release:linux  # Linux → AppImage (x64 + arm64)
```

## Architecture

```
src/
  main/       # Electron main process (IPC handlers, services, stores)
  renderer/   # Vite + React UI
  shared/     # Shared types, utils, prompts
  db/         # Prisma + SQLite repositories
prisma/       # schema.prisma
tests/        # Integration tests (service layer)
scripts/      # build-main.mjs, build-release.sh
```

- **Database**: SQLite via Prisma at `~/.vibe-research/vibe-research.db`
- **AI**: Vercel AI SDK supporting Anthropic, OpenAI, Gemini, and OpenAI-compatible providers
- **Build**: esbuild (main process) + Vite (renderer)

## License

[CC BY-NC 4.0](LICENSE) — Free for non-commercial use. Attribution required. Commercial use is not permitted.

---

<p align="center">
  Built with ❤️ for the research community.
</p>
