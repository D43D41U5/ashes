/**
 * ═══ LE SOCLE MINÉRAL — un seul bloc pour tout ce qui sort de la roche ═══════════════════════
 *
 * *(décision d'Alexis, 2026-08-27, après trois planches : « ok pour socle, pente du dessus 35,
 * pente du corps 30, biseau 2 px, bruit de matière 15 % ».)*
 *
 * CE QU'IL CORRIGE, ET CE N'EST PAS UNE QUESTION DE GOÛT. Les six nœuds minéraux sont tous en
 * `blockHalfSub: 4` — ils bloquent leur tuile ENTIÈRE. Leur art, lui, faisait 11 ou 12 texels de
 * large sur 16 : on se cognait dans du vide autour de chaque caillou. Le socle est PLEINE
 * LARGEUR, rangée du sol comprise, et la silhouette dit enfin la hitbox.
 *
 * ═══ TROIS IDÉES, ET AUCUNE VALEUR PEINTE ═══════════════════════════════════════════════════
 *
 * ① **LE DESSUS EST UN PLAN QUI REGARDE LE CIEL.** Une carte de hauteur rend `(0,0,1)` sur toute
 *    surface plane : le dessus et la face d'un bloc y auraient la MÊME normale, et seule l'arête
 *    entre les deux se dessinerait. On n'en dérive donc pas la normale — on l'ÉCRIT, face par
 *    face. Le dessus porte un vecteur CONSTANT penché de 35° vers le nord ; le corps un vecteur
 *    constant penché de 30° vers le sud.
 *
 * ② **35° ET 30° NE SONT PAS DES RÉGLAGES LIBRES.** Le soleil du jeu est un point placé au nord
 *    de la caméra, à `SUN_NORTH` 1600 px et `SUN_Z` 620 (`dynamic-lighting`) : son élévation vaut
 *    `atan(620 / 1600)` = **21,2°**. C'est le seuil exact — une face penchée au sud de plus de
 *    21,2° ne voit PLUS JAMAIS le soleil, à aucune heure. D'où le partage :
 *      · le dessus à 35° vers le ciel : produit scalaire 0,83 à midi, 0,54 au rasant — il
 *        RESPIRE avec la course du soleil (l'aligner franchement, à 69°, le rendrait aussi
 *        brillant à toute heure et tuerait le cycle) ;
 *      · le corps à 30° vers le sud : 0,00 au soleil, 0,81 sous une torche à hauteur d'homme
 *        (`TORCHE_Z` = 1,1 tuile). Le ciel éclaire les dessus, la lampe éclaire les faces.
 *    Et l'occlusion vient gratuitement : une torche au NORD d'un bloc n'éclaire pas sa face,
 *    parce que la normale lui tourne le dos — aucune ombre portée à calculer.
 *
 * ③ **LE BISEAU NE MORD JAMAIS DANS LE DESSUS.** Un biseau n'a de sens que là où deux faces
 *    VISIBLES se rencontrent : entre le dessus et la face avant (la rampe), et sur les tranches
 *    gauche/droite de cette face. Le bord nord et les coins du dessus sont des arêtes de
 *    SILHOUETTE — derrière, il n'y a rien à raccorder. Les biseauter courbait le plan et cassait
 *    exactement ce qu'on cherche : « une brique plantée montre son dessus PLAT » (Alexis).
 *    Le bruit s'éteint pour la même raison sur cette face : sa normale y est rigoureusement
 *    constante, et son grain d'albédo levé de moitié.
 *
 * ═══ CE QUE ÇA A PERMIS DE RETIRER ══════════════════════════════════════════════════════════
 *
 * L'échelle des trois hauteurs était tenue, le matin même, par un coefficient PEINT qui fonçait
 * le corps à mesure qu'il grandissait (écart dessus/corps 18 → 30 → 44). Elle sort maintenant de
 * la géométrie : le dessus garde ses quatre rangées quelle que soit la taille du bloc, donc un
 * bloc bas est aux trois quarts sa face claire et un bloc haut au quart. Mesuré contre le sol
 * d'éboulis, à midi : **−43,0 / −60,7 / −69,9** de luminance, soit 26,9 d'écart — contre 1,9
 * pour un plateau plat sans coefficient. Il ne reste plus une seule valeur peinte dans le socle.
 *
 * ═══ PAS DE VARIANTE DE SILHOUETTE, ET C'EST MESURÉ ═════════════════════════════════════════
 *
 * Quatre leviers ont été essayés (chanfreins asymétriques, palier, écornure, fuseau) : ils
 * déplacent 3,6 à 10,6 % des texels de la silhouette, et à 16 px **ça ne se voit pas**. Un bloc
 * pleine largeur n'a que ses épaules à offrir. La variété vient de la HAUTEUR et de la MATIÈRE.
 * Le paramètre `graine` reste en place, à zéro : le jour où l'on en voudra, c'est une ligne.
 */
