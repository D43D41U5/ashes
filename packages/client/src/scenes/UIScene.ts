/**
 * Scène UI en surimpression — pattern Manif : la caméra de jeu zoome et
 * suit l'avatar, l'UI vit dans une scène parallèle à caméra neutre (un
 * objet scrollFactor 0 dans une caméra zoomée serait projeté hors écran).
 * Communication par le registry : WorldScene écrit, UIScene lit.
 */
import { BALANCE, skillLevel, type Inventory, type SkillId, type VillageTask } from '@braises/sim'
import Phaser from 'phaser'
import { getHud } from '../hud-state'

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

/** Heures affichées par cycle — convention de `getGameTime` (hourOfCycle ∈ [0,24)). */
const CYCLE_HOURS = 24
/** Frontière jour/nuit dérivée de la sim (isNight bascule à cette heure) — 15 h avec CYCLE_DAY_FRACTION = 0,625. */
const NIGHTFALL_HOUR = CYCLE_HOURS * BALANCE.CYCLE_DAY_FRACTION
/** Le crépuscule est un pur habillage : fondu entamé un peu avant la nuit logique, fini un peu après. */
const DUSK_START = NIGHTFALL_HOUR - 1.5
const DUSK_END = NIGHTFALL_HOUR + 1
/** L'aube visuelle : l'obscurité fond sur la dernière portion de la nuit. */
const DAWN_START = CYCLE_HOURS - 1.5

/** Maxima des jauges du joueur — valeurs posées par `spawnEntity`
 * (packages/sim/src/sim.ts) ; la sim n'exporte pas (encore) de constante. */
const HP_MAX = 100
const STAMINA_MAX = 100
const HUNGER_MAX = 100
/** Largeur pleine des barres PV/endurance, en px écran. */
const BAR_WIDTH_PX = 200

/** Alpha de l'obscurité selon l'heure du cycle (jour [0,NIGHTFALL), nuit [NIGHTFALL,24)). */
function nightAlpha(hourOfCycle: number): number {
  const MAX = 0.55
  if (hourOfCycle < DUSK_START) return 0
  if (hourOfCycle < DUSK_END) return ((hourOfCycle - DUSK_START) / (DUSK_END - DUSK_START)) * MAX // crépuscule
  if (hourOfCycle < DAWN_START) return MAX
  return (1 - (hourOfCycle - DAWN_START) / (CYCLE_HOURS - DAWN_START)) * MAX // aube
}

export class UIScene extends Phaser.Scene {
  private nightOverlay!: Phaser.GameObjects.Rectangle
  private hud!: Phaser.GameObjects.Text
  private bottomBar!: Phaser.GameObjects.Text
  private errorText!: Phaser.GameObjects.Text
  private hpBar!: Phaser.GameObjects.Rectangle
  private staminaBar!: Phaser.GameObjects.Rectangle
  private woundsText!: Phaser.GameObjects.Text
  private journalPanel!: Phaser.GameObjects.Container
  private journalText!: Phaser.GameObjects.Text
  private welcome!: Phaser.GameObjects.Container
  private startedAt = 0

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
    this.hpBar = this.add.rectangle(this.scale.width - 212, 14, BAR_WIDTH_PX, 10, 0xc0503e).setOrigin(0)
    this.add.rectangle(this.scale.width - 214, 30, 204, 14, 0x14141a).setOrigin(0)
    this.staminaBar = this.add.rectangle(this.scale.width - 212, 32, BAR_WIDTH_PX, 10, 0x4e9c5a).setOrigin(0)
    this.woundsText = this.add
      .text(this.scale.width - 214, 48, '', { ...style, color: '#ff9a7a', fontSize: '14px' })
      .setOrigin(0, 0)

    // Le journal (J) : la chronique de la saison, la Mémoire v1.
    const panelBg = this.add.rectangle(0, 0, 720, 480, 0x14141a, 0.92).setOrigin(0.5).setStrokeStyle(2, 0x6b5a3a)
    const panelTitle = this.add
      .text(0, -215, 'LA CHRONIQUE', { ...style, fontSize: '20px', color: '#e8c66a' })
      .setOrigin(0.5, 0)
    this.journalText = this.add
      .text(-330, -180, '', { ...style, fontSize: '14px', strokeThickness: 0, wordWrap: { width: 660 } })
      .setOrigin(0, 0)
    this.journalPanel = this.add
      .container(this.scale.width / 2, this.scale.height / 2, [panelBg, panelTitle, this.journalText])
      .setVisible(false)

