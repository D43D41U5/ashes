/**
 * A9 (`vent.md`) — LE CLIENT LIT, IL N'INVENTE PAS.
 *
 * `VentLisse` a longtemps FABRIQUÉ la force du vent (deux battements lents), faute que la sim
 * en publie une. Depuis l'unification, elle en publie une — et la garde ci-dessous existe pour
 * qu'on ne réinvente jamais la prothèse par-dessus : une seconde loi côté client aurait divergé
 * au premier calibrage.
 */

import { describe, expect, it } from 'vitest'
import { VentLisse } from './vent-lisse'

/** Rallie le cap jusqu'à convergence, puis rend la norme du vecteur — la FORCE rendue. */
function normeApresRalliement(forceSim: number | undefined, nowMs = 0): number {
  const v = new VentLisse()
  let out = { x: 0, y: 0 }
  for (let i = 0; i < 400; i++) out = v.update(nowMs, 16, { x: 1, y: 0 }, forceSim)
  return Math.sqrt(out.x * out.x + out.y * out.y)
}

describe('A9 — la force vient de la sim', () => {
  it('une force constante ressort constante (au battement de respiration près)', () => {
    // Le même instant pour les deux mesures : la respiration est fonction du temps, donc elle
    // se simplifie dans le RAPPORT. Ce qu'on affirme, c'est la proportionnalité — pas la valeur.
    const basse = normeApresRalliement(0.55)
    const haute = normeApresRalliement(1)
    expect(haute / basse).toBeCloseTo(1 / 0.55, 3)
  })

  it('elle SUIT la sim quand le front monte — le client ne la plafonne pas à l’ambiance', () => {
    let precedent = 0
    for (const f of [0.55, 0.7, 0.85, 1]) {
      const n = normeApresRalliement(f)
      expect(n, `force ${f}`).toBeGreaterThan(precedent)
      precedent = n
    }
  })

  it('le vecteur n’est JAMAIS nul — pas même sous la sentinelle du calme plat', () => {
    // La sim rend 0 quand l'hôte a coupé le vent (`wind = {0,0}`). Une brume immobile est une
    // image plate : le rendu garde un souffle minimal, et c'est un choix de RENDU assumé —
    // aucune règle de jeu ne se branche ici.
    expect(normeApresRalliement(0)).toBeGreaterThan(0)
    expect(normeApresRalliement(undefined)).toBeGreaterThan(0)
  })

  it('le cap se rallie en douceur : jamais un saut, même sur un demi-tour parfait', () => {
    const v = new VentLisse()
    for (let i = 0; i < 400; i++) v.update(0, 16, { x: 1, y: 0 }, 0.55)
    // Demi-tour EXACT — le cas où un lerp renormalisé ne tourne pas, il se reprojette.
    let precedent = v.update(0, 16, { x: -1, y: 0 }, 0.55)
    let pireEcart = 0
    // 1 500 frames = 24 s : la demi-vie du ralliement est de 4 s (95 % du virage en ~17 s).
    for (let i = 0; i < 1500; i++) {
      const cur = v.update(i * 16, 16, { x: -1, y: 0 }, 0.55)
      const na = Math.sqrt(precedent.x ** 2 + precedent.y ** 2)
      const nb = Math.sqrt(cur.x ** 2 + cur.y ** 2)
      expect(na, 'jamais un vecteur nul pendant le demi-tour').toBeGreaterThan(0.1)
      const cos = (precedent.x * cur.x + precedent.y * cur.y) / (na * nb)
      pireEcart = Math.max(pireEcart, Math.acos(Math.min(1, Math.max(-1, cos))))
      precedent = cur
    }
    // Un demi-tour qui TOURNE, en arc, sans jamais franchir plus de quelques degrés par frame.
    expect(pireEcart).toBeLessThan(0.1) // < ~6° par frame
    const fin = v.update(0, 16, { x: -1, y: 0 }, 0.55)
    expect(fin.x).toBeLessThan(0) // il a bien fini par se retourner
  })
})
