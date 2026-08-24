/**
 * Tous les bindings clavier/souris de la scène monde : on traduit une frappe
 * en `PlayerAction` — aucune logique de jeu (elle vit dans /sim). QUELLE touche
 * déclenche quoi vit dans `keymap.ts` (table déclarative) ; ici on ne fait que
 * la câbler à un handler.
 *
 * DÉBRANCHEMENT DU 2026-07-12 (décision utilisateur) : le clavier ne porte plus
 * aucun VERBE de jeu — plus d'attaque, de parade, de bandage, de Feu, de mode
 * construction, de réparation, de don, de repas, ni de craft sur SHIFT+chiffre.
 * Le clic droit (démolir/désarmer) et le SHIFT+clic (partager) tombent avec eux.
 * Il ne reste que : se déplacer, sprinter, tenir une case (1-6, molette), viser,
 * récolter/looter au clic maintenu, et ouvrir les trois écrans (J, M, TAB).
 * L'interaction repassera par CE QU'ON TIENT — voir le commentaire de `keymap.ts`.
 * Rien n'est perdu dans /sim : les actions existent toutes, seul le câblage saute.
 *
 * Les deps sont des ACCESSEURS (closures), pas des copies : structures,
 * nœuds, cadavres et position prédite changent à chaque snapshot ou frame —
 * chaque handler lit l'état AU MOMENT de la frappe.
 */
import { BALANCE, COMPONENT_TYPES, EDGE_BITS, NODE_DEFS, SLOTS, edgeBarrierAt, isRangedWeapon, type Corpse, type PlayerAction, type ResourceNode, type Structure } from '@ashes/sim'
import Phaser from 'phaser'
import { getHud, setHud, type Placeable } from '../../hud-state'
import { TILE_PX } from '../../render/framing'
import { aimAt, clickToAction, demolishTargetAt, holdHarvest, interactTargetAt, type AimTarget, type BuildContext, type HandContext, type InteractTarget } from './aim'
import { BELT_BINDINGS } from './keymap'
import { keymapEffectif } from './keymap-perso'
import { corpsSousCurseur, directionDeVisee, surSilhouette, type CorpsVisable } from './visee-corps'

export interface InputDeps {
  sendAction(action: PlayerAction): void
  /** Position LOGIQUE du joueur (ancre autorité) — pour viser, mesurer une distance. */
  predicted(): { x: number; y: number }
  structures(): Structure[]
  nodes(): ResourceNode[]
  corpses(): Corpse[]
  /** LES PILES AU SOL (spec chasse C18) — ce qu'on a jeté, et les flèches retombées
   *  (`tir.md` T6). Cibles de `pick_up`, à la touche « interagir ». */
  piles(): readonly { id: number; x: number; y: number }[]
  /** MA charge, telle que le DERNIER SNAPSHOT la connaît — l'accusé de réception du
   *  décochage. Voir `decocher` : on ne rebande pas tant que la sim n'a pas pris le tir. */
  chargeEnCours(): boolean
  /** MA LIGNE est-elle tendue (dernier snapshot) ? Tant qu'elle l'est, le clic gauche FERRE
   *  (`harvest_release`) au lieu de viser quoi que ce soit (spec peche.md G4). */
  ligneTendue(): boolean
  /**
   * CETTE TUILE PORTE-T-ELLE DE L'EAU, AUJOURD'HUI ? (spec `peche.md` D9/E6)
   *
   * Depuis qu'on pêche l'EAU et non un nœud, la visée doit savoir où il y en a — et « où il y
   * a de l'eau » dépend du JOUR (une mare part à la sécheresse, la crue en ajoute). La scène
   * la lit avec `porteDeLEau` de /sim, la MÊME loi que la sim revalidera au lancer ; `aim.ts`
   * reste pur et n'ouvre jamais la carte.
   */
  porteDeLEau(tx: number, ty: number): boolean
  /** Les autres ENTITÉS (PNJ/joueurs) — SANS soi ni les monstres : les cibles d'un DON.
   *  Position LOGIQUE (tuiles), pour viser dans le même repère que les nœuds. */
  others(): { id: number; x: number; y: number }[]
  /**
   * TOUS LES CORPS VIVANTS, silhouette RENDUE comprise — bêtes incluses, contrairement à
   * `others()`. C'est ce qui permet de viser CE QU'ON VOIT et non le sol derrière : le
   * curseur tombe sur un billboard debout, la sim recevait une direction vers le sol
   * (voir `visee-corps.ts` — 23 à 28 % des coups atteignables se perdaient là).
   */
  corps(): CorpsVisable[]
  /** Corrige un point monde PLAT (positionToCamera) en point monde vrai, selon le relief. */
  unproject(px: number, py: number): { x: number; y: number }
  /** Le tick du dernier snapshot — pour juger la maturité d'une parcelle (agriculture). */
  simTick(): number
  /** L'id de MON avatar — ce qui décide de ce que le mode DÉMOLIR peut viser : mes
   *  constructions, et elles seules (décision d'Alexis, 2026-08-01). */
  playerId(): number
}

/** Les touches de déplacement, lues chaque frame par `WorldScene.update`. */
export interface MovementBindings {
  keys: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key[]>
  sprintKeys: Phaser.Input.Keyboard.Key[]
  /** Le PAS LENT (spec chasse C2), maintenu comme le sprint. */
  sneakKeys: Phaser.Input.Keyboard.Key[]
  /** LA PARADE (spec combat), maintenue comme le sprint — une posture, pas un verbe. */
  blockKeys: Phaser.Input.Keyboard.Key[]
  /** Entretient le clic MAINTENU (récolte en boucle) — à appeler chaque frame. */
  tickHold(): void
  /** ABANDONNE tout geste maintenu en cours (charge/abattage/minage/récolte) sans rien émettre.
   *  À appeler quand l'input se coupe (la mort) pour ne pas traîner une charge jusqu'au respawn. */
  cancelHold(): void
  /** Ce que vise le curseur MAINTENANT — pour le surlignage et le fantôme. */
  aim(pointer: Phaser.Input.Pointer): AimTarget
  /**
   * CE QUE LA TOUCHE D'INTERACTION (`F`) FERAIT SI ON L'ENFONÇAIT À CETTE FRAME — feu,
   * buisson de cueillette ou pile au sol sous le curseur ; `null` = rien (ou un overlay
   * mange la touche). C'est ce que le contour blanc entoure : le geste et sa promesse
   * lisent le MÊME résolveur, aux mêmes gardes, ou le contour finirait par mentir.
   */
  interactTarget(pointer: Phaser.Input.Pointer): InteractTarget | null
  /**
   * VERS OÙ ON VISE, MAINTENANT — la direction EXACTE que `attack_release` enverrait si le
   * doigt tombait à cette frame (verrou de visée-corps compris). C'est la cible du lissage
   * du télégraphe de l'arc (`visee-lissee.ts`) : la sim tire avec la direction du
   * DÉCOCHAGE, pas avec l'écho de la dernière re-visée, donc c'est celle-là que la ligne
   * doit rejoindre. Non normalisée — comme partout, la sim renormalise.
   */
  visee(): { dx: number; dy: number }
  /** Le curseur en TUILES, fraction comprise — ce qui désigne l'ARÊTE visée en mode démolir. */
  curseur(pointer: Phaser.Input.Pointer): { x: number; y: number }
  /** Ce que le clic gauche POSERAIT maintenant : une construction armée au panneau
   *  (marteau en main), ou `'fire'` si l'on tient un feu de camp dans la ceinture.
   *  `null` = rien à poser. Le fantôme et le résolveur de clic le lisent ici. */
  placing(): Placeable | null
}

