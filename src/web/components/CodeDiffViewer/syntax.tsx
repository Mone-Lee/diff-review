/** 源码语法上下文：按文件快照分析新旧全文，供各类 diff 行共享。 */
import React from 'react';
import { codeToTokens } from 'shiki/bundle/web';
import type { FileContents } from './types';

type Token = { content: string; color?: string };
type Highlighted = { old: Token[][]; new: Token[][] };
export const SyntaxContext = React.createContext<Highlighted | null>(null);

const languages: Record<string, 'typescript' | 'tsx' | 'javascript' | 'jsx' | 'markdown' | 'json' | 'css' | 'html' | 'yaml' | 'bash'> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  md: 'markdown', markdown: 'markdown', json: 'json', css: 'css', html: 'html', yml: 'yaml', yaml: 'yaml', sh: 'bash'
};

// 全文一次分词以保留多行语法状态；切换文件时丢弃过期结果。
export function useSyntaxHighlight(filePath: string, contents: FileContents | null) {
  const [result, setResult] = React.useState<Highlighted | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    setResult(null);
    const language = languages[filePath.split('.').pop()?.toLowerCase() ?? ''];
    if (contents && language) {
      Promise.all([contents.oldLines, contents.newLines].map((lines) =>
        codeToTokens(lines.join('\n'), { lang: language, theme: 'github-light-default' })
      )).then(([old, current]) => {
        if (!cancelled) setResult({ old: old.tokens, new: current.tokens });
      }).catch(() => {
        if (!cancelled) setResult(null);
      });
    }
    return () => { cancelled = true; };
  }, [filePath, contents]);
  return result;
}
