import { describe, expect, it } from 'vitest'
import { KEYMAP } from './keymap'
import {
  ACTIONS,
  INREBINDABLE,
  actionsMuettes,
  fusionne,
  keymapLivre,
  nettoieKeymapPerso,
  poseBinding,
  reinitialise,
  type KeymapPerso,
} from './keymap-perso'
import { libelleTouche, libelleTouches, toucheDepuisEvenement } from './touches'

/**
 * LES TOUCHES DU JOUEUR — le seul système du client où une erreur rend le jeu INJOUABLE
 * sans rien afficher. Une action sans touche, une touche prise deux fois, un réglage qu'on
 * ne sait plus défaire : dans les trois cas le joueur presse et rien ne répond.
 */
describe('poser une touche', () => {
  it('remplace les alias livrés par LA touche choisie', () => {
    // `avancer` est livré avec trois alias (Z, W, ↑) pour couvrir AZERTY, QWERTY et les
    // flèches. Rebinder l'action la ramène à UNE touche — décision d'Alexis, 2026-07-28.
    expect(keymapLivre().moveUp.length).toBeGreaterThan(1)
    const perso = poseBinding({}, 'moveUp', 'K')
    expect(fusionne(perso).moveUp).toEqual(['K'])
  })

  it('LAISSE INTACTES les actions auxquelles on ne touche pas — leurs alias survivent', () => {
    // C'est toute la promesse : qui n'ouvre jamais l'écran des réglages ne perd rien.
    const perso = poseBinding({}, 'moveUp', 'K')
    const eff = fusionne(perso)
    expect(eff.moveDown).toEqual([...KEYMAP.moveDown])
    expect(eff.moveLeft).toEqual([...KEYMAP.moveLeft])
  })

  it('VOLE la touche à qui la détenait — et la lui retire vraiment', () => {
    // On vole plutôt que de refuser : refuser obligerait à deviner QUI détient la touche,
    // puis à aller la libérer d'abord. Ici le travail restant est visible à sa place.
    const perso = poseBinding({}, 'sneak', 'G') // 'G' appartient à `dropHeld`
    const eff = fusionne(perso)
    expect(eff.sneak).toEqual(['G'])
    expect(eff.dropHeld).not.toContain('G')
  })

  it('vole même un ALIAS au milieu d’une liste, sans emporter les autres', () => {
    const perso = poseBinding({}, 'sneak', KEYMAP.moveUp[1]!) // le deuxième alias d'`avancer`
    const eff = fusionne(perso)
    expect(eff.moveUp).toEqual([KEYMAP.moveUp[0], ...KEYMAP.moveUp.slice(2)])
    expect(eff.moveUp).not.toContain(KEYMAP.moveUp[1])
  })

  it('une action dépouillée se signale comme MUETTE', () => {
    // `sneak` n'a qu'une touche : la voler la laisse sans rien. L'écran doit pouvoir le dire
    // (un tiret rouge), sinon le joueur découvre la perte en jouant.
    const perso = poseBinding({}, 'sprint', KEYMAP.sneak[0]!)
    expect(actionsMuettes(fusionne(perso))).toContain('sneak')
    expect(libelleTouches(fusionne(perso).sneak)).toBe('—')
  })

  it('NE TOUCHE JAMAIS à la sortie de secours, ni comme cible ni comme victime', () => {
    // ÉCHAP ouvre le menu pause — donc le son, le retour aux vallées, et la réparation d'un
    // binding raté. La lier ailleurs enfermerait le joueur dans sa partie, sans recours.
    expect(INREBINDABLE).toContain('toggleMenu')
    expect(poseBinding({}, 'toggleMenu', 'K')).toEqual({}) // on ne la rebinde pas…
    const vol = poseBinding({}, 'sprint', KEYMAP.toggleMenu[0]!)
    expect(fusionne(vol).toggleMenu).toEqual([...KEYMAP.toggleMenu]) // …et on ne la dépouille pas
    expect(fusionne(vol).sprint).toEqual([...KEYMAP.sprint]) // le vol entier est refusé, pas à moitié
  })

  it('ne mute jamais l’objet qu’on lui donne', () => {
    const avant: KeymapPerso = { moveUp: ['K'] }
    const copie = JSON.parse(JSON.stringify(avant)) as KeymapPerso
    poseBinding(avant, 'moveDown', 'L')
    expect(avant).toEqual(copie)
  })
})

