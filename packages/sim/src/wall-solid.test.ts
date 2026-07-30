/**
 * ON NE RENTRE JAMAIS DANS UN MUR NI DANS UNE BARRIÈRE (décision d'Alexis, 2026-07-27).
 *
 * Les gardes de `wall-edges.test.ts` prennent le modèle par ses cas : une arête, une direction,
 * une attente. Elles n'ont pas vu passer le vrai bug — un mur du monde bâti PARTAGE sa tuile
 * avec la terre battue de la cour, et la collision recevait la terre. Un cas de plus n'aurait
 * rien changé : c'est l'exhaustivité qui manquait.
 *
 * Cette garde-ci prend donc le problème par l'autre bout. Elle bâtit la VRAIE Ferme, relève
 * TOUTES les bandes que le moteur déclare bloquantes, puis lance un marcheur depuis des
 * centaines de départs, dans les HUIT directions, et vérifie une seule chose : à aucun moment
 * la hitbox de l'avatar ne recouvre une bande. Aucune direction privilégiée, aucun mur choisi à
 * la main — si une paroi devient traversable, où que ce soit et par où que ce soit, ça rougit.
 *
 * Ce qu'elle ne prétend PAS couvrir : les seuils (un encadrement est un trou, il se traverse) et
 * les brèches/passages déclarés par le plan. Ils ne portent aucune bande, donc rien à recouvrir.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, TERRAIN_GRASS } from './balance'
import { moveAvatar } from './collision'
import { createEmptyMap } from './map'
import { createSim } from './sim'
import { buildPoiStructures } from './poi-batis'
import { POI_TYPES } from './poi'
import { structureBlocks, type Structure } from './village'

const N = 1, E = 2, S = 4, O = 8

/** La demi-épaisseur d'une bande, en tuiles — la même que la collision (à cheval sur l'arête). */
const DEMI = BALANCE.WALL_EDGE_SUB / 2 / BALANCE.SUBTILES_PER_TILE
/** Le corps est un RECTANGLE (12 × 6 px) : une demi-mesure par axe, jamais la même pour les
 *  deux — mesurer un corps carré ferait crier la garde là où rien ne pénètre. */
const DEMI_X = BALANCE.AVATAR_HITBOX_TILES / 2
const DEMI_Y = BALANCE.AVATAR_HITBOX_DEPTH_TILES / 2
/** Tolérance : un contact EXACT n'est pas une pénétration, et les flottants ne tombent pas juste. */
const EPS = 1e-6

interface Bande { x0: number; y0: number; x1: number; y1: number; quoi: string }

/** Toutes les bandes bloquantes du monde, en coordonnées de tuiles continues. */
function bandes(structures: readonly Structure[]): Bande[] {
  const out: Bande[] = []
  for (const s of structures) {
    if (!structureBlocks(s, null, false)) continue
    const quoi = `${s.type}@(${s.tx},${s.ty})`
    if (s.edges === undefined) {
      out.push({ x0: s.tx, y0: s.ty, x1: s.tx + 1, y1: s.ty + 1, quoi })
      continue
    }
    if (s.edges & N) out.push({ x0: s.tx, y0: s.ty - DEMI, x1: s.tx + 1, y1: s.ty + DEMI, quoi: `${quoi} N` })
    if (s.edges & S) out.push({ x0: s.tx, y0: s.ty + 1 - DEMI, x1: s.tx + 1, y1: s.ty + 1 + DEMI, quoi: `${quoi} S` })
    if (s.edges & O) out.push({ x0: s.tx - DEMI, y0: s.ty, x1: s.tx + DEMI, y1: s.ty + 1, quoi: `${quoi} O` })
    if (s.edges & E) out.push({ x0: s.tx + 1 - DEMI, y0: s.ty, x1: s.tx + 1 + DEMI, y1: s.ty + 1, quoi: `${quoi} E` })
  }
  return out
}

/** La bande que la hitbox de l'avatar RECOUVRE à cette position, s'il y en a une. */
function dedans(bs: readonly Bande[], x: number, y: number): Bande | undefined {
  return bs.find((b) =>
    x + DEMI_X > b.x0 + EPS && x - DEMI_X < b.x1 - EPS &&
    y + DEMI_Y > b.y0 + EPS && y - DEMI_Y < b.y1 - EPS)
}

