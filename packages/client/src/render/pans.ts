/**
 * LES PANS DE MUR — l'unité d'effacement du bâti (décisions d'Alexis, 2026-07-27).
 *
 * ═══ POURQUOI UN « PAN » ET PAS UNE TUILE ═══
 *
 * On effaçait les murs tuile par tuile, sur un seul critère : « ce sprite recouvre-t-il le
 * joueur ? ». Deux défauts, et le second est structurel :
 *   • un TROU qui suit le joueur dans un mur continu lit comme une brèche, donc comme une
 *     entrée — le mur ment sur ce qu'il ferme ;
 *   • les murs de GAUCHE et de DROITE ne recouvrent jamais personne (ils montent au-dessus de
 *     leur propre tuile, pas de la vôtre) : ce critère ne pouvait pas les atteindre, et l'on ne
 *     voyait donc jamais ce qui se tient derrière eux.
 *
 * L'unité est donc le PAN : **toutes les barrières qui bordent une même région de sol bâti sur
 * un même côté**, brèches comprises. Le côté d'une salle tombe d'un bloc, ou pas du tout.
 *
 * ═══ CE QUI FAIT UNE RÉGION ═══
 *
 * Un ensemble connexe de tuiles portant le MÊME sol bâti. Le dallage de la salle et la terre
 * battue de la cour sont deux sols différents, donc deux régions — sans quoi elles fusionne-
 * raient (elles se touchent) et le mur qui les sépare n'aurait plus de côté.
 *
 * Une barrière qui ne borde aucune région (un mur de joueur planté dans l'herbe) n'est pas
 * perdue pour autant : elle retombe sur un pan de CONTIGUÏTÉ — la suite de barrières alignées
 * qui portent la même arête.
 *
 * ═══ QUAND UN PAN TOMBE ═══
 *
 *   • DISTANCE (les deux côtés, dedans comme dehors) : le joueur est à `D` tuiles ou moins de
 *     la ligne du pan, et dans son emprise élargie de `D`. `D = 2` vaut la hauteur apparente
 *     d'un mur : on voit derrière lui exactement quand il pourrait cacher quelqu'un.
 *   • DEDANS : le pan qui borde une région AU SUD tombe dès qu'on est dans cette région, quelle
 *     que soit la distance — c'est la façade qui se dresse entre la pièce et la caméra.
 *
 * Math pure, aucun import Phaser : tout est testable à froid.
 */

/** Ce que ce module a besoin de savoir d'une structure. */
export interface StructureLike {
  id: number
  tx: number
  ty: number
  type: string
  edges?: number
}

export type Cote = 'N' | 'E' | 'S' | 'O'

export interface Pan {
  id: number
  /** L'axe de la LIGNE : 'H' = elle court d'est en ouest, 'V' = du nord au sud. */
  axe: 'H' | 'V'
  /** La coordonnée de la ligne (y si 'H', x si 'V'), en tuiles. */
  ligne: number
  /** L'étendue le long de l'axe, en tuiles (bornes incluses). */
  debut: number
  fin: number
  /** La région bordée (−1 = aucune : pan de contiguïté), et de quel côté d'elle il se tient. */
  region: number
  cote: Cote
}

export interface Pans {
  liste: readonly Pan[]
  /** id de structure → ids de pans. Une barrière d'angle en porte deux. */
  parBarriere: ReadonlyMap<number, readonly number[]>
  /** La région d'une tuile de sol bâti, ou −1. */
  regionDe: (tx: number, ty: number) => number
}

const N = 1, E = 2, S = 4, O = 8
/** Les sols qui font un DEDANS. Deux types différents = deux régions, même s'ils se touchent. */
const SOLS = new Set(['floor', 'terre', 'roof'])
/** Ce qui peut porter une arête et se faire trancher. */
const BARRIERES = new Set(['wall', 'cloture', 'encadrement'])

/** Le bit déclaré, la direction où il regarde, et le côté de la région qu'il borde alors. */
const BITS: readonly { bit: number; dx: number; dy: number; cote: Cote; axe: 'H' | 'V' }[] = [
  // Une barrière qui déclare son arête NORD regarde la tuile du dessus : elle borde donc cette
  // région-là par le SUD. C'est l'inversion qui a déjà coûté une découpe à l'envers.
  { bit: N, dx: 0, dy: -1, cote: 'S', axe: 'H' },
  { bit: S, dx: 0, dy: 1, cote: 'N', axe: 'H' },
  { bit: E, dx: 1, dy: 0, cote: 'O', axe: 'V' },
  { bit: O, dx: -1, dy: 0, cote: 'E', axe: 'V' },
]

