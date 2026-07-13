import { RECIPES, type RecipeId } from '@braises/sim'
import { describe, expect, it } from 'vitest'
import { CATEGORY_LABEL, CATEGORY_ORDER, RECIPE_CATEGORY, craftRows, costLine } from './craft-panel'

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

    // ALPHABÉTIQUE (l'accent de MATÉRIAUX se range sous le E, pas après le Z), et
    // CAMPEMENT (le Feu) en fait partie — c'est le premier geste du jeu.
    expect(hs).toEqual(['ARMES', 'CAMPEMENT', 'MATÉRIAUX', 'OUTILS', 'SURVIE'])
    expect(hs).toEqual([...hs].sort((a, b) => a.localeCompare(b, 'fr')))
    // L'ordre des en-têtes suit CATEGORY_ORDER, et chaque en-tête est SUIVI d'au
    // moins une recette (un rayon sans article n'est pas un rayon, c'est du bruit).
    // Chaque en-tête est SUIVI d'au moins un article (un rayon sans article n'est
    // pas un rayon, c'est du bruit) — une recette, ou le Feu.
    rows.forEach((row, i) => {
      if (row.kind === 'header') expect(['recipe', 'fire']).toContain(rows[i + 1]?.kind)
    })
    // Les recettes d'un rayon appartiennent bien à ce rayon.
    let current = ''
    for (const row of rows) {
      if (row.kind === 'header') current = row.label
      else if (row.kind === 'recipe') expect(CATEGORY_LABELS_OF(row.id)).toBe(current)
      else expect(current).toBe('CAMPEMENT') // le FEU, qui n'est pas une recette
    }
  })

  it('LES CATÉGORIES : sans station, il ne reste que les rayons qui ont de quoi', () => {
    // À mains nues : armes (épieu), matériaux (corde), outils (hachereau, pic).
    // Pas de rayon SURVIE — le ragoût et la viande cuite veulent un Feu. Et les
    // rayons qui RESTENT sont toujours dans l'ordre alphabétique.
    expect(headers(craftRows([], ''))).toEqual(['ARMES', 'CAMPEMENT', 'MATÉRIAUX', 'OUTILS'])
  })

  it('LA RECHERCHE : filtre sur le nom, sans accents ni casse', () => {
    const all: readonly ('fire' | 'workshop' | 'furnace')[] = ['fire', 'workshop', 'furnace']

    expect(ids(craftRows(all, 'corde'))).toEqual(['rope'])
    expect(ids(craftRows(all, 'CORDE'))).toEqual(['rope']) // la casse ne compte pas
    expect(ids(craftRows(all, 'epieu'))).toEqual(['crude_spear']) // « Épieu taillé » sans accent
    expect(ids(craftRows(all, 'pioche')).length).toBeGreaterThan(1) // pioche, pioche de fer, pic ?

    // Une recherche qui ne trouve rien ne laisse AUCUN en-tête orphelin — pas même
    // celui du Feu.
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
  return CATEGORY_LABEL[RECIPE_CATEGORY[id]]
}

/**
 * LE RAYON CONSTRUCTION. La sim exige le marteau EN MAIN pour bâtir (recolte.md
 * G12) : le panneau ne doit donc JAMAIS montrer des murs qu'on ne peut pas poser.
 * Un menu qui propose ce que le jeu refuse est un menu qui ment.
 */
describe('le panneau : bâtir', () => {
  const stations: readonly ('fire' | 'workshop' | 'furnace')[] = []

  it('SANS marteau : pas de rayon CONSTRUCTION du tout', () => {
    const rows = craftRows(stations, '', false)
    expect(rows.some((r) => r.kind === 'build')).toBe(false)
    expect(rows.flatMap((r) => (r.kind === 'header' ? [r.label] : []))).not.toContain('CONSTRUCTION')
  })

  it('LE MARTEAU EN MAIN : le rayon s’ouvre — mur, porte, coffre, atelier, four', () => {
    const rows = craftRows(stations, '', true)
    const batir = rows.flatMap((r) => (r.kind === 'build' ? [r.structure] : []))
    expect(batir).toEqual(['wall', 'door', 'chest', 'workshop', 'furnace'])
  })

  it('la recherche filtre AUSSI les constructions', () => {
    const rows = craftRows(stations, 'coffre', true)
    expect(rows.flatMap((r) => (r.kind === 'build' ? [r.structure] : []))).toEqual(['chest'])
  })
})
