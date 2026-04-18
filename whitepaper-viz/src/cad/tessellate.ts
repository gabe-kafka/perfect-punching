/**
 * OpenCascade TopoDS_Shape → three.js BufferGeometry.
 *
 * For every face in the shape we:
 *   - run BRepMesh_IncrementalMesh to build a triangulation,
 *   - walk the triangles, respecting face orientation,
 *   - push positions (applying the face's local TopLoc_Location),
 *   - keep face-local indices but offset into the global buffer.
 *
 * Edges are extracted as crisp line segments (endpoints only, which is
 * correct for rectangular solids; curves are polylined via EdgesGeometry
 * downstream if needed).
 */
import * as THREE from "three";
import type { OcInstance } from "./occ";

export interface TessellatedShape {
  geometry: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
}

export function tessellate(
  oc: OcInstance,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shape: any,
  deflection = 0.05,
): TessellatedShape {
  // Build the triangulation in-place on the shape's topology.
  new oc.BRepMesh_IncrementalMesh_2(shape, deflection, false, 0.5, false);

  const positions: number[] = [];
  const indices: number[] = [];
  let vOffset = 0;

  const faceExp = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  while (faceExp.More()) {
    const face = oc.TopoDS.Face_1(faceExp.Current());
    const loc = new oc.TopLoc_Location_1();
    const triHandle = oc.BRep_Tool.Triangulation(face, loc, 0);

    if (!triHandle.IsNull()) {
      const tri = triHandle.get();
      const nbNodes = tri.NbNodes();
      const nbTris = tri.NbTriangles();
      const trsf = loc.Transformation();

      const reversed =
        face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;

      for (let i = 1; i <= nbNodes; i++) {
        const p = tri.Node(i).Transformed(trsf);
        positions.push(p.X(), p.Y(), p.Z());
      }

      for (let i = 1; i <= nbTris; i++) {
        const t = tri.Triangle(i);
        let a = t.Value(1);
        let b = t.Value(2);
        let c = t.Value(3);
        if (reversed) {
          const tmp = b;
          b = c;
          c = tmp;
        }
        indices.push(vOffset + a - 1, vOffset + b - 1, vOffset + c - 1);
      }

      vOffset += nbNodes;
    }

    faceExp.Next();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeVertexNormals();

  // EdgesGeometry extracts sharp edges from the mesh — perfect for our
  // rectangular solids where every edge between two faces is a 90° crease.
  const edges = new THREE.EdgesGeometry(geometry, 20);

  return { geometry, edges };
}
