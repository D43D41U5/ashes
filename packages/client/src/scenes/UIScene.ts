/**
 * Scène UI en surimpression — pattern Manif : la caméra de jeu zoome et
 * suit l'avatar, l'UI vit dans une scène parallèle à caméra neutre (un
 * objet scrollFactor 0 dans une caméra zoomée serait projeté hors écran).
 * Communication par le registry : WorldScene écrit, UIScene lit.
 */
import { skillLevel, type GameTime, type Inventory, type SkillId, type VillageTask } from '@braises/sim'
import Phaser from 'phaser'

const TASK_LABELS: Record<VillageTask['kind'], string> = {
  gather_berries: 'récolter des baies',
  gather_wood: 'couper du bois',
  gather_fiber: 'ramasser des fibres',
  cook_stew: 'cuisiner',
  repair: 'réparer',
}

const STRUCTURE_LABELS: Record<string, string> = {
  wall: 'mur',
  door: 'porte',
  chest: 'coffre',
  workshop: 'atelier',
  furnace: 'four',
}

const SKILL_LABELS: Record<SkillId, string> = {
  woodcutting: 'Bûcheron',
  mining: 'Mineur',
  foraging: 'Cueilleur',
  crafting: 'Artisan',
}

const ITEM_LABELS: [keyof Inventory, string][] = [
  ['wood', 'Bois'],
  ['stone', 'Pierre'],
  ['fiber', 'Fibre'],
  ['berries', 'Baies'],
  ['stew', 'Ragoût'],
  ['iron_ore', 'Minerai'],
  ['coal', 'Charbon'],
  ['iron_ingot', 'Lingot'],
  ['axe', 'Hache'],
  ['pickaxe', 'Pioche'],
  ['iron_axe', 'Hache fer'],
  ['iron_pickaxe', 'Pioche fer'],
  ['spear', 'Lance'],
  ['raw_meat', 'Viande'],
  ['cooked_meat', 'Viande cuite'],
  ['components', 'Composants'],
]

/** Alpha de l'obscurité selon l'heure du cycle (jour [0,15), nuit [15,24)). */
function nightAlpha(hourOfCycle: number): number {
  const MAX = 0.55
  if (hourOfCycle < 13.5) return 0
  if (hourOfCycle < 16) return ((hourOfCycle - 13.5) / 2.5) * MAX // crépuscule
  if (hourOfCycle < 22.5) return MAX
  return (1 - (hourOfCycle - 22.5) / 1.5) * MAX // aube
}

export class UIScene extends Phaser.Scene {
  private nightOverlay!: Phaser.GameObjects.Rectangle
  private hud!: Phaser.GameObjects.Text
  private bottomBar!: Phaser.GameObjects.Text
  private errorText!: Phaser.GameObjects.Text
  private hpBar!: Phaser.GameObjects.Rectangle
  private staminaBar!: Phaser.GameObjects.Rectangle
  private woundsText!: Phaser.GameObjects.Text

  constructor() {
    super('ui')
  }

  create(): void {
    this.nightOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x0b1030, 0)
      .setOrigin(0)

    const style = {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#e8e0c8',
      stroke: '#14141a',
      strokeThickness: 3,
    }
    this.hud = this.add.text(10, 8, '', style)
    this.bottomBar = this.add.text(10, this.scale.height - 72, '', style)

