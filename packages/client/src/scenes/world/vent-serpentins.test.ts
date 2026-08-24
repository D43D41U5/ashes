/**
 * LES SERPENTINS (spec `vent.md` V9) — ce qui les empêche de devenir du bruit.
 *
 * La règle centrale n'est pas « qu'ils soient jolis », c'est qu'ils soient RARES : un présage
 * qui sort tout le temps n'annonce plus rien. Ces gardes tiennent les deux bouts du domaine
 * (calme plat / cœur de bande) et la pente entre les deux.
 */

import { describe, expect, it } from 'vitest'
import type { Vue } from './meteo-particules'
import { alphaDuSerpentin, BUDGET_SERPENTINS, ChampSerpentins } from './vent-serpentins'

const VUE: Vue = { x0: 0, y0: 0, x1: 40, y1: 24 }
const EST = { x: 1, y: 0 }

/** Avance le champ d'un nombre d'images à 60 Hz et rend le pic de population observé. */
function jouer(part: number, images = 600, cap = EST): { pic: number; fin: ChampSerpentins } {
  const champ = new ChampSerpentins()
  let pic = 0
  for (let i = 0; i < images; i++) {
    champ.update(1 / 60, VUE, cap, part)
    pic = Math.max(pic, champ.vivants)
  }
  return { pic, fin: champ }
}

describe('la rareté — la règle qui les rend lisibles', () => {
  it('À L’AMBIANCE, PAS UN SEUL. Jamais, même après dix secondes', () => {
    // Le bout du domaine qui compte le plus : c'est l'état du monde 99 % du temps.
    const { pic, fin } = jouer(0)
    expect(pic).toBe(0)
    expect(fin.cible).toBe(0)
  })

  it('la densité suit le CARRÉ du souffle — à mi-souffle, un quart des rubans', () => {
    // Linéaire, ils auraient été présents en permanence dès qu'un front pointe à l'horizon.
    const champ = new ChampSerpentins()
    champ.update(1 / 60, VUE, EST, 0.5)
    const aMoitie = champ.cible
    champ.update(1 / 60, VUE, EST, 1)
    // À un demi près : la cible est un COMPTE, donc arrondie. On affirme la loi, pas l'arrondi.
    expect(Math.abs(aMoitie - champ.cible / 4)).toBeLessThanOrEqual(0.5)
    // Et sur toute la pente, pas sur un point : le carré se lit partout ou nulle part.
    for (const u of [0.2, 0.35, 0.6, 0.8]) {
      champ.update(1 / 60, VUE, EST, u)
      expect(Math.abs(champ.cible - BUDGET_SERPENTINS * u * u), `u = ${u}`).toBeLessThanOrEqual(0.5)
    }
  })

  it('au cœur d’une bande, ils sortent — et jamais au-delà du plafond', () => {
    const { pic } = jouer(1)
    expect(pic).toBeGreaterThan(0)
    expect(pic).toBeLessThanOrEqual(BUDGET_SERPENTINS)
  })

  it('une rafale MONTE, elle ne claque pas — et la montée se compte en SECONDES', () => {
    // À 60 fps : un ruban par image. C'est le geste voulu, mais ce n'est PAS la loi — la loi
    // est un taux par seconde, sans quoi le FX aurait dépendu du framerate (le banc headless
    // l'a montré : cinq rubans au lieu de vingt-six, parce qu'une image y dure dix secondes).
    const champ = new ChampSerpentins()
    let precedent = 0
    for (let i = 0; i < 200; i++) {
      champ.update(1 / 60, VUE, EST, 1)
      expect(champ.vivants - precedent, `image ${i}`).toBeLessThanOrEqual(1)
      precedent = champ.vivants
    }
    // Et une image LONGUE rattrape, au lieu de plafonner à un : c'est la moitié qui manquait.
    const lent = new ChampSerpentins()
    lent.update(0.5, VUE, EST, 1)
    expect(lent.vivants).toBeGreaterThan(1)
    expect(lent.vivants).toBeLessThanOrEqual(BUDGET_SERPENTINS)
  })
})

describe('la traversée', () => {
  it('ils filent DANS LE SENS DU VENT, pour les quatre cardinaux', () => {
    // Un balayage, pas un cas : c'est la seule propriété qui rend le serpentin lisible comme
    // du vent plutôt que comme une entité qui passe.
    for (const cap of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const { fin } = jouer(1, 120, cap)
      const vivants = fin.serpentins.filter((s) => s.vie >= 0)
      expect(vivants.length, `cap ${cap.x},${cap.y}`).toBeGreaterThan(0)
      for (const s of vivants) {
        const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy)
        expect((s.vx * cap.x + s.vy * cap.y) / v, `cap ${cap.x},${cap.y}`).toBeCloseTo(1, 3)
      }
    }
  })

  it('ils NAISSENT hors du cadre — un ruban n’apparaît jamais sous le nez du joueur', () => {
    const champ = new ChampSerpentins()
    for (let i = 0; i < 400; i++) {
      const avant = new Set(champ.serpentins.filter((s) => s.vie >= 0))
      champ.update(1 / 60, VUE, EST, 1)
      for (const s of champ.serpentins) {
        if (s.vie < 0 || avant.has(s)) continue
        const dedans = s.x >= VUE.x0 && s.x <= VUE.x1 && s.y >= VUE.y0 && s.y <= VUE.y1
        expect(dedans, `né en (${s.x.toFixed(1)}, ${s.y.toFixed(1)}) DANS le cadre`).toBe(false)
      }
    }
  })

  it('ils MEURENT — rien ne s’accumule, rien ne tourne en rond', () => {
    const champ = new ChampSerpentins()
    for (let i = 0; i < 300; i++) champ.update(1 / 60, VUE, EST, 1)
    const peuple = champ.vivants
    // Le front est passé : la cible tombe à zéro, et le troupeau se vide de lui-même.
    for (let i = 0; i < 200; i++) champ.update(1 / 60, VUE, EST, 0)
    expect(peuple).toBeGreaterThan(0)
    expect(champ.vivants).toBe(0)
  })
})

describe('le fuseau d’alpha', () => {
  it('les deux bouts valent ZÉRO, le milieu vaut un — jamais une apparition franche', () => {
    expect(alphaDuSerpentin(0, 1)).toBe(0)
    expect(alphaDuSerpentin(1, 1)).toBe(0)
    expect(alphaDuSerpentin(0.5, 1)).toBeCloseTo(1, 6)
    expect(alphaDuSerpentin(-1, 1)).toBe(0)
  })

  it('c’est une PENTE CONTINUE sur toute la vie — balayée, pas échantillonnée aux bouts', () => {
    let precedent = alphaDuSerpentin(0, 1)
    for (let t = 0; t <= 1; t += 0.002) {
      const a = alphaDuSerpentin(t, 1)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThanOrEqual(1)
      expect(Math.abs(a - precedent)).toBeLessThan(0.01) // aucun cran
      precedent = a
    }
  })
})
