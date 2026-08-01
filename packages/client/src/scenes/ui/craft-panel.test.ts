import { RECIPES, type RecipeId } from '@ashes/sim'
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  RECIPE_CATEGORY,
  costLine,
  craftRows,
  etatRecette,
  fonctionsAbsentes,
  lieuPermet,
} from './craft-panel'
import type { CapacitesEnPortee } from '../../hud-state'

/**
 * CE QUE LE PANNEAU MONTRE est une décision, pas un dessin : elle se prouve ici.
 *
 * ⚠ LA RÈGLE A CHANGÉ LE 2026-08-01 (D2, décision d'Alexis). Avant : « une recette de four
 * sans four à portée n'est pas grisée, elle n'est PAS LÀ » — le panneau était une lecture
 * du LIEU. Excellente à 33 recettes, cette règle empêchait à 200 de savoir que le contenu
 * existe, ni ce qu'il faut bâtir pour y accéder.
 *
 * Depuis, c'est la DÉCOUVERTE qui décide de l'apparition : on voit ce qu'on a rencontré —
 * en touchant sa matière, ou en approchant la station qui la sert (`decouverte.ts`) — et
 * ce qu'on a vu une fois GARDE sa ligne, grisée, avec sa raison. Le lieu ne cache plus
 * rien ; il décide seulement de l'ÉTAT.
 */
const ids = (rows: ReturnType<typeof craftRows>): RecipeId[] =>
  rows.flatMap((r) => (r.kind === 'recipe' ? [r.id] : []))
const headers = (rows: ReturnType<typeof craftRows>): string[] =>
  rows.flatMap((r) => (r.kind === 'header' ? [r.label] : []))

const TOUT = Object.keys(RECIPES) as RecipeId[]

