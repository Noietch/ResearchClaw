<p align="center">
  <img src="assets/logo.svg" width="160" alt="Vibe Research Logo">
</p>

<h1 align="center">Vibe Research</h1>

<p align="center">
  <strong>AI 驱动的科研桌面应用</strong>
</p>

<p align="center">
  文献管理、智能阅读笔记、研究创意生成 — 全部集成在一个原生应用中
</p>

<p align="center">
  <a href="README.md">English</a> | <strong>中文</strong>
</p>

<p align="center">
  <a href="https://github.com/Noietch/VibeResearch/stargazers"><img src="https://img.shields.io/github/stars/Noietch/VibeResearch?style=for-the-badge&logo=github" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-CC%20BY--NC%204.0-lightgrey?style=for-the-badge" alt="License"></a>
  <a href="https://github.com/Noietch/VibeResearch/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge" alt="PRs Welcome"></a>
</p>

---

## 什么是 Vibe Research？

**Vibe Research** 是一个独立的 **Electron 桌面应用**，专为科研工作者设计。它将 AI 驱动的论文管理、交互式阅读和创意生成整合在一个简洁的界面中 — 无需浏览器、无需服务器、无需插件。

## 界面截图

![Vibe Research Dashboard](assets/screenshot.png)

_Dashboard 展示今日 arXiv 论文，附带 AI 自动生成的分类标签（transformer、nlp、planning、instruction-following 等）_

## 核心功能

| 功能               | 描述                                                             |
| :----------------- | :--------------------------------------------------------------- |
| **Dashboard**      | 一览今日 arXiv 论文，附带 AI 自动分类标签                        |
| **论文导入**       | 从 Chrome 历史批量导入，或通过 arXiv ID/URL 下载单篇论文         |
| **AI 阅读**        | 打开 PDF 并排显示聊天面板，AI 自动填充结构化阅读卡片             |
| **笔记编辑**       | 富文本编辑器，支持 Vibe（AI）/ 手动模式切换                      |
| **多层标签系统**   | 按 domain / method / topic 自动标注论文；支持批量管理和合并      |
| **文献库**         | 按分类、标签、年份筛选；跨标题和摘要全文搜索                     |
| **Projects**       | 将论文和代码仓库组织成研究项目；基于你的文献库用 AI 生成研究创意 |
| **智能搜索**       | AI 使用多步工具调用自主搜索你的文献库                            |
| **Token 用量统计** | 通过动态折线图和 GitHub 风格热力图追踪 API 使用情况              |
| **多 AI 提供商**   | 配置 Anthropic、OpenAI、Gemini 或任意 OpenAI 兼容 API            |
| **CLI 工具**       | 直接在应用内运行 Claude Code、Codex 或 Gemini CLI                |
| **代理支持**       | HTTP/SOCKS 代理用于下载和 API 调用（适合网络受限环境）           |

## 快速链接

- **[安装指南](docs/install.md)** — 5 分钟快速上手
- **[使用指南](docs/usage-zh.md)** — 了解每个功能的用法

## 环境要求

- macOS 12+（arm64 / x64）、Windows 10+（x64 / arm64）或 Linux（x64 / arm64）
- Node.js >= 18（从源码构建时需要）

## 快速开始

```bash
# 克隆并安装
git clone https://github.com/Noietch/VibeResearch.git
cd VibeResearch
npm install

# 开发模式
npm run dev

# 构建并打包
npm run release:mac    # macOS → .dmg（arm64 + x64）
npm run release:win    # Windows → NSIS 安装包（x64 + arm64）
npm run release:linux  # Linux → AppImage（x64 + arm64）
```

## 项目架构

```
src/
  main/       # Electron 主进程（IPC 处理器、服务、存储）
  renderer/   # Vite + React UI
  shared/     # 共享类型、工具函数、提示词
  db/         # Prisma + SQLite 数据层
prisma/       # schema.prisma
tests/        # 集成测试（服务层）
scripts/      # build-main.mjs, build-release.sh
```

- **数据库**：SQLite via Prisma，路径 `~/.vibe-research/vibe-research.db`
- **AI**：Vercel AI SDK，支持 Anthropic、OpenAI、Gemini 及 OpenAI 兼容提供商
- **构建**：esbuild（主进程）+ Vite（渲染进程）

## 许可证

[CC BY-NC 4.0](LICENSE) — 免费用于非商业用途，需注明来源，禁止商业使用。

---

<p align="center">
  Built with ❤️ for the research community.
</p>