import type Phaser from 'phaser'
import { tailleDeBloc } from '@ashes/sim'
import { cleLit, newCanvas, registerLitPaireDeChamp } from './normal-map'

/** Les six nœuds qui bloquent leur tuile entière (`blockHalfSub: 4` dans `balance.ts`). */
export const SOCLE_TYPES = ['rock', 'bloc', 'iron_vein', 'coal_seam', 'quarry', 'rubble'] as const
export type SocleType = (typeof SOCLE_TYPES)[number]
const EST_SOCLE = new Set<string>(SOCLE_TYPES)
export function estUnSocle(type: string): boolean {
  return EST_SOCLE.has(type)
}

/**
 * LES TROIS ÉMERGENCES, en texels au-dessus du sol.
 *
 * ⚠ **LE PLUS PETIT BLOC FAIT UNE TUILE PLEINE** (Alexis, 2026-08-27 : « il faudrait que le plus
 * petit bloc de pierre fasse une tuile complète de sprite — le minimum de sprite pour un nœud
 * minéral »). Il faisait huit texels sur seize : une dalle à ras du sol, qui laissait la moitié
 * haute de sa tuile vide. Un nœud qui bloque une tuile entière ne peut pas n'en occuper que la
 * moitié à l'écran.
 *
 * Les deux autres suivent d'un quart de tuile : **16 · 20 · 24**. Le premier jet montait à
 * 16 · 24 · 32 ; Alexis l'a rabattu le même jour (« sauf la hauteur de base, rends les hauteurs
 * moyenne et haute moins dramatiques »). La plus haute déborde donc d'une demi-tuile au nord,
 * comme le faisait `nd-bloc-2` : on reste dans le régime de tri Y déjà éprouvé.
 *
 * ⚠ **CE QUE L'ÉCHELLE COÛTE, MESURÉ.** La face de dessus garde quatre rangées quelle que soit la
 * taille du bloc : plus les blocs montent, plus ils se ressemblent en valeur moyenne. L'écart de
 * luminance entre le bas et le haut, contre le sol d'éboulis à midi, suit les hauteurs :
 *   · 8 · 14 · 22  →  26,9   (mais le petit bloc n'occupait que la moitié de sa tuile)
 *   · 16 · 24 · 32 →  14,0
 *   · 16 · 20 · 24 →   9,3   ← le réglage retenu
 * À 9,3, ce n'est plus la VALEUR qui classe les trois tailles, c'est la SILHOUETTE (quatre texels
 * d'écart par cran). Si le classement devait redevenir lisible d'un coup d'œil, deux leviers, et
 * aucun n'est gratuit : rouvrir l'écartement des hauteurs, ou refonder le corps par palier —
 * c'est-à-dire remettre la valeur peinte que ce module avait justement réussi à retirer.
 */
