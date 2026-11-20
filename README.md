# modtree（模块树）

面向 **Antigravity 2.0** 的 **Agent 自主驱动模块树开发工作台插件**：通过 Aux Pane 常驻侧栏、原生会话切换、MCP 进度回写、`Plan / Code / Review` 生命周期门禁与按需 Git Worktree 隔离，按长期存在的功能模块树组织软件开发。

完整产品与技术规格见：[docs/SPEC_V01.md](docs/SPEC_V01.md)；实战操作流程与避坑指南见：[docs/WORKFLOW_GUIDE.md](docs/WORKFLOW_GUIDE.md)。

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
- **按阶段工程技能路由（内置 19 个精选 ECC Skill，渐进披露）**：
  - `Plan` / `Code` / `Review` 新开会话与 `PreInvocation` 阶段切换时，仅按当前阶段注入对应的 5–8 个技能触发提示（未命中不读全文，避免上下文膨胀）；
  - 自动探测 C++ / ESP32 仓库或固件模块（`CMakeLists.txt`、`platformio.ini`、`sdkconfig`、`.cpp`/`.hpp` 等），仅在匹配项目挂载 C++ 规范与测试技能，对普通 Web/Node/Python 项目零噪音；
  - `Code` 阶段采用软引导，在里程碑收尾标 `待检查` 前提醒执行 `verification-loop` 6 步验证闭环。
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

插件会复制到 `~/.gemini/config/plugins/modtree/` 并被 Antigravity 自动发现。打开任意项目后，点击对话右上角 **`+` → `模块树`** 即可打开侧栏。

> **升级刷新提示**：如果更新版本涉及 MCP 工具参数（如 `slug`、`modtree_bind_session`）或侧栏 UI 变更，请在 Antigravity 插件管理页**关闭再重新开启一次 `modtree`**（或重载窗口），以刷新宿主缓存的 MCP Schema 与侧栏页面。

### 卸载

先在 Antigravity Customizations 页面停用或卸载 `modtree`，再按需清理残留目录：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
```

## 目录结构

```text
modtree/
├── docs/SPEC_V01.md          # v0.1 完整规格与从 0 开始操作手册
├── plugin-static/            # Antigravity 插件清单、hooks.json、mcp_config.json、rules/AGENTS.md 与 19 个内置 skills
├── scripts/                  # 构建（esbuild 零依赖单文件）与安装/卸载脚本
├── src/
│   ├── core/                 # 共享核心：类型、原子存储、树约束、4 层上下文、阶段技能路由、transcript、Git/Worktree
│   ├── hooks/                # PreToolUse 门禁 + PreInvocation 漂移同步
│   ├── mcp/                  # 零依赖 JSON-RPC stdio MCP 服务（modtree_*）
│   ├── sidecar/              # 基于 official sidecar_sdk 的后端服务
│   └── ui/                   # React 侧栏界面（--mt-* 独立高对比度浅/深色板）
├── tests/                    # Vitest 单元测试与真实临时仓库 Git Worktree 集成测试
└── THIRD_PARTY_NOTICES.md    # 第三方开源技能许可与来源说明（ECC · MIT）
```

## 内置阶段工程技能（共 19 个，源自 ECC · MIT）

以下 19 个精选工程技能内置在 `plugin-static/skills/` 中，由 `modtree` 按当前阶段与项目技术栈自动路由（渐进披露，仅命中触发场景时读取对应 `SKILL.md`）：

| 分组 | 技能 ID（均源自 ECC，MIT 协议） |
| --- | --- |
| **Plan 阶段**（架构设计、接口与边界） | `search-first`、`hexagonal-architecture`、`api-design`、`database-migrations`、`error-handling` |
| **Code 阶段**（Worktree 编码、测试与自查） | `tdd-workflow`、`coding-standards`、`orch-refine-code`、`backend-patterns`、`frontend-patterns`、`e2e-testing`、`git-workflow`、`verification-loop` |
| **Review 阶段**（独立只读终审） | `security-review`、`verification-loop`、`coding-standards`、`api-design`、`error-handling` |
| **主控 / 跨阶段通用**（发布、排障、长会话） | `deployment-patterns`、`agent-introspection-debugging`、`strategic-compact` |
| **C++ / ESP32 按需**（自动探测，非 C++ 零噪音） | `cpp-coding-standards`、`cpp-testing` |

## 第三方致谢（Third-Party Acknowledgements）

本插件内置的上述 19 个工程技能（位于 `plugin-static/skills/`）源自开源项目 **Everything Claude Code (ECC)**（Copyright (c) 2026 Affaan Mustafa，**MIT License**），其中 4 个技能（`orch-refine-code`、`strategic-compact`、`tdd-workflow`、`verification-loop`）针对 Antigravity / `modtree` 环境进行了自包含适配。完整许可声明与逐项来源清单见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
