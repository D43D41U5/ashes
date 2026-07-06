/**
 * Scène UI en surimpression — pattern Manif : la caméra de jeu zoome et
 * suit l'avatar, l'UI vit dans une scène parallèle à caméra neutre (un
 * objet scrollFactor 0 dans une caméra zoomée serait projeté hors écran).
 * Communication par le registry : WorldScene écrit, UIScene lit.
 */
import { BALANCE, skillLevel, zoneAt, type Inventory, type SkillId, type VillageTask, type WorldMap } from '@braises/sim'
import Phaser from 'phaser'
import { getHud } from '../hud-state'
import { TILE_PX } from '../render/framing'

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

/** Heures affichées par cycle — horloge murale de `getGameTime` (hourOfCycle ∈ [0,24), minuit = 0h). */
const CYCLE_HOURS = 24
/** Aube murale (le cycle démarre au lever du jour) — 6 h par défaut. */
const DAWN_HOUR = BALANCE.CYCLE_DAWN_HOUR
/** Frontière jour/nuit dérivée de la sim (isNight bascule à cette heure) — 21 h : aube 6 h + 15 h de jour. */
const NIGHTFALL_HOUR = DAWN_HOUR + CYCLE_HOURS * BALANCE.CYCLE_DAY_FRACTION
/** Le crépuscule est un pur habillage : fondu entamé un peu avant la nuit logique, fini un peu après. */
const DUSK_START = NIGHTFALL_HOUR - 1.5
const DUSK_END = NIGHTFALL_HOUR + 1
/** L'aube visuelle : l'obscurité fond sur la dernière portion de la nuit, jusqu'au lever du jour. */
const DAWN_START = DAWN_HOUR - 1.5

/** Maxima des jauges du joueur — valeurs posées par `spawnEntity`
 * (packages/sim/src/sim.ts) ; la sim n'exporte pas (encore) de constante. */
const HP_MAX = 100
const STAMINA_MAX = 100
const HUNGER_MAX = 100
/** Largeur pleine des barres PV/endurance, en px écran. */
const BAR_WIDTH_PX = 200

/** Carte plein écran : bornes et pas du zoom (1 = carte ajustée, 8 = gros plan). */
const MAP_ZOOM_MIN = 1
const MAP_ZOOM_MAX = 8
const MAP_ZOOM_STEP = 1.15
/** Au-dessus de tout le HUD (et du journal, à profondeur par défaut). */
const MAP_OVERLAY_DEPTH = 1000

/**
 * Alpha de l'obscurité selon l'heure murale : nuit noire de part et d'autre de
 * minuit (crépuscule 19h30→22h, cœur 22h→4h30, aube 4h30→6h), plein jour 6h→19h30.
 */
