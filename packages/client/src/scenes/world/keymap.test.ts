import { describe, expect, it } from 'vitest'
import { BUILD_BINDINGS, CRAFT_BINDINGS, DEBUG_KEYMAP, KEYMAP } from './keymap'

/**
 * L'invariant qui compte quand on rebinde : deux actions ne partagent jamais
 * une même touche (sinon la seconde vole la première, en silence). On rassemble
 * TOUTES les touches de la table + des listes build/craft + du debug et on
 * vérifie l'unicité — une touche de debug qui volerait une touche de jeu ne se
 * verrait qu'en playtest, et seulement en dev.
 */
describe('keymap', () => {
  it('aucune touche n’est liée à deux actions', () => {
    const all = [
      ...Object.values(KEYMAP).flat(),
      ...Object.values(DEBUG_KEYMAP).flat(),
      ...BUILD_BINDINGS.map(([key]) => key),
      ...CRAFT_BINDINGS.map(([key]) => key),
    ]
    const seen = new Set<string>()
    const dups = all.filter((key) => (seen.has(key) ? true : (seen.add(key), false)))
    expect(dups).toEqual([])
  })
})
