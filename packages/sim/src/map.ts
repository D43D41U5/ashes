/**
 * La carte — grille de terrains + zones nommées (spec monde R5-R8).
 *
 * Le déplacement est continu (positions en flottants) ; la grille ne décrit
 * que le décor. La tuile est l'unité de distance de /sim — le rendu en pixels
 * est une affaire de /client.
 */
import { POI, TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER, TERRAINS } from './balance'

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

/**
 * UN FAIT DE GÉNÉRATION (spec `stratigraphie.md` S-R16) — une ligne de l'état civil du monde
 * d'avant. Méthode Caves of Qud : des faits ESTAMPILLÉS par les passes qui les créent, jamais
 * d'agents simulés. Les toponymes les lisent déjà (le sort des lieux bâtis) ; les stèles, les
 * rumeurs et la chronique des couches suivantes les liront demain. JSON-sérialisable, comme
 * tout ce qui vit dans `WorldMap`.
 */
export interface FaitDeGeneration {
  /** L'ère : 0 = la pierre et l'eau (ce qui précède l'humain), 1 = l'implantation (on
   *  s'installe), 2 = les routes (on circule), 3 = la Cendre (on meurt ou l'on fuit). */
  ere: 0 | 1 | 2 | 3
  /**
   * LE VOCABULAIRE (spec `annales.md` R2 — chaque type DÉRIVE de ce que sa passe calcule déjà,
   * jamais d'une simulation) : `fondation`/`sort` (le lieu bâti : pourquoi on s'y est mis, ce
   * que la Cendre en a fait), `gue` (où la sente croise la rivière), `gravure` (une écriture
   * plus vieille que les routes — les pierres), `essart` (le pré artificiel : le dégagement a
   * mangé du bois), `taille` (la mine est là parce que la roche affleure), `guet` (la Tour +
   * la direction de la Cendrière — « ils savaient »), `porte` (le pays d'avant bornait ses
   * seuils), `croisee` (des routes se sont trouvées là — le carrefour émergé), `fosse` (où la
   * vallée a enterré), `fuite` (la charrette orientée loin du front — l'exode a un sens).
   */
  type:
    | 'fondation' | 'gue' | 'sort'
    | 'gravure' | 'essart' | 'taille' | 'guet'
    | 'porte' | 'croisee' | 'fosse' | 'fuite'
  x: number
  y: number
  /** Le kind du lieu concerné (fondation, sort, et les faits portés par un lieu). */
  lieu?: string
  /** La cause LISIBLE : 'eau' | 'route' (fondation), 'brule' | 'pille' | 'intact' (sort),
   *  'fer' | 'charbon' (taille), 'nord' | 'sud' | 'est' | 'ouest' (guet, fuite — des MOTS,
   *  jamais des degrés : le pays d'avant n'a pas de boussole graduée, spec R3),
   *  'secours' (porte de secours). */
  cause?: string
}

