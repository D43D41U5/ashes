/**
 * LA FICHE MÉTIER NE DOIT JAMAIS MENTIR. Ce test verrouille l'accord entre les paliers
 * AFFICHÉS et le COMPORTEMENT du sim : chaque seuil de niveau annoncé est le seuil RÉEL
 * (le cran d'avant ne l'a pas, le cran annoncé l'a). Il garde aussi la non-uniformité des
 * quatre métiers — le piège que l'advisor a levé : l'échelle d'outil est inerte pour le
 * Cueilleur et absente pour l'Artisan ; l'afficher là serait un mensonge.
 */
import { describe, expect, it } from 'vitest'
import {
  BALANCE,
  TOOL_RANK,
  fellGreenWidth,
  maxTierByLevel,
  mineTolerance,
  type ToolTier,
} from '@braises/sim'
import {
  craftSpeedLevel,
  fellAutopilotLevel,
  mineToleranceLevel,
  skillGuideOf,
  skillGuides,
  tierUncapLevel,
} from './skill-guide'

/** À `level`, un outil de ce palier rend-il à plein (n'est-il plus rabattu) ? */
const uncapped = (tier: ToolTier, level: number): boolean =>
  TOOL_RANK[maxTierByLevel(level)] >= TOOL_RANK[tier]

describe('les seuils dérivés collent au comportement du sim', () => {
  it('tierUncapLevel EST le seuil exact de maxTierByLevel', () => {
    for (const tier of ['basic', 'iron', 'steel'] as ToolTier[]) {
      const L = tierUncapLevel(tier)
      expect(Number.isFinite(L)).toBe(true)
      expect(uncapped(tier, L)).toBe(true)
      if (L > 0) expect(uncapped(tier, L - 1)).toBe(false)
    }
  })

  it('fellAutopilotLevel EST le premier niveau à largeur de vert MAX', () => {
    const L = fellAutopilotLevel()
    const max = fellGreenWidth(1024)
    expect(fellGreenWidth(L)).toBe(max)
    if (L > 0) expect(fellGreenWidth(L - 1)).toBeLessThan(max)
  })

  it('mineToleranceLevel EST le seuil exact de mineTolerance', () => {
    for (const target of [1, 2] as const) {
      const L = mineToleranceLevel(target)
      expect(mineTolerance(L)).toBeGreaterThanOrEqual(target)
      if (L > 0) expect(mineTolerance(L - 1)).toBeLessThan(target)
    }
  })

  it('les paliers de cueillette pointent les vrais niveaux de l\'échelle (semences, qualité)', () => {
    const levels = skillGuideOf('foraging').paliers.map((p) => p.level)
    expect(levels).toEqual([BALANCE.FORAGE_SEED_LEVEL, BALANCE.FORAGE_QUALITY_LEVEL])
  })

  it('craftSpeedLevel(2) double bien le débit', () => {
    const L = craftSpeedLevel(2)
    expect(1 + BALANCE.CRAFT_SPEED_BONUS * L).toBeGreaterThanOrEqual(2)
    expect(1 + BALANCE.CRAFT_SPEED_BONUS * (L - 1)).toBeLessThan(2)
  })
})

describe('chaque fiche dit la vérité de SON métier', () => {
  it('tous les paliers ont un niveau fini et sont triés', () => {
    for (const g of skillGuides()) {
      const levels = g.paliers.map((p) => p.level)
      for (const l of levels) expect(Number.isFinite(l)).toBe(true)
      expect(levels).toEqual([...levels].sort((a, b) => a - b))
    }
  })

  it('Bûcheron et Mineur portent bien les trois paliers d\'outil, au bon niveau', () => {
    for (const id of ['woodcutting', 'mining'] as const) {
      const paliers = skillGuideOf(id).paliers
      for (const tier of ['basic', 'iron', 'steel'] as ToolTier[]) {
        const hit = paliers.find((p) => p.level === tierUncapLevel(tier))
        expect(hit, `${id} doit annoncer le palier ${tier}`).toBeDefined()
      }
    }
  })

  it('les libellés d\'outil tiennent à la BONNE famille (pas d\'inversion hache↔pioche)', () => {
    // Le test des NIVEAUX ne verrouille pas le TEXTE : intervertir « hache » et « pioche » entre
    // les deux fiches passerait inaperçu. On l'attrape ici — le Bûcheron parle hache, jamais pioche.
    const woodPaliers = skillGuideOf('woodcutting').paliers.map((p) => p.text).join(' ').toLowerCase()
    expect(woodPaliers).toContain('hache')
    expect(woodPaliers).not.toContain('pioche')
    const minePaliers = skillGuideOf('mining').paliers.map((p) => p.text).join(' ').toLowerCase()
    expect(minePaliers).toContain('pioche')
    expect(minePaliers).not.toContain('hache')
  })

  it('Bûcheron annonce le vert au max, Mineur les deux crans de tolérance', () => {
    const wood = skillGuideOf('woodcutting').paliers
    expect(wood.some((p) => p.level === fellAutopilotLevel())).toBe(true)
    const mine = skillGuideOf('mining').paliers
    expect(mine.some((p) => p.level === mineToleranceLevel(1))).toBe(true)
    expect(mine.some((p) => p.level === mineToleranceLevel(2))).toBe(true)
  })

  it('Cueilleur : échelle de PRODUIT (semences, qualité), aucune échelle d\'outil (elle est inerte)', () => {
    const g = skillGuideOf('foraging')
    expect(g.paliers).toHaveLength(2)
    expect(g.paliers.map((p) => p.level)).toEqual([BALANCE.FORAGE_SEED_LEVEL, BALANCE.FORAGE_QUALITY_LEVEL])
    const texte = (g.paliers.map((p) => p.text).join(' ') + ' ' + g.passifs.join(' ')).toLowerCase()
    for (const mot of ['atelier', 'fer', 'acier', 'rend à plein']) {
      expect(texte, `le Cueilleur ne doit pas parler d'outil : "${mot}"`).not.toContain(mot)
    }
  })

  it('Artisan : aucun palier net (une pente), et aucune note d\'outil', () => {
    const g = skillGuideOf('crafting')
    expect(g.paliers).toHaveLength(0)
    expect(g.outilNote).toBeNull()
    expect(g.passifs.length).toBeGreaterThan(0)
  })
})
