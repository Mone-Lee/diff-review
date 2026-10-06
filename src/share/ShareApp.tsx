/**
 * 静态 Markdown 分享门户：从 URL Fragment 恢复快照，在浏览器内维护审阅者评论并生成反馈链接。
 */
import React from 'react';
import { Alert, App as AntApp, Button, Input, Modal, Space, Typography } from 'antd';
import { CopyOutlined, DownloadOutlined, UserOutlined } from '@ant-design/icons';
import type { CommentAnchor, DiffFile, MarkdownPreview, ReviewThread } from '../shared/types';
import {
  buildShareUrl,
  getShareUrlCapacity,
  parseShareUrl,
  type MarkdownSharePayload,
  type ShareComment,
  type ShareThread,
  type ShareUrlCapacity
} from '../shared/share';
import { sameAnchor } from '../shared/thread-utils';
import { buildMarkdownBlocks } from '../core/markdown-source-map';
import { FileHeader } from '../web/components/FileHeader';
import { MarkdownPreviewPanel } from '../web/components/MarkdownPreviewPanel';
import { MarkdownReviewWorkspace } from '../web/components/MarkdownReviewWorkspace';
import { ThreadList } from '../web/components/ThreadList';
import {
  ReviewActionsProvider,
  ReviewNavigationActionsProvider,
  type LocateTarget,
  type ReviewActions
} from '../web/contexts/ReviewActionsContext';
import { restoreShareDraft, saveShareDraft } from './share-draft';
import styles from './share.module.less';

const NAME_KEY = 'diff-review-share-reviewer-name';
const ID_KEY = 'diff-review-share-reviewer-id';

