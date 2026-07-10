/**
 * Géométrie PURE du sol déformé — grille de sommets `x,y,u,v` soulevée par
 * l'élévation (spec relief-continu §4.1), fenêtrée à la vue caméra. Aucun
 * import Phaser ici (testable en Node) : le wrapper `Mesh2D` vit dans
 * `scenes/world/ground-layer.ts`.
 */

/** Sommets `x,y,u,v` (step 4) + indices `a,b,c,page` (step 4) d'une fenêtre de
 *  grille [tx0..tx1]×[ty0..ty1], déformée par `lift` (px) aux coins ENTIERS
 *  (partagés entre tuiles voisines → surface continue, sans couture).
 *  UV = coin/dimension carte → échantillonne la texture `map-demo`. */
export function gridMesh(
  tx0: number,
  ty0: number,
  tx1: number,
  ty1: number,
  lift: (x: number, y: number) => number,
  tilePx: number,
  mapW: number,
  mapH: number,
): { vertices: number[]; indices: number[] } {
  const cols = tx1 - tx0 + 1
  const rows = ty1 - ty0 + 1
  const vertsPerRow = cols + 1
  const vertices: number[] = []
  for (let gy = ty0; gy <= ty1 + 1; gy++) {
    for (let gx = tx0; gx <= tx1 + 1; gx++) {
      vertices.push(gx * tilePx, gy * tilePx - lift(gx, gy), gx / mapW, gy / mapH)
    }
  }
  const indices: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * vertsPerRow + c
      const b = a + 1
      const d = a + vertsPerRow
      const e = d + 1
      indices.push(a, b, e, 0, a, e, d, 0) // deux triangles, page 0
    }
  }
  return { vertices, indices }
}
