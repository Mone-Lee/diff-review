/**
 * 分享反馈导入：校验 Markdown 快照并将审阅者评论幂等合并进本地线程存储。
 */
import type { DiffFile, ReviewThread } from '../shared/types';
import type { MarkdownSharePayload } from '../shared/share';
import { sameAnchor } from '../shared/thread-utils';

export type ShareImportStore = { threads: ReviewThread[] };

export function importShareFeedback(
  store: ShareImportStore,
  payload: MarkdownSharePayload,
  file: DiffFile,
  currentContent: string,
  contentHash: string,
  diffHash: string
): { imported: number; skipped: number } {
  if (payload.filePath !== file.path || payload.contentHash !== contentHash || payload.markdown !== currentContent) {
    throw new Error('SHARE_SNAPSHOT_MISMATCH');
  }

  let imported = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  for (const sharedThread of payload.threads) {
    let targetThread = store.threads.find(
      (thread) => thread.fileSnapshotHash === file.snapshotHash && sameAnchor(thread.anchor, sharedThread.anchor)
    );
    for (const sharedComment of sharedThread.comments.filter((comment) => comment.source === 'reviewer')) {
      const originShareId = sharedComment.originShareId ?? payload.shareId;
      const duplicate = store.threads.some((thread) => thread.comments.some((comment) => (
        comment.shareOrigin?.shareId === originShareId && comment.shareOrigin.commentId === sharedComment.id
      )));
      if (duplicate) {
        skipped += 1;
        continue;
      }
      if (!targetThread) {
        targetThread = {
          id: crypto.randomUUID(),
          filePath: file.path,
          anchor: sharedThread.anchor,
          diffHash,
          fileSnapshotHash: file.snapshotHash,
          status: 'submit',
          comments: [],
          createdAt: sharedComment.createdAt,
          updatedAt: now
        };
        store.threads.push(targetThread);
      }
      targetThread.comments.push({
        id: crypto.randomUUID(),
        body: sharedComment.body,
        author: 'reviewer',
        authorName: sharedComment.authorName,
        shareOrigin: {
          shareId: originShareId,
          commentId: sharedComment.id,
          reviewerId: sharedComment.reviewerId!
        },
        createdAt: sharedComment.createdAt,
        updatedAt: now
      });
      targetThread.updatedAt = now;
      imported += 1;
    }
  }
  return { imported, skipped };
}
