/**
 * 整体流程说明
 * 1. 启动 review 时，`recordRuntime` 会把当前仓库对应的运行信息写入本地注册表文件。
 * 2. 写入前会过滤掉已失效的旧 PID，避免注册表不断积累脏数据。
 * 3. 执行 `stop` 时，`stopRecordedRuntimes` 会先发送 SIGTERM，超时未退出再升级为 SIGKILL。
 * 4. 若记录中存在 `vitePid`，会与主进程一并回收，覆盖 `--dev` 场景的端口占用。
 * 5. stop 执行后会清空该仓库注册表；无法终止或已失效的记录会归入 stale 结果用于提示。
 * 6. 读取注册表时遇到文件缺失或损坏，按空记录处理，确保主流程可继续执行。
 */

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { homedir, platform } from 'node:os';
import { basename, dirname, join } from 'node:path';

// 运行时注册表按仓库隔离：每个 repoRoot hash 对应一个文件。
// 这样 "local-diff-reviewer stop" 只会停止当前仓库创建的进程。
export type RuntimeEntry = {
  pid: number;
  vitePid?: number;
  // runtime 记录新增 vitePort，同仓库刷新时返回真实 Vite URL，不再固定 5173
  vitePort?: number;
  repoRoot: string;
  repoName: string;
  startedAt: string;
  apiPort: number;
  usesVite: boolean;
};

type RuntimeStore = {
  entries: RuntimeEntry[];
};

const TERM_WAIT_MS = 800;
const KILL_WAIT_MS = 1200;
const POLL_INTERVAL_MS = 100;

export async function recordRuntime(entry: RuntimeEntry): Promise<void> {
  const path = runtimePath(entry.repoRoot);
  const store = await readRuntime(path);
  // 只保留仍存活的主进程记录，再写入当前这次运行信息。
  const aliveEntries = store.entries.filter((item) => isPidAlive(item.pid));
  const deduped = aliveEntries.filter((item) => item.pid !== entry.pid);
  deduped.push(entry);
  await writeRuntime(path, { entries: deduped });
}

export async function getLiveRuntimes(repoRoot: string): Promise<RuntimeEntry[]> {
  const store = await readRuntime(runtimePath(repoRoot));
  return store.entries.filter((entry) => isPidAlive(entry.pid)).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export async function stopRecordedRuntimes(repoRoot: string): Promise<{
  stopped: RuntimeEntry[];
  forced: RuntimeEntry[];
  stale: RuntimeEntry[];
}> {
  const path = runtimePath(repoRoot);
  const store = await readRuntime(path);
  const stopped: RuntimeEntry[] = [];
  const forced: RuntimeEntry[] = [];
  const stale: RuntimeEntry[] = [];

  for (const entry of store.entries) {
    const parentAlive = isPidAlive(entry.pid);
    const viteAlive = typeof entry.vitePid === 'number' && isPidAlive(entry.vitePid);
    if (!parentAlive && !viteAlive) {
      stale.push(entry);
      continue;
    }
    const termination = await terminateRuntime(entry);
    if (termination.status === 'stopped') {
      stopped.push(entry);
      continue;
    }
    if (termination.status === 'forced') {
      forced.push(entry);
      continue;
    }
    if (termination.status === 'stale') {
      stale.push(entry);
    }
  }

  // 每次 stop 后重置注册表，避免陈旧记录长期堆积。
  await writeRuntime(path, { entries: [] });
  return { stopped, forced, stale };
}

function runtimePath(repoRoot: string): string {
  const repoName = basename(repoRoot) || 'repo';
  const repoHash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 12);
  return join(runtimeDir(), `${repoName}-${repoHash}.runtime.json`);
}

function runtimeDir(): string {
  if (platform() === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'diff-review', 'runtime');
  }
  return join(homedir(), '.local', 'diff-review', 'runtime');
}

async function readRuntime(path: string): Promise<RuntimeStore> {
  try {
    const text = await readFile(path, 'utf8');
    const parsed = JSON.parse(text) as RuntimeStore;
    if (!Array.isArray(parsed.entries)) return { entries: [] };
    return { entries: parsed.entries.filter(isRuntimeEntry) };
  } catch {
    // 文件不存在或损坏时返回空记录，避免影响 stop/start 主流程。
    return { entries: [] };
  }
}

