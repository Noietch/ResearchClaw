---
name: atomic-commit-reorganize
description: 将杂乱的 commit history 重组为干净的原子 commit。当用户说 "整理commit"、"reorganize commits"、"atomic commit"、"clean up history"、"重新组织提交" 时使用。
user-invocable: true
argument-hint: "[HEAD~N | base..head | --dry-run]"
allowed-tools: Bash, Read, Glob, Grep, Edit, Write, Agent
---

# Atomic Commit Reorganizer

你是一个 commit history 重组专家。你的任务是将用户指定范围内的杂乱 commit 重组为**最细粒度**的干净原子 commit。

当用户希望提交PR的时候，应该调用你来整理 commit history，确保每个 commit 都是一个独立的、可理解的功能单元。你会分析当前的 commit history，设计一个重组方案，并在用户确认后执行。

## 核心原则：最细粒度拆分

**一个文件的改动可以且应该被拆分到多个 commit 中。** 不要因为"都在同一个文件"就放在一起。按语义功能拆分，而不是按文件拆分。

例如 `use-ipc.ts` 同时新增了 Highlight 类型、Overleaf 类型和 Citation IPC，它们应该分属 3 个不同的 commit。

## 参数

`$ARGUMENTS` 可以是：
- 空：自动检测——从上次整理标记（`atomic-checkpoint` tag）到 HEAD；如果没有标记，则从 base branch 到 HEAD
- `HEAD~N`：重组最近 N 个 commit
- `<base>..<head>`：重组指定范围
- `--dry-run`：只展示方案，不执行

## 重组流程

### Step 1: 确定范围 + 安全备份

```bash
CHECKPOINT=$(git tag -l "atomic-checkpoint" | tail -1)

if echo "$ARGUMENTS" | grep -q "\-\-dry-run"; then
  DRY_RUN=true
  ARGS=$(echo "$ARGUMENTS" | sed 's/--dry-run//' | xargs)
else
  DRY_RUN=false
  ARGS="$ARGUMENTS"
fi

# CRITICAL: 检查工作区是否干净
if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️ 工作区有未提交的修改，请先提交或 stash"
  exit 1
fi

if [ -n "$ARGS" ]; then
  BASE_REF="$ARGS"
elif [ -n "$CHECKPOINT" ]; then
  BASE_REF="$CHECKPOINT"
else
  BASE_REF=$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null)
fi

git log --oneline ${BASE_REF}..HEAD

# 创建安全备份
BACKUP="backup/pre-atomic-$(date +%Y%m%d-%H%M%S)"
git branch $BACKUP
```

### Step 2: 评估当前 history

逐 commit 分析 tangling、fragmentation 和 message alignment。如果已经很好（≥ 8/10），告知用户并询问是否继续。

### Step 3: 深度 diff 分析

```bash
git diff $BASE_REF..HEAD > /tmp/_atomic_squash.diff
git diff $BASE_REF..HEAD --stat
git diff $BASE_REF..HEAD --name-only
```

**关键步骤：逐文件逐 hunk 分析**

对每个改动的文件：
1. 用 `git diff $BASE_REF..HEAD -- <file>` 查看具体 diff
2. 识别每个 hunk 属于哪个语义功能
3. 标记需要 intra-file split 的文件
4. 读取源文件理解上下文（函数边界、类边界、import 分组）

### Step 4: 设计原子 commit 方案

#### 4.1 拆分粒度标准

每个原子 commit 必须满足：
- **单一关注点**：做且只做一件事
- **自包含**：不看其他 commit 就能理解
- **可回放**：按顺序 apply 不会出错
- **可 revert**：单独 revert 不会破坏其他 commit
- **最小化**：不能再拆分成更小的有意义的 commit

#### 4.2 拆分策略（按优先级）

1. **依赖/配置变更** → 独立 commit（`package.json`, `.gitignore`, `tsconfig` 等）
2. **Schema/DB 迁移** → 每个 model 变更一个 commit
3. **纯 utility/helper** → 独立 commit（不依赖 UI 的共享模块）
4. **测试** → 与对应实现分开或合并，取决于是否独立可理解
5. **后端 service** → 每个 service 独立
6. **后端 IPC handler** → 跟随对应的 service/feature
7. **前端组件** → 每个独立组件一个 commit
8. **前端集成** → 将组件集成到页面的胶水代码
9. **文档/配置** → 独立 commit
10. **TypeScript 类型修复** → 合入引起问题的 commit，或独立（仅当与任何功能无关时）

#### 4.2.1 Fix 合并原则

**Bug fix 不应该是独立的 commit，除非它修复的是已经 merge 到 main 的代码。**

在重组范围内，如果一个 fix commit 修复的是**同一分支上另一个 commit 引入的 bug**，则：
- 该 fix 必须合入引入 bug 的那个功能 commit
- 最终的原子 commit 应该直接包含正确的代码，而不是"先写错再修"

例如：
- Commit A: `feat: add PDF viewer`（有 bug：numPages 属性名错误）
- Commit B: `fix: use correct numPages property`
- 重组后：Commit A 直接包含正确的 numPages，不存在 Commit B

**只有修复 main 分支上已有代码的 fix 才应该独立存在。**

#### 4.3 Intra-file split 分析

对于跨多个功能的文件，**必须**进行 intra-file split：

**常见需要 split 的文件模式：**
- `use-ipc.ts`：类型定义 + IPC 调用按功能分散
- `providers.ipc.ts`：不同 feature 的 IPC handler
- `import-modal.tsx`：不同导入方式的 tab
- `schema.prisma`：不同 model 的 schema
- `en.json` / `zh.json`：不同 feature 的 i18n key
- `reader/page.tsx`：不同功能（PDF viewer、citation sidebar、preview modal）的集成代码
- `papers.service.ts`：不同 method 属于不同 feature

