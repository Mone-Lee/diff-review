/**
 * 行内差异计算：为相邻增删行生成共享的文本范围，供统一和并排视图使用。
 * 英文标识符按词比较，中文与标点按字符比较，避免将重命名拆成零散字母。
 */
import type { DiffFile, DiffLine } from '../../../shared/types';
import type { InlineChangeRange } from './types';

// 仅为有足够公共内容的替换行标记局部变化；限制比较规模，避免长行阻塞界面。
export function compareInlineChanges(oldContent: string, newContent: string): [InlineChangeRange[], InlineChangeRange[]] {
  const tokenize = (content: string) => [...content.matchAll(/[\p{Script=Han}]|[A-Za-z0-9_$]+|\s+|[^\s]/gu)];
  const oldTokens = tokenize(oldContent);
  const newTokens = tokenize(newContent);
  if (!oldTokens.length || !newTokens.length || oldTokens.length * newTokens.length > 250_000) return [[], []];

  const width = newTokens.length + 1;
  const lengths = new Uint32Array((oldTokens.length + 1) * width);
  for (let oldIndex = oldTokens.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newTokens.length - 1; newIndex >= 0; newIndex -= 1) {
      lengths[oldIndex * width + newIndex] = oldTokens[oldIndex][0] === newTokens[newIndex][0]
        ? lengths[(oldIndex + 1) * width + newIndex + 1] + 1
        : Math.max(lengths[(oldIndex + 1) * width + newIndex], lengths[oldIndex * width + newIndex + 1]);
    }
  }

  const oldMatched = new Set<number>();
  const newMatched = new Set<number>();
  let oldIndex = 0;
  let newIndex = 0;
  let sharedCharacters = 0;
  while (oldIndex < oldTokens.length && newIndex < newTokens.length) {
    if (oldTokens[oldIndex][0] === newTokens[newIndex][0]) {
      sharedCharacters += oldTokens[oldIndex][0].trim().length;
      oldMatched.add(oldIndex++);
      newMatched.add(newIndex++);
    } else if (lengths[(oldIndex + 1) * width + newIndex] >= lengths[oldIndex * width + newIndex + 1]) {
      oldIndex += 1;
    } else {
      newIndex += 1;
    }
  }
  if (sharedCharacters < Math.max(oldContent.trim().length, newContent.trim().length) * 0.2) return [[], []];

  const collectRanges = (tokens: RegExpMatchArray[], matched: Set<number>) => {
    const ranges: InlineChangeRange[] = [];
    tokens.forEach((token, index) => {
      if (matched.has(index)) return;
      const start = token.index!;
      const end = start + token[0].length;
      const previous = ranges.at(-1);
      if (previous?.end === start) previous.end = end;
      else ranges.push({ start, end });
    });
    return ranges;
  };
  return [collectRanges(oldTokens, oldMatched), collectRanges(newTokens, newMatched)];
}

// 与并排视图保持相同的逐行配对规则，纯新增、纯删除和未配对行只显示整行底色。
export function buildInlineChanges(hunks: DiffFile['hunks']): Map<DiffLine, InlineChangeRange[]> {
  const changes = new Map<DiffLine, InlineChangeRange[]>();
  for (const hunk of hunks) {
    let index = 0;
    while (index < hunk.lines.length) {
      if (hunk.lines[index].type !== 'remove') {
        index += 1;
        continue;
      }
      const removes: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (hunk.lines[index]?.type === 'remove') removes.push(hunk.lines[index++]);
      while (hunk.lines[index]?.type === 'add') adds.push(hunk.lines[index++]);
      for (let pair = 0; pair < Math.min(removes.length, adds.length); pair += 1) {
        const [oldRanges, newRanges] = compareInlineChanges(removes[pair].content, adds[pair].content);
        changes.set(removes[pair], oldRanges);
        changes.set(adds[pair], newRanges);
      }
    }
  }
  return changes;
}
