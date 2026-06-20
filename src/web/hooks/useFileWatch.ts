/**
 * 文件监听 Hook：负责订阅服务端 SSE 变更通知，并把“当前是否存在待刷新变更”
 * 收敛成前端可直接消费的状态。
 */
import React from 'react';
import { createReviewWatchEventSource, type ReviewWatchEvent } from '../api/review';

export function useFileWatch() {
  const [hasPendingChanges, setHasPendingChanges] = React.useState(false);
  const [lastChangedAt, setLastChangedAt] = React.useState<string | null>(null);

  React.useEffect(() => {
    const source = createReviewWatchEventSource();

    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as ReviewWatchEvent;
      if (payload.type === 'change') {
        setHasPendingChanges(true);
        setLastChangedAt(payload.changedAt);
        return;
      }

      if (payload.type === 'connected') {
        setHasPendingChanges(payload.hasPendingChanges);
        if (!payload.hasPendingChanges) {
          setLastChangedAt(null);
        }
        return;
      }

      setHasPendingChanges(false);
      setLastChangedAt(null);
    };

    source.onerror = () => undefined;

    return () => {
      source.close();
    };
  }, []);

  return {
    hasPendingChanges,
    lastChangedAt,
    clearPendingChanges() {
      setHasPendingChanges(false);
    }
  };
}
