/**
 * LA source unique des raccourcis clavier de la scène monde. Que des NOMS de
 * touches Phaser (chaînes, résolus en KeyCodes par `input-bindings.ts`) — donc
 * aucun import Phaser, aucune logique : une table qu'on lit et qu'on rebinde
 * en une ligne. Les handlers (viser, cibler le plus proche…) restent dans
 * `input-bindings.ts` ; seule la TOUCHE qui les déclenche vient d'ici.
 *
 * Un test (`keymap.test.ts`) garde l'invariant utile au rebinding : deux
 * actions ne partagent jamais une même touche.
 */

/**
 * Action sémantique → une ou plusieurs touches (alias). Les listes de
 * déplacement sont lues chaque frame (maintien) ; les autres déclenchent une
 * action au `down`.
 */
export const KEYMAP = {
  // Déplacement (maintenu, lu chaque frame)
  moveUp: ['Z', 'W', 'UP'],
  moveDown: ['S', 'DOWN'],
  /**
   * ALLER À GAUCHE — `'Q'` (81), et c'est un choix ZQSD assumé (décision d'Alexis, 2026-07-27).
   *
   * PHASER NE RÉSOUT PAS PAR POSITION PHYSIQUE. Il dispatche sur `event.keyCode`
   * (`KeyboardPlugin.js` : `var code = event.keyCode; var key = keys[code]`), et dans un
   * navigateur ce code suit l'ÉTIQUETTE de la disposition, pas la position — c'est
   * exactement pourquoi WASD ne marche pas en AZERTY. La touche « Q » d'un clavier
   * français émet donc 81, jamais 65. La preuve tient quatre lignes plus haut : si la
   * résolution était physique, `'Z'`(90) et `'W'`(87) seraient deux touches DIFFÉRENTES
   * et le « W » AZERTY (en bas à gauche) ferait monter — l'alias `Z` n'existe que parce
   * que la résolution est par étiquette.
   *
   * On a cru le contraire une fois, et la gauche du ZQSD est morte en silence : `'Q'`
   * retiré de cette ligne, plus rien ne répondait sous l'annulaire. Les tests passaient
   * (ils ne gardent que l'unicité des alias, jamais la couverture de disposition).
   *
   * `'A'` (65) — la touche que l'AZERTY nomme « A » — a servi ici la gauche du QWERTY
   * (WASD). Elle est LIBÉRÉE au profit de `rotateLeft`, qu'elle sert mieux : sur AZERTY
   * elle borde « Z ». CONSÉQUENCE ASSUMÉE : le WASD n'a plus de gauche — un QWERTY va à
   * gauche par « Q » (la touche à gauche de W) ou par la flèche.
   */
  moveLeft: ['Q', 'LEFT'],
  moveRight: ['D', 'RIGHT'],
  sprint: ['SHIFT'],
  /** LE PAS LENT (spec chasse C2) : discret pour la faune, moitié de la vitesse. */
  sneak: ['C'],
  /**
   * LA PARADE (spec combat — blocage directionnel). Un MODIFICATEUR de posture
   * MAINTENU, exactement comme le sprint et le pas lent : on lève la garde tant
   * qu'on tient la touche. Ce n'est PAS un verbe de la ceinture (ceux-là sont partis
   * au clic, 2026-07-12) — c'est une STANCE, au même rang que courir ou ramper, et
   * ces stances-là sont restées au clavier. Le clic droit, lui, est déjà pris par la
   * caméra de visée (lookahead) : le lui voler ferait entrer en garde à chaque coup
   * d'œil au loin. La sim la connaît depuis toujours (`input.block`, combat.ts).
   */
  block: ['SPACE'],
  /**
   * JETER CE QU'ON TIENT (spec chasse C18). Zéro UI : la case active tombe au
   * sol, une unité à la fois. C'est le geste de l'APPÂT (poser des baies et
   * attendre), du JET DE VIANDE à une meute qui vous serre (faune R15, promis par
   * le GDD §9bis et jamais tenu), et de l'allègement d'un porteur en fuite.
   */
  dropHeld: ['G'],
  /**
   * CUEILLIR (fibre, baies, tourbe, cendre — le métier `foraging`, spec
   * recolte-maitrise verbe 3). La SEULE exception au « plus aucun verbe au
   * clavier » (2026-07-12), actée le 2026-07-24 (décision utilisateur) : on POINTE
   * le buisson au curseur et on presse E — le nœud ENTIER vient d'un coup, quoi
   * qu'on tienne. Ce n'est pas l'explosion un-verbe-une-touche qu'on avait bannie
   * (quinze touches saturées) — c'est UNE touche contextuelle « interagir », façon
   * Rust, et elle laisse le CLIC strictement inchangé : une arme frappe toujours,
   * un clic de panique ne part jamais cueillir. La sim connaît `harvest` depuis
   * toujours (economy.ts) ; `whole` y vide le stock d'un seul geste.
   */
  forage: ['F'],
  /**
   * TOURNER CE QU'ON POSE (décision d'Alexis) — deux sens, parce qu'un seul fait tourner en
   * boucle : jusqu'à trois appuis pour revenir en arrière. Deux donnent le TOUR COURT, au pire
   * un cran pour atteindre n'importe quelle arête.
   *
   * ELLES ENCADRENT « HAUT » SUR AZERTY : `'A'`(65) et `'E'`(69) sont les deux voisines
   * immédiates de « Z ». La main ne quitte pas ZQSD. Sur QWERTY ce sont les voisines de la
   * ligne WASD (A à gauche de S, E au-dessus de D) — moins symétrique, toujours à portée.
   *
   * Elles ne mordent sur rien : `forage` a migré de E vers F (F est la touche sous l'index,
   * jamais liée), et `moveLeft` a rendu son alias 65 — Alexis a tranché pour ZQSD, la gauche
   * est « Q »(81). Surtout PAS 81 ici : c'est la gauche du ZQSD, et la lui reprendre a déjà
   * cassé le déplacement une fois (voir `moveLeft`).
   *
   * ELLES NE SONT PAS UN VERBE — elles ne changent pas l'état du monde, elles orientent un
   * FANTÔME avant la pose. À ce titre elles sont du même rang que viser : de l'intention, pas
   * de l'action. C'est ce qui les distingue des quinze touches bannies le 2026-07-12.
   */
  rotateLeft: ['A'],
  rotateRight: ['E'],
  // Les ÉCRANS, et eux seuls (décision utilisateur, 2026-07-12).
  toggleJournal: ['J'],
  toggleMap: ['M'],
  toggleInventory: ['TAB'],
  /** LE MENU PAUSE (reprendre / contrôles / retour au menu principal) : fige le monde solo. */
  toggleMenu: ['ESC'],
  /**
   * COUPER LE SON. Elle vivait EN DUR dans `WorldScene` (`keydown-N`), hors de cette table —
   * donc invisible au rebinding, alors que le menu pause l'annonçait au joueur. Rapatriée ici
   * le 2026-07-28 avec l'écran des réglages : une touche que le jeu écoute et qu'on affiche
   * doit venir d'UNE source, sinon l'écran des touches ment par omission.
   */
  toggleMute: ['N'],
} as const

