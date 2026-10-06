/**
 * 文件头区域：共用文件信息与文件级评论；精简模式隐藏仅适用于本地审阅的批量提交和 Viewed 操作。
 */
import React from 'react';
import { Button, Card, Tag, Tooltip, Typography, message } from 'antd';
import { CheckOutlined, CopyOutlined, ArrowsAltOutlined, MessageOutlined, ShrinkOutlined } from '@ant-design/icons';
import type { DiffFile, ReviewThread } from '../../../shared/types';
import { CommentComposer } from '../CommentComposer';
import { InlineThreadGroup } from '../InlineThreadGroup';
import { useReviewActions } from '../../contexts/ReviewActionsContext';
import styles from './index.module.less';

type Props = {
  file: DiffFile;
  threads: ReviewThread[];
  simple?: boolean;
  interactionMode?: 'default' | 'shared-reviewer';
  isViewed?: boolean;
  showViewed?: boolean;
  showToggleAllLines?: boolean;
  hasExpandedContext?: boolean;
  onToggleAllLines?: (filePath: string) => void;
  onToggleViewed?: (filePath: string) => void;
};

export function FileHeader({
  file,
  threads,
  simple = false,
  interactionMode = 'default',
  isViewed,
  showViewed = true,
  showToggleAllLines,
  hasExpandedContext,
  onToggleAllLines,
  onToggleViewed
}: Props) {
  const { copyPrompt, createThread } = useReviewActions();
  const [open, setOpen] = React.useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const toggleTooltip = hasExpandedContext ? '隐藏当前文件未改动行' : '展开当前文件所有未改动行';
  const toggleAriaLabel = hasExpandedContext ? '隐藏当前文件未改动行' : '展开当前文件所有未改动行';
  const fileThreads = threads.filter((thread) => thread.filePath === file.path && thread.status !== 'resolved');
  const fileLevelThreads = threads.filter((thread) => thread.filePath === file.path && thread.anchor.type === 'file');

  // 复制完整文件路径，并给出轻量提示反馈。
  async function copyFilePath() {
    await navigator.clipboard.writeText(file.path);
    messageApi.success('完整文件路径已复制到剪贴板');
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
                onClick={() => onToggleAllLines?.(file.path)}
              />
            </Tooltip>
          ) : null}
          <Typography.Text strong className={styles.filePathText}>{file.path}</Typography.Text>
          <Button
            className={styles.filePathCopyBtn}
            type="text"
            icon={<CopyOutlined />}
            aria-label="复制完整文件路径"
            onClick={() => {
              copyFilePath().catch(() => undefined);
            }}
          />
        </div>
        <div className={styles.headerActions}>
          {!simple ? <Button
            disabled={fileThreads.length === 0}
            type='primary'
            className={styles.headerAction}
            icon={<CopyOutlined />}
            onClick={() => {
              copyPrompt({ type: 'file-unresolved', filePath: file.path }).catch(() => undefined);
            }}
          >
            批量提交当前文件的review
          </Button> : null}
          <Button className={styles.headerAction} icon={<MessageOutlined />} type={open ? 'primary' : 'default'} onClick={() => setOpen((value) => !value)}>
            文件级评论
          </Button>
          {!simple && showViewed ? <Tooltip title={isViewed ? "将文件标为待审查" : '将文件标为已审查'}>
            <Button
              className={`${styles.headerAction} ${styles.viewedButton} ${isViewed ? styles.viewedButtonActive : ''}`}
              icon={isViewed ? <CheckOutlined /> : <span className={styles.viewedButtonIcon} aria-hidden="true" />}
              onClick={() => onToggleViewed?.(file.path)}
            >
              Viewed
            </Button>
          </Tooltip> : null}
        </div>
      </div>
      {open ? (
        <CommentComposer
          style={{ marginTop: 16 }}
          placeholder="请输入文件级审查评论..."
          onSubmit={async (body) => {
            await createThread({ type: 'file', filePath: file.path }, body);
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
          <InlineThreadGroup threads={fileLevelThreads} variant="fileLevel" interactionMode={interactionMode} />
        </div>
      ) : null}
    </Card>
  );
}
