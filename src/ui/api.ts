import type { SidecarSnapshot } from '../core/types.js';

declare global {
  interface Window {
    sidecar?: {
      conversationId?: string;
      fetch?: typeof fetch;
      getWorkspaceUris?: () => Promise<string[]>;
      onWorkspaceChange?: (cb: (uris: string[]) => void) => () => void;
      ui?: {
        toggleConversation?: (conversationId: string, options?: Record<string, unknown>) => void;
        toggleAuxPane?: (req: { tabType: string; uri: string }) => void;
        addArtifactComment?: (payload: {
          uri?: string;
          comment?: string;
          selection?: string;
          pageTitle?: string;
        }) => void;
      };
    };
  }
}

export function getHostConversationId(): string {
  return (
    window.sidecar?.conversationId ||
    new URLSearchParams(window.location.search).get('conversationId') ||
    ''
  );
}

export function shortId(id: string | undefined): string {
  if (!id) return '未绑定';
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function openNativeConversation(conversationId: string): boolean {
  if (!conversationId || !window.sidecar?.ui?.toggleConversation) return false;
  window.sidecar.ui.toggleConversation(conversationId);
  return true;
}

export function openWorkspaceFile(workspacePath: string, relPath: string): boolean {
  if (!window.sidecar?.ui?.toggleAuxPane) return false;
  const cleanWs = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const cleanRel = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const full = cleanWs.startsWith('/') ? `${cleanWs}/${cleanRel}` : `/${cleanWs}/${cleanRel}`;
  window.sidecar.ui.toggleAuxPane({ tabType: 'fileView', uri: `file://${full}` });
  return true;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to legacy textarea copy (common in cross-origin iframes)
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function getFetcher(): typeof fetch {
  return window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
}

export async function fetchSnapshot(workspace: string): Promise<SidecarSnapshot> {
  const qs = new URLSearchParams();
  if (workspace) qs.set('workspace', workspace);
  const convId = getHostConversationId();
  if (convId) qs.set('currentConversationId', convId);
  const res = await getFetcher()(`/api/state?${qs.toString()}`, { method: 'GET' });
  const data = (await res.json()) as SidecarSnapshot & { error?: string };
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

export async function apiPost<T = SidecarSnapshot>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await getFetcher()(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentConversationId: getHostConversationId(),
      ...body,
    }),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}
