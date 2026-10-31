declare module '*.svg' {
  const url: string;
  export default url;
}
declare module '*.css';

interface ImportMeta {
  readonly env: { readonly DEV: boolean; readonly PROD: boolean; readonly MODE: string };
}