export default function ShareApp() {
  const { message } = AntApp.useApp();
  const [payload, setPayload] = React.useState<MarkdownSharePayload | null>(null);
  const [loadError, setLoadError] = React.useState('');
  const [reviewerId] = React.useState(readReviewerId);
  const [reviewerName, setReviewerName] = React.useState(() => readStorage(NAME_KEY));
  const [nameDraft, setNameDraft] = React.useState(() => readStorage(NAME_KEY));
  const [nameDialogOpen, setNameDialogOpen] = React.useState(false);
  const [nameRequired, setNameRequired] = React.useState(false);
  const [copying, setCopying] = React.useState(false);
  const [copyError, setCopyError] = React.useState('');
  const [feedbackLink, setFeedbackLink] = React.useState('');
  const [feedbackDialogOpen, setFeedbackDialogOpen] = React.useState(false);
  const [feedbackCapacity, setFeedbackCapacity] = React.useState<ShareUrlCapacity | null>(null);
  const [draftStatus, setDraftStatus] = React.useState<'idle' | 'restored' | 'saved' | 'error'>('idle');
  const [locateTarget, setLocateTarget] = React.useState<LocateTarget | null>(null);
  const [focusedThreadId, setFocusedThreadId] = React.useState<string | null>(null);
  const payloadRef = React.useRef<MarkdownSharePayload | null>(null);
  const basePayloadRef = React.useRef<MarkdownSharePayload | null>(null);
  const nameRequestResolverRef = React.useRef<((name: string) => void) | null>(null);

  React.useEffect(() => {
    parseShareUrl(window.location.href)
      .then((parsedPayload) => {
        const restoredDraft = restoreShareDraft(parsedPayload, reviewerId);
        basePayloadRef.current = parsedPayload;
        payloadRef.current = restoredDraft.payload;
        setPayload(restoredDraft.payload);
        setDraftStatus(restoredDraft.restored ? 'restored' : 'idle');
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : '分享链接无法读取'));
  }, [reviewerId]);

  React.useEffect(() => {
    if (!payload) return;
    let active = true;
    setFeedbackLink('');
    setFeedbackCapacity(null);
    buildShareUrl(window.location.href, payload)
      .then((url) => {
        if (!active) return;
        setFeedbackLink(url);
        setFeedbackCapacity(getShareUrlCapacity(url));
        setCopyError('');
      })
      .catch((error) => {
        if (!active) return;
        setCopyError(error instanceof Error ? error.message : '反馈链接生成失败');
      });
    return () => { active = false; };
  }, [payload]);

  // 按正文内容缓存 preview，避免评论、昵称及复制状态变化时重复执行 buildMarkdownBlocks
  const file = React.useMemo<DiffFile | null>(() => payload ? ({
    oldPath: '/dev/null',
    newPath: payload.filePath,
    path: payload.filePath,
    snapshotHash: payload.contentHash,
    status: 'added',
    additions: payload.markdown.split(/\r?\n/).length,
    deletions: 0,
    isMarkdown: true,
    hunks: []
  }) : null, [payload?.contentHash, payload?.filePath, payload?.markdown]);

  const preview = React.useMemo<MarkdownPreview | null>(() => payload ? ({
    filePath: payload.filePath,
    content: payload.markdown,
    deleted: false,
    blocks: buildMarkdownBlocks(payload.markdown)
  }) : null, [payload?.filePath, payload?.markdown]);

  const threads = React.useMemo(() => payload ? toReviewThreads(payload, reviewerId) : [], [payload, reviewerId]);
  const navigationActions = React.useMemo(() => ({
    locateThread: (threadId: string) => {
      const target = threads.find((thread) => thread.id === threadId);
      if (!target) return;
      setLocateTarget({ threadId, anchor: target.anchor });
      setFocusedThreadId(threadId);
    }
  }), [threads]);

  const updateThreads = React.useCallback((updater: (threads: ShareThread[]) => ShareThread[]) => {
    const current = payloadRef.current;
    const basePayload = basePayloadRef.current;
    if (!current || !basePayload) return;
    const nextPayload = { ...current, threads: updater(current.threads) };
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
    setDraftStatus(saveShareDraft(basePayload, nextPayload, reviewerId) ? 'saved' : 'error');
    setCopyError('');
  }, [reviewerId]);

  // 首次提交评论时暂停写入，待审阅者补充昵称后继续同一次提交，避免清空已输入的正文。
  const requestReviewerName = React.useCallback(() => {
    if (reviewerName) return Promise.resolve(reviewerName);
    setNameDraft('');
    setNameRequired(true);
    setNameDialogOpen(true);
    return new Promise<string>((resolve) => {
      nameRequestResolverRef.current = resolve;
    });
  }, [reviewerName]);

  const addComment = React.useCallback((anchor: CommentAnchor, body: string) => {
    if (anchor.type !== 'file' && anchor.type !== 'markdown-line' && anchor.type !== 'markdown-selection') {
      return Promise.reject(new Error('共享预览不支持该评论位置'));
    }
    return requestReviewerName().then((authorName) => {
      const comment = createReviewerComment(body, authorName, reviewerId, payload?.shareId ?? '');
      updateThreads((current) => {
        const existing = current.find((thread) => sameAnchor(thread.anchor, anchor));
        if (existing) {
          return current.map((thread) => thread.id === existing.id ? { ...thread, comments: [...thread.comments, comment] } : thread);
        }
        return [...current, { id: crypto.randomUUID(), status: 'submit', anchor, comments: [comment] }];
      });
    });
  }, [payload?.shareId, requestReviewerName, reviewerId, updateThreads]);

  const actions = React.useMemo<ReviewActions>(() => ({
    createThread: addComment,
    patchThread: async () => undefined,
    deleteThread: async (id) => {
      updateThreads((current) => current.filter((thread) => (
        thread.id !== id || !thread.comments.every((comment) => comment.reviewerId === reviewerId)
      )));
    },
    deleteComment: async (threadId, commentId) => {
      updateThreads((current) => current.flatMap((thread) => {
        if (thread.id !== threadId) return [thread];
        const comments = thread.comments.filter((comment) => (
          comment.id !== commentId || comment.reviewerId !== reviewerId
        ));
        return comments.length > 0 ? [{ ...thread, comments }] : [];
      }));
    },
    replyThread: async (id, body) => {
      const authorName = await requestReviewerName();
      const comment = createReviewerComment(body, authorName, reviewerId, payload?.shareId ?? '');
      updateThreads((current) => current.map((thread) => (
        thread.id === id ? { ...thread, comments: [...thread.comments, comment] } : thread
      )));
    },
    patchComment: async (threadId, commentId, body) => {
      updateThreads((current) => current.map((thread) => thread.id === threadId ? {
        ...thread,
        comments: thread.comments.map((comment) => (
          comment.id === commentId && comment.reviewerId === reviewerId ? { ...comment, body: body.trim() } : comment
        ))
      } : thread));
    },
    copyPrompt: async (scope) => {
      if (scope.type !== 'thread') return;
      const { threadId } = scope;
      const thread = payload?.threads.find((item) => item.id === threadId);
      if (!thread) return;
      await navigator.clipboard.writeText(thread.comments.map((comment) => `${comment.authorName}: ${comment.body}`).join('\n'));
    }
  }), [addComment, payload, requestReviewerName, reviewerId, updateThreads]);

  async function copyFeedbackLink() {
    if (!feedbackLink) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(feedbackLink);
      setCopyError('');
      setFeedbackDialogOpen(false);
      message.success('反馈链接已复制，请发送给发起者');
    } catch {
      setCopyError('无法访问剪贴板，请手动复制或下载反馈链接');
      setFeedbackDialogOpen(true);
    } finally {
      setCopying(false);
    }
  }

  // 将完整反馈链接保存为文本文件，为剪贴板不可用的浏览器提供可传递的导出结果。
  function downloadFeedbackLink() {
    if (!feedbackLink) return;
    const objectUrl = URL.createObjectURL(new Blob([feedbackLink], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = 'diff-review-feedback.txt';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    setCopyError('');
    setFeedbackDialogOpen(false);
    message.success('反馈链接文件已下载，请发送给发起者');
  }

  // 保存昵称并同步当前审阅者的已有评论；首次署名时继续此前暂停的评论提交。
  function saveReviewerName() {
    const name = nameDraft.trim().slice(0, 100);
    if (!name) return;
    writeStorage(NAME_KEY, name);
    if (reviewerName !== name) {
      updateThreads((current) => current.map((thread) => ({
        ...thread,
        comments: thread.comments.map((comment) => (
          comment.source === 'reviewer' && comment.reviewerId === reviewerId
            ? { ...comment, authorName: name }
            : comment
        ))
      })));
    }
    setReviewerName(name);
    setNameDialogOpen(false);
    setNameRequired(false);
    const resolveNameRequest = nameRequestResolverRef.current;
    nameRequestResolverRef.current = null;
    resolveNameRequest?.(name);
  }

  if (loadError) return <main className={styles.errorPage}><Alert message="无法打开分享预览" description={loadError} type="error" showIcon /></main>;
  if (!payload || !file || !preview) return <main className={styles.loading}>正在展开文档快照…</main>;

  return (
    <ReviewActionsProvider value={actions}>
      <ReviewNavigationActionsProvider value={navigationActions}>
        <>
          <MarkdownReviewWorkspace
            title={payload.title}
            subtitle={`Shared Markdown · ${payload.filePath}`}
            commentCount={threads.length}
            fullWidthHeader
            actions={(
              <Space wrap>
                {draftStatus === 'restored' || draftStatus === 'saved' ? (
                  <Typography.Text type="secondary">反馈草稿已保存在此浏览器</Typography.Text>
                ) : null}
                {draftStatus === 'error' ? (
                  <Typography.Text type="danger">反馈草稿未能保存，请及时导出</Typography.Text>
                ) : null}
                {feedbackCapacity ? (
                  <Typography.Text type={feedbackCapacity.remainingBytes < 4 * 1024 ? 'warning' : 'secondary'}>
                    反馈链接已用 {formatKiB(feedbackCapacity.usedBytes)}，剩余 {formatKiB(feedbackCapacity.remainingBytes)}
                  </Typography.Text>
                ) : null}
                <Button icon={<UserOutlined />} onClick={() => {
                  setNameDraft(reviewerName);
                  setNameRequired(false);
                  setNameDialogOpen(true);
                }}>
                  {reviewerName || '设置昵称'}
                </Button>
                <Button
                  type="primary"
                  icon={<CopyOutlined />}
                  loading={copying}
                  disabled={!feedbackLink}
                  onClick={() => { copyFeedbackLink().catch(() => undefined); }}
                >
                  导出反馈链接
                </Button>
              </Space>
            )}
            document={(
              <>
                {copyError ? <Alert className={styles.notice} message={copyError} type="warning" showIcon /> : null}
                <FileHeader file={file} threads={threads} simple interactionMode="shared-reviewer" />
                <MarkdownPreviewPanel
                  file={file}
                  threads={threads}
                  locateTarget={locateTarget}
                  previewData={preview}
                  remoteAssetsOnly
                  preserveUrlFragment
                  interactionMode="shared-reviewer"
                />
              </>
            )}
            comments={(
              <ThreadList
                threads={threads}
                currentFiles={[file]}
                currentFilePath={file.path}
                focusedThreadId={focusedThreadId}
                focusRequest={locateTarget}
                simple
                interactionMode="shared-reviewer"
              />
            )}
          />
          <Modal
            open={feedbackDialogOpen}
            title="手动导出反馈"
            footer={<Button onClick={() => setFeedbackDialogOpen(false)}>关闭</Button>}
            onCancel={() => setFeedbackDialogOpen(false)}
          >
            <Alert message="浏览器未能写入剪贴板，请使用下方任一方式导出。" type="warning" showIcon />
            <div className={styles.feedbackLinkField}>
              <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} readOnly value={feedbackLink} />
              <Space>
                <Button icon={<CopyOutlined />} loading={copying} onClick={() => { copyFeedbackLink().catch(() => undefined); }}>
                  再次复制
                </Button>
                <Button type="primary" icon={<DownloadOutlined />} onClick={downloadFeedbackLink}>
                  下载链接文件
                </Button>
              </Space>
            </div>
          </Modal>
          <Modal
            open={nameDialogOpen}
            title="留下你的署名"
            okText={nameRequired ? '保存并提交评论' : '保存'}
            cancelText="取消"
            cancelButtonProps={nameRequired ? { style: { display: 'none' } } : undefined}
            closable={!nameRequired}
            keyboard={!nameRequired}
            maskClosable={!nameRequired}
            okButtonProps={{ disabled: !nameDraft.trim() }}
            onCancel={() => setNameDialogOpen(false)}
            onOk={saveReviewerName}
          >
            <Typography.Paragraph type="secondary">
              {nameRequired ? '提交评论前请留下昵称，当前评论会在保存后继续提交。' : '昵称会随评论写入反馈链接，无需注册账号。'}
            </Typography.Paragraph>
            <Input autoFocus maxLength={100} placeholder="例如：小李" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} />
          </Modal>
        </>
      </ReviewNavigationActionsProvider>
    </ReviewActionsProvider>
  );
}

