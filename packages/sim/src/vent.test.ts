/**
 * LE VENT — les critères A1-A8 de `docs/specs/vent.md`.
 *
 * Le chantier a fondu DEUX vents en un : `state.wind` (huit relèvements qui sautaient toutes les
 * cinq minutes) et le front météo (une bande cardinale qui traverse la vallée), qui EST déjà une
 * direction. Ces gardes tiennent les deux moitiés du contrat : ce que le vent PROMET (il suit le
 * front, il se lève avant la pluie) et ce qu'il ne doit JAMAIS faire (dégénérer, consommer un
 * tirage, écraser le calme plat d'un hôte).
 */

import { describe, expect, it } from 'vitest'
import { BALANCE, HUNT, METEO, TERRAIN_GRASS, VENT } from './balance'
import { createEmptyMap } from './map'
import { frontDuCycle, largeurDe, meteoIntensityAt, type MeteoFront } from './meteo'
import { createSim, step, type SimState } from './sim'
import { calendarScaleForSeasonCycles, TICKS_PER_CYCLE } from './time'
import { BEARINGS, capAt, capDuFront, souffleAt, ventForceAt, ventGain } from './vent'

const SCALE = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)
const L = 70
const H = 40

function sim(seed = 2026, meteoActive = true): SimState {
  return createSim(seed, { map: createEmptyMap(L, H, TERRAIN_GRASS), calendarScale: SCALE, meteoActive })
}

/** Un front FABRIQUÉ, court : les gardes qui balaient un domaine ne peuvent pas jouer trente
 *  minutes de traversée trente-deux fois. La géométrie lue est la vraie (`frontMeteoPos` ne
 *  connaît que `startTick`/`endTick`) — seule la durée est raccourcie. */
function frontCourt(edge: MeteoFront['edge'], startTick: number, duree = 2000): MeteoFront {
  return { type: 'pluie', cycle: Math.floor(startTick / TICKS_PER_CYCLE), day: 1, edge, startTick, endTick: startTick + duree }
}

const CX = L / 2
const CY = H / 2

describe('V1 — le cap suit le front', () => {
  it('A1 — au cœur de la bande, le cap EST l’axe de traversée, pour les quatre bords', () => {
    // Un balayage des quatre bords, pas trois cas choisis : c'est une table, elle se prouve
    // entière. La convention est celle de `frontMeteoPos` — ouest et nord vers +axe.
    const attendu: Record<number, readonly [number, number]> = {
      0: [1, 0], // entre par l'ouest → pousse vers l'est
      1: [-1, 0],
      2: [0, 1], // entre par le nord → pousse vers le sud (y croît vers le sud)
      3: [0, -1],
    }
    for (const edge of [0, 1, 2, 3] as const) {
      expect(capDuFront(edge), `cap du bord ${edge}`).toEqual(attendu[edge])
      const s = sim()
      s.meteo = frontCourt(edge, 5 * TICKS_PER_CYCLE)
      // Le tick où le CENTRE est en plein cœur de bande (souffle = 1) : le cap doit y avoir
      // fini son virage. On le CHERCHE au lieu de le supposer — la rampe est saisonnière.
      let trouve = -1
      for (let t = s.meteo.startTick - VENT.AVANCE_TICKS; t < s.meteo.endTick; t++) {
        if (souffleAt(s, CX, CY, t) === 1) { trouve = t; break }
      }
      expect(trouve, `bord ${edge} : un tick au cœur de la bande`).toBeGreaterThan(0)
      s.tick = trouve
      expect(capAt(s), `le cap au cœur du bord ${edge}`).toEqual(attendu[edge])
    }
  })
})

