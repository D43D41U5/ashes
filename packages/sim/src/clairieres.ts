/**
 * ═══ LES CLAIRIÈRES — bornées PAR CONSTRUCTION, et non plus par un seuil ═══
 *
 * *Demande d'Alexis, 2026-08-25 : « certaines clairières de forêts sont trop grandes, on dirait
 * que certaines parties de la forêt est rasée alors que pas du tout » — puis « je m'interroge si
 * les clairières ne devraient être un biome à part entière, uniquement disponibles en forêt.
 * pas d'arbres sur une petite zone mais on ajoute du clutter ».*
 *
 * ═══ POURQUOI L'ANCIEN MODÈLE NE POUVAIT PAS TENIR ═══
 *
 * `clairiereForet` (2026-07-18 → 2026-08-25) était un SEUIL sur du fbm : `v > 0.62`. Les
 * composantes connexes d'un ensemble de sur-niveau d'un champ fractal n'ont **aucune borne** —
 * à aucune échelle, à aucun seuil. Ce n'est pas un mauvais réglage, c'est la nature de l'objet :
 * une crête large du premier octave (qui pèse 4/7) reste au-dessus du seuil sur toute sa
 * longueur. MESURÉ sur le monde joué :
 *
 *   | graine | part de la forêt | nb | médiane | LA PLUS GRANDE  |
 *   |--------|------------------|----|---------|-----------------|
 *   | 2026   | 19,8 %           | 47 | 32 tu.  | 1332 tu. (56×88)|
 *   | 7      | 19,5 %           | 50 | 27 tu.  |  654 tu. (35×32)|
 *   | 31     | 22,4 %           | 46 | 86 tu.  | 1046 tu. (53×37)|
 *
 * L'écran fait **20 tuiles de haut** (`VISIBLE_TILES_TALL`) : la trouée de la graine 2026 faisait
 * quatre écrans. On ne la lit pas comme une clairière, on la traverse.
 *
 * ═══ CE QU'ON POSE À LA PLACE — une MAILLE, une ANCRE, une MARGE ═══
 *
 * Une clairière par maille de `MAILLE` blocs. Dans sa maille, elle mesure `TAILLE_MIN..MAX`
 * blocs de côté, son ancre est tirée dans ce que la `MARGE` laisse, et quelques blocs de son
 * emprise tombent (la `DENTELLE`) pour que le contour marche en escalier au lieu de faire un
 * rectangle plein. Deux propriétés en découlent, et ce sont des CONTRATS, pas des réglages :
 *
 *   1. **AUCUNE clairière ne dépasse `TAILLE_MAX` blocs de côté** (24 tuiles) — son emprise est
 *      incluse dans un carré de cette taille, par construction.
 *   2. **DEUX CLAIRIÈRES NE FUSIONNENT JAMAIS.** Chacune laisse ≥ `MARGE` bloc libre de chaque
 *      côté de sa maille, donc deux mailles voisines sont séparées par ≥ 2 blocs = 16 tuiles de
 *      bois. Sans cette marge, deux ancres posées de part et d'autre d'une arête commune
 *      donneraient une trouée de deux fois la borne — le piège qui tue les versions naïves.
 *
 * `clairieres.test.ts` les AFFIRME en balayant la carte entière sur plusieurs graines : c'est la
 * seule façon de garder une propriété géométrique (leçon `garde-exhaustive-plutot-que-cas`).
 *
 * ═══ ET ELLE NE MORD QUE LE BOIS ═══
 *
 * La peinture est gardée, TUILE PAR TUILE, sur `TERRAINS_BOISES_MASSIF` : une clairière ne peut
 * rien convertir qui ne fût pas un massif. Deux raisons, et la seconde est un piège évité :
 *   • une clairière dans un pré n'est pas une clairière, c'est un pré ;
 *   • `deriverProfondeur` érode le masque des boisés. Si l'emprise mordait l'herbe, cette herbe
 *     ENTRERAIT dans le masque et tout le champ de profondeur bougerait — avec lui `stockDArbre`,
 *     les vieux fûts des cœurs et le tracé des coulées. En ne convertissant que du boisé, le
 *     masque garde exactement les mêmes tuiles (la clairière y reste : c'est une chambre DANS la
 *     masse, pas une trouée de lisière — cf. l'en-tête de `profondeur.ts`), et le champ est
 *     BIT À BIT celui d'avant.
 *
 * Enfin, les ÉCLATS sont rendus au bois : une emprise qui n'attrape que trois tuiles de forêt au
 * coin d'un massif ne fait pas une clairière, elle fait une tache. Toute composante de moins de
 * `MIN_TUILES` redevient son terrain d'origine.
 *
 * Pur et déterministe : `hash2`, `+ - * /`, `floor` (invariant n°2).
 */
