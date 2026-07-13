import { RECIPES, type RecipeId } from '@braises/sim'
import { describe, expect, it } from 'vitest'
import { CATEGORY_ORDER, RECIPE_CATEGORY, craftRows, costLine } from './craft-panel'

/**
 * CE QUE LE PANNEAU MONTRE est une décision, pas un dessin : elle se prouve ici.
 * Le Phaser autour ne fait que placer des rectangles.
 */
const ids = (rows: ReturnType<typeof craftRows>): RecipeId[] =>
  rows.flatMap((r) => (r.kind === 'recipe' ? [r.id] : []))
const headers = (rows: ReturnType<typeof craftRows>): string[] =>
  rows.flatMap((r) => (r.kind === 'header' ? [r.label] : []))

describe('le panneau d’artisanat : ce qu’il montre', () => {
  it('LE CONTEXTE : sans aucune station, on ne voit QUE ce qui se fait à la main', () => {
    const rows = craftRows([], '')
    const shown = ids(rows)

    // La couche 1 est là, entière.
    expect(shown).toContain('rope')
    expect(shown).toContain('crude_axe')
    expect(shown).toContain('crude_pickaxe')
    expect(shown).toContain('crude_spear')
    // Et RIEN qui demande une station : pas de vignette grisée « pour plus tard ».
    for (const id of shown) expect(RECIPES[id].station).toBeNull()
  })

  it('LE CONTEXTE : le four ouvre le lingot — et lui seul', () => {
    const rows = craftRows(['furnace'], '')
    const shown = ids(rows)

    expect(shown).toContain('iron_ingot') // le four est là
    expect(shown).toContain('rope') // la main marche partout
    expect(shown).not.toContain('axe') // l'atelier, lui, n'est pas là
    expect(shown).not.toContain('stew') // ni le Feu
  })

  it('LE CONTEXTE : au Feu ET à l’atelier, les deux rayons s’ouvrent', () => {
    const shown = ids(craftRows(['fire', 'workshop'], ''))
    expect(shown).toContain('stew') // Feu
    expect(shown).toContain('hammer') // Feu
    expect(shown).toContain('axe') // atelier
    expect(shown).toContain('spear') // atelier
    expect(shown).not.toContain('iron_ingot') // pas de four : pas de lingot
  })

  it('LES CATÉGORIES : des en-têtes, dans l’ordre, et JAMAIS de rayon vide', () => {
    const rows = craftRows(['fire', 'workshop', 'furnace'], '')
    const hs = headers(rows)

    expect(hs).toEqual(['OUTILS', 'ARMES', 'SURVIE', 'MATÉRIAUX'])
    // L'ordre des en-têtes suit CATEGORY_ORDER, et chaque en-tête est SUIVI d'au
    // moins une recette (un rayon sans article n'est pas un rayon, c'est du bruit).
    rows.forEach((row, i) => {
      if (row.kind === 'header') expect(rows[i + 1]?.kind).toBe('recipe')
    })
    // Les recettes d'un rayon appartiennent bien à ce rayon.
    let current = ''
    for (const row of rows) {
      if (row.kind === 'header') current = row.label
      else expect(CATEGORY_LABELS_OF(row.id)).toBe(current)
    }
  })

  it('LES CATÉGORIES : sans station, il ne reste que les rayons qui ont de quoi', () => {
    // À mains nues : outils (hachereau, pic), armes (épieu), matériaux (corde).
    // Pas de rayon SURVIE — le ragoût et la viande cuite veulent un Feu.
    expect(headers(craftRows([], ''))).toEqual(['OUTILS', 'ARMES', 'MATÉRIAUX'])
  })

  it('LA RECHERCHE : filtre sur le nom, sans accents ni casse', () => {
    const all: readonly ('fire' | 'workshop' | 'furnace')[] = ['fire', 'workshop', 'furnace']

    expect(ids(craftRows(all, 'corde'))).toEqual(['rope'])
    expect(ids(craftRows(all, 'CORDE'))).toEqual(['rope']) // la casse ne compte pas
    expect(ids(craftRows(all, 'epieu'))).toEqual(['crude_spear']) // « Épieu taillé » sans accent
    expect(ids(craftRows(all, 'pioche')).length).toBeGreaterThan(1) // pioche, pioche de fer, pic ?

    // Une recherche qui ne trouve rien ne laisse AUCUN en-tête orphelin.
    const vide = craftRows(all, 'zzz')
    expect(vide).toEqual([])
  })

  it('LA RECHERCHE se combine au CONTEXTE : on ne trouve pas ce qu’on ne peut pas faire ici', () => {
    // Sans atelier, chercher « hache » ne trouve QUE le hachereau de fortune — qui,
    // lui, se taille à la main. La vraie hache existe, mais pas ICI : la recherche
    // ne la fait pas apparaître, sinon le panneau redeviendrait un catalogue.
    expect(ids(craftRows([], 'hache'))).toEqual(['crude_axe'])
    // L'atelier à portée : les deux sortent.
    const avecAtelier = ids(craftRows(['workshop'], 'hache'))
    expect(avecAtelier).toContain('crude_axe')
    expect(avecAtelier).toContain('axe')
  })

  it('toute recette de la sim a un rayon (sinon elle disparaîtrait en silence)', () => {
    for (const id of Object.keys(RECIPES) as RecipeId[]) {
      expect(CATEGORY_ORDER).toContain(RECIPE_CATEGORY[id])
    }
  })

  it('le coût se lit en toutes lettres', () => {
    expect(costLine('rope')).toBe('fibre 3')
    expect(costLine('crude_axe')).toBe('bois 2 · pierre 3 · corde 1')
  })
})

/** Le libellé du rayon d'une recette (pour l'assertion de cohérence ci-dessus). */
function CATEGORY_LABELS_OF(id: RecipeId): string {
  const cat = RECIPE_CATEGORY[id]
  return { outils: 'OUTILS', armes: 'ARMES', survie: 'SURVIE', materiaux: 'MATÉRIAUX' }[cat]
}
