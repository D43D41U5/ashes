/**
 * LA NEIGE DES CIMES — la garde tient la SEULE propriété pour laquelle ce module existe.
 *
 * On aurait pu lire `gel.etatAt`, qui donnait déjà un niveau de neige par tuile. On ne le fait
 * pas, et l'en-tête de `neige-houppier.ts` dit pourquoi : `niveauPourCouverture` est CONSTRUIT
 * pour moucheter le sol (seuil positionnel par tuile). Le test ne prend pas ce raisonnement
 * pour argent comptant — il MESURE les deux lois côte à côte sur le même monde, au même tick,
 * et affirme que l'une est mouchetée à l'échelle d'une cime là où l'autre ne l'est pas.
 *
 * ⚠ **Le test doit pouvoir échouer.** Il commence donc par affirmer sa PRÉMISSE : qu'il existe
 * bien un tick où il est tombé de la neige sur le bois de conifères. Sans neige nulle part, les
 * deux lois rendraient « rien » partout et le verdict serait vert par accident.
 */
import { describe, expect, it } from 'vitest'
import {
  BALANCE,
  TERRAIN_GRASS,
  TERRAIN_PINE,
  TICKS_PER_CYCLE,
  calendarScaleForSeasonCycles,
  createEmptyMap,
  createSim,
  neigeAuSol,
  niveauDeNeige,
  type SimState,
} from '@ashes/sim'
import { NEIGE_DES_CIMES, NeigeDesCimes } from './neige-houppier'

const SCALE = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)
const W = 64, H = 64

function monde(): SimState {
  const map = createEmptyMap(W, H, TERRAIN_GRASS)
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) map.terrain[ty * W + tx] = TERRAIN_PINE
  return createSim(2026, { map, calendarScale: SCALE, meteoActive: true })
}

/** Le tick d'un jour de saison, à midi (`jourDeDepart` vaut 1 par défaut de `createSim`). */
const tickDe = (jour: number): number => (jour - 1) * TICKS_PER_CYCLE + Math.floor(TICKS_PER_CYCLE * 0.5)

/** Le premier jour du Grand Froid où il y a VRAIMENT de la neige au sol au centre de la carte —
 *  c'est la prémisse du test, et elle est cherchée, pas supposée. */
function jourEnneige(state: SimState): { jour: number; couverture: number } | null {
  for (let jour = 91; jour <= 120; jour++) {
    const s = { ...state, tick: tickDe(jour) } as SimState
    const c = neigeAuSol(s, W / 2, H / 2)
    if (c > NEIGE_DES_CIMES.SEUIL_POUDRE) return { jour, couverture: c }
  }
  return null
}

describe('la neige des cimes — au peuplement, pas à la tuile', () => {
  it('PRÉMISSE : il tombe bien de la neige sur ce bois au Grand Froid', () => {
    const trouve = jourEnneige(monde())
    expect(trouve, 'aucun jour enneigé : le reste du fichier ne prouverait rien').not.toBeNull()
    expect(trouve!.couverture).toBeGreaterThan(NEIGE_DES_CIMES.SEUIL_POUDRE)
  })

  it('la loi du SOL est mouchetée à l’échelle d’une cime — la nôtre ne l’est pas', () => {
    const base = monde()
    const trouve = jourEnneige(base)!
    const state = { ...base, tick: tickDe(trouve.jour) } as SimState
    const neige = new NeigeDesCimes()

    // Sur chaque voisinage 3×3 d'un carré de tuiles : combien de niveaux DISTINCTS ?
    let mixteSol = 0, mixteCime = 0, total = 0
    for (let ty = 8; ty < 56; ty++) {
      for (let tx = 8; tx < 56; tx++) {
        const sol = new Set<number>(), cime = new Set<string>()
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sol.add(niveauDeNeige(state, tx + dx, ty + dy))
            cime.add(neige.etatDe(state, tx + dx, ty + dy))
          }
        }
        total++
        if (sol.size > 1) mixteSol++
        if (cime.size > 1) mixteCime++
      }
    }
    // Le sol est franchement moucheté — c'est sa raison d'être, et c'est la prémisse.
    expect(mixteSol / total, 'le sol n’est pas moucheté : la comparaison ne dit rien')
      .toBeGreaterThan(0.2)
    // La cime ne l'est qu'aux COUTURES entre deux blocs — au plus une bande sur huit dans
    // chaque direction, donc bien moins d'un tiers des voisinages, et bien moins que le sol.
    expect(mixteCime / total).toBeLessThan(mixteSol / total)
    expect(mixteCime / total).toBeLessThan(0.3)
  })

  it('toutes les tuiles d’un même peuplement portent la MÊME coiffe', () => {
    const base = monde()
    const state = { ...base, tick: tickDe(jourEnneige(base)!.jour) } as SimState
    const neige = new NeigeDesCimes()
    const B = NEIGE_DES_CIMES.BLOC_TUILES
    for (let by = 1; by < 6; by++) {
      for (let bx = 1; bx < 6; bx++) {
        const vus = new Set<string>()
        for (let dy = 0; dy < B; dy++) for (let dx = 0; dx < B; dx++) {
          vus.add(neige.etatDe(state, bx * B + dx, by * B + dy))
        }
        expect(vus.size, `le bloc ${bx},${by} porte ${vus.size} coiffes`).toBe(1)
      }
    }
  })

  it('sans état de gel, aucune neige n’est inventée', () => {
    const neige = new NeigeDesCimes()
    expect(neige.etatDe(null, 10, 10)).toBe('feuillu')
    expect(neige.couvertureDe(null, 10, 10)).toBe(0)
  })

  it('le cache SE PÉRIME sur le temps — un front qui arrive se voit', () => {
    const base = monde()
    const trouve = jourEnneige(base)!
    const neige = new NeigeDesCimes()
    // On lit d'abord un jour d'été (rien), puis le jour enneigé : la valeur DOIT changer,
    // sinon le cache aurait figé l'été. C'est exactement le défaut qu'un cache indexé sur la
    // seule appartenance au bloc produirait — il ne verrait jamais arriver un front.
    const ete = { ...base, tick: tickDe(45) } as SimState
    const hiver = { ...base, tick: tickDe(trouve.jour) } as SimState
    expect(neige.etatDe(ete, 32, 32)).toBe('feuillu')
    expect(neige.etatDe(hiver, 32, 32)).not.toBe('feuillu')
  })
})
