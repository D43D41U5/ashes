/**
 * Scène UI en surimpression — pattern Manif : la caméra de jeu zoome et
 * suit l'avatar, l'UI vit dans une scène parallèle à caméra neutre (un
 * objet scrollFactor 0 dans une caméra zoomée serait projeté hors écran).
 * Communication par le registry : WorldScene écrit, UIScene lit.
 */
import { formatChronicleLine, modificateurDeSaison, NOMS_MODIFICATEUR, TEMPERATURE, zoneAt, type VillageTask, type WorldMap } from '@ashes/sim'
import Phaser from 'phaser'
import { getHud, setHud } from '../hud-state'
import { drainAlertes, drainConseils, drainCrafts, drainDecouvertes, drainLevelUps, drainPickups, queueAction } from './world/hud-bridge'
import { TILE_PX } from '../render/framing'
import { createHudCore, type HudCore } from './ui/hud-core'
import { createBarreHaute, type BarreHaute } from './ui/barre-haute'
import { createFatalPanel, type FatalPanel } from './ui/fatal'
import { createHudCharacter, type HudCharacter } from './ui/hud-character'
import { createBuildMenu, type BuildMenu } from './ui/build-menu'
import { createCraftQueueView, type CraftQueueView } from './ui/craft-queue'
import { createFirePanel, type FirePanel } from './ui/fire-panel'
import { createRefugeePrompt, type RefugeePrompt } from './ui/refugee-prompt'
import { createBandeaux, type Bandeaux } from './ui/bandeaux'
import { createDeathVeil, DEATH_VEIL_FILET_MS, type DeathVeil } from './ui/death-veil'
import { createSeasonVeil, type SeasonVeil } from './ui/season-veil'
import { createFicheLieu, type FicheLieu } from './ui/fiche-lieu'
import { createPauseMenu, type PauseMenu } from './ui/pause-menu'
import { mountHud, type HudDom } from './ui/hud-dom'
import { mountVignette, type Vignette } from './ui/vignette'
import { partDecouverte } from '../render/fog'
import { createLoadingScreen, type LoadingScreen } from './ui/loading'
import { createChatPanel, type ChatPanel } from './ui/chat-panel'
import { createDebugOverlay, renderDebugOverlay, requestTeleport } from './world/debug-overlay'
import { FONT } from './ui/typography'
import { reopenFreshVeillee } from './ui/reopen-veillee'
import { VEILLEE_SEED } from '../worker/mondes'

/**
 * LE VOCABULAIRE DU TABLEAU DES TÂCHES — plus affiché depuis que le village a quitté le coin
 * haut-gauche (2026-08-24), et EXPORTÉ pour cela : la barre du village qui vient le reprendra
 * tel quel. Neuf libellés réécrits de mémoire auraient dit autre chose que ceux d'hier.
 */
export const TASK_LABELS: Record<VillageTask['kind'], string> = {
  gather_berries: 'récolter des baies',
  gather_wood: 'couper du bois',
  gather_fiber: 'ramasser des fibres',
  gather_stone: 'extraire de la pierre',
  gather_cut_stone: 'tailler à la carrière',
  // LE GLANAGE (spec `glanage.md` G9) — et la nuance avec la corvée d'à côté est le sujet même
  // du chantier : on RAMASSE ce qui traîne tant qu'on n'a pas l'outil pour EXTRAIRE. D'où le
  // verbe de `gather_stone`, passé de « ramasser » à « extraire » : les deux libellés se
  // seraient contredits sur le tableau, et c'est justement l'écart qu'il faut lire.
  glaner_bois: 'glaner du bois mort',
  glaner_pierre: 'glaner des pierres',
  cook_stew: 'cuisiner',
  repair: 'réparer',
  feed_fire: 'nourrir le Feu',
  build: 'bâtir',
}

/** Carte plein écran : bornes et pas du zoom (1 = carte ajustée, 8 = gros plan). */
const MAP_ZOOM_MIN = 1
const MAP_ZOOM_MAX = 8
const MAP_ZOOM_STEP = 1.15
/**
 * LA BOÎTE DE LA CARTE, en unités Phaser (plan 1280×720) — l'onglet CARTE n'est pas le plein
 * écran : le chrome DOM de l'écran personnage l'encadre, et la carte ne doit ni passer sous la
 * barre d'onglets ni toucher la CEINTURE. Les deux plans sont en FIT 16:9 (DOM 1920×1080,
 * Phaser 1280×720) : un pixel DOM = 1/1,5 pixel Phaser, donc ces bornes tiennent à tout écran.
 *   · haut  60 → sous la barre d'onglets (DOM 22..52) et la ligne ARPENTÉ.
 *   · bas  626 → la ceinture commence à 650,7 (DOM bottom 26 + 78 de haut) : 24 px de marge.
 */
const MAP_BOX_TOP = 60
const MAP_BOX_BOTTOM = 626
/** Largeur : on garde une marge sur les côtés (rien n'y empiète, mais la carte respire). */
const MAP_BOX_WIDTH_FRAC = 0.9
/** Au-dessus de tout le HUD (et du journal, à profondeur par défaut). */
const MAP_OVERLAY_DEPTH = 1000
/** L'écran de chargement couvre TOUT (carte comprise) — il est seul au monde. */
const LOADING_DEPTH = MAP_OVERLAY_DEPTH + 1
/** L'écran de RUPTURE passe même devant le chargement : l'hôte peut mourir en pleine
 *  génération, et il ne faut surtout pas laisser tourner une barre qui ne montera plus. */
const FATAL_DEPTH = LOADING_DEPTH + 2
/** L'overlay de debug (P, DEV) reste au-dessus de tout. */
const DEBUG_DEPTH = FATAL_DEPTH + 1
/** Pastille de POI sur la carte : plus petite et plus froide que le marqueur joueur, qui doit primer. */
/** La texture du calque de brouillard : une cellule = un pixel, étirée en NEAREST. */
const MAP_FOG_TEX = 'map-fog'
const MAP_POI_RADIUS = 3
const MAP_POI_FILL = 0xe8e0c8
const MAP_POI_STROKE = 0x14141a
/** La pastille d'un lieu QU'ON NE CONNAÎT PAS, montrée seulement par le mode debug (P). Elle
 *  ne peut pas porter la teinte des vraies : sinon on ne saurait plus, en jouant, ce que
 *  l'avatar a réellement trouvé. Sourde et froide — un repère d'outil, pas un savoir. */
const MAP_POI_FILL_DEBUG = 0x4a4a52
/** Sous ce déplacement (px), un appui-relâché sur la carte est un CLIC, pas un pan. */
const MAP_CLICK_SLOP_PX = 5
/** Le rayon de CLIC d'une pastille, en pixels d'écran. La pastille est dessinée à
 *  `MAP_POI_RADIUS` (3 px, taille constante) : viser trois pixels à la souris est un jeu
 *  d'adresse, pas une lecture. 12 px = la moitié de la cible de 24 px que recommande WCAG. */
