import { useState } from 'react';
import type { EnrichedModuleView, ModuleNode } from '../../core/types.js';

interface ModuleTreeProps {
  modules: Record<string, ModuleNode>;
  enriched: Record<string, EnrichedModuleView>;
  selectedId?: string;
  expandedIds: Record<string, boolean>;
  hostConvId: string;
  onSelect: (moduleId: string) => void;
  onOpenSession: (moduleId: string) => void;
  onToggleExpand: (moduleId: string, nextExpanded: boolean) => void;
  onCreate: (parentId: string | null, name: string, design: string, openSession: boolean) => Promise<void>;
}

interface InlineFormState {
  parentId: string | null;
  parentName?: string;
}

export function ModuleTree({
  modules,
  enriched,
  selectedId,
  expandedIds,
  hostConvId,
  onSelect,
  onOpenSession,
  onToggleExpand,
  onCreate,
}: ModuleTreeProps) {
  const [creating, setCreating] = useState<InlineFormState | null>(null);
  const [name, setName] = useState('');
  const [design, setDesign] = useState('');
  const [busy, setBusy] = useState(false);

  const visibleModules = Object.values(modules).filter((m) => !m.archived);

  function childrenOf(parentId: string | null): ModuleNode[] {
    return visibleModules
      .filter((m) => m.parentId === parentId)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  async function submitCreate(openSession: boolean) {
    if (!name.trim() || !creating) return;
    setBusy(true);
    try {
      await onCreate(creating.parentId, name.trim(), design.trim(), openSession);
      setCreating(null);
      setName('');
      setDesign('');
    } finally {
      setBusy(false);
    }
  }

  function renderNode(node: ModuleNode) {
    const kids = childrenOf(node.id);
    const hasKids = kids.length > 0;
    const isExpanded = expandedIds[node.id] !== false;
    const view = enriched[node.id];
    const isSelected = node.id === selectedId;
    const obsState = view?.observation.state || 'idle';
    const dotClass =
      obsState === 'running'
        ? 'running'
        : obsState === 'new_reply'
          ? 'new_reply'
          : obsState === 'error'
            ? 'error'
            : 'idle';
    const dotTitle =
      obsState === 'running'
        ? '后台会话运行中'
        : obsState === 'new_reply'
          ? '刚产出新回复'
          : obsState === 'error'
            ? '最后一步异常'
            : '空闲';

    const stageSessionId = view?.stageSessionMap[node.stage]?.conversationId || '';
    const isHere = Boolean(hostConvId && stageSessionId && stageSessionId === hostConvId);
    const effGit = view?.effectiveGit;
    const childProg = view?.childProgress;

    return (
      <div key={node.id}>
        <div className={`mt-node-row${isSelected ? ' selected' : ''}`}>
          <button
            type="button"
            className="mt-expand-btn"
            aria-label={hasKids ? (isExpanded ? '折叠' : '展开') : '无子节点'}
            onClick={() => hasKids && onToggleExpand(node.id, !isExpanded)}
            style={{ visibility: hasKids ? 'visible' : 'hidden' }}
          >
            {isExpanded ? '▾' : '▸'}
          </button>

          <button
            type="button"
            className="mt-node-main"
            onClick={() => onSelect(node.id)}
            title="单击查看详情（不切换当前聊天）"
          >
            <span className="mt-node-name-line">
              <span className={`mt-dot ${dotClass}`} title={dotTitle} />
              <span className="mt-node-name">{node.name}</span>
              {childProg && childProg.total > 0 && (
                <span className="mt-pill" title="已完成子模块 / 总子模块">
                  {childProg.done}/{childProg.total}
                </span>
              )}
              {node.reviewNotes && (
                <span className="mt-pill warn" title="有待处理的 Review 返工清单">
                  返工
                </span>
              )}
            </span>
            <span className="mt-node-meta">
              <span>{node.stage}</span>
              <span>· {node.status}</span>
              {effGit?.mode === 'worktree' && (
                <span className="mt-pill wt" title={effGit.inheritedFromName ? `继承自 ${effGit.inheritedFromName}` : effGit.branch}>
                  {effGit.inheritedFromName ? 'WT↑' : 'WT'}
                </span>
              )}
              {isHere && <span className="mt-pill ok">当前</span>}
            </span>
          </button>

          {stageSessionId && !isHere && (
            <button
              type="button"
              className="mt-node-add-btn"
              title={`切换到「${node.name}」的绑定会话`}
              onClick={(e) => {
                e.stopPropagation();
                onOpenSession(node.id);
              }}
            >
              ↗
            </button>
          )}

          <button
            type="button"
            className="mt-node-add-btn"
            title={`在「${node.name}」下新建子模块`}
            onClick={(e) => {
              e.stopPropagation();
              setCreating({ parentId: node.id, parentName: node.name });
              setName('');
              setDesign('');
            }}
          >
            ＋子
          </button>
        </div>

        {creating && creating.parentId === node.id && renderCreateForm()}

        {hasKids && isExpanded && (
          <div className="mt-tree-children">{kids.map((child) => renderNode(child))}</div>
        )}
      </div>
    );
  }

  function renderCreateForm() {
    if (!creating) return null;
    return (
      <div className="mt-inline-create">
        <div className="mt-label">
          {creating.parentName ? `在「${creating.parentName}」下新建子模块` : '新建顶层模块'}
        </div>
        <input
          className="mt-input"
          placeholder="模块名称（必填）"
          value={name}
          autoFocus
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submitCreate(false);
            } else if (e.key === 'Escape') {
              setCreating(null);
            }
          }}
        />
        <input
          className="mt-input"
          placeholder="一句话设计要点（可选）"
          value={design}
          disabled={busy}
          onChange={(e) => setDesign(e.target.value)}
        />
        <div className="mt-row">
          <button
            type="button"
            className="mt-primary"
            disabled={busy || !name.trim()}
            onClick={() => void submitCreate(false)}
          >
            {busy ? '处理中…' : '仅记入树（推荐）'}
          </button>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void submitCreate(true)}
            title="后台新建非交互会话（不支持 /grill-me 与终端弹窗审批）"
          >
            创建并后台开会话
          </button>
          <button
            type="button"
            className="mt-ghost"
            disabled={busy}
            onClick={() => setCreating(null)}
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  const roots = childrenOf(null);

  return (
    <section className="mt-card" aria-label="模块树">
      <div className="mt-card-head">
        <span className="mt-card-title">模块树</span>
        <button
          type="button"
          className="mt-ghost"
          onClick={() => {
            setCreating({ parentId: null });
            setName('');
            setDesign('');
          }}
        >
          ＋新模块
        </button>
      </div>

      {creating && creating.parentId === null && renderCreateForm()}

      {roots.length === 0 ? (
        <div className="mt-empty">
          当前项目还没有模块。点右上角 <b>＋新模块</b>，或直接在聊天里让 Agent 帮你建树。
        </div>
      ) : (
        <div className="mt-tree">{roots.map((r) => renderNode(r))}</div>
      )}
    </section>
  );
}
