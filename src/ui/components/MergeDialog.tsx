import { useState } from 'react';
import type { ModuleNode, RepoGitOverview } from '../../core/types.js';

interface MergeDialogProps {
  mode: 'merge' | 'cleanup' | 'dirty-wt';
  node: ModuleNode;
  repoGit?: RepoGitOverview;
  hasReviewed: boolean;
  onCancel: () => void;
  onConfirmMerge: (strategy: 'squash' | 'no-ff', commitMessage: string) => Promise<void>;
  onConfirmCleanup: () => Promise<void>;
  onConfirmCreateWorktree?: () => Promise<void>;
  onStartIndependentReview: () => Promise<void>;
}

export function MergeDialog({
  mode,
  node,
  repoGit,
  hasReviewed,
  onCancel,
  onConfirmMerge,
  onConfirmCleanup,
  onConfirmCreateWorktree,
  onStartIndependentReview,
}: MergeDialogProps) {
  const [strategy, setStrategy] = useState<'squash' | 'no-ff'>('squash');
  const [commitMessage, setCommitMessage] = useState(`feat(${node.id}): ${node.name}`);
  const [busy, setBusy] = useState(false);

  if (mode === 'dirty-wt') {
    const previewFiles = (repoGit?.dirtyFiles || []).slice(0, 5);
    return (
      <div className="mt-modal-backdrop" role="dialog" aria-modal="true">
        <div className="mt-modal">
          <h2>⚠️ 主目录有未提交改动</h2>
          <div className="mt-banner warn" style={{ marginBottom: 0 }}>
            <div>
              主目录当前有 <strong>{repoGit?.dirtyCount || 0} 个未提交文件</strong>
              {previewFiles.length > 0 && (
                <>
                  （如 <code>{previewFiles.join(', ')}</code>
                  {(repoGit?.dirtyCount || 0) > previewFiles.length ? ' 等' : ''}）
                </>
              )}
              。
            </div>
            <div>
              此时从 <code>HEAD</code> 切出的新 Worktree <strong>不会包含这些未提交文件</strong>
              ，容易造成文件缺失或后续合并冲突。强烈建议先在主目录提交，再建 Worktree。
            </div>
          </div>
          <div className="mt-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="mt-primary" disabled={busy} onClick={onCancel}>
              取消，先去提交主目录
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!onConfirmCreateWorktree) return;
                setBusy(true);
                try {
                  await onConfirmCreateWorktree();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '创建中…' : '仍从当前 HEAD 创建'}
            </button>
          </div>
        </div>
      </div>
    );
  }

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
