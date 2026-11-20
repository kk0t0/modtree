import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleMcpRequest } from '../src/mcp/server.js';

describe('MCP stdio server contract', () => {
  let dataDir: string;
  let wsA: string;
  let wsB: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'modtree-mcp-'));
    wsA = join(dataDir, 'proj-a');
    wsB = join(dataDir, 'proj-b');
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('handles initialize, tools/list, workspace isolation, and strict progress/stage guardrails', () => {
    const init = handleMcpRequest({ id: 1, method: 'initialize', params: {} }, dataDir);
    expect((init?.result as { serverInfo: { name: string } }).serverInfo.name).toBe('modtree-mcp-server');

    const list = handleMcpRequest({ id: 2, method: 'tools/list' }, dataDir);
    const names = ((list?.result as { tools: Array<{ name: string }> }).tools).map((t) => t.name);
    expect(names).toContain('modtree_update_progress');
    expect(names).toContain('modtree_set_stage');

    const cA = handleMcpRequest(
      {
        id: 3,
        method: 'tools/call',
        params: {
          name: 'modtree_create_module',
          arguments: { workspacePath: wsA, name: '字段选择', slug: 'field-picker', design: '保留顺序' },
        },
      },
      dataDir,
    );
    const createdA = JSON.parse(
      ((cA?.result as { content: Array<{ text: string }> }).content[0]).text,
    ).created;
    expect(createdA.id).toBe('field-picker');

    // Rejects overly long design (> 800 chars) to prevent context/JSON bloat
    const tooLongDesign = handleMcpRequest(
      {
        id: 31,
        method: 'tools/call',
        params: {
          name: 'modtree_update_module',
          arguments: { workspacePath: wsA, moduleId: createdA.id, design: '长'.repeat(850) },
        },
      },
      dataDir,
    );
    expect((tooLongDesign?.result as { isError?: boolean }).isError).toBe(true);

    // Workspace B stays completely isolated (0 modules)
    const treeB = handleMcpRequest(
      {
        id: 4,
        method: 'tools/call',
        params: { name: 'modtree_get_tree', arguments: { workspacePath: wsB } },
      },
      dataDir,
    );
    expect(JSON.parse(((treeB?.result as { content: Array<{ text: string }> }).content[0]).text).count).toBe(0);

    // Rejects stage field inside modtree_update_progress
    const badStage = handleMcpRequest(
      {
        id: 5,
        method: 'tools/call',
        params: {
          name: 'modtree_update_progress',
          arguments: { workspacePath: wsA, moduleId: createdA.id, stage: 'Code' },
        },
      },
      dataDir,
    );
    expect((badStage?.result as { isError?: boolean }).isError).toBe(true);

    // Rejects auto-setting 已完成
    const badComplete = handleMcpRequest(
      {
        id: 6,
        method: 'tools/call',
        params: {
          name: 'modtree_update_progress',
          arguments: { workspacePath: wsA, moduleId: createdA.id, status: '已完成' },
        },
      },
      dataDir,
    );
    expect((badComplete?.result as { isError?: boolean }).isError).toBe(true);

    // Valid progress + reviewNotes + clearReviewNotes
    const okProg = handleMcpRequest(
      {
        id: 7,
        method: 'tools/call',
        params: {
          name: 'modtree_update_progress',
          arguments: {
            workspacePath: wsA,
            moduleId: createdA.id,
            stop: '界面已完成',
            next: '修复空数据校验',
            status: '待检查',
            reviewNotes: '1) 空数组未拦截',
          },
        },
      },
      dataDir,
    );
    expect((okProg?.result as { isError?: boolean }).isError).toBeUndefined();

    // Dedicated stage switch works when invoked explicitly
    const setSt = handleMcpRequest(
      {
        id: 8,
        method: 'tools/call',
        params: {
          name: 'modtree_set_stage',
          arguments: { workspacePath: wsA, moduleId: createdA.id, stage: 'Code' },
        },
      },
      dataDir,
    );
    expect(((setSt?.result as { content: Array<{ text: string }> }).content[0]).text).toContain('Code');
  });
});
