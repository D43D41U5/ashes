/**
 * OÙ SE TIENT UN SON — l'écart au joueur devient un pan, une atténuation et un voile.
 *
 * ═══ POURQUOI ═══
 * `SnapshotMessage.events` n'est filtré NULLE PART : `drainEvents(sim)` verse la totalité des
 * faits dans le snapshot, côté serveur (`tick-driver`) comme dans la Veillée (`sim-worker`).
 * Un `wolf_howl` à l'autre bout de la vallée arrivait donc dans l'oreille au même volume qu'un
 * loup à trois tuiles. Spatialiser n'est pas un ornement : c'est retirer une information FAUSSE.
 *
 * ═══ LA GÉOMÉTRIE, ET POURQUOI ELLE EST SIMPLE ═══
 * L'« ISO » du projet est un STYLE D'ART, pas une projection en losange : la grille est carrée
 * et alignée (`worldX = tx * TILE_PX`). L'écart en X du monde EST l'écart en X de l'écran — le
 * pan est une soustraction, pas une trigonométrie. Et l'écart en Y est de la PROFONDEUR en vue
 * 3/4 : il compte dans la distance, jamais dans le pan.
 *
 * ═══ L'ÉTALON, C'EST LE CADRE ═══
 * Un rayon en tuiles ne dit rien tant qu'on ne le compare pas à ce que la caméra montre
 * (`VISIBLE_TILES_TALL`). Les trois bornes ci-dessous s'en DÉRIVENT — aucune n'est un nombre
 * posé à la main —, et la garde de `spatial.test.ts` les recalcule du cadre réel (1280×720)
 * plutôt que de relire la constante qu'elle teste.
 *
 * ═══ CE QUE LE SON PORTE (décision d'Alexis, 2026-08-27) ═══
 * Il porte AU-DELÀ du cadre. La promesse est écrite dans `sound.ts` : le loup et le Cendreux
 * ont deux voix exprès « pour que le joueur sache laquelle des deux parades il prépare sans
 * regarder l'écran » — elle ne paie que si l'on entend avant de voir. D'où la queue sourde
 * jusqu'à une fois et demie le demi-cadre, et la coupure franche au-delà : à trente tuiles,
 * un fait n'a plus rien à vous dire.
 */
import { VISIBLE_TILES_TALL } from '../render/framing'

/**
 * Le rapport de l'image (`main.ts` : 1280×720, Scale.FIT). Le cadre est plus LARGE que haut,
 * et c'est la LARGEUR qui étalonne un son : c'est sur elle que le pan se déplie.
 */
export const RATIO_IMAGE = 16 / 9

/** La demi-largeur du cadre, en tuiles (~17,8) — L'ÉTALON de tout ce fichier. */
export const DEMI_CADRE_TUILES = (VISIBLE_TILES_TALL * RATIO_IMAGE) / 2

/**
 * Sous ce rayon, un son sonne PLEIN et sans voile — c'est « ici », à portée de bras et de
 * geste. Trois tuiles : le pas, le coup, l'établi. En deçà, atténuer serait mentir dans
 * l'autre sens (on n'entend pas moins fort ce qu'on est en train de faire).
 */
export const PLEIN_TUILES = 3

/** La PORTÉE : au-delà, le fait ne se joue pas du tout. Une fois et demie le demi-cadre. */
export const PORTEE_TUILES = DEMI_CADRE_TUILES * 1.5

/**
 * Ce qu'il reste de gain AU BORD DU CADRE. Pas un dixième : à 0,38 un hurlement hors champ
 * s'entend encore comme un hurlement — c'est le point de tout l'exercice. La chute vers zéro
 * se fait ensuite, sur la queue.
 */
export const GAIN_BORD = 0.38

/**
 * Le pan ne va JAMAIS à ±1. Un son collé dans une seule oreille est désagréable au casque et
 * simplement absent au haut-parleur qu'on n'a pas en face de soi. ±0,65 au bord du cadre.
 */
export const PAN_MAX = 0.65

/** Le haut du spectre : le voile part de là, au ras de `PLEIN_TUILES` (aucune coupure audible). */
export const VOILE_TRANSPARENT_HZ = 18000

/** Le voile de distance (passe-bas) au bord du cadre, puis à la portée maximale — l'air mange
 *  les aigus avant les graves, et c'est ce qui fait qu'un son est LOIN plutôt que faible. */
export const VOILE_BORD_HZ = 5200
export const VOILE_PORTEE_HZ = 800

/**
 * LA COMPENSATION D'ÉNERGIE. `StereoPannerNode` panoramique à ÉNERGIE CONSTANTE : une source
 * mono centrée sort à cos(π/4) ≈ 0,707 dans chaque canal, là où la brancher directement sur
 * la destination stéréo la duplique à 1,0 des deux côtés. Sans correction, spatialiser aurait
 * baissé TOUT le jeu de 3 dB — un changement que personne n'a demandé, et qu'on aurait mis
 * sur le compte du timbre. Avec elle, un son au centre sonne EXACTEMENT comme avant.
 */
