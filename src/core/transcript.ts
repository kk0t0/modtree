import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAppDataDir } from './store.js';
import { TranscriptObservation } from './types.js';

const ID_RE = /^[0-9a-f-]{8,}$/i;
const NEW_REPLY_WINDOW_MS = 90_000;

export function observeTranscript(
  conversationId: string | undefined,
  appDataDir = resolveAppDataDir(),
): TranscriptObservation {
  if (!conversationId || !ID_RE.test(conversationId)) {
    return {
      available: false,
      state: 'unbound',
      stepCount: 0,
      latestReply: '',
      latestReplyAt: '',
    };
  }

  const logPath = join(
    appDataDir,
    'brain',
    conversationId,
    '.system_generated',
    'logs',
    'transcript.jsonl',
  );
  if (!existsSync(logPath)) {
    return {
      available: false,
      state: 'no_transcript',
      stepCount: 0,
      latestReply: '',
      latestReplyAt: '',
    };
  }

  try {
    const raw = readFileSync(logPath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    let latestReply = '';
    let latestReplyAt = '';
    let lastStep: Record<string, unknown> | null = null;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        lastStep = entry;
        if (
          entry.type === 'PLANNER_RESPONSE' &&
          typeof entry.content === 'string' &&
          entry.content.trim()
        ) {
          latestReply = entry.content.trim();
          latestReplyAt = typeof entry.created_at === 'string' ? entry.created_at : '';
        }
      } catch {
        // ignore partial line mid-write
      }
    }

    const mtimeMs = statSync(logPath).mtimeMs;
    let state: TranscriptObservation['state'] = 'idle';

    if (lastStep) {
      const status = String(lastStep.status || '');
      const type = String(lastStep.type || '');
      const toolCalls = Array.isArray(lastStep.tool_calls) ? lastStep.tool_calls : [];

      if (status === 'RUNNING' || status === 'PENDING') {
        state = 'running';
      } else if (type === 'PLANNER_RESPONSE' && toolCalls.length > 0) {
        state = 'running';
      } else if (type === 'USER_INPUT') {
        state = 'running';
      } else if (status === 'ERROR') {
        state = 'error';
      } else if (latestReply && Date.now() - mtimeMs <= NEW_REPLY_WINDOW_MS) {
        state = 'new_reply';
      }
    }

    const snippet = latestReply.length > 240 ? `${latestReply.slice(0, 240)}…` : latestReply;
    return {
      available: true,
      state,
      stepCount: lines.length,
      latestReply: snippet,
      latestReplyAt,
      mtimeMs,
    };
  } catch {
    return {
      available: false,
      state: 'read_error',
      stepCount: 0,
      latestReply: '',
      latestReplyAt: '',
    };
  }
}
