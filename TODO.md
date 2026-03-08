# TODO - Vibe Research 模块化开发规划

> 目标：打造集文献管理、idea推荐、文献调研于一体的优秀平台
>
> 原则：模块独立、并行开发、最小冲突

---

## 基础设施改进（所有模块共享）

**负责人：** _待分配_

### 优先级 P0（立即开始）

- [ ] **Semantic Search 优化**
  - 添加内置 embedding provider（不依赖 Ollama）
  - 评估 ONNX Runtime / Transformers.js
  - 实现 provider 抽象层
- [ ] **文件上传增强**
  - 支持多选 PDF
  - 拖拽上传
  - 进度条优化
- [ ] **测试覆盖率提升**
  - 为每个新模块编写集成测试
  - 使用 `requiresModelIt` 处理 API 依赖

- [] **Paper分类**
  - 分类，我的paper，我感兴趣的paper，等等！
  - 基于paper分类刻画画像

### 优先级 P1（第二阶段）

- [ ] 性能优化
  - 虚拟滚动（大列表）
  - 懒加载（图片/PDF）
  - 数据库索引优化
- [ ] 错误处理增强
  - 统一错误提示 UI
  - 自动重试机制
  - 日志收集

## 模块 A：智能文献图谱 (Literature Graph)

**负责人：** _待分配_

**目标：** 可视化论文引用关系，构建知识网络

### Phase 1: 数据层 (Week 1-2)

- [ ] 设计 `PaperCitation` 表（schema.prisma）
  - `id`, `sourcePaperId`, `targetPaperId`, `citationType`, `context`
- [ ] 实现 citation 解析服务（`citation-parser.service.ts`）
  - 从 PDF 提取 References 章节
  - 解析引用格式（APA/IEEE/etc）
  - 匹配已有论文或创建占位符
- [ ] 添加 IPC handler（`citations.ipc.ts`）

### Phase 2: 可视化层 (Week 3-4)

- [ ] 创建图谱页面（`src/renderer/pages/graph/page.tsx`）
- [ ] 集成图可视化库（推荐 Cytoscape.js 或 React Flow）
- [ ] 实现交互功能
  - 节点点击跳转论文详情
  - 高亮引用路径
  - 筛选器（按年份/领域/引用数）
- [ ] 添加布局算法（力导向/层次/圆形）

### Phase 3: 高级功能 (Week 5-6)

- [ ] 识别关键节点（PageRank 算法）
- [ ] 引用链分析（A → B → C 路径追踪）
- [ ] 导出图谱（PNG/SVG/JSON）

**依赖：** 需要 PDF 解析服务（已有 `pdf-extractor.service.ts`）

---

## 模块 B：AI 研究助手增强

**负责人：** _待分配_

**目标：** 深度集成 LLM，提供智能分析和推荐

### Phase 1: 多论文对比分析 (Week 1-2)

- [ ] 创建 `paper-comparison.service.ts`
  - 批量调用 Claude API 生成对比摘要
  - 提取共同方法论和差异点
- [ ] 添加对比视图 UI（`src/renderer/pages/papers/compare.tsx`）
  - 支持选择 2-5 篇论文
  - 表格/卡片式对比展示
- [ ] 实现缓存机制（避免重复调用 API）

### Phase 2: Gap 分析与研究问题生成 (Week 3-4)

- [ ] 设计 `ResearchGap` 表（schema.prisma）
  - `id`, `title`, `description`, `relatedPaperIds`, `confidence`
- [ ] 实现 gap 检测服务（`gap-analysis.service.ts`）
  - 分析领域内未解决问题
  - 识别方法论空白
- [ ] 创建 Gap 管理页面（`src/renderer/pages/gaps/page.tsx`）
- [ ] 添加"生成研究问题"按钮（基于已读论文）

### Phase 3: 智能推荐系统 (Week 5-6)

- [ ] 扩展现有 `Automatically Recommend` 功能
  - 每日从 arXiv 抓取最新论文
  - 基于用户阅读历史和标签过滤
  - 使用 agent 生成推荐理由
- [ ] 添加推荐页面（`src/renderer/pages/recommendations/page.tsx`）
- [ ] 实现推荐反馈机制（点赞/忽略）

