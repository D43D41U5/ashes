/**
 * Tous les bindings clavier/souris de la scène monde : on traduit une frappe
 * en `PlayerAction` — aucune logique de jeu (elle vit dans /sim). QUELLE touche
 * déclenche quoi vit dans `keymap.ts` (table déclarative) ; ici on ne fait que
 * la câbler à un handler. Clic bâtir/récolter/looter, clic droit démolir,
 * shift+clic partager.
 *
 * Les deps sont des ACCESSEURS (closures), pas des copies : structures,
 * nœuds, cadavres, entités et position prédite changent à chaque snapshot ou
 * frame — chaque handler lit l'état AU MOMENT de la frappe.
 */
import { SLOTS, type AccessLevel, type Corpse, type PlayerAction, type ResourceNode, type Structure } from '@braises/sim'
import Phaser from 'phaser'
import { getHud, setHud, type Buildable } from '../../hud-state'
import { TILE_PX } from '../../render/framing'
import { BELT_BINDINGS, BUILDABLE_CYCLE, CRAFT_BINDINGS, KEYMAP } from './keymap'
import type { InterpolatedSprite } from './snapshot-view'

export interface InputDeps {
  sendAction(action: PlayerAction): void
  /** Position LOGIQUE du joueur (ancre autorité) — pour viser, mesurer une distance. */
  predicted(): { x: number; y: number }
  structures(): Structure[]
  nodes(): ResourceNode[]
  corpses(): Corpse[]
  others(): ReadonlyMap<number, InterpolatedSprite>
  /** Corrige un point monde PLAT (positionToCamera) en point monde vrai, selon le relief. */
  unproject(px: number, py: number): { x: number; y: number }
}

/** Les touches de déplacement, lues chaque frame par `WorldScene.update`. */
export interface MovementBindings {
  keys: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key[]>
  sprintKeys: Phaser.Input.Keyboard.Key[]
  blockKey: Phaser.Input.Keyboard.Key
}

