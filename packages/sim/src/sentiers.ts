/**
 * LES SENTIERS — ce que les gens ont fini par emprunter.
 *
 * LE PROBLÈME. La vallée porte des lieux (75), un fleuve traversant et sept gués.
 * Rien ne les relie. Le joueur voit 35×20 tuiles à l'écran : à cette focale, une
 * vallée de 1200×1800 est un brouillard de vingt-cinq écrans de large, où l'on
 * marche au hasard jusqu'à tomber sur quelque chose. Un fleuve infranchissable
 * sauf en sept points est une bonne idée de topologie — et une punition, tant que
 * rien ne dit **où sont les sept points**.
 *
 * LE PRINCIPE. On ne dessine pas des routes : on trace ce que les gens ont fini par
 * emprunter. Un plus-court-chemin (Dijkstra) part du point de départ et rejoint ce
 * qui compte — les gués, les lieux chargés, les gisements. Le coût d'une tuile est
 * l'inverse de sa vitesse : le sentier préfère l'herbe à la tourbière, contourne la
 * roche, longe la forêt. Ce sont des chemins de désir, pas des voies romaines.
 *
 * ET LE SENTIER TROUVE LE GUÉ TOUT SEUL. C'est la propriété qui rend tout ça juste :
 * le fleuve n'est franchissable qu'aux gués, donc tout chemin qui doit passer d'une
 * rive à l'autre y passe **nécessairement**. On n'a rien à coder pour ça — la
 * géographie le fait. Et comme le sentier VIENT DE LOIN, il ne se contente pas de
 * marquer la porte : il y mène. (Un chemin peint seulement au franchissement serait
 * un auto-but : on ne trouverait le panneau qu'une fois déjà arrivé.)
 *
 * LES CHEMINS SE CONFONDENT. Ils sortent tous du même Dijkstra, donc ils partagent
 * leurs troncs et ne divergent qu'aux embranchements — exactement comme un vrai
 * réseau : une grand-route qui se ramifie, pas vingt rayons parallèles.
 *
 * ON FRANCHIT UN RUISSEAU, ON NE PONTE PAS UN FLEUVE. Le sentier pose ses pierres
 * de gué dans une eau basse — un filet de fonte, une mare — mais jamais dans le
 * fleuve : au gué, on PATAUGE (vitesse 0,5). Le franchissement reste une décision
 * qui se paie ; un pont l'annulerait, et avec lui tout ce que le fleuve sépare. La
 * distinction se lit sur le terrain : le fleuve a un cœur d'eau PROFONDE, un
 * ruisseau n'en a pas.
 *
 * Pur et déterministe : coûts entiers, tas binaire départagé par index, zéro aléa.
 */
import { TERRAIN_DEEP_WATER, TERRAIN_ROAD, TERRAINS } from './balance'
import { walkableSpawn } from './connectivity'
import { isBlockingTile, type WorldMap } from './map'
import { hash2 } from './noise'
import { isWater } from './valleygen-primitives'

/** Constantes de tracé — contenu de carte. */
export const SENTIERS = {
  /**
   * Échelle des coûts. Le coût de base d'une tuile vaut `UNIT / speedFactor`,
   * arrondi : de 51 (route) à 142 (tourbière). Entier → Dijkstra exact, sans
   * flottant, donc déterministe au bit près entre moteurs (invariant n°2).
   */
  UNIT: 64,
  /**
   * LE PRIX DE LA PENTE — et sans lui, les sentiers étaient un plan de ville.
   *
   * Sur un terrain uniforme, tous les chemins monotones d'un point à un autre
   * coûtent EXACTEMENT la même chose en 4-connexité (c'est la distance de
   * Manhattan). Dijkstra en choisit donc un au hasard du départage — par index,
   * donc en longues droites d'axe. Le premier réseau tracé ressemblait à un
   * circuit imprimé : des kilomètres de ligne droite et des virages à angle droit,
   * sur une carte qui n'a pas un seul angle droit.
   *
   * Le remède n'est pas de lisser après coup : c'est de donner au coût une
   * PHYSIONOMIE. Un vrai sentier évite de grimper — il longe la courbe de niveau,
   * quitte à rallonger. On paie donc la dénivelée : `SLOPE × |Δaltitude|`. Il n'y a
   * plus d'égalité, plus de départage arbitraire, et le chemin épouse le relief.
   *
   * 900 : une pente de 2 % (un dénivelé de 0,02 par tuile) coûte 18, soit près
   * d'un tiers d'une tuile d'herbe. Assez pour qu'on contourne une bosse, pas assez
   * pour qu'on refuse une montée.
   */
  SLOPE: 900,
  /**
   * Le grain du terrain — un dernier bruit d'un ou deux points, qui casse les
   * égalités qui SUBSISTENT (sur un vrai plat, la pente ne départage rien). Sans
   * lui, le fond de vallée reprend ses lignes droites.
   */
  GRAIN: 6,
  /** Demi-largeur du sentier, en tuiles. 0 = une tuile de large. */
  HALF_WIDTH: 0,
}