export const COMPENSATION_PAN = Math.SQRT2

/**
 * ═══ LA PUISSANCE D'UN SON — les cinq crans (décision d'Alexis, 2026-08-27) ═══
 *
 * Une seule courbe pour tout le jeu donnait la MÊME portée à un hurlement de loup et à un gond
 * de porte. La puissance étire l'axe des distances : un son puissant est plein plus loin ET
 * porte plus loin. Multiplicateur, donc `FAIT` = 1 laisse le monde exactement où il était.
 *
 * ⚠ ELLE N'EST PAS DÉRIVÉE DU `gain`, et c'est délibéré : `gain` est calibré pour l'ÉQUILIBRE
 * AU TYMPAN, pas pour la puissance à la source. Un murmure à l'oreille est fort et ne porte
 * nulle part — et `entity_damaged` « sur moi » porte le gain le plus haut de la table (0,12)
 * précisément parce qu'il est sur mon corps. Deux grandeurs, deux champs.
 *
 * ⚠ ET ELLE VIT SUR LE SON, PAS SUR LE FAIT. C'est `node_depleted` qui l'a tranché : le même
 * fait de domaine rend trois voix (l'arbre, la pierre, le végétal) qui ne portent visiblement
 * pas à la même distance. Un cran par fait n'aurait pas su le dire.
 */
export const PORTEE = {
  /** ×0,4 ≈ 11 t — ce qu'on fait sous sa main : l'établi, le gond, la bande, la braise. */
  GESTE: 0.4,
  /** ×1 ≈ 27 t — le défaut, et l'état du monde avant ce cran : le coup, la plaie, le don. */
  FAIT: 1,
  /** ×1,5 ≈ 40 t — la masse qui retombe. Entre les deux crans, à dessein : un éboulis n'est
   *  pas un arbre qui tombe, mais ce n'est pas non plus une brassée de baies. */
  MASSE: 1.5,
  /** ×2 ≈ 53 t — ce qui s'entend d'un village à l'autre : la mort, l'effondrement, l'alarme. */
  LOIN: 2,
  /** ×3 ≈ 80 t — l'avertissement qui doit PRÉCÉDER la vue : le hurlement, le cri, l'arbre. */
  CRI: 3,
} as const

/** Où un son se pose : ce que `buildSound` a besoin de savoir en plus du `SoundSpec`. */
export interface Placement {
  /** −1 (gauche) à +1 (droite), borné à ±`PAN_MAX`. */
  pan: number
  /** Le facteur d'atténuation appliqué au gain crête du `SoundSpec` (compensation incluse). */
  gain: number
  /** Le voile de distance (Hz). Absent en deçà de `PLEIN_TUILES` : de près, le timbre est
   *  celui que `sound.ts` a écrit, sans un filtre de plus dans le graphe. */
  lowpass?: number
}

const borne = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v))

/** Interpolation géométrique — l'oreille lit les fréquences en octaves, pas en hertz. */
const versHz = (de: number, a: number, u: number): number => de * Math.pow(a / de, borne(u, 0, 1))

/**
 * Place un son : `dx`/`dy` sont l'écart SOURCE − AUDITEUR, en tuiles (`dx` > 0 = à droite).
 * Rend `null` hors de portée — le son ne se joue alors PAS, ce qui est le vrai correctif :
 * aujourd'hui il se joue plein pot.
 *
 * À écart NUL (le fait m'arrive à moi), le résultat est pan 0 / gain 1 / aucun voile : le son
 * est byte pour byte celui d'avant. C'est pour ça qu'il n'y a AUCUN cas particulier « sur
 * moi » dans ce fichier — un cas particulier finit toujours par se désaccorder de sa règle.
 */
