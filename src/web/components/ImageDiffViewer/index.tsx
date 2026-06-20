/**
 * 图片 Diff 视图：负责展示图片文件在 diff 两侧的内容，覆盖新增、删除和修改场景。
 */
import React from 'react';
import { Image, Typography } from 'antd';
import type { DiffFile } from '../../../shared/types';
import { buildDiffImageUrl } from '../../api/content';
import styles from './index.module.less';

type Props = {
  file: DiffFile;
};

type ImagePaneProps = {
  title: string;
  titleTone: 'before' | 'after';
  src: string | null;
  alt: string;
  emptyText: string;
};

function getTitleClassName(titleTone: ImagePaneProps['titleTone']) {
  return titleTone === 'before' ? styles.titleBefore : styles.titleAfter;
}

function ImagePane({
  title,
  titleTone,
  src,
  alt,
  emptyText
}: ImagePaneProps) {
  const [loadFailed, setLoadFailed] = React.useState(false);
  const shouldShowImage = Boolean(src) && !loadFailed;

  React.useEffect(() => {
    setLoadFailed(false);
  }, [src]);

  return (
    <section className={styles.pane}>
      <header className={styles.paneHeader}>
        <Typography.Title className={`${styles.paneTitle} ${getTitleClassName(titleTone)}`} level={3}>{title}</Typography.Title>
      </header>

      <div className={styles.imageFrame}>
        {shouldShowImage ? (
          <Image
            className={styles.image}
            src={src!}
            alt={alt}
            preview={{
              mask: '查看原图'
            }}
            onError={() => {
              setLoadFailed(true);
              return false;
            }}
          />
        ) : (
          <div className={styles.emptyPane}>
            <Typography.Text className={styles.emptyTitle}>{emptyText}</Typography.Text>
            <Typography.Text type="secondary">当前侧没有可展示的图片内容</Typography.Text>
          </div>
        )}
      </div>
    </section>
  );
}

function getImagePaneState(file: DiffFile, side: 'old' | 'new') {
  const isOld = side === 'old';
  const src = buildDiffImageUrl(file.path, side);

  if (isOld && file.status === 'added') {
    return {
      src: null,
      emptyText: '新增文件没有旧版本'
    };
  }

  if (!isOld && file.status === 'deleted') {
    return {
      src: null,
      emptyText: '删除文件没有新版本'
    };
  }

  if (isOld && file.status === 'deleted') {
    return {
      src,
      emptyText: '删除前图片不可用'
    };
  }

  if (!isOld && file.status === 'added') {
    return {
      src,
      emptyText: '新增后图片不可用'
    };
  }

  return {
    src,
    emptyText: isOld ? '变更前图片不可用' : '变更后图片不可用'
  };
}

export function ImageDiffViewer({ file }: Props) {
  const oldPane = getImagePaneState(file, 'old');
  const newPane = getImagePaneState(file, 'new');

  return (
    <div className={styles.viewer}>
      <div className={styles.grid}>
        <ImagePane
          title="之前"
          titleTone="before"
          src={oldPane.src}
          alt={`${file.path} old`}
          emptyText={oldPane.emptyText}
        />
        <ImagePane
          title="之后"
          titleTone="after"
          src={newPane.src}
          alt={`${file.path} new`}
          emptyText={newPane.emptyText}
        />
      </div>
    </div>
  );
}