import { TERRAIN_CLAIRIERE, TERRAIN_OLD_GROWTH } from './balance'
import { fbm2, hash2 } from './noise'
import { TERRAINS_BOISES_MASSIF } from './profondeur'
import { CREUX } from './racine-relief'

export const CLAIRIERE = {
  /**
   * LA MAILLE D'ANCRAGE, en BLOCS de `CREUX.MOTIF` — 4 × 8 = 32 tuiles de côté. Une clairière
   * au plus par maille : c'est ce qui remplace le seuil, et c'est ce qui BORNE.
   *
   * *(6 → 4 au second passage.)* Alexis a demandé des clairières plus PETITES, pas plus RARES.
   * Or les rétrécir les raréfie deux fois : chacune couvre moins, et les petites que la forêt
   * découpe tombent sous `MIN_TUILES` et sont rendues au bois. MESURÉ à maille 5 : 15 à 19
   * trouées pour 2,5–3 % du massif, contre 20 à 29 avant. On resserre donc la maille d'autant.
   *
   * ⚠ **4 est le PLANCHER** : `MAILLE ≥ TAILLE_MAX + 2 × MARGE` = 2 + 2. En dessous, il n'y a
   * plus de place pour la marge, et la marge EST la clause de non-fusion.
   */
  MAILLE: 4,
  /**
   * L'EMPRISE, en blocs de 8 tuiles — **1 ou 2, et le 1 est le cas ordinaire**.
   *
   * *Second passage, demande d'Alexis : « il faudrait qu'elles soient en moyenne beaucoup plus
   * petite ».* Le premier jet tirait 2..3 blocs, soit 16 à 24 tuiles de côté, pour une moyenne
   * MESURÉE de 114 à 159 tuiles — et la plus grande remplissait la hauteur de l'écran (24
   * tuiles pour 20 visibles). On descend d'un cran entier : le bloc SEUL devient la clairière
   * normale (8×8, moins de la moitié de la hauteur de l'écran), le 2 blocs reste l'exception.
   *
   * `PART_PETITE` est le poids du 1 dans le tirage — c'est LUI le bouton de « en moyenne ».
   */
  TAILLE_MIN: 1,
  TAILLE_MAX: 2,
  PART_PETITE: 0.68,
  /** Les blocs laissés libres de chaque côté DANS la maille. C'est la garantie de non-fusion :
   *  ne jamais descendre à 0 (`MAILLE ≥ TAILLE_MAX + 2 × MARGE` est vérifié par le test). */
  MARGE: 1,
  /**
   * ═══ LA FORME — un DISQUE DÉFORMÉ, et non plus un rectangle de blocs ═══
   *
   * *Demande d'Alexis : « on rend la frontière avec les autres biomes plus organique ».*
   *
   * La première écriture décidait par BLOC de 8 tuiles, comme tout le terrain (R32), et
   * ébréchait le contour en retirant des blocs entiers. Deux défauts qui n'en font qu'un : une
   * clairière d'UN bloc est alors un carré de 8×8 parfait (elle n'a que son ancre, rien à
   * ébrécher), et même à trois blocs le contour reste une marche d'escalier de 8 tuiles. Au
   * moment où la trouée devient petite, ce carré est tout ce qu'on voit d'elle.
   *
   * On passe donc au RAYON : la tuile est une clairière si sa distance normalisée au centre du
   * cadre reste sous un seuil, et **ce seuil ONDULE** — un fbm fin le fait aller et venir tout
   * autour. La frontière serpente au lieu de marcher, et de façon COHÉRENTE : un bruit, pas un
   * tirage par tuile (qui ferait un bord pointillé, pas un bord organique).
   *
   * ⚠ **Ce n'est pas une entorse à « tout est rectiligne » (R32).** La carte fait déjà ça au
   * bord des bois : `entrelacerLesLisieres` (passe 1.595) entrelace l'écotone pré/bois à la
   * tuile. Une lisière d'arbres ne s'aligne pas — c'est le seul endroit du monde où le contraire
   * se verrait. Le rectiligne reste la loi de ce qui se DÉCIDE (zones, paliers, emprises) ; la
   * végétation, elle, a toujours eu le droit de baver.
   */
  /** Rayon normalisé de la trouée dans son cadre (1 = le cadre) : elle occupe environ la moitié
   *  de l'aire de son emprise. C'est pour ça que le cadre est plus grand que la clairière.
   *
   *  0,8 → 0,78 : à 0,8, `RAYON + ONDULATION / 2` valait 1,01 et le bord pouvait mordre d'un
   *  centième HORS du cadre — la garde du test l'a attrapé au premier tour. Un pour cent suffit
   *  à rendre fausses les deux bornes, qui reposent l'une comme l'autre sur « la trouée est
   *  incluse dans son emprise ». */
  RAYON: 0.78,
  /** De combien le rayon ondule, en fraction du cadre. À 0, un disque parfait — aussi artificiel
   *  qu'un carré. `RAYON + ONDULATION / 2 ≤ 1` tient la trouée dans son cadre : c'est la borne. */
  ONDULATION: 0.42,
  /** L'échelle du bruit qui fait onduler, en tuiles. FIN (une anse tous les ~9 pas) : c'est un
   *  bord de végétation, pas un golfe. */
  ECHELLE_BORD: 9,
  /** Part des mailles qui portent une clairière. À 1, le semis est un damier régulier ; en
   *  dessous, le pays respire de façon inégale. */
  CHANCE: 0.85,
  /** En deçà, ce n'est pas une clairière mais un éclat de bord : rendu au bois. 14 tuiles —
   *  descendu de 24 avec la taille (une trouée d'un bloc en fait une trentaine, un coin d'emprise
   *  clipé par la lisière beaucoup moins) : le plancher doit écarter les taches sans manger les
   *  petites clairières, qui sont désormais la norme. */
  MIN_TUILES: 14,
} as const

