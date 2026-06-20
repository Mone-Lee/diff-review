/**
 * FileList 工具统一出口：负责聚合树结构与文本展示工具，供列表组件以稳定入口按需引用。
 */
export {
  buildFileTree,
  countTreeThreads,
  FILE_TREE_INDENT_PX,
  flattenFileTree,
  type FileListViewMode,
  type FileTreeNode,
  filterFileTree,
  getAllDirectoryPaths
} from './tree';
export { FILE_PATH_MAX_LENGTH, FILE_PATH_SUFFIX_LENGTH, middleEllipsis } from './text';
