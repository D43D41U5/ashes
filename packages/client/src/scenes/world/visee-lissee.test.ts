/**
 * LE SUIVI DE LA VISÉE (demande d'Alexis, 2026-08-02 — spec `tir.md` T3bis).
 *
 * On prouve ici la LOI, et pas au navigateur : un lissage se juge sur des dixièmes de
 * seconde, or le rendu logiciel du banc tourne à quelques images par seconde — il enjambe
 * en une frame toute la course qu'on cherche à mesurer (même raison que `bande.test.ts`).
 * Le smoke garde ce qu'il sait faire : constater que la ligne ARRIVE sur le curseur.
 */
import { describe, expect, it } from 'vitest'
import { DT_SUIVI_MAX_MS, SUIVI_POSE, SUIVI_VIF, ecartAngulaire, suivreAngle, tauxDeSuivi } from './visee-lissee'

/** Combien d'angle reste à combler, en valeur absolue. */
const reste = (courant: number, cible: number): number => Math.abs(ecartAngulaire(courant, cible))

/** Fait tourner le lissage `n` frames de `dt` ms, et rend l'angle atteint. */
const apres = (courant: number, cible: number, dt: number, n: number): number => {
  let a = courant
  for (let i = 0; i < n; i++) a = suivreAngle(a, cible, dt)
  return a
}

describe('le taux de suivi', () => {
  it('MONTE avec l’écart, continûment et sans palier', () => {
    // C'est toute la « réactivité » : une correction au degré près glisse, un revirement
    // claque. On balaie tout l'intervalle — une pente affirmée sur trois points choisis ne
    // dit rien de ce qui se passe entre eux.
    for (let i = 0; i < 100; i++) {
      const a = tauxDeSuivi((Math.PI * i) / 100)
      const b = tauxDeSuivi((Math.PI * (i + 1)) / 100)
      expect(b, `le taux doit monter entre ${i}/100 et ${i + 1}/100 de demi-tour`).toBeGreaterThan(a)
    }
  })

  it('a des BORNES exactes aux deux bouts, et ne monte plus au-delà du demi-tour', () => {
    expect(tauxDeSuivi(0)).toBe(SUIVI_POSE)
    expect(tauxDeSuivi(Math.PI)).toBe(SUIVI_VIF)
    expect(tauxDeSuivi(-Math.PI)).toBe(SUIVI_VIF)
    // Un écart de plus de π n'existe pas (`ecartAngulaire` l'a replié) — mais si un appelant
    // en fabrique un, le taux plafonne plutôt que de partir en l'air.
    expect(tauxDeSuivi(12)).toBe(SUIVI_VIF)
  })
})

describe('l’écart angulaire', () => {
  it('prend TOUJOURS le chemin court, franchissement de ±π compris', () => {
    // Sans ce repliement, viser à l'ouest depuis l'est fait balayer tout l'écran par le sud.
    expect(ecartAngulaire(3.1, -3.1)).toBeCloseTo(2 * Math.PI - 6.2, 6)
    expect(Math.abs(ecartAngulaire(3.1, -3.1))).toBeLessThan(0.1)
    expect(ecartAngulaire(-3.1, 3.1)).toBeCloseTo(6.2 - 2 * Math.PI, 6)
    // …et il reste dans (−π, π] quel que soit le nombre de tours qu'on lui donne.
    for (let i = -20; i <= 20; i++) {
      const e = ecartAngulaire(0.3, 0.3 + i * 0.7)
      expect(Math.abs(e)).toBeLessThanOrEqual(Math.PI + 1e-9)
    }
  })
})

describe('le lissage de la visée', () => {
  it('APPROCHE sa cible sans jamais la dépasser, ni osciller', () => {
    // Un télégraphe qui dépasse ment deux fois par oscillation — et il le ferait exactement
    // quand le joueur corrige son tir. On balaie des écarts du degré au demi-tour.
    for (let i = 1; i <= 60; i++) {
      const cible = (Math.PI * i) / 60
      let a = 0
      let precedent = Math.abs(cible)
      for (let f = 0; f < 30; f++) {
        a = suivreAngle(a, cible, 16)
        const r = reste(a, cible)
        expect(r, `écart ${cible} : la ligne a dépassé ou reculé`).toBeLessThanOrEqual(precedent + 1e-12)
        expect(a).toBeLessThanOrEqual(cible + 1e-12)
        precedent = r
      }
    }
  })

  it('ARRIVE : un demi-tour est bouclé en une poignée de frames, une correction fine tient un dixième de seconde', () => {
    // LE DEMI-TOUR CLAQUE — c'est ce qui distingue un lissage réactif d'une traîne.
    // MESURÉ à 60 im/s : 88 % en 4 frames (64 ms), 94 % en 6 (96 ms).
    expect(reste(apres(0, Math.PI, 16, 6), Math.PI)).toBeLessThan(0.1 * Math.PI)
    // …ET LA CORRECTION FINE GLISSE : elle prend le temps de se voir bouger (le poids de
    // l'arc), sans traîner au-delà de ce que l'œil accepte d'une visée.
    const fin = 0.09 // ~5°
    expect(reste(apres(0, fin, 16, 1), fin)).toBeGreaterThan(0.5 * fin) // pas un saut
    expect(reste(apres(0, fin, 16, 10), fin)).toBeLessThan(0.1 * fin) // mais posée en 160 ms
  })

  it('ne dépend PAS de la cadence d’affichage', () => {
    // Deux machines à 30 et 120 im/s doivent voir la même visée arriver au même moment. À
    // fraction fixe par frame, la lente serait quatre fois plus molle.
    const cible = 1.2
    const lente = apres(0, cible, 32, 5) // 160 ms en 5 frames
    const vive = apres(0, cible, 8, 20) // 160 ms en 20 frames
    expect(Math.abs(lente - vive)).toBeLessThan(0.02) // < ~1,2°
  })

  it('BORNE le pas de temps : une frame qui saute ne téléporte pas la ligne', () => {
    // L'horloge d'une frame lente saute (le banc tourne à quelques images par seconde). Sans
    // borne, `1 − exp(−k·dt)` vaut 1 : le lissage disparaîtrait là où on le vérifie.
    const cible = 1.5
    expect(suivreAngle(0, cible, 4000)).toBe(suivreAngle(0, cible, DT_SUIVI_MAX_MS))
    // Le pas borné mange 82 % d'un gros écart (mesuré) — ce qui reste EST le lissage : à
    // trois images par seconde la ligne met deux frames, pas zéro.
    expect(reste(suivreAngle(0, cible, 4000), cible)).toBeGreaterThan(0.1 * cible)
    // Et un pas nul (ou négatif, si une horloge recule) ne bouge rien du tout.
    expect(suivreAngle(0.4, cible, 0)).toBe(0.4)
    expect(suivreAngle(0.4, cible, -20)).toBe(0.4)
  })

  it('reste IMMOBILE quand la ligne est déjà sur sa cible', () => {
    expect(suivreAngle(0.77, 0.77, 16)).toBe(0.77)
  })
})