/** Le sel du champ — indépendant de tout autre tirage de la carte. */
const SEL = 0x43_4c_41_49 // 'CLAI'

/**
 * L'EMPRISE DE LA MAILLE `(mx, my)` : le rectangle d'ancrage en coordonnées de BLOC, ou `null`
 * si cette maille ne porte pas de clairière. Fonction pure de la maille.
 */
function emprise(mx: number, my: number, seed: number): { bx: number; by: number; w: number; h: number } | null {
  const s = (seed ^ SEL) | 0
  if (hash2(mx, my, s) >= CLAIRIERE.CHANCE) return null
  // LE TIRAGE EST PONDÉRÉ, pas uniforme : `PART_PETITE` du temps on prend `TAILLE_MIN`, sinon
  // on tire dans le reste. C'est ce qui fait de la petite clairière le cas ORDINAIRE et de la
  // grande l'exception — un uniforme sur 1..2 donnerait une clairière sur deux au maximum.
  const cote = (sel: number): number => {
    const r = hash2(mx, my, (s ^ sel) | 0)
    if (r < CLAIRIERE.PART_PETITE) return CLAIRIERE.TAILLE_MIN
    const reste = CLAIRIERE.TAILLE_MAX - CLAIRIERE.TAILLE_MIN
    return CLAIRIERE.TAILLE_MIN + 1 + Math.floor((r - CLAIRIERE.PART_PETITE) / (1 - CLAIRIERE.PART_PETITE) * reste)
  }
  const w = Math.min(cote(0x1111), CLAIRIERE.TAILLE_MAX)
  const h = Math.min(cote(0x2222), CLAIRIERE.TAILLE_MAX)
  // L'ancre : tirée dans ce que la marge laisse. `libre` vaut au moins 1 tant que
  // MAILLE ≥ TAILLE_MAX + 2 × MARGE — la condition que le test affirme.
  const libreX = CLAIRIERE.MAILLE - 2 * CLAIRIERE.MARGE - w + 1
  const libreY = CLAIRIERE.MAILLE - 2 * CLAIRIERE.MARGE - h + 1
  const bx = mx * CLAIRIERE.MAILLE + CLAIRIERE.MARGE + Math.floor(hash2(mx, my, (s ^ 0x3333) | 0) * libreX)
  const by = my * CLAIRIERE.MAILLE + CLAIRIERE.MARGE + Math.floor(hash2(mx, my, (s ^ 0x4444) | 0) * libreY)
  return { bx, by, w, h }
}

/**
 * CETTE TUILE EST-ELLE UNE CLAIRIÈRE ? Le rayon ondulé, dans le cadre de sa maille.
 *
 * La clairière reste INCLUSE dans son emprise quoi qu'il arrive (`RAYON + ONDULATION / 2 ≤ 1`,
 * affirmé par le test) : c'est ce qui tient les deux contrats — jamais plus de `TAILLE_MAX`
 * blocs de côté, jamais deux mailles qui se rejoignent.
 *
 * Pur : `hash2`/`fbm2`, `+ - * /`, `sqrt`, `floor` (invariant n°2).
 */