**依赖：** 现有 AI provider 服务（`ai-provider.service.ts`）

---

## 模块 C：增强阅读体验

**负责人：** _待分配_

**目标：** 提升 PDF 阅读和笔记体验

### Phase 1: PDF 内联标注系统 (Week 1-3)

- [ ] 集成 PDF.js 或 react-pdf
- [ ] 实现标注层（`src/renderer/components/pdf-annotator.tsx`）
  - 高亮文本
  - 添加批注气泡
  - 绘制矩形/箭头
- [ ] 设计 `PaperAnnotation` 表（schema.prisma）
  - `id`, `paperId`, `pageNum`, `position`, `type`, `content`, `color`
- [ ] 添加标注服务（`annotations.service.ts`）

### Phase 2: 跨论文笔记关联 (Week 4-5)

- [ ] 扩展 `ReadingNote` 表
  - 添加 `linkedPaperIds` 字段（JSON 数组）
  - 添加 `linkedAnnotationIds` 字段
- [ ] 实现双向链接 UI
  - 笔记中 `[[paper:shortId]]` 语法自动链接
  - 点击跳转到对应论文/段落
- [ ] 添加反向链接面板（显示引用当前论文的笔记）

### Phase 3: 概念词典 (Week 6-7)

- [ ] 设计 `Concept` 表（schema.prisma）
  - `id`, `term`, `definition`, `relatedPaperIds`, `category`
- [ ] 实现术语提取服务（`concept-extractor.service.ts`）
  - 从论文中识别关键术语
  - 使用 LLM 生成定义
- [ ] 添加悬浮提示 UI（鼠标悬停显示定义）
- [ ] 创建词典管理页面（`src/renderer/pages/concepts/page.tsx`）

**依赖：** 现有 PDF 服务（`pdf-extractor.service.ts`）

---

## 模块 D：协作与分享

**负责人：** _待分配_

**目标：** 支持团队协作和知识共享

### Phase 1: 用户系统基础 (Week 1-2)

- [ ] 设计 `User` 表（schema.prisma）
  - `id`, `username`, `email`, `avatarUrl`, `role`
- [ ] 实现本地用户管理（无需服务器）
  - 创建/切换用户配置文件
  - 数据隔离（每个用户独立数据库）
- [ ] 添加用户设置页面（`src/renderer/pages/settings/user.tsx`）

### Phase 2: 研究小组 (Week 3-4)

- [ ] 设计 `ResearchGroup` 表（schema.prisma）
  - `id`, `name`, `description`, `ownerId`, `memberIds`
- [ ] 实现小组管理服务（`groups.service.ts`）
- [ ] 添加小组页面（`src/renderer/pages/groups/page.tsx`）
  - 创建/加入小组
  - 共享论文库和笔记
  - 成员权限管理

### Phase 3: 讨论与推荐 (Week 5-6)

- [ ] 设计 `Discussion` 表（schema.prisma）
  - `id`, `paperId`, `userId`, `content`, `parentId`, `createdAt`
- [ ] 实现讨论线程 UI（类似 GitHub PR comments）
- [ ] 添加"推荐给同事"功能
  - 生成分享链接
  - 附带推荐理由

**依赖：** 需要同步机制（可选：WebSocket 或文件共享）

---

## 模块 E：自动化工作流

**负责人：** _待分配_

**目标：** 减少手动操作，提升效率

### Phase 1: RSS 订阅与智能过滤 (Week 1-2)

- [ ] 设计 `RSSFeed` 表（schema.prisma）
  - `id`, `name`, `url`, `filters`, `lastFetchedAt`
- [ ] 实现 RSS 抓取服务（`rss-fetcher.service.ts`）
  - 支持 arXiv/PubMed/Google Scholar RSS
  - 定时任务（每日/每周）
- [ ] 添加订阅管理页面（`src/renderer/pages/feeds/page.tsx`）
- [ ] 实现智能过滤
  - 基于关键词/作者/标签
  - 使用 LLM 评估相关性

### Phase 2: 引用管理与导出 (Week 3-4)

