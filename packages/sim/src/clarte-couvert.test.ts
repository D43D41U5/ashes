/**
 * ═══ E-R13 — IL FAIT NOIR DEDANS À MIDI (spec `etages.md`, branche B1) ═══
 *
 * *Décision d'Alexis du 2026-09-02 : « ce qu'on voit d'un étage voisin, c'est ce que la LUMIÈRE
 * atteint ».* Avant, l'obscurité du jeu était **globale et horaire** : une rampe sur l'heure,
 * la même pour toute la carte, quel que soit le toit au-dessus de soi. `partDuCiel` en fait une
 * grandeur LOCALE, et c'est le préalable de tout ce qui est souterrain.
 *
 * ⚠ **CE QUI FERAIT ROUGIR CES GARDES, énoncé avant d'accepter leur vert** : rendre `partDuCiel`
 * à `1` partout (le monde d'avant) — le cœur du bâtiment cesse d'être noir ; ou la rendre
 * BINAIRE (`isSheltered ? 0 : 1`, c'est-à-dire la branche B3 qu'Alexis a écartée) — la gueule
 * devient aussi noire que le fond, et le rang du milieu s'effondre.
 */
import { describe, expect, it } from 'vitest'
import { NUIT, TEMPERATURE, TERRAIN_GRASS } from './balance'
import { createEmptyMap } from './map'
import { clarteSurSoiAt, partDuCiel } from './nuit'
import { isSheltered } from './temperature'
import { createSim, type SimState } from './sim'
import { cycleOffsetForStartHour, jourDeSaison } from './time'

/**
 * UN BÂTIMENT PLEIN — un carré de `n` tuiles de `house`, dont l'empreinte est ce qu'`isSheltered`
 * reconnaît. Assez grand pour qu'il ait un DEDANS : `2·P + 3` de côté met son centre hors de
 * portée du ciel, sinon la garde ne mesurerait que sa propre étroitesse.
 */
function batiment(cote: number): { state: SimState; x0: number; y0: number } {
  const n = cote
  const state = createSim(1, { map: createEmptyMap(64, 64, TERRAIN_GRASS), worldEvents: false, faunaCap: 0 })
  // ⚠ MIDI PILE, POSÉ : à `tick = 0` le ciel ne vaut que 0,56 — la garde mesurerait l'heure de
  // naissance du monde et non le couvert. C'est le montage de `nuit.test.ts`, à l'identique.
  state.cycleOffset = cycleOffsetForStartHour(12, jourDeSaison(state))
  const x0 = 10
  const y0 = 10
  for (let dy = 0; dy < n; dy++) {
    for (let dx = 0; dx < n; dx++) {
      state.structures.push({
        id: state.nextStructureId, type: 'house', tx: x0 + dx, ty: y0 + dy, hp: 100,
        villageId: null, ownerId: null, access: 'public',
      } as unknown as SimState['structures'][number])
      state.nextStructureId += 1
    }
  }
  return { state, x0, y0 }
}

const P = TEMPERATURE.CIEL_PENETRATION

describe('E-R13 — la part du ciel se gagne en profondeur', () => {
  it('À L’AIR LIBRE, RIEN NE CHANGE : le ciel arrive entier (le monde d’avant, au bit près)', () => {
    const { state, x0, y0 } = batiment(3)
    for (const [x, y] of [[0, 0], [x0 - 1, y0 - 1], [63, 63], [x0 + 1, y0 - 1]] as const) {
      expect(partDuCiel(state, x, y), `(${x},${y}) est dehors`).toBe(1)
    }
  })

  it('LE FOND D’UN BÂTIMENT EST NOIR — et il l’est À MIDI, c’est tout le point', () => {
    const cote = 2 * P + 3
    const { state, x0, y0 } = batiment(cote)
    const cx = x0 + (cote >> 1)
    const cy = y0 + (cote >> 1)
    expect(partDuCiel(state, cx, cy), 'le cœur ne reçoit plus rien').toBe(0)
  })

  it('LA PROFONDEUR SE GAGNE : un RANG strict, de la gueule au fond', () => {
    // ⚠ UN RANG, PAS DES VALEURS : c'est la monotonie qui porte la décision d'Alexis (« la
    // profondeur se gagne »), et elle survit à un réglage de `CIEL_PENETRATION`.
    const cote = 2 * P + 3
    const { state, x0, y0 } = batiment(cote)
    const cy = y0 + (cote >> 1)
    const parts: number[] = []
    for (let d = 0; d <= P + 1; d++) parts.push(partDuCiel(state, x0 + d, cy))
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i]!, `à ${i} tuiles du bord : ${parts.join(' > ')}`).toBeLessThan(parts[i - 1]! + 1e-9)
    }
    expect(parts[0]!, 'au pas de la porte, il fait presque jour').toBeGreaterThan(0.5)
    expect(parts[parts.length - 1]!, 'au fond, il fait noir').toBe(0)
    // Et la pente est VRAIE : au moins un cran entre le seuil et le fond.
    expect(new Set(parts).size, 'des valeurs distinctes, pas un mur').toBeGreaterThan(2)
  })

  it('UNE CABANE D’UNE TUILE RESTE HABITABLE DE JOUR — bâtir un toit n’est pas se punir', () => {
    const { state, x0, y0 } = batiment(1)
    expect(partDuCiel(state, x0, y0)).toBeGreaterThan(0.5)
  })
})

