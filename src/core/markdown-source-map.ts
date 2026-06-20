/**
 * Markdown 块映射工具：负责把原始 Markdown 文本切成轻量块结构，供预览定位与评论锚点映射使用。
 */
import GithubSlugger from 'github-slugger';
import type { MarkdownBlock } from '../shared/types';

export function buildMarkdownBlocks(content: string): MarkdownBlock[] {
  // 这里做轻量级块划分，不追求完整 Markdown AST，只服务评论锚点定位。
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  const slugger = new GithubSlugger();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^```/.test(line.trim())) {
      const start = lineNumber;
      const collected = [line];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        collected.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        collected.push(lines[index]);
        index += 1;
      }
      blocks.push(makeBlock('code', start, index, collected.join('\n'), slugger));
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      blocks.push(makeBlock('heading', lineNumber, lineNumber, line, slugger));
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const start = lineNumber;
      const collected: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        collected.push(lines[index]);
        index += 1;
      }
      blocks.push(makeBlock('blockquote', start, index, collected.join('\n'), slugger));
      continue;
    }

    if (isListLine(line)) {
      const start = lineNumber;
      const collected: string[] = [];
      while (index < lines.length && isListBlockLine(lines[index])) {
        collected.push(lines[index]);
        index += 1;
      }
      blocks.push(makeBlock('list', start, index, collected.join('\n'), slugger));
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[index + 1])) {
      const start = lineNumber;
      const collected: string[] = [];
      while (index < lines.length && lines[index].includes('|')) {
        collected.push(lines[index]);
        index += 1;
      }
      blocks.push(makeBlock('table', start, index, collected.join('\n'), slugger));
      continue;
    }

    const start = lineNumber;
    const collected: string[] = [];
    // 默认按段落收敛，直到空行为止。
    // 段落遇到下一个块级结构起点时提前收口，避免把后续列表、表格等并入当前段落。
    while (index < lines.length && lines[index].trim() !== '' && !startsNewMarkdownBlock(lines[index], lines[index + 1])) {
      collected.push(lines[index]);
      index += 1;
    }
    if (index < lines.length && lines[index].trim() !== '') {
      collected.push(lines[index]);
      index += 1;
    }
    blocks.push(makeBlock('paragraph', start, index, collected.join('\n'), slugger));
  }

  return blocks;
}

// 识别 Markdown 列表项起始行，统一服务列表块判断和块边界判断。
function isListLine(line: string) {
  return /^\s*([-*+]|\d+[.)])\s+/.test(line);
}

// 识别列表项下的缩进续行，例如多行列表正文或内嵌说明文本。
function isIndentedContinuationLine(line: string) {
  return /^\s{2,}\S/.test(line);
}

// 仅做轻量级表格起始判断：当前行含分隔符，且下一行符合表头分隔线形态。
function isTableStartLine(line: string, nextLine: string | undefined) {
  return line.includes('|') && Boolean(nextLine) && /^\s*\|?[\s:-]+\|/.test(nextLine ?? '');
}

// 判断某一行是否应作为新块起点，用于在段落扫描时及时停止，避免误吞后续块结构。
function startsNewMarkdownBlock(line: string, nextLine: string | undefined) {
  if (!line.trim()) return false;
  if (/^```/.test(line.trim())) return true;
  if (/^#{1,6}\s+/.test(line)) return true;
  if (/^\s*>/.test(line)) return true;
  if (isListLine(line)) return true;
  if (isTableStartLine(line, nextLine)) return true;
  return false;
}

// 列表块允许包含空行、后续列表项，以及属于当前列表项的缩进续行。
function isListBlockLine(line: string) {
  if (!line.trim()) return true;
  if (isListLine(line)) return true;
  return isIndentedContinuationLine(line);
}

function makeBlock(type: MarkdownBlock['type'], startLine: number, endLine: number, text: string, slugger: GithubSlugger): MarkdownBlock {
  // 同类型、同行号下保持稳定 ID，减少前端渲染抖动。
  const seed = `${type}-${startLine}-${text.slice(0, 80)}`;
  return {
    id: slugger.slug(seed || `${type}-${startLine}`),
    type,
    startLine,
    endLine,
    text
  };
}
