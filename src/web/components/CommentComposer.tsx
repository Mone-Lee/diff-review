/**
 * 评论输入组件：封装评论文本输入与提交行为。
 */
import React from 'react';
import styles from '../styles.module.less';

type Props = {
  placeholder: string;
  onSubmit: (body: string) => Promise<void>;
};

export function CommentComposer({ placeholder, onSubmit }: Props) {
  const [body, setBody] = React.useState('');

  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim()) return;
        void onSubmit(body.trim()).then(() => setBody(''));
      }}
    >
      <textarea placeholder={placeholder} value={body} onChange={(event) => setBody(event.target.value)} />
      <button type="submit">添加评论</button>
    </form>
  );
}
