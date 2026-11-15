/**
 * Gherkin 源码行：为 Feature 的结构、步骤与待办添加轻量高亮，保留原文、缩进和评论行号。
 * 行内与并排视图共用此渲染，不解析或重排场景，未识别的语法保持原样。
 */
import React from 'react';
import styles from './index.module.less';

const headingPattern = /^(Feature|Business Need|Ability|Rule|Background|Scenario Outline|Scenario Template|Scenario|Example|Examples|Scenarios)(\s*:)/;
const stepPattern = /^(Given|When|Then|And|But|\*)(?=\s|$)/;
const tokenPattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<[^<>\r\n]+>|\bTODO\b|@[^\s@]+|\|)/g;

// 仅装饰文本节点，保证复制结果与原文一致，也避免将 Feature 内容当作 HTML。
function highlightTokens(content: string, comment = false): React.ReactNode {
  const pattern = comment ? /(\bTODO\b)/g : tokenPattern;
  return content.split(pattern).map((part, index) => {
    if (index % 2 === 0) return part;
    const className = part === 'TODO' ? styles.todo
      : part.startsWith('<') ? styles.parameter
        : part.startsWith('@') ? styles.tag
          : part === '|' ? styles.separator : styles.string;
    return <span className={className} key={index}>{part}</span>;
  });
}

// 按行首识别语法，使说明文字中出现的 Given、When 等单词不会被误标为步骤。
export function GherkinLine({ filePath, content }: { filePath: string; content: string }) {
  if (!/\.feature$/i.test(filePath)) return <>{content || ' '}</>;

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
      {indent}
      {keyword ? <span className={heading ? styles.headingKeyword : styles.stepKeyword}>{keyword}</span> : null}
      {highlightTokens(body.slice(keyword?.length ?? 0) || (content ? '' : ' '), isComment)}
    </span>
  );
}
