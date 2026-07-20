/**
 * Le mode DEBUG (dev uniquement) — P l'arme et ouvre le PANNEAU cliquable
 * (debug-panel.ts) ; les touches restent en accélérateurs :
 *   P   fermer     F2  invulnérabilité     F3  jour ↔ nuit     F4  cadence ×1/2/4/8
 *   (l'éclairage dynamique n'a pas de touche — voir le panneau ; clic carte M : TP)
 *
 * Tout est ISOLÉ ici, et l'unique appelant (WorldScene) garde l'import derrière
 * `import.meta.env.DEV` : en production, ce module n'est pas dans le bundle.
 * Deuxième garde, plus solide, côté autorité : la sim de prod n'est pas créée
 * avec `debug: true`, donc elle refuse ces actions (packages/sim/src/debug.ts).
 *
 * Le TP, lui, ne se câble PAS ici : le clic vit sur la carte plein écran, donc
 * dans UIScene. Elle publie une demande (`debugTeleport`) que WorldScene
 * consomme — le registry est le bus entre les deux scènes.
 */
import type { PlayerAction } from '@braises/sim'
import Phaser from 'phaser'
import { getHud, setHud } from '../../hud-state'
import { DEBUG_KEYMAP } from './keymap'

/** Les crans de cadence, dans l'ordre où F4 les fait défiler. */
const SPEEDS = [1, 2, 4, 8] as const
/** Midi et minuit — les deux seules heures qui nous intéressent au clavier. */
const HOUR_DAY = 12
const HOUR_NIGHT = 0

export interface DebugDeps {
  sendAction(action: PlayerAction): void
  /** Cadence de l'HÔTE (pas de la sim) — message `debug_speed` du protocole. */
  setSpeed(factor: number): void
  /** Nuit ? Vient du dernier snapshot — F3 bascule vers l'autre. */
  isNight(): boolean
}

export function bindDebugKeys(scene: Phaser.Scene, deps: DebugDeps): void {
  const kb = scene.input.keyboard!
  const K = Phaser.Input.Keyboard.KeyCodes as Record<string, number>
  const onDown = (names: readonly string[], fn: () => void): void => {
    for (const n of names) kb.addKey(K[n]!, false).on('down', fn)
  }
  const isOn = (): boolean => Boolean(getHud(scene.registry, 'debugOn'))

  setHud(scene.registry, 'debugOn', false)
  setHud(scene.registry, 'debugGod', false)
  setHud(scene.registry, 'debugSpeed', 1)
  setHud(scene.registry, 'debugLighting', false)

  onDown(DEBUG_KEYMAP.toggle, () => {
    const on = !isOn()
    setHud(scene.registry, 'debugOn', on)
    // Éteindre le mode range les outils : on ne laisse pas un avatar
    // invulnérable ou une horloge ×8 derrière soi sans overlay pour le dire.
    if (!on) {
      setHud(scene.registry, 'debugGod', false)
      setHud(scene.registry, 'debugSpeed', 1)
      deps.sendAction({ type: 'debug_god', on: false })
      deps.setSpeed(1)
    }
  })

  onDown(DEBUG_KEYMAP.god, () => {
    if (!isOn()) return
    const god = !getHud(scene.registry, 'debugGod')
    setHud(scene.registry, 'debugGod', god)
    deps.sendAction({ type: 'debug_god', on: god })
  })

  onDown(DEBUG_KEYMAP.cycleDayNight, () => {
    if (!isOn()) return
    deps.sendAction({ type: 'debug_set_hour', hour: deps.isNight() ? HOUR_DAY : HOUR_NIGHT })
  })

  onDown(DEBUG_KEYMAP.cycleSpeed, () => {
    if (!isOn()) return
    const current = getHud(scene.registry, 'debugSpeed') ?? 1
    const next = SPEEDS[(SPEEDS.indexOf(current as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]!
    setHud(scene.registry, 'debugSpeed', next)
    deps.setSpeed(next)
  })
  // L'éclairage dynamique (essai, decisions.md 2026-07-20) n'a PAS de touche : F5 rechargeait
  // la page. Son interrupteur vit dans le panneau debug cliquable (debug-panel.ts).
}
