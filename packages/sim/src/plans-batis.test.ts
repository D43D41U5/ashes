/**
 * LA GARDE DU GÉNÉRÉ (spec `atelier-plans.md` A1-A3) : les `.plan` sont LA source — si
 * quelqu'un en édite un sans régénérer (`pnpm plans`), le module importé ment, et cette
 * garde rougit. Le reparse passe par le MÊME parseur que le compilateur et l'Atelier :
 * une seule grammaire, lue trois fois.
 */
import { describe, expect, it } from 'vitest'
import { BUILT_KINDS, LEGENDE, PLANS } from './poi-batis'
import { CLES, parserPlan, serialiserPlan } from './plan-format'

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

  it('refuse les doublons, la clé après la grille et le nombre déguisé (revue 2026-08-10)', () => {
    // Un doublon avalé gagnait sans bruit ; deux blocs grille se CONCATÉNAIENT.
    expect(() => parserPlan('usure: 0.5\nusure: 0.9\ngrille:\n··\n··')).toThrowError(/deux fois/)
    expect(() => parserPlan('usure: 0.5\ngrille:\n··\ngrille:\n··')).toThrowError(/deux fois|après la grille/)
    // La grammaire dit « grille en dernier » — le parseur le fait respecter, plus seulement le dire.
    expect(() => parserPlan('usure: 0.5\ngrille:\n··\n··\nfixe: oui')).toThrowError(/après la grille/)
    // « grille: » ne porte pas de valeur, et Number n'avale plus l'hexa.
    expect(() => parserPlan('usure: 0.5\ngrille: POUBELLE\n··\n··')).toThrowError(/valeur/)
    expect(() => parserPlan('usure: 0x1\ngrille:\n··\n··')).toThrowError(/décimal/)
  })

  it('« # » n’entre jamais en légende : une rangée qui commence par lui disparaît au parse', () => {
    // parserPlan traite « # » en tête de ligne comme de la PROSE — même au milieu de la
    // grille. S'il devenait un caractère de légende, la première rangée qui commencerait par
    // lui partirait en silence, et verifierPlan ne verrait qu'un plan trop court.
    expect(Object.keys(LEGENDE)).not.toContain('#')
    expect(parserPlan('usure: 1\ngrille:\n#·\n··').grille).toEqual(['··'])
  })

  it('aucune CLÉ n’est épelable avec la légende : une rangée ne peut pas passer pour une métadonnée', () => {
    // L'invariant que le parseur suppose (« motminuscule: » n'est jamais une rangée) se GARDE :
    // si un jour la légende gagne les minuscules d'une clé (le « f » de fixe…), ce test rougit
    // avant que le premier plan ne perde une rangée en silence.
    const minuscules = new Set(Object.keys(LEGENDE).filter((c) => /^[a-z]$/.test(c)))
    for (const cle of CLES) {
      expect([...cle].some((c) => !minuscules.has(c)), `« ${cle} » est épelable en légende`).toBe(true)
    }
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
