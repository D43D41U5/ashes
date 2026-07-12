import { describe, expect, it } from 'vitest'
import { BELT_BINDINGS, CRAFT_BINDINGS, DEBUG_KEYMAP, KEYMAP } from './keymap'

/**
 * L'invariant qui compte quand on rebinde : deux actions ne partagent jamais
 * une même touche NON MODIFIÉE (sinon la seconde vole la première, en silence).
 * On rassemble les touches de la table + de la ceinture + du debug et on vérifie
 * l'unicité — une touche de debug qui volerait une touche de jeu ne se verrait
 * qu'en playtest, et seulement en dev.
 *
 * `CRAFT_BINDINGS` est volontairement EXCLU : c'est une béquille sur SHIFT+1…5
 * (chantier 2), qui partage donc les touches 1-5 de la ceinture par design — le
 * modificateur SHIFT les distingue au runtime (input-bindings.ts).
 */
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

  it('le craft de dépannage se plaque sur les touches de la ceinture (SHIFT+1…5)', () => {
    for (const [key] of CRAFT_BINDINGS) {
      expect(BELT_BINDINGS.some(([beltKey]) => beltKey === key)).toBe(true)
    }
  })
})
