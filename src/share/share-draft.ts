/**
 * 分享反馈草稿存储：按分享快照与审阅者隔离浏览器草稿，并避免旧草稿覆盖内容不同的新链接。
 */
import { validateSharePayload, type MarkdownSharePayload, type ShareThread } from '../shared/share';

const DRAFT_VERSION = 2;
const DRAFT_KEY_PREFIX = 'diff-review-share-draft';
// 草稿超过 30 天自动删除
const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
// 最多保留最近使用的 20 份
const MAX_DRAFT_COUNT = 20;

type ShareDraft = {
  version: typeof DRAFT_VERSION;
  updatedAt: number;
  baseThreads: ShareThread[];
  currentThreads: ShareThread[];
};

type DraftStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;

export type RestoredShareDraft = {
  payload: MarkdownSharePayload;
  restored: boolean;
};

/**
 * 仅恢复从同一份原始分享链接产生的草稿，防止同快照的新反馈链接被旧浏览器状态覆盖。
 */
export function restoreShareDraft(
  payload: MarkdownSharePayload,
  reviewerId: string,
  storage: DraftStorage = window.localStorage,
  now = Date.now()
): RestoredShareDraft {
  const key = buildDraftKey(payload, reviewerId);
  try {
    cleanupShareDrafts(storage, now, key, false);
    const rawDraft = storage.getItem(key);
    if (!rawDraft) return { payload, restored: false };
    const draft = JSON.parse(rawDraft) as Partial<ShareDraft>;
    if (
      draft.version !== DRAFT_VERSION ||
      !Array.isArray(draft.baseThreads) ||
      !Array.isArray(draft.currentThreads) ||
      JSON.stringify(draft.baseThreads) !== JSON.stringify(payload.threads)
    ) {
      storage.removeItem(key);
      return { payload, restored: false };
    }
    const restoredPayload = validateSharePayload({ ...payload, threads: draft.currentThreads });
    try { storage.setItem(key, JSON.stringify({ ...draft, updatedAt: now })); } catch { /* The valid draft remains usable when touching it fails. */ }
    return {
      payload: restoredPayload,
      restored: true
    };
  } catch {
    try { storage.removeItem(key); } catch { /* Storage may be unavailable in private contexts. */ }
    return { payload, restored: false };
  }
}

/**
 * 保存评论变更后的完整线程状态，同时保留原始线程用于下次打开时校验草稿来源。
 */
export function saveShareDraft(
  basePayload: MarkdownSharePayload,
  currentPayload: MarkdownSharePayload,
  reviewerId: string,
  storage: DraftStorage = window.localStorage,
  now = Date.now()
): boolean {
  const draft: ShareDraft = {
    version: DRAFT_VERSION,
    updatedAt: now,
    baseThreads: basePayload.threads,
    currentThreads: currentPayload.threads
  };
  try {
    const key = buildDraftKey(basePayload, reviewerId);
    cleanupShareDrafts(storage, now, key, true);
    storage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

function buildDraftKey(payload: MarkdownSharePayload, reviewerId: string): string {
  return `${DRAFT_KEY_PREFIX}:${payload.shareId}:${payload.contentHash}:${reviewerId}`;
}

/**
 * 清除过期、损坏及超出数量限制的草稿；保存新草稿时提前预留一个位置。
 */
function cleanupShareDrafts(
  storage: DraftStorage,
  now: number,
  preservedKey: string,
  reserveSlot: boolean
): void {
  const storedKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(`${DRAFT_KEY_PREFIX}:`)));
  const validDrafts: Array<{ key: string; updatedAt: number }> = [];

  for (const key of storedKeys) {
    try {
      const rawDraft = storage.getItem(key);
      const draft = rawDraft ? JSON.parse(rawDraft) as Partial<ShareDraft> : null;
      if (
        draft?.version !== DRAFT_VERSION ||
        typeof draft.updatedAt !== 'number' ||
        !Number.isFinite(draft.updatedAt) ||
        now - draft.updatedAt > DRAFT_RETENTION_MS
      ) {
        storage.removeItem(key);
        continue;
      }
      validDrafts.push({ key, updatedAt: draft.updatedAt });
    } catch {
      storage.removeItem(key);
    }
  }

  const preservedDraft = validDrafts.find((draft) => draft.key === preservedKey);
  const otherDrafts = validDrafts
    .filter((draft) => draft.key !== preservedKey)
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const otherDraftLimit = preservedDraft || reserveSlot ? MAX_DRAFT_COUNT - 1 : MAX_DRAFT_COUNT;
  for (const draft of otherDrafts.slice(otherDraftLimit)) storage.removeItem(draft.key);
}
