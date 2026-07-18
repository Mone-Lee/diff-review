/**
 * 版本对比控制组件：负责加载可选 ref，并提供快捷对比与最近提交切换入口。
 */
import React from 'react';
import { App as AntApp, Button, Card, Popover, Space, Tag } from 'antd';
import { BranchesOutlined, DownOutlined } from '@ant-design/icons';
import type { ReviewMode, ReviewSession } from '../../../shared/types';
import { fetchCompareOptions, type CompareOptions } from '../../api/review';
import { VersionCompareMenu } from './VersionCompareMenu';
import { comparisonLabel } from './utils';
import styles from './index.module.less';

type Props = {
  session: ReviewSession | null;
  filesCount: number;
  loading: boolean;
  onApply: (mode: ReviewMode) => void;
};

export function VersionCompareControl({ session, filesCount, loading, onApply }: Props) {
  const { message } = AntApp.useApp();
  const [compareOptions, setCompareOptions] = React.useState<CompareOptions | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const triggerLabel = session ? comparisonLabel(session.mode, compareOptions?.recentCommits ?? []) : '选择对比范围';

  React.useEffect(() => {
    fetchCompareOptions()
      .then((options) => setCompareOptions(options))
      .catch((error) => {
        const nextMessage = error instanceof Error ? error.message : '读取版本列表失败';
        message.warning(nextMessage);
      });
  }, [message]);

  function applyComparison(mode: ReviewMode) {
    setMenuOpen(false);
    onApply(mode);
  }

  return (
    <Card className={styles.sideCard}>
      <div className={styles.compareCardBody}>
        <Space size={8} wrap>
          <Tag color="blue">{session?.mode.kind === 'revision' ? '版本对比' : '本地对比'}</Tag>
          <Tag color="gold">{filesCount} 个文件</Tag>
        </Space>
        <Popover
          trigger="click"
          placement="bottomLeft"
          open={menuOpen}
          onOpenChange={setMenuOpen}
          content={(
            <VersionCompareMenu
              currentMode={session?.mode}
              defaultBase={compareOptions?.defaultBase}
              loading={loading}
              recentCommits={compareOptions?.recentCommits ?? []}
              onApply={applyComparison}
            />
          )}
        >
          <Button className={styles.compareTrigger} icon={<BranchesOutlined />} loading={loading}>
            <span className={styles.compareTriggerText}>{triggerLabel}</span>
            <DownOutlined className={styles.compareTriggerChevron} />
          </Button>
        </Popover>
      </div>
    </Card>
  );
}
