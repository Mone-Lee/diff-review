import GithubSlugger from 'github-slugger';
import type { MarkdownBlock } from '../shared/types';

export function buildMarkdownBlocks(content: string): MarkdownBlock[] {
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

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const start = lineNumber;
      const collected: string[] = [];
      while (index < lines.length && (lines[index].trim() === '' || /^\s*([-*+]|\d+\.)\s+/.test(lines[index]))) {
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
    while (index < lines.length && lines[index].trim() !== '') {
      collected.push(lines[index]);
      index += 1;
    }
    blocks.push(makeBlock('paragraph', start, index, collected.join('\n'), slugger));
  }

  return blocks;
}

function makeBlock(type: MarkdownBlock['type'], startLine: number, endLine: number, text: string, slugger: GithubSlugger): MarkdownBlock {
  const seed = `${type}-${startLine}-${text.slice(0, 80)}`;
  return {
    id: slugger.slug(seed || `${type}-${startLine}`),
    type,
    startLine,
    endLine,
    text
  };
}