export const EMERGENCE = [16, 20, 24] as const
export const SOCLE_W = 16
/**
 * ⚠ **UNE RANGÉE TRANSPARENTE EN HAUT, ET CE N'EST PAS DU CONFORT** *(Alexis, 2026-08-27 :
 * « j'ai une ligne fine en haut des sprites sur les pierres »)*.
 *
 * Le rendu global est en ANTIALIAS (`main.ts` : l'UI et le texte doivent rester lisses), et les
 * textures pixel-art sont repassées en NEAREST une à une. Un sprite dont la matière touche la
 * rangée 0 n'a alors AUCUNE marge : à un zoom de caméra fractionnaire, sa rangée du haut est
 * échantillonnée sur une fraction de texel et se détache en un liseré d'un pixel. Les anciens
 * blocs ne l'avaient jamais montré parce que leur art commençait à `y = 3` ou `y = 10` — la marge
 * y était un accident de composition, pas une règle. On la POSE.
 *
 * La texture fait donc `émergence + 1`, et le socle démarre à `y = 1`. La hauteur VISIBLE, elle,
 * ne change pas d'un texel.
 */
export const MARGE_HAUT = 1
export function hauteurDeTexture(taille: number): number {
  return EMERGENCE[taille]! + MARGE_HAUT
}

/** Les quatre nombres validés par Alexis, plus la rotation latérale du biseau. */
export const SOCLE = {
  /** Pente du dessus vers le ciel (nord), en degrés. Seuil du soleil : 21,2°. */
  degDessus: 35,
  /** Pente du corps vers le sud. Au-delà de 21,2°, la face ne voit plus jamais le soleil. */
  degCorps: 30,
  /** Amplitude de la rotation des tranches gauche/droite de la FACE. */
  degCote: 40,
  /** Largeur du biseau entre le dessus et la face, en texels. */
  biseau: 2,
  /**
   * ⚠ LE ROULÉ DU BORD DU DESSUS — un texel, et il n'est pas décoratif.
   *
   * Le dessus est un PLAN, donc son `nx` vaut exactement zéro : le balayage EST→OUEST du soleil
   * (`sunDirection`, ±2200 px) ne peut RIEN lui faire, puisqu'il n'a pas de composante en X à
   * éclairer. Seule son élévation joue, et uniformément — 0,83 à midi, 0,54 au rasant. Alexis l'a
   * vu tout de suite : « la normal map du haut ne réagit pas à la direction du soleil ». C'est
   * exact, et c'est la contrepartie exacte de « complètement plane ».
   *
   * Un seul texel de bord roulé remet l'azimut à l'écran : quatorze colonnes sur seize restent
   * rigoureusement plates, et les deux qui restent s'allument tour à tour selon le côté d'où
   * vient le soleil. À zéro, le dessus redevient un plan parfait — et muet sur la direction.
   */
  biseauDessus: 1,
  /** Amplitude du roulé du bord du dessus. Plus franche que celle du corps — elle n'a qu'un
   *  texel pour se dire — mais pas au point d'allumer un liseré : à 55° le bord au vent sortait
   *  à `rgb(185,166,144)` contre `rgb(146,131,113)` pour le plan, et ce n'est plus une arête,
   *  c'est un trait. */
  degCoteDessus: 42,
  /** Grille du bruit de matière, en texels — la famille `mineral` de `grain-sol` en 4, nous en 2 :
   *  un aplat de valeur à l'échelle d'une tuile se lirait comme une zone de terrain. */
  cellBruit: 2,
  /** Amplitude du bruit sur la normale. Le grain d'albédo, lui, garde ses crans. */
  ampBruit: 0.15,
  /**
   * LE LISERÉ DE BASE (demande d'Alexis, 2026-08-27 : « assombris la base du bloc avec un
   * liseré ») — l'occlusion du contact, là où la pierre entre dans la terre.
   *
   * C'est de l'ALBÉDO, jamais de la normale : la lumière ne doit pas croire que le pied du bloc
   * est une facette tournée vers le bas. Et il s'éteint sur le DESSUS (facteur `1 − t`), sinon
   * le bloc BAS — sept de ses huit rangées sont dessus et rampe — se ferait manger son plan.
   *
   * Il fait deux choses à la fois : il POSE la pierre (sans lui, elle flotte sur l'herbe) et il
   * la DÉTACHE de son sol, ce qui était l'autre reproche du même message.
   */
  lisereRangs: 3,
  lisereForce: 0.4,
} as const

