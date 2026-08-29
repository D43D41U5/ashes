import { describe, expect, it } from 'vitest'
import { BALANCE, WEAPON_PROFILES } from '@ashes/sim'
import { TILE_PX } from '../../render/framing'
import { desequilibre, INCLINE_MAX, PENCHE_MAX_PX, SEUIL_MS } from './desequilibre'

const MS_PAR_TICK = 1000 / BALANCE.TICK_RATE_HZ

describe('le déséquilibre du coup manqué (item 5)', () => {
  it('LE SEUIL TRIE LES DEUX RÉCUPÉRATIONS — toucher ne se peint pas, rater si', () => {
    // ═══ LA PROPRIÉTÉ, ET ELLE EST VÉRIFIÉE SUR TOUT L'ARSENAL ═══
    //
    // Marquer un coup qui a TOUCHÉ apprendrait au joueur que toucher coûte. Le seuil doit
    // donc tomber dans l'intervalle entre la plus longue récupération de touche et la plus
    // courte récupération de raté chargé — et cet intervalle, on le MESURE ici plutôt que
    // de le croire. *(Premier jet à 0,5 s : c'était exactement le `recoveryHit` de
    // l'overhead des poings — un coup réussi se peignait comme une punition. La garde l'a
    // dit dans la seconde.)*
    const coups = Object.values(WEAPON_PROFILES)
    const pireTouche = Math.max(...coups.flatMap((p) => [p.light.recoveryHit, p.charged.recoveryHit])) * MS_PAR_TICK
    const moindreRate = Math.min(...coups.map((p) => p.charged.recoveryWhiff)) * MS_PAR_TICK
    expect(pireTouche, "le seuil est AU-DESSUS de toute récupération de touche").toBeLessThan(SEUIL_MS)
    expect(moindreRate, 'et EN DESSOUS de tout raté de coup lourd').toBeGreaterThanOrEqual(SEUIL_MS)

    for (const [arme, p] of Object.entries(WEAPON_PROFILES)) {
      for (const coup of [p.light, p.charged]) {
        const hit = coup.recoveryHit * MS_PAR_TICK
        expect(desequilibre(hit * 0.3, hit).penche, `${arme} — coup qui TOUCHE`).toBe(0)
      }
      const whiff = p.charged.recoveryWhiff * MS_PAR_TICK
      expect(desequilibre(whiff * 0.3, whiff).penche, `${arme} — coup qui RATE`).toBeGreaterThan(0.5)
    }
  })

  it('IL PART DE ZÉRO ET Y REVIENT : aucune marche à recoudre', () => {
    const d = 1200
    expect(desequilibre(0, d).penche).toBeCloseTo(0, 6)
    expect(desequilibre(d - 0.001, d).penche).toBeLessThan(0.01)
    expect(desequilibre(d, d).penche).toBe(0)
    expect(desequilibre(d + 500, d).penche).toBe(0)
  })

  it('LE PIC EST TIRÉ VERS LE DÉBUT — on penche vite, on se redresse longtemps', () => {
    // C'est ce qui distingue un raté d'un encaissement : l'un PÈSE, l'autre claque.
    const d = 1200
    let pic = 0
    let quand = 0
    for (let t = 0; t < d; t += 1) {
      const v = desequilibre(t, d).penche
      if (v > pic) {
        pic = v
        quand = t / d
      }
    }
    expect(pic).toBeCloseTo(1, 2)
    expect(quand).toBeLessThan(0.45) // dans la première moitié…
    expect(quand).toBeGreaterThan(0.15) // …mais pas à l'instant zéro
  })

  it('LES DEUX PARTS SONT LIÉES : c’est un seul corps, pas deux animations', () => {
    for (let t = 0; t < 1200; t += 37) {
      const e = desequilibre(t, 1200)
      expect(e.incline).toBeCloseTo(e.penche, 9)
    }
  })

  it('LES AMPLITUDES RESTENT DES ÉCARTS DE DESSIN, pas un déplacement', () => {
    // Sept pixels sur une tuile de seize : on le voit, le corps ne change pas de case —
    // la même retenue que le recul peint (`encaissement.ts`).
    expect(PENCHE_MAX_PX).toBeLessThan(TILE_PX / 2)
    expect(INCLINE_MAX).toBeLessThan(Math.PI / 16)
  })
})
