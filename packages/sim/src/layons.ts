/**
 * ═══ LES LAYONS — la forêt cesse d'être un semis et devient un LIEU ═══
 *
 * *Demande d'Alexis, 2026-08-31, après le premier retour de playtest : « ça ne me dérange pas
 * qu'on plante l'arbre quasiment au centre de la case et que son épaisseur fasse qu'on ne peut
 * pas passer entre deux arbres, mais dans ce cas, on pose bien les arbres et on donne structure
 * à la forêt qui forme des chemins ». Puis, sur le choix du sol : « la terre foulée d'une sente
 * mais un autre terrain spécifique pour ça ».*
 *
 * ═══ POURQUOI IL FALLAIT AUTRE CHOSE QU'UN RÉGLAGE D'ARBRE ═══
 *
 * Depuis que l'arbre est un mur (`NODE_DEFS.tree`, `blockHalfSub` 3), le verdict est enfin
 * BINAIRE : deux voisins ne passent jamais, une tuile libre passe toujours. Mais le VIDE, lui,
 * restait du bruit — la passe des arbres est un tirage par tuile (`ARBRES_FORET_PAS`, modulé par
 * un fbm de bosquet). On lit un obstacle à la fois, jamais une route. Tant que le vide n'a pas
 * de FORME, aucun réglage de tronc ne rendra la forêt lisible.
 *
 * ═══ CE QU'ON POSE : DES SALLES ET DES COULOIRS ═══
 *
 * Les clairières (`clairieres.ts`) étaient déjà les SALLES — bornées, jamais fusionnées, un
 * maillage de 32 tuiles. Il manquait les couloirs. Un layon est un chemin de 3 tuiles de large
 * qui court d'un nœud du réseau à l'autre à travers la masse boisée, sur son propre terrain
 * (`TERRAIN_LAYON`) : on le VOIT de loin, comme on voit une clairière, et c'est tout l'objet
 * d'en avoir fait un terrain plutôt qu'une simple absence d'arbres. **Vérifié à l'écran avant
 * de le construire** : sur `layon-futaie.png`, la zone sans arbres autour du joueur (le disque
 * de découvert) ne se lit comme RIEN — du brun ; sur `layon-clairiere.png`, la frontière
 * vert/brun se lit d'un bout à l'autre de l'écran. L'absence est invisible, le terrain parle.
 *
 * ═══ LE RÉSEAU — une maille, un décalage, une part d'arêtes ═══
 *
 * Un NŒUD par maille de `MAILLE` blocs, décalé dans sa maille (sinon le réseau est un quadrillage
 * qu'on lit comme tel). Chaque nœud tend une arête vers l'est et une vers le sud, tirées chacune
 * avec la probabilité `PART_ARETE` : ce qui reste n'est ni un quadrillage ni un arbre, c'est un
 * réseau à boucles et à impasses — la forme qu'ont les chemins qu'on emprunte.
 *
 * ⚠ **UNE ARÊTE NE VA PAS EN LIGNE DROITE.** Elle serpente d'un écart latéral tiré d'un fbm, ANNULÉ
 * AUX DEUX BOUTS par une parabole `4t(1−t)` — sans cette annulation, deux arêtes voisines ne se
 * rejoindraient pas sur leur nœud commun et le réseau se briserait en tronçons. La parabole, et
 * pas un sinus : `Math.sin` est interdit dans `/sim` (invariant n°2, déterminisme inter-moteurs).
 *
 * ═══ CE QUE LE LAYON NE TOUCHE PAS ═══
 *
 *   • **le Bois Noir** (`old_growth`) — même raison que la clairière : c'est un LIEU élu et
 *     budgété, tenu par deux contrats (A25, sa surface EXACTE ; A26, une seule masse). On ne le
 *     troue pas, on le contourne.
 *   • **tout ce qui n'est pas la masse boisée de la Racine** — un layon est une trouée DANS du
 *     bois ; peint sur un pré il n'annoncerait rien.
 *   • **la clairière** — elle est déjà la destination. Un layon qui la traverse s'y interrompt,
 *     donc il y débouche : c'est exactement ce qu'on veut voir.
 *
 * LES ARBRES N'Y POUSSENT PAS SANS UNE LIGNE DE PLUS : la passe des arbres teste des ids de
 * terrain nommés (`TERRAIN_FOREST | OLD_GROWTH | PINE | LARCH | WILLOW`) et `terrainAdmet`
 * fait de même — `layon` n'est dans aucune des deux listes, il tombe au `continue`. Une seule
 * source, le terrain : le semis, le rendu du sol et le clutter ne peuvent pas diverger.
 *
 * PUR : `hash2`/`fbm2`, `+ − × ÷`, `floor`, `abs`, `min`, `max` (invariant n°2).
 */
import { TERRAIN_LAYON, TERRAIN_OLD_GROWTH } from './balance'
import { fbm2, hash2 } from './noise'
import { TERRAINS_BOISES_MASSIF } from './profondeur'
import { CREUX } from './racine-relief'

