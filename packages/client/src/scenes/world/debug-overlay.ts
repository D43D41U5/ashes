/**
 * L'overlay du mode debug (F1) et le TP au clic sur la carte.
 *
 * Pourquoi un MODULE et pas des méthodes de scène : Rollup élimine un module
 * dont le seul appel est gardé par `import.meta.env.DEV` (statiquement faux en
 * prod), mais il ne peut PAS prouver qu'une méthode de classe est morte — elle
 * resterait dans le bundle avec ses libellés. Tout le debug du client vit donc
 * hors des classes de scène (ici et dans `debug-bindings.ts`), et la prod n'en
 * garde rien. La vraie garde reste côté autorité : la sim de prod n'est pas
 * créée avec `debug: true` et refuse ces actions (packages/sim/src/debug.ts).
 */
import { elevationAt, terrainAt, TERRAINS, zoneAt, type PlayerAction, type WorldMap } from '@braises/sim'
import type Phaser from 'phaser'
import { getHud, setHud } from '../../hud-state'

const AIDE_CARTE = 'molette : zoom · glisser : déplacer · M : fermer'
const AIDE_CARTE_DEBUG = 'clic : TÉLÉPORTER · molette : zoom · glisser : déplacer · M : fermer'

export function createDebugOverlay(scene: Phaser.Scene, style: Phaser.Types.GameObjects.Text.TextStyle, depth: number): Phaser.GameObjects.Text {
  // Sous les barres PV/endurance, à droite : le seul coin libre (le bas porte
  // l'aide du jeu ET celle de la carte). Au-dessus de la carte plein écran :
  // on veut pouvoir le lire en se téléportant.
  return scene.add
    .text(scene.scale.width - 10, 70, '', { ...style, fontSize: '13px', color: '#7ad1ff', align: 'right' })
    .setOrigin(1, 0)
    .setDepth(depth)
    .setVisible(false)
}

/** Ce que le jeu ne dit jamais : tick, FPS, tuile sous le curseur, leviers armés. */
export function renderDebugOverlay(
  scene: Phaser.Scene,
  text: Phaser.GameObjects.Text,
  mapHint: Phaser.GameObjects.Text | undefined,
): void {
  const on = Boolean(getHud(scene.registry, 'debugOn'))
  text.setVisible(on)
  // L'aide de la carte ne promet le TP que si le mode est armé.
  mapHint?.setText(on ? AIDE_CARTE_DEBUG : AIDE_CARTE)
  if (!on) return

  const info = getHud(scene.registry, 'debugInfo')
  const speed = getHud(scene.registry, 'debugSpeed') ?? 1
  const god = Boolean(getHud(scene.registry, 'debugGod'))
  const pos = getHud(scene.registry, 'playerPos')
  const hover = info?.hover
  text.setText(
    [
      'DEBUG · F1 fermer · F2 invulnérabilité · F3 jour/nuit · F4 vitesse',
      `tick ${info?.tick ?? 0} · ${Math.round(info?.fps ?? 0)} fps · cadence ×${speed}${god ? ' · INVULNÉRABLE' : ''}`,
      pos ? `avatar [${pos.x.toFixed(1)} ${pos.y.toFixed(1)}]` : '',
      hover
        ? `curseur [${hover.tx} ${hover.ty}] ${hover.terrain} · élév ${hover.elevation.toFixed(2)} · ${hover.zone}`
        : 'curseur hors carte',
      'carte (M) : clic pour se téléporter',
    ]
      .filter(Boolean)
      .join('\n'),
  )
}

/**
 * Clic sur la carte plein écran → demande de TP. UIScene ne parle pas à l'hôte :
 * elle POSE la demande, WorldScene la consomme (`consumeTeleport`).
 */
export function requestTeleport(scene: Phaser.Scene, tile: { tx: number; ty: number }): void {
  setHud(scene.registry, 'debugTeleport', { x: tile.tx, y: tile.ty, at: scene.time.now })
}

export interface DebugSyncDeps {
  map: WorldMap
  /** Tuile sous le curseur, relief corrigé (WorldScene la calcule déjà pour le fantôme). */
  hover: { gx: number; gy: number }
  tick: number
  /** Horodatage de la dernière demande de TP consommée. */
  lastTeleportAt: number
  sendAction(action: PlayerAction): void
}

/**
 * Côté WorldScene : exécute la demande de TP en attente et publie de quoi
 * nourrir l'overlay. Rend l'horodatage de TP à mémoriser (état porté par la
 * scène — le module reste sans état).
 */
export function syncDebug(scene: Phaser.Scene, deps: DebugSyncDeps): number {
  let lastTeleportAt = deps.lastTeleportAt
  const teleport = getHud(scene.registry, 'debugTeleport')
  if (teleport && teleport.at > lastTeleportAt) {
    lastTeleportAt = teleport.at
    deps.sendAction({ type: 'debug_teleport', x: teleport.x, y: teleport.y })
    setHud(scene.registry, 'mapOpen', false) // on veut voir où l'on atterrit
  }

  if (getHud(scene.registry, 'debugOn')) {
    const { gx, gy } = deps.hover
    const inMap = gx >= 0 && gy >= 0 && gx < deps.map.width && gy < deps.map.height
    setHud(scene.registry, 'debugInfo', {
      tick: deps.tick,
      fps: scene.game.loop.actualFps,
      hover: inMap
        ? {
            tx: gx,
            ty: gy,
            terrain: TERRAINS[terrainAt(deps.map, gx, gy)]?.name ?? '?',
            elevation: elevationAt(deps.map, gx, gy),
            zone: zoneAt(deps.map, gx, gy)?.name ?? '—',
          }
        : null,
    })
  }
  return lastTeleportAt
}
