# `modtree`（模块树）v0.1 产品与技术规格说明书

> 定稿日期：2026-11-19（已合并三阶段交接与跨节点轻量化补充定稿）
> 宿主平台：Antigravity 2.0 Desktop App（已于 `v2.33.0` / `hub-2.33.0` 验证，见 [AGY_FEASIBILITY.md](../README.md)）
> 插件名称：`modtree`（显示名：**模块树**；侧栏 ID：`modtree/sidebar`；MCP 服务：`modtree_server`）

---

## 1. 产品定位与核心原则

**一句话定位**：面向 Antigravity 2.0 的 **Agent 自主驱动模块进度看板**——日常靠聊天让 Agent 通过 MCP 维护功能树和进度，右侧 Aux Pane 侧栏保持轻量，负责看树、看实时运行灯、切原生会话与极简手动兜底。

### 核心设计原则
1. **模块树是长期结构，不是一次性待办**：完成后保留薄摘要（`name / status / design / linkedFiles / mergedCommit`）与历史会话，方便日后继续迭代与修 bug。
2. **结构操作与会话操作严格分离**：
   - 改树只在树区（`＋子模块` / `＋新模块`），提供「仅记入树」和「创建并开会话」两个明确按钮；
   - 已有节点卡片里的「开启 / 新开阶段会话」**绝不偷偷新建重复模块节点**。
3. **防打扰（默认静默）**：未绑定任何模块的普通会话做到 **0 工具调用、0 延迟、0 弹窗打扰**。
4. **代码事实优先 + 机械门禁**：不靠软提示词声称只读或隔离，而是用 Antigravity 原生 `PreToolUse` / `PreInvocation` 生命周期 Hook 做机械保障。
5. **零仓库污染 + 数据稀疏防膨胀**：默认数据全存插件数据目录，Worktree 路径自动写入 `.git/info/exclude`；字段全部稀疏按需产生，长篇讨论和完整报告留在原生会话与 `transcript.jsonl`，不塞进节点 JSON。
6. **跨节点中转原则**：不做会话间互相发消息，也不做自动触发下游节点的流水线编排；跨节点一律通过 **「模块树结构化契约 + Git 分支代码」** 中转，推进节奏由人决定。

---

## 2. 技术选型与工程结构

| 层级 | 选型 | 说明 |
| --- | --- | --- |
| **语言与构建** | TypeScript + `esbuild` + Vite | 后端/MCP/Hooks 编译为单文件纯 `.mjs`（构建出的插件目录**零 `node_modules`**，Hook 冷启动 <50ms） |
| **侧栏前端** | React + TypeScript + 纯 CSS（`--mt-*` 独立色板） | 彻底避免与宿主 `preload.js` 注入的 `--muted` 等变量冲突，自动适配深浅主题并保留手动切换 |
| **数据存储** | 按项目拆分 JSON + 原子写入 + 文件锁 + `rev` 校验 | 零原生 C++ 编译依赖；Hook 读盘 <1ms；聊天记录直接只读复用宿主 `transcript.jsonl` |
| **Git 操作** | `execFile('git', args)`（禁止 `shell: true` 拼接） | 兼容 Windows 路径空格，杜绝命令注入 |
| **测试** | Vitest | 覆盖树约束（防循环嵌套）、上下文与依赖漂移、MCP 校验、Hook 门禁单测、临时仓库 `git worktree` 集成测试 |

### 源码仓库与插件产物布局

