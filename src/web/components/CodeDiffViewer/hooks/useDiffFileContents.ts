/**
 * Diff 文件内容加载 Hook：负责按文件路径和快照拉取原始内容，并处理切换过程中的中断与失效结果。
 */
import React from 'react';
import { fetchDiffFileContents } from '../../../api/content';
import type { FileContents } from '../types';

// 按文件路径和当前 diff 快照拉取原始文件内容，避免同一路径内容更新后继续复用旧结果。
export function useDiffFileContents(filePath: string, snapshotHash: string) {
  const [fileContents, setFileContents] = React.useState<FileContents | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setFileContents(null);

    async function loadFileContents() {
      try {
        const data = await fetchDiffFileContents(filePath, controller.signal);
        if (!cancelled) {
          setFileContents(data);
        }
      } catch {
        if (!cancelled) {
          setFileContents(null);
        }
      }
    }

    loadFileContents().catch(() => undefined);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filePath, snapshotHash]);

  return fileContents;
}
