/**
 * Mermaid 图表渲染组件。
 * 说明：
 * 1) 接收 markdown 代码块中的 mermaid 源码；
 * 2) 动态加载 mermaid 并渲染成 SVG；
 * 3) 渲染失败时回退为错误提示 + 原始源码。
 */
import React from 'react';
import styles from './index.module.less';

type Props = {
  chart: string;
};

export function MermaidDiagram({ chart }: Props) {
  // useId 生成稳定基础 ID，再清洗为 Mermaid 可接受的安全字符。
  const reactId = React.useId();
  const diagramId = React.useMemo(() => `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [reactId]);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = React.useState<string>('');
  const [error, setError] = React.useState<string>('');

  React.useEffect(() => {
    // isActive 用于防止组件卸载后仍然 setState（异步竞态保护）。
    let isActive = true;

    async function renderDiagram() {
      try {
        // 按需加载 mermaid，避免首屏额外体积；使用 strict 提升渲染安全性。
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'default'
        });
        mermaid.setParseErrorHandler(() => {});
        const parseResult = await mermaid.parse(chart, { suppressErrors: true });
        if (!parseResult) {
          throw new Error('Mermaid 图表语法无效');
        }

        const result = await mermaid.render(diagramId, chart, containerRef.current ?? undefined);
        if (!isActive) return;
        setSvg(result.svg);
        setError('');
      } catch (err) {
        // 渲染失败时清空 SVG，并保留错误信息用于回退展示。
        if (!isActive) return;
        setSvg('');
        setError(err instanceof Error ? err.message : 'Mermaid 图表渲染失败');
      }
    }

    void renderDiagram();

    return () => {
      isActive = false;
    };
  }, [chart, diagramId]);

  if (error) {
    return (
      <div className={styles.mermaidFallback}>
        <div className={styles.mermaidError}>Mermaid 渲染失败：{error}</div>
        <pre>
          <code>{chart}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return <div className={styles.mermaidLoading} ref={containerRef}>正在渲染图表...</div>;
  }

  return <div className={styles.mermaidDiagram} dangerouslySetInnerHTML={{ __html: svg }} ref={containerRef} />;
}
