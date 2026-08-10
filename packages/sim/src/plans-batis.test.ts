/**
 * LA GARDE DU GÉNÉRÉ (spec `atelier-plans.md` A1-A3) : les `.plan` sont LA source — si
 * quelqu'un en édite un sans régénérer (`pnpm plans`), le module importé ment, et cette
 * garde rougit. Le reparse passe par le MÊME parseur que le compilateur et l'Atelier :
 * une seule grammaire, lue trois fois.
 */
import { describe, expect, it } from 'vitest'
import { BUILT_KINDS, PLANS } from './poi-batis'
import { parserPlan, serialiserPlan } from './plan-format'

const SOURCES = import.meta.glob('./plans/*.plan', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('plans-batis.genere', () => {
  it('est À JOUR : chaque .plan reparsé ≡ le module importé, ni plus ni moins', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(0) // la garde prouve sa prémisse
    const attendu: Record<string, unknown> = {}
    for (const [chemin, texte] of Object.entries(SOURCES)) {
      const kind = chemin.replace('./plans/', '').replace('.plan', '')
      attendu[kind] = parserPlan(texte)
    }
    expect(PLANS).toEqual(attendu)
    expect([...BUILT_KINDS].sort()).toEqual(Object.keys(attendu).sort())
  })

  it('round-trip chirurgical : sérialiser sans rien changer préserve données ET prose', () => {
    for (const [chemin, texte] of Object.entries(SOURCES)) {
      const plan = parserPlan(texte)
      const reecrit = serialiserPlan(texte, plan)
      expect(parserPlan(reecrit), chemin).toEqual(plan)
      // Les commentaires survivent : mêmes lignes #, dans le même ordre.
      const proses = (t: string): string[] => t.split('\n').filter((l) => l.trimStart().startsWith('#'))
      expect(proses(reecrit), chemin).toEqual(proses(texte))
    }
  })
})

describe('parserPlan — les fautes parlent, jamais un silence', () => {
  it('refuse l’usure absente, le triplet malformé et la clé inconnue', () => {
    expect(() => parserPlan('grille:\n··\n··')).toThrowError(/usure/)
    expect(() => parserPlan('usure: 0.5\nbreches: 1;2;S\ngrille:\n··\n··')).toThrowError(/triplet/)
    expect(() => parserPlan('usure: 0.5\nportes: 1,1,N\ngrille:\n··\n··')).toThrowError(/clé inconnue/)
    expect(() => parserPlan('usure: 2\ngrille:\n··\n··')).toThrowError(/usure/)
    expect(() => parserPlan('usure: 0.5')).toThrowError(/grille/)
  })

  it('une donnée retirée disparaît du fichier, une nouvelle s’insère avant la grille', () => {
    const texte = '# prose\nusure: 0.5\nseuils: 1,1,S\ngrille:\n··\n··'
    const sans = serialiserPlan(texte, { usure: 0.5, grille: ['··', '··'] })
    expect(sans).not.toContain('seuils')
    expect(sans).toContain('# prose')
    const avec = serialiserPlan(texte, { usure: 0.5, grille: ['··', '··'], breches: ['0,0,N'], fixe: true })
    expect(parserPlan(avec)).toEqual({ usure: 0.5, grille: ['··', '··'], breches: ['0,0,N'], fixe: true })
  })
})