describe('V2 — le vent se lève avant la pluie', () => {
  /** Le premier cycle de l'année dont le front part AU BORD DE CYCLE (marge nulle) — c'est le
   *  seul cas où l'avance de phase mord sur le cycle précédent, donc le seul qui prouve quoi
   *  que ce soit. Aux Pluies, la fenêtre vaut le cycle entier : il en existe. */
  function cycleDuFrontDAube(s: SimState): { cycle: number; front: MeteoFront } | null {
    for (let c = 1; c < 400; c++) {
      const f = frontDuCycle(c, s.calendarScale, s.jourDeDepart)
      if (f && f.startTick === c * TICKS_PER_CYCLE) return { cycle: c, front: f }
    }
    return null
  }

  it('A2 — au BORD DE CYCLE aussi : le souffle monte avant que la bande ne touche le point', () => {
    const s = sim()
    const trouve = cycleDuFrontDAube(s)
    expect(trouve, 'un front qui part à l’aube existe dans l’année').not.toBeNull()
    const { front } = trouve!
    // Le cycle PRÉCÉDENT : aucun front n'est élu, `state.meteo` est nul — c'est exactement
    // l'angle mort. Sans la sortie `frontDuCycle(cycle + 1)`, la force y vaudrait AMBIANT.
    s.meteo = null
    let vu = false
    for (let t = front.startTick - VENT.AVANCE_TICKS; t < front.startTick && !vu; t++) {
      s.tick = t
      for (let x = 0.5; x < L && !vu; x += 2) {
        for (let y = 0.5; y < H && !vu; y += 2) {
          const force = ventForceAt(s, x, y, t)
          // La pluie N'EST PAS ENCORE LÀ à ce tick, au même point — c'est la moitié qui compte.
          if (force > VENT.AMBIANT && meteoIntensityAt(front, t, L, H, x, y) === 0) vu = true
        }
      }
    }
    expect(vu, 'le vent forcit avant que la pluie n’arrive, sur un front d’aube').toBe(true)
  })

  it('le souffle est nul quand la météo est éteinte — un monde sans ciel n’a pas de front', () => {
    const s = sim(2026, false)
    s.meteo = frontCourt(0, 5 * TICKS_PER_CYCLE)
    s.tick = s.meteo.startTick + 500
    expect(souffleAt(s, CX, CY)).toBe(0)
    expect(ventForceAt(s, CX, CY)).toBe(VENT.AMBIANT)
  })
})

