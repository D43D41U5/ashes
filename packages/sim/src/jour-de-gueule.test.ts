/**
 * ═══ LE JOUR D'UNE GUEULE APPREND L'OMBRE (spec `lumiere-globale.md`, LG-R20 / LG-A21) ═══
 *
 * *Décision d'Alexis du 2026-09-19, planche 28 (« Le jour d'une gueule ») : « Oui, comme le feu ».*
 * Sous la roche, `partDuCiel` garde ses anneaux de Tchebychev et sa portée (`CIEL_PENETRATION`),
 * mais chaque ouverture est multipliée par la part de sa source que la tuile VOIT à travers la
 * roche de l'étage — `partVisible`, le prédicat de LG-R11. Derrière un angle, deux pas après le
 * seuil, il fait noir ; dans l'axe de la gueule, rien ne change.
 *
 * ⚠ **CE QUI FERAIT ROUGIR CES GARDES** : une occultation qui ne regarde pas la roche de l'ÉTAGE
 * (la salle ouverte et la salle en L rendraient la même chose) ; une loi qui prend la PREMIÈRE
 * ouverture trouvée au lieu du max (une gueule cachée mettrait dans le noir une tuile qu'une
 * autre éclaire) ; un rayon qui compte la tuile de départ ou celle d'arrivée (le seuil même
 * s'éteindrait). Le montage est un laboratoire : la loi sur le monde joué est gardée par
 * `cave.test.ts` (le seuil clair, le fond noir).
 */
import { describe, expect, it } from 'vitest'
import { TEMPERATURE, TERRAIN_GRASS } from './balance'
import { createEmptyMap } from './map'
import { partDuCiel } from './nuit'
import { partVisible } from './lumiere'
import type { EtageCreux } from './etages'
import { createSim, type SimState } from './sim'

const P = TEMPERATURE.CIEL_PENETRATION
/** La gueule : une PAIRE, (10, 20) et (11, 20), ouvrant sur la salle au nord. */
const GUEULE = { x: 10, y: 20 }
/** Le boyau : deux tuiles de large sous la gueule, quatre rangées vers le nord. */
const BOYAU = { x0: 10, x1: 11, y0: 16, y1: 19 }
/** Le couloir qui part à l'est, deux rangées, derrière l'angle (12, 18)–(18, 19) qui est de la roche. */
const COULOIR = { x0: 12, x1: 18, y0: 16, y1: 17 }
/** L'angle : ce qui est de la roche dans la salle en L, et du sol dans la salle ouverte. */
const ANGLE = { x0: 12, x1: 18, y0: 18, y1: 19 }

/** Une salle à l'étage −1 sous une plaine nue : en L (l'angle est de la roche) ou OUVERTE (l'angle est du sol). */
function salle(enL: boolean): SimState {
  const map = createEmptyMap(32, 32, TERRAIN_GRASS)
  const idx: number[] = []
  const poser = (r: { x0: number; x1: number; y0: number; y1: number }) => {
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) idx.push(y * map.width + x)
  }
  poser(BOYAU)
  poser(COULOIR)
  if (!enL) poser(ANGLE)
  idx.push(GUEULE.y * map.width + GUEULE.x, GUEULE.y * map.width + GUEULE.x + 1)
  idx.sort((a, b) => a - b)
  const etage: EtageCreux = {
    niveau: -1, idx, terrain: idx.map(() => TERRAIN_GRASS),
    x0: BOYAU.x0, y0: COULOIR.y0, x1: COULOIR.x1 + 1, y1: GUEULE.y + 1,
  }
  map.etages = [etage]
  map.connecteurs = [
    { x: GUEULE.x, y: GUEULE.y, de: 0, vers: -1, type: 'gueule' },
    { x: GUEULE.x + 1, y: GUEULE.y, de: 0, vers: -1, type: 'gueule' },
  ]
  return createSim(23, { map, nodes: [], worldEvents: false, faunaCap: 0, meteoActive: false, nightHunt: false })
}

/** La loi SANS ombre : l'anneau de Tchebychev à la paire. */
const anneau = (tx: number, ty: number): number => {
  const d = Math.max(Math.max(0, GUEULE.x - tx, tx - (GUEULE.x + 1)), Math.abs(ty - GUEULE.y))
  return d === 0 ? 1 : Math.max(0, 1 - d / (P + 1))
}