export function tuileDeClairiere(tx: number, ty: number, seed: number): boolean {
  const M = CREUX.MOTIF
  const mx = Math.floor(tx / M / CLAIRIERE.MAILLE)
  const my = Math.floor(ty / M / CLAIRIERE.MAILLE)
  const e = emprise(mx, my, seed)
  if (!e) return false
  const x0 = e.bx * M
  const y0 = e.by * M
  const w = e.w * M
  const h = e.h * M
  // Le rayon normalisé : 0 au centre du cadre, 1 sur son bord. ELLIPTIQUE — un cadre peut être
  // un domino (1×2 blocs), et une trouée y est une anse allongée, pas deux carrés.
  const rx = (tx + 0.5 - (x0 + w / 2)) / (w / 2)
  const ry = (ty + 0.5 - (y0 + h / 2)) / (h / 2)
  const r = Math.sqrt(rx * rx + ry * ry)
  // ET LE SEUIL ONDULE. `fbm2` rend [0,1) : centré, il fait aller et venir le bord d'un demi
  // `ONDULATION` de part et d'autre du rayon nominal.
  const n = fbm2(tx, ty, CLAIRIERE.ECHELLE_BORD, (seed ^ SEL ^ 0x5555) | 0)
  return r < CLAIRIERE.RAYON + CLAIRIERE.ONDULATION * (n - 0.5)
}

/**
 * LA MATIÈRE QU'UNE CLAIRIÈRE PEUT MORDRE — la masse du massif, MOINS la futaie ancienne.
 *
 * `old_growth` est EXCLU, et pas par prudence : ce terrain EST la déclaration « ici le couvert
 * est fermé » (c'est mot pour mot ce dont `arbre-peuplement` se sert pour refuser le bouleau
 * pionnier au Bois Noir). Une trouée dans une canopée fermée contredit le sol qui la porte.
 *
 * Et le monde le disait déjà par deux contrats, tous deux devenus ROUGES quand la première
 * écriture de cette passe y a touché : A25 — *« la futaie ancienne de la Racine fait EXACTEMENT
 * `COURONNE_BOIS` tuiles »* (1412 au lieu de 1920, seed 2026) — et A26 — *« UNE seule masse »*
 * (le Bois Noir en deux morceaux, seed 42). Le Bois Noir est un LIEU élu et budgété, pas une
 * tache de forêt : on ne le troue pas, on le contourne.
 */
const BOISE = new Set<number>(TERRAINS_BOISES_MASSIF.filter((t) => t !== TERRAIN_OLD_GROWTH))

/**
 * LA PASSE — peint `TERRAIN_CLAIRIERE` sur le bois de la Racine, puis rend les éclats.
 *
 * Elle passe APRÈS tout ce qui pose du bois (le sol, la lisière sud, les bosquets de crête, les
 * lisières entrelacées, les set-pieces) et AVANT les sentes : une sente qui traverse une
 * clairière la recouvre, comme elle recouvre une forêt.
 */
export function peindreLesClairieres(
  terrain: number[],
  zone: Int32Array,
  racine: number,
  width: number,
  height: number,
  seed: number,
): void {
  const peintes: number[] = []
  const origine: number[] = []
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (zone[i] !== racine) continue
      const t = terrain[i]!
      if (!BOISE.has(t)) continue // seule la MASSE se troue — cf. l'en-tête (profondeur, prés)
      if (!tuileDeClairiere(tx, ty, seed)) continue
      peintes.push(i)
      origine.push(t)
      terrain[i] = TERRAIN_CLAIRIERE
    }
  }

  const orig = new Map<number, number>()
  for (let k = 0; k < peintes.length; k++) orig.set(peintes[k]!, origine[k]!)

  // ── LES ÉCLATS RENDUS AU BOIS ──
  // Composantes connexes (4-voisins) des tuiles fraîchement peintes ; toute composante trop
  // petite retrouve son terrain d'origine. Un coin d'emprise qui n'attrape que trois tuiles de
  // forêt au bord d'un massif ferait une tache de couleur, pas une clairière.
  const vu = new Set<number>()
  const pile: number[] = []
  const composante: number[] = []
  const voisin = (j: number): void => {
    if (vu.has(j) || terrain[j] !== TERRAIN_CLAIRIERE) return
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
    if (composante.length < CLAIRIERE.MIN_TUILES) {
      for (const i of composante) terrain[i] = orig.get(i)!
    }
  }
}

/** Le terrain est-il une clairière ? Un point d'entrée nommé plutôt qu'un `=== 30` dispersé. */
export function estClairiere(t: number): boolean {
  return t === TERRAIN_CLAIRIERE
}
