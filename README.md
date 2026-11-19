# modtree（模块树）

面向 **Antigravity 2.0** 的 **Agent 自主驱动模块树开发工作台插件**：通过 Aux Pane 常驻侧栏、原生会话切换、MCP 进度回写、`Plan / Code / Review` 生命周期门禁与按需 Git Worktree 隔离，按长期存在的功能模块树组织软件开发。

完整产品与技术规格（含从 0 开始操作手册）见：[docs/SPEC_V01.md](docs/SPEC_V01.md)。

## 核心特性

- **Agent 自主维护 + 侧栏轻量看树与切会话**：平时直接跟 Agent 聊天，轮末自动通过 MCP 工具（`modtree_*`）回写精简的「停在 / 下一步 / 关联代码文件」；侧栏展示层级树、子进度角标（`done/total`）与实时运行状态灯（只读监听 `transcript.jsonl`）。
- **零打扰默认静默**：未绑定模块的普通会话在 `PreInvocation` / `PreToolUse` Hook 中 <50ms 直接放行，0 额外工具调用。
- **结构与会话严格分离**：树上 `＋新模块 / ＋子模块` 提供「仅记入树」与「创建并开会话」双按钮；节点卡片内「开启 / 为当前阶段新开会话」绝不新增重复模块，历史会话全部保留。
- **三阶段机械门禁（`Plan ↔ Code ↔ Review`）**：
  - `PreToolUse` 在 `Plan` / `Review` 阶段硬拦截工作区写文件（允许 Antigravity 自身 artifact 目录），并放行只读 `git diff` / 测试命令；
  - `modtree_set_stage` 与 `modtree_update_progress` 拆分，防止 Agent 自行解锁 `Code` 写入权限；
  - Review 返工问题写入稀疏临时字段 `reviewNotes`，切回 `Code` 时由 `PreInvocation` 自动注入，通过或标为「已完成」后自动清空。
- **混合 Git + 按需 Worktree 隔离**：
  - 默认主目录单线开发；需要并行写代码时一键在 `.worktrees/<slug>/` 创建独立分支与 Worktree（自动写入 `.git/info/exclude`，零污染 `git status`）；
  - 子模块默认继承父模块 Worktree 与分支，完成后在父模块统一 Review 并按需 Squash（默认）或 `--no-ff` 合并回主干，遇冲突自动中止回滚；
  - `PreToolUse` 硬限制 Worktree 会话写入目录，并自动通过 `overwrite.CommandLine` 将终端命令切入对应 Worktree 目录。
- **零依赖构建产物**：开发期使用 TypeScript + React + esbuild + Vitest，构建出的插件目录 `dist/plugin/` 不含 `node_modules`，Hook 冷启动 <50ms。

## 快速开始

### 前置条件
- Node.js 22+
- Git
- Antigravity 2.0 Desktop App（已于 `v2.33.0+` 验证）

### 安装依赖、测试与构建

```bash
npm install
npm run typecheck
npm test
npm run build
```

### 安装插件到 Antigravity（Windows PowerShell）

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

插件会复制到 `~/.gemini/config/plugins/modtree/` 并被 Antigravity 免重启自动发现。打开任意项目后，点击对话右上角 **`+` → `模块树`** 即可打开侧栏。

### 卸载

先在 Antigravity Customizations 页面停用或卸载 `modtree`，再按需清理残留目录：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
```

## 目录结构

```text
modtree/
├── docs/SPEC_V01.md          # v0.1 完整规格与从 0 开始操作手册
├── plugin-static/            # Antigravity 插件清单、hooks.json、mcp_config.json、rules/AGENTS.md
├── scripts/                  # 构建（esbuild 零依赖单文件）与安装/卸载脚本
├── src/
│   ├── core/                 # 共享核心：类型、原子存储、树约束、4 层上下文、transcript、Git/Worktree
│   ├── hooks/                # PreToolUse 门禁 + PreInvocation 漂移同步
│   ├── mcp/                  # 零依赖 JSON-RPC stdio MCP 服务（modtree_*）
│   ├── sidecar/              # 基于 official sidecar_sdk 的后端服务
│   └── ui/                   # React 侧栏界面（--mt-* 独立高对比度浅/深色板）
└── tests/                    # Vitest 单元测试与真实临时仓库 Git Worktree 集成测试
```