    // Barres PV / endurance (haut droite) — lisibilité avant spectacle.
    this.add.rectangle(this.scale.width - 214, 12, 204, 14, 0x14141a).setOrigin(0)
    this.hpBar = this.add.rectangle(this.scale.width - 212, 14, 200, 10, 0xc0503e).setOrigin(0)
    this.add.rectangle(this.scale.width - 214, 30, 204, 14, 0x14141a).setOrigin(0)
    this.staminaBar = this.add.rectangle(this.scale.width - 212, 32, 200, 10, 0x4e9c5a).setOrigin(0)
    this.woundsText = this.add
      .text(this.scale.width - 214, 48, '', { ...style, color: '#ff9a7a', fontSize: '14px' })
      .setOrigin(0, 0)
    this.errorText = this.add
      .text(this.scale.width / 2, this.scale.height - 110, '', { ...style, color: '#ff7a6b' })
      .setOrigin(0.5, 0)
  }

  override update(): void {
    const time = this.registry.get('time') as GameTime | undefined
    if (!time) return
    this.nightOverlay.setAlpha(nightAlpha(time.hourOfCycle))

    const zone = this.registry.get('zone') as string | undefined
    const members = (this.registry.get('village') as number | undefined) ?? 0
    const tasks = (this.registry.get('tasks') as VillageTask[] | undefined) ?? []
    const archetype = this.registry.get('archetype') as string | null
    const villageWarmth = (this.registry.get('villageWarmth') as number | undefined) ?? 0
    const hour = String(Math.floor(time.hourOfCycle)).padStart(2, '0')
    const board = tasks
      .slice(0, 4)
      .map((t) => `${TASK_LABELS[t.kind]}${t.claimedBy !== null ? ' •' : ''}`)
      .join(', ')
    // Prévisible dans le sens, flou dans la magnitude : des mots, pas la formule.
    const feuLabel =
      archetype === 'foyer' ? 'Foyer' : archetype === 'meute' ? 'Meute' : villageWarmth > 10 ? 'tiède' : villageWarmth < -10 ? 'sombre' : 'neutre'
    this.hud.setText(
      `Jour ${time.seasonDay} — Acte ${'I'.repeat(time.act)} — ${hour}h${time.isNight ? ' (nuit)' : ''}` +
        (zone ? `\n${zone}` : '') +
        (members > 0 ? `\nVillage : ${members} membre${members > 1 ? 's' : ''} — Feu : ${feuLabel}` : '') +
        (board ? `\nTableau : ${board}` : ''),
    )

    const inv = (this.registry.get('inv') as Inventory | undefined) ?? {}
    const selected = (this.registry.get('selected') as string | undefined) ?? 'wall'
    const hunger = (this.registry.get('hunger') as number | undefined) ?? 100
    const skills = (this.registry.get('skills') as Partial<Record<SkillId, number>> | undefined) ?? {}

    const invText = ITEM_LABELS.filter(([item]) => (inv[item] ?? 0) > 0)
      .map(([item, label]) => `${label} ${inv[item]}`)
      .join(' · ')
    const skillsText = (Object.keys(skills) as SkillId[])
      .map((s) => ({ s, level: skillLevel(skills[s] ?? 0) }))
      .filter(({ level }) => level > 0)
      .map(({ s, level }) => `${SKILL_LABELS[s]} ${level}`)
      .join(' · ')

    this.bottomBar.setText(
      `Faim ${Math.ceil(hunger)}/100${hunger <= 0 ? ' ⚠ affamé' : ''}` +
        (skillsText ? ` — ${skillsText}` : '') +
        `\n${invText || '(mains vides — clique un arbre)'} — [${STRUCTURE_LABELS[selected]}]\n` +
        `F Feu · 1-5 bâtir · clic récolter/looter/bâtir · clic droit démolir · G réparer · shift+clic partager\n` +
        `ESPACE attaquer · C bloquer · SHIFT sprinter · X bander · T donner des baies · E/R manger · 6-0 crafter`,
    )

    const hp = (this.registry.get('hp') as number | undefined) ?? 100
    const stamina = (this.registry.get('stamina') as number | undefined) ?? 100
    const wounds = (this.registry.get('wounds') as Record<string, boolean> | undefined) ?? {}
    this.hpBar.width = 2 * Math.max(0, hp)
    this.staminaBar.width = 2 * Math.max(0, stamina)
    const woundLabels = [
      wounds.leg ? 'jambe blessée' : null,
      wounds.arm ? 'bras blessé' : null,
      wounds.bleeding ? 'SAIGNEMENT (X : bander)' : null,
    ].filter(Boolean)
    this.woundsText.setText(woundLabels.join(' · '))

    const error = this.registry.get('error') as { reason: string; at: number } | undefined
    if (error && this.time.now - error.at < 2500) {
      this.errorText.setText(error.reason).setAlpha(1 - (this.time.now - error.at) / 2500)
    } else {
      this.errorText.setText('')
    }

    // L'alarme (spec événements R4) : flash rouge pulsé pendant 3 s.
    const alarm = this.registry.get('alarm') as { at: number } | undefined
    if (alarm && this.time.now - alarm.at < 3000) {
      const pulse = 0.25 + 0.2 * Math.sin(this.time.now / 90)
      this.nightOverlay.setFillStyle(0x8a1a10).setAlpha(Math.max(this.nightOverlay.alpha, pulse))
    } else {
      this.nightOverlay.setFillStyle(0x0b1030)
    }
  }
}
