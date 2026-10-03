/**
 * 静态分享门户入口：挂载无需后端 API 的 Markdown 审阅应用。
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import ShareApp from './ShareApp';
import { reviewTheme } from '../web/theme';
import 'antd/dist/reset.css';
import '../web/global.less';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider theme={reviewTheme}>
      <AntApp><ShareApp /></AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
