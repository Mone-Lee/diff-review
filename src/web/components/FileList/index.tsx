import React from 'react';
import { List, Segmented, Tag, Typography, Tooltip } from 'antd';
import {
  ApartmentOutlined,
  DownOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  FileOutlined,
  MessageOutlined,
  RightOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import type { DiffFile, ReviewThread } from '../../../shared/types';
import { isThreadOnFileSnapshot } from '../../../shared/thread-utils';
import { formatFileStatus } from '../../utils';
import {
  buildFileTree,
  countTreeThreads,
  FILE_PATH_MAX_LENGTH,
  FILE_PATH_SUFFIX_LENGTH,
  FILE_TREE_INDENT_PX,
  type FileListViewMode,
  type FileTreeNode,
  getAllDirectoryPaths,
  middleEllipsis
} from './utils';
import styles from './index.module.less';

type FileListProps = {
  files: DiffFile[];
  threads: ReviewThread[];
  selectedPath: string;
  onSelectFile: (filePath: string) => void;
};

export function FileList({ files, threads, selectedPath, onSelectFile }: FileListProps) {
  const [viewMode, setViewMode] = React.useState<FileListViewMode>('list');
  const [expandedDirs, setExpandedDirs] = React.useState<Set<string>>(() => new Set());
  const fileTree = React.useMemo(() => buildFileTree(files), [files]);
  const unresolvedThreadCountByFilePath = React.useMemo(() => {
    const counts = new Map<string, number>();
    files.forEach((file) => {
      counts.set(file.path, threads.filter((thread) => isThreadOnFileSnapshot(thread, file) && thread.status !== 'resolved').length);
    });
    return counts;
  }, [files, threads]);

  React.useEffect(() => {
    setExpandedDirs(new Set(getAllDirectoryPaths(fileTree)));
  }, [fileTree]);

  function toggleDirectory(path: string) {
    setExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function renderFileItem(file: DiffFile, displayPath = file.path, isTreeItem = false) {
    const isActive = file.path === selectedPath;
    const threadCount = unresolvedThreadCountByFilePath.get(file.path) ?? 0;
    const className = [
      styles.fileItem,
      isActive && isTreeItem ? styles.fileItemActive : '',
      isActive && !isTreeItem ? styles.lineItemActive : ''
    ].filter(Boolean).join(' ');

    return (
      <List.Item className={className} onClick={() => onSelectFile(file.path)}>
        <div className={styles.fileMeta}>
          {isTreeItem ? <FileOutlined className={styles.fileIcon} /> : null}
          {!isTreeItem ? (
            <span className={`${styles.fileStatusBadge} ${styles[`fileStatusBadge${formatFileStatus(file.status)}`]}`}>
              {formatFileStatus(file.status)}
            </span>
          ) : null}
          <Tooltip title={isTreeItem ? undefined : file.path}>
            <Typography.Text strong className={styles.fileName} title={file.path}>
              {isTreeItem ? displayPath : middleEllipsis(file.path, FILE_PATH_MAX_LENGTH, FILE_PATH_SUFFIX_LENGTH)}
            </Typography.Text>
          </Tooltip>

          <Typography.Text className={styles.fileStats} type="secondary">
            <span className={styles.fileStatAdd}>+{file.additions}</span> / <span className={styles.fileStatDelete}>-{file.deletions}</span>
          </Typography.Text>

          {threadCount > 0 ? (
            <Tag className={styles.fileThreadCount} icon={<MessageOutlined />}>
              {threadCount}
            </Tag>
          ) : null}
        </div>
      </List.Item>
    );
  }

  function renderTreeNode(node: FileTreeNode, depth = 0): React.ReactNode {
    if (node.file) {
      return (
        <div key={node.file.path} style={{ paddingLeft: depth * FILE_TREE_INDENT_PX }}>
          {renderFileItem(node.file, node.name, true)}
        </div>
      );
    }

    if (!node.children?.length) return null;
    if (!node.path) {
      return node.children.map((child) => renderTreeNode(child, depth));
    }

    const isExpanded = expandedDirs.has(node.path);
    const threadCount = countTreeThreads(node, unresolvedThreadCountByFilePath);

    return (
      <div key={node.path}>
        <button
          type="button"
          className={styles.fileTreeDirectory}
          style={{ paddingLeft: depth * FILE_TREE_INDENT_PX + 8 }}
          onClick={() => toggleDirectory(node.path)}
        >
          {isExpanded ? <DownOutlined className={styles.fileTreeChevron} /> : <RightOutlined className={styles.fileTreeChevron} />}
          {isExpanded ? <FolderOpenOutlined className={styles.fileTreeFolderIcon} /> : <FolderOutlined className={styles.fileTreeFolderIcon} />}
          <Typography.Text strong className={styles.fileTreeDirectoryName} title={node.path}>
            {node.name}
          </Typography.Text>
          {threadCount > 0 ? (
            <Tag className={styles.fileThreadCount} icon={<MessageOutlined />}>
              {threadCount}
            </Tag>
          ) : null}
        </button>
        {isExpanded ? node.children.map((child) => renderTreeNode(child, depth + 1)) : null}
      </div>
    );
  }

  return (
    <>
      <div className={styles.fileRailHeader}>
        <Typography.Text strong>文件列表</Typography.Text>
        <Segmented
          className={styles.fileRailModeSwitcher}
          size="small"
          options={[
            { value: 'list', icon: <UnorderedListOutlined /> },
            { value: 'tree', icon: <ApartmentOutlined /> }
          ]}
          value={viewMode}
          onChange={(value) => setViewMode(value as FileListViewMode)}
        />
      </div>
      {viewMode === 'list' ? (
        <List
          className={styles.fileList}
          dataSource={files}
          renderItem={(file) => renderFileItem(file)}
        />
      ) : (
        <div className={`${styles.fileList} ${styles.fileTree}`} role="tree">
          {renderTreeNode(fileTree)}
        </div>
      )}
    </>
  );
}
