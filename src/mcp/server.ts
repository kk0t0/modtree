import { createInterface } from 'node:readline';
import {
  computeAncestorAndDepHash,
  computeReviewNotesHash,
} from '../core/context.js';
import {
  loadProject,
  lookupSessionBinding,
  mutateProject,
  resolvePluginDataDir,
} from '../core/store.js';
import {
  archiveModule,
  bindSessionToModule,
  computeChildProgress,
  createModule,
  getAncestors,
  getModulePathString,
  MAX_MCP_DESIGN_LEN,
  MAX_PROGRESS_LEN,
  resolveEffectiveGit,
  setModuleStage,
  updateModule,
  updateModuleProgress,
} from '../core/tree.js';
import { MODULE_STAGES, MODULE_STATUSES, ModuleStage, ModuleStatus } from '../core/types.js';

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export const MCP_TOOLS = [
  {
    name: 'modtree_get_tree',
    description:
      'Read the module tree and child progress summary for a workspace. Always pass workspacePath to isolate multi-project data.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: { type: 'string', description: 'Absolute path of the active workspace folder.' },
        includeArchived: { type: 'boolean', description: 'Whether to include archived modules.' },
      },
      required: ['workspacePath'],
      additionalProperties: false,
    },
  },
  {
    name: 'modtree_get_module',
    description:
      'Read detailed info for a module (ancestor constraints, dependsOn summaries, linkedFiles, git/worktree info, sessions). Lookup by moduleId or conversationId.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: { type: 'string', description: 'Absolute path of the active workspace folder.' },
        moduleId: { type: 'string', description: 'Target module ID.' },
        conversationId: { type: 'string', description: 'Optional conversation ID to resolve bound module.' },
      },
      required: ['workspacePath'],
      additionalProperties: false,
    },
  },
  {
    name: 'modtree_update_progress',
    description:
      `Update concise progress (stop/next <= ${MAX_PROGRESS_LEN} chars, status, linkedFiles, reviewNotes/clearReviewNotes). Does NOT change stage (use modtree_set_stage only when user explicitly asks). Cannot auto-set status to 已完成.`,
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: { type: 'string', description: 'Absolute path of the active workspace folder.' },
        moduleId: { type: 'string', description: 'Target module ID (optional if conversationId is bound).' },
        conversationId: { type: 'string', description: 'Optional bound conversation ID.' },
        stop: { type: 'string', description: `Where work stopped (<= ${MAX_PROGRESS_LEN} chars).` },
        next: { type: 'string', description: `Recommended next step (<= ${MAX_PROGRESS_LEN} chars).` },
        status: {
          type: 'string',
          enum: ['待设计', '开发中', '待检查'],
          description: 'Module status (Agent can set up to 待检查; 已完成 requires human confirmation).',
        },
        linkedFiles: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Relative file paths CREATED or MODIFIED by this module ONLY (do NOT include read-only reference files from other modules/base shell).',
        },
        reviewNotes: {
          type: 'string',
          description: 'Overwrite ephemeral Review issue checklist when sending work back to Code.',
        },
        clearReviewNotes: {
          type: 'boolean',
          description: 'Set true when Review passes to clear ephemeral reviewNotes.',
        },
      },
      required: ['workspacePath'],
      additionalProperties: false,
    },
  },
  {
    name: 'modtree_set_stage',
    description:
      'Switch module stage (Plan / Code / Review). ONLY call when the user explicitly requests a stage change (never self-unlock Code without user confirmation).',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: { type: 'string' },
        moduleId: { type: 'string' },
        stage: { type: 'string', enum: [...MODULE_STAGES] },
        reason: { type: 'string', description: 'Brief note of the user instruction requesting this stage switch.' },
      },
      required: ['workspacePath', 'moduleId', 'stage'],
      additionalProperties: false,
    },
  },
  {
    name: 'modtree_create_module',
    description:
      'Create a top-level or child module node. Only call after user request or confirmation. For non-ASCII names, provide a short kebab-case English slug for clean IDs and Git branch names.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: { type: 'string' },
        name: { type: 'string' },
        slug: {
          type: 'string',
          description: 'Optional short ASCII kebab-case slug (e.g. app-shell, filter-list, charts) for readable module ID and git branch names.',
        },
        parentId: { type: ['string', 'null'], description: 'Parent module ID or null for top-level.' },
        design: {
          type: 'string',
          description: `Concise Markdown design summary (<= ${MAX_MCP_DESIGN_LEN} chars): goal + public interface contracts + key acceptance points. Leave lengthy discussions in chat or repo docs.`,
        },
        dependsOn: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional cross-subtree dependency module IDs.',
        },
        stage: { type: 'string', enum: [...MODULE_STAGES] },
      },
      required: ['workspacePath', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'modtree_update_module',
    description:
      `Update module metadata (name, concise design <= ${MAX_MCP_DESIGN_LEN} chars, parentId with cycle protection, linkedFiles created/modified by this module, dependsOn). Automatically bumps rev.`,
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: { type: 'string' },
        moduleId: { type: 'string' },
        name: { type: 'string' },
        parentId: { type: ['string', 'null'] },
        design: {
          type: 'string',
          description: `Concise Markdown design summary (<= ${MAX_MCP_DESIGN_LEN} chars): goal + public contracts + key acceptance points.`,
        },
        linkedFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Relative file paths created or modified by this module only.',
        },
        dependsOn: { type: 'array', items: { type: 'string' } },
      },
      required: ['workspacePath', 'moduleId'],
      additionalProperties: false,
    },
  },
  {
    name: 'modtree_archive_module',
    description: 'Soft-archive a module (preserves history; warns if an unmerged worktree is still attached).',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: { type: 'string' },
        moduleId: { type: 'string' },
      },
      required: ['workspacePath', 'moduleId'],
      additionalProperties: false,
    },
  },
  {
    name: 'modtree_bind_session',
    description: 'Bind a conversationId to a module (optionally for a specific stage).',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: { type: 'string' },
        moduleId: { type: 'string' },
        conversationId: { type: 'string' },
        title: { type: 'string' },
        stage: { type: 'string', enum: [...MODULE_STAGES] },
        dedicatedForStage: { type: 'boolean' },
      },
      required: ['workspacePath', 'moduleId', 'conversationId'],
      additionalProperties: false,
    },
  },
];

