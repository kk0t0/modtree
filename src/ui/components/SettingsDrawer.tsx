import { useState } from 'react';
import type { ProjectGitConfig } from '../../core/types.js';

interface SettingsDrawerProps {
  config: ProjectGitConfig;
  workspacePath: string;
  onSave: (next: ProjectGitConfig) => Promise<void>;
  onClose: () => void;
}

export function SettingsDrawer({
  config,
  workspacePath,
  onSave,
  onClose,
}: SettingsDrawerProps) {
  const [branchPrefix, setBranchPrefix] = useState(config.branchPrefix || 'mod/');
  const [worktreeDir, setWorktreeDir] = useState(config.worktreeDir || '.worktrees');
  const [envText, setEnvText] = useState((config.copyEnvFiles || []).join(', '));
  const [initCommand, setInitCommand] = useState(config.initCommand || '');
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setBusy(true);
    try {
      const copyEnvFiles = envText
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      await onSave({
        branchPrefix: branchPrefix.trim() || 'mod/',
        worktreeDir: worktreeDir.trim() || '.worktrees',
        copyEnvFiles,
        initCommand: initCommand.trim(),
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-card" aria-label="项目 Git/Worktree 设置">
      <div className="mt-card-head">
        <span className="mt-card-title">项目 Git / Worktree 设置</span>
        <button type="button" className="mt-ghost" onClick={onClose}>
          收起
        </button>
      </div>
      <div className="mt-muted" style={{ marginBottom: 8, wordBreak: 'break-all' }}>
        工作区：<code>{workspacePath}</code>（配置存于插件数据目录，不污染 git；也可在仓库放 <code>.modtree.json</code> 作为默认值）
      </div>

      <div className="mt-field">
        <div className="mt-label">分支前缀</div>
        <input
          className="mt-input"
          value={branchPrefix}
          onChange={(e) => setBranchPrefix(e.target.value)}
          placeholder="mod/"
        />
      </div>

      <div className="mt-field">
        <div className="mt-label">Worktree 目录（自动写入 .git/info/exclude）</div>
        <input
          className="mt-input"
          value={worktreeDir}
          onChange={(e) => setWorktreeDir(e.target.value)}
          placeholder=".worktrees"
        />
      </div>

      <div className="mt-field">
        <div className="mt-label">建 Worktree 时拷贝的 .env 文件（逗号分隔，可选）</div>
        <input
          className="mt-input"
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
          placeholder=".env, .env.local"
        />
      </div>

      <div className="mt-field">
        <div className="mt-label">建 Worktree 后的初始化命令（可选）</div>
        <input
          className="mt-input"
          value={initCommand}
          onChange={(e) => setInitCommand(e.target.value)}
          placeholder="例如 pnpm install --frozen-lockfile（留空跳过）"
        />
      </div>

      <div className="mt-row">
        <button type="button" className="mt-primary" disabled={busy} onClick={() => void handleSave()}>
          {busy ? '保存中…' : '保存设置'}
        </button>
      </div>
    </section>
  );
}