const MAP_POI_HIT_PX = 12

export class UIScene extends Phaser.Scene {
  private alarmOverlay!: Phaser.GameObjects.Rectangle
  /** LES DEUX BANDEAUX, en DOM et en FILE, au-dessus des panneaux (P0.2). */
  private bandeaux!: Bandeaux
  /** LE TRAQUEUR DE DÉPOUILLE (mort-suite 2) : la flèche de bord vers le sac tombé + son
   *  compte à rebours, rendus dans le HUD NON zoomé (calcul dans WorldScene). */
  private corpseArrow!: Phaser.GameObjects.Image
  private corpseLabel!: Phaser.GameObjects.Text
  /** L'écran PERSONNAGE (maquette 3A) : sac + artisanat, ouvert au TAB. */
  private hudCharacter!: HudCharacter
  /** La file de craft (toujours à l'écran). */
  /** Le MENU DU MARTEAU (spec construction R20) — pièces structurelles, séparé du craft. */
  private buildMenu!: BuildMenu
  private craftQueueView!: CraftQueueView
  /** LE MODAL DU FEU (spec feu-station S17-S19) — ouvert à E, il remplace les deux fenêtres flottantes. */
  private firePanel!: FirePanel
  private refugeePrompt!: RefugeePrompt
  private deathVeil!: DeathVeil
  private seasonVeil!: SeasonVeil
  /** LE TIROIR DU REGISTRE (T5) — ouvert en cliquant une pastille CONNUE de la carte. */
  private ficheLieu!: FicheLieu
  /** La stèle de fin de saison n'est levée qu'UNE fois (la saison ne finit qu'une fois). */
  private seasonVeilShown = false
  private pauseMenu!: PauseMenu
  /** Le dernier `at` de mort déjà montré — un nouveau lève le voile une seule fois. */
  private lastDeathAt = -1
  /** Combien de fois on est tombé cette session — l'invite « retournez-y » n'apparaît
   *  qu'à la première (après, on a compris). */
  private deaths = 0
  /** Le compte à rebours qui fait retomber le voile — un timer PHASER (`this.time`,
   *  piloté par la boucle de jeu, pausable), pas un `window.setTimeout` peu fiable ici. */
  private deathHideTimer?: Phaser.Time.TimerEvent
  private chatPanel!: ChatPanel
  private journalPanel!: Phaser.GameObjects.Container
  private journalText!: Phaser.GameObjects.Text

  /** La racine DOM du HUD (voiles rendus ISO à la maquette 2A–5A, par-dessus le canvas).
   *  Les sections DOM (bande 2A, fenêtre « fonder », …) y accrochent leur planche. */
  private hudRoot!: HudDom
  /** Le cadrage du monde (bords assombris vers l'encre) — DOM, sous le HUD. */
  private vignette!: Vignette
  /** La bande toujours à l'écran (maquette 2A) : jour/lieu, toasts, vitales, ceinture. */
  private hudCore!: HudCore
  private barreHaute!: BarreHaute

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
  /** Le calque de brouillard posé sur la carte (spec R19) — absent tant que la carte n'est pas montée. */
  private mapFog?: Phaser.GameObjects.Image
  /** La version de brouillard DÉJÀ peinte : on ne repeint que si la marche a découvert du neuf. */
  private mapFogVersion = -1
  /** La texture CANVAS du brouillard — c'est ce type-là (et pas `Texture`) qui sait se rafraîchir. */
  private mapFogTex?: Phaser.Textures.CanvasTexture
  /** L'état de « tout voir » DÉJÀ appliqué — basculer P doit repeindre, or `mapFogVersion`
   *  ne bouge pas quand on arme le mode debug (la marche n'a rien découvert). */
  private mapToutVu = false
  private mapMarker!: Phaser.GameObjects.Arc
  /** Une pastille par POI (zone avec un `kind`), AVEC son poiId — l'index dans `map.zones`,
   *  qui est l'identité d'un lieu (spec lieux R4). Le filtre `knownPois` en dépend. */
  private mapPoiDots: { poiId: number; dot: Phaser.GameObjects.Arc }[] = []
  /** Dernière échelle appliquée aux pastilles — évite de les reparcourir à chaque frame. */
  private mapPoiScale = 0
  private mapHover!: Phaser.GameObjects.Text
  /** Échelle « carte entière ajustée à sa BOÎTE » — l'ancre du zoom (facteur ×). */
  private mapFit = 1
  private mapZoom = 1
  /** Le centre de la boîte (voir MAP_BOX_TOP/BOTTOM) : la carte n'est PAS centrée sur l'écran,
   *  elle est centrée entre la barre d'onglets et la ceinture. */
  private mapCenterY = 0
  /** Dimensions de la texture carte (px monde) — pour borner le pan. */
  private mapTexW = 0
  private mapTexH = 0
  private mapDragging = false
  private mapDragStart = { px: 0, py: 0, lx: 0, ly: 0 }
  private mapWasOpen = false
  /** Aide de la carte — sa dernière ligne change quand le mode debug est armé. */
  private mapHint?: Phaser.GameObjects.Text
  /** « ARPENTÉ : x % » — la part de vallée découverte (spec R19). */
  private mapArpente?: Phaser.GameObjects.Text

