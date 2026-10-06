/**
 * 行内评论弹层：在 Diff/Markdown 视图中承载快速评论输入。
 */
import React from 'react';
import { CommentComposer } from '../CommentComposer';
import styles from './index.module.less';

type Props = {
  style?: React.CSSProperties;
  selectedText?: string;
  onCancel: () => void;
  onSubmit: (body: string) => Promise<void>;
};

export function CommentPopover({ onCancel, onSubmit, style, selectedText }: Props) {
  return (
    <div className={styles.popover} style={style}>
      {selectedText ? <div className={styles.selectedText}>{selectedText}</div> : null}
      <CommentComposer placeholder="请输入行内评论..." submitLabel="评论" onSubmit={onSubmit} onCancel={onCancel} />
    </div>
  );
}
