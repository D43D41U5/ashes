import { describe, expect, it } from 'vitest'
import { BELT_BINDINGS, DEBUG_KEYMAP, KEYMAP } from './keymap'

/**
 * L'invariant qui compte quand on rebinde : deux actions ne partagent jamais une
 * même touche (sinon la seconde vole la première, en silence). On rassemble les
 * touches de la table + de la ceinture + du debug et on vérifie l'unicité — une
 * touche de debug qui volerait une touche de jeu ne se verrait qu'en playtest, et
 * seulement en dev.
 *
 * Depuis le débranchement du 2026-07-12, l'invariant a repris toute sa force : il
 * n'y a PLUS de touche modifiée nulle part. Le craft sur SHIFT+chiffre était
 * précisément l'exception qui l'affaiblissait — et le bug qu'elle cachait : SHIFT
 * sprintant AUSSI, changer de case de ceinture en courant lançait une recette.
 */
describe('keymap', () => {
  it('aucune touche n’est liée à deux actions', () => {
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
   * La garde de fond du débranchement : le clavier ne porte plus AUCUN verbe de
   * jeu. S'en tenir à une liste blanche (déplacement, sprint, les trois écrans)
   * fait échouer le test le jour où quelqu'un recâble une action à la va-vite —
   * ce qui est exactement la discussion qu'on veut avoir à ce moment-là.
   */
  it('le clavier ne porte que le déplacement, les allures, JETER, et les trois écrans', () => {
    expect(Object.keys(KEYMAP).sort()).toEqual(
      ['dropHeld', 'moveDown', 'moveLeft', 'moveRight', 'moveUp', 'sneak', 'sprint', 'toggleInventory', 'toggleJournal', 'toggleMap'].sort(),
    )
  })
})
