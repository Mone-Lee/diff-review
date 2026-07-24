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

const codexPlanHookCommand = 'npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest plan-hook';
const codexPlanHook: HookCommand = {
  type: 'command',
  command: codexPlanHookCommand,
  timeout: 600,
  statusMessage: 'Reviewing plan'
};

export async function installCodexPlanHook(options: { project?: boolean; cwd?: string } = {}): Promise<{ path: string; changed: boolean }> {
  const configDir = options.project ? join(resolve(options.cwd ?? process.cwd()), '.codex') : codexHome();
  const configResult = await ensureCodexHooksFeature(join(configDir, 'config.toml'));
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

function codexHome(): string {
  return process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(homedir(), '.codex');
}

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
