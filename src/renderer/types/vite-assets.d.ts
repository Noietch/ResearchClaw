// Allow importing assets with Vite's ?url suffix
declare module '*.mjs?url' {
  const url: string;
  export default url;
}

declare module '*.png' {
  const src: string;
  export default src;
}
