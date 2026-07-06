/**
 * 版本对比菜单：负责渲染快捷对比项和最近提交列表，并把用户选择映射为具体 review mode。
 */
import React from 'react';
import { Divider, Typography } from 'antd';
import type { GitCommitSummary, ReviewMode } from '../../../shared/types';
import { buildCommitMode, compareItemClass, modeKey } from './utils';
import styles from './index.module.less';

type Props = {
  currentMode?: ReviewMode;
  defaultBase?: string;
  loading: boolean;
  recentCommits: GitCommitSummary[];
  onApply: (mode: ReviewMode) => void;
};

export function VersionCompareMenu({ currentMode, defaultBase, loading, recentCommits, onApply }: Props) {
  const currentKey = currentMode ? modeKey(currentMode) : '';

  return (
    <div className={styles.compareMenu}>
      <Typography.Text className={styles.compareMenuSection}>快捷对比</Typography.Text>
      <button type="button" className={compareItemClass(styles, currentKey === 'working')} disabled={loading} onClick={() => onApply({ kind: 'working' })}>
        HEAD...工作区
      </button>
      {defaultBase ? (
        <button
          type="button"
          className={compareItemClass(styles, currentKey === `working:${defaultBase}`)}
          disabled={loading}
          onClick={() => onApply({ kind: 'working', base: defaultBase })}
        >
          {defaultBase}...工作区
        </button>
      ) : null}
      <button type="button" className={compareItemClass(styles, currentKey === 'staged')} disabled={loading} onClick={() => onApply({ kind: 'staged' })}>
        暂存区
      </button>
      <Divider className={styles.compareMenuDivider} />
      <Typography.Text className={styles.compareMenuSection}>最近提交</Typography.Text>
      <div className={styles.compareCommitList}>
        {recentCommits.map((commit) => {
          const selected = currentKey === `revision:${commit.hash}^:${commit.hash}`;
          return (
            <button
              key={commit.hash}
              type="button"
              className={compareItemClass(styles, selected)}
              disabled={loading}
              onClick={() => onApply(buildCommitMode(commit))}
            >
              <span className={styles.compareCommitHash}>{commit.shortHash}</span>
              <span className={styles.compareCommitSubject}>{commit.subject}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
