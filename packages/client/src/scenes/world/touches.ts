/**
 * LES TOUCHES, DES DEUX CÔTÉS DE L'ÉCRAN — capturer ce que le joueur presse, et l'écrire en
 * français. Module PUR : aucun import Phaser, aucun DOM, aucune horloge (voir `keymap.ts`,
 * même règle et même raison — ça se teste sans navigateur).
 *
 * ⚠ ON CAPTURE `event.key`, PAS `event.code`, ET C'EST UNE DÉCISION.
 *
 * Phaser dispatche sur `event.keyCode` (`KeyboardPlugin` : `var code = event.keyCode`), qui
 * suit **l'ÉTIQUETTE** de la disposition et non la position physique — c'est exactement pour ça
 * que WASD ne marche pas en AZERTY (voir la longue note de `KEYMAP.moveLeft`). Capturer
 * `event.code` (`KeyW`, positionnel) donnerait donc un nom de touche que Phaser ne retrouverait
 * jamais : le joueur presserait la touche sous son index, l'écran afficherait « W », et rien ne
 * répondrait en jeu. Cette erreur-là a déjà tué la gauche du ZQSD une fois, en silence, avec
 * les tests au vert. `event.key` rend l'étiquette — le même monde que Phaser.
 */

/** Les noms de touches Phaser des chiffres, dans l'ordre. */
const CHIFFRES = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'] as const

/** `KeyboardEvent.key` → nom de touche Phaser, pour les touches qui ne sont pas un signe. */
const SPECIALES: Record<string, string> = {
  ' ': 'SPACE',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  Escape: 'ESC',
  Tab: 'TAB',
  Enter: 'ENTER',
  Backspace: 'BACKSPACE',
  Delete: 'DELETE',
  Shift: 'SHIFT',
  Control: 'CTRL',
  Alt: 'ALT',
  Home: 'HOME',
  End: 'END',
  PageUp: 'PAGE_UP',
  PageDown: 'PAGE_DOWN',
  Insert: 'INSERT',
}

/**
 * Le nom Phaser de la touche pressée, ou `null` si on ne sait pas la nommer.
 *
 * `null` n'est pas un échec à taire : la capture doit REFUSER visiblement ce qu'elle ne sait
 * pas lier (une touche morte, un caractère composé, une touche multimédia), plutôt que d'écrire
 * un nom que Phaser ne résoudra jamais — l'action serait alors muette en jeu sans que rien ne
 * l'annonce, et c'est le pire des deux mondes.
 */
export function toucheDepuisEvenement(e: { key: string }): string | null {
  const k = e.key
  if (!k) return null
  if (SPECIALES[k]) return SPECIALES[k]
  if (/^F([1-9]|1[0-2])$/.test(k)) return k // F1..F12
  if (/^[0-9]$/.test(k)) return CHIFFRES[Number(k)]!
  // Une SEULE lettre — `'é'`, `'ç'` ou `'€'` compris, que Phaser ne saura pas résoudre : on
  // s'en tient à l'alphabet latin non accentué, le seul que `KeyCodes` nomme.
  if (/^[a-zA-Z]$/.test(k)) return k.toUpperCase()
  return null
}

/** Comment une touche s'ÉCRIT à l'écran. Les flèches en glyphe, le reste en français. */
const LIBELLES: Record<string, string> = {
  SPACE: 'ESPACE',
  UP: '↑',
  DOWN: '↓',
  LEFT: '←',
  RIGHT: '→',
  ESC: 'ÉCHAP',
  ENTER: 'ENTRÉE',
  BACKSPACE: 'RETOUR',
  DELETE: 'SUPPR',
  SHIFT: 'MAJ',
  CTRL: 'CTRL',
  ALT: 'ALT',
  PAGE_UP: 'PAGE ↑',
  PAGE_DOWN: 'PAGE ↓',
}

/** Le libellé d'une touche : `'SPACE'` → `'ESPACE'`, `'ONE'` → `'1'`, `'Z'` → `'Z'`. */
export function libelleTouche(nom: string): string {
  if (LIBELLES[nom]) return LIBELLES[nom]
  const chiffre = CHIFFRES.indexOf(nom as (typeof CHIFFRES)[number])
  if (chiffre >= 0) return String(chiffre)
  return nom
}

/** Une action et ses touches, telle qu'elle s'écrit sur une ligne de réglages. */
export function libelleTouches(noms: readonly string[]): string {
  // Une action peut n'avoir AUCUNE touche : celle à qui on vient de voler la sienne. On le dit
  // par un tiret plutôt que par du vide — une ligne vide se lit comme un défaut d'affichage.
  return noms.length === 0 ? '—' : noms.map(libelleTouche).join(' · ')
}
