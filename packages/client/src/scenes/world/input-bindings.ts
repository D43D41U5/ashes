/**
 * Tous les bindings clavier/souris de la scène monde : F/1-5/ESPACE/C/X/T/G/
 * E/R/6-0/J au clavier, clic bâtir/récolter/looter, clic droit démolir,
 * shift+clic partager. Extrait de `WorldScene` : on ne fait ici que traduire
 * une frappe en `PlayerAction` — aucune logique de jeu (elle vit dans /sim).
 *
 * Les deps sont des ACCESSEURS (closures), pas des copies : structures,
 * nœuds, cadavres, entités et position prédite changent à chaque snapshot ou
 * frame — chaque handler lit l'état AU MOMENT de la frappe.
 */
import type { AccessLevel, Corpse, PlayerAction, RecipeId, ResourceNode, Structure } from '@braises/sim'
import Phaser from 'phaser'
import { getHud, setHud, type Buildable } from '../../hud-state'
import { TILE_PX } from '../../render/framing'
import type { InterpolatedSprite } from './snapshot-view'

const BUILD_KEYS: Buildable[] = ['wall', 'door', 'chest', 'workshop', 'furnace']

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
  const grab = (codes: number[]): Phaser.Input.Keyboard.Key[] => codes.map((c) => kb.addKey(c, false))
  const K = Phaser.Input.Keyboard.KeyCodes
  const pointerToWorld = (pointer: Phaser.Input.Pointer): Phaser.Math.Vector2 =>
    pointer.positionToCamera(scene.cameras.main) as Phaser.Math.Vector2

  const keys = {
    up: grab([K.Z, K.W, K.UP]),
    down: grab([K.S, K.DOWN]),
    left: grab([K.Q, K.A, K.LEFT]),
    right: grab([K.D, K.RIGHT]),
  }
  const sprintKeys = grab([K.SHIFT])
  const blockKey = kb.addKey(K.C, false)

  // Mode construction : F fonde, 1-5 choisit, clic bâtit, clic droit démolit.
  // La sélection vit ICI (et dans le HUD via le registry) — la scène n'en a
  // pas besoin.
  let selected: Buildable = 'wall'
  kb.addKey(K.F, false).on('down', () => deps.sendAction({ type: 'light_fire' }))
  ;[K.ONE, K.TWO, K.THREE, K.FOUR, K.FIVE].forEach((code, i) => {
    kb.addKey(code, false).on('down', () => {
      selected = BUILD_KEYS[i]!
      setHud(scene.registry, 'selected', selected)
    })
  })
  setHud(scene.registry, 'selected', selected)

  // Combat : ESPACE attaque vers le pointeur, C bloque, SHIFT sprinte, X bande.
  kb.addKey(K.SPACE, false).on('down', () => {
    const world = pointerToWorld(scene.input.activePointer)
    const predicted = deps.predicted()
    const dx = world.x / TILE_PX - predicted.x
    const dy = world.y / TILE_PX - predicted.y
    deps.sendAction({ type: 'attack', dx, dy })
  })
  kb.addKey(K.X, false).on('down', () => deps.sendAction({ type: 'bandage' }))
  kb.addKey(K.J, false).on('down', () => {
    setHud(scene.registry, 'journalOpen', !getHud(scene.registry, 'journalOpen'))
  })
  // T : donner 3 baies à l'entité la plus proche (l'acte chaud fondamental).
  kb.addKey(K.T, false).on('down', () => {
    const predicted = deps.predicted()
    const nearest = [...deps.others().entries()]
      .map(([id, r]) => ({ id, d: Math.hypot(r.toX - predicted.x, r.toY - predicted.y) }))
      .sort((a, b) => a.d - b.d)[0]
    if (nearest && nearest.d < 1.5) {
      deps.sendAction({ type: 'give', targetEntityId: nearest.id, item: 'berries', count: 3 })
    }
  })
  kb.addKey(K.G, false).on('down', () => {
    const world = pointerToWorld(scene.input.activePointer)
    const target = deps
      .structures()
      .find((s) => s.tx === Math.floor(world.x / TILE_PX) && s.ty === Math.floor(world.y / TILE_PX))
    if (target) deps.sendAction({ type: 'repair', structureId: target.id })
  })

  // Manger et crafter.
  kb.addKey(K.E, false).on('down', () => deps.sendAction({ type: 'eat', item: 'berries' }))
  kb.addKey(K.R, false).on('down', () => deps.sendAction({ type: 'eat', item: 'stew' }))
  const craftKeys: [number, RecipeId][] = [
    [K.SIX, 'stew'],
    [K.SEVEN, 'axe'],
    [K.EIGHT, 'pickaxe'],
    [K.NINE, 'iron_ingot'],
    [K.ZERO, 'iron_axe'],
  ]
  for (const [code, recipeId] of craftKeys) {
    kb.addKey(code, false).on('down', () => deps.sendAction({ type: 'craft', recipeId }))
  }

  scene.input.mouse?.disableContextMenu()
  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
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
