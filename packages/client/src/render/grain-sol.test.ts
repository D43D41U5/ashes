import { describe, expect, it } from 'vitest'
import {
  FAMILLES,
  FAMILLE_PAR_TERRAIN,
  GRAIN_CELLS,
  familleDe,
  grainFacteur,
  indexFamille,
  moyenneFamille,
  profilDe,
  terrainsDeclares,
  type Famille,
} from './grain-sol'

const SEED = 0x51ce

/** Le facteur de chaque cellule du bloc d'une famille — le bloc RÉELLEMENT cuit. */
function bloc(f: Famille): number[] {
  const v: number[] = []
  for (let cy = 0; cy < GRAIN_CELLS; cy++) {
    for (let cx = 0; cx < GRAIN_CELLS; cx++) v.push(grainFacteur(cx, cy, f, SEED))
  }
  return v
}

describe('la table des matières couvre tout le monde', () => {
  /**
   * LA GARDE EXHAUSTIVE : on ne choisit pas les terrains, on les DEMANDE au registre de la sim
   * (`TERRAINS`), qui est l'autorité — un grep en aurait compté moins. Ajouter un biome sans lui
   * donner de matière fait rougir ce test, au lieu de le laisser passer en aplat silencieux.
   */
  it('chaque terrain déclaré par la sim a une matière, ou un refus explicite', () => {
    for (const id of terrainsDeclares()) {
      expect(FAMILLE_PAR_TERRAIN, `terrain ${id} sans entrée`).toHaveProperty(String(id))
      const f = FAMILLE_PAR_TERRAIN[id]
      if (f !== null) expect(FAMILLES).toContain(f)
    }
  })

  it("les terrains à couche propre ne portent AUCUN grain", () => {
    // L'eau a son shader, la falaise sa paroi, le mur son bâti : y peindre du grain, c'est
    // peindre sous un objet opaque — du coût sans image.
    for (const id of [0, 4, 6, 7, 23]) expect(familleDe(id)).toBeNull()
  })

  it('chaque famille occupe un bloc distinct de l\'atlas', () => {
    const index = FAMILLES.map(indexFamille)
    expect(new Set(index).size).toBe(FAMILLES.length)
    expect(Math.min(...index)).toBe(0)
    expect(Math.max(...index)).toBe(FAMILLES.length - 1)
  })
})

describe('le grain ne peut qu\'assombrir, et il se compense', () => {
  it('aucun cran ne dépasse 1', () => {
    // En MULTIPLY, un cran > 1 serait écrêté sans bruit : le profil mentirait sur ce qu'il fait.
    for (const f of FAMILLES) {
      for (const c of profilDe(f).crans) {
        expect(c, `${f} : cran hors bornes`).toBeGreaterThan(0)
        expect(c, `${f} : cran > 1, il serait écrêté`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('la compensation ramène EXACTEMENT la luminance moyenne du témoin', () => {
    // C'est la promesse faite à Alexis : adopter le grain ne doit pas faire foncer le monde.
    // Le bake est relevé de 1/moyenne, donc le composite doit retomber sur 1.
    for (const f of FAMILLES) {
      const m = moyenneFamille(f, SEED)
      expect(m).toBeGreaterThan(0)
      expect(m).toBeLessThanOrEqual(1)
      const composite = bloc(f).reduce((s, v) => s + v / m, 0) / (GRAIN_CELLS * GRAIN_CELLS)
      expect(composite, `${f} : le composite dérive`).toBeCloseTo(1, 10)
    }
  })

  it('sans compensation, le monde foncerait vraiment — la garde a un objet', () => {
    // Une garde doit prouver sa prémisse : si aucune famille n'assombrissait, le test
    // précédent passerait sur un problème inexistant.
    const pires = FAMILLES.map((f) => 1 - moyenneFamille(f, SEED))
    expect(Math.max(...pires), 'aucune famille n\'assombrit : le grain est inerte').toBeGreaterThan(0.01)
  })
})

describe('chaque matière se comporte comme sa matière', () => {
  it('aucun profil ne s\'effondre en aplat : les trois crans servent vraiment', () => {
    // LA PANNE SILENCIEUSE qu'on redoute : un seuil mal posé et une famille n'émet plus qu'un
    // seul cran — elle redevient l'aplat qu'on est en train de corriger, sans rien signaler.
    for (const f of FAMILLES) {
      const v = bloc(f)
      const distincts = [...new Set(v)]
      expect(distincts.length, `${f} : ${distincts.length} cran(s) seulement`).toBe(3)
      for (const c of distincts) {
        const part = v.filter((x) => x === c).length / v.length
        expect(part, `${f} : le cran ${c} ne couvre que ${(part * 100).toFixed(1)} %`).toBeGreaterThan(0.05)
      }
    }
  })

  it('la neige est la plus douce, le minéral le plus franc', () => {
    // L'INTENTION DE DESIGN, affirmée comme une propriété : c'est tout l'argument des familles.
    // Un réglage qui rendrait la neige granuleuse casse ici, pas en playtest six semaines plus tard.
    const amplitude = (f: Famille): number => 1 - Math.min(...profilDe(f).crans)
    expect(amplitude('neige')).toBeLessThan(amplitude('herbe'))
    expect(amplitude('herbe')).toBeLessThan(amplitude('litiere'))
    expect(amplitude('litiere')).toBeLessThan(amplitude('humide'))
    expect(amplitude('humide')).toBeLessThan(amplitude('mineral'))
  })

  it('la neige se tait à la tuile — le damier ne doit plus s\'y lire comme une grille', () => {
    // MESURÉ le 2026-07-30 : à damier global (±3,5 %), témoin et matière étaient presque
    // indiscernables sur la neige — le damier par tuile écrasait le grain sous-tuile et se
    // lisait comme une GRILLE de 16 px. C'est le défaut que la famille « neige » corrige ;
    // remonter son damier le ramènerait, alors on l'affirme ici.
    expect(profilDe('neige').damier).toBeLessThan(0.02)
    for (const f of FAMILLES) {
      if (f === 'neige') continue
      expect(profilDe('neige').damier, `${f} n'est pas plus tramé que la neige`)
        .toBeLessThan(profilDe(f).damier)
    }
  })

  it('le damier est de moyenne 1 : il n\'a rien à compenser', () => {
    // `1 − d/2 + d × hash` est centré par construction. Si ce n'était pas vrai, le bake
    // dériverait en luminance sans que la compensation du MULTIPLY le sache.
    for (const f of FAMILLES) {
      const d = profilDe(f).damier
      expect((1 - d / 2 + d * 0) + (1 - d / 2 + d * 1)).toBeCloseTo(2, 12)
    }
  })

  it('la congère est large, l\'éboulis est serré', () => {
    // Le caractère ne tient pas qu'à l'amplitude : à échelle égale, neige et roche auraient le
    // même motif en plus pâle. C'est l'ÉCHELLE qui fait la congère.
    expect(profilDe('neige').echelle).toBeGreaterThan(2 * profilDe('mineral').echelle)
  })

  it('le grain est stable : même cellule, même seed, même facteur', () => {
    for (const f of FAMILLES) {
      expect(grainFacteur(11, 7, f, SEED)).toBe(grainFacteur(11, 7, f, SEED))
    }
  })
})