function nightAlpha(hourOfCycle: number): number {
  const MAX = 0.55
  if (hourOfCycle < DAWN_START || hourOfCycle >= DUSK_END) return MAX // cœur de nuit, autour de minuit
  if (hourOfCycle < DAWN_HOUR) return (1 - (hourOfCycle - DAWN_START) / (DAWN_HOUR - DAWN_START)) * MAX // aube
  if (hourOfCycle < DUSK_START) return 0 // plein jour
  return ((hourOfCycle - DUSK_START) / (DUSK_END - DUSK_START)) * MAX // crépuscule
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

  // Carte plein écran (M) — visionneuse zoom/pan. Montée paresseusement (la
  // texture `map-demo` n'existe qu'après le `ready` de WorldScene).
  private mapRoot?: Phaser.GameObjects.Container
  private mapLayer!: Phaser.GameObjects.Container
  private mapImage!: Phaser.GameObjects.Image
  private mapMarker!: Phaser.GameObjects.Arc
  private mapHover!: Phaser.GameObjects.Text
  /** Échelle « carte entière ajustée à l'écran » — l'ancre du zoom (facteur ×). */
  private mapFit = 1
  private mapZoom = 1
  /** Dimensions de la texture carte (px monde) — pour borner le pan. */
  private mapTexW = 0
  private mapTexH = 0
  private mapDragging = false
  private mapDragStart = { px: 0, py: 0, lx: 0, ly: 0 }
  private mapWasOpen = false

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
          'ZQSD bouger · clic récolter/bâtir · F allumer ton Feu · ESPACE attaquer\nC bloquer · SHIFT sprinter · T donner · J la chronique · M la carte',
        { ...style, fontSize: '15px', strokeThickness: 0, align: 'center' },
      )
      .setOrigin(0.5, 0)
    this.welcome = this.add.container(this.scale.width / 2, this.scale.height / 2, [wBg, wTitle, wText])
    this.startedAt = this.time.now
    this.input.keyboard?.once('keydown', () => this.welcome.setVisible(false))

    this.errorText = this.add
      .text(this.scale.width / 2, this.scale.height - 110, '', { ...style, color: '#ff7a6b' })
      .setOrigin(0.5, 0)

    // Carte plein écran : molette = zoom ancré au curseur, clic gauche maintenu
    // = pan. Les handlers ne font rien tant que la carte n'est pas ouverte.
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.mapWheel(pointer, dy)
    })
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.mapVisible() || !pointer.leftButtonDown()) return
      this.mapDragging = true
      this.mapDragStart = { px: pointer.x, py: pointer.y, lx: this.mapLayer.x, ly: this.mapLayer.y }
    })
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.mapVisible()) return
      if (this.mapDragging) {
        this.mapLayer.x = this.mapDragStart.lx + (pointer.x - this.mapDragStart.px)
        this.mapLayer.y = this.mapDragStart.ly + (pointer.y - this.mapDragStart.py)
        this.clampMapPan()
      }
      this.updateMapHover(pointer)
    })
    this.input.on('pointerup', () => {
      this.mapDragging = false
    })
  }

  /** La carte est-elle montée ET ouverte ? (les handlers pointeur en dépendent) */
  private mapVisible(): boolean {
    return Boolean(this.mapRoot) && Boolean(getHud(this.registry, 'mapOpen'))
  }

  /** Monte l'overlay carte au premier affichage (texture `map-demo` prête). */
  private ensureMapOverlay(map: WorldMap): void {
    if (this.mapRoot) return
    const W = this.scale.width
    const H = this.scale.height
    const style = { fontFamily: 'monospace', fontSize: '16px', color: '#e8e0c8', stroke: '#14141a', strokeThickness: 3 }
    const bg = this.add.rectangle(0, 0, W, H, 0x0a0a0e, 0.9).setOrigin(0)
    const title = this.add.text(W / 2, 16, 'LA CARTE', { ...style, fontSize: '20px', color: '#e8c66a' }).setOrigin(0.5, 0)
    const hint = this.add
      .text(W / 2, H - 28, 'molette : zoom · glisser : déplacer · M : fermer', { ...style, fontSize: '13px', color: '#b8b0a0' })
      .setOrigin(0.5, 0)
    // Le lieu sous le curseur — en haut à gauche de la carte.
    this.mapHover = this.add.text(16, 16, '', { ...style, fontSize: '16px', color: '#e8c66a' }).setOrigin(0, 0)

    this.mapImage = this.add.image(0, 0, 'map-demo').setOrigin(0.5)
    const texW = map.width * TILE_PX
    const texH = map.height * TILE_PX
    this.mapTexW = texW
    this.mapTexH = texH
    // Ajuste la carte entière dans ~90 % × 82 % de l'écran (titre + aide gardent leur place).
    this.mapFit = Math.min((W * 0.9) / texW, (H * 0.82) / texH)
    this.mapMarker = this.add.circle(0, 0, 5, 0xffd94a).setStrokeStyle(2, 0x14141a)
    this.mapLayer = this.add.container(W / 2, H / 2, [this.mapImage, this.mapMarker])

    this.mapRoot = this.add
      .container(0, 0, [bg, this.mapLayer, title, hint, this.mapHover])
      .setDepth(MAP_OVERLAY_DEPTH)
      .setVisible(false)
  }

  /** Zoom molette, ancré au point de la carte sous le curseur. */
  private mapWheel(pointer: Phaser.Input.Pointer, deltaY: number): void {
    if (!this.mapVisible()) return
    const before = this.mapFit * this.mapZoom
    // Point-carte (local, non mis à l'échelle) actuellement sous le curseur.
    const lx = (pointer.x - this.mapLayer.x) / before
    const ly = (pointer.y - this.mapLayer.y) / before
    const factor = deltaY < 0 ? MAP_ZOOM_STEP : 1 / MAP_ZOOM_STEP
    this.mapZoom = Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, this.mapZoom * factor))
    const after = this.mapFit * this.mapZoom
    this.mapLayer.setScale(after)
    // Recale la position pour que ce même point reste sous le curseur.
    this.mapLayer.x = pointer.x - after * lx
    this.mapLayer.y = pointer.y - after * ly
    this.clampMapPan()
  }

  /**
   * Borne le pan sur la taille SCALÉE de la carte : plus petite que l'écran
   * (dans une dimension) → verrouillée au centre (pas de pan parasite quand la
   * carte tient déjà à l'écran) ; plus grande → pan autorisé mais l'image
   * couvre toujours l'écran, donc les bords peuvent atteindre les bords (mais
   * jamais de vide au-delà).
   */
  private clampMapPan(): void {
    const scale = this.mapFit * this.mapZoom
    const W = this.scale.width
    const H = this.scale.height
    const halfW = (this.mapTexW * scale) / 2
    const halfH = (this.mapTexH * scale) / 2
    this.mapLayer.x = 2 * halfW <= W ? W / 2 : Phaser.Math.Clamp(this.mapLayer.x, W - halfW, halfW)
    this.mapLayer.y = 2 * halfH <= H ? H / 2 : Phaser.Math.Clamp(this.mapLayer.y, H - halfH, halfH)
  }

  /** Nomme la zone/POI sous le curseur (haut-gauche), ou rien hors carte. */
  private updateMapHover(pointer: Phaser.Input.Pointer): void {
    const map = getHud(this.registry, 'mapData')
    if (!map) return
    const scale = this.mapFit * this.mapZoom
    const texW = map.width * TILE_PX
    const texH = map.height * TILE_PX
    const tx = ((pointer.x - this.mapLayer.x) / scale + texW / 2) / TILE_PX
    const ty = ((pointer.y - this.mapLayer.y) / scale + texH / 2) / TILE_PX
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) {
      this.mapHover.setText('')
      return
    }
    this.mapHover.setText(zoneAt(map, tx, ty)?.name ?? '')
  }

  /** Réinitialise la vue à l'ouverture : carte entière, centrée, zoom 1. */
  private resetMapView(): void {
    this.mapZoom = 1
    this.mapLayer.setScale(this.mapFit)
    this.mapLayer.setPosition(this.scale.width / 2, this.scale.height / 2)
  }

  /** Place le marqueur « tu es ici » et le tient à taille écran constante. */
  private updateMapMarker(map: WorldMap): void {
    const pos = getHud(this.registry, 'playerPos')
    const scale = this.mapFit * this.mapZoom
    if (pos) {
      this.mapMarker
        .setPosition(pos.x * TILE_PX - (map.width * TILE_PX) / 2, pos.y * TILE_PX - (map.height * TILE_PX) / 2)
        .setVisible(true)
    } else {
      this.mapMarker.setVisible(false)
    }
    this.mapMarker.setScale(1 / scale)
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
        `ESPACE attaquer · C bloquer · SHIFT sprinter · X bander · T donner des baies · E/R manger · 6-0 crafter · M carte`,
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

    // La carte plein écran (M) : montée à la première ouverture, puis basculée.
    const mapData = getHud(this.registry, 'mapData')
    const mapOpen = Boolean(getHud(this.registry, 'mapOpen'))
    if (mapOpen && mapData && this.textures.exists('map-demo')) this.ensureMapOverlay(mapData)
    if (this.mapRoot) {
      this.mapRoot.setVisible(mapOpen)
      if (mapOpen && mapData) {
        if (!this.mapWasOpen) this.resetMapView() // vue neuve à chaque ouverture
        this.updateMapMarker(mapData)
      }
      this.mapWasOpen = mapOpen
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
