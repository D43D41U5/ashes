import { describe, expect, it } from 'vitest'
import { PLAQUE_ALPHA, PLAQUE_ENCRE } from './hud-core'

/**
 * LE HUD A UN SOL, ET ON LE PROUVE EN NOMBRES (décision d'Alexis, 2026-08-20, question ③).
 *
 * Six classes de texte du HUD ne déclaraient AUCUN fond : elles étaient posées à nu sur un
 * monde qui change de couleur à chaque heure. Ce n'est pas une impression — c'est mesuré au
 * banc, et le résultat est brutal contre le sol de midi :
 *
 *   encre atténuée `dim` .......... 1,43:1
 *   bandeau du jour (blanc) ....... 2,24:1   ← ÉCHEC AA, sur le texte le plus important
 *   alarme de surcharge (rouge) ... 1,64:1   ← le texte le moins lisible est celui qui CRIE
 *
 * Et la preuve la plus parlante n'est pas un calcul : **deux lecteurs experts sur huit**,
 * outils de pixels en main et des heures devant l'image, ont transcrit « ▲ 0 / 40 » là où le
 * code interpole `CARRY.CAPACITY = 60`. Un joueur en mouvement, à midi, ne le lira jamais.
 *
 * LA DÉCISION EST « LA PLAQUE, PAS LA TEINTE ». Les teintes du HUD sont déjà calculées et
 * passent sur les trois fonds officiels de la palette ; c'est le QUATRIÈME fond — le monde
 * éclairé — que la charte n'a jamais modélisé. On lui en donne un, et ce test vérifie que ce
 * sol suffit. Il lit les constantes de `hud-core` : elles ne peuvent pas se diluer en silence.
 */

/** Les pires fonds RÉELLEMENT mesurés au banc — pas des suppositions. */
const SOL_MIDI: [number, number, number] = [167, 181, 86]
const TACHE_SOLEIL: [number, number, number] = [201, 201, 190]
const FONDS: Record<string, [number, number, number]> = {
  'le sol de midi': SOL_MIDI,
  'une tache de soleil (p99 de midi)': TACHE_SOLEIL,
}

/** Les encres du HUD, telles que `hud-core` les déclare. */
const ENCRES = {
  'le bandeau du jour': [255, 255, 255] as [number, number, number],
  'l’encre atténuée (lieu, tableau, métiers, sauvegarde)': [154, 143, 120] as [number, number, number],
  'l’alarme de surcharge': [224, 90, 74] as [number, number, number],
}

const [encreR = 0, encreV = 0, encreB = 0] = PLAQUE_ENCRE.split(',').map(Number)
const encre: [number, number, number] = [encreR, encreV, encreB]

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

const contraste = (a: [number, number, number], b: [number, number, number]): number => {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Le fond que le texte voit RÉELLEMENT : la plaque composée sur le monde. */
const sousLaPlaque = (fond: [number, number, number], alpha: number): [number, number, number] => [
  alpha * encre[0] + (1 - alpha) * fond[0],
  alpha * encre[1] + (1 - alpha) * fond[1],
  alpha * encre[2] + (1 - alpha) * fond[2],
]

describe('le sol du HUD', () => {
  it('LA PRÉMISSE : sans sol, le HUD est bien illisible sur le monde de midi', () => {
    // Une garde qui n'affirme pas d'abord le problème « répare » peut-être ce qui allait bien.
    for (const [nom, teinte] of Object.entries(ENCRES)) {
      expect(contraste(teinte, SOL_MIDI), nom).toBeLessThan(3)
    }
  })

  it('LE BANDEAU DU JOUR — le texte le plus important — passe de l’échec à AAA', () => {
    const nu = contraste(ENCRES['le bandeau du jour'], SOL_MIDI)
    const sur = contraste(ENCRES['le bandeau du jour'], sousLaPlaque(SOL_MIDI, PLAQUE_ALPHA))
    expect(nu).toBeLessThan(4.5) // échouait AA
    expect(sur).toBeGreaterThan(7) // AAA, sur les deux fonds
    for (const fond of Object.values(FONDS)) {
      expect(contraste(ENCRES['le bandeau du jour'], sousLaPlaque(fond, PLAQUE_ALPHA))).toBeGreaterThan(7)
    }
  })

  it('L’ALARME DE SURCHARGE devient lisible — elle était le texte le plus faible du cadre', () => {
    for (const [nom, fond] of Object.entries(FONDS)) {
      expect(contraste(ENCRES['l’alarme de surcharge'], sousLaPlaque(fond, PLAQUE_ALPHA)), nom).toBeGreaterThan(3)
    }
  })

  /**
   * L'ENCRE ATTÉNUÉE ATTEINT LE SEUIL AA SUR LE SOL, ET RESTE JUSTE EN DESSOUS SUR UNE TACHE
   * DE SOLEIL. Ce dernier dixième ne se gagne PAS avec la plaque : il faudrait relever `dim`
   * lui-même — et c'est précisément ce que la décision exclut (« la plaque, pas la teinte »),
   * le sort de `dim` étant une question de palette réservée à Alexis, déjà notée dans
   * `hud-core`. On garde donc le gain réel (×3 environ) sans prétendre à un AA qu'on n'a pas.
   */
  it('L’ENCRE ATTÉNUÉE gagne un facteur trois, et on ne prétend pas plus', () => {
    const dim = ENCRES['l’encre atténuée (lieu, tableau, métiers, sauvegarde)']
    const nu = contraste(dim, SOL_MIDI)
    const sur = contraste(dim, sousLaPlaque(SOL_MIDI, PLAQUE_ALPHA))
    expect(sur / nu).toBeGreaterThan(3)
    expect(sur).toBeGreaterThan(4.4) // au seuil AA, sans y prétendre sur tous les fonds
  })

  it('et la plaque reste un VOILE, pas une dalle', () => {
    // Assez dense pour porter le texte, assez claire pour qu'on voie le monde au travers.
    expect(PLAQUE_ALPHA).toBeGreaterThan(0.7)
    expect(PLAQUE_ALPHA).toBeLessThan(0.9)
  })
})