    // L'accueil (V10) : le temps d'un regard, les touches.
    const wBg = this.add.rectangle(0, 0, 760, 300, 0x14141a, 0.92).setOrigin(0.5).setStrokeStyle(2, 0x8a4a2e)
    const wTitle = this.add
      .text(0, -120, 'BRAISES — la Veillée', { ...style, fontSize: '26px', color: '#e8842c' })
      .setOrigin(0.5, 0)
    const wText = this.add
      .text(
        0,
        -70,
        'Ton village est ton personnage. Récolte, bâtis, nourris les tiens —\net survis aux nuits. Le monde meurt au jour 60 ; la chronique retiendra le reste.\n\n' +
          'ZQSD bouger · clic récolter/bâtir · F allumer ton Feu · ESPACE attaquer\nC bloquer · SHIFT sprinter · T donner · J la chronique',
        { ...style, fontSize: '15px', strokeThickness: 0, align: 'center' },
      )
      .setOrigin(0.5, 0)
    this.welcome = this.add.container(this.scale.width / 2, this.scale.height / 2, [wBg, wTitle, wText])
    this.startedAt = this.time.now
    this.input.keyboard?.once('keydown', () => this.welcome.setVisible(false))

    this.errorText = this.add
      .text(this.scale.width / 2, this.scale.height - 110, '', { ...style, color: '#ff7a6b' })
      .setOrigin(0.5, 0)
  }

  override update(): void {
    const time = getHud(this.registry, 'time')
    if (!time) return
    this.nightOverlay.setAlpha(nightAlpha(time.hourOfCycle))

    const zone = getHud(this.registry, 'zone')
    const members = getHud(this.registry, 'village') ?? 0
    const tasks = getHud(this.registry, 'tasks') ?? []
    const archetype = getHud(this.registry, 'archetype') ?? null
    const villageWarmth = getHud(this.registry, 'villageWarmth') ?? 0
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

    const inv = getHud(this.registry, 'inv') ?? {}
    const selected = getHud(this.registry, 'selected') ?? 'wall'
    const hunger = getHud(this.registry, 'hunger') ?? 100
    const skills = getHud(this.registry, 'skills') ?? {}

    const invText = ITEM_LABELS.filter(([item]) => (inv[item] ?? 0) > 0)
      .map(([item, label]) => `${label} ${inv[item]}`)
      .join(' · ')
    const skillsText = (Object.keys(skills) as SkillId[])
      .map((s) => ({ s, level: skillLevel(skills[s] ?? 0) }))
      .filter(({ level }) => level > 0)
      .map(({ s, level }) => `${SKILL_LABELS[s]} ${level}`)
      .join(' · ')

    this.bottomBar.setText(
      `Faim ${Math.ceil(hunger)}/${HUNGER_MAX}${hunger <= 0 ? ' ⚠ affamé' : ''}` +
        (skillsText ? ` — ${skillsText}` : '') +
        `\n${invText || '(mains vides — clique un arbre)'} — [${STRUCTURE_LABELS[selected]}]\n` +
        `F Feu · 1-5 bâtir · clic récolter/looter/bâtir · clic droit démolir · G réparer · shift+clic partager\n` +
        `ESPACE attaquer · C bloquer · SHIFT sprinter · X bander · T donner des baies · E/R manger · 6-0 crafter`,
    )

    const hp = getHud(this.registry, 'hp') ?? 100
    const stamina = getHud(this.registry, 'stamina') ?? 100
    const wounds = getHud(this.registry, 'wounds') ?? {}
    this.hpBar.width = (BAR_WIDTH_PX * Math.max(0, hp)) / HP_MAX
    this.staminaBar.width = (BAR_WIDTH_PX * Math.max(0, stamina)) / STAMINA_MAX
    const woundLabels = [
      wounds.leg ? 'jambe blessée' : null,
      wounds.arm ? 'bras blessé' : null,
      wounds.bleeding ? 'SAIGNEMENT (X : bander)' : null,
    ].filter(Boolean)
    this.woundsText.setText(woundLabels.join(' · '))

    const error = getHud(this.registry, 'error')
    if (error && this.time.now - error.at < 2500) {
      this.errorText.setText(error.reason).setAlpha(1 - (this.time.now - error.at) / 2500)
    } else {
      this.errorText.setText('')
    }

    // L'accueil s'efface tout seul.
    if (this.welcome.visible && this.time.now - this.startedAt > 15000) this.welcome.setVisible(false)

    // Le journal : ouvert à la demande (J), ou de force à la fin de saison.
    const chronicle = getHud(this.registry, 'chronicle') ?? []
    const open = Boolean(getHud(this.registry, 'journalOpen')) || Boolean(getHud(this.registry, 'seasonEnded'))
    this.journalPanel.setVisible(open)
    if (open) {
      this.journalText.setText(chronicle.slice(-26).join('\n') || '(rien encore — le monde est jeune)')
    }

    // L'alarme (spec événements R4) : flash rouge pulsé pendant 3 s.
    const alarm = getHud(this.registry, 'alarm')
    if (alarm && this.time.now - alarm.at < 3000) {
      const pulse = 0.25 + 0.2 * Math.sin(this.time.now / 90)
      this.nightOverlay.setFillStyle(0x8a1a10).setAlpha(Math.max(this.nightOverlay.alpha, pulse))
    } else {
      this.nightOverlay.setFillStyle(0x0b1030)
    }
  }
}
