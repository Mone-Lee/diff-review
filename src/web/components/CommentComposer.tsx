/**
 * 评论输入组件：封装评论文本输入与提交行为。
 */
import React from 'react';
import { Button, Input, Space } from 'antd';
import styles from '../styles.module.less';

type Props = {
  placeholder: string;
  onSubmit: (body: string) => Promise<void>;
};

export function CommentComposer({ placeholder, onSubmit }: Props) {
  const [body, setBody] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim()) return;
        setSubmitting(true);
        void onSubmit(body.trim())
          .then(() => setBody(''))
          .finally(() => setSubmitting(false));
      }}
    >
      <Input.TextArea placeholder={placeholder} value={body} onChange={(event) => setBody(event.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} />
      <Space>
        <Button htmlType="submit" loading={submitting} type="primary">
          添加评论
        </Button>
      </Space>
    </form>
  );
}
