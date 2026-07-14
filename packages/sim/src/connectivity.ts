/**
 * LA CONNEXITÉ DU MONDE — qu'est-ce qui se rejoint, à pied ?
 *
 * `/sim` savait dire si une tuile est marchable. Il ne savait pas dire si on
 * peut y ALLER. Les deux se confondent tant qu'on regarde une tuile à la fois,
 * et divergent dès qu'on regarde la carte : une clairière au cœur d'un massif
 * de roche est faite de tuiles parfaitement marchables où nul ne mettra jamais
 * les pieds. Trois mécaniques du jeu sont mortes exactement là (les lieux du
 * 2026-07-11 : Grotte, Source chaude, Belvédère — tous « marchables », tous
 * murés). Ce module est l'outil qui manquait pour les voir.
 *
 * **4-CONNEXITÉ, et ce n'est pas un détail de commodité.** C'est le modèle du
 * pathfinder (`findPath` : A* à 4 directions, spec pnj R8) ET celui de la
 * collision : deux tuiles bloquantes en diagonale ne laissent entre elles qu'un
 * coin de largeur nulle, qu'une AABB de 0,6 tuile ne franchit pas (résolution
 * par axe, `moveAxis`). Compter les diagonales donnerait des passages que ni le
 * joueur ni les PNJ ne peuvent emprunter — un mensonge optimiste, la pire sorte.
 *
 * Pur et déterministe : balayage row-major, pile explicite, aucun aléa.
 */
import { isBlockingTile, type WorldMap } from './map'
import { isWater } from './valleygen-primitives'

/** Voisinage à 4 — le seul qui dise la vérité sur ce monde (cf. en-tête). */
const N4X = [1, -1, 0, 0]
const N4Y = [0, 0, 1, -1]

export interface WalkableComponents {
  /** Étiquette de composante par tuile ; `-1` sur une tuile bloquante. */
  label: Int32Array
  /** Nombre de tuiles de chaque composante, indexé par étiquette. */
  sizes: number[]
  /**
   * L'étiquette de la plus grande composante — LE MONDE, celui où le joueur
   * naît et vit. Tout le reste est une poche : marchable, et sans intérêt.
   * `-1` si la carte n'a aucune tuile marchable.
   */
  main: number
}

/** Étiquette les composantes connexes (4-connexité) du marchable. O(tuiles). */
export function walkableComponents(map: WorldMap): WalkableComponents {
  const W = map.width
  const H = map.height
  const N = W * H
  const label = new Int32Array(N).fill(-1)
  const sizes: number[] = []
  const stack = new Int32Array(N) // pile explicite : pas de récursion (2 M tuiles)

  for (let start = 0; start < N; start++) {
    if (label[start] !== -1) continue
    if (isBlockingTile(map, start % W, (start / W) | 0)) continue
    const id = sizes.length
    let sp = 0
    let size = 0
    stack[sp++] = start
    label[start] = id
    while (sp > 0) {
      const c = stack[--sp]!
      size++
      const cx = c % W
      const cy = (c / W) | 0
      for (let d = 0; d < 4; d++) {
        const nx = cx + N4X[d]!
        const ny = cy + N4Y[d]!
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const ni = ny * W + nx
        if (label[ni] !== -1 || isBlockingTile(map, nx, ny)) continue
        label[ni] = id
        stack[sp++] = ni
      }
    }
    sizes.push(size)
  }

  let main = -1
  let best = 0
  for (let i = 0; i < sizes.length; i++) {
    if (sizes[i]! > best) { best = sizes[i]!; main = i }
  }
  return { label, sizes, main }
}

/** La tuile appartient-elle au MONDE (par opposition à une poche murée) ? */
export function inMainComponent(c: WalkableComponents, map: WorldMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false
  return c.label[ty * map.width + tx] === c.main
}