/**
 * LA FLAQUE DE CONTACT d'un socle, en TUILES — et elle ne suit pas la règle générale.
 *
 * Celle-ci est centrée sur le pied du sprite : sa moitié haute passe derrière lui. Un art étroit
 * la laissait déborder ; un socle pleine tuile la mange. On l'élargit donc à 1,9 tuile et on la
 * décale d'un texel vers le SUD, pour qu'elle sorte de sous la pierre au lieu d'y disparaître.
 */
export const SOCLE_OMBRE_TUILES = 1.9
export const SOCLE_OMBRE_DESCENTE = 1

/** Rangées de dessus à hauteur pleine : un PLAN, assez épais pour se lire comme tel. */
const CROWN = 4
/** Hauteur du corps. L'écart avec 1 EST la marche que la rampe descend. */
const CORPS_H = 0.86
/** Rangées de biseau entre le dessus et le corps. */
const RAMPE = 3

const lissage = (t: number): number => t * t * (3 - 2 * t)

/** Un hash entier — le bruit et (un jour) les variantes. Art client : aucun déterminisme exigé. */
function hash3(a: number, b: number, c: number): number {
  let x = (a * 374761393 + b * 668265263 + c * 2147483647) | 0
  x = Math.imul(x ^ (x >>> 13), 1274126177)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

/** LE BRUIT DE MATIÈRE — la grammaire du grain du sol : trois crans quantifiés sur une grille,
 *  jamais un dégradé. Un bloc de pierre ne peut pas être plus lisse que la terre où il pose. */
function bruitCell(x: number, y: number, cell: number, graine: number): number {
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell)
  return 0.6 * hash3(graine + 7, cx, cy) + 0.4 * hash3(graine + 13, cx >> 1, cy >> 1)
}
/** Les crans de la famille `mineral` de `grain-sol` — la même pierre brisée que le sol. */
const CRANS = [1, 0.93, 0.855] as const
function cranDeBruit(b: number): number {
  return b < 0.36 ? CRANS[2] : b < 0.56 ? CRANS[1] : CRANS[0]
}

export interface FormeDeSocle {
  alpha: Uint8Array
  /** Hauteur de MATIÈRE : 1 sur le dessus, `CORPS_H` sur le corps, la rampe entre les deux.
   *  Elle ne sert plus à dériver la normale — elle dit seulement QUELLE FACE on est. */
  relief: Float32Array
  w: number
  h: number
  y0: number
}

/**
 * LA SILHOUETTE — pleine largeur, plantée au bord bas de sa texture.
 *
 * La rangée du sol fait 16/16 texels quoi qu'il arrive : c'est elle qui affirme la hitbox.
 * Le chanfrein de deux texels ne mord que les rangées du haut.
 */
export function formeDeSocle(taille: number, graine = 0): FormeDeSocle {
  const E = EMERGENCE[taille]!
  const h = hauteurDeTexture(taille)
  const y0 = h - E // = MARGE_HAUT : la rangée 0 reste transparente (voir hauteurDeTexture)
  const w = SOCLE_W
  const alpha = new Uint8Array(w * h)
  const relief = new Float32Array(w * h)
  const ch = graine ? 1 + Math.floor(hash3(graine, 1, 0) * 3) : 2
  for (let x = 0; x < w; x++) {
    for (let y = y0; y < h; y++) {
      const dy = y - y0
      if (x < Math.max(0, ch - dy) || x >= w - Math.max(0, ch - dy)) continue
      alpha[y * w + x] = 1
      relief[y * w + x] = dy < CROWN
        ? 1
        : dy < CROWN + RAMPE
          ? 1 - (1 - CORPS_H) * ((dy - CROWN + 1) / (RAMPE + 1))
          : CORPS_H
    }
  }
  return { alpha, relief, w, h, y0 }
}

