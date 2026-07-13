/**
 * Scène UI en surimpression — pattern Manif : la caméra de jeu zoome et
 * suit l'avatar, l'UI vit dans une scène parallèle à caméra neutre (un
 * objet scrollFactor 0 dans une caméra zoomée serait projeté hors écran).
 * Communication par le registry : WorldScene écrit, UIScene lit.
 */
import { BALANCE, zoneAt, type VillageTask, type WorldMap } from '@braises/sim'
import Phaser from 'phaser'
import { getHud, setHud } from '../hud-state'
import { drainPickups, queueAction } from './world/hud-bridge'
import { TILE_PX } from '../render/framing'
import { createHotbar, type Hotbar } from './ui/hotbar'
import { createFatalPanel, type FatalPanel } from './ui/fatal'
import { createInventoryPanel, inventoryGeometry, type InventoryPanel } from './ui/inventory-panel'
import { CRAFT_PANEL_MARGIN_Y, CRAFT_PANEL_W, createCraftPanel, type CraftPanel } from './ui/craft-panel'
import { createCraftQueueView, type CraftQueueView } from './ui/craft-queue'
import { createLoadingScreen, type LoadingScreen } from './ui/loading'
import { createPickupToasts, type PickupToasts } from './ui/pickup-toasts'
import { createVitals, type Vitals } from './ui/vitals'
import { createDebugOverlay, renderDebugOverlay, requestTeleport } from './world/debug-overlay'
import { FONT } from './ui/typography'

const TASK_LABELS: Record<VillageTask['kind'], string> = {
  gather_berries: 'récolter des baies',
  gather_wood: 'couper du bois',
  gather_fiber: 'ramasser des fibres',
  cook_stew: 'cuisiner',
  repair: 'réparer',
}

/** Carte plein écran : bornes et pas du zoom (1 = carte ajustée, 8 = gros plan). */
const MAP_ZOOM_MIN = 1
const MAP_ZOOM_MAX = 8
const MAP_ZOOM_STEP = 1.15
/** Au-dessus de tout le HUD (et du journal, à profondeur par défaut). */
const MAP_OVERLAY_DEPTH = 1000
/** L'écran de chargement couvre TOUT (carte comprise) — il est seul au monde. */
const LOADING_DEPTH = MAP_OVERLAY_DEPTH + 1
/** L'écran de RUPTURE passe même devant le chargement : l'hôte peut mourir en pleine
 *  génération, et il ne faut surtout pas laisser tourner une barre qui ne montera plus. */