  /** Overlay du mode debug (DEV, P) — au-dessus de tout, carte comprise. */
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
    // LA RACINE DOM DU HUD — les sections rendues ISO à la maquette (2A–5A) y vivent,
    // par-dessus le canvas du monde (voir ui/hud-dom.ts). Montée tôt : les sections
    // s'y accrochent dessous.
    this.hudRoot = mountHud()
    // LA VIGNETTE cadre le MONDE : montée sous le HUD (z-index 5), elle assombrit les bords
    // vers l'encre pour que l'image ait un centre. Statique et sans couleur ajoutée.
    this.vignette = mountVignette()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.hudRoot.destroy()
      this.vignette?.destroy() // elle vit à la racine (hors planche) : à retirer à la main
      this.deathVeil?.destroy() // il vit à la racine (hors planche) : à retirer à la main
      this.bandeaux?.destroy() // idem — il monte sur `document.body`, pas sur la scène
      this.seasonVeil?.destroy() // idem : monté sur document.body
      this.pauseMenu?.destroy() // idem
      this.ficheLieu?.destroy() // idem — le tiroir du registre monte sur document.body
    })

    // LA BANDE DU HUD (maquette 2A), en DOM : jour/lieu (haut-gauche), toasts (haut-
    // droite), médaillons de vitale + ligne poids/blessures/métiers (bas-gauche),
    // ceinture façon Rust (bas-centre). Née cachée jusqu'au premier instant jouable.
    this.hudCore = createHudCore(this.hudRoot.board, this.game, (slot) =>
      queueAction(this.registry, { type: 'set_active_slot', slot }),
    )
    this.hudCore.setVisible(false)
    // LA BARRE HAUTE (2026-08-24) : où je suis · le ruban de l'année · le ciel et l'heure.
    // Elle a pris la place de la ligne « JOUR 51 — ACTE II — 14H » du coin haut-gauche.
    this.barreHaute = createBarreHaute(this.hudRoot.board)
    this.barreHaute.setVisible(false)
    // L'ÉCRAN PERSONNAGE (maquette 3A), en DOM : le SAC (grille + ceinture rappelée,
    // glisser-déposer + clic droit) et l'ARTISANAT (recherche, recettes, un clic FAIT),
    // ouverts au TAB. Il ne parle pas à l'hôte — il POSE ses actions, WorldScene les
    // draine (spec R22). La recherche est un vrai <input> : focalisé, il pose `uiTyping`
    // (le déplacement se coupe), sans quoi taper « hache » ferait marcher le personnage.
    this.hudCharacter = createHudCharacter(this.hudRoot.board, this.game, {
      queue: (action) => queueAction(this.registry, action),
      setTyping: (v) => setHud(this.registry, 'uiTyping', v),
      // L'onglet vit dans le REGISTRE : le clavier (TAB, M) et les en-têtes écrivent au même
      // endroit, et `mapOpen` s'en déduit plus bas — la carte ne peut pas diverger de son onglet.
      setTab: (t) => setHud(this.registry, 'characterTab', t),
    })
    // LE MENU DU MARTEAU (spec construction R20) : à gauche, dans le monde (hors
    // TAB) — il ne paraît que le marteau EN MAIN, et se referme quand on le range.
    this.buildMenu = createBuildMenu(this.hudRoot.board)
    this.buildMenu.setVisible(false)
    this.craftQueueView = createCraftQueueView(this.hudRoot.board, this.game, (action) => queueAction(this.registry, action))
    // Cachée jusqu'au premier instant jouable : rien du HUD ne doit s'afficher
    // par-dessus l'écran de chargement (même règle que la ceinture, ci-dessus).
    this.craftQueueView.setVisible(false)
    this.refugeePrompt = createRefugeePrompt(this.hudRoot.board, (action) => queueAction(this.registry, action))
    // LE MODAL DU FEU (spec feu-station S17-S19) : ouvert à E (viser un feu + E), il REMPLACE
    // les deux fenêtres flottantes « Fonder un village » / « Monter le Feu » — leurs boutons
    // vivent désormais dedans. Il POSE ses actions ; WorldScene les draine (spec R22).
    this.firePanel = createFirePanel(this.hudRoot.board, this.game, {
      queue: (action) => queueAction(this.registry, action),
    })
    // Le voile de mort (P1) : monté à la racine (vrai plein écran, hors planche
    // scalée), il ne fait que se lever quand le joueur tombe. WorldScene pose
    // `deathMoment` (one-shot horodaté).
    this.bandeaux = createBandeaux()
    this.deathVeil = createDeathVeil()
    // La stèle de fin de saison (finition GATE 1) : SŒUR du voile de mort, terminale.
    // WorldScene pose `seasonVerdicts` au jour 61 (sa non-nullité = fin de saison) ; on la lève une fois.
    // ROUVRIR LA VALLÉE : la case et la seed du monde en cours (posées au `ready` par
    // WorldScene) — lues AU CLIC, pas à la construction : la stèle se monte avant le `ready`.
    this.seasonVeil = createSeasonVeil(() => {
      const v = getHud(this.registry, 'veillee')
      reopenFreshVeillee(v?.slot ?? 0, v?.seed ?? VEILLEE_SEED)
    })
    // Le menu PAUSE (ESC) : REPRENDRE referme (menuOpen=false → WorldScene reprend l'hôte) ; le
    // curseur de son passe par le registre (`audioVolume`), que WorldScene applique au moteur.
    // LE TIROIR DU REGISTRE (T5) : `registreDuLieu`/`ficheDuLieu` vivaient dans /sim, purs et
    // testés, SANS un seul appelant côté client. Voici leur lecteur — ouvert d'un clic sur une
    // pastille CONNUE de la carte, refermé par sa croix ou en refermant l'onglet.
    this.ficheLieu = createFicheLieu({ onFermer: () => this.ficheLieu.fermer() })
    this.pauseMenu = createPauseMenu({
      onResume: () => setHud(this.registry, 'menuOpen', false),
      getVolume: () => Number(getHud(this.registry, 'audioVolume') ?? 1),
      onVolume: (v) => setHud(this.registry, 'audioVolume', v),
      // QUITTER : on ne navigue PAS d'ici. WorldScene tient l'hôte, donc la sauvegarde : il
      // fait écrire la partie et ne recharge qu'une fois le disque acquitté.
      onQuit: () => setHud(this.registry, 'quitMondes', true),
    })
    this.chatPanel = createChatPanel(this)
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

    // L'ALERTE ET LE CONSEIL NE SONT PLUS ICI. Ils étaient deux objets Phaser posés sur le
    // canvas — l'un en bas (le refus crie), l'autre en haut (le conseil enseigne). Deux
    // places, deux tons : cette grammaire-là est bonne, et le module DOM la garde. Ce qui
    // ne l'était pas : peints sur le canvas, ils passaient SOUS les écrans DOM opaques d'où
    // partent justement les gestes qui se font refuser. Voir `ui/bandeaux` (P0.2).

    // LA FLÈCHE DE DÉPOUILLE (mort-suite 2) : posée par `renderCorpseHint` en coords écran.
    this.corpseArrow = this.add.image(0, 0, 'fx-arrow').setOrigin(0.5, 0.5).setScale(1.7).setVisible(false)
    this.corpseLabel = this.add
      .text(0, 0, '', { ...style, fontSize: '13px', color: '#e8c66a' })
      .setOrigin(0.5, 0.5)
      .setVisible(false)

    // L'écran de RUPTURE (hôte mort) : caché, et prêt. Il peut s'ouvrir à N'IMPORTE
    // quel moment — y compris pendant la génération, où il recouvre la barre.
    this.fatal = createFatalPanel(this, FATAL_DEPTH, () => window.location.reload())

    // L'écran de chargement — seul à l'écran jusqu'au premier instant jouable. Il porte
    // la barre (le compte réel des passes de l'hôte) et rien d'autre : la popup d'accueil
    // a été SUPPRIMÉE, touches comprises (voir ui/loading.ts). Il vit ICI et non dans
    // WorldScene, dont la caméra est zoomée — un objet à scrollFactor 0 n'y serait cadré
    // que par hasard.
    this.loading = createLoadingScreen()
    // Le voile de chargement vit hors de Phaser (DOM) : si la scène tombe avant la fin
    // du fondu, on le retire à la main plutôt que de le laisser collé à l'écran.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.loading?.destroy()
      this.loading = undefined
    })

    // L'overlay de debug (P) — DEV seulement, et hors de cette classe : voir
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
      // Le seuil distingue le clic du relâchement d'un pan — sans lui, tout déplacement
      // de carte finirait par une action surprise.
      const dragged = Math.abs(pointer.x - this.mapDragStart.px) + Math.abs(pointer.y - this.mapDragStart.py)
      const clic = this.mapVisible() && dragged <= MAP_CLICK_SLOP_PX
      // LE REGISTRE D'UN LIEU : un clic sur une pastille CONNUE ouvre sa fiche ; le même clic
      // dans le vide la referme. Il passe AVANT le TP de debug, et c'est ce qui les départage :
      // en DEV la téléportation REFERME l'onglet carte (« on veut voir où l'on atterrit »,
      // debug-overlay) — les deux sur le même clic, le tiroir s'ouvrait puis tombait dans la
      // frame suivante. VU en smoke, pas déduit. Une pastille visée est un LIEU qu'on veut
      // lire, pas une tuile où l'on veut sauter.
      const lu = clic && pointer.leftButtonReleased() ? this.ouvrirLaFiche(pointer) : false
      // DEV, mode debug armé (P) : le clic téléporte l'avatar sur la tuile visée.
      if (import.meta.env.DEV && clic && !lu && getHud(this.registry, 'debugOn')) {
        const tile = this.mapTileAt(pointer)
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

  /**
   * Monte l'overlay carte au premier affichage (texture `map-demo` prête).
   *
   * C'EST LE CONTENU DE L'ONGLET CARTE. Le panneau DOM de l'écran personnage s'efface
   * là-dessus (fond transparent, pointeur traversant) et ne garde par-dessus que sa barre
   * d'onglets et sa ceinture : d'où le FOND OPAQUE couleur des autres onglets (#14100c —
   * un onglet ne laisse pas voir le monde derrière lui) et l'absence de titre, l'onglet
   * CARTE nommant déjà l'écran.
   */
  private ensureMapOverlay(map: WorldMap): void {
    if (this.mapRoot) return
    const W = this.scale.width
    const H = this.scale.height
    const style = { fontFamily: FONT, fontSize: '16px', color: '#e8e0c8', stroke: '#14141a', strokeThickness: 3 }
    const bg = this.add.rectangle(0, 0, W, H, 0x14100c, 1).setOrigin(0)
    // L'aide : à DROITE de la ceinture (qui tient le bas-centre), sur sa ligne. Centrée, elle
    // tomberait dessus — la ceinture est du DOM, elle passe TOUJOURS devant.
    const hint = this.add
      .text(W - 28, H - 52, 'molette : zoom · glisser : déplacer · M : fermer', { ...style, fontSize: '13px', color: '#b8b0a0' })
      .setOrigin(1, 0)
    this.mapHint = hint
    // CE QUI EST ARPENTÉ (spec R19). Sans ce chiffre, la première ouverture de la carte est un
    // rectangle noir avec un point : ça se lit comme une PANNE, pas comme un mystère. Nommer la
    // part parcourue retourne le vide en JAUGE — le noir cesse d'être une absence, il devient
    // ce qui reste à prendre. C'est la ligne qui transforme le brouillard en moteur.
    this.mapArpente = this.add
      .text(W / 2, 22, '', { ...style, fontSize: '13px', color: '#9a8f78' })
      .setOrigin(0.5, 0)
    // Le lieu sous le curseur — en haut à gauche, SOUS la barre d'onglets DOM (top 22 px sur
    // la planche 1920×1080, soit ~35 px ici : les deux plans sont en FIT 16:9, rapport 1,5).
    this.mapHover = this.add.text(28, 46, '', { ...style, fontSize: '16px', color: '#e8c66a' }).setOrigin(0, 0)

    const texW = map.width * TILE_PX
    const texH = map.height * TILE_PX
    // `map-demo` est bakée à 1 px/tuile (grande carte) → on l'étire à la taille monde
    // (texW×texH) pour que le fit et le mapping curseur→tuile ci-dessous restent justes.
    this.mapImage = this.add.image(0, 0, 'map-demo').setOrigin(0.5).setDisplaySize(texW, texH)
    this.mapTexW = texW
    this.mapTexH = texH
    // Ajuste la carte entière dans sa BOÎTE : entre la barre d'onglets et la ceinture, avec
    // la marge qui la décolle des deux. Elle se centre sur la boîte, pas sur l'écran.
    this.mapCenterY = (MAP_BOX_TOP + MAP_BOX_BOTTOM) / 2
    this.mapFit = Math.min((W * MAP_BOX_WIDTH_FRAC) / texW, (MAP_BOX_BOTTOM - MAP_BOX_TOP) / texH)
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

    // LE BROUILLARD (spec R19) : un calque posé SUR le terrain et SOUS les pastilles — ce
    // qu'on n'a pas arpenté est de l'encre. Une texture d'UNE cellule par pixel, étirée à la
    // taille de la carte : le grossissement en NEAREST donne des carrés francs, la grammaire
    // du jeu, et coûte 40 000 pixels au lieu de 2,5 millions.
    const fog = getHud(this.registry, 'fog') ?? null
    if (fog) {
      if (this.textures.exists(MAP_FOG_TEX)) this.textures.remove(MAP_FOG_TEX)
      const tex = this.textures.createCanvas(MAP_FOG_TEX, fog.cols, fog.rows)
      if (tex) {
        tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
        this.mapFogTex = tex
      }
      this.mapFog = this.add.image(0, 0, MAP_FOG_TEX).setOrigin(0.5).setDisplaySize(texW, texH)
      this.mapFogVersion = -1 // force la première peinture
    }

    // Le marqueur joueur passe APRÈS les pastilles : il doit rester lisible par-dessus.
    this.mapLayer = this.add.container(W / 2, this.mapCenterY, [
      this.mapImage,
      ...(this.mapFog ? [this.mapFog] : []),
      ...this.mapPoiDots.map((p) => p.dot),
      this.mapMarker,
    ])
    // LA CARTE EST BORNÉE À SA BOÎTE. Sans bornage, la marge n'existe qu'au zoom d'ouverture :
    // dès qu'on grossit, la carte déborde et repasse sous la ceinture et la barre d'onglets.
    // On borne par un CACHE (quatre bandes du fond, peintes PAR-DESSUS la carte) et non par un
    // masque géométrique : MESURÉ au pixel (snapshot du renderer), un `setMask` sur un enfant
    // de conteneur ne coupe rien ici — la carte bavait encore sous la boîte. Le fond étant
    // opaque, le cache rend exactement ce qu'un masque rendrait, et ne dépend de rien.
    const boxX = (W * (1 - MAP_BOX_WIDTH_FRAC)) / 2
    const band = (x: number, y: number, w: number, h: number): Phaser.GameObjects.Rectangle =>
      this.add.rectangle(x, y, w, h, 0x14100c, 1).setOrigin(0)
    const bands = [
      band(0, 0, W, MAP_BOX_TOP),
      band(0, MAP_BOX_BOTTOM, W, H - MAP_BOX_BOTTOM),
      band(0, MAP_BOX_TOP, boxX, MAP_BOX_BOTTOM - MAP_BOX_TOP),
      band(W - boxX, MAP_BOX_TOP, boxX, MAP_BOX_BOTTOM - MAP_BOX_TOP),
    ]

    this.mapRoot = this.add
      .container(0, 0, [bg, this.mapLayer, ...bands, hint, this.mapArpente, this.mapHover])
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
   * Borne le pan sur la taille SCALÉE de la carte : plus petite que sa BOÎTE (dans
   * une dimension) → verrouillée au centre de la boîte (pas de pan parasite quand la
   * carte y tient déjà, et la marge sous la ceinture ne se fait pas manger) ; plus
   * grande → pan autorisé, mais l'image couvre toujours la boîte, donc les bords
   * peuvent l'atteindre sans jamais laisser de vide au-delà.
   */
  private clampMapPan(): void {
    const scale = this.mapFit * this.mapZoom
    const W = this.scale.width
    const halfW = (this.mapTexW * scale) / 2
    const halfH = (this.mapTexH * scale) / 2
    const boxH = MAP_BOX_BOTTOM - MAP_BOX_TOP
    this.mapLayer.x = 2 * halfW <= W ? W / 2 : Phaser.Math.Clamp(this.mapLayer.x, W - halfW, halfW)
    this.mapLayer.y =
      2 * halfH <= boxH
        ? this.mapCenterY
        : Phaser.Math.Clamp(this.mapLayer.y, MAP_BOX_BOTTOM - halfH, MAP_BOX_TOP + halfH)
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
    // Hors de la boîte, la carte est MASQUÉE : le curseur y survolerait un pays qu'on ne voit
    // pas — le nom se tairait mal de sortir d'un endroit vide.
    if (pointer.y < MAP_BOX_TOP || pointer.y > MAP_BOX_BOTTOM) {
      this.mapHover.setText('')
      return
    }
    const at = this.mapTileAt(pointer)
    const zone = at ? zoneAt(map, at.tx, at.ty) : undefined
    const poiId = zone ? map.zones.indexOf(zone) : -1
    // La levée debug nomme TOUT : identifier la zone qu'on est en train de juger est la moitié
    // du travail (« ce pierrier trop droit, c'est lequel ? »).
    const hidden =
      !this.mapToutVu && zone?.kind !== undefined && !(getHud(this.registry, 'knownPois') ?? []).includes(poiId)
    this.mapHover.setText(zone && !hidden ? zone.name : '')
  }

  /** Réinitialise la vue à l'ouverture : carte entière, centrée SUR SA BOÎTE, zoom 1. */
  private resetMapView(): void {
    this.mapZoom = 1
    this.mapLayer.setScale(this.mapFit)
    this.mapLayer.setPosition(this.scale.width / 2, this.mapCenterY)
  }

  /** Tuile → coordonnée locale du `mapLayer` (pixels-monde, origine au centre de la carte). */
  private mapLocalX(map: WorldMap, tx: number): number {
    return tx * TILE_PX - (map.width * TILE_PX) / 2
  }

  private mapLocalY(map: WorldMap, ty: number): number {
    return ty * TILE_PX - (map.height * TILE_PX) / 2
  }

  /**
   * LE MODE DEBUG OUVRE LA CARTE EN ENTIER (demande d'Alexis, 2026-08-26).
   *
   * Raison d'être : le brouillard (R19) est une règle de JEU, et elle empêche de faire le
   * travail d'AUTEUR — juger la silhouette d'un biome, la forme d'une vallée, le semis des
   * lieux — qui demande de voir la carte d'un coup d'œil, pas de l'arpenter une heure. P
   * suffit donc à la lever : pas de nouvel interrupteur, « lorsqu'on est en mode debug ».
   *
   * ⚠ LA LEVÉE EST UN AFFICHAGE, JAMAIS UNE ÉCRITURE. On cache le CALQUE ; on ne touche pas
   * à `fog.vu`. Un `revele()` plein écran serait empaqueté dans la sauvegarde au prochain
   * `saveFog` (WorldScene) et brûlerait le brouillard de cette case POUR DE BON — on aurait
   * détruit la partie du joueur pour regarder une carte.
   *
   * Doublement mort en production : `import.meta.env.DEV` est statiquement faux, Rollup
   * élimine la branche, et `debugOn` n'y est de toute façon jamais armé (P n'est pas câblé).
   */
  private carteToutVoir(): boolean {
    return import.meta.env.DEV && Boolean(getHud(this.registry, 'debugOn'))
  }

  /** Applique (ou retire) la levée debug. Ne fait rien tant que l'état ne CHANGE pas : la
   *  carte reste peinte une fois pour toutes, comme le reste de l'overlay. */
  private syncCarteToutVoir(): void {
    const tout = this.carteToutVoir()
    if (tout === this.mapToutVu) return
    this.mapToutVu = tout
    this.mapFog?.setVisible(!tout)
    // Le compte « ARPENTÉ » et les pastilles se relisent : `mapFogVersion` ne bouge pas tout
    // seul ici (rien n'a été découvert), et sans ce forçage le libellé mentirait jusqu'au
    // prochain pas. Un repeint coûte 40 000 pixels, une fois par bascule.
    this.mapFogVersion = -1
    this.mapPoiScale = 0
  }

  /**
   * REPEINT LE BROUILLARD (spec R19) — et seulement si la marche a découvert du neuf.
   *
   * Une cellule non vue est de l'ENCRE OPAQUE : on ne devine rien de la forme du pays derrière.
   * Une cellule vue est transparente : le terrain déjà baké transparaît tel quel. Il n'y a
   * volontairement pas de troisième état (« vu mais pas en vue ») : la carte dit ce qu'on a
   * arpenté, pas ce qu'on surveille — ce serait une autre promesse, et une autre spec.
   */
  private refreshMapFog(): void {
    const fog = getHud(this.registry, 'fog')
    const version = getHud(this.registry, 'fogVersion') ?? 0
    if (!fog || !this.mapFog || version === this.mapFogVersion) return
    this.mapFogVersion = version
    const tex = this.mapFogTex
    if (!tex) return
    // Levée debug : le calque est caché (`syncCarteToutVoir`), donc on ne peint pas 40 000
    // pixels qu'on ne montre pas. La bascule remet `mapFogVersion` à -1, donc le retour au
    // jeu repeint un brouillard à jour — l'économie ne peut pas laisser une texture périmée.
    if (!this.mapToutVu) {
      const src = tex.getSourceImage() as HTMLCanvasElement
      const ctx = src.getContext('2d')
      if (!ctx) return
      const img = ctx.createImageData(fog.cols, fog.rows)
      for (let i = 0; i < fog.vu.length; i++) {
        const k = i * 4
        // L'encre de la palette (#14141a) : le brouillard est la MÊME matière que les cadres
        // et les contours du jeu, pas un gris neutre venu d'ailleurs.
        img.data[k] = 0x14
        img.data[k + 1] = 0x14
        img.data[k + 2] = 0x1a
        img.data[k + 3] = fog.vu[i] ? 0 : 255
      }
      ctx.putImageData(img, 0, 0)
      tex.refresh()
    }

    // Et on le DIT. Au premier jour, « ARPENTÉ : 0 % » explique le noir au lieu de le subir ;
    // plus tard, le chiffre qui monte est une raison de sortir à lui tout seul.
    //
    // Sous la levée debug, le chiffre RESTE VRAI (on n'a rien arpenté de plus) mais il serait
    // lu comme une panne devant une carte entière : la mention dit d'où vient ce qu'on voit.
    if (this.mapArpente) {
      const pct = partDecouverte(fog) * 100
      const arpente = `ARPENTÉ : ${pct < 1 && pct > 0 ? '< 1' : Math.round(pct)} %`
      this.mapArpente.setText(
        this.mapToutVu
          ? `${arpente}  ·  DEBUG : carte entière (le brouillard est intact)`
          : arpente + (pct < 1 ? '  ·  la carte se dessine à mesure que vous marchez' : ''),
      )
    }
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
    //
    // SAUF sous la levée debug, qui montre AUSSI les autres — mais en teinte sourde
    // (`MAP_POI_FILL_DEBUG`) : le semis des lieux fait partie de la forme de la vallée, et on
    // doit pouvoir le juger d'un coup d'œil ; en revanche on ne doit jamais confondre, dans la
    // même image, ce que l'avatar a trouvé et ce que l'outil dévoile. Elles restent NON
    // CLIQUABLES (voir `ouvrirLaFiche`) : un repère, pas une porte — et c'est aussi ce qui
    // laisse le clic de TP libre sur la quasi-totalité de la carte.
    const known = getHud(this.registry, 'knownPois') ?? []
    const tout = this.mapToutVu
    for (const { poiId, dot } of this.mapPoiDots) {
      const su = known.includes(poiId)
      dot.setVisible(su || tout)
      dot.setFillStyle(su ? MAP_POI_FILL : MAP_POI_FILL_DEBUG)
    }
  }

  /**
   * OUVRE LA FICHE DU LIEU VISÉ — ou referme le tiroir si le clic est tombé dans le vide.
   *
   * On vise la PASTILLE À L'ÉCRAN, pas l'empreinte du lieu : une empreinte de POI fait
   * quelques tuiles, soit quelques pixels au zoom d'ouverture — invisable. L'étalon d'un rayon
   * de clic est la MAIN, pas la donnée : `MAP_POI_HIT_PX` vaut le rayon de cible minimal
   * recommandé, quatre fois le rayon dessiné de la pastille.
   *
   * Un lieu INCONNU ne s'ouvre jamais : la carte ne montre pas sa pastille (spec lieux R1), et
   * le tiroir ne doit pas être une porte dérobée vers ce que le brouillard cache. Le filtre
   * `known` TIENT MÊME SOUS LA LEVÉE DEBUG, qui rend pourtant les pastilles inconnues visibles
   * — et pour une raison de main autant que de règle : le rayon de clic est de 12 px pour ~90
   * lieux, donc rendre tout cliquable ferait manger le clic de TÉLÉPORTATION (qui passe APRÈS)
   * sur une large part de la carte. Une pastille dévoilée par l'outil est un repère, pas une
   * cible.
   */
  private ouvrirLaFiche(pointer: Phaser.Input.Pointer): boolean {
    const map = getHud(this.registry, 'mapData')
    // Hors de la BOÎTE, la carte est masquée par les bandes : on y cliquerait un pays invisible.
    if (!map || pointer.y < MAP_BOX_TOP || pointer.y > MAP_BOX_BOTTOM) return false
    const known = getHud(this.registry, 'knownPois') ?? []
    const scale = this.mapFit * this.mapZoom
    let vise: number | null = null
    let meilleur = MAP_POI_HIT_PX * MAP_POI_HIT_PX
    for (const { poiId, dot } of this.mapPoiDots) {
      if (!known.includes(poiId)) continue
      const dx = this.mapLayer.x + dot.x * scale - pointer.x
      const dy = this.mapLayer.y + dot.y * scale - pointer.y
      const d2 = dx * dx + dy * dy
      // Strict : à égalité, le plus petit index tranche — l'ordre de `placePois`, déterministe.
      if (d2 < meilleur) {
        meilleur = d2
        vise = poiId
      }
    }
    if (vise === null) {
      this.ficheLieu.fermer()
      return false
    }
    // La mémoire des hivers, entière : les années SCELLÉES par l'hôte puis les années VIVES du
    // flux — la même paire que le journal (J), et pour la même raison (le passé ne se perd plus
    // au plafond du flux).
    const volumes = [...(getHud(this.registry, 'volumesScelles') ?? []), ...(getHud(this.registry, 'volumesVifs') ?? [])]
    this.ficheLieu.ouvrir(map, vise, map.zones[vise]?.name ?? '', volumes)
    return true
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
    this.hudCore.setVisible(true)
    this.barreHaute.setVisible(true)
    this.loading?.fadeOut(this.time.now)
  }

  /**
   * LES DEUX BANDEAUX — l'alerte et le conseil (audit UX 2026-08-20, P0.2, défaut cardinal).
   *
   * Ils étaient deux `Phaser.GameObjects.Text` lisant chacun UNE CASE du registre. Deux
   * défauts en un : la case s'écrasait (huit émetteurs se la partageaient, le second message
   * effaçait le premier avant lecture), et le texte, peint sur le CANVAS, passait SOUS les
   * écrans DOM opaques — `.hch` (sac/artisanat) et `.fpn` (le modal du Feu) — c'est-à-dire
   * sous les écrans d'où partent justement les gestes qui se font refuser.
   *
   * Le module DOM (`ui/bandeaux`) prend les deux files, en montre un à la fois jusqu'au bout,
   * et se peint au-dessus des panneaux. Ici, il ne reste que le DRAIN.
   */
  private renderBandeaux(): void {
    this.bandeaux.update(
      this.time.now,
      drainAlertes(this.registry),
      drainConseils(this.registry),
      drainDecouvertes(this.registry),
    )
  }

  /** LA FLÈCHE DE DÉPOUILLE (mort-suite 2) : pointe vers le sac tombé quand il est HORS
   *  cadre (on le voit sinon), avec les secondes avant décantation. Les coords viennent
   *  déjà en espace écran (WorldScene les a calculées dans le repère caméra non zoomé). */
  private renderCorpseHint(): void {
    const hint = getHud(this.registry, 'corpseHint')
    if (hint && !hint.onScreen) {
      this.corpseArrow.setPosition(hint.x, hint.y).setRotation(hint.angle).setVisible(true)
      this.corpseLabel.setPosition(hint.x, hint.y + 18).setText(`sac · ${hint.secs}s`).setVisible(true)
    } else {
      this.corpseArrow.setVisible(false)
      this.corpseLabel.setVisible(false)
    }
  }

  override update(): void {
    // LA RUPTURE D'ABORD. Elle peut tomber à n'importe quel instant — y compris avant
    // que le monde existe — et elle prime sur tout le reste : plus rien n'avancera.
    const fatal = getHud(this.registry, 'fatal')
    if (fatal) {
      this.fatal.show(fatal.reason)
      // La rupture (Phaser) doit primer sur le chargement ET le HUD, or ceux-ci sont des
      // voiles DOM AU-DESSUS du canvas : on les retire/cache, sinon ils la masqueraient.
      this.loading?.destroy()
      this.loading = undefined
      this.hudRoot.setVisible(false)
    }

    this.renderBandeaux()
    this.renderCorpseHint()

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

    // LE CHAT (façon WoW) : historique + ligne de saisie, lus au registry (WorldScene pose).
    this.chatPanel.update(getHud(this.registry, 'chatLog') ?? [], getHud(this.registry, 'chatDraft') ?? null, this.time.now)

    // Le fondu du voile sur le monde. Il s'éteint tout seul ; on lâche la référence
    // quand il ne reste plus rien (l'écran s'est détruit).
    if (this.loading?.fadeStep(this.time.now)) this.loading = undefined

    // ═══ LA BARRE HAUTE a pris la ligne du jour, le lieu et le village ═══
    // Elle écrivait « JOUR 51 — ACTE II — 14H » : l'acte en chiffres romains alors que les
    // saisons ont des NOMS, et pas un mot du défilé.
    //
    // ⚠ LE VILLAGE N'EST PLUS AFFICHÉ NULLE PART. Il part dans une barre à lui (décision
    // d'Alexis, 2026-08-24), qui n'existe pas encore : d'ici là, le nombre de membres, la
    // couleur du Feu et le tableau des tâches ne se lisent plus en jeu. Les clés du HUD
    // (`village`, `archetype`, `villageWarmth`, `tasks`) restent écrites et intactes — c'est
    // l'affichage qui manque, pas la donnée.
    // LE CARACTÈRE DE LA SAISON (`saisons.md` S18) : fonction PURE du tour et de la phase,
    // donc rien à faire transiter. Le HUD ne le disait pas — Alexis a tranché l'inverse le
    // 2026-08-24 : le PRÉSENT se nomme, seul le FUTUR se tait.
    const idCaractere = modificateurDeSaison(time.tour, time.phase)
    // LA BARRE HAUTE SE TAIT SUR LA CARTE (demande d'Alexis, 2026-08-25). L'onglet CARTE est
    // un plein écran opaque, et la barre lui tombait dessus : « LES PRÉS BAS · ◇ LA FERME
    // MUETTE II » chevauchait la rangée d'onglets, et le ruban de l'année barrait le haut de
    // la vallée. La carte dit DÉJÀ où l'on est, en mieux — le survol nomme la zone sous le
    // curseur, la pastille marque l'avatar : la barre n'y ajoutait qu'un doublon en travers.
    //
    // On la CACHE sans cesser de la NOURRIR (`update` ci-dessous tourne toujours) : sa mémoire
    // du lieu et sa grâce de sortie restent à jour, donc elle revient juste au lieu de revenir
    // vide et de se rallumer sous les yeux du joueur.
    this.barreHaute.setVisible(!getHud(this.registry, 'mapOpen'))
    this.barreHaute.update({
      time,
      toponyme: getHud(this.registry, 'toponyme'),
      lieu: getHud(this.registry, 'lieu'),
      ambiant: getHud(this.registry, 'ambiant'),
      ciel: getHud(this.registry, 'cielIci') ?? null,
      // `?? true` : tant que personne n'a rien dit, l'icône reste pleine (les astres aussi).
      couvre: getHud(this.registry, 'cielCouvre') ?? true,
      vent: getHud(this.registry, 'vent'),
      caractere: idCaractere === null ? undefined : NOMS_MODIFICATEUR[idCaractere],
      now: this.time.now,
    })

    // La ceinture et les vitales : on ne fait que RELAYER le snapshot (aucune règle
    // d'inventaire côté client — spec R22).
    const inv = getHud(this.registry, 'inv') ?? []
    const activeSlot = getHud(this.registry, 'activeSlot') ?? -1

    // Le butin récolté : WorldScene POSE, on draine, la pile d'artisanat (bas-droite) empile —
    // fusion par objet. Le coin haut-droit est réservé (décision d'Alexis, 2026-08-22).
    for (const p of drainPickups(this.registry)) this.craftQueueView.pushPickup(p.item, p.count, this.time.now)
    // NIVEAU : la boucle la plus gratifiante, un bandeau au centre. FABRIQUÉ, lui, ne passe plus
    // par les toasts : c'est la tuile de la pile d'artisanat qui passe au vert et sort (plus bas).
    for (const l of drainLevelUps(this.registry)) this.hudCore.pushLevelUp(l.skill, l.level)
    const crafted = drainCrafts(this.registry).map((c) => c.item)

    // L'écran PERSONNAGE (TAB) : la grille, le glisser, le loot, l'artisanat. Le
    // conteneur ouvert est déjà résolu par WorldScene (null s'il a disparu). Fermé,
    // il rend la main au déplacement (`uiTyping` false — la recherche a lâché le clavier).
    const characterMenuOpen = Boolean(getHud(this.registry, 'characterMenuOpen'))
    const characterTab = getHud(this.registry, 'characterTab') ?? 'perso'
    // LA CARTE EST UN ONGLET : `mapOpen` n'est plus écrit par personne, il se DÉDUIT ici, une
    // fois pour toutes. Tous ses lecteurs (molette, fantôme de construction, clic monde,
    // caméra) continuent de marcher tels quels, et l'invariant « la carte n'est à l'écran que
    // sur son onglet » se répare de lui-même, quoi qu'il arrive à l'écran personnage.
    setHud(this.registry, 'mapOpen', characterMenuOpen && characterTab === 'carte')
    if (!characterMenuOpen) setHud(this.registry, 'uiTyping', false)
    this.hudCharacter.update({
      open: characterMenuOpen,
      tab: characterTab,
      inv,
      activeSlot,
      stations: getHud(this.registry, 'stationsInRange') ?? {},
      seen: getHud(this.registry, 'seen') ?? [],
      container: getHud(this.registry, 'openContainerView') ?? null,
      skills: getHud(this.registry, 'skills') ?? {},
      pecheCarnet: getHud(this.registry, 'pecheCarnet') ?? [],
      carnetEncyclo: getHud(this.registry, 'carnetEncyclo') ?? [],
    })
    // LE MENU DU MARTEAU (spec construction R20-R21) : dans le monde, hors TAB/carte,
    // et SEULEMENT le marteau en main. Le ranger le referme et DÉSARME — les fantômes
    // structurels s'éteignent avec l'outil (R21).
    const hammerHeld = activeSlot >= 0 && inv[activeSlot]?.item === 'hammer'
    const building = hammerHeld && !characterMenuOpen && !Boolean(getHud(this.registry, 'mapOpen'))
    this.buildMenu.setVisible(building)
    if (building) this.buildMenu.update(inv)
    else this.buildMenu.disarm()
    // La pièce ARMÉE et son matériau partent au monde : WorldScene peint le fantôme,
    // pose au clic. L'UI décide, la scène du monde exécute.
    setHud(this.registry, 'selected', building ? this.buildMenu.armed() : null)
    // …et le MARTEAU LUI-MÊME, qui allume la frontière du carré dans le monde. Il part
    // d'ici et pas de WorldScene pour que la condition n'existe qu'une fois : le liseré
    // s'éteint donc exactement quand le menu se referme (TAB, carte, outil rangé).
    setHud(this.registry, 'marteau', building)
    setHud(this.registry, 'buildMaterial', this.buildMenu.material())
    // …et le MODE DÉMOLIR avec eux (décision d'Alexis, 2026-08-01) : WorldScene en tire le
    // surlignage rouge de ce qu'on détruirait, et le clic l'action. Faux hors marteau en main.
    setHud(this.registry, 'demolir', building && this.buildMenu.demolir())
    this.refugeePrompt.update(getHud(this.registry, 'refugeesNearby') ?? null)
    // LE MODAL DU FEU (spec feu-station S18) : WorldScene a résolu `openFireView` contre le
    // snapshot (état, combustible, cuisson, bouton) ; l'UI n'a qu'à le montrer avec le sac.
    this.firePanel.update({ view: getHud(this.registry, 'openFireView') ?? null, inv, activeSlot })
    // Le voile de mort : un one-shot horodaté (patron de `error`). Un nouveau `at` =
    // une nouvelle mort → on lève le voile une fois ; il retombe tout seul.
    const death = getHud(this.registry, 'deathMoment')
    if (death && death.at !== this.lastDeathAt) {
      this.lastDeathAt = death.at
      this.deathVeil.show(death.cause, death.byEntityId, death.killerType, this.deaths === 0, death.hadLoot)
      setHud(this.registry, 'deathVeilOpen', true) // WorldScene y accroche le retour de la main
      this.deaths += 1
      // ON SE RELÈVE, ON N'EST PAS REMIS EN JEU (décision d'Alexis, question ⑥). Le voile
      // attend le GESTE ; ce timer n'est plus qu'un FILET, dix fois plus long — un écran
      // modal dont la seule sortie est un bouton devient un piège si ce bouton se tait.
      this.deathHideTimer?.remove()
      this.deathHideTimer = this.time.delayedCall(DEATH_VEIL_FILET_MS, () => {
        this.deathVeil.hide()
        setHud(this.registry, 'deathVeilOpen', false)
      })
    }
    // La file, elle, se voit TOUJOURS : une file bouchée (sac plein) ou en pause
    // (station quittée) doit se remarquer sans aller ouvrir un menu (spec F15).
    this.craftQueueView.setVisible(true)
    this.craftQueueView.update(getHud(this.registry, 'craftQueue') ?? [], crafted, this.time.now)
    // LA BANDE 2A d'un seul geste (vitales, ceinture, sauvegarde). Le jour, le lieu et le
    // village ont quitté ce module : la barre haute les dit (2026-08-24).
    this.hudCore.update({
      hp: getHud(this.registry, 'hp') ?? 100,
      stamina: getHud(this.registry, 'stamina') ?? 100,
      exhausted: getHud(this.registry, 'exhausted') ?? false,
      hunger: getHud(this.registry, 'hunger') ?? 100,
      temperature: getHud(this.registry, 'temperature') ?? TEMPERATURE.CORPS_SAIN, // °C, pas une jauge 0-100
      wounds: getHud(this.registry, 'wounds') ?? {},
      skills: getHud(this.registry, 'skills') ?? {},
      inv,
      activeSlot,
      characterMenuOpen, // sac ouvert → vitales opaques, ceinture cachée
      saveState: getHud(this.registry, 'saveState') ?? null,
      now: this.time.now,
    })

    // Le journal : ouvert À LA DEMANDE (J). La fin de saison ne le force PLUS : c'est la stèle
    // (season-veil) qui prend la cérémonie, et elle tient sa propre chronique.
    const chronicle = getHud(this.registry, 'chronicle') ?? []
    const open = Boolean(getHud(this.registry, 'journalOpen'))
    this.journalPanel.setVisible(open)
    if (open) {
      // LA MÉMOIRE DES HIVERS (T5) : les années scellées par l'hôte, puis les années vives du
      // flux — à la suite, un en-tête par an dès qu'il y en a plus d'une. Le passé ne se perd
      // plus au plafond du flux : il est relisible, volume par volume.
      const volumes = [...(getHud(this.registry, 'volumesScelles') ?? []), ...(getHud(this.registry, 'volumesVifs') ?? [])]
      const lignes: string[] = []
      for (const v of volumes) {
        if (volumes.length > 1) lignes.push(`— L’AN ${v.an} —`)
        for (const e of v.entrees) lignes.push(formatChronicleLine(e))
      }
      this.journalText.setText(lignes.slice(-26).join('\n') || '(rien encore — le monde est jeune)')
    }

    // LA STÈLE DE FIN DE SAISON : levée UNE fois, au jour 61, avec les verdicts et la chronique
    // entière (le vrai trophée). Terminale — le joueur ROUVRE la vallée (?fresh) depuis elle.
    // `seasonVerdicts` non-null EST le signal de fin de saison (posé au `season_ended`).
    const verdicts = getHud(this.registry, 'seasonVerdicts')
    if (!this.seasonVeilShown && verdicts) {
      this.seasonVeilShown = true
      this.seasonVeil.show(verdicts.verdicts, verdicts.myVillageId, chronicle)
    }

    // Le menu PAUSE (ESC) : WorldScene fige l'hôte quand `menuOpen` ; on ne fait que montrer/cacher.
    this.pauseMenu.setVisible(Boolean(getHud(this.registry, 'menuOpen')))

    // LA CARTE (onglet CARTE, ouvert à M) : montée à la première ouverture, puis basculée.
    // Le BROUILLARD doit être publié À CE MOMENT-LÀ : `ensureMapOverlay` ne monte son calque
    // qu'une fois, et sans lui la carte serait offerte entière — l'exact contraire de R19.
    const mapData = getHud(this.registry, 'mapData')
    const mapOpen = Boolean(getHud(this.registry, 'mapOpen'))
    if (mapOpen && mapData && getHud(this.registry, 'fog') && this.textures.exists('map-demo')) {
      this.ensureMapOverlay(mapData)
    }
    if (this.mapRoot) {
      this.mapRoot.setVisible(mapOpen)
      if (mapOpen && mapData) {
        if (!this.mapWasOpen) this.resetMapView() // vue neuve à chaque ouverture
        this.syncCarteToutVoir() // DEV + P : la carte s'ouvre en entier (affichage seul)
        this.refreshMapFog() // ne repeint que si la marche a découvert du neuf
        this.updateMapMarker(mapData)
        this.updateMapPoiDots()
      }
      // Le tiroir du registre vit DANS l'onglet carte : il tombe avec lui.
      if (!mapOpen && this.mapWasOpen) this.ficheLieu.fermer()
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
