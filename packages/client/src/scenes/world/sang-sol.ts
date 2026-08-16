/**
 * LE DÉCOR DE CHAQUE GOUTTE AU SOL (spec chasse C9) — variante, orientation, échelle.
 *
 * La piste de sang se dessinait avec UNE texture, jamais tournée, jamais variée : à la
 * troisième goutte l'œil voyait le motif se répéter, et la piste lisait comme un
 * tampon, pas comme du sang (constaté par Alexis le 2026-08-16). Or la texture promet
 * depuis toujours « elle a un SENS » (BootScene) — et ce sens n'était jamais peint.
 *
 * Trois décisions, toutes dérivées des DONNÉES, jamais tirées au sort par frame :
 *
 *   1. L'ORIENTATION SUIT LA COURSE. La sim ne relie pas une goutte à son animal
 *      (`blood: {x,y,tick}[]`, rien d'autre) — mais elle goutte à cadence FIXE
 *      (`HUNT.BLOOD_EVERY_TICKS`, phase propre à chaque bête) : la goutte précédente
 *      d'une même piste est donc à EXACTEMENT `everyTicks` de là, à portée de course.
 *      On l'apparie, et l'éclaboussure pointe dans le sens du déplacement — la piste
 *      dit enfin où la bête ALLAIT, pas seulement où elle est passée.
 *
 *   2. LA VARIANTE DIT L'ALLURE. Une bête presque à l'arrêt laisse une FLAQUE, une
 *      bête qui trotte une ÉCLABOUSSURE, une bête lancée une TRAÎNÉE — la distance
 *      entre deux gouttes appariées est une vitesse, on la lit. Sans précédente
 *      (première goutte d'une piste), le hachage choisit.
 *
 *   3. TOUT LE RESTE EST HACHÉ SUR LA GOUTTE MÊME (x, y, tick) — reproductible d'une
 *      frame à l'autre et d'un snapshot à l'autre : le pool se réattribue chaque
 *      frame, un tirage par frame ferait scintiller la piste entière.
 *
 * Module PUR (aucun import Phaser) : c'est lui qu'on teste, le rendu ne fait
 * qu'appliquer.
 */

/** Une goutte telle que le snapshot la transporte (`protocol.ts`, spec chasse C9). */
export interface GoutteSang {
  x: number
  y: number
  tick: number
}

export interface DecorSang {
  /** Index de texture `fx-blood[-n]` — voir `SANG_TEXTURES`. */
  variante: number
  /** Rotation, en radians : l'axe +X de la texture pointe dans le sens de la course. */
  angle: number
  echelle: number
}

/** Les textures, dessinées dans BootScene — TOUTES orientées +X (le sens de la course). */
export const SANG_TEXTURES = ['fx-blood', 'fx-blood-1', 'fx-blood-2', 'fx-blood-3'] as const

/** En deçà (tuiles entre deux gouttes), la bête stagne : c'est une FLAQUE. */
const ALLURE_FLAQUE = 0.6
/** Au-delà, elle est lancée : c'est une TRAÎNÉE. Entre les deux, éclaboussure/gouttelettes. */
const ALLURE_TRAINEE = 2.2
/** Distance maximale d'appariement, en tuiles : au-delà, ce n'est pas la même piste
 *  (aucune bête ne parcourt plus par intervalle de goutte — et un faux appariement
 *  orienterait une piste vers une AUTRE, pire que pas d'orientation du tout). */
const PAS_MAX = 6
/** L'appariement tolère ±2 ticks : la cadence est exacte dans la sim d'aujourd'hui,
 *  mais une goutte re-datée d'un tick (re-blessure, bord de plafond) ne doit pas
 *  perdre toute la piste. */
const TOLERANCE_TICKS = 2

/**
 * Hachage 32 bits d'une goutte — stable, sans état, borné aux opérations sûres
 * (`imul`, décalages). Le rendu n'a aucune contrainte de déterminisme inter-moteurs
 * (on n'est pas dans /sim), mais un hachage SUR LA DONNÉE rend chaque goutte
 * identique à elle-même à chaque frame — c'est ça qu'on achète.
 */
