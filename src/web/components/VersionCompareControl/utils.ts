/**
 * 版本对比工具函数：集中管理菜单选中态、提交标签和 review mode 的展示转换。
 */
import type { GitCommitSummary, ReviewMode } from '../../../shared/types';
import type styles from './index.module.less';

export function comparisonLabel(mode: ReviewMode, recentCommits: GitCommitSummary[]): string {
  if (mode.kind === 'revision' && mode.targetLabel) return mode.targetLabel;
  if (mode.kind === 'revision') {
    const commit = recentCommits.find((item) => item.hash === mode.target);
    return commit ? commitLabel(commit) : `${shortRef(mode.base)}..${shortRef(mode.target)}`;
  }
  if (mode.kind === 'staged') return 'HEAD..暂存区';
  return mode.base ? `${shortRef(mode.base)}..工作区` : 'HEAD..工作区';
}

export function buildCommitMode(commit: GitCommitSummary): ReviewMode {
  return {
    kind: 'revision',
    base: `${commit.hash}^`,
    target: commit.hash,
    targetLabel: commitLabel(commit)
  };
}

export function modeKey(mode: ReviewMode): string {
  if (mode.kind === 'revision') return `revision:${mode.base}:${mode.target}`;
  if (mode.kind === 'staged') return 'staged';
  return mode.base ? `working:${mode.base}` : 'working';
}

export function compareItemClass(styleMap: typeof styles, selected: boolean): string {
  return [styleMap.compareMenuItem, selected ? styleMap.compareMenuItemActive : ''].filter(Boolean).join(' ');
}

function commitLabel(commit: GitCommitSummary): string {
  return `${commit.shortHash} ${commit.subject}`;
}

function shortRef(ref: string): string {
  return ref.length > 12 ? ref.slice(0, 7) : ref;
}
