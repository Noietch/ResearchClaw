<p align="center">
  <img src="assets/icon.png" width="160" alt="ResearchClaw Logo">
</p>

<h1 align="center">ResearchClaw</h1>

<p align="center">
  <strong>AI-Powered Research Desktop App</strong>
</p>

<p align="center">
  Literature management, smart reading notes, and research idea generation — all in one native app
</p>

<p align="center">
  <a href="https://github.com/Noietch/ResearchClaw/stargazers"><img src="https://img.shields.io/github/stars/Noietch/ResearchClaw?style=for-the-badge&logo=github" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-CC%20BY--NC%204.0-lightgrey?style=for-the-badge" alt="License"></a>
  <a href="https://github.com/Noietch/ResearchClaw/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge" alt="PRs Welcome"></a>
  <a href="README_CN.md"><img src="https://img.shields.io/badge/README-%E4%B8%AD%E6%96%87-blue?style=for-the-badge" alt="中文文档"></a>
</p>

---

## What is ResearchClaw?

**ResearchClaw** is a standalone **Electron desktop app** for researchers. It combines AI-powered paper management, interactive reading, and idea generation in a clean interface — no browser, no server, no plugin required.

## 🚀 Contribute with PRs

CitationClaw is community-driven and PR-friendly.

- Open an issue: <https://github.com/VisionXLab/CitationClaw/issues>
- Submit a PR: <https://github.com/VisionXLab/CitationClaw/pulls>
- Good first tasks: docs, UI polish, skill metadata, retry robustness

## Feature

### Dashboard

![Dashboard](assets/screenshot_01.png)

_Today's papers with AI-generated tags (transformer, nlp, planning, instruction-following, etc.)_

### Reading Cards

![Reading Cards](assets/screenshot_02.png)

_AI-powered reading interface with structured note-taking cards_

### Discovery

![Discovery](assets/screenshot_discovery.png)

_Discover new papers from arXiv with AI quality evaluation and relevance-based smart filtering_

### Projects & Ideas

![Projects](assets/screenshot_v3.png)

_Organize papers into projects and generate AI-powered research ideas_

## Key Features

### Paper Discovery & Import

| Feature                   | Description                                                                                          |
| :------------------------ | :--------------------------------------------------------------------------------------------------- |
| **Discovery**             | Browse latest arXiv papers by category (cs.AI, cs.LG, cs.CL, cs.CV, etc.) with time-range filtering  |
| **AI Quality Evaluation** | Evaluate papers on Novelty, Methodology, Significance, and Clarity with a 0-10 score                 |
| **Smart Filter**          | Calculate relevance scores (0-100%) based on your existing library to surface what matters to you    |
| **AlphaXiv Summaries**    | Auto-fetch AI-generated paper summaries from AlphaXiv for quick triage                               |
| **Paper Import**          | Batch import from Chrome history, arXiv ID/URL, local PDF, Zotero, BibTeX/RIS, or Overleaf           |
| **Reading List**          | Temporarily save papers (24h) from Discovery or citations for quick reads without cluttering Library |

### Reading & Notes

| Feature                 | Description                                                                               |
| :---------------------- | :---------------------------------------------------------------------------------------- |
| **PDF Reader**          | In-app PDF viewer with page navigation, zoom, and width-fit controls                      |
| **AI Chat**             | Side-by-side chat panel powered by Claude — ask about contributions, methods, limitations |
| **Reading Cards**       | AI fills structured reading note cards; toggle between Vibe (AI) / Manual editing mode    |
| **Auto Notes**          | One-click AI-generated reading summary saved as a note                                    |
| **Citation Extraction** | Automatically detect and extract references from PDFs; search your library or online      |

### Library & Organization

| Feature              | Description                                                                              |
| :------------------- | :--------------------------------------------------------------------------------------- |
| **Library**          | Filter papers by category, tag, time range, year; search across title, abstract, meaning |
| **Multi-Layer Tags** | Auto-tag papers by Domain / Method / Topic; manage, merge, and organize tags in batch    |
| **Paper Comparison** | Select 2-3 papers and generate AI-powered comparative analysis                           |
| **BibTeX Export**    | Export selected papers to BibTeX format for LaTeX integration                            |
| **Semantic Search**  | Embedding-based similarity search across your paper collection                           |
| **Agentic Search**   | AI autonomously searches your library using multi-step tool calling (Beta)               |
| **Citation Graph**   | Interactive citation network visualization with layout options and PNG export            |

### Projects & Tasks

| Feature                | Description                                                                   |
| :--------------------- | :---------------------------------------------------------------------------- |
| **Projects**           | Organize papers, repos, and todos into research projects                      |
| **AI Idea Generation** | Generate research ideas from papers in your project collection                |
| **Agent Tasks**        | Run AI agent tasks with status tracking (Running / Completed / Failed / Idle) |

### Configuration & Infrastructure

| Feature               | Description                                                                    |
| :-------------------- | :----------------------------------------------------------------------------- |
| **Multi-Provider AI** | Configure Anthropic, OpenAI, Gemini, or any OpenAI-compatible API              |
| **CLI Tools**         | Run Claude Code, Codex, or Gemini CLI directly inside the app                  |
| **Proxy Support**     | HTTP/SOCKS proxy for downloads, API calls, and agents — with connectivity test |
| **Token Usage**       | Track API usage with animated line charts and GitHub-style activity heatmap    |
| **i18n**              | Full Chinese/English bilingual interface with automatic OS language detection  |

## Requirements

- macOS 12+ (arm64 / x64), Windows 10+ (x64 / arm64), or Linux (x64 / arm64)
- Node.js >= 18 (for building from source)

## Quick Start

```bash
# Clone and install
git clone https://github.com/Noietch/ResearchClaw.git
cd ResearchClaw
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

- **Database**: SQLite via Prisma at `~/.researchclaw/researchclaw.db`
- **AI**: Vercel AI SDK supporting Anthropic, OpenAI, Gemini, and OpenAI-compatible providers
- **Build**: esbuild (main process) + Vite (renderer)

## License

[CC BY-NC 4.0](LICENSE) — Free for non-commercial use. Attribution required. Commercial use is not permitted.

## Star History

<a href="https://star-history.com/#Noietch/VibeResearch&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Noietch/VibeResearch&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Noietch/VibeResearch&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Noietch/VibeResearch&type=Date" width="100%" />
 </picture>
</a>

---

<p align="center">
  Built with ❤️ for the research community.
</p>
