import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { ModuleStage } from './types.js';

export interface SkillEntry {
  id: string;
  trigger: string;
  origin: 'ECC';
}

export const STAGE_SKILLS: Record<ModuleStage, readonly SkillEntry[]> = {
  Plan: [
    {
      id: 'search-first',
      trigger: '动手前调研现有仓库代码、成熟库或开源方案，避免重复造轮子',
      origin: 'ECC',
    },
    {
      id: 'hexagonal-architecture',
      trigger: '拆分业务核心与外部适配器（防单体臃肿与并行 Git 冲突）',
      origin: 'ECC',
    },
    {
      id: 'api-design',
      trigger: '设计 HTTP / REST / MCP 接口命名、分页、状态码与错误返回',
      origin: 'ECC',
    },
    {
      id: 'database-migrations',
      trigger: '设计表结构/存储迁移、向后兼容与回滚方案',
      origin: 'ECC',
    },
    {
      id: 'error-handling',
      trigger: '设计错误码、重试/幂等边界、防静默吞错与用户提示分离',
      origin: 'ECC',
    },
  ],
  Code: [
    {
      id: 'tdd-workflow',
      trigger: '新功能或修 bug 先写红灯测试、再最小实现转绿',
      origin: 'ECC',
    },
    {
      id: 'coding-standards',
      trigger: '通用命名、可读性、KISS/DRY/YAGNI 基线',
      origin: 'ECC',
    },
    {
      id: 'orch-refine-code',
      trigger: '纯结构重构（拆巨石文件/去重），确保行为不变且测试全绿',
      origin: 'ECC',
    },
    {
      id: 'backend-patterns',
      trigger: 'Node.js / HTTP 服务端分层、数据访问与接口实现规范',
      origin: 'ECC',
    },
    {
      id: 'frontend-patterns',
      trigger: 'Web/UI 状态管理、组件组织与渲染性能规范',
      origin: 'ECC',
    },
    {
      id: 'e2e-testing',
      trigger: '编写或维护 Playwright 浏览器端到端回归测试',
      origin: 'ECC',
    },
    {
      id: 'git-workflow',
      trigger: 'Worktree 分支管理、小步提交、同步主干与冲突预防',
      origin: 'ECC',
    },
    {
      id: 'verification-loop',
      trigger: '里程碑收尾标 待检查 前跑 6 步验证闭环（构建/检查/测试/安全/diff）',
      origin: 'ECC',
    },
  ],
  Review: [
    {
      id: 'security-review',
      trigger: '审查鉴权、外部输入、XSS/注入、凭据与敏感数据泄漏',
      origin: 'ECC',
    },
    {
      id: 'verification-loop',
      trigger: '核验验证证据完整性与真实 diff 范围',
      origin: 'ECC',
    },
    {
      id: 'coding-standards',
      trigger: '审查过度设计、复杂度与代码质量',
      origin: 'ECC',
    },
    {
      id: 'api-design',
      trigger: '审查接口契约一致性与向后兼容',
      origin: 'ECC',
    },
    {
      id: 'error-handling',
      trigger: '审查异常分支、并发冲突与未知状态恢复边界',
      origin: 'ECC',
    },
  ],
};

export const CROSS_STAGE_SKILLS: readonly SkillEntry[] = [
  {
    id: 'deployment-patterns',
    trigger: 'Docker 构建、生产停写备份、发布核验与回滚',
    origin: 'ECC',
  },
  {
    id: 'agent-introspection-debugging',
    trigger: '运行/测试反复失败时做可复现诊断，而不是盲目重试',
    origin: 'ECC',
  },
  {
    id: 'strategic-compact',
    trigger: '长会话完成阶段节点时提示 /compact 或切新阶段会话',
    origin: 'ECC',
  },
];

