import { describe, expect, it } from 'vitest'
import { BELT_BINDINGS, CRAFT_BINDINGS, DEBUG_KEYMAP, KEYMAP } from './keymap'

/**
 * L'invariant qui compte quand on rebinde : deux actions ne partagent jamais
 * une même touche NON MODIFIÉE (sinon la seconde vole la première, en silence).
 * On rassemble les touches de la table + de la ceinture + du debug et on vérifie
 * l'unicité — une touche de debug qui volerait une touche de jeu ne se verrait
 * qu'en playtest, et seulement en dev.
 *
 * `CRAFT_BINDINGS` est volontairement EXCLU : c'est une béquille sur SHIFT+chiffre
 * (jusqu'au panneau de craft). Elle partage les touches 1-6 avec la ceinture par
 * design — le modificateur SHIFT les distingue au runtime (input-bindings.ts).
 */
const DIGITS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'ZERO']

describe('keymap', () => {
  it('aucune touche non modifiée n’est liée à deux actions', () => {
    const all = [
      ...Object.values(KEYMAP).flat(),
      ...Object.values(DEBUG_KEYMAP).flat(),
      ...BELT_BINDINGS.map(([key]) => key),
    ]
    const seen = new Set<string>()
    const dups = all.filter((key) => (seen.has(key) ? true : (seen.add(key), false)))
    expect(dups).toEqual([])
  })

  /*
   * L'invariant du craft de dépannage : il ne vit QUE sur des chiffres. C'est ce
   * qui garantit que SHIFT suffit à le départager de la ceinture (1-6) et que les
   * chiffres libres (7-0) ne volent aucune action de jeu — les touches de KEYMAP
   * et de DEBUG_KEYMAP sont des lettres et des F-touches.
   */
  it('le craft de dépannage ne vit que sur des chiffres (SHIFT+1…0)', () => {
    for (const [key] of CRAFT_BINDINGS) expect(DIGITS).toContain(key)
  })

  it('une touche ne lance jamais deux recettes', () => {
    const keys = CRAFT_BINDINGS.map(([key]) => key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
