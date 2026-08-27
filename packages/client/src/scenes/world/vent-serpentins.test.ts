/**
 * LES SERPENTINS (spec `vent.md` V9) — ce qui les empêche de devenir du bruit.
 *
 * La règle centrale n'est pas « qu'ils soient jolis », c'est qu'ils soient RARES : un présage
 * qui sort tout le temps n'annonce plus rien. Ces gardes tiennent les deux bouts du domaine
 * (calme plat / cœur de bande) et la pente entre les deux.
 */

import { describe, expect, it } from 'vitest'
import type { Vue } from './meteo-particules'
import type { Serpentin } from './vent-serpentins'
import { alphaDuSerpentin, BUDGET_SERPENTINS, ChampSerpentins, positionSerpentin } from './vent-serpentins'

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
    // ⚠ LA FENÊTRE DOIT PASSER LA PLUS LONGUE DES VIES — la cible à zéro ne TUE personne, elle
    // cesse seulement de semer. La vie est taillée sur la traversée du cadre (plusieurs
    // secondes) : une fenêtre de 3 s accusait le champ de ne pas se vider alors qu'il se vidait.
    for (let i = 0; i < 500; i++) champ.update(1 / 60, VUE, EST, 0)
    expect(peuple).toBeGreaterThan(0)
    expect(champ.vivants).toBe(0)
  })
})

/** L'écart d'un ruban à sa propre ligne de translation, à l'âge τ — c'est SA VRILLE, isolée. */
function ecartAuCap(s: Serpentin, tau: number): number {
  const p = { x: 0, y: 0 }
  positionSerpentin(s, tau, p)
  const dx = p.x - (s.x0 + s.vx * tau)
  const dy = p.y - (s.y0 + s.vy * tau)
  return Math.sqrt(dx * dx + dy * dy)
}

/** Un ruban vivant, pris dans un champ joué — jamais fabriqué à la main : un montage à la main
 *  ne prouverait que le montage (le banc peut fabriquer la prémisse qu'il a perdue). */
function unRuban(images = 200): Serpentin {
  const champ = new ChampSerpentins()
  for (let i = 0; i < images; i++) champ.update(1 / 60, VUE, EST, 1)
  const s = champ.serpentins.find((r) => r.vie > 0.5)
  expect(s, 'aucun ruban vivant à interroger').toBeDefined()
  return s!
}

