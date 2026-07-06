import { describe, expect, it } from 'vitest'
import { BUILD_BINDINGS, CRAFT_BINDINGS, KEYMAP } from './keymap'

/**
 * L'invariant qui compte quand on rebinde : deux actions ne partagent jamais
 * une même touche (sinon la seconde vole la première, en silence). On rassemble
 * TOUTES les touches de la table + des listes build/craft et on vérifie l'unicité.
 */
describe('keymap', () => {
  it('aucune touche n’est liée à deux actions', () => {
    const all = [
      ...Object.values(KEYMAP).flat(),
      ...BUILD_BINDINGS.map(([key]) => key),
      ...CRAFT_BINDINGS.map(([key]) => key),
    ]
    const seen = new Set<string>()
    const dups = all.filter((key) => (seen.has(key) ? true : (seen.add(key), false)))
    expect(dups).toEqual([])
  })
})