- [ ] 实现 BibTeX 生成服务（`citation-export.service.ts`）
  - 从论文元数据生成 BibTeX 条目
  - 支持批量导出
- [ ] 添加导出功能 UI
  - 选择论文 → 一键复制 BibTeX
  - 导出到 `.bib` 文件
- [ ] 集成 LaTeX 写作助手
  - 自动插入 `\cite{key}`
  - 生成参考文献列表

### Phase 3: 写作助手 (Week 5-6)

- [ ] 实现文献综述生成服务（`literature-review.service.ts`）
  - 基于笔记和标注生成草稿
  - 支持自定义模板
- [ ] 添加写作页面（`src/renderer/pages/writing/page.tsx`）
  - Markdown 编辑器
  - 实时预览
  - AI 辅助改写

**依赖：** 现有 agent 服务（`agent-todo.service.ts`）

---

## 模块 F：数据洞察与分析

**负责人：** _待分配_

**目标：** 提供数据驱动的研究洞察

### Phase 1: 研究趋势分析 (Week 1-2)

- [ ] 实现趋势分析服务（`trend-analysis.service.ts`）
  - 统计论文数量随时间变化
  - 识别热门主题（基于标签频率）
  - 检测新兴方向（近期高增长标签）
- [ ] 创建趋势页面（`src/renderer/pages/trends/page.tsx`）
  - 时间序列图表（使用 Recharts）
  - 词云可视化
  - 热门作者排行

### Phase 2: 作者与机构网络 (Week 3-4)

- [ ] 设计 `Author` 表（schema.prisma）
  - `id`, `name`, `affiliation`, `hIndex`, `paperIds`
- [ ] 实现作者提取服务（`author-extractor.service.ts`）
  - 从论文元数据提取作者
  - 合并同名作者（消歧）
- [ ] 添加作者网络可视化
  - 合作关系图
  - 点击查看作者所有论文

### Phase 3: 期刊/会议推荐 (Week 5-6)

- [ ] 设计 `Venue` 表（schema.prisma）
  - `id`, `name`, `type`, `impactFactor`, `acceptanceRate`
- [ ] 实现投稿推荐服务（`venue-recommendation.service.ts`）
  - 基于论文内容匹配期刊/会议
  - 考虑影响因子和接受率
- [ ] 添加推荐页面（`src/renderer/pages/venues/page.tsx`）

**依赖：** 现有语义搜索服务（`semantic-search.service.ts`）

---

---

## 开发时间线建议

### 第一阶段（Month 1-2）：核心功能

- 模块 A Phase 1-2（文献图谱基础）
- 模块 B Phase 1（多论文对比）
- 模块 C Phase 1（PDF 标注）
- 基础设施 P0

### 第二阶段（Month 3-4）：智能化

- 模块 A Phase 3（图谱高级功能）
- 模块 B Phase 2-3（Gap 分析 + 推荐）
- 模块 E Phase 1-2（自动化工作流）

### 第三阶段（Month 5-6）：协作与洞察

- 模块 C Phase 2-3（笔记关联 + 概念词典）
- 模块 D Phase 1-2（用户系统 + 小组）
- 模块 F Phase 1-2（趋势分析 + 作者网络）

### 第四阶段（Month 7+）：完善与优化

- 所有模块 Phase 3
- 性能优化
- 用户反馈迭代

---

## 协作建议

1. **代码隔离**：每个模块在独立目录开发
   - `src/main/services/{module-name}/`
   - `src/renderer/pages/{module-name}/`
   - `src/db/repositories/{module-name}.repository.ts`

2. **分支策略**：每个模块使用独立 feature 分支
   - `feat/literature-graph`
   - `feat/ai-assistant`
   - `feat/pdf-annotations`

3. **定期同步**：每周合并一次 main 分支，解决冲突

4. **API 约定**：提前定义模块间接口（IPC handlers）

5. **文档优先**：每个模块在 `docs/{module-name}.md` 记录设计

---

## 快速启动检查清单

- [ ] 分配模块负责人
- [ ] 创建 feature 分支
- [ ] 阅读 CLAUDE.md 和现有代码
- [ ] 运行 `npm install && npm run dev` 确保环境正常
- [ ] 开始第一个 Phase 的第一个任务
