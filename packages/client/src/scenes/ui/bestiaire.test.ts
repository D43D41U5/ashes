import { describe, expect, it } from 'vitest'
import { FISH_SPECIES, ZONES } from '@ashes/sim'
import {
  BEST_COLS,
  CLASSES_DE_PRISE,
  NOM_INCONNU,
  RECORD_VIDE,
  rangeesDuBestiaire,
  sommeDuBestiaire,
  type CaseBestiaire,
} from './bestiaire'

const toutesLesCases = (carnet: Parameters<typeof rangeesDuBestiaire>[0]): CaseBestiaire[] =>
  rangeesDuBestiaire(carnet).flatMap((r) => r.cases)

/**
 * LES CHAÎNES QUE LA CASE MUETTE NE DOIT JAMAIS PORTER, pour une espèce donnée.
 *
 * On les DÉRIVE de la ligne de table plutôt que de les écrire : une espèce qui gagnerait demain
 * un champ révélateur serait couverte le jour où il entre dans la fiche, et un champ renommé ne
 * laisserait pas ce test vert par oubli.
 *
 * ⚠ LA CLASSE N'EN EST PAS. Elle est révélée EXPRÈS : le bestiaire se range en trois rangées
 * nommées, donc une case muette avoue sa classe par sa POSITION, et le rendu a besoin du champ
 * pour la ranger. C'est le seul fait qu'une espèce jamais prise laisse filtrer — arbitrage
 * d'Alexis du 2026-08-24, pris en connaissance de cause (la grille à plat ne le révélait pas).
 */
function cequiTrahit(sp: (typeof FISH_SPECIES)[number]): string[] {
  return [
    sp.label,
    ...sp.eaux,
    ...(sp.zones ?? []).map((z) => ZONES.find((zz) => zz.slug === z)?.nom ?? z),
    ...(sp.creneaux ?? []),
    String(Math.round(sp.tailleMinMm / 10)),
    String(Math.round(sp.tailleMaxMm / 10)),
  ].filter((s) => s.length > 1) // « 6 cm » : un nombre d'un chiffre croiserait n'importe quoi
}

describe('le bestiaire — une espèce jamais prise ne dit rien (décision 2026-08-24)', () => {
  it('carnet VIDE : les 18 cases sont muettes, sans fiche, sans icône, sans nom', () => {
    const cases = toutesLesCases([])
    expect(cases).toHaveLength(FISH_SPECIES.length)
    for (const c of cases) {
      expect(c.fiche, 'une case jamais prise porte une fiche').toBeNull()
      expect(c.icone, 'une case jamais prise porte une icône').toBeNull()
      expect(c.id, 'une case jamais prise porte encore son id').toBeNull()
      expect(c.nom).toBe(NOM_INCONNU)
      expect(c.record).toBe(RECORD_VIDE)
      expect(c.prises).toBe('')
      expect(c.coinSeul, 'une case jamais prise avoue son coin de pêche').toBe(false)
    }
  })

  /** LA GARDE EXHAUSTIVE : on sérialise la case entière et on y cherche tout ce que la table
   *  déclare de cette espèce. C'est la seule forme qui résiste à un champ ajouté sans y penser. */
  it('carnet VIDE : rien de ce que la table déclare ne fuit dans la case, espèce par espèce', () => {
    for (const rangee of rangeesDuBestiaire([])) {
      // Une case muette n'a plus d'id : on l'apparie par POSITION. Les rangées suivent l'ordre
      // de `FISH_SPECIES` filtré par classe, donc l'appariement est déterministe.
      const especes = FISH_SPECIES.filter((sp) => sp.classe === rangee.classe)
      expect(rangee.cases).toHaveLength(especes.length)
      especes.forEach((sp, i) => {
        const rendu = JSON.stringify(rangee.cases[i]).toLowerCase()
        for (const secret of cequiTrahit(sp)) {
          expect(rendu, `« ${secret} » fuite dans la case muette de ${sp.id}`).not.toContain(secret.toLowerCase())
        }
      })
    }
  })

  it('une espèce PRISE porte sa fiche complète, et elle seule', () => {
    const truite = FISH_SPECIES.find((sp) => sp.id === 'trout')!
    const cases = new Map(toutesLesCases([{ sp: 'trout', mm: 423, prises: 9 }]).map((c) => [c.id, c]))
    const prise = cases.get('trout')!
    expect(prise.fiche).not.toBeNull()
    expect(prise.nom).toBe('Truite')
    expect(prise.record).toBe('42,3 cm')
    expect(prise.prises).toBe('×9')
    expect(prise.icone).toBe('trout')
    expect(prise.fiche!.conditions.map(([k]) => k)).toEqual(['eau', 'saison', 'heure', 'pays'])
    expect(prise.fiche!.taille).toBe(
      `${Math.round(truite.tailleMinMm / 10)} – ${Math.round(truite.tailleMaxMm / 10)} cm`,
    )
    // Toutes les AUTRES restent muettes : une prise n'en révèle pas une deuxième.
    for (const [id, c] of cases) if (id !== 'trout') expect(c.fiche, `${id} a parlé`).toBeNull()
  })

  it('le ◈ coin de pêche ne se montre QUE sur une espèce prise qui le porte', () => {
    const coinSeules = FISH_SPECIES.filter((sp) => sp.coinSeul === true)
    expect(coinSeules.length, 'plus aucune espèce n’exige un coin : la garde ne garde plus rien').toBeGreaterThan(0)
    expect(toutesLesCases([]).every((c) => c.coinSeul === false)).toBe(true)
    for (const sp of coinSeules) {
      const prise = toutesLesCases([{ sp: sp.id, mm: sp.tailleMaxMm, prises: 1 }]).find((c) => c.id === sp.id)!
      expect(prise.coinSeul).toBe(true)
      expect(prise.fiche!.coinSeul).toBe(true)
    }
  })
})

describe('le bestiaire — la grille et son compteur', () => {
  it('chaque espèce de la table tombe dans la rangée de sa classe, une seule fois', () => {
    const rangees = rangeesDuBestiaire([])
    expect(rangees.map((r) => r.classe)).toEqual(CLASSES_DE_PRISE.map((c) => c.classe))
    for (const r of rangees) {
      for (const c of r.cases) expect(c.classe).toBe(r.classe)
    }
    const ids = rangeesDuBestiaire(FISH_SPECIES.map((sp) => ({ sp: sp.id, mm: sp.tailleMinMm, prises: 1 })))
      .flatMap((r) => r.cases.map((c) => c.id))
    expect(new Set(ids).size).toBe(FISH_SPECIES.length)
    expect([...ids].sort()).toEqual(FISH_SPECIES.map((sp) => sp.id).sort())
  })

  /** La largeur est DÉRIVÉE : elle doit tenir la rangée la plus peuplée, sinon la grille déborde. */
  it('BEST_COLS tient la classe la plus peuplée', () => {
    for (const r of rangeesDuBestiaire([])) expect(r.cases.length).toBeLessThanOrEqual(BEST_COLS)
    expect(rangeesDuBestiaire([]).some((r) => r.cases.length === BEST_COLS)).toBe(true)
  })

  it('le compteur dit les espèces connues et le total des prises', () => {
    expect(sommeDuBestiaire([])).toBe(`0 / ${FISH_SPECIES.length} espèces · 0 prise`)
    expect(
      sommeDuBestiaire([
        { sp: 'trout', mm: 423, prises: 9 },
        { sp: 'pike', mm: 874, prises: 2 },
      ]),
    ).toBe(`2 / ${FISH_SPECIES.length} espèces · 11 prises`)
  })
})
