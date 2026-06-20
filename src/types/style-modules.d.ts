/**
 * 样式模块类型声明：为 TypeScript 提供 less/css 模块导入的静态类型，避免前端样式资源报错。
 */
declare module '*.module.less' {
  const classes: Record<string, string>;
  export default classes;
}

declare module '*.less';

declare module '*.css';
