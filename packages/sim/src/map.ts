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
  /**
   * ═══ LE PALIER — L'ALTITUDE, ET ELLE EST UN ENTIER (spec R1, R36) ═══
   *
   * La donnée de premier ordre du relief, et la seule qui décide de quoi que ce soit : le rendu
   * soulève la tuile de `palier × STEP_PX` (une MARCHE par palier — spec R34), la garde A9 la lit
   * pour vérifier qu'on ne monte que par une rampe, et la falaise n'est rien d'autre que l'endroit
   * où deux paliers voisins se touchent.
   *
   * Il a longtemps vécu caché dans `CarteZonee`, et la carte n'exposait que son ombre — un flottant
   * `[0,1]`. C'était le mauvais sens : on dérivait le VRAI (l'entier) vers l'APPROCHÉ (le flottant),
   * puis le client rebâtissait péniblement des marches à partir du flottant. Désormais la carte
   * porte l'entier, et `elevation` n'est plus qu'une commodité pour qui pense encore en continu.
   *
   * Optionnel : les cartes de l'ancien générateur (`valleygen`) n'en produisent pas.
   */
  palier?: number[]
  /** Le palier le plus haut que la carte puisse porter — le diviseur d'`elevation`. */
  palierMax?: number
  /**
   * Altitude par tuile [0,1] — **une DÉRIVÉE du palier** (`palier / palierMax`), pas une vérité.
   * Elle survit pour ce qui pense en continu : la température (il fait froid en altitude), les
   * filtres d'éligibilité des lieux. Rien qui décide de la forme du monde. NE PAS confondre avec
   * `height` (dimension).
   */
  elevation?: number[]
  /**
   * LE CHAMP DE CENDRE — distance de chaque tuile à la frontière de la Cendrière, en tuiles.
   * Négative DEDANS, positive dehors. **Donnée STATIQUE** : calculée une fois, jamais modifiée.
   *
   * Ce qui bouge est ailleurs : `SimState.cendreFront`, **un seul nombre**. Une tuile brûle quand
   * `cendre[i] < front`. C'est ce qui rend le front de saison bon marché — on ne mute pas la
   * carte, on déplace un seuil (spec `worldgen.md` R31).
   */
  cendre?: number[]
  /**
   * L'AVANCÉE DU FRONT au dernier jour de la saison, EN TUILES — **calibrée pour CETTE carte**.
   *
   * Elle n'est pas une constante : la forme des zones change tout. Mesuré, à distance fixe, la
   * cendre couvrait 48 % des Prés Bas sur une seed et 81 % sur une autre. On vise donc une PART
   * (`CENDRE.PART_CIBLE`) et on en déduit la distance, par dichotomie, à la génération.
   */
  cendreMax?: number

  /**
   * ═══ LA ZONE, POUR LE CLIENT — et pourquoi elle est GROSSIÈRE ═══
   *
   * Le client ne peut pas distinguer deux zones à partir des TERRAINS : ils sont partagés (de
   * l'herbe pousse aux Prés Bas comme à la Combe aux Ruines). Sans la zone, aucune palette ne
   * rendra jamais le critère de lisibilité du directeur de jeu — *« d'un coup d'œil, savoir si
   * l'on est dans une zone facile ou difficile »*.
   *
   * Mais on ne lui envoie pas un entier par tuile : ce serait 2,5 M de nombres (~20 Mo) pour une
   * information qui varie **lentement**. On envoie une grille au pas de `zonePas` — et l'erreur
   * qu'elle commet (au plus deux tuiles au bord d'une zone) tombe **toujours dans la bande de
   * falaise**, qui fait quarante-quatre tuiles d'épaisseur et qu'on peint en noir. L'imprécision
   * est donc, littéralement, invisible.
   */
  zoneGrid?: number[]
  zonePas?: number
  /** L'identité de chaque zone, indexée par son id : de quoi bâtir une palette. */
  zoneDefs?: { slug: string; nom: string; tier: number }[]
}

/**
 * LA ZONE D'UNE TUILE, lue dans la grille de blocs. `undefined` sur une carte sans zones.
 *
 * ELLE EST EXACTE, et elle ne l'a pas toujours été. La grille était échantillonnée au pas de 4 et
 * lue par ARRONDI : une erreur de deux tuiles au bord d'une zone, réputée « invisible — elle tombe
 * dans la bande de falaise de 44 tuiles ». Cet argument est mort avec la bande (spec R33) : une
 * erreur de deux tuiles sur une arête d'UNE tuile se verrait comme le nez au milieu de la figure.
 *
 * Le rectiligne la rend exacte gratuitement : la zone est **constante par bloc** (spec R32), et la
 * grille est au pas du bloc. Une lecture au PLANCHER rend donc la vérité, exactement — il n'y a
 * plus d'erreur à cacher.
 */
export function zoneSlugAt(map: WorldMap, tx: number, ty: number): string | undefined {
  const grid = map.zoneGrid
  const pas = map.zonePas
  const defs = map.zoneDefs
  if (!grid || !pas || !defs) return undefined
  const cols = Math.ceil(map.width / pas)
  const i = Math.min(cols - 1, Math.max(0, Math.floor(tx / pas)))
  const j = Math.min(Math.ceil(map.height / pas) - 1, Math.max(0, Math.floor(ty / pas)))
  return defs[grid[j * cols + i] ?? 0]?.slug
}

/** Le PALIER d'une tuile (entier). Hors carte ou carte sans relief = 0. */
export function palierAt(map: WorldMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 0
  return map.palier?.[ty * map.width + tx] ?? 0
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