/* ══════════ ET LA LOI ARRIVE JUSQU'À CE QU'UN CORPS VOIT ══════════ */

describe('E-R13 — un intérieur est sombre À MIDI, et la flamme le répare', () => {
  const cote = 2 * P + 3

  /** La clarté sur soi, à MIDI pile, au point donné, sans torche. */
  function aMidi(state: SimState, x: number, y: number, torche = false): number {
    // Midi : le ciel vaut 1, donc tout ce qui reste est l'affaire du couvert et du feu.
    return clarteSurSoiAt(state, state.tick, x, y, torche)
  }

  it('DEHORS À MIDI, RIEN NE BOUGE — le monde d’avant, au bit près', () => {
    const { state } = batiment(3)
    expect(aMidi(state, 40, 40)).toBeCloseTo(1, 6)
  })

  it('AU FOND D’UN BÂTIMENT, MIDI NE VAUT PAS MIEUX QUE MINUIT', () => {
    const { state, x0, y0 } = batiment(cote)
    const cx = x0 + (cote >> 1) + 0.5
    const cy = y0 + (cote >> 1) + 0.5
    expect(aMidi(state, cx, cy), 'il fait noir dedans à midi').toBeCloseTo(0, 6)
    // …et c'est bien SOUS le seuil qui décide de la garde : la règle a des dents.
    expect(aMidi(state, cx, cy)).toBeLessThan(NUIT.SEUIL_NOIR)
  })

  it('LA FLAMME LE RÉPARE — la torche à bout de bras, le feu dans la pièce', () => {
    const { state, x0, y0 } = batiment(cote)
    const cx = x0 + (cote >> 1) + 0.5
    const cy = y0 + (cote >> 1) + 0.5
    expect(aMidi(state, cx, cy, true), 'torche vive : on voit').toBe(1)
    // Un feu posé dans la pièce : la lumière est la lumière, d'où qu'elle vienne.
    state.structures.push({
      id: state.nextStructureId, type: 'fire', tx: Math.floor(cx), ty: Math.floor(cy), hp: 100,
      villageId: null, ownerId: null, access: 'public', litUntil: state.tick + 100000,
    } as unknown as SimState['structures'][number])
    state.nextStructureId += 1
    expect(aMidi(state, cx, cy), 'un feu dans la pièce rend la garde').toBeGreaterThan(NUIT.SEUIL_NOIR)
  })
})

/* ══════════ ET LE TOIT QU'ON POSE ABRITE ENFIN ══════════ */

describe('E-R14 — un TOIT couvre : c’est la seule pièce qu’un joueur puisse poser pour ça', () => {
  /**
   * ⚠ **CETTE GARDE NAÎT D'UNE MESURE, pas d'une idée.** `isSheltered` ne connaissait que la
   * `house` — une pièce d'**héritage** (`pose: 'monde'`) que le worldgen dépose et **qu'un joueur
   * ne peut pas bâtir** — et la Grotte, dont les zones (`karst`/`gouffre`) sont **absentes du
   * monde joué**. MESURÉ sur trois graines : **0 tuile couverte sur toute la carte**. Rien de ce
   * qu'on construit n'abritait de rien : ni la pluie, ni le froid, ni (depuis B1) la lumière.
   *
   * Ce qui la ferait rougir : retirer `roofAt` d'`isSheltered` — on revient à une pièce « Toit »
   * qu'on pose pour la forme.
   */
  function avecToit(n: number): { state: SimState; x0: number; y0: number } {
    const state = createSim(1, { map: createEmptyMap(64, 64, TERRAIN_GRASS), worldEvents: false, faunaCap: 0 })
    state.cycleOffset = cycleOffsetForStartHour(12, jourDeSaison(state))
    const x0 = 20
    const y0 = 20
    for (let dy = 0; dy < n; dy++) {
      for (let dx = 0; dx < n; dx++) {
        state.structures.push({
          id: state.nextStructureId, type: 'roof', tx: x0 + dx, ty: y0 + dy, hp: 60,
          villageId: null, ownerId: null, access: 'public',
        } as unknown as SimState['structures'][number])
        state.nextStructureId += 1
      }
    }
    return { state, x0, y0 }
  }

  it('UNE TUILE SOUS UN TOIT EST COUVERTE — et elle ne l’était pas', () => {
    const { state, x0, y0 } = avecToit(1)
    expect(isSheltered(state, x0, y0), 'sous le toit').toBe(true)
    expect(isSheltered(state, x0 + 1, y0), 'à côté, dehors').toBe(false)
  })

  it('ET LA LOI DU CIEL S’Y APPLIQUE : une grande halle est sombre à midi', () => {
    const n = 2 * P + 3
    const { state, x0 } = avecToit(n)
    const c = x0 + (n >> 1)
    expect(partDuCiel(state, c, c), 'le cœur de la halle').toBe(0)
    expect(clarteSurSoiAt(state, state.tick, c + 0.5, c + 0.5, false)).toBeLessThan(NUIT.SEUIL_NOIR)
    // …et le pas de la porte reste clair : la profondeur se gagne, ici comme ailleurs.
    expect(partDuCiel(state, x0, c)).toBeGreaterThan(0.5)
  })
})