export function placer(dx: number, dy: number, portee: number = PORTEE.FAIT): Placement | null {
  const d = Math.sqrt(dx * dx + dy * dy)
  // Les TROIS bornes de l'atténuation s'étirent ensemble avec la puissance : c'est ce qui fait
  // qu'un hurlement est plein jusqu'à neuf tuiles et porte à quatre-vingts, sans changer la
  // FORME de la courbe — un seul profil sonore pour tout le jeu, à cinq échelles.
  const plein = PLEIN_TUILES * portee
  const mi = DEMI_CADRE_TUILES * portee
  const bout = PORTEE_TUILES * portee
  if (d > bout) return null

  let attenuation: number
  if (d <= plein) attenuation = 1
  else if (d <= mi) {
    // De « ici » au point de mi-course : on descend de 1 à `GAIN_BORD`.
    attenuation = 1 + (GAIN_BORD - 1) * ((d - plein) / (mi - plein))
  } else {
    // La QUEUE : de `GAIN_BORD` à zéro. C'est elle qui porte l'avertissement.
    attenuation = GAIN_BORD * (1 - (d - mi) / (bout - mi))
  }

  // ⚠ LE PAN NE S'ÉTIRE PAS, LUI. Le panoramique dit OÙ SUR L'ÉCRAN se tient la source, et
  // l'écran ne change pas de largeur parce qu'un son est puissant : un loup à dix-huit tuiles
  // à droite est au bord du cadre, qu'il hurle ou qu'il gratte. C'est la seule des trois
  // courbes dont l'étalon reste le CADRE et non la puissance.
  const pan = borne(dx / DEMI_CADRE_TUILES, -1, 1) * PAN_MAX

  if (d <= plein) return { pan, gain: attenuation * COMPENSATION_PAN }
  // Le voile suit la MÊME pente en deux temps que le gain : transparent à `plein`,
  // `VOILE_BORD_HZ` à mi-course, `VOILE_PORTEE_HZ` au bout de la queue.
  const lowpass =
    d <= mi
      ? versHz(VOILE_TRANSPARENT_HZ, VOILE_BORD_HZ, (d - plein) / (mi - plein))
      : versHz(VOILE_BORD_HZ, VOILE_PORTEE_HZ, (d - mi) / (bout - mi))
  return { pan, gain: attenuation * COMPENSATION_PAN, lowpass }
}

/**
 * ═══ OÙ S'ENTEND UN FAIT ═══
 *
 * Le fait de domaine ne dit pas où il s'entend : il porte un `x,y`, une tuile, ou un simple
 * IDENTIFIANT (`entityId`, `nodeId`, `structureId`, `villageId`) que seul le client peut
 * résoudre. Cette union nomme la RÈGLE de résolution, fait par fait ; `WorldScene` l'applique.
 *
 * Pourquoi une déclaration et non une sonde sur les champs présents : parce qu'une sonde
 * générique rend `null` quand elle ne trouve rien, et un `null` silencieux est exactement la
 * garde qui dégrade et cache son défaut. Ici, `inventaire.ts` EXIGE un ancrage de tout fait
 * qui a une voix (le type le rend rouge sinon) : le silence géographique devient un CHOIX
 * écrit, comme le silence tout court l'est déjà.
 */
export type Ancrage =
  /** UNE ANNONCE, pas un lieu : le monde parle au joueur. Jamais panoramiqué, jamais coupé —
   *  la nuit, l'acte, la fin de saison, le présage d'une horde née hors du rayon d'intérêt. */
  | 'monde'
  /** Le fait porte `x`/`y`, en tuiles — flottantes pour une position d'acteur, entières pour
   *  un fait de tuile (l'envol) : le demi-pas d'écart vaut 3 % de pan, on ne le corrige pas. */
  | 'xy'
  /** Le fait porte `tx`/`ty` (tuile entière — on vise son centre). */
  | 'tuile'
  /** `entityId` : le sujet du fait (la victime, le pêcheur, l'artisan). */
  | 'entite'
  /** `targetEntityId` : celui que le fait VISE (la meute a choisi un homme). */
  | 'cible'
  /** `byEntityId` : celui qui AGIT (donner, dépouiller, abattre, découvrir). */
  | 'auteur'
  /** `nodeId` : le nœud de ressource. */
  | 'noeud'
  /** `structureId` : la structure (une porte, un foyer, un potager). */
  | 'structure'
  /** `villageId` : le Feu du village (`fireTx`/`fireTy`) — le cœur d'un lieu habité. */
  | 'village'

/**
 * ═══ LES ANCRAGES LÉGAUX D'UN FAIT DONNÉ ═══
 *
 * Déclarer `'entite'` sur un fait qui ne porte pas d'`entityId` produirait un son qu'on ne
 * saurait jamais placer — et la panne serait MUETTE : le fait sonnerait au centre et plein,
 * indiscernable d'une annonce assumée. Ce type le rend IMPOSSIBLE : le compilateur n'offre à
 * chaque fait que les ancrages que ses champs peuvent honorer.
 *
 * (Un champ OPTIONNEL ne compte pas — `nodeId?: number` sur les faits de pêche ne suffit pas
 * à ancrer un son sur un nœud, et c'est bien ainsi : « parfois résoluble » est le pire des
 * régimes, celui qui marche en test et se tait en jeu.)
 *
 * `'monde'` est toujours offert : renoncer à situer un fait est un choix légitime, écrit.
 */
export type AncrageDe<T> =
  | 'monde'
  | (T extends { x: number; y: number } ? 'xy' : never)
  | (T extends { tx: number; ty: number } ? 'tuile' : never)
  | (T extends { entityId: number } ? 'entite' : never)
  | (T extends { targetEntityId: number } ? 'cible' : never)
  | (T extends { byEntityId: number } ? 'auteur' : never)
  | (T extends { nodeId: number } ? 'noeud' : never)
  | (T extends { structureId: number } ? 'structure' : never)
  | (T extends { villageId: number } ? 'village' : never)