function formatKiB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function createReviewerComment(body: string, authorName: string, reviewerId: string, shareId: string): ShareComment {
  return {
    id: crypto.randomUUID(),
    body: body.trim(),
    authorName,
    createdAt: new Date().toISOString(),
    source: 'reviewer',
    reviewerId,
    originShareId: shareId
  };
}

function toReviewThreads(payload: MarkdownSharePayload, reviewerId: string): ReviewThread[] {
  return payload.threads.map((thread) => ({
    id: thread.id,
    filePath: payload.filePath,
    anchor: thread.anchor,
    diffHash: payload.contentHash,
    fileSnapshotHash: payload.contentHash,
    status: thread.status,
    comments: thread.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      author: comment.source === 'reviewer' && comment.reviewerId === reviewerId ? 'user' : 'reviewer',
      authorName: comment.authorName,
      createdAt: comment.createdAt,
      updatedAt: comment.createdAt
    })),
    createdAt: thread.comments[0]?.createdAt ?? new Date().toISOString(),
    updatedAt: thread.comments.at(-1)?.createdAt ?? new Date().toISOString()
  }));
}

function readReviewerId(): string {
  const existing = readStorage(ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  writeStorage(ID_KEY, id);
  return id;
}

function readStorage(key: string): string {
  try { return window.localStorage.getItem(key) ?? ''; } catch { return ''; }
}

function writeStorage(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Storage may be unavailable in private contexts. */ }
}
