import { describe, expect, it } from 'vitest'
import { BRONCHE_MS, essoufflement, grainsParFoulee, longueurFoulee, tassement } from './sprint-fx'

/**
 * L'ÉCRASEMENT DU RAMPEUR — `CROUCH_FACTOR` de `snapshot-view.ts`, recopié plutôt
 * qu'importé : ce module-là tire toute la chaîne Phaser du rendu, qui touche `window`
 * dès l'import et ne se charge pas dans l'environnement Node de vitest (aucun test du
 * paquet ne l'importe). Le chiffre est ici pour DIRE de quoi la fatigue doit rester
 * loin ; s'il bougeait là-bas sans bouger ici, le test perdrait sa référence — mais il
 * garderait sa borne, qui est ce qui protège la lecture.
 */
const CROUCH_FACTOR = 0.72

/**
 * LE SOUFFLE EST UNE PENTE, PAS UN PALIER.
 *
 * Les trois signaux de la course (foulée, densité de la bouffée, tassement) doivent
 * varier sur TOUTE la barre d'endurance : à 80 d'endurance ça doit déjà se lire, un peu.
 * Un seuil — « en dessous de 30, on montre la fatigue » — rendrait le signal INUTILE
 * exactement là où il sert : le joueur qui décide de fuir le fait à 70, pas à 25.
 *
 * On balaie donc la barre entière plutôt que trois valeurs choisies, et on affirme UNE
 * propriété : la monotonie stricte, plus les deux bornes exactes. Des cas choisis
 * passeraient au vert sur un escalier.
 */
describe('le souffle du coureur — une pente continue', () => {
  const barre = Array.from({ length: 101 }, (_, i) => 100 - i) // 100 → 0

  it('l’essoufflement couvre exactement [0, 1] et ne recule jamais', () => {
    expect(essoufflement(100)).toBe(0)
    expect(essoufflement(0)).toBe(1)
    // Hors bornes (une jauge sur-remplie, un arrondi négatif) : borné, jamais extrapolé.
    expect(essoufflement(140)).toBe(0)
    expect(essoufflement(-20)).toBe(1)
    for (let i = 1; i < barre.length; i++) {
      expect(essoufflement(barre[i]!)).toBeGreaterThan(essoufflement(barre[i - 1]!))
    }
  })

  it('la foulée se raccourcit sans jamais remonter, et reste dans ses bornes', () => {
    const fraiche = longueurFoulee(0)
    const aBout = longueurFoulee(1)
    expect(aBout).toBeLessThan(fraiche)
    // Une foulée doit rester une foulée : jamais si courte qu'elle fasse un nuage
    // continu (< 8 px, soit une demi-tuile), jamais si longue qu'on perde le rythme.
    expect(aBout).toBeGreaterThanOrEqual(8)
    expect(fraiche).toBeLessThanOrEqual(2 * 16)
    for (let i = 1; i < barre.length; i++) {
      const avant = longueurFoulee(essoufflement(barre[i - 1]!))
      const apres = longueurFoulee(essoufflement(barre[i]!))
      expect(apres).toBeLessThan(avant)
    }
  })

  it('la bouffée s’épaissit du souffle plein au dernier, sans jamais s’éteindre', () => {
    expect(grainsParFoulee(1)).toBeGreaterThan(grainsParFoulee(0))
    // Une bouffée VIDE serait un pas qui ne se voit pas : le plancher est ≥ 1 grain.
    for (const s of barre) expect(grainsParFoulee(essoufflement(s))).toBeGreaterThanOrEqual(1)
  })

  it('le tassement croît avec l’essoufflement — et ne se confond JAMAIS avec le rampement', () => {
    expect(tassement(0, 0)).toBe(0)
    for (let i = 1; i < barre.length; i++) {
      const avant = tassement(essoufflement(barre[i - 1]!), 0)
      const apres = tassement(essoufflement(barre[i]!), 0)
      expect(apres).toBeGreaterThan(avant)
    }
    // LA BORNE QUI COMPTE : même au pire — à bout de souffle ET en pleine bronchée — la
    // silhouette reste plus haute que celle du rampeur. Sans quoi la fatigue lirait
    // comme une posture accroupie, et le joueur croirait s'être mis à couvert.
    const pire = tassement(1, 1)
    expect(1 - pire).toBeGreaterThan(CROUCH_FACTOR)
  })

  it('la bronchée retombe à zéro, sur une rampe droite', () => {
    // La part restante de bronchée, telle que `SprintFx.frame` la calcule.
    const part = (ecoule: number) => Math.max(0, 1 - ecoule / BRONCHE_MS)
    expect(part(0)).toBe(1)
    expect(part(BRONCHE_MS / 2)).toBeCloseTo(0.5, 6)
    expect(part(BRONCHE_MS)).toBe(0)
    expect(part(BRONCHE_MS * 3)).toBe(0) // et elle ne repart JAMAIS dans le négatif
  })
})
