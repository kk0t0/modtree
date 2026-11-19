export type ModuleStatus = '待设计' | '开发中' | '待检查' | '已完成';
export type ModuleStage = 'Plan' | 'Code' | 'Review';

export const MODULE_STATUSES: readonly ModuleStatus[] = [
  '待设计',
  '开发中',
  '待检查',
  '已完成',
];

export const MODULE_STAGES: readonly ModuleStage[] = ['Plan', 'Code', 'Review'];

export interface ProjectGitConfig {
  branchPrefix: string;
  worktreeDir: string;
  copyEnvFiles: string[];
  initCommand: string;
}

export const DEFAULT_GIT_CONFIG: ProjectGitConfig = {
  branchPrefix: 'mod/',
  worktreeDir: '.worktrees',
  copyEnvFiles: [],
  initCommand: '',
};

export interface SessionRecord {
  conversationId: string;
  title: string;
  stage: ModuleStage;
  createdAt: string;
  syncedRev: number;
  syncedAncestorHash: string;
  syncedStage?: ModuleStage;
  syncedReviewNotesHash?: string;
  archived?: boolean;
}

export interface ModuleGitState {
  mode: 'main' | 'worktree';
  inheritFromParent: boolean;
  branch?: string;
  worktreePath?: string;
  baseBranch?: string;
  baseCommit?: string;
  mergedCommit?: string;
  mergedAt?: string;
}

export interface ModuleNode {
  id: string;
  parentId: string | null;
  order: number;
  name: string;
  status: ModuleStatus;
  stage: ModuleStage;
  design?: string;
  stop?: string;
  next?: string;
  reviewNotes?: string;
  linkedFiles?: string[];
  dependsOn?: string[];
  rev: number;
  activeSessionId?: string;
  stageSessions?: Partial<Record<ModuleStage, string>>;
  sessions?: SessionRecord[];
  git?: ModuleGitState;
  archived?: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface ProjectState {
  version: 1;
  workspacePath: string;
  projectName: string;
  selectedModuleId?: string;
  expandedIds?: Record<string, boolean>;
  gitConfig: ProjectGitConfig;
  modules: Record<string, ModuleNode>;
}

export interface SessionIndexEntry {
  projectHash: string;
  workspacePath: string;
  moduleId: string;
}

export type SessionIndex = Record<string, SessionIndexEntry>;

export interface EffectiveGitInfo {
  mode: 'main' | 'worktree';
  inheritedFromId?: string;
  inheritedFromName?: string;
  branch?: string;
  worktreePath?: string;
  workingDir: string;
  baseBranch?: string;
  baseCommit?: string;
  mergedCommit?: string;
}

export interface TranscriptObservation {
  available: boolean;
  state: 'unbound' | 'no_transcript' | 'running' | 'new_reply' | 'idle' | 'error' | 'read_error';
  stepCount: number;
  latestReply: string;
  latestReplyAt: string;
  mtimeMs?: number;
}

export interface RepoGitOverview {
  isGitRepo: boolean;
  currentBranch: string;
  headCommit: string;
  dirtyCount: number;
  dirtyFiles: string[];
  error?: string;
}

export interface ModuleGitRuntime {
  effective: EffectiveGitInfo;
  behindBase: number;
  aheadBase: number;
  worktreeDirtyCount: number;
  worktreeExists: boolean;
  mergeBase?: string;
}

export interface DriftSummary {
  outdated: boolean;
  reasons: string[];
}

export interface ChildProgressSummary {
  done: number;
  total: number;
}

export interface EnrichedModuleView {
  node: ModuleNode;
  effectiveGit: EffectiveGitInfo;
  gitRuntime?: ModuleGitRuntime;
  observation: TranscriptObservation;
  drift: DriftSummary;
  childProgress: ChildProgressSummary;
  stageSessionMap: Record<ModuleStage, { conversationId: string; dedicated: boolean }>;
}

export interface SidecarSnapshot {
  uiVersion: string;
  projectHash: string;
  project: ProjectState;
  repoGit: RepoGitOverview;
  enriched: Record<string, EnrichedModuleView>;
  activeCodeModulesOnMain: string[];
}
