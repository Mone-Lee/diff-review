/**
 * 文件头区域：展示文件信息并提供文件级评论、文件提示词复制等操作。
 */
import React from 'react';
import { Button, Card, Space, Tag, Typography } from 'antd';
import { CommentOutlined, CopyOutlined } from '@ant-design/icons';
import type { CommentAnchor, DiffFile, ReviewThread } from '../../shared/types';
import { CommentComposer } from './CommentComposer';
import styles from '../styles.module.less';

type Props = {
  file: DiffFile;
  threads: ReviewThread[];
  onCreate: (anchor: CommentAnchor, body: string) => Promise<void>;
  onCopy: (scope: { type: 'file-unresolved'; filePath: string }) => Promise<void>;
};

export function FileHeader({ file, threads, onCreate, onCopy }: Props) {
  const [open, setOpen] = React.useState(false);
  // 文件头部只展示当前文件的线程数量，便于快速判断讨论密度。
  const fileThreads = threads.filter((thread) => thread.filePath === file.path);

  return (
    <Card className={styles.fileHeader}>
      <div className={styles.headerTop}>
        <Typography.Text strong>{file.path}</Typography.Text>
        <div className={styles.headerActions}>
          <Button className={styles.headerAction} icon={<CopyOutlined />} onClick={() => void onCopy({ type: 'file-unresolved', filePath: file.path })}>
            复制文件级提示词
          </Button>
          <Button className={styles.headerAction} icon={<CommentOutlined />} type={open ? 'primary' : 'default'} onClick={() => setOpen((value) => !value)}>
            文件级评论
          </Button>
        </div>
      </div>
      {open ? (
        <CommentComposer
          placeholder="请输入文件级审查评论..."
          onSubmit={async (body) => {
            await onCreate({ type: 'file', filePath: file.path }, body);
            setOpen(false);
          }}
        />
      ) : null}
      {fileThreads.length > 0 ? (
        <Tag className={styles.threadCount} color="gold">
          {fileThreads.length} 个评论线程
        </Tag>
      ) : null}
    </Card>
  );
}
