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
import { BALANCE, SLOTS, type Corpse, type PlayerAction, type ResourceNode, type Structure } from '@braises/sim'
import Phaser from 'phaser'
import { getHud, setHud, type Buildable } from '../../hud-state'
import { TILE_PX } from '../../render/framing'
import { aimAt, clickToAction, holdHarvest, type AimTarget, type HandContext } from './aim'
import { BELT_BINDINGS, KEYMAP } from './keymap'

export interface InputDeps {
  sendAction(action: PlayerAction): void
  /** Position LOGIQUE du joueur (ancre autorité) — pour viser, mesurer une distance. */
  predicted(): { x: number; y: number }
  structures(): Structure[]
  nodes(): ResourceNode[]
  corpses(): Corpse[]
  /** Corrige un point monde PLAT (positionToCamera) en point monde vrai, selon le relief. */
  unproject(px: number, py: number): { x: number; y: number }
}

/** Les touches de déplacement, lues chaque frame par `WorldScene.update`. */
export interface MovementBindings {
  keys: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key[]>
  sprintKeys: Phaser.Input.Keyboard.Key[]
  /** Entretient le clic MAINTENU (récolte en boucle) — à appeler chaque frame. */
  tickHold(): void
  /** Ce que vise le curseur MAINTENANT — pour le surlignage et le fantôme. */
  aim(pointer: Phaser.Input.Pointer): AimTarget
  /** La structure armée. TOUJOURS `null` depuis le débranchement de `B` : le mode
   *  construction n'est plus ARMABLE, mais sa plomberie (fantôme, `clickToAction`)
   *  reste entière — elle attend la nouvelle interaction. */
  selected(): Buildable | null
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

  const corpse = deps
    .corpses()
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
  const grab = (names: readonly string[]): Phaser.Input.Keyboard.Key[] => names.map((n) => kb.addKey(K[n]!, false))
  /**
   * LE CHAMP DE RECHERCHE A-T-IL LE CLAVIER ? Si oui, plus AUCUNE touche ne part
   * au jeu : taper « hache » dans le panneau de craft ferait sinon marcher le
   * personnage (Z, Q, S, D sont des lettres) et « journal » ouvrirait le journal.
   */
  const typing = (): boolean => Boolean(getHud(scene.registry, 'uiTyping'))

  /** Câble un handler `down` sur chaque alias d'une action (KEYMAP). MUET tant que
   *  le champ de recherche a le clavier. */
  const onDown = (names: readonly string[], fn: () => void): void => {
    for (const n of names) kb.addKey(K[n]!, false).on('down', () => {
      if (typing()) return
      fn()
    })
  }
  /** …sauf TAB, qui doit TOUJOURS pouvoir refermer l'écran. Une touche de sortie
   *  qu'on peut se retrouver à ne plus pouvoir presser est un piège : on tape dans
   *  la recherche, on veut fermer le sac, et plus rien ne répond. */
  const onDownAlways = (names: readonly string[], fn: () => void): void => {
    for (const n of names) kb.addKey(K[n]!, false).on('down', fn)
  }
  // Le pointeur en monde PLAT, puis corrigé de l'élévation : la tuile réellement
  // SOUS le curseur, pas celle du sol non déformé (spec relief-continu §4.4).
  const pointerToWorld = (pointer: Phaser.Input.Pointer): Phaser.Math.Vector2 => {
    const flat = pointer.positionToCamera(scene.cameras.main) as Phaser.Math.Vector2
    const w = deps.unproject(flat.x, flat.y)
    return new Phaser.Math.Vector2(w.x, w.y)
  }

  const keys = {
    up: grab(KEYMAP.moveUp),
    down: grab(KEYMAP.moveDown),
    left: grab(KEYMAP.moveLeft),
    right: grab(KEYMAP.moveRight),
  }
  const sprintKeys = grab(KEYMAP.sprint)

  // Le mode construction n'est plus ARMABLE (`B` débranché) : `selected` reste
  // donc à `null`, et le clic ne peut que récolter ou looter. La plomberie qui en
  // dépend — le fantôme (`build-ghost.ts`) et le résolveur pur (`clickToAction`)
  // — est INTACTE : elle attend qu'on rebranche bâtir sur le marteau en main.
  const selected: Buildable | null = null
  setHud(scene.registry, 'selected', selected)

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

