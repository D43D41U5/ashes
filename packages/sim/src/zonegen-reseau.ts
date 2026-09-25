/**
 * ═══ LE RÉSEAU DE SENTES — ce qui GUIDE vers les passages (spec `ascension.md` V-R8 / V-A7) ═══
 *
 * Le monde joué n'a qu'une zone, donc zéro seuil, donc zéro route : `zonegen-sentes.ts` route
 * entre les SEUILS d'un graphe de zones, et le plan `'racine'` n'en a aucun. Les sentes y
 * étaient inertes — `SENTES.COUT_PALIER = 60`, écrit pour que les routes aillent chercher les
 * rampes, ne s'exécutait sur rien. Cette passe leur donne l'autre source : les RAMPES et les
 * LIEUX du pays d'avant, plus les PORTES de village.
 *
 * Fourche tranchée par Alexis le 2026-09-24 : c'est la sente qui guide, DANS LE MONDE, pas un
 * marqueur de carte (la trouée d'une rampe vaut 1 px à l'ouverture de l'écran carte). Et le
 * 2026-09-25, la lettre de V-A7b : on dessert la TERRASSE ÉLIGIBLE, pas les 314 groupes de
 * rampes — « un versant qu'on gravit partout est un escalier » (V-R3).
 *
 * ── CE QUI FAIT LE TRACÉ, ET POURQUOI ───────────────────────────────────────────────────────
 *  · LE NŒUD EST UN COUPLE (CELLULE, PALIER). Une cellule de 8 que traverse une paroi n'est
 *    d'AUCUN palier — et c'est le cas de presque toutes celles qui bordent une rampe. Le graphe
 *    ne pouvait donc pas nommer « le haut de cette rampe » : la desserte plafonnait à 89/314.
 *  · UN NŒUD VAUT SA PLUS GROSSE COMPOSANTE CONNEXE INTERNE, et ses arêtes sont VALIDÉES à la
 *    tuile — deux cellules voisines ne communiquent pas parce qu'elles se touchent.
 *  · UN BRUIT BLANC NE COURBE RIEN : sur un long trajet les tirages se compensent et le plus
 *    court chemin redevient droit. Le coût de terrain est un fBm DÉFORMÉ, corrélé ; et les
 *    points de passage SERPENTENT, sans quoi c'est la grille qu'on voit.
 *  · ON NE CHANGE DE PALIER QU'À UNE RAMPE — c'est la forme du graphe, pas une garde. Et les
 *    montées se peignent AVANT les traits, sinon la garde anti-mur les refuse.
 *  · LA LOI ANTI-MUR S'ÉNONCE SUR LA PAIRE, jamais sur la tuile : une rampe est VERTICALE, donc
 *    une paire HORIZONTALE le long de son flanc n'est pas une montée.
 *  · UNE PASSE DE FERMETURE constate les coupures sur le réseau PEINT et les referme — un BFS
 *    multi-source avec union-find au fil de l'eau, pas vingt-et-un étiquetages de la carte.
 *
 * ⚠ **CETTE PASSE NAÎT APRÈS LE PEUPLEMENT, PAS À LA FIN DU WORLDGEN**, et c'est mesuré :
 * `placeZoneNodes` saute les tuiles de route, donc une route née avant le semis retire ~2 000
 * tuiles, change le décompte d'entités et fait diverger le PRNG — sur la graine 4242 le point
 * de naissance saute de `1424,1512` à `168,1480`, et les cinq villages avec lui. Raison de
 * fond, en outre : le critère (c) porte sur les PORTES de village ; une passe qui naît avant
 * les villages ne peut pas les desservir.
 *
 * Le banc de référence est `tools/diag-reseau.mts` : il joue le vrai worldgen et rend, chiffrés,
 * V-A7a (aucune route ne traverse un mur), V-A7b (toute terrasse éligible est rejointe), l'accès
 * des portes et des lieux, et l'EMPREINTE FNV du terrain peint — c'est elle que ce fichier doit
 * retrouver, pas un compte de tuiles.
 */
import { TERRAINS, TERRAIN_ROAD, VILLAGE_GROWTH } from './balance'
import { isWater, type WorldMap } from './map'
import { fbm2, fbmWarp2, hash2 } from './noise'
import { FLANC, TERRASSES } from './terrasses'
import type { Socle } from './socle'

/**
 * LE RÉGLAGE DU RÉSEAU — il vit ICI, à côté de son générateur, et pas dans `balance.ts` : c'est
 * un réglage qui se juge EN REGARDANT UNE CARTE, pas en jouant (en-tête de `balance.ts`).
 */
export const RESEAU = {
  /** Le pas de la grille de routage, en tuiles. */
  MAILLE: 8,
  /** Coût d'une cellule DÉJÀ empruntée : c'est lui qui fabrique les troncs communs. */
  REUSE: 2,
  /** Prix du dénivelé entre deux cellules. */
  PENTE: 900,
  /** Usages au-delà desquels un segment est un TRONC, donc élargi. */
  TRONC: 3,
  /** Demi-largeur du tronc : 1 → trois tuiles. */
  LARGE: 1,
  /**
   * LE PLANCHER D'UN NŒUD — un nœud ne vaut que s'il peut PORTER le tronc (`2 × LARGE + 1`
   * tuiles de large), donc au moins deux largeurs de matière.
   * ⚠ MESURÉ : à **10**, trois tracés de la graine 4242 échouaient, dont les deux ancres de sa
   * terrasse 166 — un couloir étroit ne tient pas dix tuiles dans sa cellule et le graphe coupe
   * alors un passage que le monde offre. À **6 comme à 4**, zéro échec sur les quatre graines.
   * PAS MESURÉ : la formule. Le balayage ne départage pas 6 et 4 ; c'est la lecture qu'on retient.
   */
  SEUIL_NOEUD: 6,
  /** Ce que coûte une montée de rampe, en plus du pas. */
  COUT_MONTEE: 40,
  /** L'amplitude du serpentement des points de passage, en tuiles (la cellule en fait 8). */
  SERPENTE: 3,
  /** La longueur d'onde du champ de pénibilité, en cellules. */
  PENIBLE_ECHELLE: 9,
  /** Ce que le terrain le plus pénible ajoute au coût d'une cellule. */
  PENIBLE: 46,
  /** Le coût d'un pas, à la tuile. */
  PAS: 10,
  /** Le prix d'une unité de pente du socle, à la tuile. */
  PENTE_T: 2600,
  /** L'amplitude du souffle qui empêche le trait d'être une règle. */
  RESPIRE: 22,
  /** Ce que coûte un écart à la corde — petit, sinon le trait redevient droit. */
  DEVIE: 1,
  /**
   * La portée du filet de sécurité, en tuiles. ⚠ SUPPOSÉ, jamais éprouvé : sur les quatre
   * graines de la maison le filet n'a raccordé AUCUN morceau — l'arbre couvrant fait tout.
   */
  FILET_PORTEE: 64,
} as const

/**
 * CE QUE LA PASSE A FAIT — et ce n'est pas de la décoration : ce sont les chiffres sur lesquels
 * les gardes de V-A7 s'appuient, et ceux qu'un banc compare d'une graine à l'autre. Une passe
 * qui ne rend qu'un total ne se surveille pas.
 */
export interface ResultatReseau {
  /** Tuiles de route posées, au total. */
  tuiles: number
  /** Lieux et côtés de rampe rejoints · tracés qui ont ÉCHOUÉ (doit valoir zéro). */
  relies: number
  rates: number
  /** Villages raccordés · échoués. */
  villagesRelies: number
  villagesRates: number
  /** Coupures du réseau peint refermées. */
  refermes: number
  /** Terrasses éligibles · groupes de rampe qui ne montent sur aucune terrasse foulable. */
  terrassesEligibles: number
  rampesSansTerrasse: number
  /** Tuiles effacées dans les cours d'enceinte · tuiles de parvis posées · villages sans parvis. */
  effacees: number
  parvis: number
  sansParvis: number
  /** Tuiles de route orphelines retirées · tuiles ébranchées contre les enceintes. */
  orphelines: number
  ebranchees: number
  /** Traits qui n'ont pas trouvé de chemin et se sont repliés sur la ligne droite. */
  traitsRates: number
  /** Changements de palier sans arête de rampe — impossible par construction : doit valoir zéro. */
  sansArete: number
  /** Bouts morts contre les enceintes, avant et après l'ébranchage. */
  moignonsAvant: number
  moignonsApres: number
}

/**
 * Peint le réseau de sentes dans `carte.map.terrain`.
 *
 * `sites` sont les emplacements ÉLUS par `peuplerLesVoisins` — on ne les recalcule pas : la loi
 * de peuplement est là-bas, et deux élections divergentes décriraient deux mondes.
 */
/** Le résultat d'une passe qui n'avait rien à faire : un monde sans paliers. */
const RIEN_A_TRACER: ResultatReseau = {
  tuiles: 0, relies: 0, rates: 0, villagesRelies: 0, villagesRates: 0, refermes: 0,
  terrassesEligibles: 0, rampesSansTerrasse: 0, effacees: 0, parvis: 0, sansParvis: 0,
  orphelines: 0, ebranchees: 0, traitsRates: 0, sansArete: 0, moignonsAvant: 0, moignonsApres: 0,
}

/**
 * Retire les nœuds de ressource qui se retrouvent SOUS la route, et rend combien.
 *
 * ⚠ **C'EST LA CONTREPARTIE ASSUMÉE DE L'ORDRE CHOISI.** La passe naît après le semis (sans quoi
 * elle ne connaîtrait pas les portes de village, et le PRNG divergerait) : les nœuds sont donc
 * déjà là quand la route passe. Un arbre planté au milieu d'une sente n'est pas un obstacle
 * pittoresque, c'est une route qui ment. MESURÉ : 0,81 à 1,05 % du semis selon la graine.
 */
export function retirerLesNoeudsSousLaRoute<T extends { tx: number; ty: number }>(
  nodes: readonly T[],
  map: { width: number; terrain: readonly number[] },
): { restants: T[]; retires: number } {
  const restants = nodes.filter((n) => map.terrain[n.ty * map.width + n.tx] !== TERRAIN_ROAD)
  return { restants, retires: nodes.length - restants.length }
}

/**
 * Les origines d'une tuile de route, telles que le banc les relit. Elles ne changent RIEN au
 * tracé : c'est l'étiquette de la passe qui a posé la tuile, et elle répond à la seule question
 * qu'on ne peut pas poser à une carte peinte — « qui a tracé cette ligne droite ? ».
 */
export const ORIGINE_CODE = {
  trait: 1, coude: 2, bord: 3, rampe: 4, parvis: 5, referme: 6,
} as const