function resolveModuleIdFromArgs(
  workspacePath: string,
  args: Record<string, unknown>,
  dataDir: string,
): string {
  if (typeof args.moduleId === 'string' && args.moduleId.trim()) {
    return args.moduleId.trim();
  }
  if (typeof args.conversationId === 'string' && args.conversationId.trim()) {
    const binding = lookupSessionBinding(args.conversationId.trim(), dataDir);
    if (binding) return binding.moduleId;
  }
  throw new Error('请提供 moduleId，或提供已绑定模块的 conversationId');
}

function okText(text: string) {
  return { content: [{ type: 'text', text }] };
}

function errText(text: string) {
  return { isError: true, content: [{ type: 'text', text }] };
}

export function handleMcpRequest(
  req: JsonRpcRequest,
  dataDir = resolvePluginDataDir(),
): JsonRpcResponse | null {
  const { id, method, params } = req;

  if (method === 'initialize') {
    const protocolVersion =
      typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05';
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      result: {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'modtree-mcp-server', version: '0.1.0' },
      },
    };
  }

  if (method === 'notifications/initialized' || id === undefined) {
    return null;
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } };
  }

  if (method === 'tools/call') {
    const toolName = String(params?.name || '');
    const args = (params?.arguments && typeof params.arguments === 'object'
      ? params.arguments
      : {}) as Record<string, unknown>;

    try {
      const workspacePath = typeof args.workspacePath === 'string' ? args.workspacePath.trim() : '';
      if (!workspacePath) {
        return { jsonrpc: '2.0', id, result: errText('缺少必填参数 workspacePath') };
      }

      if (toolName === 'modtree_get_tree') {
        const project = loadProject(workspacePath, dataDir);
        const includeArchived = Boolean(args.includeArchived);
        const nodes = Object.values(project.modules)
          .filter((m) => includeArchived || !m.archived)
          .map((m) => ({
            id: m.id,
            parentId: m.parentId,
            path: getModulePathString(project, m.id),
            name: m.name,
            status: m.status,
            stage: m.stage,
            stop: m.stop,
            next: m.next,
            hasReviewNotes: Boolean(m.reviewNotes),
            childProgress: computeChildProgress(project, m.id),
            effectiveGit: resolveEffectiveGit(project, m.id),
            activeSessionId: m.activeSessionId,
          }));
        return {
          jsonrpc: '2.0',
          id,
          result: okText(
            JSON.stringify(
              {
                workspacePath: project.workspacePath,
                projectName: project.projectName,
                count: nodes.length,
                modules: nodes,
              },
              null,
              2,
            ),
          ),
        };
      }

      if (toolName === 'modtree_get_module') {
        const project = loadProject(workspacePath, dataDir);
        const moduleId = resolveModuleIdFromArgs(workspacePath, args, dataDir);
        const mod = project.modules[moduleId];
        if (!mod) return { jsonrpc: '2.0', id, result: errText(`模块不存在: ${moduleId}`) };
        const ancestors = getAncestors(project, moduleId).map((a) => ({
          id: a.id,
          name: a.name,
          design: a.design,
        }));
        const dependsOnSummaries = (mod.dependsOn || [])
          .map((did) => project.modules[did])
          .filter(Boolean)
          .map((d) => ({ id: d.id, name: d.name, status: d.status, design: d.design }));
        return {
          jsonrpc: '2.0',
          id,
          result: okText(
            JSON.stringify(
              {
                path: getModulePathString(project, moduleId),
                node: mod,
                ancestors,
                dependsOnSummaries,
                effectiveGit: resolveEffectiveGit(project, moduleId),
                childProgress: computeChildProgress(project, moduleId),
              },
              null,
              2,
            ),
          ),
        };
      }

      if (toolName === 'modtree_update_progress') {
        const moduleId = resolveModuleIdFromArgs(workspacePath, args, dataDir);
        if ('stage' in args) {
          return {
            jsonrpc: '2.0',
            id,
            result: errText('modtree_update_progress 不允许修改 stage，请仅在用户明确要求时使用 modtree_set_stage'),
          };
        }
        const { project, result: updated } = mutateProject(
          workspacePath,
          (proj) =>
            updateModuleProgress(proj, moduleId, {
              stop: typeof args.stop === 'string' ? args.stop : undefined,
              next: typeof args.next === 'string' ? args.next : undefined,
              status:
                typeof args.status === 'string' && MODULE_STATUSES.includes(args.status as ModuleStatus)
                  ? (args.status as ModuleStatus)
                  : undefined,
              linkedFiles: Array.isArray(args.linkedFiles)
                ? args.linkedFiles.filter((x): x is string => typeof x === 'string')
                : undefined,
              reviewNotes: typeof args.reviewNotes === 'string' ? args.reviewNotes : undefined,
              clearReviewNotes: Boolean(args.clearReviewNotes),
              allowComplete: false,
              updatedBy: 'mcp-agent',
            }),
          dataDir,
        );
        return {
          jsonrpc: '2.0',
          id,
          result: okText(
            `已更新模块「${getModulePathString(project, updated.id)}」(${updated.id})：status=${updated.status}，stop=${updated.stop || '-'}，next=${updated.next || '-'}${updated.reviewNotes ? '，已写入 reviewNotes' : ''}`,
          ),
        };
      }

      if (toolName === 'modtree_set_stage') {
        const moduleId = String(args.moduleId || '').trim();
        const stage = String(args.stage || '') as ModuleStage;
        const { project, result: updated } = mutateProject(
          workspacePath,
          (proj) => setModuleStage(proj, moduleId, stage, 'mcp-set-stage'),
          dataDir,
        );
        return {
          jsonrpc: '2.0',
          id,
          result: okText(
            `已将模块「${getModulePathString(project, updated.id)}」阶段切换为 ${updated.stage}（状态：${updated.status}）。`,
          ),
        };
      }

      if (toolName === 'modtree_create_module') {
        const designText = typeof args.design === 'string' ? args.design.trim() : undefined;
        if (designText && designText.length > MAX_MCP_DESIGN_LEN) {
          return {
            jsonrpc: '2.0',
            id,
            result: errText(
              `design 超过 ${MAX_MCP_DESIGN_LEN} 字上限（当前 ${designText.length} 字）。请精简为薄摘要（目标 + 关键对外接口契约 + 核心验收要点，建议 ≤ 500 字），长篇细节保留在对话或项目文档中。`,
            ),
          };
        }
        const { project, result: created } = mutateProject(
          workspacePath,
          (proj) =>
            createModule(proj, {
              name: String(args.name || ''),
              slug: typeof args.slug === 'string' ? args.slug : undefined,
              parentId: args.parentId === null || typeof args.parentId === 'string' ? args.parentId : null,
              design: designText,
              dependsOn: Array.isArray(args.dependsOn)
                ? args.dependsOn.filter((x): x is string => typeof x === 'string')
                : undefined,
              stage:
                typeof args.stage === 'string' && MODULE_STAGES.includes(args.stage as ModuleStage)
                  ? (args.stage as ModuleStage)
                  : 'Plan',
              updatedBy: 'mcp-agent',
            }),
          dataDir,
        );
        return {
          jsonrpc: '2.0',
          id,
          result: okText(
            JSON.stringify(
              {
                created: {
                  id: created.id,
                  path: getModulePathString(project, created.id),
                  stage: created.stage,
                  status: created.status,
                },
              },
              null,
              2,
            ),
          ),
        };
      }

      if (toolName === 'modtree_update_module') {
        const moduleId = String(args.moduleId || '').trim();
        const designText = typeof args.design === 'string' ? args.design.trim() : undefined;
        if (designText && designText.length > MAX_MCP_DESIGN_LEN) {
          return {
            jsonrpc: '2.0',
            id,
            result: errText(
              `design 超过 ${MAX_MCP_DESIGN_LEN} 字上限（当前 ${designText.length} 字）。请精简为薄摘要（目标 + 关键对外接口契约 + 核心验收要点，建议 ≤ 500 字），长篇细节保留在对话或项目文档中。`,
            ),
          };
        }
        const { project, result: updated } = mutateProject(
          workspacePath,
          (proj) =>
            updateModule(proj, moduleId, {
              name: typeof args.name === 'string' ? args.name : undefined,
              parentId:
                args.parentId === null || typeof args.parentId === 'string'
                  ? args.parentId
                  : undefined,
              design: designText,
              linkedFiles: Array.isArray(args.linkedFiles)
                ? args.linkedFiles.filter((x): x is string => typeof x === 'string')
                : undefined,
              dependsOn: Array.isArray(args.dependsOn)
                ? args.dependsOn.filter((x): x is string => typeof x === 'string')
                : undefined,
              updatedBy: 'mcp-agent',
            }),
          dataDir,
        );
        return {
          jsonrpc: '2.0',
          id,
          result: okText(
            `已更新模块「${getModulePathString(project, updated.id)}」(${updated.id})，当前 rev=${updated.rev}。`,
          ),
        };
      }

      if (toolName === 'modtree_archive_module') {
        const moduleId = String(args.moduleId || '').trim();
        const { result } = mutateProject(
          workspacePath,
          (proj) => archiveModule(proj, moduleId, 'mcp-agent'),
          dataDir,
        );
        return {
          jsonrpc: '2.0',
          id,
          result: okText(
            `已归档模块「${result.node.name}」(${result.node.id})。${result.warning ? '\n' + result.warning : ''}`,
          ),
        };
      }

      if (toolName === 'modtree_bind_session') {
        const moduleId = String(args.moduleId || '').trim();
        const conversationId = String(args.conversationId || '').trim();
        const stage =
          typeof args.stage === 'string' && MODULE_STAGES.includes(args.stage as ModuleStage)
            ? (args.stage as ModuleStage)
            : undefined;
        const dedicated = Boolean(args.dedicatedForStage);
        const { project, result: updated } = mutateProject(
          workspacePath,
          (proj) => {
            const mod = proj.modules[moduleId];
            if (!mod) throw new Error(`模块不存在: ${moduleId}`);
            const useStage = stage || mod.stage;
            return bindSessionToModule(
              proj,
              moduleId,
              {
                conversationId,
                title: typeof args.title === 'string' && args.title.trim() ? args.title.trim() : mod.name,
                stage: useStage,
                syncedRev: mod.rev,
                syncedAncestorHash: computeAncestorAndDepHash(proj, moduleId),
                syncedStage: useStage,
                syncedReviewNotesHash: computeReviewNotesHash(mod),
              },
              {
                setAsPrimary: !dedicated,
                bindStage: dedicated ? useStage : undefined,
              },
            );
          },
          dataDir,
        );
        return {
          jsonrpc: '2.0',
          id,
          result: okText(
            `已将会话 ${conversationId} 绑定到模块「${getModulePathString(project, updated.id)}」(${updated.id})。`,
          ),
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown tool: ${toolName}` },
      };
    } catch (err: unknown) {
      return {
        jsonrpc: '2.0',
        id,
        result: errText(`Error: ${err instanceof Error ? err.message : String(err)}`),
      };
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

function runStdio(): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const resp = handleMcpRequest(JSON.parse(trimmed) as JsonRpcRequest);
      if (resp) {
        process.stdout.write(JSON.stringify(resp) + '\n');
      }
    } catch (err: unknown) {
      process.stderr.write(`[modtree-mcp] parse error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  });
}

const isDirectExec =
  process.argv[1] &&
  (process.argv[1].endsWith('server.mjs') || process.argv[1].endsWith('server.ts'));
if (isDirectExec) {
  runStdio();
}
