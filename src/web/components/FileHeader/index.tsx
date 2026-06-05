/**
 * 文件头区域：展示文件信息并提供文件级评论、文件提示词复制等操作。
 */
import React from 'react';
import { Button, Card, Tag, Tooltip, Typography, message } from 'antd';
import { MessageOutlined, CopyOutlined, ArrowsAltOutlined, ShrinkOutlined } from '@ant-design/icons';
import type { CommentAnchor, DiffFile, ReviewThread } from '../../../shared/types';
import { CommentComposer } from '../CommentComposer';
import { InlineThreadGroup } from '../InlineThreadGroup';
import styles from './index.module.less';

type Props = {
  file: DiffFile;
  threads: ReviewThread[];
  showToggleAllLines: boolean;
  hasExpandedContext: boolean;
  onCreate: (anchor: CommentAnchor, body: string) => Promise<void>;
  onCopy: (scope: { type: 'file-unresolved'; filePath: string }) => Promise<void>;
  onToggleAllLines: (filePath: string) => void;
  onLocateThread: (threadId: string) => void;
  onPatchThread: (id: string, status: ReviewThread['status']) => Promise<void>;
  onDeleteThread: (id: string) => Promise<void>;
  onReplyThread: (id: string, body: string) => Promise<void>;
  onPatchComment: (threadId: string, commentId: string, body: string) => Promise<void>;
  onCopyThread: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
};

export function FileHeader({
  file,
  threads,
  showToggleAllLines,
  hasExpandedContext,
  onCreate,
  onCopy,
  onToggleAllLines,
  onLocateThread,
  onPatchThread,
  onDeleteThread,
  onReplyThread,
  onPatchComment,
  onCopyThread
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const toggleTooltip = hasExpandedContext ? '隐藏当前文件未改动行' : '展开当前文件所有未改动行';
  const toggleAriaLabel = hasExpandedContext ? '隐藏当前文件未改动行' : '展开当前文件所有未改动行';
  // 文件头部只展示当前文件的线程数量，便于快速判断讨论密度。
  const fileThreads = threads.filter((thread) => thread.filePath === file.path && thread.status !== 'resolved');
  const fileLevelThreads = threads.filter((thread) => thread.filePath === file.path && thread.anchor.type === 'file');

  async function copyFilePath() {
    await navigator.clipboard.writeText(file.path);
    void messageApi.success('完整文件路径已复制到剪贴板');
  }

  return (
    <Card className={styles.fileHeader}>
      {contextHolder}
      <div className={styles.headerTop}>
        <div className={styles.filePathBlock}>
          {showToggleAllLines ? (
            <Tooltip title={toggleTooltip}>
              <Button
                className={styles.fileExpandBtn}
                type="text"
                icon={hasExpandedContext ? <ShrinkOutlined /> : <ArrowsAltOutlined />}
                aria-label={toggleAriaLabel}
                onClick={() => onToggleAllLines(file.path)}
              />
            </Tooltip>
          ) : null}
          <Typography.Text strong className={styles.filePathText}>{file.path}</Typography.Text>
          <Button
            className={styles.filePathCopyBtn}
            type="text"
            icon={<CopyOutlined />}
            aria-label="复制完整文件路径"
            onClick={() => void copyFilePath()}
          />
        </div>
        <div className={styles.headerActions}>
          <Button disabled={fileThreads.length === 0} type='primary' className={styles.headerAction} icon={<CopyOutlined />} onClick={() => void onCopy({ type: 'file-unresolved', filePath: file.path })}>
            批量提交当前文件的review
          </Button>
          <Button className={styles.headerAction} icon={<MessageOutlined />} type={open ? 'primary' : 'default'} onClick={() => setOpen((value) => !value)}>
            文件级评论
          </Button>
        </div>
      </div>
      {open ? (
        <CommentComposer
          style={{ marginTop: 16 }}
          placeholder="请输入文件级审查评论..."
          onSubmit={async (body) => {
            await onCreate({ type: 'file', filePath: file.path }, body);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      ) : null}
      {fileThreads.length > 0 ? (
        <Tag className={styles.threadCount} color="gold">
          {fileThreads.length} 个评论线程
        </Tag>
      ) : null}
      {fileLevelThreads.length > 0 ? (
        <div className={styles.fileLevelInlineThreads}>
          <InlineThreadGroup
            threads={fileLevelThreads}
            variant="fileLevel"
            onFocus={onLocateThread}
            onPatch={onPatchThread}
            onDeleteThread={onDeleteThread}
            onReply={onReplyThread}
            onPatchComment={onPatchComment}
            onCopy={onCopyThread}
          />
        </div>
      ) : null}
    </Card>
  );
}