/** Le rechargement de récolte, en millisecondes — le client cadence ses envois
 *  dessus (spec recolte.md G7). Dérivé de la sim : une seule source. */
const GATHER_COOLDOWN_MS = (BALANCE.GATHER_COOLDOWN_TICKS / BALANCE.TICK_RATE_HZ) * 1000

/**
 * Le conteneur à looter à l'ouverture de TAB : le plus proche à `INTERACT_RANGE`
 * de la position prédite, un CADAVRE primant sur un coffre à égalité d'intention
 * (on ouvre ce qu'on vient de tuer). `null` si rien n'est à portée. Aucune règle
 * de jeu ici — juste la cible ; la sim revalide la portée à chaque `transfer`.
 */
function nearestContainer(deps: InputDeps): { kind: 'structure' | 'corpse'; id: number } | null {
  const p = deps.predicted()
  const range = BALANCE.INTERACT_RANGE
  const withinSq = range * range

  // UNE BÊTE NE S'OUVRE PAS AU TAB (spec `depecage.md` R3) : son réservoir se vide au couteau.
  const corpse = deps
    .corpses()
    .filter((c) => c.carcass === undefined)
    .map((c) => ({ id: c.id, d: (c.x - p.x) ** 2 + (c.y - p.y) ** 2 }))
    .filter((c) => c.d <= withinSq)
    .sort((a, b) => a.d - b.d)[0]
  if (corpse) return { kind: 'corpse', id: corpse.id }

  const chest = deps
    .structures()
    .filter((s) => s.inventory !== undefined) // seuls les conteneurs (coffres)
    .map((s) => ({ id: s.id, d: (s.tx + 0.5 - p.x) ** 2 + (s.ty + 0.5 - p.y) ** 2 }))
    .filter((s) => s.d <= withinSq)
    .sort((a, b) => a.d - b.d)[0]
  if (chest) return { kind: 'structure', id: chest.id }

  return null
}

