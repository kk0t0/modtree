declare module 'sidecar_sdk' {
  export class Response {
    body: string | Uint8Array | Buffer;
    contentType: string;
    status?: number;
    headers?: Record<string, string>;
    constructor(
      body: string | Uint8Array | Buffer,
      options?: {
        contentType?: string;
        status?: number;
        headers?: Record<string, string>;
      },
    );
  }

  export class SidecarApp {
    readonly config: {
      projectId?: string;
      conversationId?: string;
    };
    sendMessage(
      conversationId: string,
      message: string,
      options?: { title?: string; projectId?: string },
    ): unknown;
    startConversation(
      message: string,
      options?: { model?: string; projectId?: string },
    ): unknown;
    getConversationMetadata(conversationId: string): unknown;
    page(path: string, handler: () => string | Response | Promise<string | Response>): void;
    api(
      path: string,
      handler: (data: Record<string, unknown>) => unknown | Promise<unknown>,
      method?: string,
    ): void;
    run(): Promise<unknown>;
    close(): Promise<void>;
  }
}