describe('réinitialiser', () => {
  it('rend à une action ses alias d’origine, sans toucher aux autres', () => {
    let perso = poseBinding({}, 'moveUp', 'K')
    perso = poseBinding(perso, 'moveDown', 'L')
    const apres = fusionne(reinitialise(perso, 'moveUp'))
    expect(apres.moveUp).toEqual([...KEYMAP.moveUp])
    expect(apres.moveDown).toEqual(['L'])
  })

  it('sans action nommée, tout revient au livré', () => {
    const perso = poseBinding(poseBinding({}, 'moveUp', 'K'), 'sprint', 'L')
    expect(reinitialise(perso)).toEqual({})
    expect(fusionne(reinitialise(perso))).toEqual(keymapLivre())
  })
})

describe('relire un réglage venu du disque', () => {
  it('ignore ce qu’on ne connaît pas SANS jeter le reste', () => {
    // Un réglage écrit par une version où une action existait encore ne doit pas coûter au
    // joueur les dix autres touches qu'il avait posées.
    const lu = nettoieKeymapPerso({ moveUp: ['K'], actionDisparue: ['X'], sprint: 'pas un tableau' })
    expect(lu).toEqual({ moveUp: ['K'] })
  })

  it('ne relit qu’UNE touche par action, et jamais la sortie de secours', () => {
    expect(nettoieKeymapPerso({ moveUp: ['K', 'L', 'M'] })).toEqual({ moveUp: ['K'] })
    expect(nettoieKeymapPerso({ toggleMenu: ['K'] })).toEqual({})
  })

  it('rend un réglage vide sur n’importe quelle saleté', () => {
    for (const brut of [null, 42, 'texte', [], undefined]) expect(nettoieKeymapPerso(brut)).toEqual({})
  })
})

describe('l’écran des réglages couvre ce que le jeu écoute', () => {
  it('toute action de KEYMAP est affichée, ou volontairement écartée', () => {
    // La table de l'écran est écrite à la main : sans cette garde, une action ajoutée à
    // `KEYMAP` demain n'apparaîtrait nulle part et serait irréglable en silence.
    // `rotateLeft`/`rotateRight` sont écartées EXPRÈS — rien ne les lit (voir `keymap-perso`).
    const affichees = new Set(ACTIONS.map((a) => a.action))
    const ecartees = new Set(['rotateLeft', 'rotateRight'])
    const manquantes = Object.keys(KEYMAP).filter((a) => !affichees.has(a as never) && !ecartees.has(a))
    expect(manquantes).toEqual([])
  })

  it('ne nomme aucune action deux fois', () => {
    expect(new Set(ACTIONS.map((a) => a.action)).size).toBe(ACTIONS.length)
  })
})

describe('capturer une touche au clavier', () => {
  it('lit l’ÉTIQUETTE, pas la position — le monde de Phaser', () => {
    // Phaser dispatche sur `event.keyCode`, qui suit l'étiquette : capturer `event.code`
    // (positionnel) donnerait un nom que Phaser ne retrouverait jamais. Cette erreur-là a
    // déjà tué la gauche du ZQSD une fois, en silence.
    expect(toucheDepuisEvenement({ key: 'z' })).toBe('Z')
    expect(toucheDepuisEvenement({ key: 'Z' })).toBe('Z')
  })

  it('nomme les touches spéciales comme KEYMAP les nomme', () => {
    expect(toucheDepuisEvenement({ key: ' ' })).toBe('SPACE')
    expect(toucheDepuisEvenement({ key: 'ArrowUp' })).toBe('UP')
    expect(toucheDepuisEvenement({ key: 'Tab' })).toBe('TAB')
    expect(toucheDepuisEvenement({ key: 'Escape' })).toBe('ESC')
    expect(toucheDepuisEvenement({ key: '1' })).toBe('ONE')
    expect(toucheDepuisEvenement({ key: 'F3' })).toBe('F3')
  })

  it('REFUSE ce qu’elle ne sait pas nommer, plutôt que d’inventer', () => {
    // Un nom que `KeyCodes` ignore donnerait une action muette en jeu sans rien annoncer.
    for (const key of ['é', '€', 'Dead', 'MediaPlayPause', '']) {
      expect(toucheDepuisEvenement({ key })).toBeNull()
    }
  })

  it('les libellés d’écran sont en français, les flèches en glyphe', () => {
    expect(libelleTouche('SPACE')).toBe('ESPACE')
    expect(libelleTouche('UP')).toBe('↑')
    expect(libelleTouche('ONE')).toBe('1')
    expect(libelleTouche('Z')).toBe('Z')
    expect(libelleTouches(['Z', 'W', 'UP'])).toBe('Z · W · ↑')
  })
})