async function writeRuntime(path: string, store: RuntimeStore): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function isRuntimeEntry(value: unknown): value is RuntimeEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<RuntimeEntry>;
  return (
    typeof entry.pid === 'number' &&
    (typeof entry.vitePid === 'undefined' || typeof entry.vitePid === 'number') &&
    (typeof entry.vitePort === 'undefined' || typeof entry.vitePort === 'number') &&
    typeof entry.repoRoot === 'string' &&
    typeof entry.repoName === 'string' &&
    typeof entry.startedAt === 'string' &&
    typeof entry.apiPort === 'number' &&
    typeof entry.usesVite === 'boolean'
  );
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // signal 0 仅用于探测进程是否存在/有权限，不会真的终止进程。
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// stop 会优先给子进程和主进程发送 SIGTERM；若宽限期后仍存活，再升级为 SIGKILL。
// 只有当相关 PID 退出且 API/Vite 端口都真正释放后，才算停止成功。
async function terminateRuntime(entry: RuntimeEntry): Promise<{ status: 'stopped' | 'forced' | 'stale' }> {
  const pids = collectTargetPids(entry);
  const ports = collectRuntimePorts(entry);
  if (pids.length === 0) {
    return (await waitForRuntimeRelease(pids, ports, TERM_WAIT_MS)) ? { status: 'stopped' } : { status: 'stale' };
  }

  const terminated = await terminatePids(pids, 'SIGTERM', TERM_WAIT_MS);
  if (terminated && (await waitForRuntimeRelease(pids, ports, TERM_WAIT_MS))) return { status: 'stopped' };

  const forced = await terminatePids(pids, 'SIGKILL', KILL_WAIT_MS);
  if (forced && (await waitForRuntimeRelease(pids, ports, KILL_WAIT_MS))) return { status: 'forced' };
  return { status: 'stale' };
}

function collectTargetPids(entry: RuntimeEntry): number[] {
  const pids: number[] = [];
  if (typeof entry.vitePid === 'number' && isPidAlive(entry.vitePid)) pids.push(entry.vitePid);
  if (isPidAlive(entry.pid)) pids.push(entry.pid);
  return pids;
}

function collectRuntimePorts(entry: RuntimeEntry): number[] {
  const ports = new Set<number>();
  const { apiPort, vitePort } = entry;
  if (Number.isInteger(apiPort) && apiPort > 0) {
    ports.add(apiPort);
  }
  if (typeof vitePort === 'number' && Number.isInteger(vitePort) && vitePort > 0) {
    ports.add(vitePort);
  }
  return [...ports];
}

async function terminatePids(
  pids: number[],
  signal: NodeJS.Signals,
  waitMs: number
): Promise<boolean> {
  let signaled = false;

  for (const pid of pids) {
    if (!isPidAlive(pid)) continue;
    try {
      process.kill(pid, signal);
      signaled = true;
    } catch {
      return false;
    }
  }

  if (!signaled) return true;
  return waitForExit(pids, waitMs);
}

async function waitForExit(pids: number[], waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;

  while (Date.now() < deadline) {
    if (pids.every((pid) => !isPidAlive(pid))) return true;
    await sleep(POLL_INTERVAL_MS);
  }

  return pids.every((pid) => !isPidAlive(pid));
}

/**
 * stop 不应只看进程是否退出；只有监听端口也释放了，浏览器页面才会真正不可访问。
 */
async function waitForRuntimeRelease(pids: number[], ports: number[], waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;

  while (Date.now() < deadline) {
    if (pids.every((pid) => !isPidAlive(pid)) && (await arePortsFree(ports))) {
      return true;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  return pids.every((pid) => !isPidAlive(pid)) && (await arePortsFree(ports));
}

async function arePortsFree(ports: number[]): Promise<boolean> {
  const results = await Promise.all(ports.map((port) => isPortFree(port)));
  return results.every(Boolean);
}

function isPortFree(port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port <= 0) return Promise.resolve(true);

  return new Promise((resolve, reject) => {
    const server = createNetServer();
    let settled = false;

    server.once('error', (error: NodeJS.ErrnoException) => {
      settled = true;
      if (error.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      reject(error);
    });

    server.listen(port, '127.0.0.1', () => {
      server.close((error) => {
        if (settled) return;
        settled = true;
        if (error) {
          reject(error);
          return;
        }
        resolve(true);
      });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function hasRuntimeRecord(repoRoot: string): Promise<boolean> {
  try {
    await access(runtimePath(repoRoot));
    return true;
  } catch {
    return false;
  }
}
