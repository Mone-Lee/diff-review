/**
 * RefreshButton 组件：负责呈现仓库文件变化提示与手动刷新入口，
 * 让用户在确认后再把当前视图切换到最新 diff 快照。
 */
import React from 'react';
import { Button, Space, Tooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import styles from './index.module.less';

type RefreshButtonProps = {
  changedAt: string | null;
  disabled: boolean;
  hasPendingChanges: boolean;
  loading: boolean;
  onRefresh: () => void;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * 变化提示只在存在待刷新文件变更时出现，避免工具栏常驻噪音。
 */
export function RefreshButton({ changedAt, disabled, hasPendingChanges, loading, onRefresh, className, style }: RefreshButtonProps) {
  const buttonClassName = [styles.refreshButton, className].filter(Boolean).join(' ');

  if (!hasPendingChanges) return null;

  return (
    <Space size={8}>
      <Tooltip title={changedAt ? '检测到项目文件变更' : '检测到新的 diff 变化'}>
        <Button style={style} className={buttonClassName} disabled={disabled} icon={<ReloadOutlined />} loading={loading} onClick={onRefresh} type="primary" size="small">
          Refresh
        </Button>
      </Tooltip>
    </Space>
  );
}