export const CPP_STACK_SKILLS: readonly SkillEntry[] = [
  {
    id: 'cpp-coding-standards',
    trigger: 'C++ / 嵌入式固件代码规范',
    origin: 'ECC',
  },
  {
    id: 'cpp-testing',
    trigger: 'C++ 单元测试与测试排查',
    origin: 'ECC',
  },
];

export const ALL_BUNDLED_SKILL_IDS: readonly string[] = Array.from(
  new Set([
    ...STAGE_SKILLS.Plan.map((s) => s.id),
    ...STAGE_SKILLS.Code.map((s) => s.id),
    ...STAGE_SKILLS.Review.map((s) => s.id),
    ...CROSS_STAGE_SKILLS.map((s) => s.id),
    ...CPP_STACK_SKILLS.map((s) => s.id),
  ]),
);

const CPP_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.h',
  '.hh',
  '.hpp',
  '.hxx',
  '.ino',
]);

const CPP_FILENAMES = new Set([
  'cmakelists.txt',
  'platformio.ini',
  'sdkconfig',
  'sdkconfig.defaults',
  'idf_component.yml',
  'compile_commands.json',
]);

const CPP_ROOT_MARKERS = [
  'CMakeLists.txt',
  'platformio.ini',
  'sdkconfig',
  'sdkconfig.defaults',
  'idf_component.yml',
  'compile_commands.json',
  join('main', 'CMakeLists.txt'),
];

const CPP_MODULE_PATTERN = /\b(cpp|c\+\+|esp32|esp-idf|stm32|platformio|firmware)\b|固件/i;

export interface DetectCppStackInput {
  workspacePath?: string;
  workingDir?: string;
  linkedFiles?: string[];
  moduleName?: string;
  slug?: string;
}

/**
 * Lightweight, zero-throw detector for C++ / ESP32 firmware workspaces or modules.
 * Keeps non-C++ repos completely free of C++ skill noise.
 */
export function detectCppStack(input: DetectCppStackInput): boolean {
  if (input.linkedFiles?.length) {
    for (const file of input.linkedFiles) {
      const lowerBase = basename(file).toLowerCase();
      if (CPP_FILENAMES.has(lowerBase)) return true;
      const ext = extname(lowerBase);
      if (CPP_EXTENSIONS.has(ext)) return true;
    }
  }

  if (
    (input.moduleName && CPP_MODULE_PATTERN.test(input.moduleName)) ||
    (input.slug && CPP_MODULE_PATTERN.test(input.slug))
  ) {
    return true;
  }

  const dirs = [input.workingDir, input.workspacePath].filter((d): d is string => Boolean(d));
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    try {
      if (!existsSync(dir)) continue;
      for (const marker of CPP_ROOT_MARKERS) {
        if (existsSync(join(dir, marker))) return true;
      }
    } catch {
      // Ignore inaccessible paths
    }
  }

  return false;
}

export function getRecommendedSkillsForStage(
  stage: ModuleStage,
  cppStack = false,
): SkillEntry[] {
  const base = [...STAGE_SKILLS[stage]];
  if (cppStack && (stage === 'Code' || stage === 'Review')) {
    base.push(...CPP_STACK_SKILLS);
  }
  return base;
}

export function formatStageSkillsPrompt(
  stage: ModuleStage,
  options: { cppStack?: boolean; compact?: boolean } = {},
): string {
  const skills = getRecommendedSkillsForStage(stage, Boolean(options.cppStack));
  if (options.compact) {
    return `本阶段推荐技能（按需读取对应 SKILL.md）：${skills.map((s) => s.id).join('、')}。`;
  }
  const lines = [
    `本阶段推荐技能（渐进披露：仅命中场景时读取对应 SKILL.md，无关勿读${options.cppStack && (stage === 'Code' || stage === 'Review') ? '；已探测 C++/ESP32 技术栈' : ''}）：`,
  ];
  for (const s of skills) {
    lines.push(`- ${s.id}：${s.trigger}`);
  }
  return lines.join('\n');
}
