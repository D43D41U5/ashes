import { describe, expect, it } from 'vitest'
import { TORCHE } from '@ashes/sim'
import {
  AGONIE,
  TORCHE_HOLE_FORCE,
  TORCHE_HOLE_TILES,
  TORCHE_LIGHT_TILES,
  TORCHE_POOL_TILES,
  forceDeTorche,
  torcheHoleRadius,
} from './torche'
import { fireHoleRadius } from './lighting'

/**
 * LES COURBES DE LA TORCHE (spec `torche.md` § Le rendu).
 *
 * On éprouve des PROPRIÉTÉS sur tout le domaine, pas trois valeurs choisies — c'est une
 * géométrie continue, et une géométrie se balaie (mémoire « garde exhaustive plutôt que cas
 * choisis »). Les deux propriétés qui comptent : elle reste EN DEÇÀ du Feu (sans quoi elle
 * annule la nuit noire), et elle MEURT AVANT sa flamme (sans quoi le joueur ne voit pas venir
 * le noir).
 *
 * La PREMIÈRE a changé de forme le 2026-08-26 (« doubler le diamètre … diminuer l'intensité »,
 * Alexis). Ce n'est plus le seul rayon qui protège la nuit : le trou du voile a deux leviers,
 * la PORTÉE et la PROFONDEUR, et l'un paie l'autre. La garde suit donc la décision au lieu de
 * la contredire — on exige le rayon sous le Feu, ET le creusement à sa moitié au plus.
 */
const NUIT = 0 // `day` à minuit
const parts = Array.from({ length: 101 }, (_, i) => i / 100)

describe('la force de la torche', () => {
  it('vaut zéro dès que la flamme est morte, à toute heure', () => {
    for (let day = 0; day <= 1; day += 0.05) {
      expect(forceDeTorche(0, day, 1234)).toBe(0)
      expect(forceDeTorche(-0.1, day, 1234)).toBe(0)
    }
  })

  it('est nulle en PLEIN JOUR et pleine à minuit — une torche ne se voit pas au soleil', () => {
    expect(forceDeTorche(1, 1, 0)).toBe(0)
    expect(forceDeTorche(1, NUIT, 0)).toBeGreaterThan(0.9)
  })

  it('reste dans [0, 1] sur TOUT le domaine, vacillement compris', () => {
    for (const part of parts) {
      for (let day = 0; day <= 1; day += 0.1) {
        for (let ms = 0; ms < 6000; ms += 137) {
          const f = forceDeTorche(part, day, ms, 3)
          expect(f).toBeGreaterThanOrEqual(0)
          expect(f).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('elle AGONISE : sous le seuil, la force chute strictement avec la flamme', () => {
    // Sans vacillement (timeMs figé à un instant où `flicker` vaut la même chose partout) :
    // c'est la RAMPE qu'on éprouve, pas le battement.
    let precedent = forceDeTorche(AGONIE, NUIT, 0, 0)
    for (let part = AGONIE; part > 0; part -= AGONIE / 40) {
      const f = forceDeTorche(part, NUIT, 0, 0)
      expect(f).toBeLessThanOrEqual(precedent + 1e-9)
      precedent = f
    }
    expect(forceDeTorche(0.001, NUIT, 0, 0)).toBeLessThan(0.02)
  })

  it('au-dessus du seuil, elle ne faiblit PAS avec la flamme (le battement seul la fait respirer)', () => {
    // Une torche à 90 % et une à 40 % éclairent pareil : la peur doit venir d'un coup, sur
    // le dernier tiers — pas d'une lumière qui décline dès le premier pas.
    expect(forceDeTorche(1, NUIT, 0, 0)).toBe(forceDeTorche(AGONIE + 0.01, NUIT, 0, 0))
  })
})

describe('le trou dans le voile', () => {
  it('reste SOUS celui d’un Feu, à tout instant du vacillement', () => {
    // La garde qui protège la nuit noire : `fireHoleRadius` vacille (6 × flicker), le nôtre
    // non — on compare donc le NÔTRE À SON MAXIMUM au feu À SON MINIMUM. Un foyer doit rester,
    // à distance égale, la lumière la plus franche du monde.
    let feuMin = Infinity
    for (let ms = 0; ms < 20000; ms += 53) feuMin = Math.min(feuMin, fireHoleRadius(ms, 1.7))
    expect(TORCHE_HOLE_TILES).toBeLessThan(feuMin)
    expect(torcheHoleRadius(1, NUIT)).toBeLessThan(feuMin)
  })

  it('et ce qu’il gagne en portée, il le rend en PROFONDEUR — la nuit reste une nuit', () => {
    // Le vrai garde-fou depuis que le rayon a doublé : la torche ne creuse qu'une FRACTION de
    // ce qu'un Feu creuse. Sans lui, doubler le rayon une fois de plus rendrait le plein jour
    // partout où l'on marche (la leçon du 2026-08-03, « la nuit effacée à vingt-cinq tuiles »).
    expect(TORCHE_HOLE_FORCE).toBeGreaterThan(0)
    expect(TORCHE_HOLE_FORCE).toBeLessThanOrEqual(0.5)
  })

  it('se referme avec la flamme, jusqu’à ZÉRO — le monde se referme vraiment', () => {
    expect(torcheHoleRadius(1, NUIT)).toBe(TORCHE_HOLE_TILES)
    let precedent = TORCHE_HOLE_TILES
    for (const part of [...parts].reverse()) {
      const r = torcheHoleRadius(part, NUIT)
      expect(r).toBeLessThanOrEqual(precedent + 1e-9)
      precedent = r
    }
    expect(torcheHoleRadius(0, NUIT)).toBe(0)
  })

  it('est nul en plein jour : la torche ne troue pas un voile qui n’existe pas', () => {
    expect(torcheHoleRadius(1, 1)).toBe(0)
  })

  it('ne vacille PAS en taille — sinon la grille de pixels grouillerait', () => {
    // `torcheHoleRadius` ne prend pas `timeMs`, et c'est la garde : elle ne PEUT pas battre.
    // (Le battement passe par l'alpha, via `forceDeTorche`. Leçon de `fire-ground-glow`.)
    expect(torcheHoleRadius.length).toBe(2)
  })
})

describe('les portées entre elles', () => {
  it('le point light déborde le trou, qui déborde… rien — chacune a son rôle', () => {
    // Le point light porte le plus loin (il n'allume que ce qui a des normales : des fûts
    // qu'on veut voir se détacher un peu au-delà du sol éclairé). Le trou, lui, est ce que
    // le joueur lit comme « la portée de ma torche ».
    expect(TORCHE_LIGHT_TILES).toBeGreaterThan(TORCHE_POOL_TILES)
    expect(TORCHE_POOL_TILES).toBeGreaterThan(TORCHE_HOLE_TILES)
  })

  it('une torche ne tient pas la nuit : sa combustion est une FRACTION du cycle', () => {
    // La garde d'équilibrage, côté client parce que c'est là qu'on la lit : si quelqu'un
    // monte `BURN_TICKS` à une nuit entière, la laisse est rompue et ce test le dit.
    // Nuit = 0,375 cycle ; on exige la MOITIÉ de ça au plus.
    const ticksParCycle = 30 * 60 * 20 // CYCLE_REAL_MINUTES × 60 × TICK_RATE_HZ
    expect(TORCHE.BURN_TICKS / ticksParCycle).toBeLessThan(0.375 / 2)
    expect(TORCHE.BURN_TICKS).toBeGreaterThan(0)
  })
})