describe('le jour d’une gueule apprend l’ombre (LG-R20)', () => {
  it('LA PRÉMISSE — dans la salle OUVERTE, la loi est celle des anneaux, sans un texel de moins', () => {
    const sim = salle(false)
    for (let y = COULOIR.y0; y <= GUEULE.y; y++)
      for (let x = BOYAU.x0; x <= COULOIR.x1; x++) {
        if (y === GUEULE.y && x > GUEULE.x + 1) continue
        expect(partDuCiel(sim, x, y, -1), `(${x},${y}) à ciel ouvert`).toBe(anneau(x, y))
      }
  })

  it('SUR LE SEUIL, on voit comme dehors ; dans l’AXE de la gueule, rien ne change', () => {
    const sim = salle(true)
    expect(partDuCiel(sim, GUEULE.x, GUEULE.y, -1)).toBe(1)
    expect(partDuCiel(sim, GUEULE.x + 1, GUEULE.y, -1)).toBe(1)
    for (let y = BOYAU.y0; y <= BOYAU.y1; y++)
      for (let x = BOYAU.x0; x <= BOYAU.x1; x++) expect(partDuCiel(sim, x, y, -1), `boyau (${x},${y})`).toBe(anneau(x, y))
  })

  it('DERRIÈRE L’ANGLE, il fait noir — à la même distance où la salle ouverte donne encore du jour', () => {
    const enL = salle(true)
    const ouverte = salle(false)
    // (14, 17) : d = 3 — de l'anneau 0,4 à ciel ouvert ; l'angle (12–13, 18–19) barre tous les rayons.
    expect(partDuCiel(ouverte, 14, 17, -1)).toBe(anneau(14, 17))
    expect(anneau(14, 17)).toBeGreaterThan(0)
    expect(partDuCiel(enL, 14, 17, -1)).toBe(0)
    // Tout le couloir passé l'angle, dans la portée, est dans le noir ; hors portée, il l'était déjà.
    for (let x = 14; x <= COULOIR.x1; x++)
      for (let y = COULOIR.y0; y <= COULOIR.y1; y++) expect(partDuCiel(enL, x, y, -1), `couloir (${x},${y})`).toBe(0)
  })

  it('À L’ANGLE MÊME, une pénombre — moins que l’anneau, plus que le noir, et jamais plus que sans ombre', () => {
    const enL = salle(true)
    const ouverte = salle(false)
    // (12, 17) : d = 2 — la tuile ouest de la paire se voit en biais par le boyau, la tuile est est cachée.
    const v = partDuCiel(enL, 12, 17, -1)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(anneau(12, 17))
    // La borne : nulle part la salle en L ne dépasse la salle ouverte.
    for (let y = COULOIR.y0; y <= BOYAU.y1; y++)
      for (let x = BOYAU.x0; x <= COULOIR.x1; x++) {
        if (y >= ANGLE.y0 && x >= ANGLE.x0) continue
        expect(partDuCiel(enL, x, y, -1), `(${x},${y})`).toBeLessThanOrEqual(partDuCiel(ouverte, x, y, -1))
      }
  })

  it('LE MAX SUR LES OUVERTURES, pas la première trouvée — une seconde gueule en vue rend le jour au couloir', () => {
    const sim = salle(true)
    // Une seconde paire au bout du couloir, ouvrant vers le haut : (17, 18) est de la roche dans la salle en L,
    // on ouvre (17–18, 15) au nord, sur le couloir — la tuile (14, 17) est à d = 3 de cette paire aussi.
    const map = sim.map
    const e = map.etages![0]!
    const idx = [...e.idx, 15 * map.width + 17, 15 * map.width + 18].sort((a, b) => a - b)
    map.etages = [{ ...e, idx, terrain: idx.map(() => TERRAIN_GRASS), y0: 15 }]
    map.connecteurs = [...map.connecteurs!, { x: 17, y: 15, de: 0, vers: -1, type: 'gueule' }, { x: 18, y: 15, de: 0, vers: -1, type: 'gueule' }]
    // Le balayage rencontre la gueule du sud (cachée) AVANT celle du nord dans l'anneau 3 : le max la retrouve.
    const v = partDuCiel(sim, 14, 17, -1)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThanOrEqual(1 - 3 / (P + 1))
    // Et c'est bien la seconde gueule qu'on voit : sa part visible depuis (14, 17), en direct.
    expect(partVisible(sim, -1, 14.5, 17.5, 17.5, 15.5)).toBeGreaterThan(0)
  })

  it('LA LOI NE CONSOMME AUCUN TIRAGE, et rend le même nombre deux fois', () => {
    const sim = salle(true)
    const rng = sim.rngState
    const a = partDuCiel(sim, 12, 17, -1)
    const b = partDuCiel(sim, 12, 17, -1)
    expect(b).toBe(a)
    expect(sim.rngState).toBe(rng)
  })
})
