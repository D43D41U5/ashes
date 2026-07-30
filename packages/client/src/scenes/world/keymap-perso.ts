/**
 * LES TOUCHES DU JOUEUR — la couche d'override par-dessus `KEYMAP`, et rien d'autre.
 *
 * `keymap.ts` reste LA table livrée : elle ne bouge pas, elle est la référence de « réinitialiser »
 * et la seule chose que le test d'unicité garde. Ici vit ce que le joueur en a fait.
 *
 * UNE TOUCHE PAR ACTION (décision d'Alexis, 2026-07-28). Les alias livrés — `avancer` = `Z`,
 * `W`, `↑` — n'existent pas par goût mais pour couvrir AZERTY, QWERTY et les flèches ; ils
 * SURVIVENT donc tant qu'on ne touche pas à leur ligne. Rebinder une action la ramène à la
 * seule touche choisie ; « réinitialiser » lui rend ses alias d'origine. Conséquence, et elle
 * est voulue : l'écran affiche parfois trois touches (le défaut) et parfois une (ton choix) —
 * c'est EXACT, et ça se lit tout seul. Afficher toujours une touche mentirait sur ce qui répond.
 *
 * ⚠ CE MODULE NE DIT PAS QUELLE TOUCHE PHASER ENTEND. Il rend des NOMS ; c'est
 * `input-bindings.ts` qui les résout, et `touches.ts` qui les capture (avec, là-bas, la raison
 * pour laquelle on lit `event.key` et jamais `event.code`).
 */
import { KEYMAP } from './keymap'

/** Les actions rebindables — celles du jeu. `DEBUG_KEYMAP` n'en est pas et n'a rien à y faire. */
export type ActionJeu = keyof typeof KEYMAP

/**
 * L'ORDRE ET LES MOTS de l'écran des réglages. Cette table est la SEULE source du libellé
 * d'une action : le menu pause lisait jusqu'ici sa propre liste écrite à la main, qui aurait
 * menti dès le premier rebind. Groupées comme on les apprend — bouger, agir, ouvrir.
 */
export const ACTIONS: readonly { action: ActionJeu; libelle: string; groupe: string }[] = [
  { action: 'moveUp', libelle: 'Avancer', groupe: 'SE DÉPLACER' },
  { action: 'moveDown', libelle: 'Reculer', groupe: 'SE DÉPLACER' },
  { action: 'moveLeft', libelle: 'Aller à gauche', groupe: 'SE DÉPLACER' },
  { action: 'moveRight', libelle: 'Aller à droite', groupe: 'SE DÉPLACER' },
  { action: 'sprint', libelle: 'Courir', groupe: 'SE DÉPLACER' },
  { action: 'sneak', libelle: 'Marcher lentement', groupe: 'SE DÉPLACER' },
  { action: 'block', libelle: 'Parer (maintenu)', groupe: 'AGIR' },
  { action: 'forage', libelle: 'Cueillir, interagir', groupe: 'AGIR' },
  { action: 'dropHeld', libelle: 'Jeter ce qu’on tient', groupe: 'AGIR' },
  { action: 'rotateLeft', libelle: 'Tourner ce qu’on pose (sens inverse)', groupe: 'BÂTIR' },
  { action: 'rotateRight', libelle: 'Tourner ce qu’on pose', groupe: 'BÂTIR' },
  { action: 'toggleInventory', libelle: 'Personnage (sac, artisanat)', groupe: 'OUVRIR' },
  { action: 'toggleMap', libelle: 'Carte', groupe: 'OUVRIR' },
  { action: 'toggleJournal', libelle: 'Chronique', groupe: 'OUVRIR' },
  { action: 'toggleMenu', libelle: 'Menu pause', groupe: 'OUVRIR' },
  { action: 'toggleMute', libelle: 'Couper le son', groupe: 'LE SON' },
]

/**
 * ✅ `rotateLeft`/`rotateRight` (`A`/`E`) SONT ENTRÉES DANS CETTE TABLE LE 2026-07-30.
 *
 * Elles en étaient absentes EXPRÈS depuis le 2026-07-28 : déclarées dans `KEYMAP`, annoncées par
 * le menu pause, et **lues par personne** — aucune action de /sim ne portait d'orientation de
 * pose, il n'y avait rien à tourner. Les offrir au rebinding aurait donné une ligne de réglages
 * qui ne peut RIEN faire, c'est-à-dire l'écran qui ment qu'on cherchait à éviter.
 *
 * La pose sur ARÊTE (spec construction R23) leur donne enfin leur objet : elles font tourner
 * l'arête armée du fantôme, et `input-bindings.ts` les câble. La promesse est tenue, la ligne
 * de réglages fait quelque chose, et le groupe « BÂTIR » naît avec elles.
 */

/** Ce que le joueur a changé : action → LA touche qu'il a choisie (ou aucune, si on la lui a volée). */
export type KeymapPerso = Partial<Record<ActionJeu, string[]>>

/** Le jeu de touches EFFECTIF : le livré, écrasé ligne par ligne par le choix du joueur. */
export type KeymapEffectif = Record<ActionJeu, readonly string[]>

/**
 * ÉCHAP NE SE REBINDE PAS. C'est la sortie de secours : le menu pause est ce qui permet de
 * quitter, de régler le son et — précisément — de réparer un binding raté. Le lier à une touche
 * qu'on ne retrouve plus enfermerait le joueur dans sa partie, sans aucun recours à l'écran.
 */