  // TAB : ouvre/ferme l'écran d'inventaire. On capture la touche : sinon le
  // navigateur déplace le focus hors du canvas. À l'OUVERTURE, on choisit le
  // conteneur à looter — le plus proche à portée, un cadavre primant sur un
  // coffre (on loote ce qu'on vient de tuer) ; à la FERMETURE on l'oublie.
  kb.addCapture(KEYMAP.toggleInventory[0])
  onDownAlways(KEYMAP.toggleInventory, () => {
    const opening = !getHud(scene.registry, 'characterMenuOpen')
    setHud(scene.registry, 'characterMenuOpen', opening)
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

  // J : le journal. M : la carte plein écran (visionneuse rendue par UIScene).
  onDown(KEYMAP.toggleJournal, () => {
    setHud(scene.registry, 'journalOpen', !getHud(scene.registry, 'journalOpen'))
  })
  onDown(KEYMAP.toggleMap, () => {
    setHud(scene.registry, 'mapOpen', !getHud(scene.registry, 'mapOpen'))
  })

  /** La tuile sous le curseur, et ce qu'elle porte. Recalculée à la demande : le
   *  curseur bouge, le nœud s'épuise, et la caméra GLISSE ENCORE après la course
   *  — une visée mémorisée au `pointerdown` viserait déjà ailleurs (recolte.md G8). */
  const aimNow = (pointer: Phaser.Input.Pointer): AimTarget => {
    const world = pointerToWorld(pointer)
    return aimAt(
      Math.floor(world.x / TILE_PX),
      Math.floor(world.y / TILE_PX),
      deps.predicted(),
      deps.nodes(),
      deps.corpses(),
      BALANCE.INTERACT_RANGE,
    )
  }
  /** L'overlay (carte, sac) mange le clic : il ne doit pas agir dans le monde en dessous. */
  const overlayOpen = (): boolean =>
    Boolean(getHud(scene.registry, 'mapOpen')) || Boolean(getHud(scene.registry, 'characterMenuOpen'))

  /**
   * CE QU'ON TIENT, ET VERS OÙ ON VISE. C'est tout ce dont le résolveur pur a
   * besoin pour décider du clic (aim.ts) : manger, frapper, récolter, fouiller.
   * Le client ne décide de RIEN d'autre — la sim tranche, comme toujours.
   */
  const handAt = (pointer: Phaser.Input.Pointer): HandContext => {
    const inv = getHud(scene.registry, 'inv') ?? []
    const slot = getHud(scene.registry, 'activeSlot') ?? -1
    const held = slot >= 0 ? (inv[slot]?.item ?? null) : null
    const world = pointerToWorld(pointer)
    const p = deps.predicted()
    return { held, dx: world.x / TILE_PX - p.x, dy: world.y / TILE_PX - p.y }
  }

  // Le clic MAINTENU récolte en boucle, cadencé par le rechargement (G6-G7).
  let holding = false
  let lastHarvestAt = -Infinity

  scene.input.mouse?.disableContextMenu()
  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (overlayOpen()) return
    // Le clic DROIT ne fait plus rien (démolir et désarmer sont débranchés) — et
    // il sort AVANT le résolveur : sans cette garde, il retomberait sur le clic
    // gauche et se mettrait à récolter. Un bouton qu'on retire doit devenir muet,
    // pas hériter du comportement du voisin.
    if (pointer.rightButtonDown()) return
    // Le résolveur PUR tranche (aim.ts) : MANGER, FRAPPER, récolter, fouiller —
    // selon CE QU'ON TIENT. C'est la seule règle d'interaction du jeu.
    const action = clickToAction(aimNow(pointer), selected, handAt(pointer))
    if (action) {
      deps.sendAction(action)
      if (action.type === 'harvest' || action.type === 'attack' || action.type === 'eat') {
        lastHarvestAt = scene.time.now
      }
    }
    holding = true
  })
  scene.input.on('pointerup', () => {
    holding = false
  })

  /** Appelée à chaque frame par WorldScene : entretient le clic maintenu. */
  const tickHold = (): void => {
    if (!holding) return
    const pointer = scene.input.activePointer
    if (overlayOpen() || !pointer.leftButtonDown()) {
      holding = false
      return
    }
    const action = holdHarvest(
      aimNow(pointer),
      selected,
      scene.time.now,
      lastHarvestAt,
      GATHER_COOLDOWN_MS,
      handAt(pointer),
    )
    if (action) {
      deps.sendAction(action)
      lastHarvestAt = scene.time.now
    }
  }

  return { keys, sprintKeys, tickHold, aim: aimNow, selected: () => selected }
}