const INF = 0x7fffffff
const NX = [1, -1, 0, 0]
const NY = [0, 0, 1, -1]

/**
 * Le coût d'ENTRER sur la tuile (nx, ny) en venant de (cx, cy). `INF` =
 * infranchissable.
 *
 * Trois termes : le terrain (l'inverse de sa vitesse), la PENTE qu'il faut gravir
 * ou dévaler, et un grain déterministe qui casse les dernières égalités. Le tout
 * en entiers — Dijkstra reste exact, et le réseau identique sur tout moteur.
 */
function stepCost(map: WorldMap, cx: number, cy: number, nx: number, ny: number): number {
  if (isBlockingTile(map, nx, ny)) return INF
  const def = TERRAINS[map.terrain[ny * map.width + nx] ?? 0]
  const s = def?.speedFactor ?? 0
  if (s <= 0) return INF

  let c = Math.round(SENTIERS.UNIT / s)
  const el = map.elevation
  if (el) {
    const d = el[ny * map.width + nx]! - el[cy * map.width + cx]!
    c += Math.round(SENTIERS.SLOPE * (d < 0 ? -d : d)) // monter ou descendre, ça se paie
  }
  c += Math.floor(hash2(nx, ny, 0x53454e54) * SENTIERS.GRAIN) // 'SENT' — le grain du sol
  return c
}

/**
 * Les DESTINATIONS — ce qui mérite qu'un chemin y mène.
 *
 * Pas tous les lieux : un sentier vers chacune des soixante-quinze zones ferait de
 * la vallée un plat de spaghettis, et plus rien ne signifierait rien. On relie ce
 * qui structure :
 *   • les GUÉS — les seuls points de passage du fleuve. Le sentier y mène de loin,
 *     et c'est là tout l'intérêt ;
 *   • les LIEUX CHARGÉS (`reserve`) — ceux qui portent une mécanique : le Belvédère,
 *     la Source chaude, le Sanctuaire… ce qu'on cherche ;
 *   • les GISEMENTS et CARRIÈRES — la seule vraie progression du jeu (le fer et le
 *     charbon ne naissent QUE là), donc la seule vraie raison d'aller loin.
 */
function destinations(map: WorldMap, chargesSlugs: ReadonlySet<string>): number[] {
  const out: number[] = []
  for (const z of map.zones) {
    const estGue = z.kind === undefined && z.name.startsWith('le Gué')
    const estCharge = z.kind !== undefined && chargesSlugs.has(z.kind)
    const estMine = z.kind === 'gisement' || z.kind === 'carriere'
    if (!estGue && !estCharge && !estMine) continue
    const cible = arrivee(map, z)
    if (cible >= 0) out.push(cible)
  }
  return out
}

/**
 * OÙ LE CHEMIN ARRIVE — une tuile PRATICABLE du lieu, la plus proche de son centre.
 *
 * Pas le centre géométrique : **il est souvent bloquant**. Un Belvédère ou un
 * Sanctuaire naît sur la roche, et le générateur ne lui perce qu'UNE tuile d'entrée
 * (« le lieu creuse son seuil ») — les trois autres de son empreinte restent du
 * minéral. Viser le centre revenait alors à viser un mur : Dijkstra n'y allait pas,
 * aucun chemin n'était tracé, et le lieu chargé restait au bout de nulle part.
 * (C'est exactement ce que la garde a attrapé — le Belvédère de la seed du jeu et le
 * Sanctuaire de la 99.)
 *
 * Départage par balayage row-major sur la distance au carré : déterministe, sans aléa.
 */
