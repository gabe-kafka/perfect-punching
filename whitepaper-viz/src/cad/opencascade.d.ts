// Minimal declaration so TS accepts the untyped opencascade.js package.
// The runtime API is wide; we treat instances as any (see OcInstance).
declare module "opencascade.js" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const initOpenCascade: () => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export default initOpenCascade;
}
