import { afterEach, describe, expect, it, vi } from 'vitest'
import { axesFeu, varianteFeu, TOUT, NOMS_VARIANTE, type VarianteFeu } from './feu-variante'
import { flicker, flickerV } from './lighting'
import { intensiteDuFeu, PLAFOND_DU_FEU } from '../scenes/world/dynamic-lighting'

/**
 * Pose `window.__FEU__` comme le ferait la console du jeu (ou le scénario smoke).
 *
 * ⚠ IL FAUT UN VRAI `window`, et le premier montage ne le savait pas : la suite du client
 * tourne sous l'environnement **node**, où `window` n'existe pas — `varianteFeu()` sortait donc
 * par sa première ligne et rendait `TOUT` quoi qu'on pose. Trois assertions passaient au vert
 * sans rien éprouver, et les deux qui ont rougi l'ont fait pour cette raison, pas pour la leur.
 * Poser la propriété sur `globalThis` ne suffit pas : c'est bien `window` que la fonction lit.
 */
function poser(v: number | undefined): void {
  vi.stubGlobal('window', v === undefined ? {} : { __FEU__: v })
}
afterEach(() => vi.unstubAllGlobals())

describe('le commutateur du rendu du Feu', () => {
  /**
   * LE CAS NORMAL — personne ne pose `__FEU__`, et c'est celui qui compte : c'est ce que voit
   * un joueur. Un défaut ici ne se verrait sur AUCUN montage de test (ils posent tous la
   * variante explicitement), et le jeu livrerait le rendu d'avant sans qu'une garde bronche.
   */
  it('sans rien poser, le jeu rend TOUT — le rendu livré', () => {
    poser(undefined)
    expect(varianteFeu()).toBe(TOUT)
    const ax = axesFeu()
    expect(ax).toEqual({
      respiration: true, coeurBlanc: true, escarbilles: true, lisere: true, halo: true, compose: true,
    })
  })

  /**
   * ⚠ LE PIÈGE DU ZÉRO FALSY. `window.__FEU__ ?? TOUT` aurait l'air correct et rendrait `0`
   * correctement (`??` ne teste que null/undefined) — mais `window.__FEU__ || TOUT`, ou tout
   * `if (!brut)`, renverrait l'étalon vers TOUT. Or `0` est la SEULE façon de revoir le rendu
   * d'avant : le perdre, c'est perdre le terme de comparaison de toute la planche, et la perte
   * serait silencieuse (on croirait comparer, on regarderait deux fois la même image).
   */
  it('0 reste atteignable — c’est l’étalon, et il est falsy', () => {
    poser(0)
    expect(varianteFeu()).toBe(0)
    const ax = axesFeu(0)
    expect(ax).toEqual({
      respiration: false, coeurBlanc: false, escarbilles: false, lisere: false, halo: false, compose: false,
    })
  })

  it('chaque numéro 1..5 n’allume QUE son axe, et ne compose pas', () => {
    const attendus: Record<number, keyof ReturnType<typeof axesFeu>> = {
      1: 'respiration', 2: 'coeurBlanc', 3: 'escarbilles', 4: 'lisere', 5: 'halo',
    }
    for (const [n, axe] of Object.entries(attendus)) {
      poser(Number(n))
      const ax = axesFeu()
      const allumes = Object.entries(ax).filter(([k, v]) => v && k !== 'compose').map(([k]) => k)
      expect(allumes, `__FEU__ = ${n}`).toEqual([axe])
      expect(ax.compose, `__FEU__ = ${n} ne compose rien`).toBe(false)
    }
  })

  it('une valeur hors domaine retombe sur le rendu livré, jamais sur l’étalon', () => {
    for (const brut of [7, -1, 99, Number.NaN]) {
      poser(brut)
      expect(varianteFeu(), `__FEU__ = ${brut}`).toBe(TOUT)
    }
  })

  it('chaque variante du domaine a un nom — la planche les lit tous', () => {
    for (let v = 0; v <= 6; v++) expect(NOMS_VARIANTE[v as VarianteFeu]).toBeTruthy()
  })
})