const FATAL_DEPTH = LOADING_DEPTH + 2
/** L'overlay de debug (F1, DEV) reste au-dessus de tout. */
const DEBUG_DEPTH = FATAL_DEPTH + 1
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
  private inventoryPanel!: InventoryPanel
  /** Le panneau de craft (à droite du sac) et la file (toujours à l'écran). */
  private craftPanel!: CraftPanel
  private craftQueueView!: CraftQueueView
  /** Les toasts « +2 BOIS (14) » — le butin s'inscrit à une place FIXE du HUD. */
  private pickups!: PickupToasts
  private journalPanel!: Phaser.GameObjects.Container
  private journalText!: Phaser.GameObjects.Text

  // ─── L'attente ───
  /** L'écran de chargement : seul à l'écran tant que la vallée n'est pas générée.
   *  Vit encore le temps du fondu, puis se détruit — d'où le `undefined`. */
  private loading: LoadingScreen | undefined
  /** L'écran de rupture (hôte perdu) — il ne s'efface jamais et propose de recharger. */
  private fatal!: FatalPanel
  /** Le HUD a-t-il été découvert ? Bascule une seule fois, au premier instant jouable. */
  private revealed = false

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
    // Le flash d'alarme. `setAlpha(0)` en plus du remplissage transparent : c'est
    // l'alpha de l'OBJET que l'alarme pilote (plus bas), et le laisser à 1 faisait
    // d'un rectangle plein écran un objet « peint » aux yeux de qui inspecte la scène
    // — alors qu'il ne peint rien. On dit ce qu'on fait : cet objet est éteint.
    this.alarmOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x8a1a10, 0)
      .setOrigin(0)
      .setAlpha(0)

    const style = {
      fontFamily: FONT,
      fontSize: '16px',
      color: '#e8e0c8',
      stroke: '#14141a',
      strokeThickness: 3,
    }
    // TOUT le HUD naît CACHÉ. Il ne paraîtra qu'au premier instant jouable (voir
    // `reveal`) : la vallée met quelques secondes à se générer, et des jauges vides
    // posées sur un écran noir ne racontent rien — elles ne font qu'annoncer un jeu
    // qui n'est pas encore là.
    this.hud = this.add.text(10, 8, '', style).setVisible(false)

    // Les vitales (bas-gauche) et la ceinture (bas-centre) — le HUD parle
    // désormais en cases et en jauges, plus en pavé de texte (spec inv R17-R18).
    this.vitals = createVitals(this)
    this.vitals.setVisible(false)
    this.hotbar = createHotbar(this)
    this.hotbar.setVisible(false)
    // L'écran d'inventaire (TAB) : la grille complète + le panneau de loot. Il ne
    // parle pas à l'hôte — il POSE ses actions, WorldScene les draine (spec R22).
    this.inventoryPanel = createInventoryPanel(this, (action) => queueAction(this.registry, action))
    // LE CRAFT : le panneau (à droite du sac, ouvert avec TAB) et la FILE (toujours
    // visible — le travail en cours est un état du personnage, pas un détail de menu).
    // À CÔTÉ de la grille d'inventaire, jamais dessus : on lit sa géométrie, on ne
    // la redevine pas (c'était le bug — le panneau tombait en plein milieu du sac).
    // En HAUTEUR, en revanche, il prend tout l'écran (moins ses marges) : la liste
    // des recettes n'a aucune raison d'être bornée par la taille du sac.
    const inv = inventoryGeometry(this)
    const TITRE = 26 // le mot ARTISANAT vit au-dessus du cadre
    this.craftPanel = createCraftPanel(this, (action) => queueAction(this.registry, action), {
      left: Math.min(inv.right + 40, this.scale.width - CRAFT_PANEL_W - CRAFT_PANEL_MARGIN_Y),
      top: CRAFT_PANEL_MARGIN_Y + TITRE,
      bottom: this.scale.height - CRAFT_PANEL_MARGIN_Y,
    })
    // LE CLAVIER DU CHAMP DE RECHERCHE. Tant qu'il tape, le jeu ne reçoit plus
    // rien (`uiTyping`) : sans ça, taper « hache » ferait marcher le personnage.
    this.input.keyboard?.on('keydown', (ev: KeyboardEvent) => {
      if (this.craftPanel.handleKey(ev.key)) ev.preventDefault()
      setHud(this.registry, 'uiTyping', this.craftPanel.isTyping())
    })
    this.craftQueueView = createCraftQueueView(
      this,
      (action) => queueAction(this.registry, action),
      20,
      120,
      BALANCE.CRAFT_QUEUE_MAX,
    )
    // Cachée jusqu'au premier instant jouable : rien du HUD ne doit s'afficher
    // par-dessus l'écran de chargement (même règle que la ceinture, ci-dessus).
    this.craftQueueView.setVisible(false)
    // Les toasts de récolte : ils s'empilent juste au-dessus des vitales.
    this.pickups = createPickupToasts(this)
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

    // Les erreurs de JEU (« trop tôt », « hors de portée ») : une bulle de 2,5 s, sous
    // l'écran de chargement — pendant l'attente, rien ne peut d'ailleurs en produire
    // (l'input est coupé, les snapshots ne tournent pas). Les erreurs qui TUENT la
    // partie, elles, ne passent pas par ici : voir l'écran de rupture, juste en dessous.
    this.errorText = this.add
      .text(this.scale.width / 2, this.scale.height - 110, '', { ...style, color: '#ff7a6b' })
      .setOrigin(0.5, 0)
      .setVisible(false) // un texte vide « visible » reste un objet du HUD à l'écran

    // L'écran de RUPTURE (hôte mort) : caché, et prêt. Il peut s'ouvrir à N'IMPORTE
    // quel moment — y compris pendant la génération, où il recouvre la barre.
    this.fatal = createFatalPanel(this, FATAL_DEPTH, () => window.location.reload())

    // L'écran de chargement — seul à l'écran jusqu'au premier instant jouable. Il porte
    // la barre (le compte réel des passes de l'hôte) et rien d'autre : la popup d'accueil
    // a été SUPPRIMÉE, touches comprises (voir ui/loading.ts). Il vit ICI et non dans
    // WorldScene, dont la caméra est zoomée — un objet à scrollFactor 0 n'y serait cadré
    // que par hasard.
    this.loading = createLoadingScreen(this, LOADING_DEPTH)

    // L'overlay de debug (F1) — DEV seulement, et hors de cette classe : voir
    // l'en-tête de debug-overlay.ts (une méthode survivrait au build de prod).
    if (import.meta.env.DEV) {
      this.debugText = createDebugOverlay(this, style, DEBUG_DEPTH)
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
    const style = { fontFamily: FONT, fontSize: '16px', color: '#e8e0c8', stroke: '#14141a', strokeThickness: 3 }
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

  /**
   * Le premier instant JOUABLE : la vallée est générée (`worldReady`) ET un premier
   * snapshot a donné ses valeurs (`time`). Alors seulement l'écran de chargement
   * tombe (en fondu) et le HUD paraît. Le joueur tombe directement dans le monde : plus
   * aucune popup ne s'ouvre par-dessus lui.
   */
  private reveal(): void {
    this.revealed = true
    // Le HUD paraît DERRIÈRE le voile encore opaque : il apparaîtra avec le monde,
    // dans le même fondu, au lieu de se poser dessus après coup.
    this.hud.setVisible(true)
    this.vitals.setVisible(true)
    this.loading?.fadeOut(this.time.now)
  }

  /** L'erreur de jeu : une bulle qui s'efface d'elle-même en 2,5 s. */
  private renderError(): void {
    const error = getHud(this.registry, 'error')
    if (error && this.time.now - error.at < 2500) {
      this.errorText
        .setText(error.reason)
        .setAlpha(1 - (this.time.now - error.at) / 2500)
        .setVisible(true)
    } else {
      this.errorText.setText('').setVisible(false)
    }
  }

  override update(): void {
    // LA RUPTURE D'ABORD. Elle peut tomber à n'importe quel instant — y compris avant
    // que le monde existe — et elle prime sur tout le reste : plus rien n'avancera.
    const fatal = getHud(this.registry, 'fatal')
    if (fatal) this.fatal.show(fatal.reason)

    this.renderError()

    const time = getHud(this.registry, 'time')
    if (!this.revealed) {
      if (!getHud(this.registry, 'worldReady') || !time) {
        // L'attente : la barre suit le compte de passes de l'hôte (et rien d'autre) ;
        // le texte, lui, raconte — voir ui/loading.ts.
        this.loading?.update(getHud(this.registry, 'loadProgress'), this.time.now)
        return
      }
      this.reveal()
    }
    if (!time) return

    // Le fondu du voile sur le monde. Il s'éteint tout seul ; on lâche la référence
    // quand il ne reste plus rien (l'écran s'est détruit).
    if (this.loading?.fadeStep(this.time.now)) this.loading = undefined

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

    // Le butin récolté : WorldScene POSE, on draine et on empile (fusion par item).
    for (const p of drainPickups(this.registry)) this.pickups.push(p.item, p.count, this.time.now)
    this.pickups.update(inv, this.time.now)

    // L'écran d'inventaire (TAB) : la grille complète, le glisser, le loot. Le
    // conteneur ouvert est déjà résolu par WorldScene (null s'il a disparu).
    const characterMenuOpen = Boolean(getHud(this.registry, 'characterMenuOpen'))
    // La ceinture du bas s'efface quand la grille est ouverte : sa rangée y est
    // déjà (spec Rust). Sinon la même ceinture s'affiche deux fois à l'écran.
    this.hotbar.setVisible(!characterMenuOpen)
    this.inventoryPanel.setVisible(characterMenuOpen)
    this.craftPanel.setVisible(characterMenuOpen)
    if (!characterMenuOpen) setHud(this.registry, 'uiTyping', false)
    if (characterMenuOpen) {
      this.inventoryPanel.update(inv, activeSlot, getHud(this.registry, 'openContainerView') ?? null)
      this.craftPanel.update(inv, getHud(this.registry, 'stationsInRange') ?? [])
      setHud(this.registry, 'uiTyping', this.craftPanel.isTyping())
    }
    // La file, elle, se voit TOUJOURS : une file bouchée (sac plein) ou en pause
    // (station quittée) doit se remarquer sans aller ouvrir un menu (spec F15).
    this.craftQueueView.setVisible(true)
    this.craftQueueView.update(getHud(this.registry, 'craftQueue') ?? [])
    this.vitals.update({
      hp: getHud(this.registry, 'hp') ?? 100,
      stamina: getHud(this.registry, 'stamina') ?? 100,
      hunger: getHud(this.registry, 'hunger') ?? 100,
      temperature: getHud(this.registry, 'temperature') ?? 100,
      wounds: getHud(this.registry, 'wounds') ?? {},
      skills: getHud(this.registry, 'skills') ?? {},
      characterMenuOpen, // sac ouvert → les vitales redeviennent opaques
    })

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
