/**
 * 源码行渲染：叠加行内增删背景，并为 Gherkin 的结构、步骤与待办保留语法着色。
 * 行内与并排视图共用此渲染，不解析或重排场景，未识别的语法保持原样。
 */
import React from 'react';
import type { InlineChangeRange } from '../types';
import styles from './index.module.less';
import { SyntaxContext } from '../syntax';

const headingPattern = /^(Feature|Business Need|Ability|Rule|Background|Scenario Outline|Scenario Template|Scenario|Example|Examples|Scenarios)(\s*:)/;
const stepPattern = /^(Given|When|Then|And|But|\*)(?=\s|$)/;
const tokenPattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<[^<>\r\n]+>|\bTODO\b|@[^\s@]+|\|)/g;

// 仅装饰文本节点，保证复制结果与原文一致，也避免将 Feature 内容当作 HTML。
function highlightTokens(content: string, renderText: (text: string) => React.ReactNode, comment = false): React.ReactNode {
  const pattern = comment ? /(\bTODO\b)/g : tokenPattern;
  return content.split(pattern).map((part, index) => {
    if (index % 2 === 0) return renderText(part);
    const className = part === 'TODO' ? styles.todo
      : part.startsWith('<') ? styles.parameter
        : part.startsWith('@') ? styles.tag
          : part === '|' ? styles.separator : styles.string;
    return <span className={className} key={index}>{renderText(part)}</span>;
  });
}

// 按原文偏移叠加变更范围；Gherkin 仅按行首识别结构，避免误标说明文字中的步骤词。
export function GherkinLine({ filePath, content, changes = [], changeType, side, lineNumber }: {
  filePath: string;
  content: string;
  changes?: InlineChangeRange[];
  changeType?: 'context' | 'add' | 'remove' | 'empty';
  side?: 'old' | 'new';
  lineNumber?: number;
}) {
  const syntax = React.useContext(SyntaxContext);
  const tokens = side && lineNumber ? syntax?.[side][lineNumber - 1] : undefined;
  let offset = 0;
  // 在语法 token 内按原文偏移叠加背景，不拆散语法识别或改变复制内容。
  const renderText = (text: string): React.ReactNode => {
    const start = offset;
    offset += text.length;
    const parts: React.ReactNode[] = [];
    let cursor = start;
    for (const range of changes) {
      const from = Math.max(start, range.start);
      const to = Math.min(offset, range.end);
      if (from >= to) continue;
      parts.push(text.slice(cursor - start, from - start));
      parts.push(<span className={changeType === 'remove' ? styles.removedText : styles.addedText} key={from}>{text.slice(from - start, to - start)}</span>);
      cursor = to;
    }
    parts.push(text.slice(cursor - start));
    return parts;
  };
  if (!/\.feature$/i.test(filePath)) {
    if (tokens && tokens.map((token) => token.content).join('') === content) {
      return <>{tokens.map((token, index) => <span key={index} style={{ color: token.color }}>{renderText(token.content)}</span>)}</>;
    }
    return <>{renderText(content || ' ')}</>;
  }

  const indent = content.match(/^[\t ]*/)?.[0] ?? '';
  const body = content.slice(indent.length);
  const heading = body.match(headingPattern);
  const step = body.match(stepPattern);
  const keyword = heading?.[0] ?? step?.[0];
  const isComment = body.startsWith('#');
  const indentWidth = indent.replaceAll('\t', '  ').length;

  return (
    <span
      className={`${styles.line}${heading ? ` ${styles.heading}` : ''}${isComment ? ` ${styles.comment}` : ''}`}
      style={{ paddingInlineStart: `${indentWidth}ch`, textIndent: `-${indentWidth}ch` }}
    >
      {renderText(indent)}
      {keyword ? <span className={heading ? styles.headingKeyword : styles.stepKeyword}>{renderText(keyword)}</span> : null}
      {highlightTokens(body.slice(keyword?.length ?? 0) || (content ? '' : ' '), renderText, isComment)}
    </span>
  );
}