**分析方法：**
```bash
# 查看文件的 diff hunks
git diff $BASE_REF..HEAD -- <file> | grep "^@@"

# 对每个 hunk，标注它属于哪个 feature
# Hunk 1: +import { HighlightItem } → highlight feature
# Hunk 2: +export interface OverleafProject → overleaf feature
# Hunk 3: +scanBrowserDownloads → browser download feature
```

#### 4.4 排序策略

1. 依赖/配置 → 最先
2. 共享模块（shared/utils, shared/types）→ 在使用者之前
3. DB schema → 在 service 之前
4. 后端 service → 在 IPC handler 之前
5. IPC handler → 在前端之前
6. 前端 utility → 在前端组件之前
7. 前端组件 → 在页面集成之前
8. 页面集成 → 最后
9. 测试可以紧跟实现，也可以在最后
10. Fix / chore → 按独立性穿插

### Step 5: 展示方案并等待确认

**必须在执行前展示完整方案。方案必须标明 intra-file split。**

展示格式：
```
## 重组方案

当前: N 个杂乱 commit → 重组为 M 个原子 commit

### Commit 1: chore: add new dependency
  新文件: -
  修改文件: package.json, package-lock.json
  Intra-file: -

### Commit 2: feat: add highlight data model
  新文件: src/db/repositories/highlights.repository.ts
  修改文件: src/db/index.ts, prisma/schema.prisma
  Intra-file:
    - prisma/schema.prisma: 只加 Highlight model（不含其他 model）
    - use-ipc.ts: 只加 HighlightItem 类型 + highlight IPC 调用

### Commit 3: feat: add overleaf cookie storage
  新文件: -
  修改文件: src/main/store/app-settings-store.ts
  Intra-file:
    - app-settings-store.ts: 只加 overleafSessionCookieEncrypted 相关代码

是否执行？[y/n/edit]
```

- `y`：执行
- `n`：终止
- `edit` 或提出修改：调整方案后重新展示
- `--dry-run`：只展示不执行

### Step 6: 执行重组

**使用 worktree 隔离执行，确保零数据丢失。**

```bash
EXPECTED_TREE=$(git rev-parse HEAD^{tree})
WORK_DIR=$(mktemp -d)
git worktree add "$WORK_DIR" $BASE_REF --detach
cd "$WORK_DIR"
```

#### 6.1 核心原则：直接写文件内容

对每个原子 commit 中的每个文件：
1. 读取该文件在此 commit 后应有的内容
2. 用 Write/Edit 工具写入文件
3. `git add <file>`

#### 6.2 Intra-file split 执行方式

**这是最关键也最容易出错的步骤。**

当同一文件的不同改动属于不同 commit 时：

1. **准备阶段**：读取文件的 base 版本和 final 版本，理解所有 diff hunks
2. **Commit N**：从当前文件状态出发，只应用属于 commit N 的 hunks
   - 如果是新增 import：只加这个 commit 需要的 import
   - 如果是新增函数：只加这个 commit 的函数
   - 如果是新增 interface：只加这个 commit 的 interface
   - 如果修改已有代码：只改这个 commit 相关的行
3. **Commit N+1**：在 commit N 之后的文件状态上，追加 commit N+1 的改动
4. **验证**：最后一个 commit 后，文件内容必须等于 final 版本

**跟踪方法**：Agent 必须仔细记录每个文件在每一步的状态。可以用 `git diff HEAD -- <file>` 确认当前状态。

```bash
# 每个 commit
git add <files>
git commit -m "$(cat <<'EOF'
commit message

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

#### 6.3 异常处理

任何步骤出错，立即放弃 worktree：
```bash
cd -
git worktree remove "$WORK_DIR" --force
echo "✗ 执行失败，原始分支未受影响"
```

### Step 7: 验证 + 替换

```bash
ACTUAL_TREE=$(git rev-parse HEAD^{tree})
if [ "$EXPECTED_TREE" != "$ACTUAL_TREE" ]; then
  echo "✗ 验证失败！tree hash 不一致"
  # 输出 diff 帮助调试
  git diff $EXPECTED_TREE $ACTUAL_TREE --stat
  cd -
  git worktree remove "$WORK_DIR" --force
  exit 1
fi

echo "✓ Tree hash 验证通过"
NEW_HEAD=$(git rev-parse HEAD)
cd -

git reset --hard $NEW_HEAD
git worktree remove "$WORK_DIR" --force
git tag -f atomic-checkpoint HEAD

git log --oneline --stat ${BASE_REF}..HEAD
```

### Step 8: 清理

```bash
echo "重组完成！"
echo "  备份分支: $BACKUP"
echo "  如需恢复: git reset --hard $BACKUP"
echo "  如需 push: git push --force-with-lease"
```

## 安全规则（不可违反）

1. **永远先创建备份分支**
2. **永远在执行前展示方案并等用户确认**
3. **永远在执行后验证 tree hash 一致**
4. **验证失败立即恢复到备份**
5. **不主动 force push**——只提醒用户
6. **宁可保守合并也不要丢代码**
7. **重组成功后更新 `atomic-checkpoint` tag**

## 增量整理机制

- 每次成功后自动打 `atomic-checkpoint` tag
- 下次默认只重组 tag 之后的新 commit
- 用 `--all` 或指定范围覆盖

## 和 evaluate 的关系

- `/atomic-commit-evaluate`：只输出报告
- `/atomic-commit-reorganize`：报告 + 生成方案 + 执行