function arrivee(map: WorldMap, z: { x: number; y: number; w: number; h: number }): number {
  const cx = z.x + (z.w - 1) / 2
  const cy = z.y + (z.h - 1) / 2
  let best = -1
  let bestD = Infinity
  for (let ty = Math.max(0, z.y); ty < Math.min(map.height, z.y + z.h); ty++) {
    for (let tx = Math.max(0, z.x); tx < Math.min(map.width, z.x + z.w); tx++) {
      if (isBlockingTile(map, tx, ty)) continue
      const dx = tx - cx
      const dy = ty - cy
      const d = dx * dx + dy * dy
      if (d < bestD) { bestD = d; best = ty * map.width + tx }
    }
  }
  return best
}

/**
 * Trace le réseau et le peint en `TERRAIN_ROAD`.
 *
 * `chargesSlugs` = les types de lieu qui méritent un chemin (ceux à `reserve`).
 * On le passe en paramètre plutôt que de lire `POI_TYPES` : `poi.ts` importe déjà
 * ce module en aval, et un cycle d'import n'apprend rien à personne.
 */
export function paintSentiers(map: WorldMap, chargesSlugs: ReadonlySet<string>): void {
  const W = map.width
  const H = map.height
  const N = W * H
  const spawn = walkableSpawn(map)
  const src = Math.floor(spawn.y) * W + Math.floor(spawn.x)

  // ── Dijkstra depuis le point de départ, sur le coût de terrain ──
  const dist = new Int32Array(N).fill(INF)
  const parent = new Int32Array(N).fill(-1)
  /**
   * LE TAS TIENT QUATRE FOIS LA CARTE, et ce n'est pas de la prudence : c'est
   * arithmétique. Ce Dijkstra est à SUPPRESSION PARESSEUSE — on n'y décrémente pas
   * la clé d'une entrée existante, on en pousse une meilleure et on ignore les
   * périmées à la sortie. Une tuile peut donc être empilée une fois par ARÊTE qui
   * l'améliore, soit jusqu'à quatre fois (le voisinage est à 4).
   *
   * La première version dimensionnait le tas à N et abandonnait silencieusement les
   * poussées au-delà (`if (hn >= N) return`). Le tas débordait, des pans entiers de
   * la carte n'étaient jamais relâchés, et leurs destinations restaient à l'infini —
   * sans un chemin, sans une erreur. Attrapé par la garde (« le Sanctuaire II : aucun
   * sentier n'y mène »), et par elle seule : la carte était superbe.
   */
  const heap = new Int32Array(4 * N + 8)
  let hn = 0
  // Départage par index : deux chemins de coût égal donnent toujours le même
  // réseau, sur tout moteur.
  const lower = (a: number, b: number): boolean =>
    dist[a]! < dist[b]! || (dist[a]! === dist[b]! && a < b)
  const push = (i: number): void => {
    heap[hn] = i
    let c = hn
    hn += 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (!lower(heap[c]!, heap[p]!)) break
      const t = heap[c]!; heap[c] = heap[p]!; heap[p] = t
      c = p
    }
  }
  const pop = (): number => {
    const top = heap[0]!
    hn -= 1
    heap[0] = heap[hn]!
    let c = 0
    for (;;) {
      const l = 2 * c + 1
      const r = l + 1
      let m = c
      if (l < hn && lower(heap[l]!, heap[m]!)) m = l
      if (r < hn && lower(heap[r]!, heap[m]!)) m = r
      if (m === c) break
      const t = heap[c]!; heap[c] = heap[m]!; heap[m] = t
      c = m
    }
    return top
  }

  dist[src] = 0
  push(src)
  while (hn > 0) {
    const cur = pop()
    const d = dist[cur]!
    const cx = cur % W
    const cy = (cur / W) | 0
    for (let k = 0; k < 4; k++) {
      const nx = cx + NX[k]!
      const ny = cy + NY[k]!
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const c = stepCost(map, cx, cy, nx, ny)
      if (c === INF) continue
      const ni = ny * W + nx
      const nd = d + c
      if (nd >= dist[ni]!) continue
      dist[ni] = nd
      parent[ni] = cur
      push(ni)
    }
  }

  // LE SENTIER S'ARRÊTE AU SEUIL. On ne pave pas un lieu : un chemin y MÈNE.
  // (Et il y a une raison technique, aussi impérieuse : les lieux sont posés AVANT
  // les sentiers, et leur type est validé sur le biome de leur centre. Une route
  // qui traverserait une Grotte réécrirait ce biome en `road` — le lieu deviendrait
  // incohérent avec sa propre table, et une garde tomberait. À juste titre.)
  const sanctuaire = new Uint8Array(N)
  for (const z of map.zones) {
    if (z.kind === undefined) continue // un gué n'est pas un lieu : le sentier peut y aller
    for (let ty = Math.max(0, z.y); ty < Math.min(H, z.y + z.h); ty++) {
      for (let tx = Math.max(0, z.x); tx < Math.min(W, z.x + z.w); tx++) sanctuaire[ty * W + tx] = 1
    }
  }

  // ── On remonte chaque destination jusqu'au départ, en peignant ──
  for (const dst of destinations(map, chargesSlugs)) {
    if (dist[dst] === INF) continue // inatteignable (ne devrait plus arriver — une garde le vérifie)
    for (let i = dst; i !== -1; i = parent[i]!) {
      if (sanctuaire[i] === 0) stampSentier(map, i % W, (i / W) | 0)
      if (i === src) break
    }
  }
}

