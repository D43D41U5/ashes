/**
 * LA FLORE QUI GÈLE — la transition d'une plante entre « là » et « partie » (spec
 * `flore-froid.md` F8, révisée le 2026-08-22 : « les fleurs, champignons, brins d'herbe
 * devraient disparaître lorsqu'il gèle, avec un effet juicy, et respawn lorsque la
 * température le permet »).
 *
 * ═══ CE QUE C'EST, ET CE QUE CE N'EST PAS ═══
 *
 * Du RENDU. La sim ne perd rien (F6 : « rien ne meurt côté sauvage, le sauvage attend ») ; le
 * nœud reste sur la carte, refuse la cueillette (F3), et repousse quand le froid lâche. Ce
 * module ne décide pas QUAND : le prédicat est `floreGelee`, relevé par la couche du gel
 * (`gel-layer.ts`, `floreGeleeAt`) ; il décide COMMENT ça se voit passer d'un état à l'autre.
 *
 * ═══ LA MÉMOIRE : LES BASCULES, PAS L'ÉTAT ═══
 *
 * Le fouillis et les nœuds sont des sprites POOLÉS, sans identité d'une image à l'autre. Pour
 * animer une disparition il faut se souvenir qu'elle a commencé : une entrée par clé (la
 * tuile du brin, l'id du nœud) qui ne porte que la DERNIÈRE BASCULE vue et sa date. À la
 * première vue d'une clé, rien ne s'anime (un monde déjà gelé au spawn est nu, pas en train
 * de mourir) ; à chaque bascule, l'animation part — après un RETARD positionnel, pour qu'un
 * pré entier ne s'éteigne pas en une image quand `floreEntierementGelee` bascule la vallée.
 *
 * ═══ LE GESTE ═══
 *
 * Geler : une ANTICIPATION (la plante s'étire vers le haut, s'amincit) puis l'EFFONDREMENT
 * (elle s'écrase au sol, s'élargit) — et une gerbe de givre au moment où elle casse. Dégeler :
 * un POP (elle jaillit du sol, dépasse sa taille, puis s'y pose) — et une gerbe verte. Des
 * courbes continues par morceaux, bornes exactes (1 au repos, 0 au sol).
 *
 * Pur : pas de Phaser, testé en Node (`flore-gel.test.ts`).
 */
import { hash2 } from '@ashes/sim'

/** Réglages — se règlent en REGARDANT. */
export const FLORE_GEL = {
  /** La durée du geste (ms), dans un sens comme dans l'autre. */
  DUREE_MS: 420,
  /** L'étalement des départs sur une zone qui bascule d'un coup (ms) : le retard d'une clé est
   *  tiré dans [0, ETALEMENT] par sa position. */
  ETALEMENT_MS: 900,
  /** L'anticipation du gel : part du geste passée à s'étirer, et de combien. */
  ANTICIPATION: 0.3,
  ETIREMENT: 0.18,
  /** L'écrasement au sol en fin de gel : l'élargissement. */
  ECRASEMENT: 0.35,
  /** Le sursaut du dégel : le dépassement au sommet du pop, et où il culmine (part du geste). */
  SURSAUT: 0.28,
  SOMMET: 0.65,
} as const

export interface PoseFlore {
  /** Les échelles à appliquer au sprite (origine aux pieds). */
  sx: number
  sy: number
  /** Faux : rien à dessiner (la plante est partie, ou pas encore revenue). */
  visible: boolean
  /** Vrai sur l'image où la bascule DÉMARRE — le moment de la gerbe. Une seule fois. */
  eclat: boolean
}

const REPOS: PoseFlore = { sx: 1, sy: 1, visible: true, eclat: false }
const ABSENT: PoseFlore = { sx: 1, sy: 1, visible: false, eclat: false }

/** Le retard positionnel d'une clé, dans [0, ETALEMENT_MS). */
export function retardDe(tx: number, ty: number, sel = 0): number {
  return hash2(tx, ty, 0x9e1 + sel) * FLORE_GEL.ETALEMENT_MS
}

/**
 * La pose pour un geste à l'avancement `p` ∈ [0, 1]. Hors [0, 1] : avant le geste (l'état
 * d'avant), après (l'état d'après).
 */
