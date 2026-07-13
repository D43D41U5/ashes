import { describe, expect, it } from 'vitest'
import { INK, SIZE, textStyle, FONT, SECTION_TITLE } from './typography'

/**
 * LE GARDE-FOU DE LA VOIX DU JEU.
 *
 * On s'est fait avoir une fois : le HUD entier est en chasse fixe, et le panneau
 * d'artisanat est arrivé en `Georgia, serif` — deux polices à trente pixels l'une
 * de l'autre, sur le même écran. Une règle qu'aucun test ne garde n'est qu'une
 * intention : la prochaine bonne idée typographique repartirait pour un tour.
 *
 * On lit donc les SOURCES — par `import.meta.glob` (l'outil du bord : le tsconfig
 * du client est « navigateur », il n'a pas les types de Node). Aucun fichier, hors
 * `typography.ts`, n'a le droit de nommer une police.
 */
const SOURCES = import.meta.glob('../../**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

describe('la typographie du jeu', () => {
  it('une seule police, nommée à UN seul endroit', () => {
    // Le garde-fou doit d'abord VOIR : un glob qui ne ramène rien passerait au vert
    // en ne gardant rien du tout (le pire des tests — celui qui rassure à tort).
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20)

    const coupables = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('ui/typography.ts') && !path.endsWith('.test.ts'))
      .filter(([, source]) => /fontFamily\s*:\s*['"`]/.test(source))
      .map(([path]) => path)

    // Un fichier ici = quelqu'un a rechoisi la police du jeu dans son coin.
    // La corriger, ce n'est pas la remplacer : c'est importer `FONT`.
    expect(coupables).toEqual([])
  })

  it('l’échelle est COURTE : quatre tailles, six encres — pas une de plus', () => {
    // Au-delà, on ne compose plus, on bricole : l'œil ne sait plus ce qui compte.
    expect(Object.keys(SIZE)).toHaveLength(4)
    expect(Object.keys(INK)).toHaveLength(6)
  })

  it('tout style sort de la même fabrique — police, taille, encre, contour', () => {
    const body = textStyle('body')
    expect(body.fontFamily).toBe(FONT)
    expect(body.fontSize).toBe(`${SIZE.body}px`)
    expect(body.color).toBe(INK.body)
    expect(body.strokeThickness).toBe(3) // le HUD flotte sur le monde : il se détoure

    // …sauf ce qui vit sur un fond plein : le contour n'y ajoute que du gras.
    expect(textStyle('small', 'dim', false).strokeThickness).toBeUndefined()

    // Les titres de section parlent tous de la même voix (INVENTAIRE, ARTISANAT…).
    expect(SECTION_TITLE.fontFamily).toBe(FONT)
    expect(SECTION_TITLE.color).toBe(INK.title)
  })
})
