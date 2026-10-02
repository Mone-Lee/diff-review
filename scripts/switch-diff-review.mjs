/**
 * Diff Review 调试来源切换脚本，在当前 Node 全局前缀中切换本地软链与 npm 包，
 * 让其他项目始终通过同一个 local-diff-reviewer 命令调用当前选定的实现。
 */
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
const npmVersion = process.argv[3] ?? 'latest';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageName = 'local-diff-reviewer';
const commandName = 'local-diff-reviewer';

if (mode === 'local') {
  runNpm(['run', 'build'], repositoryRoot);
  runNpm(['link'], repositoryRoot);
  runLocalCli('update-skill', {
    LOCAL_DIFF_REVIEWER_SKILL_COMMAND: commandName
  });
  runLocalCli('install-hooks', {
    LOCAL_DIFF_REVIEWER_HOOK_COMMAND: commandName
  });
  printStatus();
} else if (mode === 'npm') {
  runNpm(['install', '--global', `${packageName}@${npmVersion}`], repositoryRoot);
  runSelectedCommand(['update-skill']);
  runSelectedCommand(['install-hooks']);
  printStatus();
} else if (mode === 'status') {
  printStatus();
} else {
  console.error('用法：node scripts/switch-diff-review.mjs <local|npm|status> [npm-version]');
  process.exitCode = 1;
}

/** 执行 npm 子命令并继承终端输出，确保安装失败时直接终止切换。 */
function runNpm(args, cwd) {
  execFileSync(npmCommand, args, { cwd, stdio: 'inherit' });
}

/** 使用当前仓库构建产物更新本地调试配置，避免安装过程重新解析 npm 包。 */
function runLocalCli(command, extraEnv = {}) {
  execFileSync(process.execPath, [join(repositoryRoot, 'dist/cli/start.js'), command], {
    cwd: repositoryRoot,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit'
  });
}

/** npm 模式下调用刚安装的全局命令，确保 Skill 与 hook 都来自选定版本。 */
function runSelectedCommand(args) {
  execFileSync(resolveGlobalCommandPath(), args, { cwd: repositoryRoot, stdio: 'inherit' });
}

function resolveGlobalCommandPath() {
  const globalPrefix = execFileSync(npmCommand, ['prefix', '--global'], { encoding: 'utf8' }).trim();
  return process.platform === 'win32'
    ? join(globalPrefix, `${commandName}.cmd`)
    : join(globalPrefix, `bin/${commandName}`);
}

/** 输出当前 shell 实际使用的 local-diff-reviewer 版本、命令路径和软链来源。 */
function printStatus() {
  const commandPath = resolveGlobalCommandPath();

  if (!existsSync(commandPath)) {
    console.log('模式：未安装');
    console.log(`命令：${commandPath}`);
    return;
  }

  const targetPath = realpathSync(commandPath);
  const localPackagePath = realpathSync(repositoryRoot);
  const isLocal = targetPath === localPackagePath || targetPath.startsWith(`${localPackagePath}${sep}`);
  if (!isExecutable(commandPath)) {
    console.log(`模式：${isLocal ? '本地源码' : 'npm 包'}`);
    console.log('状态：不可执行，请重新运行 npm run diff-review:use-local');
    console.log(`命令：${commandPath}`);
    console.log(`目标：${targetPath}`);
    process.exitCode = 1;
    return;
  }

  const version = execFileSync(commandPath, ['--version'], { encoding: 'utf8' }).trim();

  console.log(`模式：${isLocal ? '本地源码' : 'npm 包'}`);
  console.log(`版本：${version}`);
  console.log(`命令：${commandPath}`);
  console.log(`目标：${targetPath}`);
}

/** 检查命令真实目标是否具有当前用户可执行权限。 */
function isExecutable(commandPath) {
  if (process.platform === 'win32') {
    return true;
  }

  try {
    accessSync(commandPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
