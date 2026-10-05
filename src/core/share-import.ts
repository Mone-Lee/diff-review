/**
 * 分享反馈导入：校验 Markdown 快照，并将新增或修改过的审阅者评论合并进本地线程存储。
 */
import type { DiffFile, ReviewThread } from '../shared/types';
import type { MarkdownSharePayload } from '../shared/share';
import { anchorKey } from '../shared/thread-utils';

export type ShareImportStore = { threads: ReviewThread[] };

type ImportedCommentLocation = {
  thread: ReviewThread;
  comment: ReviewThread['comments'][number];
};

// 将反馈来源的三元组编码为稳定索引键，避免评论或审阅者 ID 之间发生字符串拼接歧义。
function getShareOriginKey(shareId: string, commentId: string, reviewerId: string) {
  return JSON.stringify([shareId, commentId, reviewerId]);
}

// 校验反馈所属快照并合并审阅者评论；导入过程通过预建索引避免为每条评论重复扫描全部线程。
export function importShareFeedback(
  store: ShareImportStore,
  payload: MarkdownSharePayload,
  file: DiffFile,
  currentContent: string,
  contentHash: string,
  diffHash: string
): { imported: number; updated: number; skipped: number } {
  if (payload.filePath !== file.path || payload.contentHash !== contentHash || payload.markdown !== currentContent) {
    throw new Error('SHARE_SNAPSHOT_MISMATCH');
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  // 按“文件快照 + 锚点”定位目标线程，用于定位合并目标线程
  const threadsByAnchor = new Map<string, ReviewThread>();
  // 按“分享来源”定位已有评论，用于反馈去重和内容更新
  const commentsByOrigin = new Map<string, ImportedCommentLocation>();

  for (const thread of store.threads) {
    if (thread.fileSnapshotHash === file.snapshotHash) {
      const key = anchorKey(thread.anchor);
      if (!threadsByAnchor.has(key)) threadsByAnchor.set(key, thread);
    }
    for (const comment of thread.comments) {
      if (!comment.shareOrigin) continue;
      const key = getShareOriginKey(
        comment.shareOrigin.shareId,
        comment.shareOrigin.commentId,
        comment.shareOrigin.reviewerId
      );
      if (!commentsByOrigin.has(key)) commentsByOrigin.set(key, { thread, comment });
    }
  }

  for (const sharedThread of payload.threads) {
    const sharedAnchorKey = anchorKey(sharedThread.anchor);
    let targetThread = threadsByAnchor.get(sharedAnchorKey);
    for (const sharedComment of sharedThread.comments) {
      if (sharedComment.source !== 'reviewer') continue;
      const originShareId = sharedComment.originShareId ?? payload.shareId;
      const originKey = getShareOriginKey(originShareId, sharedComment.id, sharedComment.reviewerId!);
      const existing = commentsByOrigin.get(originKey);
      if (existing) {
        if (existing.comment.body === sharedComment.body && existing.comment.authorName === sharedComment.authorName) {
          skipped += 1;
          continue;
        }
        existing.comment.body = sharedComment.body;
        existing.comment.authorName = sharedComment.authorName;
        existing.comment.updatedAt = now;
        existing.thread.updatedAt = now;
        updated += 1;
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
        // 同一份反馈中后续出现相同锚点时，应直接复用刚创建的线程，保证同批反馈也能正确去重。
        threadsByAnchor.set(sharedAnchorKey, targetThread);
      }
      const importedComment: ReviewThread['comments'][number] = {
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
      };
      targetThread.comments.push(importedComment);
      // 立即登记新评论，使同一批次内重复出现的来源也能走跳过或更新逻辑。
      commentsByOrigin.set(originKey, { thread: targetThread, comment: importedComment });
      targetThread.updatedAt = now;
      imported += 1;
    }
  }
  return { imported, updated, skipped };
}
