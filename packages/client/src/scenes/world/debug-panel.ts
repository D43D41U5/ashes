/**
 * Le PANNEAU DEBUG (DEV uniquement) — des interrupteurs CLIQUABLES, armés par P.
 *
 * Remplace les touches F2-F5 (F5 rechargeait la page — raccourci navigateur) par
 * un panneau DOM : on clique un toggle, il pilote le MÊME état registry / action
 * que les touches. Les raccourcis F2/F3/F4 restent, en accélérateurs (voir
 * debug-bindings.ts) ; le panneau est la surface principale.
 *
 * DOM et non Phaser : un bouton se clique sans ambiguïté, et le canvas upscalé
 * (Scale.FIT) rendrait des libellés flous. Comme tout le debug, ce module n'est
 * importé que sous `import.meta.env.DEV` : Rollup l'élimine du bundle de prod.
 */
import type Phaser from 'phaser'
import type { PlayerAction } from '@braises/sim'
import { getHud, setHud } from '../../hud-state'

const SPEEDS = [1, 2, 4, 8] as const
const HOUR_DAY = 12
const HOUR_NIGHT = 0

export interface DebugPanelDeps {
  sendAction(action: PlayerAction): void
  setSpeed(factor: number): void
  isNight(): boolean
}

export function createDebugPanel(scene: Phaser.Scene, deps: DebugPanelDeps): void {
  const reg = scene.registry

  const root = document.createElement('div')
  root.style.cssText = [
    'position:fixed', 'top:96px', 'left:12px', 'z-index:50',
    'display:none', 'flex-direction:column', 'gap:6px',
    'padding:10px 10px 11px', 'width:186px',
    'font:12px/1.3 ui-sans-serif,system-ui,sans-serif', 'color:#e6d9c4',
    'background:rgba(20,15,11,0.86)', 'border:1px solid #33291f', 'border-radius:12px',
    'backdrop-filter:blur(6px)', 'box-shadow:0 14px 40px -16px rgba(0,0,0,0.7)',
    'user-select:none',
  ].join(';')

  const title = document.createElement('div')
  title.textContent = 'DEBUG'
  title.style.cssText = 'font-size:10px;letter-spacing:0.22em;color:#6b5f50;font-weight:600;margin-bottom:2px'
  root.appendChild(title)

  const mkBtn = (): HTMLButtonElement => {
    const b = document.createElement('button')
    b.style.cssText = [
      'appearance:none', 'cursor:pointer', 'text-align:left',
      'padding:7px 9px', 'border-radius:8px', 'border:1px solid #33291f',
      'font:inherit', 'color:#e6d9c4', 'background:#241a13', 'transition:background 120ms,color 120ms',
    ].join(';')
    b.onmouseenter = () => { b.style.background = '#2f2117' }
    b.onmouseleave = () => { render() }
    root.appendChild(b)
    return b
  }

  const bGod = mkBtn()
  const bLight = mkBtn()
  const bSpeed = mkBtn()
  const bNight = mkBtn()

  // Un toggle actif s'allume en ambre ; inactif, il reste terne.
  const paint = (b: HTMLButtonElement, label: string, active: boolean): void => {
    b.textContent = label
    b.style.background = active ? '#3a2716' : '#241a13'
    b.style.color = active ? '#f6a94a' : '#9a8b76'
    b.style.borderColor = active ? '#5a3c1e' : '#33291f'
  }

  function render(): void {
    const on = Boolean(getHud(reg, 'debugOn'))
    root.style.display = on ? 'flex' : 'none'
    if (!on) return
    paint(bGod, `Invulnérabilité${getHud(reg, 'debugGod') ? ' ·on' : ''}`, Boolean(getHud(reg, 'debugGod')))
    paint(bLight, `Éclairage dynamique${getHud(reg, 'debugLighting') ? ' ·on' : ''}`, Boolean(getHud(reg, 'debugLighting')))
    const sp = getHud(reg, 'debugSpeed') ?? 1
    paint(bSpeed, `Cadence ×${sp}`, sp !== 1)
    paint(bNight, deps.isNight() ? 'Passer au JOUR' : 'Passer à la NUIT', false)
  }

  bGod.onclick = () => {
    const god = !getHud(reg, 'debugGod')
    setHud(reg, 'debugGod', god)
    deps.sendAction({ type: 'debug_god', on: god })
    render()
  }
  bLight.onclick = () => {
    setHud(reg, 'debugLighting', !getHud(reg, 'debugLighting'))
    render()
  }
  bSpeed.onclick = () => {
    const cur = getHud(reg, 'debugSpeed') ?? 1
    const next = SPEEDS[(SPEEDS.indexOf(cur as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]!
    setHud(reg, 'debugSpeed', next)
    deps.setSpeed(next)
    render()
  }
  bNight.onclick = () => {
    deps.sendAction({ type: 'debug_set_hour', hour: deps.isNight() ? HOUR_DAY : HOUR_NIGHT })
    render()
  }

  document.body.appendChild(root)
  render()

  // Le panneau suit l'état : P (debugOn) l'affiche/cache, et les leviers changés au
  // clavier (F2/F3/F4) rafraîchissent les toggles. `changedata` couvre tout le registry.
  const onChange = (): void => render()
  reg.events.on('changedata', onChange)
  scene.events.once('shutdown', () => {
    reg.events.off('changedata', onChange)
    root.remove()
  })
}