export function hachageGoutte(x: number, y: number, tick: number): number {
  // Les positions sont continues (tuiles fractionnaires) : on les quantifie au 1/64
  // de tuile avant de hacher — bien sous le pixel, mais entier.
  let h = Math.imul(Math.round(x * 64), 0x9e3779b1) ^ Math.imul(Math.round(y * 64), 0x85ebca6b) ^ Math.imul(tick, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  return h >>> 0
}

/**
 * Le décor de toutes les gouttes d'un snapshot, dans le même ordre. À recalculer
 * SEULEMENT quand le tableau change (une référence par snapshot) — jamais par frame.
 */
export function decorerSang(gouttes: readonly GoutteSang[], everyTicks: number): DecorSang[] {
  // Index par tick : le tableau est chronologique mais les pistes s'entrelacent —
  // la précédente d'une goutte n'est PAS sa voisine d'index.
  const parTick = new Map<number, number[]>()
  for (let i = 0; i < gouttes.length; i++) {
    const t = gouttes[i]!.tick
    const l = parTick.get(t)
    if (l) l.push(i)
    else parTick.set(t, [i])
  }

  return gouttes.map((g) => {
    const h = hachageGoutte(g.x, g.y, g.tick)

    // LA PRÉCÉDENTE : même piste = un intervalle de cadence plus tôt, à portée de course.
    let px = 0
    let py = 0
    let meilleur = Infinity
    for (let dt = -TOLERANCE_TICKS; dt <= TOLERANCE_TICKS; dt++) {
      const candidats = parTick.get(g.tick - everyTicks + dt)
      if (!candidats) continue
      for (const j of candidats) {
        const c = gouttes[j]!
        const dx = g.x - c.x
        const dy = g.y - c.y
        const d2 = dx * dx + dy * dy
        if (d2 < meilleur) {
          meilleur = d2
          px = dx
          py = dy
        }
      }
    }

    const dist = meilleur === Infinity ? Infinity : Math.sqrt(meilleur)
    // L'échelle respire de ±20 % autour de 1 — assez pour casser le tampon, pas
    // assez pour qu'une goutte se prenne pour une mare.
    const echelle = 0.8 + ((h >>> 8) % 100) / 100 * 0.4

    if (dist > PAS_MAX) {
      // Première goutte d'une piste (ou piste rompue) : pas de course à suivre —
      // le hachage oriente et choisit, et il choisira PAREIL à chaque frame.
      return { variante: h % SANG_TEXTURES.length, angle: ((h >>> 4) % 628) / 100, echelle }
    }

    // L'ALLURE choisit la forme ; la course, l'angle. Une bête à l'arrêt n'a pas de
    // sens de course lisible : la flaque garde l'angle du hachage (une flaque est
    // ronde, mais ses bords irréguliers ne doivent pas se répéter non plus).
    if (dist < ALLURE_FLAQUE) {
      return { variante: 0, angle: ((h >>> 4) % 628) / 100, echelle }
    }
    const angle = Math.atan2(py, px)
    if (dist > ALLURE_TRAINEE) return { variante: 2, angle, echelle }
    return { variante: h % 2 === 0 ? 1 : 3, angle, echelle }
  })
}

/**
 * LE SÉCHAGE — la teinte multiplicative d'une goutte selon son âge (0 = fraîche,
 * 1 = au bord de l'effacement). Le commentaire du rendu promettait « de l'écarlate
 * au brun » depuis C9, mais seul l'alpha bougeait : le brun n'était jamais peint.
 * Blanc (la texture telle quelle) vers un brun terreux qui éteint le cœur vif.
 */
export function teinteSechage(age: number): number {
  const k = Math.max(0, Math.min(1, age))
  const canal = (frais: number, sec: number): number => Math.round(frais + (sec - frais) * k)
  // Vers 0xb5988a : le rouge survit mieux que le vert et le bleu — du sang séché,
  // pas de la boue grise.
  return (canal(255, 181) << 16) | (canal(255, 152) << 8) | canal(255, 138)
}
