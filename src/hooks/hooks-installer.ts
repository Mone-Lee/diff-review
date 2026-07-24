/**
 * Hook 安装器：负责幂等合并 Codex hooks.json，让 plan review hook 可由 CLI 或 skill 脚本启用。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

type HookCommand = {
  type: 'command';
  command: string;
  timeout?: number;
  statusMessage?: string;
};

type HookGroup = {
  matcher?: string;
  hooks: HookCommand[];
};

type HooksFile = {
  description?: string;
  hooks?: Record<string, HookGroup[]>;
};

// 安装写入 hooks.json 的实际命令；保持包名和 CLI 子命令稳定，避免已 trust 的配置指向源码路径。
const codexPlanHookCommand = 'npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest plan-hook';
const codexPlanHook: HookCommand = {
  type: 'command',
  command: codexPlanHookCommand,
  timeout: 600,
  statusMessage: 'Reviewing plan'
};

/**
 * 安装或合并 Codex plan hook，并同时确保同一配置目录里的 `[features].hooks` 已开启。
 */
export async function installCodexPlanHook(options: { project?: boolean; cwd?: string } = {}): Promise<{ path: string; changed: boolean }> {
  // 全局安装写入 CODEX_HOME/个人配置；项目安装只写当前工作区 .codex，交由 Codex trust 机制决定是否加载。
  const configDir = options.project ? join(resolve(options.cwd ?? process.cwd()), '.codex') : codexHome();
  const configResult = await ensureCodexHooksFeature(join(configDir, 'config.toml'));
  // hooks.json 是 Codex Stop hook 的唯一持久化入口；这里必须合并，不能覆盖用户已有 hooks。
  const targetPath = join(configDir, 'hooks.json');
  const current = await readHooksFile(targetPath);
  const next = ensureCodexPlanHook(current);
  const changed = JSON.stringify(current) !== JSON.stringify(next);

  if (changed) {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }

  return { path: targetPath, changed: changed || configResult.changed };
}

/**
 * 解析 Codex 配置根目录：优先尊重 CODEX_HOME，未设置时回落到用户目录下的 `.codex`。
 */
function codexHome(): string {
  return process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(homedir(), '.codex');
}

/**
 * 读取并规范化 hooks.json；缺失文件等同于空配置，损坏 JSON 则显式报错避免静默覆盖。
 */
async function readHooksFile(path: string): Promise<HooksFile> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as HooksFile;
    return typeof parsed === 'object' && parsed ? normalizeHooksFile(parsed) : {};
  } catch (error) {
    if (isMissingFileError(error)) return {};
    throw new Error(`Failed to parse existing hooks file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function normalizeHooksFile(file: HooksFile): HooksFile {
  return {
    ...file,
    hooks: file.hooks && typeof file.hooks === 'object' ? file.hooks : {}
  };
}

/**
 * 在 Stop hook 列表中追加缺失的 Diff Review hook，保留已有描述、matcher 和其他生命周期配置。
 */
function ensureCodexPlanHook(file: HooksFile): HooksFile {
  const hooks = { ...(file.hooks ?? {}) };
  const stopGroups = [...(hooks.Stop ?? [])];
  const hasHook = stopGroups.some((group) => group.hooks?.some((hook) => hook.command === codexPlanHookCommand));

  if (!hasHook) {
    stopGroups.push({ hooks: [codexPlanHook] });
  }

  return {
    description: file.description ?? 'Local lifecycle hooks managed by local-diff-reviewer.',
    ...file,
    hooks: {
      ...hooks,
      Stop: stopGroups
    }
  };
}

/**
 * 确保 config.toml 中开启 hooks 功能；这是 hooks.json 生效前必须满足的 Codex 配置开关。
 */
async function ensureCodexHooksFeature(path: string): Promise<{ changed: boolean }> {
  let current = '';
  try {
    current = await readFile(path, 'utf8');
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '[features]\nhooks = true\n', 'utf8');
    return { changed: true };
  }

  const next = enableHooksFeatureInToml(current);
  if (next === current) return { changed: false };
  await writeFile(path, next, 'utf8');
  return { changed: true };
}

/**
 * 在不引入 TOML 依赖的前提下只改 `[features]` 段里的 hooks 开关，并尽量保留文件其余内容。
 */
function enableHooksFeatureInToml(input: string): string {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  let featuresStart = -1;
  let featuresEnd = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*\[features\]\s*$/.test(lines[index])) {
      featuresStart = index;
      continue;
    }
    if (featuresStart !== -1 && index > featuresStart && /^\s*\[[^\]]+\]\s*$/.test(lines[index])) {
      featuresEnd = index;
      break;
    }
  }

  if (featuresStart === -1) {
    const suffix = input.endsWith('\n') || input.length === 0 ? '' : '\n';
    return `${input}${suffix}\n[features]\nhooks = true\n`;
  }

  for (let index = featuresStart + 1; index < featuresEnd; index += 1) {
    if (/^\s*(hooks|codex_hooks)\s*=/.test(lines[index])) {
      if (/^\s*hooks\s*=\s*true\s*(#.*)?$/.test(lines[index])) return input;
      lines[index] = 'hooks = true';
      return `${lines.join('\n').replace(/\n*$/, '')}\n`;
    }
  }

  lines.splice(featuresEnd, 0, 'hooks = true');
  return `${lines.join('\n').replace(/\n*$/, '')}\n`;
}