export function bindInputs(scene: Phaser.Scene, deps: InputDeps): MovementBindings {
  const kb = scene.input.keyboard!
  const K = Phaser.Input.Keyboard.KeyCodes as Record<string, number>
  const grab = (names: readonly string[]): Phaser.Input.Keyboard.Key[] => names.map((n) => kb.addKey(K[n]!, false))
  /** Câble un handler `down` sur chaque alias d'une action (KEYMAP). */
  const onDown = (names: readonly string[], fn: () => void): void => {
    for (const n of names) kb.addKey(K[n]!, false).on('down', fn)
  }
  /** Idem, mais le handler reçoit l'événement clavier (pour lire les modificateurs). */
  const onDownE = (names: readonly string[], fn: (event: KeyboardEvent) => void): void => {
    for (const n of names) kb.addKey(K[n]!, false).on('down', (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent) => fn(event))
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
  const blockKey = grab(KEYMAP.block)[0]!

  // Mode construction : F fonde, clic bâtit, clic droit démolit. Les touches
  // 1-6 tenant désormais la ceinture (spec inventaire R17), la sélection de
  // structure se fait au clavier B (défilement) — béquille jusqu'au chantier 3.
  // La sélection vit ICI (et dans le HUD via le registry).
  let selected: Buildable = BUILDABLE_CYCLE[0]!
  onDown(KEYMAP.lightFire, () => deps.sendAction({ type: 'light_fire' }))
  onDown(KEYMAP.cycleBuildable, () => {
    const i = BUILDABLE_CYCLE.indexOf(selected)
    selected = BUILDABLE_CYCLE[(i + 1) % BUILDABLE_CYCLE.length]!
    setHud(scene.registry, 'selected', selected)
  })
  setHud(scene.registry, 'selected', selected)

  // La CEINTURE : 1-6 tiennent une case (spec inventaire R17). Affichage
  // optimiste (R22) — on surligne tout de suite, le prochain snapshot fait foi.
  // SHIFT+1…5 restent le craft de dépannage (béquille jusqu'au chantier 2) :
  // le modificateur tranche entre tenir une case et lancer une recette.
  const craftFor = new Map(CRAFT_BINDINGS.map(([name, recipeId]) => [name, recipeId]))
  for (const [name, slot] of BELT_BINDINGS) {
    onDownE([name], (event) => {
      const recipeId = craftFor.get(name)
      if (event.shiftKey && recipeId) {
        deps.sendAction({ type: 'craft', recipeId })
        return
      }
      deps.sendAction({ type: 'set_active_slot', slot })
      setHud(scene.registry, 'activeSlot', slot)
    })
  }

  // TAB : ouvre/ferme l'écran d'inventaire (la grille arrive au chantier 7).
  // On capture la touche : sinon le navigateur déplace le focus hors du canvas.
  kb.addCapture(KEYMAP.toggleInventory[0])
  onDown(KEYMAP.toggleInventory, () => {
    setHud(scene.registry, 'inventoryOpen', !getHud(scene.registry, 'inventoryOpen'))
  })

  // La molette fait défiler la case tenue, bornée à la ceinture — sauf quand
  // l'inventaire ou la carte est ouvert (la molette y sert au zoom).
  scene.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
    if (getHud(scene.registry, 'mapOpen') || getHud(scene.registry, 'inventoryOpen')) return
    const belt = SLOTS.BELT
    const current = getHud(scene.registry, 'activeSlot') ?? -1
    // Depuis les mains nues (-1), molette avant → case 0 ; arrière → dernière case.
    const base = current < 0 ? (dy < 0 ? -1 : 0) : current
    const next = (((base + (dy < 0 ? 1 : -1)) % belt) + belt) % belt
    deps.sendAction({ type: 'set_active_slot', slot: next })
    setHud(scene.registry, 'activeSlot', next)
  })

  // Combat : ESPACE attaque vers le pointeur, C bloque, SHIFT sprinte, X bande.
  onDown(KEYMAP.attack, () => {
    const world = pointerToWorld(scene.input.activePointer)
    const predicted = deps.predicted()
    const dx = world.x / TILE_PX - predicted.x
    const dy = world.y / TILE_PX - predicted.y
    deps.sendAction({ type: 'attack', dx, dy })
  })
  onDown(KEYMAP.bandage, () => deps.sendAction({ type: 'bandage' }))
  onDown(KEYMAP.toggleJournal, () => {
    setHud(scene.registry, 'journalOpen', !getHud(scene.registry, 'journalOpen'))
  })
  // M : la carte plein écran (visionneuse zoom/pan, rendue par UIScene).
  onDown(KEYMAP.toggleMap, () => {
    setHud(scene.registry, 'mapOpen', !getHud(scene.registry, 'mapOpen'))
  })
  // T : donner 3 baies à l'entité la plus proche (l'acte chaud fondamental).
  onDown(KEYMAP.give, () => {
    const predicted = deps.predicted()
    const nearest = [...deps.others().entries()]
      .map(([id, r]) => ({ id, d: Math.hypot(r.toX - predicted.x, r.toY - predicted.y) }))
      .sort((a, b) => a.d - b.d)[0]
    if (nearest && nearest.d < 1.5) {
      deps.sendAction({ type: 'give', targetEntityId: nearest.id, item: 'berries', count: 3 })
    }
  })
  onDown(KEYMAP.repair, () => {
    const world = pointerToWorld(scene.input.activePointer)
    const target = deps
      .structures()
      .find((s) => s.tx === Math.floor(world.x / TILE_PX) && s.ty === Math.floor(world.y / TILE_PX))
    if (target) deps.sendAction({ type: 'repair', structureId: target.id })
  })

  // Manger (le craft est câblé plus haut, sur SHIFT+1…5, avec la ceinture).
  onDown(KEYMAP.eatBerries, () => deps.sendAction({ type: 'eat', item: 'berries' }))
  onDown(KEYMAP.eatStew, () => deps.sendAction({ type: 'eat', item: 'stew' }))

  scene.input.mouse?.disableContextMenu()
  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    // Carte ouverte : le clic pilote la visionneuse (pan/zoom, dans UIScene),
    // il ne doit pas bâtir/récolter dans le monde en dessous.
    if (getHud(scene.registry, 'mapOpen')) return
    const world = pointerToWorld(pointer)
    const tx = Math.floor(world.x / TILE_PX)
    const ty = Math.floor(world.y / TILE_PX)
    if (pointer.rightButtonDown()) {
      const target = deps.structures().find((s) => s.tx === tx && s.ty === ty)
      if (target) deps.sendAction({ type: 'demolish', structureId: target.id })
    } else if (pointer.event.shiftKey) {
      // Shift+clic : faire tourner l'accès d'une structure à soi (partage).
      const target = deps.structures().find((s) => s.tx === tx && s.ty === ty)
      if (target) {
        const cycle: Record<AccessLevel, AccessLevel> = { private: 'village', village: 'public', public: 'private' }
        deps.sendAction({ type: 'set_access', structureId: target.id, access: cycle[target.access] })
      }
    } else {
      // Priorité au clic : cadavre → nœud vivant → bâtir.
      const corpse = deps.corpses().find((c) => Math.floor(c.x) === tx && Math.floor(c.y) === ty)
      const node = deps.nodes().find((n) => n.tx === tx && n.ty === ty && n.stock > 0)
      if (corpse) deps.sendAction({ type: 'loot_corpse', corpseId: corpse.id })
      else if (node) deps.sendAction({ type: 'harvest', nodeId: node.id })
      else deps.sendAction({ type: 'build', structure: selected, tx, ty })
    }
  })

  return { keys, sprintKeys, blockKey }
}
