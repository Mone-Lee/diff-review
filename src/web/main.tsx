/**
 * Web 端入口文件：挂载 React 根组件并注入全局样式。
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './global.less';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