describe('le battement asymétrique', () => {
  /**
   * ═══ IL REND LE FEU INÉGAL, PAS PLUS CLAIR ═══
   *
   * C'est la propriété qui distingue « une flamme qui reprend » de « on a monté la lumière ».
   * Elle n'est pas évidente par construction : le socle de `flickerV` est posé à la main à
   * partir de la moyenne théorique d'une impulsion (0,28), et n'importe quel réglage des deux
   * gains la décale. Sans cette garde, augmenter l'amplitude éclaircirait le feu en silence —
   * et le rendu serait jugé « plus chaud » pour la mauvaise raison.
   */
  it('même moyenne que l’étalon, sur deux minutes de signal', () => {
    let somme = 0, sommeEtalon = 0
    const N = 120000
    for (let ms = 0; ms < N; ms++) {
      somme += flickerV(ms, 1.7, true)
      sommeEtalon += flicker(ms, 1.7)
    }
    expect(somme / N).toBeCloseTo(sommeEtalon / N, 2)
    expect(somme / N).toBeCloseTo(1, 2)
  })

  it('mais une amplitude franchement plus large — sinon il n’y a rien à voir', () => {
    let min = Infinity, max = -Infinity, minE = Infinity, maxE = -Infinity
    for (let ms = 0; ms < 120000; ms += 5) {
      const v = flickerV(ms, 1.7, true)
      const e = flicker(ms, 1.7)
      if (v < min) min = v
      if (v > max) max = v
      if (e < minE) minE = e
      if (e > maxE) maxE = e
    }
    expect(max - min).toBeGreaterThan((maxE - minE) * 1.5)
    expect(max).toBeGreaterThan(1.3) // les reprises franches
  })

  it('sans respiration, il rend l’étalon AU BIT PRÈS', () => {
    for (let ms = 0; ms < 20000; ms += 37) {
      expect(flickerV(ms, 1.7, false)).toBe(flicker(ms, 1.7))
    }
  })
})

describe('la composition ne rouvre pas les défauts qu’elle frôle', () => {
  /**
   * ═══ LE PLAFOND DE LA SOURCE — la garde qui justifie « fais tout » ═══
   *
   * Le liseré (×2,8) a été calibré SEUL, sur une source qui ne battait pas. Composé, la même
   * source respire jusqu'à ~1,39 : le produit viserait 3,9 là où le calibrage d'origine a
   * mesuré qu'à ~3 « le sol pile autour saturait en aplat orange et les rondins étaient
   * écrasés par contraste ».
   *
   * On BALAIE le domaine plutôt que de tester trois points : c'est une inégalité entre deux
   * nombres, elle se prouve sur son domaine entier (règle `garde-exhaustive-plutot-que-cas`).
   */
  it('quoi qu’il arrive, l’intensité d’un feu reste sous son plafond', () => {
    const fautes: string[] = []
    for (const ax of [axesFeu(TOUT), axesFeu(4), axesFeu(1), axesFeu(0)]) {
      for (let day = 0; day <= 1; day += 0.05) {
        for (let engage = 0; engage <= 1; engage += 0.1) {
          const socle = (0.6 + 1.2 * (1 - day)) * (0.8 + 0.2 * engage)
          // Toute la course du battement asymétrique, marges comprises.
          for (let beat = 0.8; beat <= 1.45; beat += 0.01) {
            const i = intensiteDuFeu(day, engage, beat, ax)
            if (i > socle * PLAFOND_DU_FEU + 1e-9) {
              fautes.push(`jour ${day.toFixed(2)} engage ${engage.toFixed(1)} beat ${beat.toFixed(2)} → ${i.toFixed(3)} > ${(socle * PLAFOND_DU_FEU).toFixed(3)}`)
            }
          }
        }
      }
    }
    expect(fautes.slice(0, 5)).toEqual([])
  })

  /**
   * Et le plafond ne doit pas MANGER la proposition : s'il écrêtait déjà au repos, le liseré
   * n'existerait plus — on aurait « corrigé » le défaut en supprimant la feature.
   */
  it('au repos, le liseré composé passe SOUS le plafond — il sculpte encore', () => {
    const ax = axesFeu(TOUT)
    const socle = (0.6 + 1.2 * (1 - 0)) * 0.8 // minuit, village neutre
    const auRepos = intensiteDuFeu(0, 0, 1, ax)
    expect(auRepos).toBeLessThan(socle * PLAFOND_DU_FEU) // pas écrêté
    expect(auRepos).toBeGreaterThan(socle * 2) // et bien au-dessus de l'étalon
    expect(auRepos).toBeGreaterThan(intensiteDuFeu(0, 0, 1, axesFeu(0)) * 2)
  })

  /**
   * L'axe SEUL garde son calibrage d'origine — sans quoi la planche mentirait : les images du
   * banc ont été prises à ×2,8, et `__FEU__ = 4` doit toujours montrer ce qu'elles montrent.
   */
  it('isolé, le liseré garde le gain sur lequel il a été photographié', () => {
    const seul = intensiteDuFeu(0, 0, 1, axesFeu(4))
    const compose = intensiteDuFeu(0, 0, 1, axesFeu(TOUT))
    expect(seul).toBeGreaterThan(compose) // 2,8 contre 2,35 × la respiration au repos
  })
})
