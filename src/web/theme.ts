/**
 * 主审阅页与静态分享页共用的 Ant Design 主题，统一组件配色、字体和圆角。
 */
import type { ThemeConfig } from 'antd';

export const reviewTheme: ThemeConfig = {
  token: {
    colorPrimary: '#2f6fed',
    colorSuccess: '#2f8f63',
    colorWarning: '#d59b2a',
    colorTextBase: '#16181d',
    colorBgBase: '#f4f6fa',
    fontFamily: '"SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif',
    borderRadius: 14
  }
};
