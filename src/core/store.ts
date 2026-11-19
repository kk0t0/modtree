import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_GIT_CONFIG,
  ProjectGitConfig,
  ProjectState,
  SessionIndex,
} from './types.js';

export function resolveAppDataDir(): string {
  if (process.env.ANTIGRAVITY_APP_DATA_DIR && existsSync(process.env.ANTIGRAVITY_APP_DATA_DIR)) {
    return process.env.ANTIGRAVITY_APP_DATA_DIR;
  }
  if (process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR) {
    const candidate = dirname(process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR);
    if (existsSync(join(candidate, 'brain'))) return candidate;
  }
  return join(homedir(), '.gemini', 'antigravity');
}

export function resolvePluginDataDir(): string {
  if (process.env.MODTREE_DATA_DIR) return process.env.MODTREE_DATA_DIR;
  if (process.env.PLUGIN_DATA) return process.env.PLUGIN_DATA;
  return join(resolveAppDataDir(), 'plugin_data', 'modtree');
}

/**
 * Normalizes file:// URIs or OS paths into a canonical absolute path so Sidecar,
 * MCP, and Hooks always resolve to the exact same project hash on Windows and POSIX.
 */
export function normalizeWorkspacePath(input: string): string {
  let raw = (input || '').trim();
  if (!raw) return '';
  if (/^file:\/\//i.test(raw)) {
    try {
      raw = fileURLToPath(raw);
    } catch {
      raw = decodeURIComponent(raw.replace(/^file:\/\/\//i, ''));
    }
  }
  let resolved = normalize(resolve(raw));
  resolved = resolved.replace(/[\\/]+$/, '');
  if (/^[A-Za-z]:$/.test(resolved)) {
    resolved += '\\';
  }
  if (process.platform === 'win32') {
    // Canonicalize drive letter to uppercase for display/path consistency,
    // while hashWorkspacePath lowercases on win32.
    resolved = resolved.replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`);
  }
  return resolved;
}

export function hashWorkspacePath(workspacePath: string): string {
  const norm = normalizeWorkspacePath(workspacePath);
  const key = process.platform === 'win32'
    ? norm.replace(/\\/g, '/').toLowerCase()
    : norm;
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function projectFilePath(workspacePath: string, dataDir = resolvePluginDataDir()): string {
  return join(dataDir, 'projects', `${hashWorkspacePath(workspacePath)}.json`);
}

export function sessionIndexPath(dataDir = resolvePluginDataDir()): string {
  return join(dataDir, 'session-index.json');
}

function readRepoDefaultGitConfig(workspacePath: string): Partial<ProjectGitConfig> {
  if (!workspacePath) return {};
  const cfgPath = join(workspacePath, '.modtree.json');
  if (!existsSync(cfgPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
    const git = (parsed.git && typeof parsed.git === 'object' ? parsed.git : parsed) as Record<string, unknown>;
    const out: Partial<ProjectGitConfig> = {};
    if (typeof git.branchPrefix === 'string' && git.branchPrefix.trim()) {
      out.branchPrefix = git.branchPrefix.trim();
    }
    if (typeof git.worktreeDir === 'string' && git.worktreeDir.trim()) {
      out.worktreeDir = git.worktreeDir.trim();
    }
    if (Array.isArray(git.copyEnvFiles)) {
      out.copyEnvFiles = git.copyEnvFiles.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    }
    if (typeof git.initCommand === 'string') {
      out.initCommand = git.initCommand.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function createEmptyProject(workspacePath: string): ProjectState {
  const norm = normalizeWorkspacePath(workspacePath);
  const defaults = readRepoDefaultGitConfig(norm);
  return {
    version: 1,
    workspacePath: norm,
    projectName: norm ? basename(norm) || norm : '未命名项目',
    expandedIds: {},
    gitConfig: {
      ...DEFAULT_GIT_CONFIG,
      ...defaults,
    },
    modules: {},
  };
}

function atomicWriteJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, filePath);
}

const LOCK_STALE_MS = 10_000;
const LOCK_TIMEOUT_MS = 3_000;

function sleepSync(ms: number): void {
  const arr = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(arr, 0, 0, ms);
}

export function withFileLock<T>(targetPath: string, fn: () => T): T {
  mkdirSync(dirname(targetPath), { recursive: true });
  const lockPath = `${targetPath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd: number | null = null;

  while (fd === null) {
    try {
      fd = openSync(lockPath, 'wx');
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') throw err;
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for lock: ${lockPath}`);
      }
      sleepSync(15);
    }
  }

  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      // ignore
    }
    try {
      unlinkSync(lockPath);
    } catch {
      // ignore
    }
  }
}

export function loadProject(workspacePath: string, dataDir = resolvePluginDataDir()): ProjectState {
  const norm = normalizeWorkspacePath(workspacePath);
  const filePath = projectFilePath(norm, dataDir);
  if (!existsSync(filePath)) {
    return createEmptyProject(norm);
  }
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as ProjectState;
  const repoDefaults = readRepoDefaultGitConfig(norm);
  return {
    ...createEmptyProject(norm),
    ...raw,
    workspacePath: norm,
    projectName: raw.projectName || basename(norm) || norm,
    gitConfig: {
      ...DEFAULT_GIT_CONFIG,
      ...repoDefaults,
      ...(raw.gitConfig || {}),
    },
    modules: raw.modules || {},
  };
}

export function readSessionIndex(dataDir = resolvePluginDataDir()): SessionIndex {
  const idxPath = sessionIndexPath(dataDir);
  if (!existsSync(idxPath)) return {};
  try {
    return JSON.parse(readFileSync(idxPath, 'utf-8')) as SessionIndex;
  } catch {
    return {};
  }
}

function updateSessionIndexForProject(project: ProjectState, dataDir: string): void {
  const idxPath = sessionIndexPath(dataDir);
  const projHash = hashWorkspacePath(project.workspacePath);
  withFileLock(idxPath, () => {
    const idx = readSessionIndex(dataDir);
    // Clear previous entries owned by this project
    for (const [convId, entry] of Object.entries(idx)) {
      if (entry.projectHash === projHash) {
        delete idx[convId];
      }
    }
    // Re-index all active and stage-bound sessions in non-archived modules
    for (const mod of Object.values(project.modules)) {
      const convIds = new Set<string>();
      if (mod.activeSessionId) convIds.add(mod.activeSessionId);
      if (mod.stageSessions) {
        for (const cid of Object.values(mod.stageSessions)) {
          if (cid) convIds.add(cid);
        }
      }
      if (mod.sessions) {
        for (const rec of mod.sessions) {
          if (rec.conversationId && !rec.archived) convIds.add(rec.conversationId);
        }
      }
      for (const cid of convIds) {
        idx[cid] = {
          projectHash: projHash,
          workspacePath: project.workspacePath,
          moduleId: mod.id,
        };
      }
    }
    atomicWriteJson(idxPath, idx);
  });
}

export function saveProject(project: ProjectState, dataDir = resolvePluginDataDir()): ProjectState {
  const norm = normalizeWorkspacePath(project.workspacePath);
  const toSave: ProjectState = {
    ...project,
    version: 1,
    workspacePath: norm,
    projectName: project.projectName || basename(norm) || norm,
  };
  const filePath = projectFilePath(norm, dataDir);
  atomicWriteJson(filePath, toSave);
  updateSessionIndexForProject(toSave, dataDir);
  return toSave;
}

export function mutateProject<T>(
  workspacePath: string,
  mutator: (project: ProjectState) => T,
  dataDir = resolvePluginDataDir(),
): { project: ProjectState; result: T } {
  const norm = normalizeWorkspacePath(workspacePath);
  const filePath = projectFilePath(norm, dataDir);
  return withFileLock(filePath, () => {
    const project = loadProject(norm, dataDir);
    const result = mutator(project);
    const saved = saveProject(project, dataDir);
    return { project: saved, result };
  });
}

export function lookupSessionBinding(
  conversationId: string,
  dataDir = resolvePluginDataDir(),
): { project: ProjectState; moduleId: string } | null {
  if (!conversationId) return null;
  const idx = readSessionIndex(dataDir);
  const entry = idx[conversationId];
  if (!entry) return null;
  const project = loadProject(entry.workspacePath, dataDir);
  if (!project.modules[entry.moduleId]) return null;
  return { project, moduleId: entry.moduleId };
}
