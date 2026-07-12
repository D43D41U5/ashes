/**
 * Scène UI en surimpression — pattern Manif : la caméra de jeu zoome et
 * suit l'avatar, l'UI vit dans une scène parallèle à caméra neutre (un
 * objet scrollFactor 0 dans une caméra zoomée serait projeté hors écran).
 * Communication par le registry : WorldScene écrit, UIScene lit.
 */
import { zoneAt, type VillageTask, type WorldMap } from '@braises/sim'
import Phaser from 'phaser'
import { getHud } from '../hud-state'
import { TILE_PX } from '../render/framing'
import { createHotbar, type Hotbar } from './ui/hotbar'
import { createVitals, type Vitals } from './ui/vitals'
import { createDebugOverlay, renderDebugOverlay, requestTeleport } from './world/debug-overlay'

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

/** Carte plein écran : bornes et pas du zoom (1 = carte ajustée, 8 = gros plan). */
const MAP_ZOOM_MIN = 1
const MAP_ZOOM_MAX = 8
const MAP_ZOOM_STEP = 1.15
/** Au-dessus de tout le HUD (et du journal, à profondeur par défaut). */
const MAP_OVERLAY_DEPTH = 1000
/** Pastille de POI sur la carte : plus petite et plus froide que le marqueur joueur, qui doit primer. */
const MAP_POI_RADIUS = 3
const MAP_POI_FILL = 0xe8e0c8
const MAP_POI_STROKE = 0x14141a
/** Sous ce déplacement (px), un appui-relâché sur la carte est un CLIC, pas un pan. */
const MAP_CLICK_SLOP_PX = 5

export class UIScene extends Phaser.Scene {
  private alarmOverlay!: Phaser.GameObjects.Rectangle
  private hud!: Phaser.GameObjects.Text
  private errorText!: Phaser.GameObjects.Text
  private hotbar!: Hotbar
  private vitals!: Vitals
  /** La ligne d'aide sous la ceinture — structure à bâtir (B) + béquilles de touches. */
  private hint!: Phaser.GameObjects.Text
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
  /** Une pastille par POI (zone avec un `kind`), AVEC son poiId — l'index dans `map.zones`,
   *  qui est l'identité d'un lieu (spec lieux R4). Le filtre `knownPois` en dépend. */
  private mapPoiDots: { poiId: number; dot: Phaser.GameObjects.Arc }[] = []
  /** Dernière échelle appliquée aux pastilles — évite de les reparcourir à chaque frame. */
  private mapPoiScale = 0
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
  /** Aide de la carte — sa dernière ligne change quand le mode debug est armé. */
  private mapHint?: Phaser.GameObjects.Text

  /** Overlay du mode debug (DEV, F1) — au-dessus de tout, carte comprise. */
  private debugText?: Phaser.GameObjects.Text

  constructor() {
    super('ui')
  }

  create(): void {
    this.alarmOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x8a1a10, 0)
      .setOrigin(0)

    const style = {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#e8e0c8',
      stroke: '#14141a',
      strokeThickness: 3,
    }
    this.hud = this.add.text(10, 8, '', style)

    // Les vitales (bas-gauche) et la ceinture (bas-centre) — le HUD parle
    // désormais en cases et en jauges, plus en pavé de texte (spec inv R17-R18).
    this.vitals = createVitals(this)
    this.hotbar = createHotbar(this)
    // Sous la ceinture : ce qu'on bâtira au clic (B fait défiler) + les béquilles
    // de touches jusqu'aux chantiers 2-3 (craft sur SHIFT+1…5, sac sur TAB).
    this.hint = this.add
      .text(this.scale.width / 2, this.scale.height - 74, '', { ...style, fontSize: '12px', color: '#b8b0a0' })
      .setOrigin(0.5, 1)

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

    // L'overlay de debug (F1) — DEV seulement, et hors de cette classe : voir
    // l'en-tête de debug-overlay.ts (une méthode survivrait au build de prod).
    if (import.meta.env.DEV) {
      this.debugText = createDebugOverlay(this, style, MAP_OVERLAY_DEPTH + 1)
    }

