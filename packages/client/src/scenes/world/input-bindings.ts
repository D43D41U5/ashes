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
import type { AccessLevel, Corpse, PlayerAction, ResourceNode, Structure } from '@braises/sim'
import Phaser from 'phaser'
import { getHud, setHud, type Buildable } from '../../hud-state'
import { TILE_PX } from '../../render/framing'
import { BUILD_BINDINGS, CRAFT_BINDINGS, KEYMAP } from './keymap'
import type { InterpolatedSprite } from './snapshot-view'

export interface InputDeps {
  sendAction(action: PlayerAction): void
  /** Position LOGIQUE du joueur (ancre autorité) — pour viser, mesurer une distance. */
  predicted(): { x: number; y: number }
  structures(): Structure[]
  nodes(): ResourceNode[]
  corpses(): Corpse[]
  others(): ReadonlyMap<number, InterpolatedSprite>
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
  const pointerToWorld = (pointer: Phaser.Input.Pointer): Phaser.Math.Vector2 =>
    pointer.positionToCamera(scene.cameras.main) as Phaser.Math.Vector2

  const keys = {
    up: grab(KEYMAP.moveUp),
    down: grab(KEYMAP.moveDown),
    left: grab(KEYMAP.moveLeft),
    right: grab(KEYMAP.moveRight),
  }
  const sprintKeys = grab(KEYMAP.sprint)
  const blockKey = grab(KEYMAP.block)[0]!

  // Mode construction : F fonde, 1-5 choisit, clic bâtit, clic droit démolit.
  // La sélection vit ICI (et dans le HUD via le registry) — la scène n'en a
  // pas besoin.
  let selected: Buildable = BUILD_BINDINGS[0]![1]
  onDown(KEYMAP.lightFire, () => deps.sendAction({ type: 'light_fire' }))
  for (const [name, buildable] of BUILD_BINDINGS) {
    onDown([name], () => {
      selected = buildable
      setHud(scene.registry, 'selected', selected)
    })
  }
  setHud(scene.registry, 'selected', selected)

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

  // Manger et crafter.
  onDown(KEYMAP.eatBerries, () => deps.sendAction({ type: 'eat', item: 'berries' }))
  onDown(KEYMAP.eatStew, () => deps.sendAction({ type: 'eat', item: 'stew' }))
  for (const [name, recipeId] of CRAFT_BINDINGS) {
    onDown([name], () => deps.sendAction({ type: 'craft', recipeId }))
  }

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
