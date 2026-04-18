/**
 * R3F component that renders a rectangular solid via OpenCascade.js.
 *
 * Two-pass render for true hidden-line removal:
 *   1. `<mesh>` with colorWrite=false, depthWrite=true — invisible face
 *      that populates the z-buffer so downstream edges get occluded.
 *   2. `<lineSegments>` on an EdgesGeometry with depthTest=true — only
 *      the visible edges survive the z-test, giving the classic ASME
 *      Y14 drafted look.
 *
 * Until the WASM runtime has initialised, the component renders nothing;
 * callers can stack a wireframe fallback behind it if desired.
 */
import { useMemo } from "react";
import * as THREE from "three";
import { useOcc } from "./useOcc";
import { tessellate } from "./tessellate";

export interface OccBoxProps {
  x1: number; y1: number; z1: number;
  x2: number; y2: number; z2: number;
  edgeColor?: string;
  /** Suppress the invisible face fill — yields pure wireframe w/o HLR. */
  noHiddenLineRemoval?: boolean;
}

export function OccBox({
  x1, y1, z1, x2, y2, z2,
  edgeColor = "#1A1A1A",
  noHiddenLineRemoval = false,
}: OccBoxProps) {
  const oc = useOcc();

  const result = useMemo(() => {
    if (!oc) return null;
    try {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const dz = z2 - z1;
      const box = new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz).Shape();

      // translate to (x1, y1, z1)
      const trsf = new oc.gp_Trsf_1();
      trsf.SetTranslation_1(new oc.gp_Vec_4(x1, y1, z1));
      const transformed = new oc.BRepBuilderAPI_Transform_2(
        box, trsf, false,
      ).Shape();

      return tessellate(oc, transformed, 0.02);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("OccBox tessellation failed:", err);
      return null;
    }
  }, [oc, x1, y1, z1, x2, y2, z2]);

  if (!result) return null;

  return (
    <group>
      {!noHiddenLineRemoval && (
        <mesh geometry={result.geometry} renderOrder={0}>
          {/* Invisible but fills z-buffer — drives HLR. */}
          <meshBasicMaterial
            colorWrite={false}
            depthWrite
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </mesh>
      )}
      <lineSegments geometry={result.edges} renderOrder={1}>
        <lineBasicMaterial color={edgeColor} depthTest />
      </lineSegments>
    </group>
  );
}

// Dispose GPU memory when the component unmounts. R3F does this for
// geometries it owns, but we create raw BufferGeometry in useMemo.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _disposeNoop(_g: THREE.BufferGeometry) {}