/**
 * LES NORMALES, ÉCRITES FACE PAR FACE (idées ① et ③ de l'en-tête).
 *
 * Repère de l'écran, **y vers le BAS** (comme le gradient de `normalFromCanvas`) : un `ny`
 * NÉGATIF regarde le nord, donc le ciel. L'encodage RGB et le `FLIP_G` sont faits une seule fois,
 * par `packNormals` — ce module n'écrit jamais d'octet de normale lui-même.
 */
export function normalesDeSocle(f: FormeDeSocle, graine = 0): Float32Array {
  const { w, h } = f
  const rad = Math.PI / 180
  const out = new Float32Array(w * h * 3)
  const xmin = new Int32Array(h).fill(999)
  const xmax = new Int32Array(h).fill(-1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!f.alpha[y * w + x]) continue
      if (x < xmin[y]!) xmin[y] = x
      if (x > xmax[y]!) xmax[y] = x
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!f.alpha[i]) continue
      // t = 1 sur le dessus, 0 sur le corps ; la rampe interpole en douceur, pas en droite.
      const t = lissage(Math.max(0, Math.min(1, (f.relief[i]! - CORPS_H) / (1 - CORPS_H))))
      const phi = ((1 - t) * SOCLE.degCorps - t * SOCLE.degDessus) * rad
      // Deux roulés latéraux, mêlés par `t` : celui de la FACE (large, `biseau`) et celui du
      // BORD DU DESSUS (un texel, `biseauDessus`) — le seul endroit où l'azimut du soleil peut
      // encore s'inscrire sur un dessus plan. Le centre du dessus, lui, ne bouge pas d'un poil.
      const dg = x - xmin[y]!, dd = xmax[y]! - x
      const roule = (larg: number): number =>
        larg <= 0 ? 0 : dg < larg ? -(1 - dg / larg) : dd < larg ? 1 - dd / larg : 0
      const psi = ((1 - t) * roule(SOCLE.biseau) * SOCLE.degCote
        + t * roule(SOCLE.biseauDessus) * SOCLE.degCoteDessus) * rad
      const cf = Math.cos(phi), sf = Math.sin(phi), cp = Math.cos(psi), sp = Math.sin(psi)
      let nx = cf * sp, ny = sf
      const nz = cf * cp
      if (SOCLE.ampBruit > 0) {
        const c = SOCLE.cellBruit
        const gx = bruitCell(x + c, y, c, graine + 1) - bruitCell(x - c, y, c, graine + 1)
        const gy = bruitCell(x, y + c, c, graine + 1) - bruitCell(x, y - c, c, graine + 1)
        const a = SOCLE.ampBruit * (1 - t) // NUL sur le dessus : un plan ne se chiffonne pas
        nx += gx * a
        ny += gy * a
      }
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
      out[i * 3] = nx / l
      out[i * 3 + 1] = ny / l
      out[i * 3 + 2] = nz / l
    }
  }
  return out
}

