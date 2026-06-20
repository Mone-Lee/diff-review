/**
 * FileList 文本展示工具：承载列表中文件路径的截断展示规则与相关常量，避免和树结构逻辑混放。
 */
export const FILE_PATH_MAX_LENGTH = 36;
export const FILE_PATH_SUFFIX_LENGTH = 18;

export function middleEllipsis(text: string, maxLength: number, suffixLength: number) {
  if (text.length <= maxLength) return text;
  const safeSuffixLength = Math.min(suffixLength, maxLength - 4);
  const prefixLength = maxLength - safeSuffixLength - 3;
  return `${text.slice(0, prefixLength)}...${text.slice(-safeSuffixLength)}`;
}