export interface WorldMap {
  width: number
  height: number
  /** Id de terrain par tuile, row-major (index = y * width + x). */
  terrain: number[]
  zones: Zone[]
  /** LES ANNALES — les faits de génération, dans l'ordre d'émission (S-R16). */
  annales?: FaitDeGeneration[]
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
  /**
   * LES SEUILS, DONNÉE DE PREMIER ORDRE (spec t0-exploration R20). Le client les devinait
   * jusqu'ici par le NOM de leurs toponymes (« le seuil de… ») — fragile. Ils portent :
   * la position du couloir, son axe de traversée (`ax`,`ay` — celui du percement), le
   * drapeau de secours (le second passage, toujours pire — R11), et le nom de la zone de
   * destination. Consommateurs : les BORNES de seuil (client, R4 — le seuil s'annonce),
   * l'onglet carte, et demain les toponymes eux-mêmes. Additif et JSON-sérialisable.
   */
  seuils?: { x: number; y: number; ax: number; ay: number; secours: boolean; vers: string }[]
  /**
   * LE FIL DE LA RIVIÈRE, amont → aval (spec eau-vivante R15) : les index de tuile du fil,
   * dans l'ordre du tracé. Une DONNÉE sérialisable, additive — aucune règle de sim ne la
   * lit aujourd'hui ; le client en dérive le SENS DU COURANT (feuilles qui dérivent). Le
   * jour où le courant POUSSE (objets, nage), ce sera une décision de design à part.
   */
  fil?: number[]
  /**
   * LA PROFONDEUR INTRA-MASSIF (spec t0-exploration §2quater R38) : par tuile, la distance au
   * bord de son massif boisé de la Racine (érosion 8-connexe, plafonnée à `CREUX.PROF_CAP`),
   * 0 partout ailleurs. **Donnée STATIQUE, gelée à l'amorce** — comme `cendre` : calculée une
   * fois, jamais mutée (`carte-immuable` la garde). Le feu qui ronge un bord ne recalcule
   * rien ; un bonus ne s'applique jamais sur une tuile qui n'est plus boisée (le bonus meurt
   * avec l'arbre, l'étiquette survit, inerte). Additive : une carte d'avant se relit sans.
   */
  profondeur?: number[]
  /**
   * LES COULÉES (forêts-vivantes §4 R5) : les chemins de terre du gibier, couche → eau.
   * Index de tuile DANS L'ORDRE du tracé, chemins séparés par -1. Donnée STATIQUE, gelée à
   * l'amorce (hachée par `carte-immuable`), additive : une carte d'avant se relit sans. Le
   * rendu en dérive le décal d'usure (pente continue sur la position), les passes de nœuds
   * la lisent comme stérilité (via les `occupees` de `placeZoneNodes`).
   */
  coulees?: number[]
  /**
   * LES AFFLEUREMENTS du monde réduit (t0-exploration §2sexies), DONNÉE DE PREMIER ORDRE —
   * le patron « les seuils → les bornes » : le client en dérive la teinte du pierrier, les
   * dalles et le chicot SANS deviner par le terrain (le pierrier du Karst reste neutre).
   * Additive : une carte d'avant (ou la vallée complète) se relit sans — aucune butte, rien
   * à teinter. Aucune règle de sim ne la lit.
   */
  affleurements?: { x: number; y: number; w: number; h: number; ressource: 'fer' | 'charbon' }[]
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

/**
 * L'ID DE ZONE d'une tuile, lu dans la grille de blocs. **-1 sur une carte sans zones.**
 *
 * La zone est constante par bloc (spec R32) et la grille est au pas du bloc : une lecture au
 * plancher rend donc la vérité, exactement. C'est ce qui permet à la garde de connexité de
 * `carveDistanceToMain` d'interdire à un tunnel de lieu de traverser une frontière de zone —
 * l'ancien rôle du saut de palier, tenu désormais par l'égalité de zone. Sur une carte sans zones
 * (l'ancien générateur `valleygen`), le -1 partout rend la garde inerte : comportement préservé.
 */
/**
 * LE TIER D'UNE ZONE à une tuile (0 = racine/hors-zone, 1 = ceinture riche, 2 = marges).
 * Lu au bloc, comme `zoneSlugAt`. `0` sur une carte sans zones (bancs de test) → un
 * consommateur qui module par le tier (le gradient de danger V2-19) reste inerte là, comme
 * `predatorBias` l'est sans `home` : on n'impose pas une géographie à qui ne l'a pas.
 */
export function zoneTierAt(map: WorldMap, tx: number, ty: number): number {
  const grid = map.zoneGrid
  const pas = map.zonePas
  const defs = map.zoneDefs
  if (!grid || !pas || !defs) return 0
  const cols = Math.ceil(map.width / pas)
  const i = Math.min(cols - 1, Math.max(0, Math.floor(tx / pas)))
  const j = Math.min(Math.ceil(map.height / pas) - 1, Math.max(0, Math.floor(ty / pas)))
  return defs[grid[j * cols + i] ?? 0]?.tier ?? 0
}

export function zoneIdAt(map: WorldMap, tx: number, ty: number): number {
  const grid = map.zoneGrid
  const pas = map.zonePas
  if (!grid || !pas) return -1
  const cols = Math.ceil(map.width / pas)
  const i = Math.min(cols - 1, Math.max(0, Math.floor(tx / pas)))
  const j = Math.min(Math.ceil(map.height / pas) - 1, Math.max(0, Math.floor(ty / pas)))
  return grid[j * cols + i] ?? -1
}

export function createEmptyMap(width: number, height: number, fillTerrainId: number): WorldMap {
  return {
    width,
    height,
    terrain: new Array<number>(width * height).fill(fillTerrainId),
    zones: [],
  }
}

/**
 * LA MARCHABILITÉ, À PLAT — `MARCHABLE[id] === 1` ⇔ `TERRAINS[id]?.walkable === true`.
 *
 * Les parcours en largeur (connexité, percement, worldgen) posent cette question des dizaines de
 * millions de fois par génération. La poser à `TERRAINS` — objet à clés numériques, plus un
 * chaînage optionnel — coûte un accès de propriété ; la poser à un `Uint8Array` coûte une lecture.
 *
 * Le tableau est DÉRIVÉ de `TERRAINS` : il ne peut pas se désynchroniser. Hors table (id absent
 * ou négatif) la lecture rend `undefined`, donc `!== 1`, donc bloquant — exactement ce que
 * rendaient `TERRAINS[id] === undefined || !walkable` et `?.walkable === true`. Et `TERRAINS[0]`
 * (`void`) est lui-même non marchable, donc le `?? 0` de `terrainAt` sur un trou de tableau tombe
 * sur la même réponse.
 */
export const MARCHABLE: Uint8Array = ((): Uint8Array => {
  const t = new Uint8Array(256)
  for (const [id, def] of Object.entries(TERRAINS)) {
    const i = Number(id)
    if (i >= 0 && i < 256 && def.walkable === true) t[i] = 1
  }
  return t
})()

/** Id de terrain à une tuile. Hors carte = void (0). */
export function terrainAt(map: WorldMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 0
  return map.terrain[ty * map.width + tx] ?? 0
}

/**
 * LA PROFONDEUR INTRA-MASSIF d'une tuile (spec §2quater). **0 sans le champ** — carte d'avant
 * l'étage 2, banc de test, hors carte : un consommateur qui module par la profondeur reste
 * inerte là, comme `zoneTierAt` sans zones — on n'impose pas une géographie à qui ne l'a pas.
 */
export function profondeurAt(map: WorldMap, tx: number, ty: number): number {
  const p = map.profondeur
  if (!p || tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 0
  return p[ty * map.width + tx] ?? 0
}

/**
 * Écrit un id de terrain. Le MIROIR exact de `terrainAt` — même borne, même
 * indexation —, et c'est pourquoi il vit ici : une lecture et une écriture qui
 * ne partagent pas leur garde de bord finissent toujours par diverger.
 * Hors carte : sans effet (on ne peint pas le vide).
 */
export function setTile(map: WorldMap, tx: number, ty: number, id: number): void {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return
  map.terrain[ty * map.width + tx] = id
}

/** Une tuile bloque-t-elle le déplacement ? Hors carte et terrain inconnu bloquent. */
export function isBlockingTile(map: WorldMap, tx: number, ty: number): boolean {
  const def = TERRAINS[terrainAt(map, tx, ty)]
  return def === undefined || !def.walkable
}

/**
 * CE QUI EST DE L'EAU — la définition, en un seul endroit.
 *
 * Elle était recopiée en clair (`t === SHALLOW || t === DEEP`) sur sept sites du
 * worldgen. Tant que l'eau n'a que deux terrains, sept copies se valent ; le jour
 * où un troisième apparaît (un gué, une eau saumâtre), six d'entre elles
 * cesseraient silencieusement de le voir — et l'eau qui commande la faune
 * (spec faune R17) déciderait juste ici et faux là.
 *
 * ⚠ `TERRAIN_MARSH` n'en est PAS : le marais se traverse. Les sites qui veulent
 * les deux écrivent `isWater(t) || t === TERRAIN_MARSH`, et ça se lit.
 */
export function isWater(t: number): boolean {
  return t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER
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
    // Un SET-PIECE ne se dégage pas non plus (spec t0-exploration R10) : son corps est son
    // terrain, son contenu est sa raison d'être — le Bois Noir SANS ses arbres serait un pré.
    if (POI.SET_PIECE_KINDS.includes(z.kind)) continue
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