/* ══ LES MATIÈRES ═════════════════════════════════════════════════════════════════════════════
   Un ton plat, plus un SEMIS de taches pour les minerais. La grammaire est celle du fer, retenue
   par Alexis : quatre ou cinq taches inégales, de quatre tons d'une même famille, posées sans
   alignement — « du minerai PRIS dans la roche », pas un motif appliqué dessus.

   ⚠ DEUX BUGS DE COUVERTURE CORRIGÉS AU PASSAGE, et le fer les avait déjà :
     · les taches étaient à décalage FIXE depuis le haut du bloc (`y0+3`, `y0+6`, `y0+8`). Sur le
       bloc BAS, qui ne fait que huit rangées, les dernières tombaient hors de la silhouette : un
       petit filon en montrait trois, un grand quatre. Le `y` est désormais une FRACTION du corps.
     · le NOMBRE de taches ne suivait pas la taille. Cinq taches sur huit rangées se touchent et
       refont une masse noire : c'est la DENSITÉ qui doit rester constante, pas le compte.
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** Une tache : x · part du corps · largeur · hauteur · index de ton. */
type Tache = readonly [number, number, number, number, number]
type Rect = readonly [number, number, number, number, number] // x, y, w, h, couleur

function semis(f: FormeDeSocle, tons: readonly number[], taches: readonly Tache[]): Rect[] {
  const y1 = f.y0 + 1, y2 = f.h - 1 // la zone peignable : sous la lèvre, jusqu'au sol
  return taches.map(([x, part, w, hh, t]) => {
    const y = Math.max(y1, Math.min(y2 - hh + 1, y1 + Math.round(part * (y2 - y1))))
    return [x, y, w, hh, tons[t]!] as Rect
  })
}

const TONS_FER = [0x9a5a36, 0x8a4e2e, 0xa8613a, 0xb0632e]
const TACHES_FER: readonly (readonly Tache[])[] = [
  [[4, 0.12, 5, 2, 0], [9, 0.58, 3, 2, 1]],
  [[10, 0.02, 2, 2, 3], [4, 0.18, 5, 2, 0], [9, 0.48, 3, 2, 1], [3, 0.74, 2, 3, 2]],
  [[10, 0.02, 2, 2, 3], [4, 0.12, 5, 2, 0], [9, 0.34, 3, 2, 1], [3, 0.56, 2, 3, 2], [6, 0.84, 2, 2, 0]],
]
/** La houille : MÊME semis, tons bleu-noir (le charbon est bleu-noir, pas gris — c'est ce qui le
 *  sépare du granite, qui est chaud) et des taches plus grosses : un banc se débite en plaques.
 *  Positions différentes de celles du fer : deux minerais au même dessin seraient le même nœud. */
const TONS_HOUILLE = [0x1e1d22, 0x17171b, 0x26252c, 0x2b2a33]
const TACHES_HOUILLE: readonly (readonly Tache[])[] = [
  [[3, 0.08, 4, 2, 0], [9, 0.6, 4, 2, 1]],
  [[3, 0.06, 5, 2, 0], [9, 0.36, 4, 2, 1], [4, 0.66, 3, 2, 2], [11, 0.84, 3, 2, 3]],
  [[3, 0.04, 5, 2, 0], [9, 0.24, 5, 2, 1], [2, 0.44, 3, 2, 2], [10, 0.6, 4, 3, 3], [5, 0.82, 4, 2, 1]],
]

export interface MatiereMinerale {
  /** Le ton de matière — plat. Tout le volume vient de la lumière. */
  ton: number
  /** Les inclusions d'albédo, s'il y en a. Jamais d'ombrage : ce sont des MATIÈRES. */
  filon?: (f: FormeDeSocle, taille: number) => Rect[]
}

export const MATIERES_MINERALES: Record<SocleType, MatiereMinerale> = {
  /** Le caillou ordinaire et le bloc d'affleurement : le même granite, gris froid. */
  rock: { ton: 0x726c64 },
  bloc: { ton: 0x726c64 },
  iron_vein: { ton: 0x736a61, filon: (f, taille) => semis(f, TONS_FER, TACHES_FER[taille]!) },
  /** Le schiste sombre qui porte le banc de charbon. */
  coal_seam: { ton: 0x605a54, filon: (f, taille) => semis(f, TONS_HOUILLE, TACHES_HOUILLE[taille]!) },
  /** La pierre TAILLÉE : plus claire, cassure fraîche. */
  quarry: { ton: 0x767068 },
  /** Les gravats : de la pierre travaillée, mais salie et cassée. */
  rubble: { ton: 0x6e6963 },
}

