import { useState } from 'react';
import type { ModuleNode } from '../../core/types.js';

interface MergeDialogProps {
  mode: 'merge' | 'cleanup';
  node: ModuleNode;
  hasReviewed: boolean;
  onCancel: () => void;
  onConfirmMerge: (strategy: 'squash' | 'no-ff', commitMessage: string) => Promise<void>;
  onConfirmCleanup: () => Promise<void>;
  onStartIndependentReview: () => Promise<void>;
}

export function MergeDialog({
  mode,
  node,
  hasReviewed,
  onCancel,
  onConfirmMerge,
  onConfirmCleanup,
  onStartIndependentReview,
}: MergeDialogProps) {
  const [strategy, setStrategy] = useState<'squash' | 'no-ff'>('squash');
  const [commitMessage, setCommitMessage] = useState(`feat(${node.id}): ${node.name}`);
  const [busy, setBusy] = useState(false);

  if (mode === 'cleanup') {
    return (
      <div className="mt-modal-backdrop" role="dialog" aria-modal="true">
        <div className="mt-modal">
          <h2>二次确认：清理 Worktree 与分支</h2>
          <div className="mt-muted">
            将移除目录 <code>{node.git?.worktreePath}</code> 并删除本地分支{' '}
            <code>{node.git?.branch}</code>。
          </div>
          <div className="mt-muted">
            模块节点「{node.name}」、历史会话与已合并 commit（
            <code>{node.git?.mergedCommit?.slice(0, 7) || '未合并'}</code>）将永久保留在模块树中。
          </div>
          <div className="mt-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" disabled={busy} onClick={onCancel}>
              取消
            </button>
            <button
              type="button"
              className="mt-danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirmCleanup();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '清理中…' : '确认清理 Worktree'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-modal-backdrop" role="dialog" aria-modal="true">
      <div className="mt-modal">
        <h2>合并回主干（{node.git?.baseBranch || 'main'}）</h2>
        <div className="mt-muted">
          将分支 <code>{node.git?.branch}</code> 合并到 <code>{node.git?.baseBranch || 'main'}</code>
          。若遇冲突会自动中止回滚，绝不强行覆盖。
        </div>

        {!hasReviewed && (
          <div className="mt-banner warn" style={{ marginBottom: 0 }}>
            <div>提示：该模块尚未做独立 Review，可直接确认合并，或先开一次独立审查会话把关。</div>
            <div className="mt-row">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onStartIndependentReview();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? '创建中…' : '先开独立审查会话'}
              </button>
            </div>
          </div>
        )}

        <div className="mt-field">
          <div className="mt-label">合并方式</div>
          <div className="mt-row" style={{ marginTop: 4 }}>
            <button
              type="button"
              className={strategy === 'squash' ? 'mt-primary' : ''}
              onClick={() => setStrategy('squash')}
            >
              Squash（默认，1 模块 1 提交）
            </button>
            <button
              type="button"
              className={strategy === 'no-ff' ? 'mt-primary' : ''}
              onClick={() => setStrategy('no-ff')}
            >
              普通 Merge (--no-ff)
            </button>
          </div>
        </div>

        <div className="mt-field">
          <div className="mt-label">提交信息</div>
          <input
            className="mt-input"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="mt-row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="mt-primary"
            disabled={busy || !commitMessage.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirmMerge(strategy, commitMessage.trim());
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '合并中…' : '确认合并'}
          </button>
        </div>
      </div>
    </div>
  );
}
