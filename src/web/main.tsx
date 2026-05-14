/**
 * Web 端入口文件：挂载 React 根组件并注入全局样式。
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import App from './App';
import 'antd/dist/reset.css';
import './global.less';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#2f6fed',
          colorSuccess: '#2f8f63',
          colorWarning: '#d59b2a',
          colorTextBase: '#16181d',
          colorBgBase: '#f4f6fa',
          fontFamily: '"SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif',
          borderRadius: 14
        }
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
