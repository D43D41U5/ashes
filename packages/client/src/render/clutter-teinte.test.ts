import { describe, expect, it } from 'vitest'
import { couleurTouffe, teinteTouffe, terrainsATouffes, TUFT_ART } from './clutter-teinte'
import { TERRAIN_COLORS } from './terrain-colors'

/** La touffe telle qu'elle s'affichait AVANT la gamme de biome : art #5a6e33 × teinte 0xbfc4bd. */
const TOUFFE_HISTORIQUE = [
  Math.round((0x5a * 0xbf) / 255),
  Math.round((0x6e * 0xc4) / 255),
  Math.round((0x33 * 0xbd) / 255),
]

describe('la touffe prend la gamme de son biome', () => {
  /**
   * LA GARDE EXHAUSTIVE : on ne choisit pas les biomes, on les DEMANDE à la table de calibration.
   * Ajouter `grass_tuft` à un biome (ou changer sa couleur de sol) fait entrer ce biome dans le
   * test sans qu'on y touche — c'est la seule façon que la borne tienne dans six mois.
   *
   * Une seule propriété affirmée : AUCUN canal ne bute. Une teinte Phaser ne sait qu'assombrir ;
   * si l'art était trop sombre, la couleur voulue serait tronquée et la touffe virerait de ton
   * au lieu de suivre son sol — la panne exacte que cette règle doit éviter.
   */
  it('aucun canal ne bute — l’art est assez clair pour toutes les gammes', () => {
    const terrains = terrainsATouffes()
    expect(terrains.length).toBeGreaterThan(0)
    for (const t of terrains) {
      const sol = TERRAIN_COLORS[t]
      expect(sol, `terrain ${t} sans couleur de sol`).toBeDefined()
      const voulue = couleurTouffe(sol!)
      for (let i = 0; i < 3; i++) {
        expect(voulue[i]!, `terrain ${t}, canal ${i} : art ${TUFT_ART[i]} trop sombre`)
          .toBeLessThanOrEqual(TUFT_ART[i]!)
      }
    }
  })

  /** LE PRÉ EST LE POINT FIXE : la règle est mesurée sur lui, elle doit donc lui rendre sa couleur
   *  d'avant. 400 000 tuiles de la Racine en dépendent — un écart s'y verrait avant tout le reste. */
  it('rend au pré sa touffe d’avant, à 1/255 près', () => {
    const voulue = couleurTouffe(TERRAIN_COLORS[1]!)
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(voulue[i]! - TOUFFE_HISTORIQUE[i]!)).toBeLessThanOrEqual(1)
    }
  })

  /** La teinte est l'INVERSE exact de l'art : la reposer sur l'art doit redonner la couleur voulue.
   *  C'est ce qui garantit que la gamme calculée est bien celle qui atteint l'écran. */
  it('la teinte rejoue la couleur voulue une fois posée sur l’art', () => {
    for (const t of terrainsATouffes()) {
      const voulue = couleurTouffe(TERRAIN_COLORS[t]!)
      const teinte = teinteTouffe(TERRAIN_COLORS[t]!)
      for (let i = 0; i < 3; i++) {
        const canal = (teinte >> (8 * (2 - i))) & 0xff
        expect(Math.abs((canal / 255) * TUFT_ART[i]! - voulue[i]!)).toBeLessThan(1)
      }
    }
  })

  /** Deux biomes de gammes différentes ne doivent PAS retomber sur la même touffe — sinon la
   *  règle serait inerte et personne ne le verrait. Le pré et le calciné sont les deux extrêmes
   *  de la zone de départ. */
  it('sépare les gammes — le pré et le calciné ne portent pas la même touffe', () => {
    const pre = couleurTouffe(TERRAIN_COLORS[1]!)
    const calcine = couleurTouffe(TERRAIN_COLORS[21]!)
    const ecart = Math.max(...pre.map((v, i) => Math.abs(v - calcine[i]!)))
    expect(ecart).toBeGreaterThan(12)
  })
})
