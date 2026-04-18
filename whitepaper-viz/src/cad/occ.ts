/**
 * OpenCascade.js singleton loader.
 *
 * The WASM blob is ~60 MB uncompressed (~15 MB brotli). We load exactly
 * once per tab, cache the instance, and hand it out to any caller that
 * wants B-rep primitives or tessellation.
 */
import { initOpenCascade } from "opencascade.js";

// The `opencascade.js` type-less package — cast to `any` to avoid churn.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OcInstance = any;

let _oc: OcInstance | null = null;
let _pending: Promise<OcInstance> | null = null;

export function getOc(): Promise<OcInstance> {
  if (_oc) return Promise.resolve(_oc);
  if (_pending) return _pending;
  const p = initOpenCascade().then((oc: OcInstance) => {
    _oc = oc;
    return oc;
  });
  _pending = p;
  return p;
}

export function ocReady(): boolean {
  return _oc !== null;
}
