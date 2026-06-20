/**
 * 文件监听服务：负责监视仓库文件变化并通过 SSE 向前端广播“可刷新”的信号，
 * 只关心是否出现了新的工作区变化，不直接替换当前 review 快照。
 */
import { watch, type FSWatcher } from 'node:fs';
import type { Response } from 'express';
import type { ReviewWatchEvent } from '../shared/types';

export class FileWatcherService {
  private readonly clients = new Set<Response>();
  private readonly watchers: FSWatcher[] = [];
  private pendingChanges = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private readonly repoRoot: string) {
    this.startWatching();
  }

  /**
   * 注册一个 SSE 客户端，并立即同步当前是否存在待刷新的文件变化。
   */
  subscribe(res: Response) {
    this.clients.add(res);
    this.send(res, {
      type: 'connected',
      hasPendingChanges: this.pendingChanges
    });

    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  /**
   * 在 review 快照已经重算后清空待刷新状态，并通知前端恢复为最新快照。
   */
  clearPendingChanges() {
    if (!this.pendingChanges) return;
    this.pendingChanges = false;
    this.broadcast({ type: 'synced', hasPendingChanges: false });
  }

  /**
   * 释放底层文件监听资源，避免 runtime 退出后留下悬挂 watcher。
   */
  dispose() {
    this.closed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.watchers.splice(0).forEach((watcher) => watcher.close());
    this.clients.forEach((client) => client.end());
    this.clients.clear();
  }

  /**
   * 优先使用递归监听整个仓库；若运行环境不支持，则退化为监听仓库根和 `.git`。
   */
  private startWatching() {
    if (this.tryWatch(this.repoRoot, { recursive: true })) {
      return;
    }

    this.tryWatch(this.repoRoot);
    this.tryWatch(`${this.repoRoot}/.git`);
  }

  /**
   * 把短时间内的多次磁盘事件合并成一次“可刷新”通知，避免前端按钮频繁闪动。
   */
  private handleChange() {
    if (this.closed) return;
    this.pendingChanges = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.broadcast({
        type: 'change',
        hasPendingChanges: true,
        changedAt: new Date().toISOString()
      });
    }, 180);
  }

  private tryWatch(path: string, options?: { recursive?: boolean }) {
    try {
      const watcher = watch(path, options ?? {}, () => {
        this.handleChange();
      });
      this.watchers.push(watcher);
      return true;
    } catch {
      return false;
    }
  }

  private broadcast(event: ReviewWatchEvent) {
    this.clients.forEach((client) => {
      this.send(client, event);
    });
  }

  private send(res: Response, event: ReviewWatchEvent) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}
