/**
 * 评论输入组件：统一新建、回复和编辑的文字与图片草稿、上传状态及失败恢复。
 * 仅在本地审查声明附件能力时启用上传，避免静态分享页调用本地接口。
 */
import React from 'react';
import { Alert, Button, Input, Flex, Popover } from 'antd';
import { PictureOutlined } from '@ant-design/icons';
import { ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_BYTES, MAX_COMMENT_ATTACHMENTS, type ReviewAttachment } from '../../../shared/attachments';
import { discardAttachment, uploadAttachment } from '../../api/attachments';
import { useReviewActions } from '../../contexts/ReviewActionsContext';
import { CommentImages } from '../CommentImages';
import styles from './index.module.less';

type Props = {
  style?: React.CSSProperties;
  placeholder: string;
  onSubmit: (body: string, attachments?: ReviewAttachment[]) => Promise<void>;
  submitLabel?: string;
  onCancel?: () => void;
  initialBody?: string;
  initialAttachments?: ReviewAttachment[];
};

/** 上传任务保留原文件供失败重试；成功后转为服务端生成的附件引用。 */
type UploadTask = { id: string; file: File; error?: string };

export function CommentComposer({ style, placeholder, onSubmit, submitLabel = '添加评论', onCancel, initialBody = '', initialAttachments = [] }: Props) {
  const { supportsAttachments } = useReviewActions();
  const [body, setBody] = React.useState(initialBody);
  const [attachments, setAttachments] = React.useState(initialAttachments);
  const [uploads, setUploads] = React.useState<UploadTask[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const attachmentsRef = React.useRef(attachments);
  const uploadsRef = React.useRef(uploads);
  const addedIds = React.useRef(new Set<string>());
  const mounted = React.useRef(false);
  const submittingRef = React.useRef(false);
  const uploading = uploads.some((task) => !task.error);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // 保存期间由请求结果决定归属；其他关闭场景只清理本次草稿新上传的图片。
      if (!submittingRef.current) {
        for (const id of addedIds.current) discardAttachment(id).catch(() => undefined);
      }
    };
  }, []);

  function changeAttachments(next: ReviewAttachment[]) {
    attachmentsRef.current = next;
    setAttachments(next);
  }

  function changeUploads(next: UploadTask[]) {
    uploadsRef.current = next;
    setUploads(next);
  }

  async function runUpload(task: UploadTask) {
    try {
      const attachment = await uploadAttachment(task.file);
      if (!mounted.current) {
        discardAttachment(attachment.id).catch(() => undefined);
        return;
      }
      addedIds.current.add(attachment.id);
      changeAttachments([...attachmentsRef.current, attachment]);
      changeUploads(uploadsRef.current.filter((item) => item.id !== task.id));
      setOpen(false);
    } catch (uploadError) {
      if (mounted.current) changeUploads(uploadsRef.current.map((item) => item.id === task.id
        ? { ...item, error: uploadError instanceof Error ? uploadError.message : '图片上传失败' } : item));
    }
  }

  // 先同步预占名额，再发起上传，避免连续粘贴和并发上传绕过单条评论的数量限制。
  function addFiles(files: File[]) {
    if (!supportsAttachments || submittingRef.current) return;
    setError('');
    const tasks: UploadTask[] = [];
    for (const file of files) {
      if (!ATTACHMENT_MIME_TYPES.includes(file.type as ReviewAttachment['mimeType'])) {
        setError('仅支持 PNG、JPEG、WebP、GIF 图片');
      } else if (!file.size || file.size > MAX_ATTACHMENT_BYTES) {
        setError('图片大小须在 1 字节至 10 MiB 之间');
      } else if (attachmentsRef.current.length + uploadsRef.current.length + tasks.length >= MAX_COMMENT_ATTACHMENTS) {
        setError('每条评论最多添加 8 张图片');
      } else {
        tasks.push({ id: crypto.randomUUID(), file });
      }
    }
    changeUploads([...uploadsRef.current, ...tasks]);
    for (const task of tasks) runUpload(task).catch(() => undefined);
  }

  function handlePaste(event: React.ClipboardEvent) {
    if (!supportsAttachments) return;
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    addFiles(files);
  }

  function removeAttachment(id: string) {
    changeAttachments(attachmentsRef.current.filter((attachment) => attachment.id !== id));
    if (addedIds.current.delete(id)) discardAttachment(id).catch(() => undefined);
  }

  async function submit() {
    if (submittingRef.current || uploadsRef.current.length || (!body.trim() && !attachmentsRef.current.length)) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(body.trim(), supportsAttachments ? attachmentsRef.current : undefined);
      addedIds.current.clear();
      if (mounted.current) {
        setBody('');
        changeAttachments([]);
        setOpen(false);
      }
    } catch (submitError) {
      if (mounted.current) setError(submitError instanceof Error ? submitError.message : '保存评论失败');
      else for (const id of addedIds.current) discardAttachment(id).catch(() => undefined);
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  const attachmentPanel = <div className={styles.attachmentPanel} onPaste={handlePaste}>
    <div className={styles.attachmentHeader}>
      <span className={styles.attachmentTitle}><PictureOutlined /> 图片附件</span>
      <span className={styles.attachmentCount} aria-label={`已占用 ${attachments.length + uploads.length} 个图片名额，共 ${MAX_COMMENT_ATTACHMENTS} 个`}>
        {attachments.length + uploads.length}<span> / {MAX_COMMENT_ATTACHMENTS}</span>
      </span>
    </div>
    <button
      type="button"
      className={[styles.dropzone, dragging ? styles.dragging : ''].filter(Boolean).join(' ')}
      aria-label="选择或拖放图片"
      disabled={submitting}
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => {
        event.preventDefault();
        if (!submitting) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault(); event.stopPropagation(); setDragging(false);
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <span className={styles.dropzoneTitle}>{dragging ? '松开即可上传' : '选择图片 / 拖拽图片到这里'}</span>
      <span className={styles.dropzoneDescription}>为评论补充截图，让问题更清晰</span>
    </button>
    <div className={styles.attachmentDetails}>
      <span>PNG · JPEG · WebP · GIF</span>
      <span>每张最多 {MAX_ATTACHMENT_BYTES / 1024 / 1024} MiB</span>
    </div>
    <div className={styles.pasteHint}>
      <span>也可直接粘贴图片</span>
      <span className={styles.shortcut}><kbd>⌘ / Ctrl</kbd><span>+</span><kbd>V</kbd></span>
    </div>
  </div>;

  return <form
    className={styles.composer} style={style}
    onClick={(event) => event.stopPropagation()}
    onPaste={handlePaste}
    onSubmit={(event) => { event.preventDefault(); submit().catch(() => undefined); }}
  >
    <CommentImages attachments={attachments} onRemove={supportsAttachments ? removeAttachment : undefined} disabled={submitting} />
    {uploads.map((task) => <div className={styles.uploadStatus} key={task.id} role="status">
      <span>{task.file.name}：{task.error || '上传中…'}</span>
      {task.error ? <>
        <Button size="small" type="link" onClick={() => {
          changeUploads(uploadsRef.current.map((item) => item.id === task.id ? { ...item, error: undefined } : item));
          runUpload(task).catch(() => undefined);
        }}>重试</Button>
        <Button size="small" type="link" onClick={() => changeUploads(uploadsRef.current.filter((item) => item.id !== task.id))}>移除</Button>
      </> : null}
    </div>)}
    <Input.TextArea placeholder={placeholder} value={body} disabled={submitting} onChange={(event) => setBody(event.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} />
    {error ? <Alert type="error" title={error} showIcon /> : null}
    <Flex gap="small" justify="space-between" align="center">
      {supportsAttachments ? <>
        <Popover
          classNames={{ root: styles.attachmentPopover }}
          open={open} onOpenChange={(visible) => { setOpen(visible); setDragging(false); }} trigger="click" placement="bottomLeft" content={attachmentPanel}
          afterOpenChange={(visible) => { if (visible) document.querySelector<HTMLElement>(`.${styles.dropzone}`)?.focus(); }}
        >
          <Button type="text" size="small" icon={<PictureOutlined />} aria-label="添加图片" disabled={submitting} />
        </Popover>
        <input ref={inputRef} type="file" accept={ATTACHMENT_MIME_TYPES.join(',')} multiple hidden onChange={(event) => {
          addFiles(Array.from(event.target.files ?? [])); event.target.value = '';
        }} />
      </> : <span />}
      <Flex gap="small">
        <Button htmlType="submit" loading={submitting} disabled={uploads.length > 0 || (!body.trim() && !attachments.length)} type="primary" size="small">{submitLabel}</Button>
        {onCancel ? <Button onClick={onCancel} disabled={submitting || uploading} size="small">取消</Button> : null}
      </Flex>
    </Flex>
  </form>;
}