export const LAYON = {
  /**
   * LA MAILLE DES NŒUDS, en blocs de `CREUX.MOTIF` — 2 × 8 = **16 tuiles**.
   *
   * L'écran fait 35,6 tuiles de large sur 20 de haut (`VISIBLE_TILES_TALL`). À 16 tuiles, on a
   * deux mailles par largeur d'écran : assez pour lire une STRUCTURE. La maille des clairières
   * (32 tuiles) ne pouvait pas servir de graphe — un layon par écran est un point de repère, pas
   * une structure — et toutes ses mailles ne portent pas de clairière, donc s'en servir aurait
   * donné des tronçons isolés au lieu d'un réseau.
   */
  MAILLE: 2,
  /** Part des arêtes du réseau réellement tracées. À 1 c'est un quadrillage ; à 0,55 il reste
   *  des boucles ET des impasses, et aucune maille ne se lit comme une case. */
  PART_ARETE: 0.75,
  /** Demi-largeur du layon, en tuiles. 1 → **3 tuiles de large** : deux corps de front (0,75)
   *  y passent, et le chemin se voit de loin sans faire une avenue. */
  DEMI: 0.7,
  /** Amplitude du serpentement, en tuiles, au MILIEU de l'arête (nulle aux deux bouts). */
  SERPENT: 3,
  /** Échelle du bruit qui serpente : plus grand = de longues courbes, plus petit = des zigzags. */
  ECHELLE_SERPENT: 30,
  /** Pas d'échantillonnage le long d'une arête, en tuiles. Sous 1 pour ne pas trouer le tracé. */
  PAS: 0.5,
  /**
   * ═══ LES DEUX GARDE-FOUS CONTRE LES CONFETTIS ═══
   *
   * MESURÉ au premier jet, et c'est ce qui a fait réécrire la passe : sans eux, **1 268
   * composantes** pour une médiane de **7 tuiles**, la plus grande ne portant que 1,2 % du
   * réseau. On avait peint 15 % de la masse boisée en poussière de chemin. La cause n'est pas
   * le tracé : c'est que la masse boisée est elle-même trouée (prés, eau, roche), et qu'une
   * arête qui la traverse en biais n'en garde que des miettes. Un tronçon de sept tuiles au
   * milieu d'un bois n'est pas un chemin — c'est une tache qui ment sur ce qu'elle promet.
   *
   * `PART_BOISEE_MIN` — une arête n'est tracée QUE si cette part de ses points tombe sur du
   * bois de la Racine. On refuse l'arête ENTIÈRE, on ne la rogne pas : un chemin se juge sur
   * son parcours, pas sur ses tuiles une à une.
   *
   * `MIN_TUILES` — et ce qui survit malgré tout en composantes trop petites est RENDU AU BOIS,
   * exactement comme les clairières rendent leurs éclats (`peindreLesClairieres`). Deux
   * garde-fous et pas un : le premier écarte les arêtes qui n'ont rien à faire là, le second
   * ramasse ce que la géométrie du bois hache quand même.
   */
  PART_BOISEE_MIN: 0.55,
  MIN_TUILES: 40,
} as const

/** Le sel du réseau — indépendant de tout autre tirage de la carte. */
const SEL = 0x4c_41_59_4f // 'LAYO'

/** La matière qu'un layon peut trouer : la masse boisée de la Racine, MOINS la futaie ancienne. */
const BOISE = new Set<number>(TERRAINS_BOISES_MASSIF.filter((t) => t !== TERRAIN_OLD_GROWTH))

/** La tuile du NŒUD de la maille `(mx, my)` — décalée dans sa maille, déterministe. */
function noeud(mx: number, my: number, seed: number): { x: number; y: number } {
  const cote = LAYON.MAILLE * CREUX.MOTIF
  const s = (seed ^ SEL) | 0
  return {
    x: mx * cote + Math.floor(hash2(mx, my, (s ^ 0x1111) | 0) * cote),
    y: my * cote + Math.floor(hash2(mx, my, (s ^ 0x2222) | 0) * cote),
  }
}

/** Cette arête est-elle tracée ? `dir` 0 = vers l'est, 1 = vers le sud. */
function areteTiree(mx: number, my: number, dir: 0 | 1, seed: number): boolean {
  const s = (seed ^ SEL ^ (dir === 0 ? 0x3333 : 0x4444)) | 0
  return hash2(mx, my, s) < LAYON.PART_ARETE
}

/**
 * LA PASSE — trace le réseau et peint `TERRAIN_LAYON` sur ce qui est boisé.
 *
 * Elle passe APRÈS les clairières (un layon ne recouvre pas une salle : il y débouche) et AVANT
 * les sentes — une sente de la Racine reste la route, elle recouvre un layon comme elle recouvre
 * une clairière ou une forêt.
 */
