/**
 * 左侧文件栏调宽：统一管理拖动、键盘操作、响应式宽度限制和浏览器宽度偏好。
 */
import React from 'react';

const STORAGE_KEY = 'diff-review:sidebar-width';
const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const MOBILE_BREAKPOINT = 1100;

/** 拖动期间保留起点及实际宽度，并负责恢复全局交互样式。 */
type SidebarDrag = {
  pointerId: number;
  startX: number;
  startWidth: number;
  width: number;
  cleanup: () => void;
};

/** 存储不可用时不影响调宽，窗口临时收窄也不覆盖用户的原始偏好。 */
function saveWidth(width: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // 浏览器限制本地存储时，仅保留当前页面状态。
  }
}

export function useResizableSidebar() {
  const [preferredWidth, setPreferredWidth] = React.useState<number | null>(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const width = raw === null ? NaN : Number(raw);
      return Number.isFinite(width) && width >= MIN_WIDTH && width <= MAX_WIDTH ? width : null;
    } catch {
      return null;
    }
  });
  const [viewportWidth, setViewportWidth] = React.useState(() => window.innerWidth);
  const [isResizing, setIsResizing] = React.useState(false);
  const dragRef = React.useRef<SidebarDrag | null>(null);
  const maxWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewportWidth - (viewportWidth <= 1280 ? 320 : 360) - 400));
  const width = Math.min(maxWidth, Math.max(MIN_WIDTH, preferredWidth ?? (viewportWidth <= 1280 ? 320 : 360)));

  /** 捕获结束或取消时统一提交实际宽度，并恢复光标和文本选择。 */
  const finishResize = React.useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    drag.cleanup();
    setPreferredWidth(drag.width);
    setIsResizing(false);
    saveWidth(drag.width);
  }, []);

  React.useEffect(() => {
    const handleResize = () => {
      finishResize();
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('blur', finishResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('blur', finishResize);
      dragRef.current?.cleanup();
      dragRef.current = null;
    };
  }, [finishResize]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || viewportWidth <= MOBILE_BREAKPOINT || dragRef.current) return;
    event.preventDefault();
    const target = event.currentTarget;
    // 鼠标拖动不保留键盘焦点，避免松开后仍显示 focus-visible 外框。
    if (document.activeElement === target) target.blur();
    target.setPointerCapture(event.pointerId);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      width,
      cleanup: () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      }
    };
    setIsResizing(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.width = Math.round(Math.min(maxWidth, Math.max(MIN_WIDTH, drag.startWidth + event.clientX - drag.startX)));
    setPreferredWidth(drag.width);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (viewportWidth <= MOBILE_BREAKPOINT || dragRef.current || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const nextWidth = Math.min(maxWidth, Math.max(MIN_WIDTH, width + (event.key === 'ArrowLeft' ? -16 : 16)));
    setPreferredWidth(nextWidth);
    saveWidth(nextWidth);
  };

  return {
    width,
    isResizing,
    separatorProps: {
      role: 'separator',
      tabIndex: 0,
      'aria-label': '调整文件栏宽度',
      'aria-orientation': 'vertical' as const,
      'aria-valuemin': MIN_WIDTH,
      'aria-valuemax': maxWidth,
      'aria-valuenow': width,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: finishResize,
      onPointerCancel: finishResize,
      onLostPointerCapture: finishResize,
      onKeyDown: handleKeyDown
    }
  };
}