    // Carte plein écran : molette = zoom ancré au curseur, clic gauche maintenu
    // = pan. Les handlers ne font rien tant que la carte n'est pas ouverte.
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.mapWheel(pointer, dy)
    })
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.mapVisible()) return
      // Le point d'appui est mémorisé pour TOUT bouton (le `pointerup` s'en sert
      // pour distinguer clic et pan) ; seul le gauche arme le glissement.
      this.mapDragStart = { px: pointer.x, py: pointer.y, lx: this.mapLayer.x, ly: this.mapLayer.y }
      if (pointer.leftButtonDown()) this.mapDragging = true
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
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      // DEV, mode debug armé (F1) : un clic SANS glisser téléporte l'avatar sur
      // la tuile visée. Le seuil distingue le clic du relâchement d'un pan —
      // sans lui, tout déplacement de carte finirait par un TP surprise.
      if (import.meta.env.DEV && this.mapVisible() && getHud(this.registry, 'debugOn')) {
        const dragged = Math.abs(pointer.x - this.mapDragStart.px) + Math.abs(pointer.y - this.mapDragStart.py)
        const tile = dragged <= MAP_CLICK_SLOP_PX ? this.mapTileAt(pointer) : null
        // On POSE la demande ; WorldScene la consomme (elle seule parle à l'hôte).
        if (tile) requestTeleport(this, tile)
      }
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
    this.mapHint = hint
    // Le lieu sous le curseur — en haut à gauche de la carte.
    this.mapHover = this.add.text(16, 16, '', { ...style, fontSize: '16px', color: '#e8c66a' }).setOrigin(0, 0)

    const texW = map.width * TILE_PX
    const texH = map.height * TILE_PX
    // `map-demo` est bakée à 1 px/tuile (grande carte) → on l'étire à la taille monde
    // (texW×texH) pour que le fit et le mapping curseur→tuile ci-dessous restent justes.
    this.mapImage = this.add.image(0, 0, 'map-demo').setOrigin(0.5).setDisplaySize(texW, texH)
    this.mapTexW = texW
    this.mapTexH = texH
    // Ajuste la carte entière dans ~90 % × 82 % de l'écran (titre + aide gardent leur place).
    this.mapFit = Math.min((W * 0.9) / texW, (H * 0.82) / texH)
    // Une pastille par POI (zone porteuse d'un `kind` ; les zones sans `kind` sont de simples
    // toponymes). Créées une fois — leur VISIBILITÉ, elle, suit `knownPois` (spec lieux R1).
    this.mapPoiDots = map.zones
      .map((z, poiId) => ({ z, poiId }))
      .filter(({ z }) => z.kind !== undefined)
      .map(({ z, poiId }) => ({
        poiId,
        dot: this.add
          .circle(this.mapLocalX(map, z.x + z.w / 2), this.mapLocalY(map, z.y + z.h / 2), MAP_POI_RADIUS, MAP_POI_FILL)
          .setStrokeStyle(1, MAP_POI_STROKE)
          .setVisible(false), // rien n'est connu au départ
      }))

    this.mapMarker = this.add.circle(0, 0, 5, 0xffd94a).setStrokeStyle(2, 0x14141a)
    // Le marqueur joueur passe APRÈS les pastilles : il doit rester lisible par-dessus.
    this.mapLayer = this.add.container(W / 2, H / 2, [this.mapImage, ...this.mapPoiDots.map((p) => p.dot), this.mapMarker])

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

  /** Le point de la carte sous le curseur, en TUILES — `null` hors des bornes. */
  private mapTileAt(pointer: Phaser.Input.Pointer): { tx: number; ty: number } | null {
    const map = getHud(this.registry, 'mapData')
    if (!map) return null
    const scale = this.mapFit * this.mapZoom
    const tx = ((pointer.x - this.mapLayer.x) / scale + (map.width * TILE_PX) / 2) / TILE_PX
    const ty = ((pointer.y - this.mapLayer.y) / scale + (map.height * TILE_PX) / 2) / TILE_PX
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return null
    return { tx, ty }
  }

  /** Nomme la zone/POI sous le curseur (haut-gauche), ou rien hors carte.
   *  Une zone inconnue ne se nomme pas : le survol ne peut pas trahir ce que
   *  la pastille cache (sinon il suffirait de balayer la carte à la souris). Les
   *  toponymes sans `kind` (le Pont, le Col) restent nommés — ils font partie de
   *  la forme de la vallée, pas de son secret (spec lieux R1-R2). */
  private updateMapHover(pointer: Phaser.Input.Pointer): void {
    const map = getHud(this.registry, 'mapData')
    if (!map) return
    const at = this.mapTileAt(pointer)
    const zone = at ? zoneAt(map, at.tx, at.ty) : undefined
    const poiId = zone ? map.zones.indexOf(zone) : -1
    const hidden = zone?.kind !== undefined && !(getHud(this.registry, 'knownPois') ?? []).includes(poiId)
    this.mapHover.setText(zone && !hidden ? zone.name : '')
  }

  /** Réinitialise la vue à l'ouverture : carte entière, centrée, zoom 1. */
  private resetMapView(): void {
    this.mapZoom = 1
    this.mapLayer.setScale(this.mapFit)
    this.mapLayer.setPosition(this.scale.width / 2, this.scale.height / 2)
  }

  /** Tuile → coordonnée locale du `mapLayer` (pixels-monde, origine au centre de la carte). */
  private mapLocalX(map: WorldMap, tx: number): number {
    return tx * TILE_PX - (map.width * TILE_PX) / 2
  }

  private mapLocalY(map: WorldMap, ty: number): number {
    return ty * TILE_PX - (map.height * TILE_PX) / 2
  }

  /** Place le marqueur « tu es ici » et le tient à taille écran constante. */
  private updateMapMarker(map: WorldMap): void {
    const pos = getHud(this.registry, 'playerPos')
    const scale = this.mapFit * this.mapZoom
    if (pos) {
      this.mapMarker.setPosition(this.mapLocalX(map, pos.x), this.mapLocalY(map, pos.y)).setVisible(true)
    } else {
      this.mapMarker.setVisible(false)
    }
    this.mapMarker.setScale(1 / scale)
  }

  /**
   * Tient les pastilles POI à taille écran constante (mémoïsé — la boucle d'échelle
   * resterait sinon proportionnelle au nombre de POIs à chaque frame, aujourd'hui ~90,
   * mais le rayon Poisson des POIs est une dette connue) ET fait suivre leur visibilité
   * à `knownPois` : les lieux se gagnent, la carte ne montre que ce qu'on connaît (spec
   * lieux R1).
   */
  private updateMapPoiDots(): void {
    const scale = this.mapFit * this.mapZoom
    if (scale !== this.mapPoiScale) {
      this.mapPoiScale = scale
      for (const { dot } of this.mapPoiDots) dot.setScale(1 / scale)
    }
    // Les lieux se gagnent : on ne montre que ceux qu'on connaît (spec lieux R1).
    const known = getHud(this.registry, 'knownPois') ?? []
    for (const { poiId, dot } of this.mapPoiDots) dot.setVisible(known.includes(poiId))
  }

  override update(): void {
    const time = getHud(this.registry, 'time')
    if (!time) return

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

    // La ceinture et les vitales : on ne fait que RELAYER le snapshot vers les
    // modules d'affichage (aucune règle d'inventaire côté client — spec R22).
    const inv = getHud(this.registry, 'inv') ?? []
    const activeSlot = getHud(this.registry, 'activeSlot') ?? -1
    this.hotbar.update(inv, activeSlot)
    this.vitals.update({
      hp: getHud(this.registry, 'hp') ?? 100,
      stamina: getHud(this.registry, 'stamina') ?? 100,
      hunger: getHud(this.registry, 'hunger') ?? 100,
      temperature: getHud(this.registry, 'temperature') ?? 100,
      wounds: getHud(this.registry, 'wounds') ?? {},
    })

    // La ligne d'aide : la structure au clic (B) + les béquilles de touches.
    const selected = getHud(this.registry, 'selected') ?? 'wall'
    this.hint.setText(
      `B : bâtir [${STRUCTURE_LABELS[selected]}] · 1-6 ceinture · molette : changer · TAB sac · SHIFT+1-5 crafter`,
    )

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
        this.updateMapPoiDots()
      }
      this.mapWasOpen = mapOpen
    }

    if (import.meta.env.DEV && this.debugText) renderDebugOverlay(this, this.debugText, this.mapHint)

    // L'alarme (spec événements R4) : flash rouge pulsé pendant 3 s.
    const alarm = getHud(this.registry, 'alarm')
    if (alarm && this.time.now - alarm.at < 3000) {
      const pulse = 0.25 + 0.2 * Math.sin(this.time.now / 90)
      this.alarmOverlay.setAlpha(pulse)
    } else {
      this.alarmOverlay.setAlpha(0)
    }
  }
}
