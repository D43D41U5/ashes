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
   * La garde de fond du débranchement : le clavier ne porte quasiment AUCUN verbe de
   * jeu. S'en tenir à une liste blanche (déplacement, allures, JETER, CUEILLIR, les
   * écrans) fait échouer le test le jour où quelqu'un recâble une action à la va-vite —
   * ce qui est exactement la discussion qu'on veut avoir à ce moment-là. Elle a eu lieu
   * deux fois : `block` (2026-07-12) et `forage` (2026-07-24), toutes deux DÉCISIONS
   * UTILISATEUR blanchies ci-dessous. Toute troisième doit passer par la même porte.
   */
  it('le clavier ne porte que le déplacement, les allures (dont la parade), JETER, CUEILLIR (F), TOURNER (A/E), et les écrans (sac/carte/chronique/pause)', () => {
    // `block` (la parade) est une ALLURE maintenue, au même rang que `sprint` et
    // `sneak` — pas un verbe de ceinture. C'est le premier recâblage clavier assumé
    // depuis 2026-07-12, blanchi EXPRÈS : une stance a sa place au clavier, un verbe
    // (attaquer, bander, bâtir…) n'en a pas. `toggleMenu` (ESC, le menu pause) est un
    // ÉCRAN, au même rang que le sac/la carte/la chronique — pas un verbe.
    //
    // `forage` (E), lui, EST un verbe — et c'est la seule exception assumée (décision
    // utilisateur 2026-07-24, docs/decisions.md) : UNE touche contextuelle « interagir »
    // à la Rust (on pointe le buisson au curseur, E le cueille ENTIER d'un coup, quoi
    // qu'on tienne), pas l'explosion un-verbe-une-touche qu'on avait bannie. Elle laisse
    // le CLIC strictement inchangé (« l'objet en main décide » : une arme frappe toujours).
    //
    // `rotateLeft`/`rotateRight` (2026-07-27, décision d'Alexis) sont le TROISIÈME recâblage,
    // et il passe par la même porte que les deux autres. Ce ne sont pas des verbes : elles ne
    // changent RIEN au monde, elles orientent un fantôme avant la pose — du même rang que
    // viser. Elles prennent A et E : `forage` a migré de E vers F, et `moveLeft` a rendu son
    // alias 65 (la gauche du WASD) pour ne garder que 81 — la gauche du ZQSD, celle d'Alexis.
    //
    // ATTENTION en relisant cette table : Phaser dispatche sur `event.keyCode`, qui suit
    // l'ÉTIQUETTE de la disposition et NON la position physique (d'où WASD illisible en
    // AZERTY). Une première version a cru l'inverse et a donné 81 à `rotateLeft` : la gauche
    // du ZQSD est morte en silence, et CE TEST EST RESTÉ VERT — il ne garde que l'unicité
    // des alias, pas la couverture des dispositions. Le raisonnement de fond est dans
    // `keymap.ts`, sur `moveLeft`.
    expect(Object.keys(KEYMAP).sort()).toEqual(
      ['block', 'dropHeld', 'forage', 'moveDown', 'moveLeft', 'moveRight', 'moveUp', 'rotateLeft', 'rotateRight', 'sneak', 'sprint', 'toggleInventory', 'toggleJournal', 'toggleMap', 'toggleMenu'].sort(),
    )
  })
})
