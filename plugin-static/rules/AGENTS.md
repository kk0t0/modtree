# modtree（模块树）协作规则

本规则仅适用于 Antigravity `modtree` 插件（MCP 工具前缀 `modtree_`）。

## 1. 静默红线（零打扰）
- **仅当满足以下任一条件时**，才允许调用 `modtree_*` 工具：
  1. 当前会话上下文中已出现 `[modtree: bound ...]` 标记；或
  2. 用户在当前对话中明确提及「模块树」「modtree」「建模块」「拆子模块」「绑定模块」「记录进度」等意图。
- 对于未绑定任何模块的普通闲聊、问答或临时排错会话，**保持完全静默，零工具调用，绝不主动询问是否建模块**。

## 2. 已绑定会话的轮末自动回写与自绑定开场
- 若用户在新会话首条消息粘贴了 `modtree` 开场指令（要求调用 `modtree_bind_session`），请先传入 `<user_information>` 中的当前 `conversationId` 完成自绑定，并严格按照工具返回的完整 4 层上下文、阶段门禁与推荐技能开展工作。
- 当当前会话已绑定模块且完成了实质讨论、编码或审查时，在回复结束前自动调用 `modtree_update_progress`（传入 `conversationId` 可避免自身重复收到同步提示）：
  - 必传 `workspacePath`（当前工作区根目录绝对路径）与 `moduleId`（或 `conversationId`）；
  - `stop`（停在）与 `next`（下一步）保持精炼（各 ≤ 80 字）；
  - `linkedFiles` **仅填本模块实际新增或修改的相对路径**，不要把只读参考的公共底座文件混进去；
  - **禁止自动将 `status` 设为 `已完成`**（最高推进到 `待检查`，由用户人工确认完成）。

## 3. 结构改动与阶段切换必须先确认
- 调用 `modtree_create_module`（中文模块名请顺手传简短英文 `slug`，如 `app-shell`、`filter-list`，确保分支名清晰）、`modtree_update_module`（调整父子结构）、`modtree_archive_module` 或 `modtree_set_stage`（尤其是从只读阶段 `Plan` / `Review` 切入 `Code`）之前，必须已有用户明确指令，或先提出建议经用户同意后再执行。
- 绝不在未经允许的情况下自行调用 `modtree_set_stage` 解锁代码写入权限。

## 4. 三阶段与跨节点纪律
- **Plan**：聚焦目标、边界、接口契约与验收要点，沉淀进 `design`（保持薄摘要 ≤ 500 字，长篇细节落在聊天或项目文档中并把路径记入 `design`；公共接口契约上提到共同父节点的 `design`）；不改源码。**只要 `Plan` 调整了方案或需求，轮末必须调用 `modtree_update_module`（可传 `conversationId`）更新 `design` 触发 `rev+1`**，确保其他 `Code`/`Review` 会话下一轮自动通过 `PreInvocation` 同步最新方案。若在后台非交互会话中调用 `ask_question` 被宿主立即返回 `user cancelled ask_question`，请勿中断访谈，改为纯文本编号选项（1/2/3，首项标 `(推荐)`）继续逐题访谈。
- **Code**：动手前以磁盘最新文件为准，不凭历史聊天臆断代码现状；如绑定了 Worktree，严格在指定 `.worktrees/<slug>/` 内读写和运行命令。多阶段独立会话模式下，本会话门禁按自身 `Code` 阶段判定，查看 `Plan`/`Review` 不会打断编码。日常小改动与迭代可直接在本会话跑测试或调用只读子代理（如 `code-reviewer`）自查自修，不必频繁来回切换 `Review`。不要把一次性修 bug 或小改动建成子模块。
- **Review（合并/收口前独立终审）**：只读终审，不直接改源码；发现阻塞问题时将具体问题清单覆盖写入 `reviewNotes`（传 `conversationId`）并提示用户切回 `Code` 修复；审查通过时传 `clearReviewNotes: true` 并提示用户确认合并或标为已完成。
- **跨节点中转**：绝不向其他模块的会话发消息；需要了解其他模块资料时按需调用 `modtree_get_module` / `modtree_get_tree`。

## 5. 内置工程技能按阶段路由（渐进披露，按需读取）
本插件内置 19 个精选工程技能（源自 MIT 协议的 ECC，详见 `THIRD_PARTY_NOTICES.md`）。仅在命中对应触发场景时读取 `SKILL.md`，不要一次性全量加载：
- **Plan**：`search-first`（动手前先调研）、`hexagonal-architecture`（业务核与适配器解耦）、`api-design`、`database-migrations`、`error-handling`。
- **Code**：`tdd-workflow`、`coding-standards`、`orch-refine-code`（行为不变的结构重构）、`backend-patterns`、`frontend-patterns`、`e2e-testing`、`git-workflow`、`verification-loop`（**软引导**：里程碑收尾准备将模块推到 `待检查` 前，建议跑完 6 步验证闭环再回写进度）。
- **Review**：`security-review`、`verification-loop`、`coding-standards`、`api-design`、`error-handling`。
- **主控 / 跨阶段通用**：
  - `deployment-patterns`：合流上线、Docker 构建、停写备份与回滚核验时使用；
  - `agent-introspection-debugging`：同一报错/测试反复失败卡循环时，先做可复现诊断再动手；
  - `strategic-compact`：长会话完成一个阶段节点时，先回写状态/文档，再建议用户 `/compact` 或从侧栏开启新阶段会话。
- **C++ / ESP32 固件按需**：仅在 C++ / 嵌入式固件仓库或模块中按需使用 `cpp-coding-standards`、`cpp-testing`。
