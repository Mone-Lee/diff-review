/**
 * Web 端入口文件：挂载 React 根组件并注入全局样式。
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import App from './App';
import { reviewTheme } from './theme';
import 'antd/dist/reset.css';
import './global.less';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider theme={reviewTheme}>
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
