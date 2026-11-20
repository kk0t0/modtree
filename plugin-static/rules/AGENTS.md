# modtree（模块树）协作规则

本规则仅适用于 Antigravity `modtree` 插件（MCP 工具前缀 `modtree_`）。

## 1. 静默红线（零打扰）
- **仅当满足以下任一条件时**，才允许调用 `modtree_*` 工具：
  1. 当前会话上下文中已出现 `[modtree: bound ...]` 标记；或
  2. 用户在当前对话中明确提及「模块树」「modtree」「建模块」「拆子模块」「绑定模块」「记录进度」等意图。
- 对于未绑定任何模块的普通闲聊、问答或临时排错会话，**保持完全静默，零工具调用，绝不主动询问是否建模块**。

## 2. 已绑定会话的轮末自动回写
- 当当前会话已绑定模块且完成了实质讨论、编码或审查时，在回复结束前自动调用 `modtree_update_progress`：
  - 必传 `workspacePath`（当前工作区根目录绝对路径）与 `moduleId`（或 `conversationId`）；
  - `stop`（停在）与 `next`（下一步）保持精炼（各 ≤ 80 字）；
  - 附上本次实际修改或审阅的相对文件路径 `linkedFiles`；
  - **禁止自动将 `status` 设为 `已完成`**（最高推进到 `待检查`，由用户人工确认完成）。

## 3. 结构改动与阶段切换必须先确认
- 调用 `modtree_create_module`、`modtree_update_module`（调整父子结构）、`modtree_archive_module` 或 `modtree_set_stage`（尤其是从只读阶段 `Plan` / `Review` 切入 `Code`）之前，必须已有用户明确指令，或先提出建议经用户同意后再执行。
- 绝不在未经允许的情况下自行调用 `modtree_set_stage` 解锁代码写入权限。

## 4. 三阶段与跨节点纪律
- **Plan**：聚焦目标、边界、接口契约与验收要点，沉淀进 `design`（公共接口契约上提到共同父节点的 `design`）；不改源码。
- **Code**：动手前以磁盘最新文件为准，不凭历史聊天臆断代码现状；如绑定了 Worktree，严格在指定 `.worktrees/<slug>/` 内读写和运行命令。日常小改动与迭代可直接在本会话跑测试或调用只读子代理（如 `code-reviewer`）自查自修，不必频繁来回切换 `Review`。不要把一次性修 bug 或小改动建成子模块。
- **Review（合并/收口前独立终审）**：只读终审，不直接改源码；发现阻塞问题时将具体问题清单覆盖写入 `reviewNotes` 并提示用户切回 `Code` 修复；审查通过时传 `clearReviewNotes: true` 并提示用户确认合并或标为已完成。
- **跨节点中转**：绝不向其他模块的会话发消息；需要了解其他模块资料时按需调用 `modtree_get_module` / `modtree_get_tree`。
