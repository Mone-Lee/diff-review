import type { DiffFile } from '../../../shared/types';

export type FileListViewMode = 'list' | 'tree';

export type FileTreeNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
  file?: DiffFile;
};

export const FILE_PATH_MAX_LENGTH = 36;
export const FILE_PATH_SUFFIX_LENGTH = 18;
export const FILE_TREE_INDENT_PX = 18;

export function middleEllipsis(text: string, maxLength: number, suffixLength: number) {
  if (text.length <= maxLength) return text;
  const safeSuffixLength = Math.min(suffixLength, maxLength - 4);
  const prefixLength = maxLength - safeSuffixLength - 3;
  return `${text.slice(0, prefixLength)}...${text.slice(-safeSuffixLength)}`;
}

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

  const collapseDirectories = (node: FileTreeNode): FileTreeNode => {
    if (!node.isDirectory || !node.children) return node;

    const children = node.children.map(collapseDirectories);
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
  };

  return collapseDirectories(root);
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