/**
 * OÙ LE MONDE COMMENCE — la tuile de départ : la plus proche du centre de la
 * carte qui appartienne au MONDE.
 *
 * Cette fonction vivait dans le worker du client (`veillee.ts`), et elle prenait
 * simplement « la tuile marchable la plus proche du centre ». Le « marchable »
 * y était de trop : si le centre de la carte tombe dans un massif de roche qui
 * abrite une poche praticable — et il en existe, on vient d'en compter jusqu'à
 * quarante-quatre par carte —, le joueur naît **muré dans un placard** dont
 * aucune sortie n'existe. Aucun test ne l'aurait vu ; c'est le genre de partie
 * qu'on ouvre une fois sur mille et qu'on ne comprend pas.
 *
 * Elle appartient à `/sim` : où le monde commence est une propriété de la carte,
 * pas une décision de rendu. Le client la lit, il ne la refait pas — et les trois
 * cercles du GDD (`generateNodes`, `home`) se calent dessus.
 *
 * Renvoie le CENTRE de la tuile (d'où les +0,5), en coordonnées de sim.
 */
export function walkableSpawn(map: WorldMap, c?: WalkableComponents): { x: number; y: number } {
  const comp = c ?? walkableComponents(map)
  const cx = Math.floor(map.width / 2)
  const cy = Math.floor(map.height / 2)
  // Anneaux carrés croissants autour du centre : le premier candidat trouvé est
  // le plus proche au sens de Chebyshev, et le balayage row-major départage les
  // ex æquo — déterministe, sans aléa.
  for (let r = 0; r < Math.max(map.width, map.height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Seul l'anneau, pas le disque : l'intérieur a déjà été balayé.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const tx = cx + dx
        const ty = cy + dy
        if (inMainComponent(comp, map, tx, ty)) return { x: tx + 0.5, y: ty + 0.5 }
      }
    }
  }
  // Aucune tuile du monde : carte dégénérée (tout bloquant). Le centre, faute de mieux.
  return { x: cx + 0.5, y: cy + 0.5 }
}

/**
 * LA DISTANCE DE CREUSEMENT — combien de tuiles bloquantes faut-il percer pour
 * relier cette tuile au MONDE ?
 *
 * `0` = elle en fait déjà partie. `1` = une seule tuile de roche l'en sépare (la
 * porte d'une grotte). `INFINI` (= `limit + 1`) = au-delà du budget, ou séparée
 * par quelque chose qu'on ne perce pas.
 *
 * On ne perce JAMAIS : l'eau (on ne comble pas un lac pour entrer dans une
 * grotte), ni l'anneau de bordure d'une tuile d'épaisseur — une seule tuile
 * percée là, et la vallée s'ouvre sur le vide (`sealBorderRing`).
 *
 * Mise en œuvre : BFS 0-1 (deque) multi-source depuis TOUT le monde à la fois —
 * entrer sur une tuile marchable coûte 0, sur une tuile perçable coûte 1. Une
 * seule passe O(tuiles) donne la réponse pour la carte ENTIÈRE : les ~80 lieux
 * la consultent ensuite en O(1) au lieu de relancer chacun sa recherche.
 *
 * `parent` permet de remonter le chemin depuis n'importe quelle tuile jusqu'au
 * monde — c'est lui qui dit QUELLES tuiles percer (cf. `carveApproach`, poi.ts).
 */
export interface CarveField {
  /** Nombre de tuiles à percer pour relier la tuile au monde ; `limit + 1` = hors d'atteinte. */
  dist: Int32Array
  /** Index de la tuile suivante VERS le monde ; `-1` si aucune (ou déjà dedans). */
  parent: Int32Array
  /** Le budget au-delà duquel on a cessé de chercher. */
  limit: number
}

