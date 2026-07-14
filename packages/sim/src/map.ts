/**
 * La carte — grille de terrains + zones nommées (spec monde R5-R8).
 *
 * Le déplacement est continu (positions en flottants) ; la grille ne décrit
 * que le décor. La tuile est l'unité de distance de /sim — le rendu en pixels
 * est une affaire de /client.
 */
import { POI, TERRAINS } from './balance'

/** Rectangle nommé — landmark de chronique, future zone interdite, futur room. */
export interface Zone {
  name: string
  x: number
  y: number
  w: number
  h: number
  /** Rôle mécanique optionnel (ex. 'gisement' : accueille le T2 — spec économie R3). */
  kind?: string
}

export interface WorldMap {
  width: number
  height: number
  /** Id de terrain par tuile, row-major (index = y * width + x). */
  terrain: number[]
  zones: Zone[]
  /** Altitude par tuile [0,1] (substrat alpin). Optionnel — absent sur les
   *  cartes qui n'en produisent pas. NE PAS confondre avec `height` (dimension). */
  elevation?: number[]
}

export function createEmptyMap(width: number, height: number, fillTerrainId: number): WorldMap {
  return {
    width,
    height,
    terrain: new Array<number>(width * height).fill(fillTerrainId),
    zones: [],
  }
}

/** Id de terrain à une tuile. Hors carte = void (0). */
export function terrainAt(map: WorldMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 0
  return map.terrain[ty * map.width + tx] ?? 0
}

/** Altitude à une tuile [0,1]. Hors carte ou absent = 0. */
export function elevationAt(map: WorldMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 0
  return map.elevation?.[ty * map.width + tx] ?? 0
}

/** Une tuile bloque-t-elle le déplacement ? Hors carte et terrain inconnu bloquent. */
export function isBlockingTile(map: WorldMap, tx: number, ty: number): boolean {
  const def = TERRAINS[terrainAt(map, tx, ty)]
  return def === undefined || !def.walkable
}

/** Première zone nommée contenant le point (x, y), ou undefined. */
export function zoneAt(map: WorldMap, x: number, y: number): Zone | undefined {
  return map.zones.find((z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h)
}

/**
 * Les `poiId` de TOUTES les zones-POI contenant le point (spec lieux R6).
 * Le poiId EST l'index dans `map.zones` (spec R4) — `placePois` est déterministe,
 * donc cet index est stable pour une seed donnée. Une zone sans `kind` est un
 * simple toponyme, jamais un lieu.
 *
 * On retourne toutes les zones, pas la première (contrairement à `zoneAt`) :
 * deux empreintes de POI peuvent se recouvrir.
 */
export function poisAt(map: WorldMap, x: number, y: number): number[] {
  const out: number[] = []
  for (let i = 0; i < map.zones.length; i += 1) {
    const z = map.zones[i]!
    if (z.kind === undefined) continue
    if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) out.push(i)
  }
  return out
}

/**
 * LA CLAIRIÈRE — les tuiles où rien ne pousse autour d'un lieu.
 *
 * Un lieu enseveli sous les arbres n'est pas un lieu : on ne le voit pas de
 * loin, on ne sait pas qu'on y est arrivé. Chaque POI dégage donc un DISQUE
 * autour de lui (son empreinte + `POI.CLEARING_MARGIN_TILES`), d'où `generateNodes`
 * (arbres, rochers, buissons) et le décor du client sont bannis.
 *
 * Une seule source de vérité, partagée : si la sim et le rendu ne dégageaient
 * pas les mêmes tuiles, on verrait des buissons pousser dans une clairière vide
 * de nœuds — ou l'inverse.
 *
 * Les **gisements** et **carrières** sont EXCLUS : leur raison d'être est
 * précisément d'être couverts de minerai (`generateNodes` les remplit). On ne
 * dégage pas une mine.
 *
 * Retourne un `Set` d'index de tuile (`ty * width + tx`) — local à l'appelant,
 * jamais dans le `SimState` (invariant : l'état de sim est JSON-sérialisable).
 * Calculé une fois (≈ 80 zones × un petit disque), consulté en O(1).
 */
export function poiClearings(map: WorldMap): Set<number> {
  const cleared = new Set<number>()
  for (const z of map.zones) {
    if (z.kind === undefined) continue
    if (z.kind === 'gisement' || z.kind === 'carriere') continue // une mine ne se dégage pas
    // Rayon = demi-empreinte + marge. Le lieu respire, quelle que soit sa taille.
    const r = Math.max(z.w, z.h) / 2 + POI.CLEARING_MARGIN_TILES
    const r2 = r * r
    const cx = z.x + z.w / 2
    const cy = z.y + z.h / 2
    const x0 = Math.max(0, Math.floor(cx - r))
    const x1 = Math.min(map.width - 1, Math.ceil(cx + r))
    const y0 = Math.max(0, Math.floor(cy - r))
    const y1 = Math.min(map.height - 1, Math.ceil(cy + r))
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        // Centre de la tuile — distance AU CARRÉ (invariant #2 : pas de sqrt inutile).
        const dx = tx + 0.5 - cx
        const dy = ty + 0.5 - cy
        if (dx * dx + dy * dy <= r2) cleared.add(ty * map.width + tx)
      }
    }
  }
  return cleared
}

/** Centre d'une zone, en tuiles. */
export function poiCenter(z: Zone): { x: number; y: number } {
  return { x: z.x + z.w / 2, y: z.y + z.h / 2 }
}

/**
 * LA PENTE MAXIMALE VERS LE SUD — le contrat que `/sim` doit au rendu.
 *
 * Le client donne du relief en soulevant chaque tuile de `elevation × RELIEF_H`
 * pixels vers le haut de l'écran. Si le sol descend vers le sud (`ty` croissant)
 * plus vite que `TILE_PX / RELIEF_H` par tuile, deux tuiles voisines se croisent
 * à l'écran : **l'image se replie sur elle-même**, la tuile du fond passe devant
 * celle du devant, et plus rien n'est lisible. Le client refuse alors de démarrer
 * (`assertNoFold`, WorldScene.ts — sans garde de développement : c'est une
 * exception, pas un avertissement).
 *
 * CETTE FONCTION VIVAIT DANS LE CLIENT. C'était le mauvais côté de la frontière :
 * le client ne fait que CONSTATER la faute, il ne peut pas la commettre. Le champ
 * d'élévation est produit par `/sim`, et c'est donc `/sim` qui doit garantir qu'il
 * est rendable — et le tester (`worldgen.test.ts`, sur la vraie carte et plusieurs
 * seeds). Le 2026-07-14, **4 seeds sur 16 dépassaient le plafond** : le jeu ne
 * démarrait pas. Personne ne le voyait, parce que le mode Veillée code la seed
 * 2026 en dur — et elle passait.
 */
export function maxSouthGradient(elevation: readonly number[], width: number, height: number): number {
  let max = 0
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      const g = elevation[(y + 1) * width + x]! - elevation[y * width + x]!
      if (g > max) max = g
    }
  }
  return max
}
