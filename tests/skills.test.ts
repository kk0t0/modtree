import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALL_BUNDLED_SKILL_IDS,
  CPP_STACK_SKILLS,
  CROSS_STAGE_SKILLS,
  STAGE_SKILLS,
  detectCppStack,
  formatStageSkillsPrompt,
  getRecommendedSkillsForStage,
} from '../src/core/skills.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const skillsRoot = resolve(repoRoot, 'plugin-static', 'skills');

describe('bundled ECC skills & stage-aware routing', () => {
  it('registers all 19 curated ECC skills with valid SKILL.md, MIT attribution, and no broken links', () => {
    expect(ALL_BUNDLED_SKILL_IDS).toHaveLength(19);
    expect(STAGE_SKILLS.Plan).toHaveLength(5);
    expect(STAGE_SKILLS.Code).toHaveLength(8);
    expect(STAGE_SKILLS.Review).toHaveLength(5);
    expect(CROSS_STAGE_SKILLS).toHaveLength(3);
    expect(CPP_STACK_SKILLS).toHaveLength(2);

    for (const id of ALL_BUNDLED_SKILL_IDS) {
      const skillFile = join(skillsRoot, id, 'SKILL.md');
      expect(existsSync(skillFile), `missing ${skillFile}`).toBe(true);
      const raw = readFileSync(skillFile, 'utf-8');
      const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      expect(fmMatch, `missing YAML frontmatter in ${id}`).not.toBeNull();
      const fm = fmMatch![1];
      expect(fm).toMatch(new RegExp(`^name:\\s*${id}\\s*$`, 'm'));
      expect(fm).toMatch(/^description:/m);
      expect(fm).toMatch(/^license:\s*MIT\s*$/m);
      expect(fm).toMatch(/origin:\s*ECC/);

      // Ensure no broken relative links or missing Claude/ECC local script executions
      expect(raw).not.toContain('../orch-pipeline/SKILL.md');
      expect(raw).not.toContain('~/.claude/scripts/hooks/suggest-compact.js');
      expect(raw).not.toContain('$ECC_ROOT/scripts/setup-package-manager.js');
    }
  });

  it('routes exact stage skills and only appends C++ skills for C++/ESP32 Code or Review', () => {
    const planNonCpp = getRecommendedSkillsForStage('Plan', false).map((s) => s.id);
    expect(planNonCpp).toEqual([
      'search-first',
      'hexagonal-architecture',
      'api-design',
      'database-migrations',
      'error-handling',
    ]);

    const codeNonCpp = getRecommendedSkillsForStage('Code', false).map((s) => s.id);
    expect(codeNonCpp).toContain('tdd-workflow');
    expect(codeNonCpp).toContain('verification-loop');
    expect(codeNonCpp).not.toContain('cpp-coding-standards');

    const codeCpp = getRecommendedSkillsForStage('Code', true).map((s) => s.id);
    expect(codeCpp).toContain('cpp-coding-standards');
    expect(codeCpp).toContain('cpp-testing');

    const reviewCpp = getRecommendedSkillsForStage('Review', true).map((s) => s.id);
    expect(reviewCpp).toContain('security-review');
    expect(reviewCpp).toContain('cpp-coding-standards');
    expect(reviewCpp).toContain('cpp-testing');

    const planCpp = getRecommendedSkillsForStage('Plan', true).map((s) => s.id);
    expect(planCpp).not.toContain('cpp-coding-standards');
  });

  it('detects C++/ESP32 stacks cleanly without false positives on standard web repos', () => {
    expect(
      detectCppStack({
        workspacePath: '/nonexistent/web-app',
        linkedFiles: ['src/App.tsx', 'src/api/client.ts'],
        moduleName: '结果导出',
        slug: 'result-export',
      }),
    ).toBe(false);

    expect(
      detectCppStack({
        linkedFiles: ['src/sensor/driver.cpp', 'src/sensor/driver.hpp'],
      }),
    ).toBe(true);

    expect(
      detectCppStack({
        moduleName: 'ESP32 传感器固件',
      }),
    ).toBe(true);

    const tmpDir = mkdtempSync(join(tmpdir(), 'modtree-cpp-'));
    try {
      expect(detectCppStack({ workspacePath: tmpDir })).toBe(false);
      mkdirSync(join(tmpDir, 'main'), { recursive: true });
      writeFileSync(join(tmpDir, 'main', 'CMakeLists.txt'), 'idf_component_register()', 'utf-8');
      expect(detectCppStack({ workspacePath: tmpDir })).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('formats full and compact stage skill prompt snippets', () => {
    const full = formatStageSkillsPrompt('Code', { cppStack: true });
    expect(full).toContain('渐进披露');
    expect(full).toContain('C++/ESP32');
    expect(full).toContain('tdd-workflow');
    expect(full).toContain('cpp-coding-standards');

    const compact = formatStageSkillsPrompt('Review', { cppStack: false, compact: true });
    expect(compact).toContain('security-review');
    expect(compact).toContain('verification-loop');
    expect(compact).not.toContain('cpp-coding-standards');
  });
});
