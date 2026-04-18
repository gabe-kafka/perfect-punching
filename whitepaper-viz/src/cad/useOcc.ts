/**
 * React hook wrapping getOc(). Returns null while the WASM binary
 * streams + Emscripten boots, then the live OpenCascade instance.
 */
import { useEffect, useState } from "react";
import { getOc, type OcInstance } from "./occ";

export function useOcc(): OcInstance | null {
  const [oc, setOc] = useState<OcInstance | null>(null);

  useEffect(() => {
    let alive = true;
    getOc().then((instance) => {
      if (alive) setOc(instance);
    });
    return () => {
      alive = false;
    };
  }, []);

  return oc;
}