/* ══ LA CUISSON ═══════════════════════════════════════════════════════════════════════════════ */

/** La clé d'un socle. Le `bloc` garde EXACTEMENT la forme qu'il avait (`nd-bloc-<taille>`), et
 *  les cinq autres l'adoptent : une seule règle, six adresses. */
export function cleDeSocle(type: SocleType, taille: number): string {
  return `nd-${type}-${taille}`
}

/** Toutes les clés RÉELLEMENT cuites — la surface testable du câblage. */
export const SOCLE_KEYS: ReadonlySet<string> = new Set(
  SOCLE_TYPES.flatMap((t) => [0, 1, 2].flatMap((n) => [
    cleDeSocle(t, n), cleLit(cleDeSocle(t, n)), cleLit(cleDeSocle(t, n), true),
  ])),
)

/**
 * QUELLE TAILLE POUSSE SUR CETTE TUILE.
 *
 * Le `bloc` la PORTE quand il est sur une butte (`size`, parce qu'elle y dépend de la forme de la
 * butte entière), et la REDÉRIVE ailleurs par `tailleDeBloc` — la même fonction pure que le stock
 * côté sim, donc l'art et la résistance coïncident au bit près. Les cinq autres n'ont pas de
 * champ de taille : un hash pur de la tuile, donc la même pierre y est toujours la même.
 *
 * ⚠ **PAS DÉRIVÉE DU STOCK RESTANT.** Ce serait joli — un filon qui s'enfonce à mesure qu'on le
 * pioche — et ça casserait tout : la taille 2 est en 16×24 quand les deux autres sont en 16×16,
 * donc un nœud changerait de DIMENSION DE TEXTURE en cours de vie, sous un offset et une ombre de
 * contact qui ne sont pas faits pour ça.
 */
export function tailleDeSocle(type: SocleType, tx: number, ty: number, size?: number): number {
  if (type === 'bloc') return size ?? tailleDeBloc(tx, ty)
  return Math.floor(hash3(0x50c1e, tx, ty) * 3)
}

/** Le soleil de MIDI, pour cuire la variante à plat (repli du mode éclairage éteint). */
const MIDI: readonly [number, number, number] = (() => {
  const l = Math.sqrt(1600 * 1600 + 620 * 620)
  return [0, -1600 / l, 620 / l]
})()
const AMBIANTE_PLATE = 0.55, GAIN_PLAT = 0.95

/**
 * Cuit un socle : l'albédo (ton + filon + grain), la normale écrite, et la variante PLATE.
 *
 * La variante plate est bakée depuis LE MÊME champ, sous un soleil de midi figé : elle ne sert
 * que quand `debugLighting` éteint la lumière dynamique, et elle ne peut pas diverger de la
 * version éclairée puisqu'elle en est le calcul, pas un second dessin.
 */