export const INREBINDABLE: readonly ActionJeu[] = ['toggleMenu']

/** Le jeu livré, sous la forme du type effectif (une copie, jamais la constante elle-même). */
export function keymapLivre(): KeymapEffectif {
  const out = {} as Record<ActionJeu, readonly string[]>
  for (const a of Object.keys(KEYMAP) as ActionJeu[]) out[a] = [...KEYMAP[a]]
  return out
}

/** FUSIONNE le livré et le choix du joueur. Pure — c'est ce que le jeu et l'écran lisent tous deux. */
export function fusionne(perso: KeymapPerso): KeymapEffectif {
  const out = keymapLivre()
  for (const a of Object.keys(out) as ActionJeu[]) {
    const choix = perso[a]
    if (choix) out[a] = [...choix]
  }
  return out
}

/**
 * POSE une touche sur une action, et RÈGLE LE CONFLIT : celui qui l'avait la perd.
 *
 * On VOLE plutôt que de refuser. Refuser oblige le joueur à deviner qui détient la touche puis
 * à aller la libérer d'abord — pour un clavier entier à réorganiser, c'est une chasse. Voler
 * laisse l'autre action SANS touche, ce que l'écran montre par un tiret : le travail restant
 * est visible, à sa place, au lieu d'être un refus qu'on ne comprend pas.
 *
 * Rend un NOUVEL objet (jamais de mutation) : c'est ce qui rend la fonction testable et la
 * prévisualisation possible.
 */
export function poseBinding(perso: KeymapPerso, action: ActionJeu, touche: string): KeymapPerso {
  if (INREBINDABLE.includes(action)) return perso
  const effectif = fusionne(perso)
  const suivant: KeymapPerso = { ...perso }
  for (const a of Object.keys(effectif) as ActionJeu[]) {
    if (a === action) continue
    if (!effectif[a].includes(touche)) continue
    // Le voleur ne dépouille pas la sortie de secours : ÉCHAP garde sa touche quoi qu'il arrive.
    if (INREBINDABLE.includes(a)) return perso
    suivant[a] = effectif[a].filter((t) => t !== touche)
  }
  suivant[action] = [touche] // UNE touche : le choix du joueur remplace les alias livrés
  return suivant
}

/** REND À UNE ACTION ses touches d'origine (alias compris), ou à TOUTES si on ne nomme personne. */
export function reinitialise(perso: KeymapPerso, action?: ActionJeu): KeymapPerso {
  if (!action) return {}
  const suivant = { ...perso }
  delete suivant[action]
  return suivant
}

/** Quelles actions n'ont plus AUCUNE touche — l'écran les signale, le joueur les répare. */
export function actionsMuettes(effectif: KeymapEffectif): ActionJeu[] {
  return (Object.keys(effectif) as ActionJeu[]).filter((a) => effectif[a].length === 0)
}

// ── LE DISQUE ────────────────────────────────────────────────────────────────────────────
// `localStorage` : quinze lignes lues au montage d'un écran, écrites à chaque touche posée.
// Le coffre de la Veillée (IndexedDB, asynchrone) est fait pour des mondes ; et surtout, des
// touches ne se rangent PAS dans une sauvegarde de partie — elles valent pour toutes.

const CLE = 'braises.touches'

/**
 * Relit le choix du joueur. NE JETTE JAMAIS et FILTRE : une clé écrite par une version où une
 * action n'existait pas (ou plus) est ignorée, plutôt que de faire tomber tout le réglage.
 * Un joueur qui a rebindé dix touches ne doit pas les perdre parce que la onzième a disparu.
 */
export function lireKeymapPerso(): KeymapPerso {
  let brut: string | null = null
  try {
    brut = localStorage.getItem(CLE)
  } catch {
    return {}
  }
  if (!brut) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(brut)
  } catch {
    return {}
  }
  return nettoieKeymapPerso(parsed)
}

/** La part PURE de la relecture — ce qu'on garde d'un objet venu du disque. Testable seule. */
export function nettoieKeymapPerso(parsed: unknown): KeymapPerso {
  if (typeof parsed !== 'object' || parsed === null) return {}
  const connues = new Set(Object.keys(KEYMAP))
  const out: KeymapPerso = {}
  for (const [cle, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (!connues.has(cle)) continue
    if (INREBINDABLE.includes(cle as ActionJeu)) continue // ÉCHAP ne se rebinde pas, même au disque
    if (!Array.isArray(val)) continue
    const touches = val.filter((t): t is string => typeof t === 'string' && t.length > 0)
    // Une seule touche par action : on ne relit pas plus que ce qu'on sait écrire.
    out[cle as ActionJeu] = touches.slice(0, 1)
  }
  return out
}

/** Range le choix du joueur. Silencieux en cas de refus : on perd un réglage, pas une partie. */
export function ecrireKeymapPerso(perso: KeymapPerso): void {
  try {
    localStorage.setItem(CLE, JSON.stringify(perso))
  } catch {
    /* stockage plein ou refusé : le réglage vaut pour la session */
  }
}

/** LE JEU DE TOUCHES QUE LE JEU DOIT LIRE — livré + choix du joueur, en une seule ligne. */
export function keymapEffectif(): KeymapEffectif {
  return fusionne(lireKeymapPerso())
}