/**
 * ON FRANCHIT UN RUISSEAU, ON NE PONTE PAS UN FLEUVE.
 *
 * Le sentier peut poser ses pierres de gué dans une eau basse — un filet de fonte,
 * une mare —, et il le DOIT : mesuré, un Sanctuaire de la seed 99 siège au fond
 * d'une gorge de roche où l'on n'accède qu'en remontant le torrent sur quarante
 * tuiles. Sans cette permission, aucun chemin n'y menait, et le lieu chargé restait
 * introuvable au fond de son couloir.
 *
 * Mais il ne franchit JAMAIS le fleuve. La distinction est nette et se lit sur le
 * terrain : le fleuve a un CŒUR D'EAU PROFONDE, un ruisseau n'en a pas. On refuse
 * donc toute eau qui a de l'eau profonde à portée — c'est-à-dire le fleuve, ses
 * gués, et les rives des lacs. Le franchissement du fleuve reste une décision qui
 * se paie (on patauge, à 0,5) ; un pont l'annulerait, et avec lui tout ce que le
 * fleuve sépare.
 */
const PROFONDEUR_PROCHE = 5 // tuiles : au-delà, cette eau n'appartient plus au fleuve

function eauDuFleuve(map: WorldMap, tx: number, ty: number): boolean {
  const r = PROFONDEUR_PROCHE
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = tx + dx
      const y = ty + dy
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue
      if (map.terrain[y * map.width + x] === TERRAIN_DEEP_WATER) return true
    }
  }
  return false
}

/**
 * Pose une tuile de sentier. Trois refus, et chacun protège un invariant :
 *   • l'ANNEAU DE BORDURE — une seule tuile de route sur l'enceinte, et la vallée
 *     s'ouvre sur le vide (le sentier est marchable, l'enceinte ne doit pas l'être) ;
 *   • l'EAU DU FLEUVE — voir ci-dessus : on ne bâtit pas de pont ;
 *   • le BLOQUANT — Dijkstra ne l'emprunte pas, mais on ne parie pas là-dessus.
 */
function stampSentier(map: WorldMap, tx: number, ty: number): void {
  const r = SENTIERS.HALF_WIDTH
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = tx + dx
      const y = ty + dy
      if (x <= 0 || y <= 0 || x >= map.width - 1 || y >= map.height - 1) continue // l'enceinte, jamais
      const i = y * map.width + x
      const t = map.terrain[i] ?? 0
      if (isBlockingTile(map, x, y)) continue
      if (isWater(t) && eauDuFleuve(map, x, y)) continue // le fleuve, jamais ponté
      map.terrain[i] = TERRAIN_ROAD
    }
  }
}