export function bindInputs(scene: Phaser.Scene, deps: InputDeps): MovementBindings {
  const kb = scene.input.keyboard!
  const K = Phaser.Input.Keyboard.KeyCodes as Record<string, number>
  /**
   * LE JEU DE TOUCHES EFFECTIF — le livré, écrasé par ce que le joueur a réglé (`keymap-perso`).
   * Lu UNE fois, à la création de la scène : c'est pourquoi un rebind fait recréer les liaisons
   * (voir `recableTouches`), plutôt que de demander au joueur de relancer sa partie.
   */
  const TOUCHES = keymapEffectif()
  /**
   * Un nom que `KeyCodes` ne connaît pas ne doit RIEN casser : `addKey(undefined)` jetterait, et
   * le jeu entier tomberait pour un réglage corrompu à la main dans le stockage. On saute.
   */
  const grab = (names: readonly string[]): Phaser.Input.Keyboard.Key[] =>
    names.filter((n) => K[n] !== undefined).map((n) => kb.addKey(K[n]!, false))
  /**
   * LE CHAMP DE RECHERCHE A-T-IL LE CLAVIER ? Si oui, plus AUCUNE touche ne part
   * au jeu : taper « hache » dans le panneau de craft ferait sinon marcher le
   * personnage (Z, Q, S, D sont des lettres) et « journal » ouvrirait le journal.
   */
  const typing = (): boolean =>
    Boolean(getHud(scene.registry, 'uiTyping')) ||
    Boolean(getHud(scene.registry, 'chatTyping')) ||
    Boolean(getHud(scene.registry, 'debugTyping'))

  /** Câble un handler `down` sur chaque alias d'une action (KEYMAP). MUET tant que
   *  le champ de recherche a le clavier — ET tant qu'un panneau plein écran est ouvert.
   *
   *  La seconde moitié manquait : la ceinture 1-6 et `drop_held` passaient au travers du
   *  menu pause. On changeait d'arme et on JETAIT SON SAC AU SOL, pour de vrai, pendant
   *  qu'on croyait le jeu arrêté.
   *
   *  ⚠ LE MENU PAUSE SEUL, PAS `overlayOpen()`. La garde des handlers SOURIS est plus large
   *  (carte, sac, panneau du feu) parce qu'un panneau MANGE LE CLIC : viser le monde à
   *  travers lui n'a pas de sens. Le clavier, lui, n'est pas mangé — et presser `1`-`6` en
   *  REGARDANT son sac est un geste normal, pas une erreur. Prendre la ligne large aurait
   *  corrigé le trou en cassant l'usage : le seul état qui doit tout taire est celui qui
   *  prétend que le jeu est ARRÊTÉ. Même règle que le pas (`mains-libres.ts`), et même
   *  question laissée à Alexis pour la carte et l'écran personnage. */
  const enPause = (): boolean => Boolean(getHud(scene.registry, 'menuOpen'))
  const onDown = (names: readonly string[], fn: () => void): void => {
    for (const n of names) {
      if (K[n] === undefined) continue
      kb.addKey(K[n]!, false).on('down', () => {
        if (typing() || enPause()) return
        fn()
      })
    }
  }
  /** …sauf TAB, qui doit TOUJOURS pouvoir refermer l'écran. Une touche de sortie
   *  qu'on peut se retrouver à ne plus pouvoir presser est un piège : on tape dans
   *  la recherche, on veut fermer le sac, et plus rien ne répond. */
  const onDownAlways = (names: readonly string[], fn: () => void): void => {
    for (const n of names) {
      if (K[n] === undefined) continue
      kb.addKey(K[n]!, false).on('down', fn)
    }
  }
  // Le pointeur en monde PLAT, puis corrigé de l'élévation : la tuile réellement
  // SOUS le curseur, pas celle du sol non déformé (spec relief-continu §4.4).
  const pointerToWorld = (pointer: Phaser.Input.Pointer): Phaser.Math.Vector2 => {
    const flat = pointer.positionToCamera(scene.cameras.main) as Phaser.Math.Vector2
    const w = deps.unproject(flat.x, flat.y)
    return new Phaser.Math.Vector2(w.x, w.y)
  }

  const keys = {
    up: grab(TOUCHES.moveUp),
    down: grab(TOUCHES.moveDown),
    left: grab(TOUCHES.moveLeft),
    right: grab(TOUCHES.moveRight),
  }
  const sprintKeys = grab(TOUCHES.sprint)
  const sneakKeys = grab(TOUCHES.sneak)
  // La garde est une STANCE maintenue (comme sprint/sneak). On CAPTURE l'espace :
  // sans ça, le navigateur peut faire défiler la page ou (re)cliquer un bouton DOM
  // qui a le focus — une garde qui scrolle l'écran n'est pas une garde.
  const blockKeys = grab(TOUCHES.block)
  // Une action peut n'avoir PLUS de touche (le joueur l'a donnée à une autre) : on ne capture
  // alors rien. Sans cette garde, `addCapture(undefined)` tuait la scène au démarrage.
  if (TOUCHES.block[0]) kb.addCapture(TOUCHES.block[0])

  // CE QUE LE CLIC POSERAIT. Deux sources, une seule notion : une CONSTRUCTION armée
  // au panneau (marteau en main, lue dans le HUD), OU le FEU DE CAMP qu'on tient dans
  // la ceinture. On peut poser plusieurs feux librement — la promotion en foyer, elle,
  // est un geste à part (fenêtre du bas → `found_village`). Le fantôme et le résolveur
  // de clic (aim.ts) le lisent ici, jamais l'un sans l'autre.
  const placing = (): Placeable | null => {
    const armed = getHud(scene.registry, 'selected') ?? null
    if (armed !== null) return armed
    const inv = getHud(scene.registry, 'inv') ?? []
    const slot = getHud(scene.registry, 'activeSlot') ?? -1
    const held = slot >= 0 ? (inv[slot]?.item ?? null) : null
    if (held === 'campfire') return 'fire'
    // Un COMPOSANT (enclume, four…) ou le COFFRE tenu s'arme comme le feu de camp (R20).
    if (held !== null && ((COMPONENT_TYPES as readonly string[]).includes(held) || held === 'chest')) return held as Placeable
    return null
  }

  /** Le contexte de POSE (spec construction R8) : le palier de matériau choisi au
   *  menu du marteau, et la structure DÉJÀ sur la tuile visée (pour l'améliorer). */
  const buildCtx = (aim: AimTarget, curseur: { x: number; y: number }): BuildContext => {
    const material = getHud(scene.registry, 'buildMaterial') ?? 'wood'
    const edge = getHud(scene.registry, 'buildEdge') ?? EDGE_BITS[0]!
    const armed = getHud(scene.registry, 'selected') ?? null
    // MODE DÉMOLIR : la cible n'est plus « ce qu'on améliorerait » mais ce qu'on DÉTRUIRAIT
    // — mes constructions seules, désignées AU CURSEUR (l'arête armée est invisible tant que
    // le fantôme est éteint). Même fonction que le surlignage rouge de WorldScene, mêmes
    // arguments : les deux ne peuvent pas désigner deux pièces différentes.
    if (getHud(scene.registry, 'demolir') === true) {
      const cible = demolishTargetAt(deps.structures(), curseur.x, curseur.y, deps.playerId())
      return { material, edge, demolir: true, onTile: cible ? { id: cible.id, type: cible.type } : null }
    }
    // CE QU'ON AMÉLIORE D'UN CLIC : la barrière qui porte l'ARÊTE VISÉE quand on tient un mur ou
    // une porte (R23), et non plus « la première structure de la tuile ». Un coin de pièce porte
    // déjà un mur au nord ; le lire améliorerait celui-là au lieu de poser celui de l'ouest, et
    // fermer un angle — le geste le plus courant de la construction — deviendrait impossible.
    const s = armed === 'wall' || armed === 'door' || armed === 'palissade'
      ? edgeBarrierAt(deps.structures(), aim.tx, aim.ty, edge) ?? null
      : deps.structures().find((st) => st.tx === aim.tx && st.ty === aim.ty) ?? null
    return { material, edge, onTile: s ? { id: s.id, type: s.type } : null }
  }

  // La CEINTURE : 1-6 tiennent une case (spec inventaire R17). Affichage
  // optimiste (R22) — on surligne tout de suite, le prochain snapshot fait foi.
  // Plus aucun modificateur à lire : SHIFT+chiffre ne crafte plus (il sprintait
  // ET craftait, donc changer de case en courant lançait une recette).
  for (const [name, slot] of BELT_BINDINGS) {
    onDown([name], () => {
      deps.sendAction({ type: 'set_active_slot', slot })
      setHud(scene.registry, 'activeSlot', slot)
    })
  }

  /**
   * G : JE JETTE CE QUE JE TIENS (spec chasse C18). Une unité de la case active
   * tombe au sol — zéro UI, zéro menu. C'est le geste de l'APPÂT (poser des
   * baies et attendre à couvert), du JET DE VIANDE à une meute qui vous serre
   * (faune R15, promis par le GDD §9bis et enfin exécutable), et de
   * l'allègement d'un porteur en fuite. La sim valide : rien en main, rien ne
   * tombe. Un clic gauche sur une pile la RAMASSE (voir `clickToAction`).
   */
  onDown(TOUCHES.dropHeld, () => {
    deps.sendAction({ type: 'drop_held' })
  })

  /**
   * A / E : JE FAIS TOURNER CE QUE JE POSE (spec construction R23, décision d'Alexis).
   *
   * Ces deux touches étaient DÉCLARÉES depuis le 2026-07-27 et lues par personne — la note de
   * `keymap-perso` le disait mot pour mot, en attendant que la pose sur arête existe. Elle
   * existe : le mur et la porte ne prennent plus une tuile, ils se posent sur une des quatre
   * ARÊTES de la tuile visée, et c'est ici qu'on choisit laquelle.
   *
   * DEUX SENS, et c'est la raison d'être de la paire : un seul sens ferait jusqu'à trois appuis
   * pour revenir en arrière ; à deux, n'importe quelle arête est à UN cran.
   *
   * ELLES NE SONT PAS UN VERBE — elles ne touchent pas au monde, elles orientent une INTENTION.
   * Aucune action ne part : on écrit dans le HUD, le fantôme suit, et c'est le clic qui pose.
   * C'est ce qui les distingue des quinze touches bannies le 2026-07-12.
   */
  const tourner = (sens: 1 | -1): void => {
    // On tourne même DÉSARMÉ : l'arête persiste, et s'armer ensuite retrouve son orientation.
    // La barrer sur `placing` obligerait à re-tourner après chaque changement d'outil.
    const courant = getHud(scene.registry, 'buildEdge') ?? EDGE_BITS[0]!
    const i = EDGE_BITS.indexOf(courant)
    // ORDRE HORAIRE (N → E → S → O), celui de `EDGE_BITS` — le même que /sim, jamais recopié.
    const suivant = EDGE_BITS[(((i < 0 ? 0 : i) + sens + EDGE_BITS.length) % EDGE_BITS.length)]!
    setHud(scene.registry, 'buildEdge', suivant)
  }
  onDown(TOUCHES.rotateLeft, () => tourner(-1))
  onDown(TOUCHES.rotateRight, () => tourner(1))

  // TAB : ouvre/ferme l'écran d'inventaire. On capture la touche : sinon le
  // navigateur déplace le focus hors du canvas. À l'OUVERTURE, on choisit le
  // conteneur à looter — le plus proche à portée, un cadavre primant sur un
  // coffre (on loote ce qu'on vient de tuer) ; à la FERMETURE on l'oublie.
  if (TOUCHES.toggleInventory[0]) kb.addCapture(TOUCHES.toggleInventory[0])
  onDownAlways(TOUCHES.toggleInventory, () => {
    const opening = !getHud(scene.registry, 'characterMenuOpen')
    setHud(scene.registry, 'characterMenuOpen', opening)
    // TAB rouvre TOUJOURS sur PERSONNAGE (l'usage premier) — pas sur les métiers ni sur la
    // carte, où l'on n'atterrit que par choix (clic d'onglet ou M).
    setHud(scene.registry, 'characterTab', 'perso')
    setHud(scene.registry, 'openContainer', opening ? nearestContainer(deps) : null)
  })

  // La molette fait défiler la case tenue, bornée à la ceinture — sauf quand
  // l'inventaire ou la carte est ouvert (la molette y sert au zoom).
  scene.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
    if (getHud(scene.registry, 'mapOpen') || getHud(scene.registry, 'characterMenuOpen')) return
    const belt = SLOTS.BELT
    const current = getHud(scene.registry, 'activeSlot') ?? -1
    // Depuis les mains nues (-1), molette avant → case 0 ; arrière → dernière case.
    const base = current < 0 ? (dy < 0 ? -1 : 0) : current
    const next = (((base + (dy < 0 ? 1 : -1)) % belt) + belt) % belt
    deps.sendAction({ type: 'set_active_slot', slot: next })
    setHud(scene.registry, 'activeSlot', next)
  })

  // J : le journal. M : la CARTE — devenue un ONGLET de l'écran personnage (décision
  // d'Alexis, 2026-07-25). M ouvre donc l'écran DIRECTEMENT dessus, et le referme si l'on
  // y est déjà. Depuis un autre onglet, M bascule sur la carte sans refermer.
  onDown(TOUCHES.toggleJournal, () => {
    setHud(scene.registry, 'journalOpen', !getHud(scene.registry, 'journalOpen'))
  })
  onDown(TOUCHES.toggleMap, () => {
    const onMap = Boolean(getHud(scene.registry, 'mapOpen'))
    setHud(scene.registry, 'characterMenuOpen', !onMap)
    setHud(scene.registry, 'characterTab', onMap ? 'perso' : 'carte')
    // La carte n'est pas un écran de loot : on n'y ouvre aucun conteneur, et on referme
    // celui qu'un TAB aurait ouvert (l'écran change de sujet).
    setHud(scene.registry, 'openContainer', null)
  })
  // ESC : le menu PAUSE. WorldScene fige/reprend l'hôte selon `menuOpen` (le monde solo se gèle).
  //
  // ⚠ `onDownAlways`, POUR LA MÊME RAISON QUE TAB : une touche de SORTIE qu'on ne peut plus
  // presser est un piège. Câblée sur `onDown` — qui se tait désormais menu ouvert, pour que la
  // ceinture et « jeter » cessent d'agir sous le menu pause — ESC s'interdisait lui-même : on
  // ouvrait le menu et on ne le refermait plus. Trouvé au navigateur (`smoke --scenario pause`,
  // « après 2ᵉ ESC : menuOpen true »), et par aucun test : la scène n'en a pas.
  onDownAlways(TOUCHES.toggleMenu, () => {
    setHud(scene.registry, 'menuOpen', !getHud(scene.registry, 'menuOpen'))
  })

  /** La tuile sous le curseur, et ce qu'elle porte. Recalculée à la demande : le
   *  curseur bouge, le nœud s'épuise, et la caméra GLISSE ENCORE après la course
   *  — une visée mémorisée au `pointerdown` viserait déjà ailleurs (recolte.md G8). */
  /**
   * LE CURSEUR EN TUILES, FRACTION COMPRISE — la tuile visée ne suffit pas au mode DÉMOLIR :
   * une tuile porte jusqu'à quatre arêtes, et c'est la position DANS la tuile qui dit laquelle
   * on montre. Un seul accesseur pour les deux lecteurs (le surlignage de WorldScene et le
   * résolveur de clic) : deux calculs désigneraient deux murs différents.
   */
  const curseurTuile = (pointer: Phaser.Input.Pointer): { x: number; y: number } => {
    const world = pointerToWorld(pointer)
    return { x: world.x / TILE_PX, y: world.y / TILE_PX }
  }
  const aimNow = (pointer: Phaser.Input.Pointer): AimTarget => {
    const world = pointerToWorld(pointer)
    return aimAt(
      Math.floor(world.x / TILE_PX),
      Math.floor(world.y / TILE_PX),
      deps.predicted(),
      deps.nodes(),
      deps.corpses(),
      BALANCE.INTERACT_RANGE,
      deps.others(),
      deps.structures(), // Feu (feed_fire), structure abîmée (repair), parcelle (agriculture) visés
      deps.simTick(), // pour juger la maturité d'une parcelle
      deps.piles(), // les tas au sol : flèches retombées, appâts, charge larguée
      deps.porteDeLEau, // l'eau du jour (peche.md D9) : où la ligne peut tomber
    )
  }
  /** L'overlay (carte, sac, menu pause) mange le clic : il ne doit pas agir dans le monde. */
  const overlayOpen = (): boolean =>
    Boolean(getHud(scene.registry, 'mapOpen')) ||
    Boolean(getHud(scene.registry, 'characterMenuOpen')) ||
    Boolean(getHud(scene.registry, 'menuOpen')) ||
    Boolean(getHud(scene.registry, 'openFire'))

  /**
   * CE QU'ON TIENT, ET VERS OÙ ON VISE. C'est tout ce dont le résolveur pur a
   * besoin pour décider du clic (aim.ts) : manger, frapper, récolter, fouiller.
   * Le client ne décide de RIEN d'autre — la sim tranche, comme toujours.
   */
  const handAt = (pointer: Phaser.Input.Pointer): HandContext => {
    const inv = getHud(scene.registry, 'inv') ?? []
    const slot = getHud(scene.registry, 'activeSlot') ?? -1
    const held = slot >= 0 ? (inv[slot]?.item ?? null) : null
    // BLESSÉ ? Le résolveur en a besoin : des fibres en main + une plaie → se panser
    // (aim.ts). Sans blessure, tenir des fibres ne soigne pas — le clic reste une frappe.
    const w = getHud(scene.registry, 'wounds') ?? {}
    const wounded = Boolean(w.bleeding || w.leg || w.arm)
    const heldCount = slot >= 0 ? (inv[slot]?.count ?? 1) : 1
    const world = pointerToWorld(pointer)
    const p = deps.predicted()
    // ON VISE LE CORPS QU'ON MONTRE, pas le sol derrière lui (voir `visee-corps.ts`).
    const wx = world.x / TILE_PX
    const wy = world.y / TILE_PX
    return { held, slot, wounded, heldCount, ...directionDeVisee(p, wx, wy, corpsVisé(wx, wy)) }
  }

  /**
   * LA VISÉE SEULE, sans le reste de la main — ce que le rendu lit à CHAQUE frame pour poser
   * la ligne de tir (le télégraphe de l'arc la rejoint par un lissage, `visee-lissee.ts`).
   *
   * Elle passe par `corpsVisé`, comme `handAt` : il faut que la ligne se pose exactement là
   * où le décochage enverra le trait — verrou de visée-corps compris. Deux calculs différents
   * finiraient par diverger, et l'écart tomberait pile sur le bord d'une silhouette, là où le
   * joueur regarde le plus.
   */
  const viseeCourante = (): { dx: number; dy: number } => {
    const world = pointerToWorld(scene.input.activePointer)
    const wx = world.x / TILE_PX
    const wy = world.y / TILE_PX
    return directionDeVisee(deps.predicted(), wx, wy, corpsVisé(wx, wy))
  }

  /**
   * LA MARGE DU VERROU DE VISÉE, en tuiles. Une fois le coup ARMÉ sur un corps, le
   * curseur peut frôler son bord sans que la visée retombe au sol : la charge se
   * re-vise toutes les `CHARGE_AIM_MS`, et une visée qui vacille enverrait une
   * direction différente à chaque rafraîchissement — le télégraphe tremblerait, et
   * le coup partirait où le curseur se trouvait au mauvais dixième de seconde.
   * (Même leçon que l'épuisement, spec combat R1ter : un seuil qui commande un
   * geste veut son hystérésis.)
   */
  const MARGE_VERROU_TUILES = 0.35
  /** Le corps sur lequel le coup en cours est armé — `null` hors charge. */
  let corpsVerrou: number | null = null

  /** Le corps que le curseur désigne, VERROUILLÉ tant qu'un coup s'arme dessus. */
  const corpsVisé = (wx: number, wy: number): CorpsVisable | null => {
    const corps = deps.corps()
    if (charging && corpsVerrou !== null) {
      const tenu = corps.find((c) => c.id === corpsVerrou)
      if (tenu && surSilhouette(tenu, wx, wy, MARGE_VERROU_TUILES)) return tenu
    }
    const c = corpsSousCurseur(corps, wx, wy)
    corpsVerrou = c === null ? null : c.id
    return c
  }

  /**
   * LA PORTE LA PLUS PROCHE dans la portée d'interaction, ou `null`.
   *
   * On mesure au CENTRE de sa tuile, comme la sim (`toggle_door` compare à `s.tx + 0.5`) : deux
   * métriques différentes donneraient une porte que le client propose et que le moteur refuse.
   */
  const porteLaPlusProche = (): number | null => {
    const p = deps.predicted()
    const r = BALANCE.INTERACT_RANGE
    let meilleure: number | null = null
    let d2 = r * r
    for (const s of deps.structures()) {
      if (s.type !== 'door') continue
      const dx = s.tx + 0.5 - p.x
      const dy = s.ty + 0.5 - p.y
      const d = dx * dx + dy * dy
      if (d <= d2) {
        d2 = d
        meilleure = s.id
      }
    }
    return meilleure
  }

  /** Le nœud visé est-il un ARBRE (abattage à maîtrise) ? Les arbres passent par la
   *  JAUGE de charge/relâche (spec recolte-maitrise, verbe 1) ; la pierre et les
   *  plantes gardent le clic-maintenu instantané. Robuste aux futurs types d'arbre :
   *  la famille se lit du métier, pas d'une liste de types codée en dur. */
  const isFellNode = (nodeId: number): boolean => {
    const node = deps.nodes().find((n) => n.id === nodeId)
    return node !== undefined && NODE_DEFS[node.type].skill === 'woodcutting'
  }

  // ⚠ `isFishNode` A ÉTÉ RETIRÉ le 2026-08-24 (peche.md D9) : le clic ne route plus le lancer
  // sur le TYPE DU NŒUD visé — il vise une TUILE D'EAU, et `aim.ts` a déjà résolu `cast_line`.
  // Le coin sous la tuile ne change rien au geste, seulement à ce qui mord.

  /** Le nœud visé est-il un FILON/rocher (minage à maîtrise, verbe 2) ? Ils passent par
   *  le VERROU-nœud : on frappe le bon flanc, le curseur indiquant le côté autour du
   *  centre du nœud — même famille lue du métier. */
  const isMineNode = (nodeId: number): boolean => {
    const node = deps.nodes().find((n) => n.id === nodeId)
    return node !== undefined && NODE_DEFS[node.type].skill === 'mining'
  }

  /** Le nœud visé est-il de la CUEILLETTE (`foraging`) ? Depuis le 2026-07-24, la
   *  cueillette est passée à la touche d'INTERACTION (E le 2026-07-24, puis F le 2026-07-27
   *  quand A/E sont devenues la rotation) : le CLIC ne la récolte plus. On l'emploie
   *  pour COUPER le clic sur fibre/baies/tourbe/cendre, aux deux points d'envoi souris
   *  (l'appui `pointerdown` ET le maintien `holdHarvest`) — sinon fouiller un cadavre
   *  puis glisser le curseur sur un buisson cueillerait encore. */
  const isForageNode = (nodeId: number): boolean => {
    const node = deps.nodes().find((n) => n.id === nodeId)
    return node !== undefined && NODE_DEFS[node.type].skill === 'foraging'
  }
  const isClickForage = (a: PlayerAction | null): boolean => a?.type === 'harvest' && isForageNode(a.nodeId)

  /**
   * CE QUE LA TOUCHE D'INTERACTION FERAIT MAINTENANT — la source UNIQUE du geste `F` et du
   * contour blanc qui l'annonce (2026-08-03, demande d'Alexis). La cascade elle-même est
   * pure et testée (`interactTargetAt`) ; ce qu'on ajoute ici, ce sont les GARDES, et elles
   * comptent autant : un overlay ouvert MANGE la touche, donc il doit éteindre le contour.
   * Sinon le monde reste souligné sous le sac, la carte, le menu pause ou le modal du feu —
   * un contour qui désigne un geste que rien ne peut déclencher.
   *
   * `overlayOpen()` couvre les quatre, `openFire` compris : la touche y REFERME le modal
   * au lieu d'agir sur ce qu'on survole (voir le handler).
   *
   * ⚠ DÉCLARÉ APRÈS `overlayOpen`, `aimNow` ET `isForageNode`, exprès : cette closure SORT
   * d'ici (elle est rendue au caller sous le nom `interactTarget`), donc un appelant futur
   * pourrait la joindre pendant le montage des bindings — et un `const` joint avant sa ligne
   * lève un `ReferenceError` que `tsc` ne voit pas. L'ordre de déclaration est la seule garde.
   */
  const interactCible = (pointer: Phaser.Input.Pointer): InteractTarget | null =>
    typing() || overlayOpen() ? null : interactTargetAt(aimNow(pointer), isForageNode)

  /** La position MONDE (en tuiles) du curseur — la visée du minage. La sim en déduit le
   *  flanc frappé (spec verbe 2). Attachée à tout `harvest` ; ignorée hors nœud de minage. */
  const cursorAim = (pointer: Phaser.Input.Pointer): { aimX: number; aimY: number } => {
    const w = pointerToWorld(pointer)
    return { aimX: w.x / TILE_PX, aimY: w.y / TILE_PX }
  }

  // Le clic MAINTENU récolte en boucle, cadencé par le rechargement (G6-G7).
  let holding = false
  let lastHarvestAt = -Infinity
  /**
   * LE CLIC MAINTENU SUR UNE ATTAQUE NE MARTÈLE PLUS : IL CHARGE (spec combat R4ter).
   * On n'envoie donc pas d'`attack` à l'appui — on envoie `attack_charge`, et le coup
   * ne part qu'au `attack_release`. La sim COMPTE le maintien et décide seule si le
   * coup sort simple ou lourd : le client ne dit que « j'appuie, et je vise par là ».
   *
   * La visée se RAFRAÎCHIT pendant la charge (le curseur bouge, le loup contourne) —
   * cadencée, pas à chaque frame : à 60 fps, une action par frame noierait le flux
   * d'événements que l'alignement et la chronique consomment (recolte.md G6).
   */
  let charging = false
  let lastAimAt = -Infinity
  const CHARGE_AIM_MS = 100

  /**
   * ═══ L'ARC : LE DROIT LÈVE, LE GAUCHE DÉCOCHE, LE RELÂCHEMENT RABAISSE ═══
   * (spec `tir.md` T2, décision d'Alexis, 2026-08-02)
   *
   * Deux faits mesurés ont décidé de cette grammaire, et aucun n'est une affaire de
   * confort du doigt :
   *
   * ① L'ARC LONG TIRE PLUS LOIN QU'ON NE VOIT — 11 tuiles de portée pour 10 de demi-écran
   *   (`VISIBLE_TILES_TALL` = 20). Sans le décalage caméra du clic droit (client R11), une
   *   cible plein nord à portée maximale est HORS DE L'ÉCRAN. Viser et bander ne pouvaient
   *   donc pas être deux gestes indépendants.
   *
   * ② IL N'EXISTAIT AUCUNE ANNULATION DE CHARGE. Le clic droit sert à REGARDER AU LOIN :
   *   une grammaire où relâcher TIRE ferait payer une flèche à chaque coup d'œil à
   *   l'horizon. Et on ne peut pas la sauver par un seuil minimal de bande — la bande
   *   courte EST le tir sec, les deux se confondraient.
   *
   * D'où `attack_cancel`, qui répare au passage un défaut plus ancien : ouvrir son sac en
   * pleine charge de HACHE envoyait un coup dans le vide (voir `tickHold`).
   *
   * `aiming` est le pendant droit de `charging` : deux drapeaux et non un, parce que les
   * deux gestes n'ont ni le même bouton de sortie ni la même issue par défaut.
   */
  let aiming = false
  /**
   * ON A DÉCOCHÉ ET LA SIM NE L'A PAS ENCORE PRIS — on ne rebande pas tant que c'est vrai.
   *
   * ⚠ CE DRAPEAU A REMPLACÉ UN DÉLAI EN MILLISECONDES, ET LA LEÇON VAUT D'ÊTRE ÉCRITE.
   * L'hôte ne garde qu'UNE action par tick (`pendingAction`) : un `attack_charge` émis trop
   * tôt ÉCRASE l'`attack_release` qui le précède, et le tir n'a jamais lieu. Le premier
   * remède était « attendre 250 ms » — MESURÉ au smoke, il n'a rien changé : le
   * ré-armement partait **2 ms** après le décochage. Le handler de clic et `tickHold`
   * s'exécutent l'un derrière l'autre dans la MÊME frame, mais `scene.time.now` a déjà
   * bondi d'une seconde entre les deux (la frame précédente à 1 im/s) — un garde sur
   * l'horloge d'affichage ne dit RIEN du temps réel écoulé.
   *
   * On attend donc la seule chose qui prouve que le tir est passé : que la SIM ne nous
   * connaisse plus de charge. C'est vrai à n'importe quelle cadence d'image.
   */
  let attenteDecochage = false
  const tientUnArc = (): boolean => isRangedWeapon(handAt(scene.input.activePointer).held ?? 'unarmed')

  /** Le coup part (ou la charge s'annule si le curseur a fini sur un overlay). */
  const releaseCharge = (pointer: Phaser.Input.Pointer): void => {
    if (!charging) return
    charging = false
    const hand = handAt(pointer)
    deps.sendAction({ type: 'attack_release', dx: hand.dx, dy: hand.dy })
  }

  /** L'arc se RABAISSE : rien ne part, la flèche reste au carquois. */
  const baisserArc = (): void => {
    if (!aiming) return
    aiming = false
    deps.sendAction({ type: 'attack_cancel' })
  }

  /**
   * LE TRAIT PART, avec la bande atteinte à cet instant (tôt = sec, mûr = bandé).
   *
   * ET ON REBANDE DIRECT si le doigt n'a pas quitté le bouton droit (décision d'Alexis,
   * 2026-08-02). Le clic droit veut dire « arc LEVÉ », pas « une flèche » : rabaisser
   * l'arc après chaque tir pour le relever aussitôt serait un geste que personne ne fait.
   *
   * On n'envoie RIEN de plus ici — on garde seulement `aiming`, et c'est `tickHold` qui
   * ré-arme à la cadence de re-visée. La sim le sait déjà faire : `attack_charge` avec
   * `hold` est SILENCIEUX quand il tombe pendant une récupération, et « la charge démarre
   * toute seule à la seconde où la récupération s'achève » (combat.ts). Le carquois vide
   * se refuse de la même façon, sans un mot. Rien à ajouter, donc : il suffit de ne pas
   * baisser l'arc.
   */
  const decocher = (pointer: Phaser.Input.Pointer): void => {
    if (!aiming) return
    const hand = handAt(pointer)
    deps.sendAction({ type: 'attack_release', dx: hand.dx, dy: hand.dy })
    aiming = pointer.rightButtonDown() && tientUnArc()
    // ⚠ ON NE RÉ-ARME PAS AVANT QUE LA SIM AIT PRIS LE TIR — voir `attenteDecochage`.
    if (aiming) {
      lastAimAt = scene.time.now
      attenteDecochage = true
    }
  }

  /**
   * L'ABATTAGE À MAÎTRISE (spec recolte-maitrise, verbe 1) — MÊME grammaire que la
   * charge de combat, appliquée au bois. Le clic maintenu sur un arbre EMPLIT une
   * jauge (`harvest_charge_start`) ; le relâchement porte le coup (`harvest_release`),
   * propre s'il tombe dans le vert. Le maintien RE-ARME (cadencé, `hold: true`) : la
   * jauge se recharge toute seule après une frappe (auto ou relâchée) sans que le
   * doigt bouge — tenir sans jamais viser hache au baseline (l'ancien G6 y survit).
   */
  let felling = false
  let fellNodeId = -1
  let lastFellAt = -Infinity

  /**
   * LE DÉPEÇAGE (spec `depecage.md` R3c) — sœur de l'abattage : le clic MAINTENU sur une
   * carcasse, couteau en main, ouvre la découpe (`butcher_start`), puis la TIENT en vie par
   * un `hold` cadencé (`CHARGE_AIM_MS`, comme la jauge) — la sim coupe à sa cadence à elle et
   * lâche tout si le maintien cesse d'arriver. Le doigt levé ou un overlay envoient
   * `butcher_stop` : ce qui est pris est pris.
   */
  let butchering = false
  let butcherCorpseId = -1
  let lastButcherAt = -Infinity

  const releaseButcher = (): void => {
    if (!butchering) return
    butchering = false
    deps.sendAction({ type: 'butcher_stop' })
  }

  /** La frappe part (le nœud est re-validé côté sim — G8 : muet s'il n'y a plus rien). */
  const releaseFell = (): void => {
    if (!felling) return
    felling = false
    deps.sendAction({ type: 'harvest_release' })
  }

  /**
   * LE MINAGE À MAÎTRISE (spec recolte-maitrise, verbe 2). Le clic maintenu sur un rocher
   * le VERROUILLE : on frappe en boucle (cadence du rechargement, comme G6), le CURSEUR
   * indiquant le côté frappé autour du centre du nœud — même hors de sa tuile, d'où des
   * zones GROSSES (pas de pixel). La sim juge le flanc à chaque coup ; le bon flanc SAUTE,
   * on suit la lueur. On lâche quand le bouton se lève ou que le filon est vidé.
   */
  let mining = false
  let mineNodeId = -1
  let lastMineAt = -Infinity

  /**
   * LA CUEILLETTE À LA TOUCHE E (décision utilisateur 2026-07-24 ; spec recolte-maitrise
   * verbe 3). Un TAP suffit — E et la SOURIS ensemble : on pointe le buisson au curseur,
   * on presse E, et le nœud ENTIER vient dans le sac d'un coup (`whole: true`, la sim vide
   * tout le stock). Rien à maintenir : « d'un coup » veut dire un geste, pas une cadence.
   * Le clic, lui, ne cueille plus (couche plus bas) — il garde sa grammaire (une arme frappe).
   * Restreint au métier `foraging` : viser un arbre/rocher avec E ne fait rien (leur geste
   * est le clic maintenu). La sim revalide portée, stock et métier.
   */
  onDownAlways(TOUCHES.forage, () => {
    if (typing()) return // E va au champ de recherche, pas au monde
    // E REBASCULE le modal du feu : ouvert → on le referme (spec feu-station S17).
    if (getHud(scene.registry, 'openFire')) {
      setHud(scene.registry, 'openFire', null)
      return
    }
    // Un AUTRE overlay (sac, carte, menu) mange la touche, comme le clic.
    if (
      getHud(scene.registry, 'mapOpen') ||
      getHud(scene.registry, 'characterMenuOpen') ||
      getHud(scene.registry, 'menuOpen')
    ) {
      return
    }
    // CE QU'ON SURVOLE, RÉSOLU UNE SEULE FOIS (`interactTargetAt`) — la même réponse que
    // celle qu'entoure le contour blanc à l'écran. L'ORDRE (feu → cueillette → pile) et sa
    // motivation vivent maintenant dans le résolveur ; on ne fait plus ici que DISPATCHER.
    const cible = interactCible(scene.input.activePointer)
    if (cible !== null && cible.inRange) {
      if (cible.kind === 'fire') setHud(scene.registry, 'openFire', { structureId: cible.id })
      else if (cible.kind === 'node') deps.sendAction({ type: 'harvest', nodeId: cible.id, whole: true })
      else deps.sendAction({ type: 'pick_up', pileId: cible.id })
      return
    }
    // SINON LA PORTE LA PLUS PROCHE, À PORTÉE DE BRAS (spec construction R26).
    //
    // ELLE NE SE VISE PAS AU CURSEUR, et c'est délibéré : depuis R25 une porte vit sur une ARÊTE,
    // pas sur une tuile — viser « la tuile de la porte » demanderait au joueur de deviner laquelle
    // des deux la déclare, alors qu'il est simplement DEVANT elle. On prend donc la plus proche
    // dans la portée d'interaction. La sim revalide le droit et la distance.
    const porte = porteLaPlusProche()
    if (porte !== null) deps.sendAction({ type: 'toggle_door', structureId: porte })
  })

  scene.input.mouse?.disableContextMenu()
  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (overlayOpen()) return
    // LE CLIC DROIT LÈVE L'ARC — et lui seul (spec `tir.md` T2). Sans arme de tir en
    // main il ne fait toujours RIEN (démolir et désarmer sont débranchés) : il reste le
    // simple coup d'œil au loin, et c'est ce qui évite d'entrer en posture à chaque
    // regard. Il sort AVANT le résolveur dans les deux cas : un bouton qu'on retire doit
    // devenir muet, pas hériter du comportement du voisin.
    //
    // ON LIT LE BOUTON QUI VIENT DE S'ENFONCER (`pointer.button`), PAS L'ÉTAT DES BOUTONS
    // (`rightButtonDown()`). MESURÉ au smoke : avec le droit MAINTENU — c'est-à-dire tout
    // le temps où l'on vise —, `rightButtonDown()` reste vrai pendant l'appui du GAUCHE.
    // Ce garde avalait donc le décochage, et l'arc ne tirait jamais. Un état ne dit pas
    // quel geste vient d'avoir lieu ; seul l'événement le dit.
    if (pointer.button === 2) {
      if (!aiming && tientUnArc()) {
        aiming = true
        lastAimAt = scene.time.now
        const hand = handAt(pointer)
        deps.sendAction({ type: 'attack_charge', dx: hand.dx, dy: hand.dy })
      }
      return
    }
    // LE CLIC GAUCHE DÉCOCHE — arc levé, et rien d'autre ne le devance. C'est pourquoi ce
    // test précède le résolveur : celui-ci rendrait `null` pour un porteur d'arc (T2), et
    // le tir ne partirait jamais.
    if (aiming) {
      decocher(pointer)
      return
    }
    // Le résolveur PUR tranche (aim.ts) : MANGER, FRAPPER, récolter, fouiller,
    // POSER/AMÉLIORER — selon CE QU'ON TIENT. C'est la seule règle d'interaction.
    const aim = aimNow(pointer)
    const action = clickToAction(aim, placing(), handAt(pointer), buildCtx(aim, curseurTuile(pointer)))
    holding = true
    // LE MODE DÉMOLIR NE SE RÉPÈTE PAS AU MAINTIEN, et n'a AUCUNE porte de sortie : une
    // destruction est un acte, pas une cadence — tenir le clic ne rase pas une rangée de
    // murs. Et sans ce retour, `tickHold` (qui ne connaît pas le mode) se remettrait à
    // RÉCOLTER l'arbre sous le curseur dès que le marteau ne vise rien à moi.
    if (getHud(scene.registry, 'demolir') === true) {
      holding = false
      if (action) deps.sendAction(action)
      return
    }
    if (action?.type === 'attack') {
      // FRAPPER, c'est ARMER. Le clic bref donne le coup simple (la charge n'aura pas
      // eu le temps de mûrir), le clic tenu donne le coup lourd — un seul bouton,
      // deux gestes, et c'est la sim qui tranche entre les deux.
      charging = true
      lastAimAt = scene.time.now
      deps.sendAction({ type: 'attack_charge', dx: action.dx, dy: action.dy })
      return
    }
    // LA PÊCHE (spec peche.md G1/G4) : deux CLICS, pas un maintien — on ne tient pas un
    // bouton quinze secondes. Le premier, sur un coin, LANCE (`harvest_charge_start`) ; tant que
    // la ligne est tendue, le suivant FERRE (`harvest_release`) — avant la touche il rentre
    // simplement la ligne, la sim tranche. Le maintien ne relance rien (`holding = false`).
    if (deps.ligneTendue()) {
      holding = false
      deps.sendAction({ type: 'harvest_release' })
      return
    }
    // ⚠ LE LANCER A SA PROPRE ACTION depuis D9 (`cast_line`, une TUILE) : il ne passe plus par
    // la jauge d'abattage. `aim.ts` l'a déjà résolu — on ne fait que l'envoyer, sans maintien.
    if (action?.type === 'cast_line') {
      holding = false
      deps.sendAction(action)
      return
    }
    // DÉPECER, c'est TENIR (spec `depecage.md` D2) : l'appui ouvre la découpe, le maintien la
    // garde en vie, la sim coupe à sa cadence. Rien ne part au relâchement.
    if (action?.type === 'butcher_start') {
      butchering = true
      butcherCorpseId = action.corpseId
      lastButcherAt = scene.time.now
      deps.sendAction(action)
      return
    }
    // ABATTRE, c'est CHARGER. Un clic sur un arbre n'émet pas `harvest` : il arme la
    // jauge, et le coup ne part qu'au relâchement (propre s'il tombe dans le vert). La
    // pierre et les plantes, elles, tombent dans le `if (action)` ci-dessous (instantané).
    if (action?.type === 'harvest' && isFellNode(action.nodeId)) {
      felling = true
      fellNodeId = action.nodeId
      lastFellAt = scene.time.now
      deps.sendAction({ type: 'harvest_charge_start', nodeId: action.nodeId })
      return
    }
    // MINER, c'est VERROUILLER le rocher : on frappe tout de suite (avec la visée du
    // curseur = le flanc), puis en boucle tant qu'on tient — le curseur peut quitter la
    // tuile pour désigner le côté, le nœud reste verrouillé.
    if (action?.type === 'harvest' && isMineNode(action.nodeId)) {
      mining = true
      mineNodeId = action.nodeId
      lastMineAt = scene.time.now
      deps.sendAction({ type: 'harvest', nodeId: action.nodeId, ...cursorAim(pointer) })
      return
    }
    // LA CUEILLETTE EST PASSÉE À E (décision utilisateur 2026-07-24) : le clic ne récolte
    // plus fibre/baies/tourbe/cendre. On le rend MUET sur un buisson — il ne frappe pas
    // « en passant » (seule une arme frappe, traitée plus haut), il ne fait rien. On coupe
    // aussi le maintien (`holding = false`) pour que `tickHold` ne cueille pas non plus.
    if (isClickForage(action)) {
      holding = false
      return
    }
    if (action) {
      deps.sendAction(action)
      if (action.type === 'harvest' || action.type === 'eat') lastHarvestAt = scene.time.now
    }
  })
  scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    // LE BOUTON DROIT SE LÈVE : l'arc se rabaisse, gratuitement (T2). On ne teste PAS
    // `rightButtonReleased()` mais l'absence du bouton — un `pointerup` du gauche pendant
    // qu'on tient le droit ne doit rien rabaisser, et c'est déjà `decocher` qui a répondu.
    if (aiming && !pointer.rightButtonDown()) baisserArc()
    holding = false
    mining = false
    releaseCharge(pointer)
    releaseFell()
    releaseButcher()
  })

  /** Appelée à chaque frame par WorldScene : entretient le clic maintenu. */
  const tickHold = (): void => {
    const pointer = scene.input.activePointer
    // ═══ L'ARC LEVÉ ═══ Il se rabaisse dès que le bouton droit se lève ou qu'un overlay
    // s'ouvre — et il se RABAISSE, il ne décoche pas : la flèche reste au carquois. C'est
    // toute la raison d'être d'`attack_cancel`.
    // …ou dès qu'on n'a PLUS d'arc en main. Sans cette dernière condition, changer de case
    // de ceinture en pleine visée (touches 1-6, molette) laissait `aiming` armé : le clic
    // gauche suivant partait en `attack_release` et la sim le résolvait avec le profil de
    // CE QU'ON TIENT MAINTENANT — une charge d'arc convertie en coup de lance, sans qu'une
    // flèche ait jamais quitté le carquois. On ne garde pas bandé un arc qu'on a rangé.
    if (aiming && (overlayOpen() || !pointer.rightButtonDown() || !tientUnArc())) {
      baisserArc()
      return
    }
    // LE DÉCOCHAGE DOIT PASSER D'ABORD : tant que la sim nous connaît une charge, elle n'a
    // pas encore vu l'`attack_release`, et tout ré-armement l'écraserait.
    if (aiming && attenteDecochage) {
      if (!deps.chargeEnCours()) attenteDecochage = false
      return
    }
    if (aiming) {
      // ON RE-VISE, cadencé, SUR LE BOUTON DROIT. Sous l'ancienne grammaire cette boucle
      // s'arrêtait au relâchement du GAUCHE : c'est précisément la régression qu'un smoke
      // du tir doit attraper — un télégraphe qui cesse de suivre le curseur arc levé.
      if (scene.time.now - lastAimAt >= CHARGE_AIM_MS) {
        lastAimAt = scene.time.now
        const hand = handAt(pointer)
        deps.sendAction({ type: 'attack_charge', dx: hand.dx, dy: hand.dy, hold: true })
      }
      return
    }
    // L'OVERLAY S'OUVRE PENDANT QU'ON CHARGE (le sac, la carte) : on ANNULE. Il envoyait
    // le coup, faute d'avoir mieux — un moulinet de hache dans le vide, récupération
    // punitive comprise, parce qu'on avait ouvert son sac. `attack_cancel` est arrivé
    // avec l'arc ; la mêlée en profite (spec `tir.md` T2).
    if (charging && overlayOpen()) {
      charging = false
      deps.sendAction({ type: 'attack_cancel' })
      holding = false
      return
    }
    // Le doigt se lève : là, le coup PART. Sans ça la sim garderait une charge éternelle —
    // endurance gelée, avatar au ralenti, et aucun moyen de comprendre pourquoi.
    if (charging && !pointer.leftButtonDown()) {
      releaseCharge(pointer)
      holding = false
      return
    }
    if (charging) {
      // On RE-VISE : la sim rafraîchit la direction de la charge sans la remettre à
      // zéro. `hold: true` — c'est le MAINTIEN, pas un nouvel appui : la sim ne s'en
      // plaint donc pas s'il tombe pendant une récupération (sinon un doigt posé sur
      // le bouton cracherait quinze « trop tôt » par seconde dans le flux). Bonus :
      // la charge démarre TOUTE SEULE dès que la récupération s'achève.
      if (scene.time.now - lastAimAt >= CHARGE_AIM_MS) {
        lastAimAt = scene.time.now
        const hand = handAt(pointer)
        deps.sendAction({ type: 'attack_charge', dx: hand.dx, dy: hand.dy, hold: true })
      }
      return
    }
    // L'ABATTAGE en cours : on relâche si le bouton se lève ou qu'un overlay s'ouvre,
    // sinon on RE-ARME (cadencé) pour hacher en continu — en re-ciblant l'arbre visé
    // MAINTENANT (le curseur a pu glisser sur un autre tronc entre deux coups).
    if (felling && (overlayOpen() || !pointer.leftButtonDown())) {
      releaseFell()
      holding = false
      return
    }
    if (felling) {
      if (scene.time.now - lastFellAt >= CHARGE_AIM_MS) {
        lastFellAt = scene.time.now
        const aim = aimNow(pointer)
        if (aim.inRange && aim.nodeId !== null && isFellNode(aim.nodeId)) fellNodeId = aim.nodeId
        deps.sendAction({ type: 'harvest_charge_start', nodeId: fellNodeId, hold: true })
      }
      return
    }
    // LE DÉPEÇAGE en cours : on lâche si le bouton se lève ou qu'un overlay s'ouvre — et si la
    // carcasse a DISPARU du snapshot (vidée, mangée, pourrie), on cesse de tenir dans le vide.
    // Sinon on RAFRAÎCHIT le maintien, cadencé : c'est lui qui tient la découpe en vie.
    if (butchering && (overlayOpen() || !pointer.leftButtonDown())) {
      releaseButcher()
      holding = false
      return
    }
    if (butchering) {
      if (!deps.corpses().some((c) => c.id === butcherCorpseId)) {
        butchering = false
        holding = false
        return
      }
      if (scene.time.now - lastButcherAt >= CHARGE_AIM_MS) {
        lastButcherAt = scene.time.now
        deps.sendAction({ type: 'butcher_start', corpseId: butcherCorpseId, hold: true })
      }
      return
    }
    // LE MINAGE en cours : on lâche si le bouton se lève, l'overlay s'ouvre, ou le filon
    // est VIDÉ ; sinon on refrappe à la cadence du rechargement, le curseur MAINTENANT
    // désignant le flanc. Le nœud reste verrouillé (le curseur peut sortir de sa tuile).
    if (mining && (overlayOpen() || !pointer.leftButtonDown())) {
      mining = false
      holding = false
      return
    }
    if (mining) {
      if (scene.time.now - lastMineAt >= GATHER_COOLDOWN_MS) {
        const node = deps.nodes().find((n) => n.id === mineNodeId)
        if (!node || node.stock <= 0) {
          mining = false
          holding = false
          return
        }
        deps.sendAction({ type: 'harvest', nodeId: mineNodeId, ...cursorAim(pointer) })
        lastMineAt = scene.time.now
      }
      return
    }
    if (!holding) return
    if (overlayOpen() || !pointer.leftButtonDown()) {
      holding = false
      return
    }
    const action = holdHarvest(
      aimNow(pointer),
      placing(),
      scene.time.now,
      lastHarvestAt,
      GATHER_COOLDOWN_MS,
      handAt(pointer),
    )
    // On COUPE la cueillette au maintien souris aussi (elle est passée à E, 2026-07-24) :
    // sans ça, fouiller un cadavre puis glisser le curseur sur un buisson le cueillerait
    // encore. `holdHarvest` peut toujours nourrir (manger) — ça, on le laisse passer.
    if (action && !isClickForage(action)) {
      deps.sendAction(action)
      lastHarvestAt = scene.time.now
    }
  }

  /**
   * ABANDONNE tout geste en cours (charge d'attaque, abattage, minage, récolte maintenue)
   * SANS rien émettre. C'est le pendant manquant de `input.enabled = false` à la mort : quand
   * l'input Phaser se coupe, le `pointerup` — et son `attack_release` — ne part jamais, donc
   * `charging` (qui, seul, ne teste PAS l'état du bouton) resterait vrai pendant le voile ET
   * après le respawn. `tickHold` continuerait alors d'armer la charge, et le premier relâchement
   * au réveil cracherait un coup chargé involontaire — potentiellement sur un PNJ posté au Feu.
   * On coupe net les drapeaux ; le prochain appui repart d'un geste neuf.
   */
  const cancelHold = (): void => {
    charging = false
    // L'ARC AUSSI (spec `tir.md` T2), et il pèse plus lourd que les autres : un drapeau
    // `aiming` survivant à la mort ferait décocher au réveil — une flèche du carquois,
    // sur qui se trouve là. On coupe le drapeau sans émettre : la sim, elle, a déjà tout
    // remis à plat en nous faisant renaître.
    aiming = false
    felling = false
    butchering = false
    mining = false
    holding = false
  }

  return { keys, sprintKeys, sneakKeys, blockKeys, tickHold, cancelHold, aim: aimNow, interactTarget: interactCible, visee: viseeCourante, curseur: curseurTuile, placing }
}