```text
<repo>/                     # 源码工程
├── package.json
├── tsconfig.json
├── vite.config.ts                        # 构建侧栏前端到 dist/plugin/sidecars/sidebar/public/
├── scripts/
│   ├── build.mjs                         # Vite + esbuild 产出完整零依赖插件包 dist/plugin/
│   ├── install.ps1                       # 就地复制到 ~/.gemini/config/plugins/modtree
│   └── uninstall.ps1                     # 卸载提示与清理
├── src/
│   ├── core/                             # Sidecar / MCP / Hooks 共享核心（纯 TS）
│   │   ├── types.ts                      # 数据模型与契约类型
│   │   ├── store.ts                      # 按 workspacePath 路由、文件锁、原子读写、rev 递增
│   │   ├── tree.ts                       # 增删改查、归档、防循环移动、祖先路径与子进度汇总
│   │   ├── context.ts                    # 4 层漏斗上下文 + 依赖摘要 + reviewNotes + 末条摘要接力
│   │   ├── transcript.ts                 # 只读解析 <appData>/brain/<convId>/.../transcript.jsonl
│   │   └── git.ts                        # merge-base diff / status / behind / worktree / merge / cleanup
│   ├── sidecar/
│   │   └── main.ts                       # 基于官方 sidecar_sdk 的 HTTP + API 后端
│   ├── mcp/
│   │   └── server.ts                     # 零依赖 JSON-RPC stdio MCP 服务（modtree_*）
│   ├── hooks/
│   │   ├── pre-tool-use.ts               # 目录隔离 + Plan/Review 禁写 + run_command cwd 改写 + 危险 git 强确认
│   │   └── pre-invocation.ts             # <5ms 本地查表：未绑定静默，rev/阶段/reviewNotes/依赖漂移自动注入
│   └── ui/                               # React 侧栏应用
│       ├── main.tsx
│       ├── App.tsx
│       ├── styles.css                    # --mt-* 独立高对比度浅/深色主题
│       └── components/                   # ModuleTree, NodeDetail, CreateInline, GitPanel, MergeDialog, SettingsDrawer
├── plugin-static/                        # 静态清单（构建时拷贝进 dist/plugin/）
│   ├── plugin.json
│   ├── mcp_config.json
│   ├── hooks.json
│   ├── rules/AGENTS.md
│   └── sidecars/sidebar/sidecar.json
└── tests/
    ├── tree.test.ts
    ├── context.test.ts
    ├── hooks.test.ts
    ├── mcp.test.ts
    └── git-worktree.test.ts
```

安装到 Antigravity 后的运行时目录：`~\\.gemini\config\plugins\modtree\`（不含 `node_modules`）。

---

## 3. 数据模型与存储隔离

### 3.1 存储路径
- 根目录：`${PLUGIN_DATA}`（Antigravity 为插件侧栏、MCP、Hooks 统一注入，例如 `~/.gemini/antigravity/plugin_data/modtree`）。
- 按规范化后的工作区路径哈希隔离：`${PLUGIN_DATA}/projects/<sha256(normWorkspacePath).slice(0,16)>.json`。
- 快速索引（供 Hook 按 `conversationId` <5ms 反查所属项目与模块）：`${PLUGIN_DATA}/session-index.json`（`conversationId → { projectHash, workspacePath, moduleId }`）。
- 并发安全：写前获取锁文件（带超时过期回收），写入 `.tmp.<pid>.<ts>` 后 `renameSync` 原子替换。

### 3.2 项目与模块 Schema（稀疏按需字段）

未开工/分组节点只保留最小必填字段；临时交接便签（`reviewNotes`）仅存在于极少数活跃返工节点，收尾即清空；可选跨子树依赖（`dependsOn`）仅存模块 ID。

```ts
export type ModuleStatus = '待设计' | '开发中' | '待检查' | '已完成';
export type ModuleStage = 'Plan' | 'Code' | 'Review';

export interface ProjectGitConfig {
  branchPrefix: string;           // 默认 "mod/"
  worktreeDir: string;            // 默认 ".worktrees"
  copyEnvFiles: string[];         // 可选，如 [".env", ".env.local"]
  initCommand: string;            // 可选，如 "pnpm install --frozen-lockfile"
}

