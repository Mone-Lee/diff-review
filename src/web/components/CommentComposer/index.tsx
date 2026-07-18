/**
 * 评论输入组件：封装评论文本输入与提交行为。
 */
import React from 'react';
import { Button, Input, Flex } from 'antd';
import styles from './index.module.less';

type Props = {
  style?: React.CSSProperties;
  placeholder: string;
  onSubmit: (body: string) => Promise<void>;
  submitLabel?: string;
  onCancel?: () => void;
};

export function CommentComposer({ style, placeholder, onSubmit, submitLabel = '添加评论', onCancel }: Props) {
  const [body, setBody] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  return (
    <form
      className={styles.composer}
      style={style}
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim()) return;
        setSubmitting(true);
        onSubmit(body.trim())
          .then(() => setBody(''))
          .finally(() => setSubmitting(false));
      }}
    >
      <Input.TextArea placeholder={placeholder} value={body} onChange={(event) => setBody(event.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} />
      <Flex gap="small" justify="end">
        <Button htmlType="submit" loading={submitting} type="primary" size="small">
          {submitLabel}
        </Button>
        {onCancel ? <Button onClick={onCancel} size="small">
          取消
        </Button> : null}
      </Flex>
    </form>
  );
}