describe('le panneau d’artisanat : ce qu’il montre', () => {
  it('LA DÉCOUVERTE : on ne voit RIEN tant qu’on n’a rien rencontré', () => {
    expect(craftRows([], '')).toEqual([])
  })

  it('LA DÉCOUVERTE : on voit ce qu’on a rencontré, et seulement ça', () => {
    const shown = ids(craftRows(['rope', 'axe'], ''))
    expect(shown).toHaveLength(2)
    expect(shown).toContain('rope')
    expect(shown).toContain('axe')
    expect(shown).not.toContain('stew')
  })

  it('LE LIEU NE CACHE PLUS : il décide de l’ÉTAT, et le dit', () => {
    // La hache est connue mais l'atelier est loin : la ligne RESTE, verrouillée, et elle
    // nomme ce qui manque. C'est cette phrase-là qui donne une raison de bâtir l'atelier.
    expect(ids(craftRows(['axe'], ''))).toEqual(['axe'])
    expect(etatRecette({}, true, 'axe')).toEqual({ etat: 'verrouille', raison: 'un Atelier N1' })
    // L'atelier à portée, les matériaux en poche : faisable.
    expect(etatRecette({ atelier: 1 }, true, 'axe')).toEqual({ etat: 'faisable' })
    // L'atelier là, la bourse vide : « manque » — hors de portée de bourse, pas de lieu.
    expect(etatRecette({ atelier: 1 }, false, 'axe')).toEqual({ etat: 'manque' })
    // À la main : jamais verrouillée, où qu'on soit (spec craft-fortune C1).
    expect(etatRecette({}, true, 'rope')).toEqual({ etat: 'faisable' })
  })

  it('UN PALIER SUPÉRIEUR SERT LES INFÉRIEURS — un atelier lourd sait ce que sait un établi', () => {
    // Conséquence voulue du passage à l'EXIGENCE (2026-08-01) : la recette demande « un
    // Atelier N1 », pas l'objet `workshop`. Avant, un atelier lourd posé seul ne servait
    // AUCUNE recette d'établi — un rang 3 inutile pour un travail de rang 1.
    expect(etatRecette({ atelier: 3 }, true, 'axe').etat).toBe('faisable')
    expect(etatRecette({ atelier: 3 }, true, 'steel_axe').etat).toBe('faisable')
    expect(etatRecette({ atelier: 1 }, true, 'steel_axe').etat).toBe('verrouille')
  })

  it('LES RAYONS : groupés, en-têtes visibles, aucun rayon vide', () => {
    const rows = craftRows(TOUT, '')
    const hs = headers(rows)
    expect(hs.length).toBeGreaterThan(1)
    expect(new Set(hs).size).toBe(hs.length) // pas de rayon en double
    // Chaque en-tête est SUIVI d'au moins un article — un rayon sans article est du bruit.
    rows.forEach((r, i) => {
      if (r.kind === 'header') expect(rows[i + 1]?.kind).toBe('recipe')
    })
    // L'ordre des rayons suit CATEGORY_ORDER, sans exception.
    expect(hs).toEqual(CATEGORY_ORDER.map((c) => CATEGORY_LABEL[c]).filter((l) => hs.includes(l)))
  })

  it('LA RECHERCHE : filtre sur le nom, sans accents ni casse', () => {
    expect(ids(craftRows(TOUT, 'corde'))).toEqual(['rope'])
    expect(ids(craftRows(TOUT, 'CORDE'))).toEqual(['rope']) // la casse ne compte pas
    expect(ids(craftRows(TOUT, 'epieu'))).toEqual(['crude_spear']) // « Épieu taillé » sans accent
    expect(ids(craftRows(TOUT, 'pioche')).length).toBeGreaterThan(1)
    // Une recherche qui ne trouve rien ne laisse AUCUN en-tête orphelin.
    expect(craftRows(TOUT, 'zzz')).toEqual([])
  })

  it('LA RECHERCHE se combine à la DÉCOUVERTE : on ne trouve pas ce qu’on ignore', () => {
    // Le hachereau est connu, la vraie hache non : chercher « hache » ne sort que le
    // premier. La recherche ne fait pas apparaître ce que le joueur n'a jamais croisé.
    expect(ids(craftRows(['crude_axe'], 'hache'))).toEqual(['crude_axe'])
    const lesDeux = ids(craftRows(['crude_axe', 'axe'], 'hache'))
    expect(lesDeux).toContain('crude_axe')
    expect(lesDeux).toContain('axe')
  })

  it('LES FONCTIONS ABSENTES se DÉRIVENT — le four d’acier peut enfin être annoncé', () => {
    // La note de l'écran perso lisait une liste de trois entrées quand la sim en comptait
    // cinq : le four d'acier et l'atelier lourd ne pouvaient PAS être annoncés absents.
    const fonctions = fonctionsAbsentes({}).map((b) => b.fonction)
    expect(fonctions).toContain('feu')
    expect(fonctions).toContain('forge')
    expect(fonctions).toContain('atelier')
    // On n'annonce que le palier le PLUS BAS manquant : « Forge N2 » et non « N2 et N3 ».
    const forge = fonctionsAbsentes({}).filter((b) => b.fonction === 'forge')
    expect(forge).toHaveLength(1)
    expect(forge[0]!.niveau).toBe(2)
    expect(fonctionsAbsentes({ forge: 3 }).map((b) => b.fonction)).not.toContain('forge')
  })

  it('le lieu permet ce qu’il porte, et rien de plus', () => {
    expect(lieuPermet({}, null), 'à la main : partout').toBe(true)
    expect(lieuPermet({}, { fonction: 'forge', niveau: 2 })).toBe(false)
    expect(lieuPermet({ forge: 1 }, { fonction: 'forge', niveau: 2 })).toBe(false)
    expect(lieuPermet({ forge: 2 }, { fonction: 'forge', niveau: 2 })).toBe(true)
    expect(lieuPermet({ forge: 3 }, { fonction: 'forge', niveau: 2 })).toBe(true)
    expect(
      lieuPermet({ atelier: 3 } as CapacitesEnPortee, { fonction: 'forge', niveau: 1 }),
      'une fonction n’en sert pas une autre',
    ).toBe(false)
  })

  it('toute recette de la sim a un rayon (sinon elle disparaîtrait en silence)', () => {
    for (const id of TOUT) expect(CATEGORY_ORDER).toContain(RECIPE_CATEGORY[id])
  })

  it('le coût se lit en toutes lettres', () => {
    expect(costLine('rope')).toBe('fibre 3')
    expect(costLine('crude_axe')).toBe('bois 2 · pierre 3 · corde 1')
  })

  it('LE PIVOT RUST (R20) : le panneau ne montre JAMAIS de construction', () => {
    // Les pièces structurelles ont leur propre menu (le marteau). Quoi qu'on ait découvert,
    // aucune ligne du panneau n'est une barrière.
    expect(headers(craftRows(TOUT, ''))).not.toContain('CONSTRUCTION')
  })
})