export interface SessionRecord {
  conversationId: string;
  title: string;
  stage: ModuleStage;
  createdAt: string;
  syncedRev: number;              // 该会话最后看到的本模块 rev
  syncedAncestorHash: string;     // 该会话最后看到的祖先约束 + dependsOn 摘要哈希
  syncedStage?: ModuleStage;      // 该会话最后看到的阶段
  syncedReviewNotesHash?: string; // 该会话最后看到的 reviewNotes 哈希
  archived?: boolean;
}

export interface ModuleGitState {
  mode: 'main' | 'worktree';      // 默认 'main'；子模块默认继承父模块
  inheritFromParent: boolean;     // 子模块默认 true，显式拆分时置 false
  branch?: string;                // 分支名（如 mod/export-fields）
  worktreePath?: string;          // 绝对路径（.worktrees/<slug>）
  baseBranch?: string;            // 切出时的基线分支（如 main）
  baseCommit?: string;            // 切出/启动 Code 时的基线 commit hash
  mergedCommit?: string;          // 合并回主干后的 commit hash（永久保留）
  mergedAt?: string;
}

export interface ModuleNode {
  id: string;                     // 固定 slug，改名/移动不变
  parentId: string | null;
  order: number;
  name: string;
  status: ModuleStatus;           // Agent 最高自动改到 '待检查'；'已完成' 需人工确认
  stage: ModuleStage;             // 当前活跃阶段
  design?: string;                // 简短 Markdown（目标 + 关键约束/接口 + 验收要点），侧栏默认折叠显示 2 行
  stop?: string;                  // 停在（MCP 校验 <= 100 字）
  next?: string;                  // 下一步（MCP 校验 <= 100 字）
  reviewNotes?: string;           // 稀疏临时字段：Review 打回 Code 的具体问题清单（覆盖写，通过/完成即自动清空）
  linkedFiles?: string[];         // 相对项目根的代码路径，侧栏点击可打开
  dependsOn?: string[];           // 可选轻量跨子树依赖：仅存目标模块 ID
  rev: number;                    // design / linkedFiles / dependsOn / parentId 变更时自增
  activeSessionId?: string;       // 当前主会话 ID
  stageSessions?: Partial<Record<ModuleStage, string>>; // 各阶段当前指向的会话（默认复用 activeSessionId）
  sessions?: SessionRecord[];     // 含当前与历史会话
  git?: ModuleGitState;
  archived?: boolean;
  updatedAt: string;
  updatedBy: string;
}
```

- 项目级可选默认值：若项目根目录存在 `.modtree.json`，初始化 `ProjectGitConfig` 时读取其字段作为默认值（插件数据目录中的用户修改优先级更高）。

---

## 4. 4 层上下文架构、跨节点交接与漂移同步

### 4.1 纵向漏斗开场上下文（新开模块会话，控在 ~300–500 字）
1. **祖先路径只带约束**：从根到父节点，每层仅带 `名称 + design`（公共接口契约上提到共同父节点的 `design`，子节点自动继承）；
2. **当前模块完整卡片**：路径、阶段、设计要点、上次「停在 / 下一步」、活跃 `reviewNotes`（若有）、关联代码文件、有效 Git 分支与工作目录（主目录或 Worktree 路径）；
3. **可选 `dependsOn` 依赖摘要**：若节点配置了 `dependsOn`，仅附目标模块的 `name + status + design` 摘要（**绝不带聊天记录**）；
4. **兄弟/子模块仅列目录名与状态**：界定边界，不塞细节；
5. **绑定标记与按需深查**：附 `[modtree: bound project=<ws> module=<id> stage=<stage>]`，其余跨子树信息由 Agent 按需调用 `modtree_get_module` 读取。

### 4.2 横向接力（同模块重开或拆出独立 Review 会话）
- 自动带入当前模块最新结构化字段 + 从上一个绑定会话的 `transcript.jsonl` 末尾摘取最后 1 条 Agent 回复摘要（≤240 字）；
- Review 阶段额外附上精准 diff 指引：
  - **Worktree 分支模式**：优先基于 `git merge-base <baseBranch> HEAD` 执行三点 diff（`git diff <baseBranch>...HEAD` + 未提交改动），避免同步主干后基线漂移；
  - **主目录单线模式**：结合 `baseCommit` + 未提交 `git diff` + `linkedFiles` 界定审查范围。

### 4.3 代码事实优先
- 开场上下文与 Rule 明确声明：模块节点只存意图、约束与文件路径，动手前一律以磁盘最新代码为准。

### 4.4 `PreInvocation` 零额外轮次漂移同步
- 用户在已绑定会话发下一条消息前，`PreInvocation` Hook 本地查表（<5ms）：
  - 未绑定会话 → 直接返回 `{}`（零开销）；
  - 已绑定会话若检测到以下任一变化：本模块 `rev` 变化、祖先或 `dependsOn` 目标约束哈希（`ancestorHash`）变化、`stage` 变化、或 `reviewNotes` 更新 → 通过 `injectSteps.systemMessage` 静默注入精简变更增量，并更新该会话的 `synced*`，**不额外唤醒一次模型**；
  - 侧栏同时显示轻量过期提示，并提供明确标注“会触发一轮确认”的手动「立即推送上下文」兜底按钮。

---

## 5. Git + Worktree + 双 Hook 机械保障

### 5.1 混合隔离与收口粒度
- **Git 收口粒度**：`Plan` 可多节点自由拆；`Code` 优先按独立功能大分支（父模块）开 Worktree，同父兄弟/子节点默认继承父模块的 Worktree 与分支（代码修改磁盘直通、减少反复合并），子模块完成后回到父节点做集成 Review 并一次性 Merge 回主干；仅在显式需要并行隔离时才为子节点单独拆分 Worktree。
- **默认主目录**：单线开发 / Plan 直接使用主目录。若主目录存在未提交改动或另一活跃主目录 Code 会话，侧栏提示（开 Worktree / 先去原模块提交 / 继续仅 Plan），**绝不自动 `git stash` 或 `git checkout`**。
- **按需创建 Worktree**：
  1. 校验 `.git/info/exclude` 包含 `.worktrees/`（不存在则追加）；
  2. 记录当前主干分支 `baseBranch` 与 `baseCommit`（`git rev-parse HEAD`）；
  3. 执行 `git worktree add -b <prefix><slug> <repo>/.worktrees/<slug> <baseCommit>`；
  4. 按 `ProjectGitConfig` 拷贝指定的 `.env*` 文件（若存在），可选执行 `initCommand`。
- **主干前进（Behind Base）**：
  - 侧栏检测 `git rev-list --count <branch>..<baseBranch>`；
  - 落后 > 0 时显示提示条，提供手动 **「将主干合并到此 Worktree」** 按钮（默认 `git merge <baseBranch>`，遇冲突立即 `git merge --abort` 并提示交由人工或该会话处理，绝不自动 rebase）。
- **合并回主干与清理（双确认闭环）**：
  1. 用户点击 **「合并回主干」**，弹层确认并自选：**Squash Merge（默认，1 模块 1 提交，可编辑提交信息）** 或 **普通 Merge（`--no-ff`）**；
  2. 检查主目录是否干净、worktree 是否有未提交改动；在主目录执行合并，遇冲突立即中止并回滚；
  3. 合并成功记录 `mergedCommit` 与 `mergedAt`，将节点状态置为 `已完成` 并自动清空 `reviewNotes`；
  4. **二次确认**后才执行 `git worktree remove` 与 `git branch -d/-D`，模块节点、薄摘要与历史会话永久保留。

### 5.2 `hooks.json` 契约设计

1. **`PreToolUse`（匹配 `write_file|edit_file|run_command`）**：
   - 读取 stdin JSON 中的 `conversationId`、`workspacePaths`、`artifactDirectoryPath`、`toolCall`。
   - 查 `session-index.json`：未绑定 → 立刻输出 `{"decision":"allow"}`（<5ms）。
   - 解析绑定模块的有效 `stage` 与有效工作目录（主目录或继承的 `worktreePath`）：
     - **对 `write_file` / `edit_file`**：
       - 若目标路径位于 `artifactDirectoryPath` 内 → `allow`（不影响 Antigravity 自身 `/plan` 产物）。
       - 若阶段为 `Plan` 或 `Review` → `deny`（原因：`当前模块处于 Plan/Review 只读阶段，禁止修改工作区代码；如需改代码请在侧栏切回 Code 阶段`）。
       - 若处于 Worktree `Code` 阶段，且目标规范路径不在 `worktreePath` 内 → `deny`（原因：`当前会话绑定于 Worktree <worktreePath>，禁止写入主目录或其他 Worktree`）。
     - **对 `run_command`**：
       - 命中高危 Git 命令（`git merge`、`git rebase`、`git push`、`git reset --hard`、`git worktree remove`、`git checkout` / `git switch` 切主干）→ `force_ask`（提示“需用户明确确认”）。
       - 若处于 `Plan` / `Review` 阶段：匹配只读白名单（`git status/diff/log/show/rev-parse/merge-base`、测试/lint/类型检查命令如 `vitest`/`pytest`/`npm test`/`tsc --noEmit`、`rg`/`Get-ChildItem`/`Get-Content` 等）→ `allow`；其余 → `force_ask`。
       - 若处于 Worktree `Code` 阶段：若 `CommandLine` 尚未切入 `worktreePath`，通过 `overwrite: { CommandLine: "Set-Location -LiteralPath '<worktreePath>'; " + original }` 自动定位到该 Worktree 内执行。
2. **`PreInvocation`**：
   - 未绑定 → `{}`；
   - 已绑定且检测到 `rev` / `ancestorHash` / `stage` / `reviewNotes` 漂移 → 注入精简 `systemMessage` 并更新该会话的 `synced*`。

---

## 6. MCP 工具协议、插件 Rule 与三阶段闭环

### 6.1 MCP 工具清单（全部要求传入 `workspacePath` 路由多项目）

| 工具名 | 用途 | 关键校验 |
| --- | --- | --- |
| `modtree_get_tree` | 读取当前项目的模块树与状态摘要（含子进度统计） | 按 `workspacePath` 路由 |
| `modtree_get_module` | 读取指定模块（含祖先约束、`dependsOn` 摘要、关联文件、Git/Worktree 信息、历史会话） | 支持按 `moduleId` 或 `conversationId` 查询 |
| `modtree_update_progress` | 更新 `stop`、`next`、`status`、`linkedFiles`、`reviewNotes`（**不含 `stage`**） | `stop`/`next` ≤ 100 字；**禁止 Agent 自动设 `status="已完成"`**（最多到 `待检查`）；传 `clearReviewNotes: true` 或标记通过时清空 `reviewNotes` |
| `modtree_set_stage` | 切换模块阶段（`Plan` / `Code` / `Review`） | 仅在用户**明确口头指令**（如“进入 Code 阶段”）时允许调用；日常主要在侧栏点按钮切换 |
| `modtree_create_module` | 新建顶层或子模块（支持可选 `design`、`dependsOn`） | 校验 `parentId` 存在、防同父下同名重复 |
| `modtree_update_module` | 修改名称、`design`、父节点、`linkedFiles`、`dependsOn` | 移动父节点强校验**防循环嵌套**；改 `design` / `dependsOn` / `linkedFiles` / `parentId` 自动 `rev++` |
| `modtree_archive_module` | 归档模块（软删除，保留历史） | 若有活跃未合并 worktree 返回警告 |
| `modtree_bind_session` | 将指定 `conversationId` 绑定到模块（含阶段） | 同步刷新 `session-index.json` |

### 6.2 `rules/AGENTS.md`（零打扰规则）
1. **静默红线**：仅当当前会话上下文已包含 `[modtree: bound ...]` 标记，或用户在消息中主动提及「模块树 / modtree / 建模块 / 绑定模块」时，才允许调用 `modtree_*` 工具；普通会话**零调用**。
2. **轮末自动回写**：已绑定模块的会话在每轮实质工作告一段落后，自动调用 `modtree_update_progress`（传入当前工作区绝对路径、简短 `stop`/`next` ≤ 80 字、涉及的 `linkedFiles`），不自动标记 `已完成`。
3. **阶段切换与结构改动先确认**：新建、拆分、移动、归档模块，以及调用 `modtree_set_stage` 切换 `Plan / Code / Review`（尤其是从只读阶段进入 `Code`），必须由用户明确口头要求或先提议经确认后再执行。
4. **Review 交接纪律**：Review 发现问题时禁止直接改代码，将具体问题清单覆盖写入 `reviewNotes` 并提示用户切回 `Code`；Review 通过时设置 `clearReviewNotes: true` 并提示用户确认合并或标为已完成。
5. **代码事实优先**：动手改代码前先读取磁盘最新文件；Worktree 会话严格在指定的 `.worktrees/<slug>/` 内操作。

### 6.3 `Plan ↔ Code ↔ Review` 阶段联动闭环
- **点击阶段按钮**：
  - **共用同一会话（默认）**：立即更新模块 `stage` 与 `session-index.json` → `PreToolUse` 门禁瞬间切换；不自动发消息，下一轮由 `PreInvocation` 自动静默告知阶段变更。
  - **独立阶段会话（按钮带 `↗` 标识）**：切换门禁的同时自动调用 `toggleConversation` 在同窗切到对应阶段会话。
- **阶段提示条与快捷操作**：
  - `Plan`：`🔒 只读规划模式 · 产出沉淀至「设计要点」`
  - `Code`：`✏️ 编码模式 · 写入范围：主目录 / .worktrees/<slug>`
  - `Review`：`🔍 只读审查模式 · diff 范围（merge-base / baseCommit）` + 一键 **「开独立审查会话」**（仅当 Review 尚未独立会话时显示）。
- **数据流转与返工**：
  - `Plan → Code`：`design` 沉淀目标、约束与验收要点 → 切 `Code` 自动继承并记录 `baseCommit`。
  - `Code` 日常自测（避免频繁来回切阶段）：小改动与日常迭代直接在 `Code` 会话内跑测试，或调用 Antigravity 原生只读子代理（如 `code-reviewer` / `research`）做自查并当场修复，无需每次微调都切到 `Review`。
  - `Code → Review`（合并前独立终审）：`Review` 定位为功能收口 / **合并主干前的独立终审把关**；Code 完成后回写 `linkedFiles`、`stop/next`、`status: "待检查"` → 切到 `Review`（推荐「开独立审查会话」）按三点 diff（Worktree）或 `baseCommit + linkedFiles`（主目录）终审。
  - `Review → 完成 / 打回 Code`：通过则清空 `reviewNotes`，由用户确认合并与标为 `已完成`；若终审发现阻塞问题则把问题清单写入 `reviewNotes`（覆盖写，只留最新 1 份），切回 `Code` 后 `PreInvocation` 自动将 `reviewNotes` 注入 Code 会话。
- **老模块重开与同模块多次改动（轻量化取舍）**：
  - 保持单层模块树，**不引入**“模块 → 多条任务卡片”的二层重实体；
  - 已 `已完成` 的模块再次切入 `Code` 时，状态自动从 `已完成` 回退为 `开发中`（保留历史 `mergedCommit` 与历史会话，修复状态语义冲突）；
  - 同一模块先后改 a / 改 b（如「增加 CSV」「修中文乱码」）时，通过为该模块新开**带简短改动标题的命名会话**在历史会话列表中留痕区分，**绝不把一次性改动或修 bug 建成子模块**。
- **待落地微调（准备修改 `modtree` v0.1.1）**：
  1. **浏览与跳会话解耦（4a）**：单击树节点仅在侧栏看详情、不打断当前主聊天；点击节点行右侧快捷跳转图标（`↗`）或详情区「定位会话」按钮才调用 `toggleConversation`；
  2. **老模块重开 + 命名会话**：`setModuleStage('Code')` 时若原状态为 `已完成` 自动切回 `开发中`；新开会话支持填可选简短改动标题（如“修中文乱码”），历史会话列表直接展示标题；
  3. **`Code` 自测 + `Review` 合并前终审**：更新 `rules/AGENTS.md` 与 `context.ts`，鼓励 `Code` 内用原生只读子代理（如 `code-reviewer`）自查自修、`Review` 定位为合并/收口前独立终审；
  4. **`reviewNotes` 一键「回 Code 修复」**：返工卡片增加一键切回 `Code` 阶段并定位 Code 会话；
  5. **合并弹窗轻量提醒**：若尚未走过独立 Review，在合并确认弹窗里给一行提示（可直接合并或先点此开独立审查会话，不强拦）。

---

## 7. 侧栏 UI（Aux Pane）功能与交互

- **顶栏**：标题 `模块树` + 连接灯 + 当前项目名（随 `onWorkspaceChange` 自动切换）+ `Git 设置` 折叠入口 + `浅/深` 主题切换。
- **模块树区**：
  - 顶部 **`＋新模块`**，节点行右侧 **`↗`（跳转绑定会话）** 与 **`＋子`**；行内创建提供双按钮：**「仅记入树」** / **「创建并开会话」**。
  - 多级折叠展开；父节点纯前端计算显示**子节点进度汇总角标（如 `1/3`）**；每个节点展示状态徽章、Worktree 标识（含继承提示）、以及 **实时运行状态灯**（只读监听 `transcript.jsonl`：`运行中` 琥珀 / `有新回复` 绿点 / `空闲` 灰点）。
  - 点击节点：**单击仅选中并在侧栏查看详情，不打断当前聊天、绝不自动发送消息**；点行右侧 `↗` 或详情卡「定位会话」才调用 `toggleConversation` 切换主聊天。
- **选中节点卡片**：
  - 路径 + 状态下拉（仅人工可点 `已完成`，标为已完成时自动清空 `reviewNotes`）+ `Plan / Code / Review` 阶段切换 + 轻量「重命名 / 归档」。
  - **阶段门禁条**：显示当前只读/写入范围；Review 阶段未独立会话时提供「开独立审查会话」。
  - **Git / Worktree 条**：显示主目录 / `mod/<slug>`（及是否继承父 Worktree）、落后主干提醒、「创建 / 拆分 Worktree」、「同步主干」、「合并回主干（Squash / --no-ff，含未终审轻量提醒）」、「清理 Worktree」。
  - **设计要点**：默认折叠显示 2 行，点击展开查看/轻量编辑简短 Markdown。
  - **Review 返工清单（稀疏显示）**：仅当 `reviewNotes` 非空时醒目展示，附 **「回 Code 修复」** 与「清空」按钮。
  - **停在 / 下一步**：自动同步 MCP 回写，支持点击轻量微调保存。
  - **关联代码文件**：芯片列表，点击调用 `toggleAuxPane({ tabType: 'fileView', uri })` 直接在侧栏打开代码。
  - **跨子树依赖（稀疏显示）**：仅当 `dependsOn` 非空时显示依赖模块状态芯片。
  - **会话控制**：主会话定位 / `绑定当前会话` / `开启会话` 或 `为此阶段新开会话`（支持填写简短改动标题）/ `历史会话` 折叠列表（展示改动标题与阶段）/ 过期提示条与显式「立即推送最新上下文」按钮（标明会触发一轮确认）。

---

## 8. 从 0 开始操作手册（v0.1）

### 第 0 步：构建、安装与开启
1. 构建并安装：`cd <repo> && npm install && npm run build && powershell -ExecutionPolicy Bypass -File scripts\install.ps1`。
2. 插件安装至 `~/.gemini/config/plugins/modtree/`（自动发现，无需重启 Antigravity）。
3. 打开任意代码项目，在对话右上角点 **`+` → `模块树`**，右侧 Aux Pane 打开模块树侧栏。

### 第 1 步：空项目正确起步（先扁平建底座，不硬拆深层树）
- 空项目起步只需 **3–5 个扁平一级模块**（或先建 1 个 `项目底座`），**不要一开始就强行拆 2–3 层子模块**；子模块等单个模块写大、单会话聊不动时再自然拆出。
- **底座必须单线先做**：先在主目录（不开 Worktree）把脚手架、`package.json`、目录结构、主入口和公共数据类型搭好并提交到 `main`，再考虑并行其他模块。

### 第 2 步：Plan → Code（内嵌子代理自测）→ Review（合并前终审）
1. `Plan` 阶段（自动只读禁写源码）：聊清楚目标、约束与接口，Agent 沉淀进 `design`（公共接口上提到父节点 `design`）。
2. 在侧栏点 **`Code`** 解锁编码权限：日常迭代与小改动直接在 `Code` 内跑测试，或让 Agent 调只读子代理（如 `code-reviewer`）自查自修，不频繁来回切阶段；每轮结束 Agent 自动回写 `stop / next / linkedFiles`。
3. 同一模块做完后过几天回来修 bug / 加小改动：直接切回 `Code`（状态自动回到 `开发中`）或新开一条带改动标题的会话（如“修中文乱码”），**不要把一次性小改动建成子模块**。
4. 功能收口准备合并主干前，点 **`Review`**（推荐 **「开独立审查会话」**）：按 `git diff <baseBranch>...HEAD` 做一次独立终审。若审出阻塞问题，点击返工卡片的 **「回 Code 修复」** 一步切回修复；通过后清空 `reviewNotes`。

### 第 3 步：按需并行与避冲突铁律
- **仅看进度不打断**：写 A 时想瞄一眼 B 的设计或进度，直接单击 B 看侧栏详情，主聊天区仍留在 A；真要切过去再点 `↗` 或「定位会话」。
- **边界不清就串行，边界清晰才开 Worktree**：只有底座已提交到 `main`、且 A/B 大概率改不同文件时，才在父模块点 **「创建 Worktree」** 并行开发（子模块自动继承父 Worktree）。
- **合并前先同步主干**：A 先合回 `main` 后，B 合并前先在 B 的 Worktree 点 **「同步主干」**，如有小冲突直接在 B 内解决测通，再把 B 干净合回 `main`。

### 第 4 步：集成收口、合并与清理
- 子模块陆续完成后，回到父节点做一次集成 `Review`。
- 点 **「合并回主干」**，选 **Squash（默认）** 或 **`--no-ff`** 确认合并；合并成功后二次确认清理 Worktree 与分支，节点与 `mergedCommit` 永久保留在树中备查。

---

## 9. 明确砍掉 / 留待 v0.2 的范围（防过度设计）
- **不做**模块下二层「多任务 / 变更单」实体（v0.1 坚持单层模块树 + 命名会话留痕）
- **不做**重型测试验收日志面板与 CI 证据落库
- **不做**自动多轮 `Code ⇄ Review` 编排循环（保持人在回路把关）
- **不做**跨电脑 Git 自动同步模块 JSON（v0.1 坚持零仓库污染，后续视真实跨机需求再加导出/导入）
- 留待 v0.2：侧栏拖拽排序、树内搜索与待处理汇总视图、冷启动全仓扫描引导、全局依赖图、T3 / ACP 多 Agent 适配器