describe('V3 — la force, et les deux zéros', () => {
  it('A3 — bornée à [AMBIANT, 1] dans un monde venté, sur toute la carte et toute la traversée', () => {
    const s = sim()
    s.meteo = frontCourt(2, 5 * TICKS_PER_CYCLE)
    for (let t = s.meteo.startTick - VENT.AVANCE_TICKS; t < s.meteo.endTick; t += 37) {
      for (let x = 0.5; x < L; x += 3) {
        for (let y = 0.5; y < H; y += 3) {
          const f = ventForceAt(s, x, y, t)
          expect(f).toBeGreaterThanOrEqual(VENT.AMBIANT)
          expect(f).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('A4 — la sentinelle du calme plat SURVIT à un front, et éteint la force', () => {
    // `wind = {0,0}` est une décision d'HÔTE : ce monde n'a pas de vent et n'en aura jamais.
    // Les bancs s'en servent pour mesurer l'odorat en canal isolé — si la météo pouvait la
    // rallumer, cette mesure deviendrait fausse en silence.
    const s = sim()
    s.wind = { x: 0, y: 0 }
    s.meteo = frontCourt(0, TICKS_PER_CYCLE)
    for (let t = s.meteo.startTick - VENT.AVANCE_TICKS; t < s.meteo.endTick; t += 101) {
      s.tick = t
      step(s, [])
      expect(s.wind, `tick ${t}`).toEqual({ x: 0, y: 0 })
      expect(s.windForce, `tick ${t}`).toBe(0)
      expect(ventForceAt(s, CX, CY)).toBe(0)
      expect(ventGain(s, CX, CY)).toBe(0)
    }
  })

  it('le GAIN vaut EXACTEMENT 1 hors front — c’est ce qui rend l’odorat inchangé', () => {
    // Les règles calibrées avant le vent (l'odorat) se multiplient par ce gain : s'il ne valait
    // pas 1 au bit près dans un monde sans front, tout le réglage de la chasse aurait bougé.
    const s = sim(2026, false)
    for (let t = 0; t < 5 * TICKS_PER_CYCLE; t += 997) {
      expect(ventGain(s, CX, CY, t), `tick ${t}`).toBe(1)
    }
  })
})

describe('V4 — le cap ne dégénère jamais', () => {
  /** Pour chaque index d'ambiance atteignable, un `startTick` qui le produit. On le CHERCHE au
   *  lieu de le poser : `i₀` tombe d'un `hash2`, et une garde qui fabrique ses conditions ne
   *  garde rien. */
  function startTicksCouvrantLesHuitIndex(s: SimState): Map<number, number> {
    const par = new Map<number, number>()
    for (let k = 20; k < 2000 && par.size < BEARINGS.length; k++) {
      const start = k * HUNT.WIND_SHIFT_TICKS + VENT.AVANCE_TICKS
      s.meteo = frontCourt(0, start)
      // Au tout premier tick où le souffle peut naître, il vaut encore 0 : `capAt` rend i₀ nu.
      const cap = capAt(s, start - VENT.AVANCE_TICKS)
      const i = BEARINGS.findIndex((b) => b[0] === cap[0] && b[1] === cap[1])
      if (!par.has(i)) par.set(i, start)
    }
    return par
  }

  /** Le cap sur toute une traversée, tick par tick — le nombre de crans du PIRE saut, et un
   *  drapeau si l'on a vu un `NaN` ou un vecteur hors table. */
  function pireSaut(
    s: SimState, edge: MeteoFront['edge'], start: number, duree: number,
    /** Jusqu'où balayer. Par défaut TOUTE la fenêtre du front ; A7b s'arrête à la fin du
     *  SOUFFLE, qui est le domaine de la loi (voir son commentaire). */
    fin = start + duree,
  ): { crans: number; degenere: boolean } {
    s.meteo = frontCourt(edge, start, duree)
    let precedent = -1
    let pire = 0
    let degenere = false
    for (let t = start - VENT.AVANCE_TICKS; t < fin; t++) {
      const cap = capAt(s, t)
      if (!Number.isFinite(cap[0]) || !Number.isFinite(cap[1])) degenere = true
      const i = BEARINGS.findIndex((b) => b[0] === cap[0] && b[1] === cap[1])
      if (i < 0) { degenere = true; continue }
      if (precedent >= 0) {
        const d = Math.abs(i - precedent)
        pire = Math.max(pire, Math.min(d, BEARINGS.length - d))
      }
      precedent = i
    }
    return { crans: pire, degenere }
  }

  it('A7a — sur les 8 ambiances × 4 bords : jamais NaN, jamais un cap hors table', () => {
    const s = sim()
    const parIndex = startTicksCouvrantLesHuitIndex(s)
    expect(parIndex.size, 'les huit relèvements d’ambiance sont atteignables').toBe(BEARINGS.length)
    // Le cas ANTI-PARALLÈLE — celui qui faisait NaN dans la forme en lerp de vecteurs — est dans
    // ce produit par construction : BEARINGS contient l'opposé de chaque cardinal.
    for (const [i0, start] of parIndex) {
      for (const edge of [0, 1, 2, 3] as const) {
        expect(pireSaut(s, edge, start, 2000).degenere, `ambiance ${i0}, bord ${edge}`).toBe(false)
      }
    }
  })

  it('A7b — le cap ne saute pas PENDANT une traversée, ambiance LIBRE de se retirer', () => {
    // ⚠ LA PRÉMISSE D'ABORD, ET ELLE EST TOUT LE TEST. Une traversée doit ENJAMBER au moins
    // deux tranches d'ambiance, sinon `i₀` ne se retire jamais pendant le run et le montage
    // épingle lui-même la condition qu'il prétend éprouver — la garde passerait à l'identique
    // AVEC ou SANS le gel de `vent.ts`, donc ne garderait rien. (Première rédaction : 2 000
    // ticks de traversée contre 6 000 de relais. Elle ne gardait rien, précisément.)
    const DUREE = Math.ceil(2.6 * HUNT.WIND_SHIFT_TICKS)
    expect(Math.floor(DUREE / HUNT.WIND_SHIFT_TICKS), 'la traversée enjambe ≥ 2 relais').toBeGreaterThanOrEqual(2)
    // Et la vraie géométrie du jeu en enjambe bien autant : 5 min de relais contre 15 à 30 de
    // traversée. Le montage n'invente pas un cas qui n'existe pas.
    expect(Math.floor(Math.round(0.5 * TICKS_PER_CYCLE) / HUNT.WIND_SHIFT_TICKS)).toBeGreaterThanOrEqual(2)

    const s = sim()
    const parIndex = startTicksCouvrantLesHuitIndex(s)
    // Un seul bord suffit ici : la variable en cause est `i₀`, pas `i₁` — et l'anti-parallèle
    // (ambiance 4 contre le cardinal 0) est dans le balayage. Les quatre bords restent couverts
    // par A7a et A1. Balayer 8 × 4 sur des traversées deux fois et demie plus longues
    // multiplierait le temps de la garde par six, pour la même propriété.
    for (const [i0, start] of parIndex) {
      // LE DOMAINE DE LA LOI s'arrête à la fin du SOUFFLE (`endTick − AVANCE`) et pas à
      // `endTick` : au-delà, le front ne commande plus, et le cap revient au relèvement
      // d'ambiance COURANT. Ce retour-là peut valoir un demi-tour — mais c'est le relais que
      // le vent fait toutes les cinq minutes depuis toujours, pas une rupture du virage
      // (mesuré : le saut tombe 2 400 ticks APRÈS la fin du souffle, `frontQuiSouffle` déjà
      // nul, souffle déjà à 0). Le lissage de ces relais-là est au client, et il l'a toujours
      // été. Ce que cette garde affirme, c'est que le VIRAGE, lui, ne saute pas.
      const finDuSouffle = start + DUREE - VENT.AVANCE_TICKS
      const { crans, degenere } = pireSaut(s, 0, start, DUREE, finDuSouffle)
      expect(degenere, `ambiance ${i0}`).toBe(false)
      expect(crans, `ambiance ${i0} : saut de ${crans} crans en plein virage`).toBeLessThanOrEqual(1)
    }
  })

  it('…et hors virage, le retour à l’ambiance reste un RELAIS, pas une invention', () => {
    // L'autre moitié, affirmée à part plutôt que cachée dans la borne d'A7b : après la sortie
    // du front, le cap est EXACTEMENT le relèvement d'ambiance de la tranche courante — celui
    // qu'un monde sans météo aurait eu au même tick. Le front ne laisse pas de traînée.
    const s = sim()
    const start = 40 * HUNT.WIND_SHIFT_TICKS + VENT.AVANCE_TICKS
    const DUREE = Math.ceil(2.6 * HUNT.WIND_SHIFT_TICKS)
    s.meteo = frontCourt(0, start, DUREE)
    const sansMeteo = sim(2026, false)
    for (let t = start + DUREE; t < start + DUREE + 3 * HUNT.WIND_SHIFT_TICKS; t += 137) {
      expect(capAt(s, t), `tick ${t}`).toEqual(capAt(sansMeteo, t))
    }
  })
})

describe('ce que le vent ne doit JAMAIS faire', () => {
  it('A5 — il ne consomme pas un seul tirage du PRNG, front ou pas', () => {
    for (const avecMeteo of [false, true]) {
      const s = sim(7, avecMeteo)
      const rng0 = s.rngState
      for (let t = 0; t < 6 * HUNT.WIND_SHIFT_TICKS; t++) step(s, [])
      expect(s.rngState, avecMeteo ? 'avec météo' : 'sans météo').toBe(rng0)
    }
  })

  it('A5bis — et il TOURNE quand même (la garde A18 de la chasse, reprise ici)', () => {
    const s = sim(7, false)
    const vus = new Set<string>()
    for (let t = 0; t < 6 * HUNT.WIND_SHIFT_TICKS; t++) {
      step(s, [])
      vus.add(`${s.wind.x},${s.wind.y}`)
    }
    expect(vus.size).toBeGreaterThan(1)
  })

  it('A6 — pur à front donné : deux appels, même réponse', () => {
    const s = sim()
    s.meteo = frontCourt(1, 3 * TICKS_PER_CYCLE)
    for (let t = s.meteo.startTick; t < s.meteo.endTick; t += 211) {
      expect(capAt(s, t)).toEqual(capAt(s, t))
      expect(ventForceAt(s, 12.5, 7.5, t)).toBe(ventForceAt(s, 12.5, 7.5, t))
      expect(souffleAt(s, 12.5, 7.5, t)).toBe(souffleAt(s, 12.5, 7.5, t))
    }
  })

  it('A6bis — REMBOBINABLE : le vent d’un tick ne dépend pas du chemin par lequel on y arrive', () => {
    // `neigeAuSol` rembobine la géométrie des cycles passés ; un vent qui garderait un cap lissé
    // d'un tick à l'autre ne se rembobinerait plus. C'est la garde de la contrainte 1.
    const joue = sim(31, false)
    const froid = sim(31, false)
    for (let k = 1; k <= 3; k++) {
      const relais = k * HUNT.WIND_SHIFT_TICKS
      // `advanceVent` voit le tick AVANT que `advanceTime` ne l'incrémente : on joue jusqu'à
      // l'avoir dépassé, et c'est bien le cap DU relais qui est posé.
      while (joue.tick <= relais) step(joue, [])
      expect([joue.wind.x, joue.wind.y], `relais ${k}`).toEqual([...capAt(froid, relais)])
    }
  })

  it('A8 — un seul écrivain : la largeur du front reste lue par la loi, pas recopiée', () => {
    // Garde de composition : si `largeurDe` cessait d'être la seule source de la géométrie,
    // le souffle et la pluie divergeraient d'un calibrage à l'autre sans que rien ne rougisse.
    const s = sim()
    const f = frontCourt(0, 2 * TICKS_PER_CYCLE)
    s.meteo = f
    const rampe = METEO.RAMPE * largeurDe(f)
    expect(rampe).toBeGreaterThan(0)
    const t = f.startTick + Math.floor((f.endTick - f.startTick) / 2)
    expect(souffleAt(s, CX, CY, t)).toBe(meteoIntensityAt(f, t + VENT.AVANCE_TICKS, L, H, CX, CY))
  })
})