describe('le tourbillon — le tracé retenu sur planche (2026-08-25)', () => {
  it('LA TRAÎNÉE EST UN PASSÉ : la tête à l’âge courant est bien celle que le champ a posée', () => {
    // C'est ce qui autorise la couche à peindre « où était la tête il y a un huitième de
    // seconde » sans garder d'historique. Si la position était intégrée, elle ne se remonterait
    // pas — et la traînée dériverait de la tête sans que rien ne le signale.
    const s = unRuban()
    const p = { x: 0, y: 0 }
    positionSerpentin(s, s.vie, p)
    expect(p.x).toBeCloseTo(s.x, 9)
    expect(p.y).toBeCloseTo(s.y, 9)
  })

  it('elle se peint d’un trait : deux points voisins ne sautent JAMAIS une cellule', () => {
    // Sous-échantillonnée, une vrille se peint en pointillés. On balaye toute la traînée au pas
    // du rendu (3 points par cellule de 2 px, soit 24 par tuile) et on affirme la continuité.
    const s = unRuban()
    const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy)
    const span = Math.min(s.vie, s.longueur / v)
    const n = 24 * s.longueur
    const a = { x: 0, y: 0 }
    const b = { x: 0, y: 0 }
    for (let k = 1; k <= n; k++) {
      positionSerpentin(s, s.vie - ((k - 1) / n) * span, a)
      positionSerpentin(s, s.vie - (k / n) * span, b)
      const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
      expect(d, `saut de ${d.toFixed(3)} tuile au point ${k}`).toBeLessThan(2 / 16)
    }
  })

  it('la vrille s’ouvre et se referme UNE seule fois, et jamais aux deux bouts de la vie', () => {
    // La promesse du tracé : « droit, puis il vrille, puis droit ». Balayée sur toute la vie,
    // pas échantillonnée à trois points — c'est une forme, elle se prouve sur son domaine.
    const s = unRuban()
    const PAS = 400
    const ecarts: number[] = []
    for (let k = 0; k <= PAS; k++) ecarts.push(ecartAuCap(s, (k / PAS) * s.duree))
    expect(ecarts[0]).toBeCloseTo(0, 6)
    expect(ecarts[PAS]).toBeCloseTo(0, 6)
    const pic = Math.max(...ecarts)
    // Elle se VOIT (plus d'un tiers de tuile) sans emporter le ruban loin de son cap.
    expect(pic).toBeGreaterThan(1 / 3)
    expect(pic).toBeLessThan(1)
    // UNE bosse : l'écart monte jusqu'au pic, puis redescend. Deux vrilles se liraient comme
    // deux rubans, et le tracé ne serait plus celui qu'on a choisi.
    const iPic = ecarts.indexOf(pic)
    for (let k = 1; k <= iPic; k++) expect(ecarts[k]!).toBeGreaterThanOrEqual(ecarts[k - 1]! - 1e-9)
    for (let k = iPic + 1; k <= PAS; k++) expect(ecarts[k]!).toBeLessThanOrEqual(ecarts[k - 1]! + 1e-9)
  })

  it('la CADENCE de la vrille ne dépend pas de la durée de vie tirée', () => {
    // Le découplage est le sujet : la vie se règle pour peupler le cadre (voir la garde de
    // couverture), la vrille pour le look. Écrite en part de la vie, allonger l'une ralentissait
    // l'autre — et « corriger l'écran vide » aurait défait le tracé validé à l'œil.
    const champ = new ChampSerpentins()
    for (let i = 0; i < 300; i++) champ.update(1 / 60, VUE, EST, 1)
    const vivants = champ.serpentins.filter((s) => s.vie >= 0)
    const durees = new Set(vivants.map((s) => Math.round(s.duree * 100)))
    expect(durees.size, 'les rubans ont tous la même durée : la garde ne prouve rien').toBeGreaterThan(1)
    for (const s of vivants) expect(s.omega).toBeCloseTo(vivants[0]!.omega, 9)
  })
})

describe('la couverture du cadre — « moins, mais sur tout l’écran »', () => {
  it('aucun sixième du cadre ne reste vide, dans l’axe du vent comme par le travers', () => {
    // LE DÉFAUT QU'ELLE GARDE : un ruban qui meurt de vieillesse avant d'avoir traversé laisse
    // l'aval du cadre vide, et le vent ne souffle que d'un côté de l'écran. Il ne se voit sur
    // aucune autre garde — le troupeau est plein, `vivants` le confirme, et l'écran est vide.
    // On pèse chaque relevé par son ALPHA : ce qu'on garde est ce qui SE VOIT, pas ce qui existe.
    const champ = new ChampSerpentins()
    const colonnes = new Array(6).fill(0)
    const lignes = new Array(6).fill(0)
    let total = 0
    for (let i = 0; i < 3000; i++) {
      champ.update(1 / 60, VUE, EST, 1)
      for (const s of champ.serpentins) {
        if (s.vie < 0 || s.x < VUE.x0 || s.x > VUE.x1 || s.y < VUE.y0 || s.y > VUE.y1) continue
        const a = alphaDuSerpentin(s.vie, s.duree)
        colonnes[Math.min(5, Math.floor(((s.x - VUE.x0) / (VUE.x1 - VUE.x0)) * 6))] += a
        lignes[Math.min(5, Math.floor(((s.y - VUE.y0) / (VUE.y1 - VUE.y0)) * 6))] += a
        total += a
      }
    }
    expect(total).toBeGreaterThan(0)
    // Un sixième parfaitement réparti pèserait 16,7 %. On exige la MOITIÉ de rien : 5 %.
    // La forme réelle est une cloche (le fuseau d'alpha culmine à mi-vie, donc au milieu du
    // cadre) — c'est voulu : le présage est le plus net là où le joueur regarde.
    for (let k = 0; k < 6; k++) {
      expect((colonnes[k] / total) * 100, `colonne ${k}`).toBeGreaterThan(5)
      expect((lignes[k] / total) * 100, `ligne ${k}`).toBeGreaterThan(5)
    }
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
