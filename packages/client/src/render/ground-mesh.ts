/**
 * Géométrie PURE du sol en MARCHES — une grille de quads INDÉPENDANTS, chacun soulevé du lift de
 * sa tuile (spec R34). Aucun import Phaser (testable en Node) : le wrapper `Mesh2D` vit dans
 * `scenes/world/ground-layer.ts`.
 *
 * ═══ POURQUOI LES QUADS SONT INDÉPENDANTS, ET C'EST TOUT LE SUJET ═══
 *
 * La version précédente partageait les sommets aux coins ENTIERS entre tuiles voisines — exprès :
 * *« partagés entre tuiles voisines → surface continue, sans couture »*. C'était juste, pour un
 * relief continu. C'est **exactement le contraire de ce qu'il faut** pour des marches : un coin
 * partagé entre une terrasse haute et sa voisine basse ne peut pas être aux deux hauteurs à la
 * fois. Il prend une valeur moyenne, et la marche devient une RAMPE — un biseau d'une tuile de
 * large, tout le long de chaque falaise de la carte. La verticalité qu'on vient de gagner dans la
 * sim se reperdrait dans le rendu, en silence.
 *
 * Chaque tuile porte donc ses quatre sommets à elle. La « couture » qu'on redoutait n'existe pas :
 * deux tuiles de même palier ont des coins rigoureusement confondus, et deux tuiles de paliers
 * différents DOIVENT se décoller — c'est la marche.
 *
 * L'ordre de dessin est celui du balayage, nord → sud : une tuile méridionale est émise APRÈS ce
 * qu'elle recouvre. L'occlusion des terrasses est donc juste, sans tri ni depth-buffer.
 */

/** Sommets `x,y,u,v` (step 4) + indices `a,b,c,page` (step 4) d'une fenêtre de grille
 *  [tx0..tx1]×[ty0..ty1]. Chaque tuile est un QUAD À ELLE, soulevé de `lift(tx, ty)` px (constant
 *  sur la tuile). UV = coin/dimension carte → échantillonne la texture `map-demo`. */
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
  const vertices: number[] = []
  const indices: number[] = []
  let n = 0
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const h = lift(tx, ty)
      const x0 = tx * tilePx
      const x1 = (tx + 1) * tilePx
      const y0 = ty * tilePx - h
      const y1 = (ty + 1) * tilePx - h
      const u0 = tx / mapW
      const u1 = (tx + 1) / mapW
      const v0 = ty / mapH
      const v1 = (ty + 1) / mapH
      vertices.push(x0, y0, u0, v0, x1, y0, u1, v0, x1, y1, u1, v1, x0, y1, u0, v1)
      indices.push(n, n + 1, n + 2, 0, n, n + 2, n + 3, 0) // deux triangles, page 0
      n += 4
    }
  }
  return { vertices, indices }
}