function fermeBatie(): { map: ReturnType<typeof createEmptyMap>; structures: Structure[] } {
  const fp = POI_TYPES.find((t) => t.slug === 'ferme_ruinee')!.footprint
  const map = createEmptyMap(fp + 12, fp + 12, TERRAIN_GRASS)
  map.zones.push({ name: 'essai', x: 6, y: 6, w: fp, h: fp, kind: 'ferme_ruinee' })
  const sim = createSim(7, { map })
  buildPoiStructures(sim, 7)
  return { map, structures: sim.structures }
}

describe('la Ferme bâtie ne se traverse pas', () => {
  const { map, structures } = fermeBatie()
  const world = { map, structures }
  const bs = bandes(structures)

  it('déclare bien des bandes (sinon la garde ne garde rien)', () => {
    expect(bs.length).toBeGreaterThan(30)
  })

  /**
   * LE BALAYAGE — huit directions, tous les départs libres, la carte entière.
   *
   * On avance par pas de 0,05 tuile pendant 44 pas : de quoi franchir deux tuiles, donc de quoi
   * traverser n'importe quelle paroi si elle est traversable — une paroi ne fait qu'un quart de
   * tuile. À chaque pas, on vérifie la hitbox. (Aller plus loin ne prouverait rien de plus et
   * coûterait des secondes : la garde doit rester assez rapide pour tourner à chaque commit.)
   */
  it('quelle que soit la direction, l’avatar ne pénètre JAMAIS une bande', () => {
    const DIRS: readonly (readonly [-1 | 0 | 1, -1 | 0 | 1])[] = [
      [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ]
    const fautes: string[] = []
    let departs = 0
    for (let ty = 4; ty < map.height - 4 && fautes.length < 6; ty++) {
      for (let tx = 4; tx < map.width - 4 && fautes.length < 6; tx++) {
        for (const [ox, oy] of [[0.5, 0.5], [0.5, 0.9], [0.9, 0.5]] as const) {
          const x0 = tx + ox
          const y0 = ty + oy
          if (dedans(bs, x0, y0) !== undefined) continue //  départ DANS un mur : hors sujet
          departs++
          for (const [dx, dy] of DIRS) {
            let p = { x: x0, y: y0 }
            for (let i = 0; i < 44; i++) {
              p = moveAvatar(world, p.x, p.y, dx, dy, 0.05)
              const b = dedans(bs, p.x, p.y)
              if (b !== undefined) {
                fautes.push(`de (${x0}, ${y0}) vers (${dx},${dy}) au pas ${i} → dans ${b.quoi} en (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`)
                break
              }
            }
          }
        }
      }
    }
    expect(departs, 'le balayage doit partir de quelque part').toBeGreaterThan(500)
    expect(fautes).toEqual([])
  })

  /**
   * ET ON N'Y RENTRE PAS NON PLUS EN GLISSANT LE LONG. Le glissement (le déplacement axe par
   * axe) est le chemin classique pour s'insérer dans un coin : on pousse en diagonale contre un
   * mur, un axe est refusé, l'autre passe — et l'on se retrouve du mauvais côté d'un angle.
   */
  it('un ANGLE ne se force pas en diagonale', () => {
    const fautes: string[] = []
    for (const s of structures) {
      if (s.edges === undefined || !structureBlocks(s, null, false)) continue
      if ((s.edges & N) === 0 && (s.edges & O) === 0) continue
      // On se place en biais du coin nord-ouest de la tuile et on pousse DEDANS.
      for (const [dx, dy] of [[1, 1], [1, 0], [0, 1]] as const) {
        let p = { x: s.tx - 0.6, y: s.ty - 0.6 }
        if (dedans(bs, p.x, p.y) !== undefined) continue
        for (let i = 0; i < 60; i++) {
          p = moveAvatar(world, p.x, p.y, dx, dy, 0.05)
          const b = dedans(bs, p.x, p.y)
          if (b !== undefined) { fautes.push(`coin de ${s.type}@(${s.tx},${s.ty}) forcé vers (${dx},${dy}) → ${b.quoi}`); break }
        }
      }
    }
    expect(fautes).toEqual([])
  })
})
