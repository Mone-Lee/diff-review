/**
 * Markdown 审阅工作区：复用主 review 布局样式，为 plan mode 与静态分享页提供双栏审阅结构。
 */
import React from 'react';
import { Typography } from 'antd';
import reviewStyles from '../../styles.module.less';
import styles from './index.module.less';

type Props = {
  title: string;
  subtitle: string;
  actions: React.ReactNode;
  document: React.ReactNode;
  comments: React.ReactNode;
  commentCount: number;
  fullWidthHeader?: boolean;
};

export function MarkdownReviewWorkspace({ title, subtitle, actions, document, comments, commentCount, fullWidthHeader = false }: Props) {
  const header = (
    <header className={`${reviewStyles.topToolbar} ${styles.header} ${fullWidthHeader ? styles.fullWidthHeader : ''}`}>
      <div className={styles.brand}>
        <div className={reviewStyles.brandMark}>DR</div>
        <div className={reviewStyles.brandCopy}>
          <Typography.Text className={styles.title} ellipsis={{ tooltip: title }}>{title}</Typography.Text>
          <Typography.Text className={styles.subtitle} ellipsis={{ tooltip: subtitle }}>{subtitle}</Typography.Text>
        </div>
      </div>
      <div className={styles.actions}>{actions}</div>
    </header>
  );

  return (
    <main className={`${reviewStyles.shell} ${styles.workspace} ${fullWidthHeader ? styles.fullWidthWorkspace : ''}`}>
      {fullWidthHeader ? header : null}
      <section className={reviewStyles.reviewPane}>
        {fullWidthHeader ? null : header}

        <div className={reviewStyles.reviewSurface}>{document}</div>
      </section>
      <aside className={reviewStyles.threadRail}>
        <div className={reviewStyles.threadRailHeader}>
          <Typography.Title className={reviewStyles.threadRailTitle} level={4}>评论 ({commentCount})</Typography.Title>
        </div>
        <div className={reviewStyles.threadRailBody}>{comments}</div>
      </aside>
    </main>
  );
}
