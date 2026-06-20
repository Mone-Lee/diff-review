/**
 * FileList 树结构工具：承载文件树构建、目录折叠、树内排序、搜索过滤与树顺序扁平化逻辑。
 */
import type { DiffFile } from '../../../../shared/types';

export type FileListViewMode = 'list' | 'tree';

export type FileTreeNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
  file?: DiffFile;
};

export const FILE_TREE_INDENT_PX = 18;

export function buildFileTree(files: DiffFile[]): FileTreeNode {
  const root: FileTreeNode = {
    name: '',
    path: '',
    isDirectory: true,
    children: []
  };

  files.forEach((file) => {
    const parts = file.path.split('/').filter(Boolean);
    let current = root;

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join('/');
      current.children ??= [];

      let child = current.children.find((item) => item.name === part);
      if (!child) {
        child = {
          name: part,
          path,
          isDirectory: !isLast,
          children: isLast ? undefined : [],
          file: isLast ? file : undefined
        };
        current.children.push(child);
      }

      current = child;
    });
  });

  return collapseDirectories(root);
}

/**
 * 列表视图需要复用树视图的遍历顺序，只去掉目录行本身，避免两种展示模式各自维护一套排序规则。
 */
export function flattenFileTree(node: FileTreeNode): DiffFile[] {
  if (node.file) return [node.file];
  if (!node.children?.length) return [];
  return node.children.flatMap((child) => flattenFileTree(child));
}

export function getAllDirectoryPaths(node: FileTreeNode): string[] {
  if (!node.isDirectory || !node.children) return [];
  return [
    ...(node.path ? [node.path] : []),
    ...node.children.flatMap((child) => getAllDirectoryPaths(child))
  ];
}

export function countTreeThreads(node: FileTreeNode, countByPath: Map<string, number>): number {
  if (node.file) return countByPath.get(node.file.path) ?? 0;
  return node.children?.reduce((total, child) => total + countTreeThreads(child, countByPath), 0) ?? 0;
}

/**
 * 树形搜索需要保留命中的父目录，且目录自身命中时应继续展示整个子树，避免结果丢失上下文。
 */
export function filterFileTree(node: FileTreeNode, query: string): FileTreeNode | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return node;

  if (node.file) {
    return node.file.path.toLowerCase().includes(normalizedQuery) ? node : null;
  }

  const nodeMatches = node.path.toLowerCase().includes(normalizedQuery) || node.name.toLowerCase().includes(normalizedQuery);
  if (nodeMatches) return node;

  const children = node.children
    ?.map((child) => filterFileTree(child, normalizedQuery))
    .filter((child): child is FileTreeNode => Boolean(child));

  if (!children?.length) return null;

  return {
    ...node,
    children
  };
}

function collapseDirectories(node: FileTreeNode): FileTreeNode {
  if (!node.isDirectory || !node.children) return node;

  const children = node.children.map(collapseDirectories).sort(compareFileTreeNodes);
  if (node.name && children.length === 1 && children[0]?.isDirectory && children[0].children) {
    const child = children[0];
    return {
      ...node,
      name: `${node.name}/${child.name}`,
      path: child.path,
      children: child.children
    };
  }

  return {
    ...node,
    children
  };
}

/**
 * 树形文件列表需要把当前目录的入口文件固定到最前，避免 `index.scss` 这类页面入口样式被深层子目录“淹没”。
 */
function compareFileTreeNodes(left: FileTreeNode, right: FileTreeNode) {
  const leftEntryPriority = entryFilePriority(left);
  const rightEntryPriority = entryFilePriority(right);
  if (leftEntryPriority !== rightEntryPriority) return leftEntryPriority - rightEntryPriority;

  if (left.isDirectory !== right.isDirectory) {
    return left.isDirectory ? -1 : 1;
  }

  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * 仅把当前目录下的 `index.*` 视为目录入口文件，并让样式入口先于脚本入口展示。
 */
function entryFilePriority(node: FileTreeNode) {
  if (node.isDirectory || !node.file) return 100;
  return entryFileNamePriority(node.name);
}

function entryFileNamePriority(name: string) {
  const match = name.match(/^index\.([^.]+)$/i);
  if (!match) return 100;

  const extension = match[1]?.toLowerCase() ?? '';
  if (['css', 'less', 'sass', 'scss', 'styl', 'stylus'].includes(extension)) return 0;
  if (['js', 'jsx', 'ts', 'tsx'].includes(extension)) return 1;
  return 2;
}
