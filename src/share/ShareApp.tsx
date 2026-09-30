/**
 * 静态 Markdown 分享门户：从 URL Fragment 恢复快照，在浏览器内维护审阅者评论并生成反馈链接。
 */
import React from 'react';
import { Alert, App as AntApp, Button, Input, Modal, Space, Typography } from 'antd';
import { CopyOutlined, MessageOutlined, UserOutlined } from '@ant-design/icons';
import type { CommentAnchor, DiffFile, ReviewThread } from '../shared/types';
import { buildShareUrl, parseShareUrl, type MarkdownSharePayload, type ShareComment, type ShareThread } from '../shared/share';
import { sameAnchor } from '../shared/thread-utils';
import { buildMarkdownBlocks } from '../core/markdown-source-map';
import { MarkdownPreviewPanel } from '../web/components/MarkdownPreviewPanel';
import { ThreadList } from '../web/components/ThreadList';
import {
  ReviewActionsProvider,
  ReviewNavigationActionsProvider,
  type ReviewActions
} from '../web/contexts/ReviewActionsContext';
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
  const [globalCommentOpen, setGlobalCommentOpen] = React.useState(false);
  const [globalComment, setGlobalComment] = React.useState('');
  const [copying, setCopying] = React.useState(false);
  const [copyError, setCopyError] = React.useState('');

  React.useEffect(() => {
    parseShareUrl(window.location.href)
      .then(setPayload)
      .catch((error) => setLoadError(error instanceof Error ? error.message : '分享链接无法读取'));
  }, []);

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
  }) : null, [payload]);
  const threads = React.useMemo(() => payload ? toReviewThreads(payload, reviewerId) : [], [payload, reviewerId]);

  const updateThreads = React.useCallback((updater: (threads: ShareThread[]) => ShareThread[]) => {
    setPayload((current) => current ? { ...current, threads: updater(current.threads) } : current);
    setCopyError('');
  }, []);

  const addComment = React.useCallback((anchor: CommentAnchor, body: string) => {
    if (anchor.type !== 'file' && anchor.type !== 'markdown-line') return Promise.reject(new Error('共享预览仅支持块级评论'));
    const comment = createReviewerComment(body, reviewerName, reviewerId, payload?.shareId ?? '');
    updateThreads((current) => {
      const existing = current.find((thread) => sameAnchor(thread.anchor, anchor));
      if (existing) {
        return current.map((thread) => thread.id === existing.id ? { ...thread, comments: [...thread.comments, comment] } : thread);
      }
      return [...current, { id: crypto.randomUUID(), anchor, comments: [comment] }];
    });
    return Promise.resolve();
  }, [payload?.shareId, reviewerId, reviewerName, updateThreads]);

  const actions = React.useMemo<ReviewActions>(() => ({
    createThread: addComment,
    patchThread: async () => undefined,
    deleteThread: async (id) => {
      updateThreads((current) => current.filter((thread) => (
        thread.id !== id || !thread.comments.every((comment) => comment.reviewerId === reviewerId)
      )));
    },
    replyThread: async (id, body) => {
      const comment = createReviewerComment(body, reviewerName, reviewerId, payload?.shareId ?? '');
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
  }), [addComment, payload, reviewerId, reviewerName, updateThreads]);

  async function copyFeedbackLink() {
    if (!payload) return;
    setCopying(true);
    try {
      const url = await buildShareUrl(window.location.href.split('#')[0], payload);
      await navigator.clipboard.writeText(url);
      setCopyError('');
      message.success('反馈链接已复制，请发送给发起者');
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : '反馈链接生成失败');
    } finally {
      setCopying(false);
    }
  }

  if (loadError) return <main className={styles.errorPage}><Alert message="无法打开分享预览" description={loadError} type="error" showIcon /></main>;
  if (!payload || !file) return <main className={styles.loading}>正在展开文档快照…</main>;

  const preview = {
    filePath: payload.filePath,
    content: payload.markdown,
    deleted: false,
    blocks: buildMarkdownBlocks(payload.markdown)
  };

  return (
    <ReviewActionsProvider value={actions}>
      <ReviewNavigationActionsProvider value={{ locateThread: () => undefined }}>
        <div className={styles.page}>
          <header className={styles.header}>
            <div>
              <Typography.Text className={styles.eyebrow}>SHARED MARKDOWN REVIEW</Typography.Text>
              <Typography.Title level={2} className={styles.title}>{payload.title}</Typography.Title>
              <Typography.Text className={styles.path}>{payload.filePath}</Typography.Text>
            </div>
            <Space wrap>
              <Button icon={<UserOutlined />} onClick={() => { setNameDraft(reviewerName); setReviewerName(''); }}>
                {reviewerName || '设置昵称'}
              </Button>
              <Button icon={<MessageOutlined />} onClick={() => setGlobalCommentOpen(true)}>整体评论</Button>
              <Button type="primary" icon={<CopyOutlined />} loading={copying} onClick={() => { copyFeedbackLink().catch(() => undefined); }}>
                复制反馈链接
              </Button>
            </Space>
          </header>
          {copyError ? <Alert className={styles.notice} message={copyError} type="warning" showIcon /> : null}
          <div className={styles.contentGrid}>
            <section className={styles.documentPane}>
              <MarkdownPreviewPanel
                file={file}
                threads={threads}
                locateTarget={null}
                previewData={preview}
                remoteAssetsOnly
              />
            </section>
            <aside className={styles.commentRail}>
              <div className={styles.commentRailHeader}>
                <Typography.Title level={4}>评论线索</Typography.Title>
                <Typography.Text type="secondary">{threads.length} 个位置</Typography.Text>
              </div>
              <ThreadList threads={threads} currentFiles={[file]} currentFilePath={file.path} focusedThreadId={null} />
            </aside>
          </div>
          <Modal
            open={!reviewerName}
            title="留下你的署名"
            okText="进入审阅"
            cancelButtonProps={{ style: { display: 'none' } }}
            closable={false}
            keyboard={false}
            maskClosable={false}
            okButtonProps={{ disabled: !nameDraft.trim() }}
            onOk={() => {
              const name = nameDraft.trim().slice(0, 100);
              writeStorage(NAME_KEY, name);
              setReviewerName(name);
            }}
          >
            <Typography.Paragraph type="secondary">昵称会随评论写入反馈链接，无需注册账号。</Typography.Paragraph>
            <Input autoFocus maxLength={100} placeholder="例如：小李" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} />
          </Modal>
          <Modal
            open={globalCommentOpen}
            title="添加整体评论"
            okText="添加评论"
            cancelText="取消"
            okButtonProps={{ disabled: !globalComment.trim() }}
            onCancel={() => setGlobalCommentOpen(false)}
            onOk={() => {
              addComment({ type: 'file', filePath: payload.filePath }, globalComment.trim())
                .then(() => { setGlobalComment(''); setGlobalCommentOpen(false); });
            }}
          >
            <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} value={globalComment} onChange={(event) => setGlobalComment(event.target.value)} />
          </Modal>
        </div>
      </ReviewNavigationActionsProvider>
    </ReviewActionsProvider>
  );
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
    status: 'submit',
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