/*
 * CE QUI A ÉTÉ DÉBRANCHÉ, ET POURQUOI (2026-07-12, décision utilisateur).
 *
 * Le clavier ne porte plus aucun VERBE de jeu : ni attaquer (ESPACE), ni bander
 * (X), ni allumer le Feu (F), ni bâtir (B), ni réparer (G), ni
 * donner (T), ni manger (E/R) — et plus une seule recette (SHIFT+chiffre). Le
 * clic droit (démolir / désarmer) et le SHIFT+clic (partager) tombent avec eux.
 *
 * Ce n'est pas un élagage cosmétique : c'est le préalable à une interaction qui
 * passera par CE QU'ON TIENT (la ceinture) et le clic — le bandage se sélectionne
 * puis s'emploie au clic maintenu, et le craft ne vivra plus sur un raccourci.
 * Une touche par verbe ne tient pas l'échelle du jeu, et SHIFT était déjà chargé
 * trois fois (sprinter, crafter, partager) : sprinter en changeant de case de
 * ceinture LANÇAIT un craft.
 *
 * RIEN N'EST PERDU DANS /sim : `attack`, `bandage`, `build`, `craft`, `eat`,
 * `give`, `repair`, `demolish`, `set_access` existent toujours et sont testées.
 * Seul le câblage clavier a disparu — il se rebranche en une ligne, ici.
 */

/**
 * Les touches du mode DEBUG — câblées uniquement en développement
 * (`debug-bindings.ts`, gardé par `import.meta.env.DEV`). Séparées de KEYMAP
 * pour qu'un rebinding de jeu ne les voie même pas ; le test d'unicité, lui,
 * les inclut (une touche de debug qui volerait une touche de jeu serait un
 * bug silencieux en playtest).
 */
export const DEBUG_KEYMAP = {
  /** Arme/désarme le mode (tout le reste est inerte tant qu'il est éteint). */
  toggle: ['P'],
  /** Invulnérabilité + jauges gelées. */
  god: ['F2'],
  /** Bascule jour ↔ nuit (force l'heure à midi ou minuit). */
  cycleDayNight: ['F3'],
  /** Cadence de l'hôte : ×1 → ×2 → ×4 → ×8 → ×1. */
  cycleSpeed: ['F4'],
} as const

/** La CEINTURE : touches 1-6 → case active 0-5 (spec inventaire R17). */
export const BELT_BINDINGS: readonly [string, number][] = [
  ['ONE', 0],
  ['TWO', 1],
  ['THREE', 2],
  ['FOUR', 3],
  ['FIVE', 4],
  ['SIX', 5],
]

// La table `BUILDABLE_CYCLE` (l'ancien cycle du mode construction sur `B`) est
// MORTE avec LE PIVOT RUST (spec construction R20) : les pièces structurelles
// s'arment désormais au MENU DU MARTEAU (`ui/build-menu.ts`), pas par une touche.