export function poseDuGeste(gele: boolean, p: number): { sx: number; sy: number; visible: boolean } {
  const { ANTICIPATION, ETIREMENT, ECRASEMENT, SURSAUT, SOMMET } = FLORE_GEL
  if (gele) {
    if (p <= 0) return { sx: 1, sy: 1, visible: true }
    if (p >= 1) return { sx: 1, sy: 1, visible: false }
    if (p < ANTICIPATION) {
      // L'anticipation : vers le haut, plus mince — linéaire, bornes exactes.
      const u = p / ANTICIPATION
      return { sx: 1 - ETIREMENT * 0.5 * u, sy: 1 + ETIREMENT * u, visible: true }
    }
    // L'effondrement : de l'étirement à zéro, en s'élargissant. Accélère (u²) : ça casse.
    const u = (p - ANTICIPATION) / (1 - ANTICIPATION)
    const chute = u * u
    return {
      sx: 1 - ETIREMENT * 0.5 + (ECRASEMENT + ETIREMENT * 0.5) * chute,
      sy: (1 + ETIREMENT) * (1 - chute),
      visible: true,
    }
  }
  if (p <= 0) return { sx: 1, sy: 1, visible: false }
  if (p >= 1) return { sx: 1, sy: 1, visible: true }
  if (p < SOMMET) {
    // Le pop : du sol au sommet, plus haut que sa taille, plus mince. Décélère (1 − (1−u)²).
    const u = p / SOMMET
    const monte = 1 - (1 - u) * (1 - u)
    return { sx: (1 - SURSAUT * 0.4) * monte, sy: (1 + SURSAUT) * monte, visible: true }
  }
  // Le retour : du sommet au repos — linéaire, bornes exactes.
  const u = (p - SOMMET) / (1 - SOMMET)
  return { sx: 1 - SURSAUT * 0.4 * (1 - u), sy: 1 + SURSAUT * (1 - u), visible: true }
}

interface Bascule {
  gele: boolean
  /** La date (ms) où le geste démarre — retard compris. −∞ : jamais animé (première vue). */
  depuis: number
  /** La gerbe a été donnée. */
  eclate: boolean
  /** La dernière image où la clé a été vue (pour l'oubli). */
  vu: number
}

/** Les bascules connues, par clé. Une instance par couche (fouillis, nœuds). */
export class TransitionsFlore {
  private readonly bascules = new Map<number, Bascule>()
  private frame = 0

  /** À appeler une fois par image avant les `pose` : avance l'horloge d'oubli. */
  image(): void {
    this.frame++
    if (this.frame % 600 === 0) {
      for (const [k, b] of this.bascules) {
        if (this.frame - b.vu > 600) this.bascules.delete(k)
      }
    }
  }

  /**
   * La pose d'une clé, sachant si elle est gelée MAINTENANT. `retard` : le décalage du
   * départ (voir `retardDe`). Une clé jamais vue prend son état sans geste.
   */
  pose(cle: number, gele: boolean, now: number, retard: number): PoseFlore {
    let b = this.bascules.get(cle)
    if (!b) {
      b = { gele, depuis: -Infinity, eclate: true, vu: this.frame }
      this.bascules.set(cle, b)
      return gele ? ABSENT : REPOS
    }
    b.vu = this.frame
    if (b.gele !== gele) {
      // Une bascule en cours qui se renverse repart d'où elle est : pas de saut. Le geste
      // inverse commence au même avancement inversé — approximation honnête, borné à [0, 1].
      const enCours = b.depuis === -Infinity ? 1 : Math.max(0, Math.min(1, (now - b.depuis) / FLORE_GEL.DUREE_MS))
      b.gele = gele
      b.depuis = enCours >= 1 ? now + retard : now - (1 - enCours) * FLORE_GEL.DUREE_MS
      b.eclate = enCours < 1 // un geste renversé à mi-course ne redonne pas de gerbe
    }
    if (b.depuis === -Infinity) return gele ? ABSENT : REPOS
    const p = (now - b.depuis) / FLORE_GEL.DUREE_MS
    const g = poseDuGeste(gele, p)
    let eclat = false
    if (!b.eclate && p >= 0) {
      b.eclate = true
      eclat = true
    }
    return { sx: g.sx, sy: g.sy, visible: g.visible, eclat }
  }

  get taille(): number {
    return this.bascules.size
  }
}
