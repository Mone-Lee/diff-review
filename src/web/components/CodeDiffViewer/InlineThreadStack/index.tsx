/**
 * InlineThreadStack 组件：在行内区域渲染评论线程组。
 */
import React from 'react';
import type { ReviewThread } from '../../../../shared/types';
import { InlineThreadGroup } from '../../InlineThreadGroup';
import styles from './index.module.less';

type Props = {
  threads: ReviewThread[];
};

export function InlineThreadStack({ threads }: Props) {
  if (threads.length === 0) return null;

  return (
    <div className={styles.inlineThreadStack}>
      <InlineThreadGroup threads={threads} />
    </div>
  );
}
