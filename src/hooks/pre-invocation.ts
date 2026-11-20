import { readFileSync } from 'node:fs';
import {
  buildDriftInjectionMessage,
  computeAncestorAndDepHash,
  computeReviewNotesHash,
} from '../core/context.js';
import {
  lookupSessionBinding,
  mutateProject,
  resolvePluginDataDir,
} from '../core/store.js';
import { resolveSessionEffectiveStage } from '../core/tree.js';

export interface PreInvocationInput {
  conversationId?: string;
  workspacePaths?: string[];
  invocationNum?: number;
  initialNumSteps?: number;
}

export interface PreInvocationOutput {
  injectSteps?: Array<{
    systemMessage: {
      systemMessage: string;
    };
  }>;
  terminationBehavior?: string;
}

export function evaluatePreInvocation(
  input: PreInvocationInput,
  dataDir = resolvePluginDataDir(),
): PreInvocationOutput {
  const convId = input.conversationId || '';
  if (!convId) return {};

  const binding = lookupSessionBinding(convId, dataDir);
  if (!binding) {
    // Unbound conversation: <5ms zero-overhead silence
    return {};
  }

  const { project, moduleId } = binding;
  const mod = project.modules[moduleId];
  if (!mod || mod.archived) return {};

  const session = (mod.sessions || []).find((s) => s.conversationId === convId);
  if (!session) return {};

  const message = buildDriftInjectionMessage(project, moduleId, session);
  if (!message) return {};

  // Update synced markers so the same drift isn't injected twice
  const curAncHash = computeAncestorAndDepHash(project, moduleId);
  const curReviewHash = computeReviewNotesHash(mod);
  const effectiveStage = resolveSessionEffectiveStage(mod, session);
  mutateProject(
    project.workspacePath,
    (proj) => {
      const m = proj.modules[moduleId];
      const rec = m?.sessions?.find((s) => s.conversationId === convId);
      if (m && rec) {
        rec.syncedRev = m.rev;
        rec.syncedAncestorHash = curAncHash;
        rec.syncedStage = effectiveStage;
        rec.syncedReviewNotesHash = curReviewHash;
      }
    },
    dataDir,
  );

  return {
    injectSteps: [
      {
        systemMessage: {
          systemMessage: message,
        },
      },
    ],
  };
}

function runCli(): void {
  try {
    const raw = readFileSync(0, 'utf-8').trim();
    const input = raw ? (JSON.parse(raw) as PreInvocationInput) : {};
    const out = evaluatePreInvocation(input);
    process.stdout.write(JSON.stringify(out) + '\n');
  } catch (err: unknown) {
    process.stderr.write(`[modtree pre-invocation] error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.stdout.write('{}\n');
  }
}

const isDirectExec =
  process.argv[1] &&
  (process.argv[1].endsWith('pre-invocation.mjs') || process.argv[1].endsWith('pre-invocation.ts'));
if (isDirectExec) {
  runCli();
}
