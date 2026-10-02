/**
 * 静态分享门户入口：挂载无需后端 API 的 Markdown 审阅应用。
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import ShareApp from './ShareApp';
import 'antd/dist/reset.css';
import '../web/global.less';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider theme={{
      token: {
        colorPrimary: '#e85d35',
        colorTextBase: '#18233a',
        colorBgBase: '#f5f0e6',
        fontFamily: 'Avenir Next, Avenir, PingFang SC, sans-serif',
        borderRadius: 10
      }
    }}>
      <AntApp><ShareApp /></AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