export function carveDistanceToMain(map: WorldMap, c: WalkableComponents, limit: number): CarveField {
  const W = map.width
  const H = map.height
  const N = W * H
  const INF = limit + 1
  const dist = new Int32Array(N).fill(INF)
  const parent = new Int32Array(N).fill(-1)
  if (c.main === -1) return { dist, parent, limit }

  // Une tuile qu'on ne perce jamais : l'anneau de bordure (une seule tuile percée
  // là, et la vallée s'ouvre sur le vide) et l'eau (on ne comble pas un lac pour
  // entrer dans une grotte).
  const sealed = (tx: number, ty: number): boolean =>
    tx <= 0 || ty <= 0 || tx >= W - 1 || ty >= H - 1 || isWater(map.terrain[ty * W + tx] ?? 0)

  /**
   * ═══ ON NE PERCE JAMAIS UNE MARCHE — et ça a failli coûter toute la topologie ═══
   *
   * Le tunnel d'accès d'un lieu ne franchit pas un changement de PALIER. Voilà la règle, et voilà
   * pourquoi elle n'a pas toujours existé :
   *
   * Tant que la falaise était une BANDE de 44 tuiles, ce tunnel était inoffensif — le budget de
   * percement (`MAX_CARVE_TILES`) ne suffisait jamais à traverser quarante-quatre tuiles de roche,
   * et une frontière de zone était donc *incidemment* étanche. Elle ne l'était pas par principe :
   * elle l'était par épaisseur.
   *
   * L'arête fine (spec R33) a supprimé l'épaisseur. Une frontière ne fait plus qu'UNE tuile — et le
   * tunnel d'un lieu, qui perce volontiers une tuile pour se relier au monde, s'est mis à traverser
   * les frontières comme du papier. Mesuré : **le Gouffre restait joint alors qu'on avait rebouché
   * tous ses seuils** (garde A5) — un lieu, quelque part sur son pourtour, lui avait creusé une
   * porte dérobée. Le seuil n'était plus le seul passage ; la carte n'avait plus de gates.
   *
   * *Une protection qui reposait sur une épaisseur n'était pas une protection : c'était une chance.*
   *
   * La règle la remplace, et elle est exacte : deux zones voisines ont TOUJOURS des paliers
   * différents (`colorerLesPaliers`), et une butte domine toujours sa plaine. Interdire au tunnel
   * de changer de palier, c'est donc lui interdire, d'un seul geste, de percer une frontière de
   * zone ET la paroi d'une butte — sans qu'il ait à savoir ce qu'est l'une ou l'autre. Il ne lui
   * reste que ce pour quoi il existe : dégager les quelques cailloux entre un lieu et son pays.
   *
   * Une carte sans palier (l'ancien générateur) rend 0 partout : la règle est alors sans effet, et
   * le comportement d'avant est préservé à l'identique.
   */
  const pal = (i: number): number => map.palier?.[i] ?? 0

  /**
   * FILE À SEAUX plutôt que deque : les coûts d'arête ne valent que 0 ou 1, donc
   * les distances sont des entiers de 0 à `limit` — un seau par valeur, traités
   * dans l'ordre croissant, et Dijkstra devient un simple balayage. C'est exact
   * (un seau n'est ouvert que lorsque tous les plus petits sont vides), c'est
   * O(tuiles), et ça se relit — là où un deque circulaire demande de prouver
   * qu'on ne dépasse jamais son tampon par la tête.
   *
   * Une entrée périmée (poussée avant qu'une meilleure distance ne soit trouvée)
   * est simplement ignorée à la sortie : `dist[cur] < d`.
   */
  const buckets: number[][] = Array.from({ length: limit + 1 }, () => [])

  for (let i = 0; i < N; i++) {
    if (c.label[i] !== c.main) continue
    dist[i] = 0
    buckets[0]!.push(i)
  }

  for (let d = 0; d <= limit; d++) {
    const bucket = buckets[d]!
    // `bucket.length` est relu à chaque tour : les arêtes de coût 0 rallongent le
    // seau COURANT pendant qu'on le parcourt, et c'est exactement ce qu'on veut.
    for (let k = 0; k < bucket.length; k++) {
      const cur = bucket[k]!
      if (dist[cur]! < d) continue // entrée périmée
      if (d === limit) continue // budget épuisé : on ne développe plus
      const cx = cur % W
      const cy = (cur / W) | 0
      for (let n = 0; n < 4; n++) {
        const nx = cx + N4X[n]!
        const ny = cy + N4Y[n]!
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const ni = ny * W + nx
        if (sealed(nx, ny)) continue
        if (pal(ni) !== pal(cur)) continue // ON NE PERCE PAS UNE MARCHE (voir `pal`)
        // Entrer sur une tuile bloquante, c'est la percer : +1. Sinon : gratuit.
        const w = isBlockingTile(map, nx, ny) ? 1 : 0
        const nd = d + w
        if (nd > limit || nd >= dist[ni]!) continue
        dist[ni] = nd
        parent[ni] = cur
        buckets[nd]!.push(ni)
      }
    }
  }
  return { dist, parent, limit }
}
