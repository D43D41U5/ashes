import { describe, expect, it } from 'vitest'
import {
  adoucir,
  ECLOSION_ETALEMENT,
  fonduLuciole,
  FONDU_ENTREE_S,
  FONDU_SORTIE_S,
} from './fondu-essaim'

/** Les retards de douze mouches, étalés à la main : le tirage vit dans la scène, pas ici. */
const RETARDS = Array.from({ length: 12 }, (_, i) => i / 11)

describe('adoucir', () => {
  it('va de 0 à 1 et borne ce qui déborde', () => {
    expect(adoucir(0)).toBe(0)
    expect(adoucir(1)).toBe(1)
    expect(adoucir(-3)).toBe(0)
    expect(adoucir(9)).toBe(1)
  })

  it('démarre et finit à plat — c’est LA propriété du fondu', () => {
    // Une rampe linéaire se voit partir et se voit s'arrêter : ce que l'œil attrape, c'est la
    // CASSURE de pente. On exige donc que le premier centième de course avance beaucoup moins
    // que le centième du milieu (linéaire : ils avanceraient d'autant).
    const depart = adoucir(0.01) - adoucir(0)
    const fin = adoucir(1) - adoucir(0.99)
    const milieu = adoucir(0.51) - adoucir(0.5)
    expect(depart).toBeLessThan(milieu / 10)
    expect(fin).toBeLessThan(milieu / 10)
  })

  it('ne redescend jamais', () => {
    for (let t = 0; t < 1; t += 0.01) expect(adoucir(t + 0.01)).toBeGreaterThanOrEqual(adoucir(t))
  })
})

describe('fonduLuciole', () => {
  it('éteint tout à 0 et allume tout à 1, quel que soit le retard', () => {
    for (const r of RETARDS) {
      expect(fonduLuciole(0, r)).toBe(0)
      expect(fonduLuciole(1, r)).toBe(1)
    }
  })

  it('N’ALLUME PAS LES MOUCHES ENSEMBLE — sans quoi le fondu n’est qu’un interrupteur lent', () => {
    // À mi-course, l'essaim doit être un DÉGRADÉ : des mouches pleines, des mouches éteintes,
    // et des mouches entre les deux. Ce qui ferait rougir : un étalement nul (toutes égales).
    const mi = RETARDS.map((r) => fonduLuciole(0.5, r))
    expect(Math.max(...mi) - Math.min(...mi)).toBeGreaterThan(0.5)
    expect(mi.filter((a) => a > 0.99).length).toBeGreaterThan(0)
    expect(mi.filter((a) => a < 0.01).length).toBeGreaterThan(0)
    expect(mi.filter((a) => a > 0.01 && a < 0.99).length).toBeGreaterThan(0)
  })

  it('la dernière mouche part quand la première a fini — l’essaim se remplit sans front', () => {
    // La première (retard 0) est pleine à `1 - ECLOSION_ETALEMENT` ; la dernière (retard 1)
    // décolle exactement là. Aucun palier où plus rien ne bouge.
    expect(fonduLuciole(1 - ECLOSION_ETALEMENT, 0)).toBe(1)
    expect(fonduLuciole(1 - ECLOSION_ETALEMENT, 1)).toBe(0)
    for (let f = 0.02; f < 1; f += 0.02) {
      const avant = RETARDS.reduce((n, r) => n + fonduLuciole(f - 0.02, r), 0)
      const apres = RETARDS.reduce((n, r) => n + fonduLuciole(f, r), 0)
      expect(apres).toBeGreaterThan(avant)
    }
  })

  it('ne saute jamais : un pas de fondu d’une image de 60 Hz reste imperceptible', () => {
    // Le vrai garde-fou de « pas d'un coup » : à 60 Hz, un pas de fondu vaut dtS/FONDU_ENTREE_S,
    // et AUCUNE mouche ne doit gagner plus de quelques centièmes d'alpha sur une image.
    const pas = 1 / 60 / FONDU_ENTREE_S
    let maxSaut = 0
    for (let f = 0; f <= 1; f += pas) {
      for (const r of RETARDS) maxSaut = Math.max(maxSaut, fonduLuciole(f + pas, r) - fonduLuciole(f, r))
    }
    expect(maxSaut).toBeLessThan(0.05)
  })

  it('la sortie est plus courte que l’entrée, et les deux se comptent en secondes', () => {
    expect(FONDU_SORTIE_S).toBeGreaterThan(0.5)
    expect(FONDU_SORTIE_S).toBeLessThan(FONDU_ENTREE_S)
    expect(FONDU_ENTREE_S).toBeLessThan(5)
  })
})
