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

/**
 * ═══ LE CAP DU DÉCOR (Alexis, 2026-08-25) ═══
 *
 * *« Les houppiers et autres végétaux reviennent à la position initiale d'un coup. »* La cause
 * était que le décor lisait le cap BRUT de la sim, qui avance par crans de 45°. Il lit désormais
 * `cap` — le même ressort que la brume, sans la force. Ces gardes affirment les deux propriétés
 * dont dépend l'absence de saut, et la troisième sans laquelle on aurait cassé les mondes muets.
 */
describe('le cap que le DÉCOR plie', () => {
  it('un cran de 45° ne bouge l’assiette que d’un degré par image, jamais d’un coup', () => {
    const v = new VentLisse()
    const EST = { x: 1, y: 0 }
    for (let i = 0; i < 400; i++) v.update(i * 16, 16, EST, 0.55)
    // ⚠ ON MESURE `wx` — LA COMPOSANTE HORIZONTALE, ET PAS L'ANGLE. C'est elle, et elle seule,
    //   qu'un billboard peut montrer (`windSway` : `BASE_LEAN × take × wx`) : un cap qui
    //   tournerait en douceur pendant que `wx` saute laisserait le défaut intact.
    const NORD_EST = { x: Math.SQRT1_2, y: -Math.SQRT1_2 }
    let precedent = v.cap.x
    let pireSaut = 0
    // 3 000 images = 48 s, soit douze demi-vies de 4 s : le résidu tombe sous 0,03 %. À 24 s il
    // en reste 1,6 %, et une garde de convergence y échouerait sur le MODÈLE, pas sur un défaut.
    for (let i = 0; i < 3000; i++) {
      v.update(i * 16, 16, NORD_EST, 0.55)
      pireSaut = Math.max(pireSaut, Math.abs(v.cap.x - precedent))
      precedent = v.cap.x
    }
    // Une image ne peut pas déplacer `wx` de plus de 1 % de sa plage. Le défaut d'origine valait
    // 1,0 d'un coup (est → nord : `wx` de 1 à 0) — soit cent fois ce plafond.
    expect(pireSaut, 'l’assiette a sauté d’une image à l’autre').toBeLessThan(0.01)
    expect(v.cap.x, 'et il a bien fini par rallier').toBeCloseTo(Math.SQRT1_2, 2)
  })

  it('un cap plein NORD ne redresse pas les tiges d’un coup — il les redresse en pente', () => {
    const v = new VentLisse()
    for (let i = 0; i < 400; i++) v.update(i * 16, 16, { x: 1, y: 0 }, 0.55)
    // Le pire cas du rapport : est → nord, `wx` passe de 1 à 0. C'est CE virage qu'Alexis a vu.
    const releves: number[] = []
    for (let i = 0; i < 3000; i++) {
      v.update(i * 16, 16, { x: 0, y: -1 }, 0.55)
      releves.push(v.cap.x)
    }
    expect(releves[0]!, 'la première image ne doit presque rien changer').toBeGreaterThan(0.99)
    expect(releves.at(-1)!, 'et il finit bien à plat').toBeLessThan(0.02)
    // La pente est MONOTONE : pas de retour en arrière, pas d'oscillation autour de zéro.
    for (let i = 1; i < releves.length; i++) expect(releves[i]!).toBeLessThanOrEqual(releves[i - 1]!)
  })

  it('la sentinelle du calme plat TRAVERSE — un monde sans vent n’a pas de tige qui plie', () => {
    const v = new VentLisse()
    for (let i = 0; i < 400; i++) v.update(i * 16, 16, { x: 1, y: 0 }, 0.55)
    // ⚠ CETTE GARDE EST LA CONTREPARTIE DE LA PRÉCÉDENTE. `cap` est unitaire par construction ;
    //   le rendre tel quel sous `wind = {0,0}` aurait fait plier les herbes d'un banc ou d'un
    //   hôte muet — un monde qui n'a PAS de vent (`vent.ts`), pas un monde dont le vent est
    //   faible. C'est le vecteur nul, et `windSway` s'y appuie pour ne rien faire bouger.
    v.update(0, 16, { x: 0, y: 0 }, 0)
    expect(v.cap).toEqual({ x: 0, y: 0 })
    // Et la brume, elle, garde son souffle : les deux sorties ne disent pas la même chose.
    const derive = v.update(16, 16, { x: 0, y: 0 }, 0)
    expect(Math.sqrt(derive.x ** 2 + derive.y ** 2)).toBeGreaterThan(0)
  })
})