function cuireSocle(scene: Phaser.Scene, type: SocleType, taille: number, graine = 0): void {
  const f = formeDeSocle(taille, graine)
  const n = normalesDeSocle(f, graine)
  const m = MATIERES_MINERALES[type]
  const { w, h } = f
  const veines = new Int32Array(w * h).fill(-1)
  if (m.filon) {
    for (const [x, y, rw, rh, col] of m.filon(f, taille)) {
      for (let dy = 0; dy < rh; dy++) {
        for (let dx = 0; dx < rw; dx++) {
          const px = x + dx, py = y + dy
          if (px < 0 || py < 0 || px >= w || py >= h) continue
          veines[py * w + px] = col
        }
      }
    }
  }
  const alb = newCanvas(w, h)
  const plat = newCanvas(w, h)
  const dA = alb.ctx.createImageData(w, h)
  const dP = plat.ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!f.alpha[i]) continue
      /**
       * ⚠ **PAS DE GRAIN SUR LE DESSUS** *(Alexis, 2026-08-27 : « j'ai une ligne fine en haut des
       * sprites sur les pierres »)*. Relevé au pixel sur une capture : la rangée du haut sortait
       * à `rgb(138,124,108)` quand le reste du plan était à `rgb(145,130,113)`. Ce n'était ni la
       * marge, ni l'antialias — c'était LE GRAIN. Ses cellules font deux texels, et le dessus n'en
       * fait que quatre : deux bandes horizontales, dont celle du bord, coupée net par la
       * silhouette. À l'échelle d'un plan de quatre rangées, un bruit par cellules ne fait pas de
       * la matière, il fait des RAYURES.
       *
       * Le dessus reste donc uniforme (`1 - t` : nul sur le plan, plein sur la face). C'est
       * cohérent avec tout le reste de sa règle — ni biseau, ni bruit de normale, ni liseré n'y
       * entrent : « une brique plantée montre son dessus plat », y compris en valeur.
       */
      const t = Math.max(0, Math.min(1, (f.relief[i]! - CORPS_H) / (1 - CORPS_H)))
      const g0 = 1 - (1 - cranDeBruit(bruitCell(x, y, SOCLE.cellBruit, graine + 1))) * (1 - t)
      const dBas = h - 1 - y
      const lisere = dBas < SOCLE.lisereRangs
        ? 1 - SOCLE.lisereForce * (1 - dBas / SOCLE.lisereRangs) * (1 - t)
        : 1
      const g = g0 * lisere
      const brut = veines[i]! >= 0 ? veines[i]! : m.ton
      const r = Math.round((((brut >> 16) & 0xff) * g))
      const gg = Math.round((((brut >> 8) & 0xff) * g))
      const b = Math.round(((brut & 0xff) * g))
      const o = i * 4
      dA.data[o] = r; dA.data[o + 1] = gg; dA.data[o + 2] = b; dA.data[o + 3] = 255
      const d = Math.max(0, n[i * 3]! * MIDI[0] + n[i * 3 + 1]! * MIDI[1] + n[i * 3 + 2]! * MIDI[2])
      const lum = Math.min(1.45, AMBIANTE_PLATE + GAIN_PLAT * d)
      dP.data[o] = Math.min(255, Math.round(r * lum))
      dP.data[o + 1] = Math.min(255, Math.round(gg * lum))
      dP.data[o + 2] = Math.min(255, Math.round(b * lum))
      dP.data[o + 3] = 255
    }
  }
  alb.ctx.putImageData(dA, 0, 0)
  plat.ctx.putImageData(dP, 0, 0)
  const cle = cleDeSocle(type, taille)
  if (scene.textures.exists(cle)) scene.textures.remove(cle)
  scene.textures.addCanvas(cle, plat.c)
  // LE SOCLE EST DRESSÉ — une brique plantée, avec un dessus et une face. Il a donc son retourné
  // (2026-08-27), mais par un chemin à lui : sa normale n'est pas dérivée d'une silhouette, elle
  // est ÉCRITE (`n`, un champ analytique). La retourner demande de NIER `nx` en plus d'échanger
  // les colonnes — `mirrorField` le fait ; `mirrorCanvas` seul aurait rendu une pierre éclairée
  // du mauvais côté, ce qui est exactement le défaut qu'on chasse.
  registerLitPaireDeChamp(scene, cle, { albedo: alb.c, champ: n, alpha: f.alpha, dresse: true })
}

/** Cuit les dix-huit socles : six matières × trois hauteurs, à plat et éclairés. */
export function generateSocles(scene: Phaser.Scene): void {
  for (const type of SOCLE_TYPES) for (const taille of [0, 1, 2]) cuireSocle(scene, type, taille)
}