export function calculerPans(structures: readonly StructureLike[]): Pans {
  // ── 1. LES RÉGIONS : un remplissage par TYPE de sol ────────────────────────
  const solParTuile = new Map<string, string>()
  for (const s of structures) if (SOLS.has(s.type)) solParTuile.set(`${s.tx},${s.ty}`, s.type)
  const region = new Map<string, number>()
  let prochaine = 0
  for (const [cle, type] of solParTuile) {
    if (region.has(cle)) continue
    const id = prochaine++
    const file = [cle]
    region.set(cle, id)
    for (let h = 0; h < file.length; h++) {
      const [x, y] = file[h]!.split(',').map(Number) as [number, number]
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const k = `${x + dx},${y + dy}`
        if (region.has(k) || solParTuile.get(k) !== type) continue
        region.set(k, id)
        file.push(k)
      }
    }
  }
  const regionDe = (tx: number, ty: number): number => region.get(`${tx},${ty}`) ?? -1

  // ── 2. LES PANS : un par (région, côté), plus les pans de contiguïté ───────
  const pans: Pan[] = []
  const parCle = new Map<string, number>()
  const parBarriere = new Map<number, number[]>()
  const ajouter = (cle: string, p: Omit<Pan, 'id'>, sid: number): void => {
    let i = parCle.get(cle)
    if (i === undefined) {
      i = pans.length
      parCle.set(cle, i)
      pans.push({ id: i, ...p })
    } else {
      // L'emprise d'un pan est l'union de ce qu'il borde : c'est ce qui fait qu'une BRÈCHE ne
      // le coupe pas — les deux tronçons appartiennent au même côté de la même région.
      const pan = pans[i]!
      pan.debut = Math.min(pan.debut, p.debut)
      pan.fin = Math.max(pan.fin, p.fin)
    }
    const l = parBarriere.get(sid)
    if (l === undefined) parBarriere.set(sid, [i])
    else if (!l.includes(i)) l.push(i)
  }

  for (const s of structures) {
    if (!BARRIERES.has(s.type) || s.edges === undefined) continue
    for (const { bit, dx, dy, cote, axe } of BITS) {
      if ((s.edges & bit) === 0) continue
      const r = regionDe(s.tx + dx, s.ty + dy)
      // La LIGNE d'un pan est l'arête elle-même : le bord de tuile que la barrière occupe.
      const ligne = axe === 'H' ? s.ty + (bit === S ? 1 : 0) : s.tx + (bit === E ? 1 : 0)
      const le = axe === 'H' ? s.tx : s.ty
      if (r >= 0) {
        ajouter(`r${r}:${cote}:${ligne}`, { axe, ligne, debut: le, fin: le, region: r, cote }, s.id)
      } else {
        // AUCUNE RÉGION DE L'AUTRE CÔTÉ — un mur de joueur dans l'herbe, la face extérieure
        // d'une enceinte. On regroupe alors par CONTIGUÏTÉ sur la même ligne : le voisin
        // immédiat qui déclare la même arête appartient au même pan. Le `find` suffit : les
        // pans sont peu nombreux et on ne le fait qu'à la construction.
        const proche = pans.find((p) => p.region === -1 && p.cote === cote && p.axe === axe &&
          p.ligne === ligne && le >= p.debut - 1 && le <= p.fin + 1)
        if (proche === undefined) {
          const cle = `libre:${cote}:${ligne}:${le}`
          ajouter(cle, { axe, ligne, debut: le, fin: le, region: -1, cote }, s.id)
        } else {
          proche.debut = Math.min(proche.debut, le)
          proche.fin = Math.max(proche.fin, le)
          const l = parBarriere.get(s.id)
          if (l === undefined) parBarriere.set(s.id, [proche.id])
          else if (!l.includes(proche.id)) l.push(proche.id)
        }
      }
    }
  }
  return { liste: pans, parBarriere, regionDe }
}

/**
 * LES PANS QUI TOMBENT, pour cette position de joueur. `D` en tuiles (2 par décision).
 *
 * `regionJoueur` : la région sous ses pieds, ou −1 — c'est elle qui arme la règle du DEDANS.
 */
export function pansTombes(pans: Pans, joueur: { x: number; y: number } | undefined, D: number): Set<number> {
  const out = new Set<number>()
  if (joueur === undefined) return out
  const rJoueur = pans.regionDe(Math.floor(joueur.x), Math.floor(joueur.y))
  for (const p of pans.liste) {
    // LE DEDANS : la façade qui se dresse entre la pièce et la caméra tombe dès qu'on y entre,
    // quelle que soit la distance — sinon on ne voit pas la pièce où l'on se tient.
    if (p.region >= 0 && p.region === rJoueur && p.cote === 'S') { out.add(p.id); continue }
    // LA DISTANCE, des deux côtés. `+1` sur la fin : l'emprise se compte en tuiles pleines.
    const perp = p.axe === 'H' ? joueur.y : joueur.x
    const lat = p.axe === 'H' ? joueur.x : joueur.y
    if (Math.abs(perp - p.ligne) > D) continue
    if (lat < p.debut - D || lat > p.fin + 1 + D) continue
    out.add(p.id)
  }
  return out
}