export function tracerLeReseau(
  /**
   * ⚠ **LA CARTE DU JEU, PAS CELLE DU WORLDGEN.** `createSim` DÉCLONE `options.map`
   * (`sim.ts:683`, un `JSON.parse(JSON.stringify(...))`) : peindre dans `carte.map` laisserait
   * la route invisible au jeu et au client. On prend donc `state.map`, et le socle à part.
   */
  map: WorldMap,
  /** Le relief SOUS le terrain — il donne au trait sa pente. Absent, le trait reste plat. */
  socle: Socle | null,
  sites: readonly { tx: number; ty: number }[],
  seed: number,
  /**
   * SORTIE DE DIAGNOSTIC, facultative — un code d'ORIGINE par tuile peinte, pour que le banc
   * puisse demander « d'où vient cette ligne droite ? » au lieu de la supposer. Zéro = pas de
   * route. Codes : `ORIGINE_CODE`. Absente, rien n'est écrit et rien ne coûte.
   */
  origines?: Uint8Array,
): ResultatReseau {
  const pal = map.palier
  // Sans paliers il n'y a ni terrasse ni rampe : la passe n'a rien à desservir. (Le plan
  // COMPLET, la vallée, n'en a pas — seul `'racine'` porte des terrasses.)
  if (pal === undefined) return RIEN_A_TRACER
  const M8 = RESEAU.MAILLE
  const REUSE = RESEAU.REUSE
  const PENTE = RESEAU.PENTE
  const TRONC = RESEAU.TRONC
  const LARGE = RESEAU.LARGE
  const W = map.width, H = map.height
  const P = (x: number, y: number): number => pal[y * W + x] ?? 0
  const cols = Math.ceil(W / M8), rows = Math.ceil(H / M8)
  const marchable = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < W && y < H && TERRAINS[map.terrain[y * W + x]!]?.walkable === true
  const sel = (seed ^ 0x53454e54) | 0
  const SERPENTE = RESEAU.SERPENTE

  // ── LE GRAPHE DE CELLULES ────────────────────────────────────────────────────
  /**
   * ═══ LE NŒUD N'EST PAS UNE CELLULE, C'EST UN COUPLE (CELLULE, PALIER) ═══
   *
   * ⚠ **EXIGER QU'UNE CELLULE SOIT MONO-PALIER, C'EST S'INTERDIRE LES ABORDS DES RAMPES.** Une
   * cellule de 8 qu'une paroi traverse n'est d'aucun palier — et c'est précisément le cas de
   * presque toutes celles qui bordent une rampe. MESURÉ : sur 628 côtés de rampe à desservir,
   * **307 n'avaient aucune cellule mono du bon palier à moins de quatre cellules**, et V-A7b
   * plafonnait à 89/314 groupes rejoints. Le défaut n'était ni le routage ni la peinture : le
   * GRAPHE ne pouvait pas nommer « le haut de cette rampe ».
   *
   * Le bon nœud est donc (cellule, palier) : une cellule coupée par une paroi existe DEUX fois,
   * une par côté, et les deux ne communiquent que là où une rampe les joint. La loi V-A7a n'est
   * plus une garde, c'est la forme du graphe.
   */
  const NP = 4 // TERRASSES.PALIERS
  const NN = cols * rows * NP
  /**
   * ⚠ **« SIX TUILES FOULABLES » NE FAIT PAS UN NŒUD.** Compter les tuiles d'un palier dans une
   * cellule laisse passer les COPEAUX : deux échardes de part et d'autre d'un rocher comptent
   * pour douze, et rien ne les relie — ni entre elles, ni à la cellule voisine. MESURÉ : le
   * réseau tombait à 37 morceaux et 45 traits ne trouvaient aucun chemin. Un nœud vaut donc sa
   * plus grosse composante CONNEXE interne, et son représentant est pris DEDANS : le trait de
   * tuiles a alors toujours quelque chose à suivre.
   *
   * Le représentant se calcule ici, une fois, parce qu'il dépend du serpentement — un décalage
   * de ±`SERPENTE` tuiles appliqué au centre de la cellule pour que la maille cesse de se voir
   * (voir `rep`).
   *
   * ⚠ **ET CE DÉCALAGE-LÀ SE TIRE AU HASARD PAR CELLULE, PAS À UN BRUIT CORRÉLÉ — C'EST L'INVERSE
   * DE LA RÈGLE QUI VAUT POUR LE COÛT DE TERRAIN, ET LA RAISON EST MESURÉE.** Le coût d'un pas
   * (`souffle`) doit être corrélé : un bruit blanc s'y compense le long d'un trajet et le chemin
   * redevient droit. Le décalage d'un POINT DE PASSAGE, lui, n'est pas un trajet : deux cellules
   * voisines qui reçoivent le MÊME décalage rendent leurs centres COLINÉAIRES, et le trait qui
   * les relie est une règle. C'est exactement ce que faisait `fbm2(cx, cy, 4, …)` : le Perlin
   * vaut **0,5 aux nœuds entiers** (`noise.ts`), donc échantillonné sur des indices de cellule
   * ENTIERS son octave fine est MORTE — à l'échelle 1 le décalage est nul partout (vérifié :
   * empreinte de carte identique à `SERPENTE = 0`) —, et ce qui survit à l'échelle 4 DÉRIVE
   * lentement au lieu de varier d'une cellule à l'autre. MESURÉ sur 24 cellules d'affilée
   * (graine 2026) : `fbm2` donne **6 voisins au décalage IDENTIQUE sur 23**, et une suite qui
   * glisse (`-1 -1 -1`, `1 1 1`) ; `hash2` en donne **1 sur 23**.
   *
   * Effet sur le tracé, à `SERPENTE` inchangé — part des tuiles de route prises dans un segment
   * axial STRICTEMENT MINCE, `tools/origine-droite.mts`, quatre graines :
   *
   *   ≥ 12 tuiles : 25 → 18 · 24 → 18 · 25 → 17 · 24 → 17  (%)
   *   ≥ 24 tuiles :  7 →  2 ·  6 →  1 ·  6 →  1 ·  6 →  3  (%)
   *
   * au prix de **+5,0 à +5,6 % de tuiles** (21 427 → 22 629 · 19 898 → 20 999 · 20 868 → 21 911 ·
   * 19 403 → 20 458) : un chemin qui serpente est plus long. Les 25 gardes de fond (connexité
   * d'un seul morceau, zéro traversée de mur, terrasses éligibles rejointes, portes) restent
   * VERTES, et la garde (d) du test mesure désormais la rectitude elle-même.
   *
   * ⚠ **CE QUE ÇA COÛTE AILLEURS, ET QUI N'EST PAS TRANCHÉ** : le banc A8 (`scenario.test.ts`,
   * 2 jours, météo armée) compte les échantillons d'affamés, seuil ABSOLU de 10. A/B sur cinq
   * graines — `fbm2` : 0 · 0 · 0 · 0 · **20** (graine 42) ; `hash2` : **15** (2026) · 0 · 0 · 0 ·
   * **16** (42). Le compteur est BIMODAL (0, ou quinze à vingt), le seuil était déjà franchi
   * AVANT ce correctif sur la graine 42, et sur cette graine-là le correctif AMÉLIORE (20 → 16).
   * Ce n'est pas la nourriture qui manque : autour des trois villages de la graine 2026, la route
   * mange EXACTEMENT les mêmes nœuds sous les deux bruits (−1, −2, −18 à ≤ 40 tuiles). Le canal
   * est ailleurs — 74 nœuds de différence sur 190 570 à l'échelle du monde, et un `speedFactor`
   * de 1,25 qui ne tombe pas sur les mêmes tuiles —, donc une trajectoire qui diverge, pas un
   * monde plus pauvre. SUPPOSÉ sur le canal exact, MESURÉ sur « ce n'est pas la ressource ».
   */
  const dispo = new Uint8Array(NN)
  /** LE PLANCHER D'UN NŒUD — un nœud ne vaut que s'il peut PORTER le tronc, qui fait
   *  `2 × LARGE + 1` tuiles de large : il lui faut au moins deux largeurs de matière.
   *  ⚠ **CE QUI EST MESURÉ, ET CE QUI NE L'EST PAS.** MESURÉ : à **10**, trois tracés de la graine
   *  4242 échouent — dont les DEUX ancres de la terrasse 166 (601 tuiles, palier 3, atteignable à
   *  pied) : un couloir étroit ne tient pas dix tuiles dans sa cellule et le graphe coupe alors un
   *  passage que le monde offre. À **6 comme à 4**, zéro échec sur les trois graines, V-A7a à zéro.
   *  PAS MESURÉ : la formule. Le balayage ne départage pas 6 et 4 — `2 × (2 × LARGE + 1)` est la
   *  LECTURE qu'on retient, pas une dérivation que la mesure imposerait. */
  const SEUIL_NOEUD = RESEAU.SEUIL_NOEUD
  const dansBlob = new Uint8Array(W * H)
  const repX = new Int16Array(NN).fill(-1)
  const repY = new Int16Array(NN).fill(-1)
  {
    const vu = new Int8Array(M8 * M8)
    const pile = new Int32Array(M8 * M8)
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const c8 = cy * cols + cx
      const x0 = cx * M8, y0 = cy * M8
      const x1 = Math.min(W, x0 + M8), y1 = Math.min(H, y0 + M8)
      // Le centre serpenté de CETTE cellule : le représentant sera le plus proche de lui.
      const ox = Math.round((hash2(cx, cy, sel ^ 0x5e12) * 2 - 1) * SERPENTE)
      const oy = Math.round((hash2(cx, cy, sel ^ 0xa731) * 2 - 1) * SERPENTE)
      const vx = x0 + M8 / 2 + ox, vy = y0 + M8 / 2 + oy
      for (let pp = 0; pp < NP; pp++) {
        vu.fill(0)
        let meilleurT = 0, meilleurX = -1, meilleurY = -1, meilleurK = -1
        for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
          const k0 = (sy - y0) * M8 + (sx - x0)
          if (vu[k0] === 1 || !marchable(sx, sy) || P(sx, sy) !== pp) continue
          let n = 0, tete = 0, bx = sx, by = sy, bd = 1 << 30
          pile[tete++] = k0; vu[k0] = 1
          while (tete > 0) {
            const k = pile[--tete]!
            const lx = k % M8, ly = (k - lx) / M8
            const ax = x0 + lx, ay = y0 + ly
            n++
            const d = (ax - vx) * (ax - vx) + (ay - vy) * (ay - vy)
            if (d < bd || (d === bd && (ay < by || (ay === by && ax < bx)))) { bd = d; bx = ax; by = ay }
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const nx = ax + dx, ny = ay + dy
              if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1) continue
              const kk = (ny - y0) * M8 + (nx - x0)
              if (vu[kk] === 1 || !marchable(nx, ny) || P(nx, ny) !== pp) continue
              vu[kk] = 1; pile[tete++] = kk
            }
          }
          if (n > meilleurT) { meilleurT = n; meilleurX = bx; meilleurY = by; meilleurK = k0 }
        }
        const nd = c8 * NP + pp
        dispo[nd] = Math.min(255, meilleurT)
        repX[nd] = meilleurX; repY[nd] = meilleurY
        // Second parcours : marquer les tuiles DU blob retenu (elles seules valident une arête).
        if (meilleurK >= 0 && meilleurT >= SEUIL_NOEUD) {
          const v2 = new Int8Array(M8 * M8)
          let t2 = 0
          pile[t2++] = meilleurK; v2[meilleurK] = 1
          while (t2 > 0) {
            const k = pile[--t2]!
            const lx = k % M8, ly = (k - lx) / M8
            const ax = x0 + lx, ay = y0 + ly
            dansBlob[ay * W + ax] = 1
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const nx = ax + dx, ny = ay + dy
              if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1) continue
              const kk = (ny - y0) * M8 + (nx - x0)
              if (v2[kk] === 1 || !marchable(nx, ny) || P(nx, ny) !== pp) continue
              v2[kk] = 1; pile[t2++] = kk
            }
          }
        }
      }
    }
  }
  const passable = (n: number): boolean => dispo[n]! >= SEUIL_NOEUD
  /**
   * ⚠ **DEUX CELLULES VOISINES NE COMMUNIQUENT PAS PARCE QU'ELLES SE TOUCHENT.** Leurs blobs
   * peuvent border la même frontière sans qu'aucune tuile de l'un soit 4-adjacente à une tuile
   * de l'autre — un rocher, une langue d'eau, une lèvre de terrasse. Poser l'arête quand même,
   * c'est promettre au trait de tuiles un chemin qui n'existe pas : il se replie sur la ligne
   * droite, qui troue. MESURÉ avant cette validation : 19 traits sans chemin et 30 morceaux.
   * On teste donc la frontière, tuile par tuile. C'est la leçon du dépôt appliquée en amont —
   * la connexité se prouve sur les TUILES, pas sur la grille qui a servi à router.
   */
  const arcE = new Uint8Array(NN) // arête vers la cellule de DROITE, au même palier
  const arcS = new Uint8Array(NN) // arête vers la cellule du DESSOUS
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const c8 = cy * cols + cx
    for (let pp = 0; pp < NP; pp++) {
      const n = c8 * NP + pp
      if (dispo[n]! < SEUIL_NOEUD) continue
      if (cx + 1 < cols && dispo[(c8 + 1) * NP + pp]! >= SEUIL_NOEUD) {
        const xb = (cx + 1) * M8
        for (let y = cy * M8; y < Math.min(H, (cy + 1) * M8); y++) {
          if (xb >= W) break
          if (dansBlob[y * W + xb - 1] === 1 && dansBlob[y * W + xb] === 1 &&
              P(xb - 1, y) === pp && P(xb, y) === pp) { arcE[n] = 1; break }
        }
      }
      if (cy + 1 < rows && dispo[(c8 + cols) * NP + pp]! >= SEUIL_NOEUD) {
        const yb = (cy + 1) * M8
        for (let x = cx * M8; x < Math.min(W, (cx + 1) * M8); x++) {
          if (yb >= H) break
          if (dansBlob[(yb - 1) * W + x] === 1 && dansBlob[yb * W + x] === 1 &&
              P(x, yb - 1) === pp && P(x, yb) === pp) { arcS[n] = 1; break }
        }
      }
    }
  }
  /** L'arête existe-t-elle de `n` vers la cellule décalée de (dx, dy), au même palier ? */
  const arc = (n: number, dx: number, dy: number): boolean => {
    const pp = n % NP, c8 = (n - pp) / NP
    const cx = c8 % cols, cy = (c8 - cx) / cols
    if (dx === 1 && dy === 0) return arcE[n] === 1
    if (dx === -1 && dy === 0) return cx > 0 && arcE[(c8 - 1) * NP + pp] === 1
    if (dx === 0 && dy === 1) return arcS[n] === 1
    if (dx === 0 && dy === -1) return cy > 0 && arcS[(c8 - cols) * NP + pp] === 1
    // La diagonale passe par un coin : il faut qu'un des deux détours orthogonaux tienne.
    const nx = cx + dx, ny = cy + dy
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false
    const parX = (cy * cols + nx) * NP + pp, parY = (ny * cols + cx) * NP + pp
    return (arc(n, dx, 0) && arc(parX, 0, dy)) || (arc(n, 0, dy) && arc(parY, dx, 0))
  }
  const noeudDe = (x: number, y: number, p: number): number =>
    (Math.floor(y / M8) * cols + Math.floor(x / M8)) * NP + Math.min(NP - 1, Math.max(0, p))
  const rampes = (map.connecteurs ?? []).filter((c) => c.type === 'rampe' && c.y > 0 && P(c.x, c.y - 1) === c.vers)
  /**
   * ⚠ **UN GROUPE DE RAMPES EST UNE SUITE CONTIGUË, PAS UN SEAU.** Je binais par
   * `${'${c.y}'}|${'${floor(c.x/3)}'}`, ce qui coupe en deux tout groupe à cheval sur une frontière de
   * seau ET compte les rampes de MESA, que V-A7b exclut. La spec a mesuré **314 groupes de
   * TERRASSE** sur la graine 2026 (942 tuiles sur 1 105) : on reproduit ce chiffre avant de
   * citer le moindre ratio. Le filtre est celui de `champDesParois` — la voisine du dessus doit
   * porter au SOL le palier `vers`, sinon la rampe monte sur un dessus de mesa.
   */
  const groupesDeTerrasse: { x: number; y: number; de: number; vers: number; large: number }[] = []
  {
    const parY = new Map<number, typeof rampes>()
    for (const c of rampes) {
      if (c.y === 0 || P(c.x, c.y - 1) !== c.vers) continue // mesa : rien au-dessus au palier `vers`
      const l = parY.get(c.y) ?? []
      l.push(c); parY.set(c.y, l)
    }
    for (const [y, l] of [...parY].sort((a, b) => a[0] - b[0])) {
      l.sort((a, b) => a.x - b.x)
      let i = 0
      while (i < l.length) {
        let j = i
        while (j + 1 < l.length && l[j + 1]!.x === l[j]!.x + 1) j++
        const mid = l[Math.floor((i + j) / 2)]!
        groupesDeTerrasse.push({ x: mid.x, y, de: mid.de, vers: mid.vers, large: j - i + 1 })
        i = j + 1
      }
    }
  }
  /**
   * LES ARÊTES DE RAMPE — la SEULE façon de changer de palier dans ce graphe.
   * Le pied est en (x, y) au palier `de`, le sommet en (x, y−1) au palier `vers` ; les deux
   * peuvent tomber dans des cellules différentes, d'où deux nœuds distincts à joindre.
   */
  type Rampe = { x: number; y: number; de: number; vers: number }
  const areteRampe = new Map<number, Rampe>()
  const montees = new Map<number, number[]>() // nœud → nœuds atteints par une rampe
  for (const c of rampes) {
    const bas = noeudDe(c.x, c.y, c.de), haut = noeudDe(c.x, c.y - 1, c.vers)
    if (bas === haut || !passable(bas) || !passable(haut)) continue
    areteRampe.set(bas * NN + haut, c); areteRampe.set(haut * NN + bas, c)
    const lb = montees.get(bas) ?? []; if (!lb.includes(haut)) lb.push(haut); montees.set(bas, lb)
    const lh = montees.get(haut) ?? []; if (!lh.includes(bas)) lh.push(bas); montees.set(haut, lh)
  }
  // ── LE COÛT (P2 réutilisation · P5 relief) ───────────────────────────────────
  /** La longueur d'onde du champ de pénibilité, en CELLULES, et son amplitude — comparées au
   *  coût de base (10) : à 34, le terrain pèse trois fois le pas, donc il commande le tracé. */
  const PENIBLE_ECHELLE = RESEAU.PENIBLE_ECHELLE
  const PENIBLE = RESEAU.PENIBLE
  const usage = new Int32Array(NN)
  const so = socle
  const alt = so?.alt ?? null
  const cellDe = (n: number): number => (n - (n % NP)) / NP
  const cout = (de: number, v: number): number => {
    if (usage[v]! > 0) return REUSE // P2 : suivre une route existante ne coûte presque rien
    const cv = cellDe(v), vx = cv % cols, vy = (cv - vx) / cols
    /**
     * ⚠ **UN BRUIT BLANC NE COURBE RIEN.** Tirer un coût indépendant par cellule paraît
     * « varier le terrain » ; sur un chemin de cinquante cellules, les tirages se COMPENSENT, le
     * coût moyen de tout itinéraire converge vers la même valeur, et le plus court chemin
     * redevient exactement une droite. C'est ce qu'on voyait : de longues lignes à angles droits.
     * Pour qu'un chemin s'incurve, il faut un champ CORRÉLÉ — des zones entières coûteuses et
     * d'autres faciles, à une longueur d'onde comparable au trajet. D'où le fBm déformé
     * (`fbmWarp2`, la même fabrique que les biomes), sur ~9 cellules soit ~70 tuiles : assez COURT pour que le champ varie SUR un trajet.
     */
    const terrain = fbmWarp2(vx, vy, PENIBLE_ECHELLE, sel, 1.6)
    let c = 10 + Math.floor(terrain * PENIBLE) + Math.floor(hash2(vx, vy, sel) * 3)
    // ⚠ LE SOCLE A SES PROPRES DÉCALAGES (`mx0`, `my0`) : l'indexer par MA cellule lisait le
    // relief d'ailleurs. Même maille (8 tuiles), origine différente.
    if (alt && so) {
      const cd = cellDe(de), dx0 = cd % cols, dy0 = (cd - dx0) / cols
      const ka = Math.max(0, Math.min(so.rows - 1, dy0 - so.my0)) * so.cols + Math.max(0, Math.min(so.cols - 1, dx0 - so.mx0))
      const kb = Math.max(0, Math.min(so.rows - 1, vy - so.my0)) * so.cols + Math.max(0, Math.min(so.cols - 1, vx - so.mx0))
      c += Math.min(60, Math.floor(Math.abs((alt[ka] ?? 0.5) - (alt[kb] ?? 0.5)) * PENTE)) // P5
    }
    return c
  }

  /** Ce que coûte une montée : une rampe est un ÉVÉNEMENT (V-R3), pas un raccourci gratuit —
   *  mais elle doit rester moins chère que le détour, sinon aucune sente ne la prendrait. */
  const COUT_MONTEE = RESEAU.COUT_MONTEE
  const VOISINS8 = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const
  function router(departC: number, cibles: Set<number>): number[] {
    const n = NN
    const dist = new Float64Array(n).fill(Infinity)
    const parent = new Int32Array(n).fill(-2)
    const regle = new Uint8Array(n)
    dist[departC] = 0; parent[departC] = -1
    const tD: number[] = [0], tI: number[] = [departC]
    const av = (p: number, q: number): boolean => tD[p]! < tD[q]! || (tD[p] === tD[q] && tI[p]! < tI[q]!)
    const ex = (p: number, q: number): void => { const d = tD[p]!; tD[p] = tD[q]!; tD[q] = d; const i = tI[p]!; tI[p] = tI[q]!; tI[q] = i }
    const push = (d: number, i: number): void => { tD.push(d); tI.push(i); let p = tD.length - 1; while (p > 0) { const f = (p - 1) >> 1; if (!av(p, f)) break; ex(p, f); p = f } }
    const pop = (): number => { const r = tI[0]!; const f = tD.length - 1; tD[0] = tD[f]!; tI[0] = tI[f]!; tD.pop(); tI.pop(); let p = 0; for (;;) { const g = 2 * p + 1, d = 2 * p + 2; let m = p; if (g < tD.length && av(g, m)) m = g; if (d < tD.length && av(d, m)) m = d; if (m === p) break; ex(p, m); p = m } return r }
    let fin = -1
    while (tD.length > 0) {
      const c8 = pop()
      if (regle[c8] === 1) continue
      regle[c8] = 1
      if (cibles.has(c8) && c8 !== departC) { fin = c8; break }
      const pIci = c8 % NP, cell = (c8 - pIci) / NP
      const cx = cell % cols, cy = (cell - cx) / cols
      // LA MONTÉE : d'abord, et elle seule change de palier.
      for (const v of montees.get(c8) ?? []) {
        if (regle[v] === 1) continue
        const d = dist[c8]! + cout(c8, v) + COUT_MONTEE
        if (d < dist[v]!) { dist[v] = d; parent[v] = c8; push(d, v) }
      }
      /**
       * ⚠ **UN GRAPHE 4-CONNEXE NE SAIT DESSINER QUE DES ANGLES DROITS.** Le réseau était juste
       * — connexe, sans franchissement — et il RESSEMBLAIT à un circuit imprimé : à 8 tuiles la
       * cellule, un détour en L se voit sur toute la carte. Ce n'est pas un défaut de peinture,
       * c'est le voisinage. On ouvre donc les diagonales, au prix géométrique (×1,4), et le trait
       * de tuiles les rend en marches d'escalier — ce qui, à 0,333 px/tuile, se lit comme un
       * chemin oblique.
       */
      for (const [dx, dy] of VOISINS8) {
        const nx = cx + dx, ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
        const v = (ny * cols + nx) * NP + pIci // ⚠ MÊME PALIER : seule une rampe en change
        if (regle[v] === 1 || !passable(v) || !arc(c8, dx, dy)) continue
        const d = dist[c8]! + (dx !== 0 && dy !== 0 ? Math.floor(cout(c8, v) * 1.4) : cout(c8, v))
        if (d < dist[v]!) { dist[v] = d; parent[v] = c8; push(d, v) }
      }
    }
    if (fin < 0) return []
    const ch: number[] = []
    for (let c8 = fin; c8 >= 0; c8 = parent[c8]!) ch.push(c8)
    return ch.reverse()
  }

  // ── P4 : LES DESTINATIONS — les lieux du PAYS D'AVANT, pas la faune ni les morts ──
  const DU_PAYS = new Set(['cairn', 'stele', 'verger', 'bivouac', 'ferme_ruinee', 'pierre_levee',
    'cercle_pierres', 'chene', 'tour_guet', 'source', 'erratique'])
  const lieux = map.zones
    .filter((z) => z.kind !== undefined && DU_PAYS.has(String(z.kind)))
    .map((z) => ({ x: Math.round(z.x + z.w / 2), y: Math.round(z.y + z.h / 2), quoi: String(z.kind) }))

  /** Comme `accroche`, mais elle EXIGE le palier : s'accrocher de l'autre côté de la paroi
   *  relierait le réseau sans jamais emprunter la rampe qu'on cherchait à desservir. */
  /** Le nœud le plus proche d'une tuile, à SON palier — plus besoin d'exiger le mono : la
   *  cellule coupée par une paroi existe des deux côtés, et on prend le bon. */
  const accrochePalier = (tx: number, ty: number, palier: number): number => {
    for (let r = 0; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
      const x = tx + dx, y = ty + dy
      if (x < 0 || y < 0 || x >= W || y >= H) continue
      if (!marchable(x, y) || P(x, y) !== palier) continue
      const n = noeudDe(x, y, palier)
      if (passable(n)) return n
    }
    return -1
  }
  const accroche = (tx: number, ty: number): number => {
    for (let r = 0; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
      const x = tx + dx, y = ty + dy
      if (x < 0 || y < 0 || x >= W || y >= H) continue
      if (!marchable(x, y)) continue
      const n = noeudDe(x, y, P(x, y))
      if (passable(n)) return n
    }
    return -1
  }

  // ── LE RÉSEAU : chaque lieu rejoint le réseau déjà tracé, au plus court ──────
  const chemins: number[][] = []
  const reseau = new Set<number>()
  let relies = 0, rates = 0
  /**
   * ═══ LA TERRASSE ÉLIGIBLE, PAS LA RAMPE — TRANCHÉ PAR ALEXIS LE 2026-09-24 ═══
   *
   * ⚠ **GUIDER VERS LES 314 RAMPES LES BANALISE.** Tenue à la lettre, V-A7b maille toute la
   * vallée : 41 143 tuiles de route contre 7 194 pour la vallée complète, et un pays quadrillé
   * où l'on ne cherche plus un passage, on suit une route. C'est V-R3 retournée — « les passages
   * sont RARES et se CHERCHENT ; un versant qu'on gravit partout est un escalier ».
   *
   * On reprend donc la loi que le dépôt écrit DÉJÀ (`sousServie`, `terrasses.ts:1533`) : ce qui a
   * droit d'être servi, c'est une TERRASSE — composante connexe d'un palier > 0, qui ne soit ni
   * une miette (`TERRASSES.MIETTE_TUILES × 4`) ni trop étroite pour porter deux approches
   * (emprise ≥ `FLANC.SECTEUR`). Par terrasse, on n'ancre que DEUX rampes, les plus ÉCARTÉES —
   * exactement l'agence de F-R3 : deux approches, pas un escalier.
   */
  const compTerrasse = new Int32Array(W * H).fill(-1)
  const terrasses: { palier: number; taille: number; emprise: number; dansP: number; eau: number }[] = []
  /** La plus grande composante marchable AU SOL, **paliers ignorés** — le monde d'avant les
   *  terrasses. C'est le dénominateur de l'éligibilité F-A3 : une composante qui n'y est pas
   *  majoritairement est une enclave, pas une terrasse qu'on longe. Recopié de
   *  `terrasses.test.ts:53` — la garde et le banc doivent lire la MÊME population. */
  const principale = ((): Uint8Array => {
    const comp = new Int32Array(W * H).fill(-1)
    const file: number[] = []
    let meilleur = -1, meilleurN = 0, n = 0
    for (let dep = 0; dep < W * H; dep++) {
      if (comp[dep]! >= 0 || !marchable(dep % W, (dep - (dep % W)) / W)) continue
      file.length = 0; file.push(dep); comp[dep] = n
      let taille = 0
      for (let h = 0; h < file.length; h++) {
        const i = file[h]!
        taille++
        const x = i % W, y = (i - x) / W
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const j = ny * W + nx
          if (comp[j]! >= 0 || !marchable(nx, ny)) continue
          comp[j] = n; file.push(j)
        }
      }
      if (taille > meilleurN) { meilleurN = taille; meilleur = n }
      n++
    }
    const out = new Uint8Array(W * H)
    for (let i = 0; i < W * H; i++) if (comp[i] === meilleur) out[i] = 1
    return out
  })()
  {
    const pile = new Int32Array(W * H)
    for (let s0 = 0; s0 < W * H; s0++) {
      if (compTerrasse[s0] !== -1) continue
      // ⚠ **UNE TERRASSE SE DÉFINIT PAR CE QU'ON PEUT FOULER.** Découpée sur le palier seul,
      // roche et eau comprises, elle réunissait des morceaux qu'aucun marcheur ne relie : quatre
      // « terrasses éligibles » apparaissaient alors SANS AUCUNE RAMPE — l'une de 4 418 tuiles —,
      // et c'était mon découpage, pas le monde. Une route ne dessert que du marchable ; la
      // composante qui l'intéresse est celle du marchable.
      if (!marchable(s0 % W, (s0 - (s0 % W)) / W)) continue
      const pp = pal[s0] ?? 0
      const id = terrasses.length
      let n = 0, minX = W, maxX = -1, minY = H, maxY = -1, tete = 0, dedans = 0, eau = 0
      pile[tete++] = s0; compTerrasse[s0] = id
      while (tete > 0) {
        const i = pile[--tete]!
        const x = i % W, y = (i - x) / W
        n++
        if (principale[i] === 1) dedans++
        if (isWater(map.terrain[i]!)) eau++
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const v = ny * W + nx
          if (compTerrasse[v] !== -1 || (pal[v] ?? 0) !== pp || !marchable(nx, ny)) continue
          compTerrasse[v] = id; pile[tete++] = v
        }
      }
      terrasses.push({ palier: pp, taille: n, emprise: Math.max(maxX - minX, maxY - minY), dansP: dedans, eau })
    }
  }
  /** L'ÉLIGIBILITÉ DE F-A3, MOT POUR MOT (`terrasses.test.ts:1067`) — les CINQ clauses, pas trois.
   *  ⚠ Les deux que j'avais omises ne sont pas du détail, et les omettre FABRIQUE des défauts :
   *  `dansP / n ≥ 0,5` écarte les ENCLAVES (une banquette qui n'est pas majoritairement sur la
   *  masse continentale d'avant les terrasses), `eau / n < 0,5` écarte les NAPPES — et la garde
   *  nomme déjà l'une des miennes, « la comp 150 de la graine 2026 (419 t, palier 1) est à 100 %
   *  d'eau ». Sans elles, le banc comptait comme « terrasses éligibles inatteignables » des
   *  morceaux que le monde ne promet à personne : c'eût été accuser F-A3 d'un défaut qui est ma
   *  mesure. Le banc et la garde DOIVENT lire la même population. */
  const eligible = (id: number): boolean => {
    const t = terrasses[id]
    return t !== undefined && t.palier > 0 && t.taille >= TERRASSES.MIETTE_TUILES * 4
      && t.emprise >= FLANC.SECTEUR && t.dansP / t.taille >= 0.5 && t.eau / t.taille < 0.5
  }
  /** Les groupes retenus : par terrasse desservie, les DEUX plus écartés. */
  const groupesServis: typeof groupesDeTerrasse = []
  const terrasseDe = new Map<(typeof groupesDeTerrasse)[number], number>()
  let sansTerrasse = 0
  const terrasseVers = (cx: number, cy: number, palier: number): number => {
    for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= W || y >= H) continue
      if (!marchable(x, y) || P(x, y) !== palier) continue
      const id = compTerrasse[y * W + x]!
      if (id >= 0) return id
    }
    return -1
  }
  /** ⚠ **UNE RAMPE DESSERT SES DEUX TERRASSES.** Je ne comptais que celle du DESSUS, et six
   *  terrasses éligibles paraissaient donc n'avoir aucune rampe — alors qu'on y DESCEND. Une
   *  rampe se monte et se descend : elle dessert le palier `de` comme le palier `vers`. */
  const terrasseAuDessus = (gr: { x: number; y: number; vers: number }): number =>
    terrasseVers(gr.x, gr.y - 1, gr.vers)
  const terrasseEnDessous = (gr: { x: number; y: number; de: number }): number =>
    terrasseVers(gr.x, gr.y, gr.de)
  const parTerrasse = new Map<number, typeof groupesDeTerrasse>()
  {
    /** ⚠ La tuile juste au-dessus d'une rampe n'est pas forcément foulable (c'est l'encoche même
     *  du mur) : on cherche la première voisine foulable au palier `vers` dans un petit rayon. */
    for (const gr of groupesDeTerrasse) {
      const ids = [terrasseAuDessus(gr), terrasseEnDessous(gr)].filter((i) => i >= 0)
      if (ids.length === 0) { sansTerrasse++; continue }
      terrasseDe.set(gr, ids[0]!)
      for (const id of ids) {
        if (!eligible(id)) continue
        const l = parTerrasse.get(id) ?? []; l.push(gr); parTerrasse.set(id, l)
      }
    }
    for (const [, l] of [...parTerrasse].sort((a, b) => a[0] - b[0])) {
      if (l.length <= 2) { groupesServis.push(...l); continue }
      // La paire la plus écartée, en Chebyshev — ordre fixe, donc déterministe.
      let ai = 0, bi = 1, best = -1
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
        const d = Math.max(Math.abs(l[i]!.x - l[j]!.x), Math.abs(l[i]!.y - l[j]!.y))
        if (d > best) { best = d; ai = i; bi = j }
      }
      groupesServis.push(l[ai]!, l[bi]!)
    }
  }
  const nbEligibles = terrasses.filter((_, i) => eligible(i)).length

  /**
   * ═══ LES DEUX CÔTÉS DE CHAQUE RAMPE SONT DES DESTINATIONS (V-A7b) ═══
   *
   * ⚠ **RELIER LES LIEUX NE RELIE PAS LES PASSAGES.** MESURÉ avant ce bloc : 24 groupes de
   * rampe de terrasse sur 314 touchaient une route — le réseau desservait le pays d'avant et
   * ignorait ce vers quoi V-R8 existe. On inscrit donc, pour chaque groupe, DEUX ancres : la
   * cellule du DESSOUS au palier `de`, celle du DESSUS au palier `vers`. Deux ancres et non une :
   * avec une seule, le routeur arrive au pied et n'a aucune raison de monter ; avec les deux, le
   * moins cher chemin entre elles passe par la rampe — V-A7a reste vraie par construction, et le
   * joueur qui suit la sente franchit vraiment l'étage.
   */
  // LES DEUX CÔTÉS DE CHAQUE RAMPE RETENUE. (Le banc `tools/diag-reseau.mts` sait aussi ne
  // desservir que le pied, ou aucune rampe : c'est là-bas que ces variantes se comparent.)
  const ancresRampes = groupesServis.flatMap((gr) => [
    { x: gr.x, y: gr.y + 1, quoi: 'rampe_bas', c8: accrochePalier(gr.x, gr.y + 1, gr.de) },
    { x: gr.x, y: gr.y - 2, quoi: 'rampe_haut', c8: accrochePalier(gr.x, gr.y - 2, gr.vers) },
  ])
  const ancres = [...lieux.map((l) => ({ ...l, c8: accroche(l.x, l.y) })), ...ancresRampes].filter((l) => l.c8 >= 0)
  // Ordre déterministe et stable : par index de cellule.
  ancres.sort((a, b) => a.c8 - b.c8)
  if (ancres.length > 0) { reseau.add(ancres[0]!.c8); usage[ancres[0]!.c8] = 1 }
  for (let k = 1; k < ancres.length; k++) {
    const ch = router(ancres[k]!.c8, reseau)
    if (ch.length === 0) { rates++; continue }
    chemins.push(ch)
    for (const c of ch) { usage[c] = (usage[c] ?? 0) + 1; reseau.add(c) }
    relies++
  }

  // ── LES VILLAGES REJOIGNENT LE RÉSEAU (demande d'Alexis) ────────────────────
  // ⚠ **L'ORDRE JOUÉ ICI EST CELUI QU'ON LIVRE — et c'est la mesure qui l'a choisi.** Le plan
  // d'abord retenu (peindre à la fin de `generateZonedTerrain`, AVANT le semis) est réfuté :
  // `placeZoneNodes` saute les tuiles de route, la route née avant lui retire ~2 000 tuiles du
  // semis, le décompte d'entités change et le PRNG diverge. Sur la graine 4242, le point de
  // naissance saute alors de `1424,1512` à `168,1480` et les cinq villages avec — toutes les
  // mesures de porte décriraient un monde que le jeu ne produit pas. Raison de fond, en outre :
  // le critère (c) parle des PORTES, donc des villages ; une passe qui naît avant eux ne peut pas
  // les desservir. L'ordre livré est donc : worldgen → nœuds → villages → PASSE COMPLÈTE, depuis
  // `peuplerLesVoisins` (la loi unique des trois hôtes) → retrait des nœuds tombés sous la route.
  // C'est exactement ce que le banc déroule ci-dessous.
  // Les sites de village ARRIVENT : `peuplerLesVoisins` les a déjà élus, et c'est sa loi qui
  // vaut. Les recalculer ici les ferait diverger du monde réellement peuplé.
  const villages = sites
  /** L'enceinte (rayon `ENCEINTE_RADIUS`) plus la rangée de la porte : aucune route là-dedans. */
  const RV = VILLAGE_GROWTH.ENCEINTE_RADIUS
  let vRelies = 0, vRates = 0
  for (const v of villages) {
    // ⚠ **ON NE VISE PLUS LE FEU MAIS LA PORTE.** `village-plan.ts` la pose en dur :
    // `ey === ENCEINTE_RADIUS + 1 && (ex === 0 || ex === 1)`, donc plein SUD du Feu. Viser le
    // centre faisait entrer la route dans la cour — elle traversait le village de part en part.
    const c8 = accroche(v.tx, v.ty + RV + 3)
    if (c8 < 0 || reseau.has(c8)) { if (c8 >= 0) vRelies++; else vRates++; continue }
    const ch = router(c8, reseau)
    if (ch.length === 0) { vRates++; continue }
    chemins.push(ch)
    for (const c of ch) { usage[c] = (usage[c] ?? 0) + 1; reseau.add(c) }
    vRelies++
  }

  // ── LA PEINTURE (P1 Bresenham · P3 hiérarchie · P6 la rampe par ses tuiles) ──
  const terrainProto = map.terrain.slice()
  /** Les tuiles-PIED : une rampe se monte VERTICALEMENT, du pied (c.y) au sommet (c.y−1). */
  const rampePied = new Set<number>()
  for (const c of (map.connecteurs ?? [])) if (c.type === 'rampe') {
    rampePied.add(c.y * W + c.x)
  }
  /**
   * ⚠ **« TOUCHER UNE RAMPE » N'EST PAS « LA MONTER ».** Une rampe ne se franchit que dans l'axe
   * nord-sud, sur la paire (pied, pied−1). Exempter toute tuile VOISINE d'une rampe laissait
   * passer un couple HORIZONTAL à deux paliers différents contre le flanc de la rampe — mesuré
   * graine 2026 en (820,828)→(821,828). La loi s'énonce sur la PAIRE, jamais sur la tuile.
   */
  const rampeMonte = (x: number, y: number, nx: number, ny: number): boolean =>
    x === nx && Math.abs(y - ny) === 1 && rampePied.has(Math.max(y, ny) * W + x)
  let peintes = 0
  let refusMarche = 0, refusPalier = 0, refusAccole = 0, refusVillage = 0
  /**
   * ⚠ **L'EXCLUSION NE S'ALLUME QU'APRÈS COUP, ET C'EST L'ORDRE RÉEL.** Le réseau se trace au
   * WORLDGEN, où aucun village n'existe encore — ils sont placés à l'hôte, d'après les nœuds,
   * eux-mêmes semés après le réseau. La passe ne peut donc pas éviter les villages : elle les
   * EFFACE quand ils apparaissent, pose le bout de route devant la porte, et laisse la fermeture
   * recoller en contournant l'enceinte. C'est aussi ce que devra faire la vraie passe.
   */
  let excluActif = false
  const dansVillage = (x: number, y: number): boolean => {
    if (!excluActif) return false
    for (const v of villages) if (Math.max(Math.abs(x - v.tx), Math.abs(y - v.ty)) <= RV + 1) return true
    return false
  }
  // L'ORIGINE DU REFUS, pas seulement son compte : un flanc de rampe ou un bord de tronc refusé
  // ne COUPE rien — seuls le cœur d'un trait d'une tuile et son coude peuvent couper.
  let origine: keyof typeof ORIGINE_CODE = 'trait'
  const refusPar: Record<string, number> = { rampe: 0, trait: 0, coude: 0, bord: 0 }
  /** Le prédicat, extrait : `poser` le fait respecter, et TOUTE recherche de chemin doit le
   *  consulter AVANT de s'engager — sans quoi elle trouve une cible, peint, se fait refuser
   *  63 tuiles et recommence indéfiniment (mesuré : 60 tours de fermeture pour rien). */
  const accole = (x: number, y: number, p: number): boolean => {
    // ⚠ **LES QUATRE VOISINS DÉROULÉS, ET CE N'EST PAS DE LA COQUETTERIE.** `for (const [dx, dy] of
    // [[1,0],…])` alloue cinq tableaux ET un itérateur À CHAQUE APPEL — or cette garde est appelée
    // des millions de fois par carte. C'est la raison qui fait déjà dérouler la boucle chaude de
    // `terrasses.ts` (« les quatre voisins DÉROULÉS, dans l'ordre exact de VOISINS4 »).
    // ⚠ Et les voisins HORIZONTAUX ne passent jamais par `rampeMonte` : une rampe est verticale,
    // le prédicat exige `x === nx`. L'appel y rendrait `false` à coup sûr — on ne le fait pas.
    const i = y * W + x
    if (x + 1 < W && terrainProto[i + 1] === TERRAIN_ROAD && (pal[i + 1] ?? 0) !== p) return true
    if (x > 0 && terrainProto[i - 1] === TERRAIN_ROAD && (pal[i - 1] ?? 0) !== p) return true
    if (y + 1 < H && terrainProto[i + W] === TERRAIN_ROAD && (pal[i + W] ?? 0) !== p
      && !rampeMonte(x, y, x, y + 1)) return true
    if (y > 0 && terrainProto[i - W] === TERRAIN_ROAD && (pal[i - W] ?? 0) !== p
      && !rampeMonte(x, y, x, y - 1)) return true
    return false
  }
  const poser = (x: number, y: number, p: number): void => {
    // LE DIAGNOSTIC AVANT LE VERDICT : un réseau en morceaux ne dit pas OÙ il se coupe. On compte
    // séparément les deux refus — la roche et le mauvais palier n'appellent pas le même correctif.
    if (!marchable(x, y)) { refusMarche++; return }
    if (dansVillage(x, y)) { refusVillage++; return }
    if (P(x, y) !== p) { refusPalier++; refusPar[origine] = (refusPar[origine] ?? 0) + 1; return }
    const i = y * W + x
    if (terrainProto[i] === TERRAIN_ROAD) return
    /**
     * ⚠ **DEUX CHEMINS QUI SE LONGENT DE PART ET D'AUTRE DU MUR MONTRENT UN PASSAGE QUI N'EXISTE
     * PAS.** Aucun trait ne franchit : chacun reste à son palier. Mais peints indépendamment,
     * ils peuvent finir ACCOLÉS, et la carte lit alors une route continue à travers la paroi.
     * MESURÉ graine 2026 : 3 paires, toutes à plus de 3 tuiles de la moindre rampe — ce n'était
     * donc pas le flanc d'une rampe. On refuse la pose ; le réseau, s'il s'en trouve coupé, est
     * refermé plus bas par la passe qui, elle, ne franchit que des rampes.
     */
    if (accole(x, y, p)) { refusAccole++; return }
    terrainProto[i] = TERRAIN_ROAD; peintes++
    if (origines !== undefined) origines[i] = ORIGINE_CODE[origine] ?? 0
  }
  /** P3 — la largeur d'un point suit l'USAGE de sa cellule : un tronc s'élargit, une desserte
   *  reste un sentier d'une tuile. */
  const epais = (x: number, y: number, p: number, demi: number): void => {
    if (demi === 0) { poser(x, y, p); return }
    for (let dy = -demi; dy <= demi; dy++) for (let dx = -demi; dx <= demi; dx++) {
      const garde = origine; if (dx !== 0 || dy !== 0) origine = 'bord'
      poser(x + dx, y + dy, p); origine = garde
    }
  }
  /**
   * P1 — Bresenham : une ligne, pas une équerre.
   *
   * ⚠ **UN PAS DIAGONAL CASSE LA CONNEXITÉ À 4 VOISINS.** Mesuré : un sentier d'UNE tuile tracé
   * en diagonale rendait un réseau en **83 morceaux**, dont le plus gros ne portait que 26 % des
   * tuiles — donc pas un réseau du tout, et un corps ne l'aurait pas suivi. Quand le pas bouge
   * en x ET en y, on pose la tuile de COUDE : la ligne redevient un chemin continu, au prix d'un
   * escalier d'une tuile qui ne se voit pas à l'œil.
   */
  /**
   * ⚠ **UNE LIGNE DROITE N'EST PAS UN CHEMIN.** Entre deux centres de cellule de même palier, le
   * trait de Bresenham peut raser une tuile de l'autre palier ou un bloc infranchissable ; `poser`
   * la REFUSE, et un sentier d'une tuile ainsi troué se casse en deux. MESURÉ : 26 refus au cœur
   * d'un trait ou à son coude, et les morceaux qu'ils produisent sont exactement ceux dont l'écart
   * vaut 2 à 6 tuiles. On ne trace donc plus une ligne : on CHERCHE un chemin de tuiles à ce
   * palier, ce qui rend la connexité vraie par construction au lieu de l'espérer.
   * Le A* reste local — fenêtre au cadre des deux bouts, élargie de 16 tuiles — et son coût
   * d'ÉCART À LA DROITE (`DEVIE`) le garde serré autour du segment idéal : l'escalier qui en
   * résulte se lit oblique, là où un coût de VIRAGE fabriquerait de grands L d'équerre.
   */
  let traitsRates = 0
  /**
   * ═══ CE QUI DONNE AU TRAIT SON ALLURE ═══
   *
   * ⚠ **UN COÛT DE VIRAGE FABRIQUE DES L**, et un coût d'écart à la droite fabrique une RÈGLE :
   * les deux donnent un tracé de géomètre, pas un chemin. Un vrai sentier n'est pas le plus court
   * chemin entre deux points, c'est **le moins fatigant** — il épouse la courbe de niveau, coupe
   * la pente en biais, et ne se souvient pas de la ligne droite. Trois termes, donc :
   *
   *   · `PAS` — le coût d'un pas, l'étalon auquel tout le reste se compare ;
   *   · `PENTE_T` — la DÉNIVELÉE franchie, lue au relief interpolé à la tuile. C'est lui qui
   *     courbe : à flanc, contourner coûte moins cher que monter, donc le trait s'enroule ;
   *   · `RESPIRE` — un fBm de longueur d'onde ~13 tuiles, donc CORRÉLÉ : il décide des détours là
   *     où le relief est plat et n'a rien à dire. ⚠ Un bruit BLANC (un tirage par tuile) ne ferait
   *     que du tremblement : sur un trajet il se compense et le chemin redevient droit.
   *
   * `DEVIE` ne sert plus à dessiner mais à CONVERGER — il empêche seulement le chemin de partir
   * flâner à l'autre bout de la fenêtre. D'où sa valeur basse.
   */
  const PAS = RESEAU.PAS
  const PENTE_T = RESEAU.PENTE_T
  const RESPIRE = RESEAU.RESPIRE
  const DEVIE = RESEAU.DEVIE
  /** Le relief à LA TUILE : le socle est une grille de 8, on l'interpole bilinéairement — sans
   *  quoi la « pente » serait en marches de 8 tuiles et le trait suivrait des escaliers. */
  const altTuile = (x: number, y: number): number => {
    const so = socle
    if (!so) return 0
    const u = x / 8 - so.mx0 - 0.5, v = y / 8 - so.my0 - 0.5
    const kx = Math.max(0, Math.min(so.cols - 2, Math.floor(u))), ky = Math.max(0, Math.min(so.rows - 2, Math.floor(v)))
    const fx2 = Math.max(0, Math.min(1, u - kx)), fy2 = Math.max(0, Math.min(1, v - ky))
    const a = so.alt[ky * so.cols + kx]!, b = so.alt[ky * so.cols + kx + 1]!
    const c2 = so.alt[(ky + 1) * so.cols + kx]!, d2 = so.alt[(ky + 1) * so.cols + kx + 1]!
    return (a * (1 - fx2) + b * fx2) * (1 - fy2) + (c2 * (1 - fx2) + d2 * fx2) * fy2
  }
  /** ⚠ **TROISIÈME FOIS QUE LA MÊME LEÇON SE PRÉSENTE** : ce que `poser` refusera, la recherche
   *  ne doit pas s'y engager. Après l'enceinte et la fermeture, c'est au tour du trait — 717
   *  tuiles refusées pour cause d'accolement au mur, chacune un trou dans un sentier d'une
   *  tuile. En consultant `accole` ICI, le A* CONTOURNE au lieu de trouer. */
  const traitPossible = (x: number, y: number, p: number): boolean =>
    marchable(x, y) && P(x, y) === p && !accole(x, y, p)
  const trait = (x0: number, y0: number, x1: number, y1: number, p: number, demi: number, m = 16): void => {
    if (!traitPossible(x1, y1, p) || !traitPossible(x0, y0, p)) {
      traitsRates++
      ligne(x0, y0, x1, y1, p, demi); return
    }
    const ax = Math.max(0, Math.min(x0, x1) - m), bx = Math.min(W - 1, Math.max(x0, x1) + m)
    const ay = Math.max(0, Math.min(y0, y1) - m), by = Math.min(H - 1, Math.max(y0, y1) + m)
    const lw = bx - ax + 1, lh = by - ay + 1
    const idx = (x: number, y: number): number => (y - ay) * lw + (x - ax)
    const cout = new Int32Array(lw * lh).fill(0x7fffffff)
    const prov = new Int32Array(lw * lh).fill(-1)
    const DIR = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
    // File à seaux : les coûts sont petits et entiers, un tas serait du luxe.
    const seaux: number[][] = []
    const pousse = (c: number, v: number): void => { (seaux[c] ??= []).push(v) }
    cout[idx(x0, y0)] = 0; pousse(0, idx(x0, y0))
    const fin = idx(x1, y1)
    for (let c = 0; c < seaux.length && cout[fin] === 0x7fffffff; c++) {
      const b = seaux[c]
      if (b === undefined) continue
      for (let k = 0; k < b.length; k++) {
        const i = b[k]!
        if (cout[i] !== c) continue
        const lx = i % lw, x = lx + ax, y = (i - lx) / lw + ay

        for (const [dx, dy] of DIR) {
          const nx = x + dx, ny = y + dy
          if (nx < ax || ny < ay || nx > bx || ny > by || !traitPossible(nx, ny, p)) continue
          const n = idx(nx, ny)
            const cr = (nx - x0) * (y1 - y0) - (ny - y0) * (x1 - x0)
          const lg = Math.max(1, Math.abs(x1 - x0) + Math.abs(y1 - y0))
          const pente = Math.min(140, Math.floor(Math.abs(altTuile(nx, ny) - altTuile(x, y)) * PENTE_T))
          // Même raison qu'au niveau cellule : corrélé, pas blanc. Longueur d’onde ~13 tuiles :
          // le champ VARIE à l’intérieur de la fenêtre du A*, sans quoi il n’a aucun gradient à suivre.
          const souffle = Math.floor(fbm2(nx / 13, ny / 13, 1, sel ^ 0x9e37) * RESPIRE)
          const nc = c + PAS + pente + souffle + DEVIE * Math.floor(Math.abs(cr) / lg)
          if (nc >= cout[n]!) continue
          cout[n] = nc; prov[n] = i; pousse(nc, n)
        }
      }
    }
    // Élargir avant de renoncer : un détour peut sortir de la fenêtre. ⚠ MESURÉ : sur le seul
    // trait qui échoue (graine 2026), élargir jusqu'à ±256 n'a rien changé — il n'y a
    // simplement PAS de chemin à ce palier, la tuile de rampe étant dans une poche. C'est la
    // passe « refermer » qui traite ce cas, pas la fenêtre.
    if (cout[fin] === 0x7fffffff) {
      if (m < 128) { trait(x0, y0, x1, y1, p, demi, m * 4); return }
      traitsRates++
      ligne(x0, y0, x1, y1, p, demi); return
    }
    for (let i = fin; i >= 0; i = prov[i]!) {
      const lx = i % lw
      epais(lx + ax, (i - lx) / lw + ay, p, demi)
    }
  }
  const ligne = (x0: number, y0: number, x1: number, y1: number, p: number, demi: number): void => {
    let x = x0, y = y0
    const dx = Math.abs(x1 - x), sx = x < x1 ? 1 : -1
    const dy = -Math.abs(y1 - y), sy = y < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
      epais(x, y, p, demi)
      if (x === x1 && y === y1) break
      const e2 = 2 * err
      const bougeX = e2 >= dy, bougeY = e2 <= dx
      if (bougeX) { err += dy; x += sx }
      if (bougeY) { err += dx; y += sy }
      if (bougeX && bougeY) { origine = 'coude'; epais(x, y - sy, p, demi); origine = 'trait' } // LE COUDE, sans quoi la diagonale est trouée
    }
  }
  const centre = (c8: number): [number, number] =>
    [(c8 % cols) * M8 + M8 / 2, ((c8 - (c8 % cols)) / cols) * M8 + M8 / 2]
  /**
   * ═══ LE CHEMIN SE PEINT NŒUD PAR NŒUD, ET LA MONTÉE EST UNE ARÊTE ═══
   *
   * Depuis que le nœud porte son palier, le dépliage n'a plus rien à deviner : deux nœuds
   * consécutifs de MÊME palier se relient par un trait peint à ce palier ; deux nœuds de paliers
   * DIFFÉRENTS ne peuvent être que les deux bouts d'une arête de rampe — le graphe n'en offre
   * aucune autre —, et on peint alors ses trois tuiles de chaque côté du mur.
   *
   * ⚠ C'est ce qui fait de V-A7a un FAIT DE CONSTRUCTION et non une garde : il n'existe aucun
   * chemin dans le graphe qui change de palier ailleurs qu'à une rampe. L'ancien modèle devait
   * deviner, à partir des cellules mono voisines, si un chemin MONTAIT une rampe ou la LONGEAIT —
   * il se trompait sept fois par carte et trouait le réseau de sept à neuf tuiles.
   */
  type Point = { x: number; y: number; p: number }
  /**
   * LE REPRÉSENTANT D'UN NŒUD — la tuile que le chemin traverse vraiment.
   *
   * ⚠ Deux rôles, une seule question. ① Le centre géométrique d'une cellule n'est pas forcément
   * foulable (un rocher, une mare), et un bout de trait irrecevable fait replier le A* sur la
   * ligne droite, qui troue. ② **Ce qui restait droit dans le tracé, c'était la GRILLE** : un
   * champ de coût à moyenne nulle se compense le long d'un trajet, et quand tous les points de
   * passage sont les centres d'une maille régulière, la droite est parfaite. On décale donc le
   * centre d'un champ CORRÉLÉ (±`SERPENTE` tuiles, longueur d'onde 4 cellules) — deux cellules
   * voisines reçoivent un décalage voisin, d'où une ondulation et non un tremblement — puis on
   * prend la tuile foulable la plus proche AU BON PALIER.
   */
  const rep = (n: number): Point => {
    const p = n % NP
    const x = repX[n]!, y = repY[n]!
    if (x >= 0) return { x, y, p }
    const c8 = (n - p) / NP
    const [cx, cy] = centre(c8)
    return { x: cx, y: cy, p }
  }
  let sansArete = 0
  /**
   * ⚠ **LES MONTÉES SE PEIGNENT D'ABORD, ET C'EST UNE QUESTION D'ORDRE, PAS D'EXEMPTION.**
   * La garde anti-mur refuse une tuile dont une voisine est déjà route à un autre palier — et
   * elle a raison, sauf au seul endroit où deux paliers ont le droit de se toucher : la rampe.
   * En peignant les traits d'abord, les six tuiles de la montée arrivaient trop tard et se
   * faisaient refuser (142 traits sans bout valide). J'ai voulu exempter les tuiles de rampe :
   * V-A7a est aussitôt passée de 0 à **27 traversées**, parce que l'exemption libérait aussi
   * leurs voisines LATÉRALES, où un mur n'a pas de porte. La rampe gagne donc par l'ORDRE : elle
   * est posée la première, et tout ce qui viendrait ensuite s'accoler au mur est refusé comme
   * avant. On ne relâche aucune loi.
   */
  const montéesAPeindre: Rampe[] = []
  for (const ch of chemins) for (let q = 0; q < ch.length - 1; q++) {
    const A = ch[q]!, B = ch[q + 1]!
    if (A % NP === B % NP) continue
    const r = areteRampe.get(A * NN + B)
    if (r === undefined) { sansArete++; continue }
    montéesAPeindre.push(r)
  }
  for (const r of montéesAPeindre) {
    for (let w = -1; w <= 1; w++) {
      origine = w === 0 ? 'rampe' : 'bord'
      poser(r.x + w, r.y, r.de); poser(r.x + w, r.y - 1, r.vers)
    }
  }
  origine = 'trait'
  for (const ch of chemins) {
    for (let q = 0; q < ch.length - 1; q++) {
      const A = ch[q]!, B = ch[q + 1]!
      const ra = rep(A), rb = rep(B)
      const demi = Math.min(usage[A] ?? 1, 9) >= TRONC ? LARGE : 0
      if (A % NP === B % NP) { trait(ra.x, ra.y, rb.x, rb.y, A % NP, demi); continue }
      const r = areteRampe.get(A * NN + B)
      if (r === undefined) continue
      const pied: Point = { x: r.x, y: r.y, p: r.de }
      const haut: Point = { x: r.x, y: r.y - 1, p: r.vers }
      const depart = A % NP === r.de ? pied : haut
      const arrivee = A % NP === r.de ? haut : pied
      trait(ra.x, ra.y, depart.x, depart.y, depart.p, demi)
      trait(arrivee.x, arrivee.y, rb.x, rb.y, arrivee.p, demi)
    }
  }
  /**
   * ═══ LA ROUTE S'ARRÊTE DEVANT LA PORTE ═══
   *
   * Demande d'Alexis (2026-09-24) : « le chemin ne doit pas passer au milieu du village mais
   * devant la porte ». On efface donc tout ce que le réseau a peint dans l'emprise — enceinte
   * plus rangée de la porte — et on pose, à la place, le PARVIS : les deux tuiles face aux
   * vantaux, prolongées de deux vers le sud pour que le bout de route se lise comme une arrivée
   * et non comme un moignon. Ce que l'effacement a coupé, la fermeture le recolle ; et comme
   * l'exclusion est maintenant allumée, elle contourne l'enceinte au lieu de la retraverser.
   */
  excluActif = true
  let efface = 0
  for (const v of villages) {
    for (let dy = -RV - 1; dy <= RV + 1; dy++) for (let dx = -RV - 1; dx <= RV + 1; dx++) {
      const x = v.tx + dx, y = v.ty + dy
      if (x < 0 || y < 0 || x >= W || y >= H) continue
      const i = y * W + x
      if (terrainProto[i] === TERRAIN_ROAD) { terrainProto[i] = map.terrain[i]!; efface++; peintes-- }
    }
  }
  /**
   * ⚠ **LE PARVIS CANONIQUE N'EST PAS TOUJOURS POSABLE.** Les quatre tuiles face aux vantaux
   * peuvent tomber dans l'eau, la roche ou l'autre palier — et alors RIEN n'est peint, la
   * fermeture n'a aucun morceau à raccorder, et le village reste sans route. MESURÉ graine
   * 4242 : 16 tuiles de parvis sur 20, et **une porte à 49 tuiles de la première route**.
   * On élargit donc vers le SUD (jamais vers les autres côtés : il n'y a de porte qu'au sud) et
   * on s'arrête au premier rang qui prend. Si rien ne prend sur six rangs, on le DIT.
   */
  let parvis = 0, sansParvis = 0
  for (const v of villages) {
    // ⚠ **LE PARVIS EST DU PALIER DE LA PORTE, PAS DE CELUI DU FEU.** Une enceinte de 17 tuiles
    // peut enjamber une paroi : le Feu au palier p, le vantail au palier p ± 1. Posé au palier du
    // Feu, le parvis tombait alors de l'AUTRE CÔTÉ du mur — mesuré graine 4242, porte 1168,1417 :
    // 49 tuiles de détour pour rejoindre une route qu'on touchait du doigt.
    // ⚠ **LE PARVIS EST DU PALIER DE LA PORTE, PAS DE CELUI DU FEU** — une enceinte de 17 tuiles
    // peut enjamber une paroi, et le parvis tomberait alors de l'autre côté du mur.
    // ⚠ **MESURÉ, ET AUCUN CAS SUR LES TROIS GRAINES** : l'A/B (palier du Feu contre palier de la
    // porte) rend des sorties IDENTIQUES au chiffre près — 40/40/32 tuiles de parvis, mêmes
    // distances. La loi vise le bon référent ; le monde joué ne l'a pas encore éprouvée. Elle ne
    // répare RIEN de connu, et surtout pas la porte 1168,1417 de la graine 4242.
    const pv = P(v.tx, v.ty + RV + 1)
    let pose = 0
    for (let dy = RV + 2; dy <= RV + 7 && pose === 0; dy++) {
      for (let dx = -2; dx <= 3; dx++) {
        const x = v.tx + dx, y = v.ty + dy
        if (x < 0 || y < 0 || x >= W || y >= H) continue
        if (dy > RV + 3 && Math.abs(dx) > 1 && dx !== 0 && dx !== 1) continue
        origine = 'parvis'
        const avant = peintes
        poser(x, y, pv)
        if (peintes > avant) { parvis++; pose++ }
      }
      // Le rang suivant n'est tenté que si celui-ci n'a rien donné — sauf le tout premier,
      // qu'on double d'office pour que le parvis fasse une surface et non un trait.
      if (pose > 0 && dy === RV + 2) {
        for (const dx of [0, 1]) {
          const x = v.tx + dx, y = v.ty + RV + 3
          if (x < 0 || y < 0 || x >= W || y >= H) continue
          const avant = peintes
          poser(x, y, pv)
          if (peintes > avant) parvis++
        }
      }
    }
    if (pose === 0) sansParvis++
  }
  origine = 'trait'

  /**
   * ═══ REFERMER — la passe que tout réseau doit avoir ═══
   *
   * ⚠ **LES CELLULES SE CROIENT VOISINES QUAND LES TUILES NE LE SONT PAS.** Le routage à la
   * cellule juge une case de 8×8 sur sa croix centrale ; deux cellules peuvent passer ce test
   * alors qu'aucun chemin de tuiles ne les relie à ce palier. MESURÉ : un seul trait dans ce cas
   * — une tuile de rampe dont le palier forme une poche — laissait 9,9 % du réseau détaché.
   * On ne cherche donc pas à rendre le routage infaillible : on CONSTATE la coupure sur le réseau
   * PEINT, et on la referme par un chemin de tuiles qui obéit à la seule loi qui vaille — on
   * change de palier UNIQUEMENT sur une rampe. Le réseau devient alors connexe par preuve, pas
   * par espoir, et V-A7a reste vraie puisque la passe ne franchit rien d'autre qu'une rampe.
   */
  const composantes = (): { comp: Int32Array; tailles: number[] } => {
    const comp = new Int32Array(W * H).fill(-1)
    const tailles: number[] = []
    for (let s0 = 0; s0 < W * H; s0++) {
      if (comp[s0] !== -1 || terrainProto[s0] !== TERRAIN_ROAD) continue
      const id = tailles.length; let n = 0
      const pile = [s0]; comp[s0] = id
      while (pile.length > 0) {
        const i = pile.pop()!; n++
        const x = i % W, y = (i - x) / W
        for (const v of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
          if (v < 0 || comp[v] !== -1 || terrainProto[v] !== TERRAIN_ROAD) continue
          comp[v] = id; pile.push(v)
        }
      }
      tailles.push(n)
    }
    return { comp, tailles }
  }
  let referme = 0
  /** La portée du filet, en tuiles : la taille d'un trou laissé par un refus de pose, pas plus. */
  const FILET_PORTEE = RESEAU.FILET_PORTEE
  /**
   * ⚠ **LA FERMETURE COÛTAIT LA MOITIÉ DE LA PASSE** — 8,1 s sur 16,1 s (graine 2026), parce
   * qu'elle refaisait À CHAQUE TOUR un étiquetage pleine carte PUIS un BFS pleine carte, vingt et
   * une fois. Or **un seul BFS MULTI-SOURCE dit tout** : parti en même temps de TOUS les morceaux,
   * il étiquette chaque tuile du morceau le plus proche, et partout où deux étiquettes se touchent
   * il livre un RACCORD candidat avec sa longueur. Il ne reste qu'à en garder un ARBRE COUVRANT
   * MINIMAL (union-find) — ce qui est exactement « referme chaque coupure une fois, au plus court ».
   * On ne retient qu'un candidat par PAIRE de morceaux, le moins cher : c'est tout ce dont un arbre
   * couvrant a besoin, et ça borne le tri.
   *
   * ⚠ **L'ANCIENNE BOUCLE SURVIT DERRIÈRE, EN FILET, ET CE N'EST PAS DU ZÈLE.** Les chemins sont
   * calculés sur l'état d'AVANT la peinture ; peindre un raccord peut rendre `accole` vraie sur la
   * route d'un raccord suivant, que `poser` refusera alors au dernier moment. La boucle qui
   * CONSTATE reprend ces cas-là — et si elle tourne pour rien, elle sort au premier tour.
   */
  /** Le filet ne se déroule QUE s'il a quelque chose à rattraper — voir plus bas. */
  let filetNecessaire = true
  {
    const { comp, tailles } = composantes()
    if (tailles.length > 1) {
      const L = tailles.length
      const etiq = new Int32Array(W * H).fill(-1)
      const prov = new Int32Array(W * H).fill(-1)
      let file: number[] = []
      for (let i = 0; i < W * H; i++) if (comp[i]! >= 0) { etiq[i] = comp[i]!; file.push(i) }
      // ⚠ **L'UNION-FIND TRAVAILLE PENDANT LE BFS, PAS APRÈS — ET C'EST CE QUI L'ARRÊTE TÔT.**
      // Un BFS multi-source découvre les rencontres par distance CROISSANTE : les unir au fil de
      // l'eau, c'est exactement Kruskal. On peut donc s'arrêter à la SECONDE où il ne reste qu'un
      // ensemble, au lieu de balayer la carte entière — un balayage complet coûte 4,8 s, et les
      // morceaux sont tous voisins les uns des autres.
      const pere = new Int32Array(L)
      for (let k = 0; k < L; k++) pere[k] = k
      const trouver = (k0: number): number => {
        let k = k0
        while (pere[k] !== k) { pere[k] = pere[pere[k]!]!; k = pere[k]! }
        return k
      }
      let restants = L
      const retenues: { i: number; v: number }[] = []
      // ⚠ **CE QUI NE CHANGE PAS PENDANT LA FERMETURE SE PRÉCALCULE.** `marchable` et `dansVillage`
      // ne dépendent que du terrain et des cinq enceintes : deux prédicats FIXES qu'on paierait
      // 2,7 millions de fois chacun. `accole`, lui, dépend de ce qu'on vient de peindre — il reste
      // au fil de l'eau, et seulement là où le BFS entre hors du réseau.
      const okT = new Uint8Array(W * H)
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (marchable(x, y) && !dansVillage(x, y)) okT[y * W + x] = 1
      }
      let suite: number[] = []
      /** Un voisin, testé et rangé. Rend `true` s'il faut arrêter tout le BFS. */
      const voisin = (i: number, x: number, y: number, a: number, v: number, nx: number, ny: number): boolean => {
        if (okT[v] === 0) return false
        if ((pal[v] ?? 0) !== (pal[i] ?? 0) && !rampeMonte(x, y, nx, ny)) return false
        if (comp[v]! < 0 && accole(nx, ny, pal[v] ?? 0)) return false
        if (etiq[v]! < 0) { etiq[v] = a; prov[v] = i; suite.push(v); return false }
        const ra = trouver(a), rb = trouver(etiq[v]!)
        if (ra === rb) return false
        pere[ra] = rb
        restants--
        retenues.push({ i, v })
        return restants === 1
      }
      while (file.length > 0 && restants > 1) {
        suite = []
        let fini = false
        for (const i of file) {
          const x = i % W, y = (i - x) / W
          const a = etiq[i]!
          // Les quatre voisins DÉROULÉS, dans l'ordre est · ouest · sud · nord.
          if (x + 1 < W && voisin(i, x, y, a, i + 1, x + 1, y)) { fini = true; break }
          if (x > 0 && voisin(i, x, y, a, i - 1, x - 1, y)) { fini = true; break }
          if (y + 1 < H && voisin(i, x, y, a, i + W, x, y + 1)) { fini = true; break }
          if (y > 0 && voisin(i, x, y, a, i - W, x, y - 1)) { fini = true; break }
        }
        if (fini) break
        file = suite
      }
      /** Remonte la piste du BFS jusqu'à retomber sur une tuile de route, en peignant. */
      const remonter = (depart: number): void => {
        for (let i = depart; i >= 0 && comp[i]! < 0; i = prov[i]!) {
          const x = i % W, y = (i - x) / W
          origine = 'referme'; poser(x, y, P(x, y))
        }
      }
      const refusAvant = refusMarche + refusPalier + refusAccole + refusVillage
      for (const e of retenues) { remonter(e.i); remonter(e.v); referme++ }
      // ⚠ **LE FILET COÛTE UN BFS PLEINE CARTE — ON NE LE DÉROULE PAS POUR RIEN.** Il n'a de
      // raison d'être que dans deux cas : l'arbre couvrant n'a pas tout réuni, ou `poser` a refusé
      // une tuile en chemin (une route devenue accolée par un raccord peint juste avant). Sans
      // refus et avec un seul ensemble, le réseau est connexe PAR CONSTRUCTION, et le filet ne
      // ferait que balayer 2,7 millions de tuiles pour ne rien trouver — mesuré, 2,5 s.
      filetNecessaire = restants > 1 || (refusMarche + refusPalier + refusAccole + refusVillage) !== refusAvant
    }
  }
  for (let tour = 0; filetNecessaire && tour < 250; tour++) {
    const { comp, tailles } = composantes()
    if (tailles.length <= 1) break
    let gros = 0
    for (let i = 1; i < tailles.length; i++) if (tailles[i]! > tailles[gros]!) gros = i
    /**
     * ⚠ **ON CHERCHE DEPUIS LE PETIT MORCEAU, PAS DEPUIS LE GRAND.** Semé depuis les 21 000 tuiles
     * du réseau, le BFS visite un million de cases avant de rien conclure — 2,4 s par carte, pour
     * ne trouver, le plus souvent, RIEN. Semé depuis les morceaux détachés (quelques dizaines de
     * tuiles en tout), il coûte ce que coûte leur voisinage. La cible et la source s'échangent,
     * et le chemin rendu est AUSSI COURT, pas forcément le même.
     * ⚠ **ET IL RÉPARE UN REFUS, IL NE ROUTE PAS À TRAVERS LA CARTE.** Au-delà de `FILET_PORTEE`,
     * ce n'est plus un refus mais un morceau que rien ne peut rejoindre — et c'est l'ORPHELINAGE
     * qui s'en charge, pas la fermeture.
     * ⚠ **NON MESURÉ, ET IL FAUT LE DIRE** : sur les QUATRE graines de la maison, le filet a
     * raccordé **ZÉRO** morceau — l'arbre couvrant fait tout. La taille d'un trou de refus (« une
     * tuile ou deux ») et la valeur 64 sont donc des SUPPOSITIONS, pas des relevés. Si le filet
     * se met un jour à raccorder, c'est là qu'il faudra mesurer.
     */
    const prov = new Int32Array(W * H).fill(-1)
    const vus = new Uint8Array(W * H)
    let file: number[] = []
    for (let i = 0; i < W * H; i++) if (comp[i]! >= 0 && comp[i] !== gros) { vus[i] = 1; file.push(i) }
    let cible = -1
    let vague = 0
    while (file.length > 0 && cible < 0 && vague < FILET_PORTEE) {
      vague++
      const suite: number[] = []
      for (const i of file) {
        const x = i % W, y = (i - x) / W
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const v = ny * W + nx
          if (vus[v] === 1 || !marchable(nx, ny)) continue
          // ⚠ CE QUE LA POSE REFUSERA, LE BFS NE DOIT PAS L'EMPRUNTER : sans cette ligne il
          // traversait l'enceinte, trouvait sa cible, et `poser` refusait tout le tronçon —
          // le morceau ne se raccordait pas et la boucle repartait pour rien (1064 refus).
          if (dansVillage(nx, ny)) continue
          if (P(nx, ny) !== P(x, y) && !rampeMonte(x, y, nx, ny)) continue
          if (comp[v]! < 0 && accole(nx, ny, P(nx, ny))) continue // idem : ne pas s'y engager
          vus[v] = 1; prov[v] = i
          if (comp[v] === gros) { cible = v; break }
          suite.push(v)
        }
        if (cible >= 0) break
      }
      file = suite
    }
    if (cible < 0) break
    for (let i = cible; i >= 0 && comp[i]! < 0; i = prov[i]!) {
      const x = i % W, y = (i - x) / W
      origine = 'referme'; poser(x, y, P(x, y))
    }
    referme++
  }
  origine = 'trait'
  /**
   * ═══ LES MOIGNONS — CE QUE L'EFFACEMENT LAISSE DERRIÈRE LUI ═══
   *
   * ⚠ **EFFACER LA COUR NE SUPPRIME PAS LA ROUTE QUI Y MENAIT.** Un tronc qui traversait un
   * village est coupé net au bord de l'enceinte : ses deux bouts restent, pointés sur une
   * palissade où il n'y a PAS de porte (elle est au sud, et elle seule). La fermeture les
   * raccorde entre eux mais ne les efface jamais — le joueur verrait des chemins mourir contre
   * un mur. On compte donc, puis on ÉBRANCHE : une tuile de route qui n'a qu'un seul voisin de
   * route, près d'un village, et qui n'est pas le parvis, est un bout mort. La retirer ne peut
   * jamais couper le réseau (un sommet de degré 1 n'est sur aucun chemin), on peut donc itérer
   * sans refaire la fermeture.
   */
  const estParvis = (x: number, y: number): boolean => {
    for (const v of villages) {
      const dx = x - v.tx, dy = y - v.ty
      if (dx >= -2 && dx <= 3 && dy >= RV + 2 && dy <= RV + 7) return true
    }
    return false
  }
  const degreRoute = (x: number, y: number): number => {
    let n = 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      if (terrainProto[ny * W + nx] === TERRAIN_ROAD) n++
    }
    return n
  }
  const compteMoignons = (): { bande: number; morts: number } => {
    let bande = 0, morts = 0
    for (const v of villages) {
      for (let dy = -RV - 4; dy <= RV + 4; dy++) for (let dx = -RV - 4; dx <= RV + 4; dx++) {
        const x = v.tx + dx, y = v.ty + dy
        if (x < 0 || y < 0 || x >= W || y >= H) continue
        if (terrainProto[y * W + x] !== TERRAIN_ROAD || estParvis(x, y)) continue
        const ch = Math.max(Math.abs(dx), Math.abs(dy))
        if (ch >= RV + 2 && ch <= RV + 3) bande++
        if (degreRoute(x, y) <= 1) morts++
      }
    }
    return { bande, morts }
  }
  /**
   * ⚠ **UN PARVIS QUE RIEN NE REJOINT EST PIRE QUE PAS DE PARVIS.** Quand la porte d'un village
   * tombe sur une banquette isolée — sa tuile au palier du Feu, tout autour à un autre, aucune
   * rampe —, la fermeture ne peut pas l'atteindre et on laisse deux tuiles de route orphelines
   * au milieu de l'herbe. On les retire : le village reste alors franchement NON DESSERVI, ce
   * que la garde dit, au lieu de paraître desservi par une route qui ne mène nulle part.
   */
  let orphelines = 0
  {
    const { comp: cc, tailles: tt } = composantes()
    let gr = 0
    for (let k = 1; k < tt.length; k++) if (tt[k]! > tt[gr]!) gr = k
    for (let i = 0; i < W * H; i++) {
      const idc = cc[i]!
      if (idc < 0 || idc === gr || tt[idc]! > 8) continue
      terrainProto[i] = map.terrain[i]!; peintes--; orphelines++
    }
  }
  const avantEbranchage = compteMoignons()
  let elague = 0
  for (let tour = 0; tour < 200; tour++) {
    const aRetirer: number[] = []
    for (const v of villages) {
      for (let dy = -RV - 6; dy <= RV + 6; dy++) for (let dx = -RV - 6; dx <= RV + 6; dx++) {
        const x = v.tx + dx, y = v.ty + dy
        if (x < 0 || y < 0 || x >= W || y >= H) continue
        const i = y * W + x
        if (terrainProto[i] !== TERRAIN_ROAD || estParvis(x, y)) continue
        if (degreRoute(x, y) <= 1) aRetirer.push(i)
      }
    }
    if (aRetirer.length === 0) break
    for (const i of aRetirer) { terrainProto[i] = map.terrain[i]!; peintes--; elague++ }
  }
  // ── LA CARTE REÇOIT LA ROUTE ────────────────────────────────────────────────
  // ⚠ **ON A PEINT SUR UNE COPIE, ET C'ÉTAIT NÉCESSAIRE.** Tout le long de la passe,
  // `map.terrain` est l'ORIGINAL : c'est lui qui dit ce qui est foulable, et c'est lui qu'on
  // restaure quand on efface une cour d'enceinte ou qu'on ébranche un moignon. Peindre
  // directement dans la carte aurait effacé cet original au premier trait.
  for (let i = 0; i < W * H; i++) map.terrain[i] = terrainProto[i]!
  const apresEbranchage = compteMoignons()
  return {
    tuiles: peintes,
    relies, rates,
    villagesRelies: vRelies, villagesRates: vRates,
    refermes: referme,
    terrassesEligibles: nbEligibles, rampesSansTerrasse: sansTerrasse,
    effacees: efface, parvis, sansParvis,
    orphelines, ebranchees: elague,
    traitsRates, sansArete,
    moignonsAvant: avantEbranchage.morts, moignonsApres: apresEbranchage.morts,
  }
}
