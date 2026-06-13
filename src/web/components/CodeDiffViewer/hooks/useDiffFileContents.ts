import React from 'react';
import { fetchDiffFileContents } from '../../../api/content';
import type { FileContents } from '../types';

// 按文件路径拉取 diff 对应的原始文件内容；文件切换时会重置并取消上一次请求。
export function useDiffFileContents(filePath: string) {
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

    void loadFileContents();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filePath]);

  return fileContents;
}