export function tracerLesLayons(
  terrain: number[],
  zone: Int32Array,
  racine: number,
  width: number,
  height: number,
  seed: number,
): void {
  const cote = LAYON.MAILLE * CREUX.MOTIF
  const mxMax = Math.floor((width - 1) / cote)
  const myMax = Math.floor((height - 1) / cote)

  /** Ce qu'on a peint, et ce qu'il y avait dessous — pour rendre les miettes au bois. */
  const peintes: number[] = []
  const orig = new Map<number, number>()

  /** Peint le disque de rayon `DEMI` autour d'un point — seulement sur du bois de la Racine. */
  const poser = (cx: number, cy: number): void => {
    const r = LAYON.DEMI
    const x0 = Math.max(0, Math.floor(cx - r))
    const x1 = Math.min(width - 1, Math.floor(cx + r))
    const y0 = Math.max(0, Math.floor(cy - r))
    const y1 = Math.min(height - 1, Math.floor(cy + r))
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const dx = tx + 0.5 - cx
        const dy = ty + 0.5 - cy
        if (dx * dx + dy * dy > r * r) continue
        const i = ty * width + tx
        if (zone[i] !== racine) continue
        if (!BOISE.has(terrain[i]!)) continue
        peintes.push(i)
        orig.set(i, terrain[i]!)
        terrain[i] = TERRAIN_LAYON
      }
    }
  }

  /** Les points d'une arête, serpentement compris — calculés UNE fois, jugés puis posés. */
  const points = (a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const longueur = Math.sqrt(dx * dx + dy * dy)
    if (longueur < 1) return []
    // La normale unitaire au segment : c'est SUR ELLE que le serpentement se pose.
    const nx = -dy / longueur
    const ny = dx / longueur
    const pas = Math.max(1, Math.floor(longueur / LAYON.PAS))
    const out: { x: number; y: number }[] = []
    for (let k = 0; k <= pas; k++) {
      const t = k / pas
      const px = a.x + dx * t
      const py = a.y + dy * t
      // LA PARABOLE ANNULE L'ÉCART AUX DEUX BOUTS. Sans elle, deux arêtes qui partagent un nœud
      // arriveraient chacune ailleurs, et le réseau se briserait en tronçons — un chemin qui ne
      // mène nulle part est pire que pas de chemin.
      const fondu = 4 * t * (1 - t)
      const n = fbm2(Math.floor(px), Math.floor(py), LAYON.ECHELLE_SERPENT, (seed ^ SEL ^ 0x5555) | 0)
      const ecart = LAYON.SERPENT * (n * 2 - 1) * fondu
      out.push({ x: px + nx * ecart, y: py + ny * ecart })
    }
    return out
  }

  /** Cette arête court-elle VRAIMENT dans le bois ? (le premier garde-fou — cf. `PART_BOISEE_MIN`) */
  const dansLeBois = (pts: { x: number; y: number }[]): boolean => {
    if (pts.length === 0) return false
    let n = 0
    for (const p of pts) {
      const tx = Math.floor(p.x)
      const ty = Math.floor(p.y)
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
      const i = ty * width + tx
      if (zone[i] === racine && BOISE.has(terrain[i]!)) n++
    }
    return n >= pts.length * LAYON.PART_BOISEE_MIN
  }

  for (let my = 0; my <= myMax; my++) {
    for (let mx = 0; mx <= mxMax; mx++) {
      const a = noeud(mx, my, seed)
      if (mx < mxMax && areteTiree(mx, my, 0, seed)) {
        const pts = points(a, noeud(mx + 1, my, seed))
        if (dansLeBois(pts)) for (const p of pts) poser(p.x, p.y)
      }
      if (my < myMax && areteTiree(mx, my, 1, seed)) {
        const pts = points(a, noeud(mx, my + 1, seed))
        if (dansLeBois(pts)) for (const p of pts) poser(p.x, p.y)
      }
    }
  }

  /* ── LES MIETTES RENDUES AU BOIS (le second garde-fou) ──
   * Composantes connexes (4-voisins) de ce qu'on vient de peindre ; toute composante sous
   * `MIN_TUILES` retrouve son terrain d'origine. Même geste que les éclats de clairière, et
   * pour la même raison : ce qui est trop petit pour être un chemin doit cesser d'en avoir la
   * couleur, sinon la carte promet un passage qui n'existe pas. */
  const vu = new Set<number>()
  const pile: number[] = []
  const composante: number[] = []
  const voisin = (j: number): void => {
    if (vu.has(j) || terrain[j] !== TERRAIN_LAYON) return
    vu.add(j)
    pile.push(j)
  }
  for (const depart of peintes) {
    if (vu.has(depart)) continue
    pile.length = 0
    composante.length = 0
    pile.push(depart)
    vu.add(depart)
    while (pile.length > 0) {
      const i = pile.pop()!
      composante.push(i)
      const tx = i % width
      const ty = (i - tx) / width
      if (tx > 0) voisin(i - 1)
      if (tx < width - 1) voisin(i + 1)
      if (ty > 0) voisin(i - width)
      if (ty < height - 1) voisin(i + width)
    }
    if (composante.length < LAYON.MIN_TUILES) {
      for (const i of composante) terrain[i] = orig.get(i)!
    }
  }
}

/** Le terrain est-il un layon ? Un point d'entrée nommé plutôt qu'un `=== 31` dispersé. */
export function estLayon(t: number): boolean {
  return t === TERRAIN_LAYON
}
