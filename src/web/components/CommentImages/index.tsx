/**
 * 评论图片展示：统一草稿和已保存评论的缩略图、大图预览及可选的移除操作。
 */
import React from 'react';
import { Button, Image } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import type { ReviewAttachment } from '../../../shared/attachments';
import { attachmentUrl } from '../../api/attachments';
import styles from './index.module.less';

export function CommentImages({ attachments, onRemove, disabled }: {
  attachments: ReviewAttachment[];
  onRemove?: (id: string) => void;
  disabled?: boolean;
}) {
  if (!attachments.length) return null;
  return <div className={styles.images} onClick={(event) => event.stopPropagation()}>
    <Image.PreviewGroup>
      {attachments.map((attachment) => <div className={styles.image} key={attachment.id}>
        <Image src={attachmentUrl(attachment.id)} alt={attachment.name} width={72} height={72} />
        {onRemove ? <Button
          className={styles.remove} size="small" shape="circle" icon={<CloseOutlined />}
          aria-label={`移除图片 ${attachment.name}`} disabled={disabled} onClick={() => onRemove(attachment.id)}
        /> : null}
      </div>)}
    </Image.PreviewGroup>
  </div>;
}
