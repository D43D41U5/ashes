/**
 * La scène de jeu : du CÂBLAGE. Le rendu du snapshot vit dans
 * `world/snapshot-view.ts`, les bindings dans `world/input-bindings.ts`, la
 * publication HUD dans `world/hud-bridge.ts` — ici restent la caméra, la
 * prédiction locale et la frontière de transport.
 *
 * Le client est « bête » (spec client R3-R5, reconciliation R1-R7) : la sim
 * tourne dans le Worker, ici on envoie des intentions numérotées et on interpole
 * des snapshots. La prédiction locale de son propre avatar et la réconciliation
 * par rejeu vivent dans `/sim` (`prediction.ts`, pur et testé) — on ne fait ici
 * que câbler l'I/O réseau et le rendu.
 */
import {
  BALANCE,
  CHRONICLE_EVENT_TYPES,
  FIRE_UPKEEP,
  TEMPERATURE,
  TERRAIN_FOREST,
  terrainAt,
  terrainConstructible,
  clairiereForet,
  createPrediction,
  decayRenderOffset,
  fbm2,
  SLOTS,
  hash2,
  isRangedWeapon,
  predictFrame,
  reconcile as reconcilePrediction,
  renderPosition,
  pendingStrike,
  skillLevel,
  speedScaleFor,
  weaponKind,
  weaponProfile,
  zoneAt,
  type Entity,
  type GameTime,
  type ItemId,
  type PlayerAction,
  type PredictInput,
  type PredictionState,
  type ResourceNode,
  type SimEvent,
  type Strike,
  type WeaponKind,
  type WorldMap,
  avanceeDuFront,
  zoneSlugAt,
  PROTOCOL_VERSION,
  CHAT_MAX_LEN,
  CHAT_RADIUS_TILES,
  type ClientToHost,
  type HostToClient,
  type ReadyMessage,
  type SnapshotMessage,
  type PerfMessage,
  EDGE_BITS,
  edgeBarrierAt,
  floorAt,
  fullTileAt,
  poseLibre,
  roofAt,
  chebyshev,
  fireRadius,
  piece,
  type Village,
} from '@ashes/sim'
import Phaser from 'phaser'
import { createColyseusHost, createWorkerHost, type HostConnection } from '../host-connection'
import { VEILLEE_SEED } from '../worker/mondes'
import { keymapEffectif } from './world/keymap-perso'
import { noteMulti } from '../derniere-partie'
import { SERVERS } from '../servers'
import { libelleTouche } from './world/touches'
import { getHud, setHud, type Placeable } from '../hud-state'
import {
  AMBIENT_DEPTH,
  AMBIENT_DEPTH_LIT,
  lookaheadOffset,
  OVERLAY_DEPTH,
  TILE_PX,
  VISIBLE_TILES_TALL,
  zoomForFraming,
} from '../render/framing'
import { MUR_HT } from '../render/bati-art'
import { ambientTint, daylight, fireGlow, fireHoleRadius, lerpColor } from '../render/lighting'
import { createWarp, type Warp } from '../render/warp'
import {
  drainQueuedActions,
  publishAlarm,
  publishChronicle,
  publishCraft,
  publishError,
  publishHint,
  publishDeath,
  publishLevelUp,
  publishOpenFire,
  publishRefugeesNearby,
  publishOpenContainer,
  publishPickup,
  publishPlayerVitals,
  publishSaved,
  publishSeasonEnded,
  publishStationsInRange,
  publishTimeAndVillage,
} from './world/hud-bridge'
import { ClutterLayer } from './world/clutter-layer'
import { familleDe, moyenneFamille, profilDe } from '../render/grain-sol'
import { GroundLayer } from './world/ground-layer'
import { ambianceDe, moduler } from '../render/zone-ambiance'
import { TERRAIN_COLORS } from '../render/terrain-colors'
import { CendreLayer } from './world/cendre-layer'
import { CliffLayer } from './world/cliff-layer'
import { PoiLayer } from './world/poi-layer'
import { BorneLayer } from './world/borne-layer'
import { CombeMist } from './world/combe-mist'
import { MistBanks } from './world/mist-banks'
import { VentLisse } from './world/vent-lisse'
import { ensureEauFxTextures } from './world/eau-fx'
import { EauEvents } from './world/eau-events'
import { PoissonsOmbres } from './world/poissons-ombres'
import { FeuillesDerive } from './world/feuilles-derive'
import { RefletsLayer } from './world/reflets'
import { SonsDeLEau } from '../audio/eau-audio'
import { riveAt } from '../render/water-field'
import { GueStones } from './world/gue-stones'
import { MorningMist } from './world/morning-mist'
import { FireFx } from './world/fire-fx'
import { FireGroundGlow } from './world/fire-ground-glow'
import { createContactShadow } from './world/contact-shadow'
import { champLisiere, poidsLisiere, LISIERE_MAX, LISIERE_PORTEE } from '../render/ecotone'
import {
  creerBrouillard,
  depackBrouillard,
  FOG_RAYON_TUILES,
  loadFog,
  packBrouillard,
  revele,
  saveFog,
  type Brouillard,
  type IdentiteMonde,
} from '../render/fog'
import { fireStateAt, POI_CHARGES, TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER } from '@ashes/sim'

/**
 * Le rayon qu'un lieu dévoile, LU DANS LA TABLE DE LA SIM (`POI_CHARGES`) et jamais recopié :
 * une seconde source de vérité dériverait au premier réglage. 0 = ce lieu ne dévoile rien.
 */
function revealRadiusOf(kind: string): number {
  const charge = POI_CHARGES[kind]
  return charge && charge.devise === 'savoir' && charge.reveal === 'radius' ? charge.radiusTiles : 0
}
import { NightVeil } from './world/night-veil'
import { DynamicLighting } from './world/dynamic-lighting'
import { WaterLayer, type WaterWader } from './world/water-layer'
import { AmbientLife } from './world/ambient-life'
import { bindDebugKeys } from './world/debug-bindings'
import { createDebugPanel } from './world/debug-panel'
import { syncDebug } from './world/debug-overlay'
import { BuildGhost } from './world/build-ghost'
import { CarreVillage } from './world/carre-village'
import { FellGauge, type FellCharge } from './world/fell-gauge'
import { FlankGlow } from './world/flank-glow'
import { HitFx } from './world/hit-fx'
import { RecolteFx } from './world/recolte-fx'
import { SprintFx } from './world/sprint-fx'
import { ChuteArbre } from './world/chute-arbre'
import { ReveilFx } from './world/reveil-fx'
import { createAttackFx, type AttackFx, type Zone } from './world/attack-fx'
import { createHandWeapons, type HandWeapons } from './world/hand-weapon'
import { bindInputs, type MovementBindings } from './world/input-bindings'
import { demolishTargetAt } from './world/aim'
import { INTERP_DELAY_MULTI_MS, SnapshotView, type InterpolatedSprite } from './world/snapshot-view'
import { silhouetteDepuisSprite } from './world/visee-corps'
import { suivreAngle } from './world/visee-lissee'
import { DEATH_FADE_MS, DEATH_VEIL_MS } from './ui/death-veil'
import { nextOnboardingHint, type OnboardingHintId } from './ui/onboarding'
import { cendreTelegraphForDay } from './world/cendre-telegraph'
import { corpseArrow, corpseSecondsLeft } from './world/corpse-arrow'
import { SoundEngine } from '../audio/engine'
import { buildSound, soundForEvent } from '../audio/sound'
import { ChantsDeLAube } from '../audio/aube'

/**
 * LA ZONE DE LA SIM, EN PIXELS. La SEULE traduction que le client s'autorise sur le
 * combat : des tuiles vers des pixels. Pas un ajustement, pas un arrondi « qui rend
 * mieux » — la forme dessinée au sol EST la forme frappée. Un télégraphe qui
 * s'arrangerait avec la géométrie apprendrait au joueur une règle qui n'existe pas,
 * et c'est exactement la faute que le dernier passage sur le combat a dû jeter.
 */
const zoneOf = (strike: Strike): Zone => ({
  shape: strike.shape,
  range: strike.range * TILE_PX,
  arcCos: strike.arcCos,
  radius: strike.radius * TILE_PX,
})
/**
 * LE TÉLÉGRAPHE PART DU CENTRE DU CORPS, PAS DE SOUS LES PIEDS. Les sprites sont ancrés
 * PIEDS (`actorPlacement` : pieds à `y + AVATAR_HITBOX_DEPTH_TILES/2`), or la sim fait
 * partir la zone du CENTRE logique — `sprite.y` est donc trois pixels trop bas pour
 * l'apex d'un cône. Trois pixels sur une portée de poing qui en fait dix-sept, c'est un
 * cinquième de la portée : le même petit mensonge que l'écrasement, en plus discret.
 */
const ANCRE_SOL_PX = (BALANCE.AVATAR_HITBOX_DEPTH_TILES / 2) * TILE_PX
/** Caméra « Foxhole » (R11) : force du décalage vers le curseur (px écran → px monde). */
const LOOKAHEAD_STRENGTH = 0.18
/** Borne radiale du décalage caméra, en tuiles. */
const LOOKAHEAD_MAX_TILES = 6
/** Écart prédiction/autorité au-delà duquel on snap (spec client R5). */
const SNAP_DISTANCE_TILES = 1.5
/** Décroissance par frame de l'écart visuel après une correction (lissage de rendu, spec R6). */
const RENDER_OFFSET_DECAY = 0.85
/** LE REGARD (audit UI/UX P3-11) : à quelle distance du centre du corps se pose le pion
 *  d'orientation (px monde), et sa taille à l'écran. Calé pour affleurer le bord de
 *  l'avatar (~16 px de large) sans le quitter. */
const GAZE_REACH = 6
const GAZE_PX = 5

/** À quelle distance (tuiles) un étranger déclenche le conseil du DON (ui/onboarding).
 *  Un peu plus large que la portée d'un don : on enseigne AVANT d'être à portée. */
const ONBOARD_NEIGHBOR_TILES = 8

/** Sous quelle fraction de la capacité le Feu est « bas » — déclenche le conseil « nourris-le »
 *  (ui/onboarding). Assez bas pour être un vrai signal (le Feu naît à la moitié), assez haut
 *  pour laisser le temps d'agir. Seuil d'UI, pas d'équilibrage. */
const ONBOARD_FIRE_LOW_FRAC = 0.3
/**
 * Borne du journal d'événements de chronique gardé en mémoire (les plus
 * récents gagnent). Compromis assumé : la chronique d'une Veillée reste
 * courte (quelques dizaines d'événements filtrés sur 60 jours), donc 500
 * suffit largement et évite au log de croître sans borne — et à
 * `chronicleFromEvents` de reparcourir un log arbitrairement long à chaque
 * événement. Le vrai fix (chronique incrémentale) viendra avec la
 * persistance.
 */
const EVENT_LOG_CAP = 500

/**
 * Nos étapes de montage du monde, dans l'ordre (voir `onReady`) — la barre de chargement
 * les compte après les passes de l'hôte. La liste est la SEULE source de vérité : `onReady`
 * doit fournir une fonction pour chacune (c'est un `Record` typé, donc le compilateur refuse
 * d'en oublier une ou d'en inventer une), et le total de la barre s'en déduit.
 */
const BUILD_PHASES = ['relief', 'bake', 'ground', 'water', 'pois', 'clutter', 'world'] as const
type BuildPhase = (typeof BUILD_PHASES)[number]
const BUILD_STEPS = BUILD_PHASES.length

/** Fenêtre de la sonde de coût (un échantillon par seconde de jeu) — ~10 min, puis on oublie. */
const PERF_ECHANTILLONS_MAX = 600



/** Les événements retenus pour la chronique de saison. */
// Les types chronique-dignes sont désormais la LISTE CANONIQUE de /sim
// (`CHRONICLE_EVENT_TYPES`) : la même que l'hôte persiste, la même que le formateur sait
// raconter — plus de set local qui dérive (c'est ce qui privait `poi_first_visit` de récit).

/** Terrains STRUCTURELS — pas des biomes. Ils ne participent PAS au fondu inter-biome du bake
 *  (sinon un halo gris au pied des falaises, une frange sur la berge) : void, eaux, mur, falaise.
 *  Ils sont de toute façon recouverts par leurs propres couches (paroi, eau). */
const BAKE_NON_BIOME = new Set<number>([0, 4, 6, 7, 23])

/** Assombrit/éclaircit légèrement une couleur (variation par tuile). */
function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * factor))
  const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * factor))
  const b = Math.min(255, Math.floor((color & 0xff) * factor))
  return (r << 16) | (g << 8) | b
}

// ── LE TAPIS DE LA FORÊT DE LA RACINE (demande d'Alexis, 2026-07-18) ──────────────────────────
// Le sol de la forêt n'est plus un aplat vert : c'est une LITIÈRE de feuilles PLUS OU MOINS MORTES
// (brun ↔ olive, selon un bruit fin), qui VERDIT vers le CŒUR des clairières. Le vert suit le même
// champ `clairiereForet` que le semis d'arbres ÉVIDE — sol et arbres ne peuvent donc pas se
// contredire : là où l'arbre manque (la clairière), l'herbe reprend.
const LITIERE_BRUN = 0x6b5730 // feuille bien morte
const LITIERE_OLIVE = 0x5c5e38 // feuille à demi morte (il reste du vert)
const CLAIRIERE_VERT = 0x477e3c // l'herbe qui reprend au cœur d'une trouée

/** La couleur du sol forestier d'une tuile : litière variée, verdissant dans les clairières. */
function solForet(tx: number, ty: number, seed: number): number {
  const litter = fbm2(tx, ty, 6, (seed ^ 0x1eaf) | 0) // grain de litière, fin
  const base = lerpColor(LITIERE_BRUN, LITIERE_OLIVE, litter)
  const clair = clairiereForet(seed, tx, ty) // 0 sous le couvert, croît vers le cœur d'une clairière
  return clair > 0 ? lerpColor(base, CLAIRIERE_VERT, Math.min(1, clair * 3.5)) : base
}

/**
 * Le choix fait à l'écran principal, passé en `data` de scène. `solo` → Worker
 * (Veillée) ; `multi` → serveur Colyseus à `url`. Absent (lancement direct) → on
 * retombe sur `VITE_SERVER_URL` (rétrocompat dev/smoke).
 */
/**
 * Combien de temps on attend l'écriture disque avant de quitter quand même (menu pause →
 * « retour au menu principal »). Trois secondes : au-delà, mieux vaut rendre la main que retenir le
 * joueur dans une partie qu'il quitte — l'autosave a de toute façon écrit il y a moins de 30 s.
 */
const QUIT_ATTENTE_MS = 3000

export interface WorldSceneData {
  mode?: 'solo' | 'multi'
  url?: string
  /** SOLO — la case du disque à ouvrir (0..`SLOT_COUNT`-1). Défaut : la case 0. */
  slot?: number
  /** SOLO — la seed à SEMER si la case est vide. Une case occupée garde la sienne. */
  seed?: number
  /** SOLO — le nom donné à la vallée qu'on FONDE. Une case occupée garde le sien. */
  nom?: string
}

export class WorldScene extends Phaser.Scene {
  /** La frontière de transport (Worker aujourd'hui, Colyseus en LAN). */
  private host!: HostConnection
  private map!: WorldMap
  /** LE VOILE DE NUIT — bleu de l'heure + air de zone, mais TROUÉ par les Feux (voir `night-veil`). */
  private nightVeil: NightVeil | null = null
  private airColor = 0x000000
  private airAlpha = 0
  private airCible: { color: number; alpha: number } = { color: 0x000000, alpha: 0 }
  private fireFx: FireFx | null = null
  /** La chaleur du Feu tombée au sol — cosmétique, cf. world/fire-ground-glow.ts. */
  private fireGround: FireGroundGlow | null = null
  /** ESSAI éclairage dynamique (decisions.md 2026-07-20) : soleil + Feux normal-mappés,
   *  armés par le toggle debug F5. Inerte tant que le flag est éteint. */
  private dynLight: DynamicLighting | null = null
  private water: WaterLayer | null = null
  /** Oiseaux et lucioles — décor pur, hors sim (voir world/ambient-life.ts). */
  ambientLife: AmbientLife | null = null
  private lastTime: GameTime | null = null
  /** Couvert de canopée lissé autour de l'avatar — piloté vers la valeur échantillonnée. */
  /** Le monde n'existe qu'après `ready` (carte, spawn, calendrier reçus de l'hôte). */
  private worldReady = false
  /** Ce que ce joueur a ARPENTÉ (spec R19). Vit côté client : aucune règle n'en dépend. */
  private fog?: Brouillard
  /** Les étapes de montage du monde qui restent à jouer — une par frame (voir `onReady`).
   *  Non vide ⇒ le monde est en train de naître : `update` ne fait QUE le monter. */
  private buildQueue: [phase: string, run: () => void][] = []
  /** Combien de passes l'hôte s'est-il annoncé ? (lu de ses `progress`) — la barre est
   *  la somme des siennes et des nôtres, sinon elle reculerait à la passation. */
  private hostPhases = 0
  private worldSeed = 0
  private clutter?: ClutterLayer
  private ground!: GroundLayer
  private cendre!: CendreLayer
  private cliffs!: CliffLayer
  private pois!: PoiLayer
  /** Les bornes de seuil (worldgen R21) et la brume de la Combe — décor dérivé de la carte. */
  private bornes: BorneLayer | null = null
  private combeMist: CombeMist | null = null
  private gueStones: GueStones | null = null
  private morningMist: MorningMist | null = null
  /** Les bancs voyageurs (brume V2) et le vent lissé qui porte toute la brume. */
  private mistBanks: MistBanks | null = null
  private ventLisse = new VentLisse()
  /** Les événements d'eau (gerbe/empreintes) et leurs sons (spec eau-vivante R7-R8). */
  private eauEvents: EauEvents | null = null
  private sonsEau = new SonsDeLEau()
  private lastSonPos: { x: number; y: number } | null = null
  /** Les poissons-ombres (R14) — décor assumé tant que la pêche n'existe pas. */
  private poissons: PoissonsOmbres | null = null
  /** Les feuilles au fil de l'eau (R15) — le courant se voit. */
  private feuilles: FeuillesDerive | null = null
  /** Les reflets du monde (R13) — acteurs immergés et fûts de la rive nord. */
  private reflets: RefletsLayer | null = null
  /** Sonde A10 : le coût de boot des couches d'eau (champ de rive compris), en ms. */
  bootEauMs = -1
  /**
   * LE COÛT DE L'HÔTE, TEL QUE LE WORKER LE MESURE (dev seulement — voir `PerfMessage`).
   * Un échantillon par seconde de jeu, gardés en fenêtre glissante : le smoke LIT cette
   * liste, il ne la fabrique pas. C'est la seule mesure de coût par tick du projet qui soit
   * prise sur le moteur que la Veillée joue réellement — tout le reste vient de Node.
   */
  perfSamples: PerfMessage[] = []
  /** Le dernier état du toggle appliqué à l'avatar (swap _lit une fois, pas par frame). */
  private playerLit: boolean | null = null
  /** Marcheurs à remous poussés cette frame — la sonde du critère A5 (lue par le smoke). */
  lastWaderCount = 0
  private calendarScale = 1
  /** Dernier tick de snapshot appliqué — rejette les snapshots périmés/hors ordre. */
  private lastSnapshotTick = 0
  private playerId = 0
  /** Les lieux que MON joueur connaît — lu du snapshot, jamais décidé ici (client bête). */
  private myKnownPois: readonly number[] = []
  private playerSprite!: Phaser.GameObjects.Image
  /** LE REGARD (audit UI/UX P3-11) : pion d'orientation posé au bord de l'avatar. */
  private gaze!: Phaser.GameObjects.Image
  /** LE MOMENT DE MORT (mort-suite 1+5) : entre la chute et le réveil au Feu, on TIENT la
   *  caméra sur la tuile où l'on tombe (on voit sa dépouille), on coupe l'input, et le
   *  saut au respawn se fait CACHÉ sous le voile opaque. Faux hors de cette fenêtre. Les
   *  transitions (snap sous le voile, main rendue) sont pilotées DANS `update` à partir de
   *  `dyingAt` — un test de NIVEAU, robuste aux sauts d'horloge (là où un `delayedCall`,
   *  déclenché sur FRONT, se perd quand le pas d'horloge bondit). */
  private dying = false
  private dyingAt = 0
  private dyingSnapped = false
  /** Le nombre de morts RAPPROCHÉES (streak V2-21) au moment de la chute — lu du snapshot,
   *  sert au bandeau de réveil à rendre LISIBLE l'épuisement croissant (sinon invisible). */
  private dyingDeaths = 1
  /** LE TRAQUEUR DE DÉPOUILLE (mort-suite 2) : l'id du cadavre où gît MON sac (verrouillé au
   *  premier snapshot après la chute, par proximité au lieu de mort), sa position de mort en
   *  attente d'appariement, et les objets d'écran de la flèche de bord. `null` = rien à suivre
   *  (dont le cas MAINS VIDES : une mort sans butin ne crée aucun cadavre — mort-suite 4). */
  private myCorpseId: number | null = null
  private corpseDeathPos: { x: number; y: number } | null = null
  /** L'historique du chat, mirroré au registry pour le panneau d'UIScene. */
  private chatLog: import('../hud-state').ChatLine[] = []
  /** Le message en cours de saisie, ou `null` si la ligne est fermée. */
  private chatDraft: string | null = null
  /** Prédiction à pas fixe + réconciliation par rejeu (spec reconciliation). */
  private prediction: PredictionState = createPrediction(0, 0)
  /** Position LOGIQUE du joueur (ancre autorité) — pour viser, mesurer une distance. */
  private get predicted(): { x: number; y: number } {
    return this.prediction.base
  }
  /**
   * Miroir client des règles de POSE (place_campfire / build) : à portée de BÂTI, DANS LE
   * CARRÉ du Feu, sur terrain constructible, hors landmark pour le feu de camp. La sim
   * revalide tout — ceci ne fait que colorer le fantôme juste, pour ne pas afficher
   * « perdu » là où la pose passe (et l'inverse).
   *
   * ═══ DEUX MENSONGES CORRIGÉS le 2026-08-04 (demande d'Alexis) ═══
   *
   *  1. LE CARRÉ MANQUAIT. `evaluateBuild` refuse en `out_of_square` toute pose hors du
   *     domaine du Feu (village.ts) — ce miroir ne le testait pas. Le fantôme restait donc
   *     VERT hors du carré, on cliquait, et la sim refusait sans que rien à l'écran ne
   *     l'ait annoncé. C'est le défaut qui a motivé toute la couche `carre-village`.
   *  2. LE LANDMARK VALAIT POUR TOUT. `zoneAt` refusait ici n'importe quelle pièce dans un
   *     toponyme, quand la sim ne le teste QUE pour le feu de camp (`place_campfire` /
   *     `light_fire`, les deux seuls appels de `zoneAt` dans village.ts). Or R1 autorise
   *     expressément un village dans une zone-région : le carré entier devenait rouge, et
   *     pas un mur n'y était posable — au fantôme seulement, la sim les acceptait tous.
   */
  private placeable(tx: number, ty: number, placing: Placeable, edge: number): boolean {
    const p = this.predicted
    const r = BALANCE.BUILD_RANGE
    if ((tx + 0.5 - p.x) ** 2 + (ty + 0.5 - p.y) ** 2 > r * r) return false
    if (!this.dansMonCarre(tx, ty, placing)) return false
    if (placing === 'fire' && zoneAt(this.map, tx + 0.5, ty + 0.5)) return false
    // La porte de terrain de /sim, MOT POUR MOT — elle juge par pièce depuis que l'eau peu
    // profonde ne porte que le sol. La réimplémenter ferait vert ici et refusé là-bas.
    if (!terrainConstructible(terrainAt(this.map, tx, ty), placing)) return false
    // ═══ SUR UNE ARÊTE, C'EST L'ARÊTE QUI DOIT ÊTRE LIBRE (spec construction R23) ═══
    //
    // Un mur mince ne prend pas sa tuile : il court sur le trait. Exiger la tuile vide rougirait
    // tout ce qu'on veut justement pouvoir faire — fermer un COIN (la tuile porte déjà l'autre
    // arête), longer une haie de buissons, ceindre son propre four. La seule question qui reste
    // est « ce trait porte-t-il déjà un mur ? », et elle se pose des DEUX côtés.
    //
    // LU AU REGISTRE (2026-08-04), plus écrit en toutes lettres : la liste disait `wall || door`
    // et OUBLIAIT LA PALISSADE, née après R23 avec `arete: 'requise'`. Le fantôme d'une palissade
    // au-dessus d'un buisson rougissait donc — alors que le fantôme (`build-ghost`) et la sim la
    // jugeaient tous deux sur l'arête, et l'acceptaient. C'est la sixième « liste écrite à la
    // main que le compilateur ne garde pas » ; elle se dérive.
    if (piece(placing).arete !== 'interdite') {
      return edgeBarrierAt(this.view.structures, tx, ty, edge) === undefined
    }
    // ═══ LES PIÈCES MOLLES SE SUPERPOSENT (R14, miroir d'`evaluateBuild`) ═══
    //
    // Le sol et le toit ne s'opposent qu'à un doublon de leur COUCHE — jamais au solide qu'ils
    // coiffent (« entièrement toité, l'enclume comprise »), ni à un nœud (R5 : le mou passe),
    // ni à quelqu'un dessous (couvrir une pièce habitée est le geste NORMAL du toit). Le miroir
    // plein-tuile qui suit rougissait le fantôme de toit sur chaque case dallée ou meublée,
    // alors que la sim acceptait la pose — relevé à la revue du calage des toits (2026-08-10).
    const couche = piece(placing).occupe
    if (couche === 'toit') return roofAt(this.view.structures, tx, ty) === undefined
    if (couche === 'sol') return floorAt(this.view.structures, tx, ty) === undefined
    // Tuile LIBRE : ni structure PLEINE, ni ressource, ni personne dessus (miroir du sim).
    if (fullTileAt(this.view.structures, tx, ty)) return false
    if (!poseLibre(this.view.villages, this.view.nodes, tx, ty)) return false
    return !this.lastEntities.some((e) => e.hp > 0 && Math.floor(e.x) === tx && Math.floor(e.y) === ty)
  }
  /** MON village dans le dernier snapshot, ou `undefined`. La couche du carré et le
   *  miroir de pose le lisent tous les deux — une seule résolution, jamais deux. */
  private monVillage(): Village | undefined {
    return this.myVillageId === null ? undefined : this.view.villages.find((v) => v.id === this.myVillageId)
  }
  /**
   * La tuile est-elle dans le carré de MON Feu ? (spec construction R2, `evaluateBuild`
   * et `place_component` — même `chebyshev`, importé de /sim et jamais réécrit.)
   *
   * LE FEU DE CAMP EN EST EXEMPT, et c'est la règle, pas une tolérance : `place_campfire`
   * est le geste qu'on fait SANS village, pour en fonder un. Le soumettre au carré rendrait
   * toute fondation impossible — et, pour qui a déjà un village, interdirait le second feu
   * libre que la sim autorise hors du domaine.
   */
  private dansMonCarre(tx: number, ty: number, placing: Placeable): boolean {
    if (placing === 'fire') return true
    const v = this.monVillage()
    if (!v) return false // sans village, le marteau et les composants n'ont nulle part où poser
    return chebyshev(v.fireTx, v.fireTy, tx, ty) <= fireRadius(v.tier)
  }
  /** Les sprites-miroirs du snapshot (structures, nœuds, cadavres, autres entités). */
  private view!: SnapshotView
  /** Le retour de frappe (tressaillement + butin qui monte) — spec recolte.md G9. */
  private hitFx!: HitFx
  /** LES ÉCLATS arrachés au nœud — 3e signe de la récolte (spec recolte.md G10). */
  private recolteFx!: RecolteFx
  /** LA COURSE SE VOIT (Alexis, 2026-08-01) : la foulée, le souffle, et le mur. */
  private sprintFx!: SprintFx
  /** Les terrains qui ne LÈVENT pas de poussière : on n'y a pas de sol sous le pied. */
  private static readonly EAU = new Set([TERRAIN_SHALLOW_WATER, TERRAIN_DEEP_WATER])
  /** Le dernier cap tenu — il sert quand on ne bouge plus (la bouffée du mur part
   *  DERRIÈRE soi, et « derrière » n'a pas de sens sans un devant). Vers le bas de
   *  l'écran par défaut : le seul repli qui reste visible face à la caméra. */
  private dernierCap = { x: 0, y: 1 }
  /** LES ARBRES QUI S'ABATTENT quand le fût est vidé (spec recolte.md G15). */
  private chuteArbre!: ChuteArbre
  /** LE SOL QUI TRAVAILLE, et le Cendreux qui s'en extrait (spec `cendreux.md` R21/R22). */
  private reveilFx!: ReveilFx
  /** La silhouette de ce qu'on va poser, quand le mode construction est armé. */
  private buildGhost!: BuildGhost
  /** Le carré du Feu : liseré, tapis, extinction du dehors (spec construction R2). */
  private carreVillage!: CarreVillage
  /** La jauge d'abattage au-dessus de l'arbre qu'on charge (spec recolte-maitrise). */
  private fellGauge!: FellGauge
  /** La lueur du bon flanc sur les rochers à portée (spec recolte-maitrise, verbe 2). */
  private flankGlow!: FlankGlow
  /** Instant (horloge client) du dernier coup de récolte porté — le tempo que la lueur reforme. */
  private lastStrikeAt = -Infinity
  /** Exposé pour le hook `__BRAISES__` (les smoke tests lisent `others.size`). */
  private get others(): ReadonlyMap<number, InterpolatedSprite> {
    return this.view.others
  }
  /**
   * LES ENTITÉS DU DERNIER SNAPSHOT, telles quelles — surface de LECTURE du smoke
   * test (`window.__BRAISES__.scene.lastEntities`). Le smoke lit l'état, il ne le
   * fabrique pas : c'est ce qui lui permet de vérifier que la zone qu'il VOIT au sol
   * est bien celle que la SIM va frapper, au lieu de compter des tracés — un compteur
   * de commandes de dessin dit qu'il se passe quelque chose, jamais QUOI.
   */
  lastEntities: Entity[] = []
  /** Suivi des marcheurs pour les remous de l'eau (spec da-feeling R11) : dernière
   *  position vue et date du dernier pas — la force du remous s'en déduit. */
  private readonly waderTrack = new Map<
    number,
    { x: number; y: number; lastMove: number; lastBouge: number; dirX: number; dirY: number }
  >()
  private inputs!: MovementBindings
  private myVillageId: number | null = null
  private myHunger = 100
  /** LE SON (échafaudage audio) : moteur WebAudio procédural, réveillé au 1er geste, coupable
   *  (touche N). Esthétique à régler à l'oreille — le SYSTÈME est là, sobre et mutable. */
  private audioFx = new SoundEngine()
  /** Les oiseaux de l'aube (da-feeling R16) — sa sonde `chirps` sert au smoke (A7). */
  readonly aube = new ChantsDeLAube()
  private eventLog: SimEvent[] = []
  /** Persistance P1-6 : une reprise a réamorcé `eventLog` depuis le disque — il faut
   *  REPUBLIER la chronique une fois, au premier snapshot (là où les NOMS de village
   *  arrivent). Sans ce forçage, aucun événement neuf ne la déclencherait et le récit
   *  repris resterait invisible. */
  private chronicleReseedPending = false
  private evacMarker: Phaser.GameObjects.Arc | null = null
  private myWounds: Entity['wounds'] = {}
  private myStamina = 100
  /** À bout de souffle (R1ter) — absent tant qu'on ne l'est pas. */
  private myExhausted: true | undefined = undefined
  private myTemperature = 100
  /** Mon avatar télégraphie : la sim l'immobilise — la prédiction aussi. */
  private myWindup = false
  /** Je CHARGE : la sim me ralentit (COMBAT.CHARGE_MOVE_FACTOR) — la prédiction doit
   *  le savoir, sinon mon avatar file plus vite que l'autorité et se fait rappeler à
   *  chaque snapshot. La formule reste celle de /sim (`speedScaleFor`). */
  private myCharging = false
  /** Les WIND-UPS du dernier snapshot : qui arme un coup, vers où, avec QUELLE FORME.
   *  C'est le TÉLÉGRAPHE du GDD §7 — on doit voir venir le coup, le sien comme
   *  celui d'en face. Il vient du snapshot, jamais du clic (invariant §3). */
  private windups: {
    id: number
    dx: number
    dy: number
    ticksLeft: number
    strike: Strike
    side: 1 | -1
    charged: boolean
    /** C'est un TIR (spec `tir.md`) : le client peint un TRAIT, pas un moulinet. */
    ranged: boolean
  }[] = []
  /** LES CHARGES du dernier snapshot : qui maintient son clic, et où en est le coup.
   *  `strike` = ce qui partirait MAINTENANT (la sim tranche — `pendingStrike`). */
  private charges: { id: number; dx: number; dy: number; ratio: number; strike: Strike; ranged: boolean }[] = []
  /**
   * LA VISÉE D'ARC DESSINÉE, par entité (radians) : `angle` = ce que la ligne montre,
   * `cible` = ce qu'elle rejoint — l'état du lissage réactif du télégraphe
   * (`visee-lissee.ts`). Purement visuel : rien ici n'entre dans une action, la sim ne le
   * voit jamais. Vidé dès qu'une corde se détend.
   *
   * `cible` n'est là que pour être LU par le harnais (même raison d'être qu'`enBande` :
   * le smoke lit l'état, il ne le fabrique pas). Recalculer la cible au moment du relevé
   * mesurerait autre chose — entre deux frames du banc (~333 ms), la caméra de visée a
   * glissé et le point de sol sous un curseur immobile a bougé : MESURÉ, 4,1° d'écart
   * fantôme après trois secondes de curseur posé. Les deux nombres doivent venir de la
   * MÊME frame ou l'on mesure la caméra.
   */
  private viseeLissee = new Map<number, { angle: number; cible: number }>()
  /** CE QUE CHACUN TIENT, et où il regarde — l'arme dessinée dans la main. */
  private hands: { id: number; kind: WeaponKind; fx: number; fy: number }[] = []
  /** LES JAUGES D'ABATTAGE du dernier snapshot : qui charge une frappe sur un arbre,
   *  et où en est la jauge (spec recolte-maitrise, verbe 1). */
  private fells: FellCharge[] = []
  private attackFx!: AttackFx
  private handWeapons!: HandWeapons
  /** LES TIRS ARMÉS au dernier snapshot (spec `tir.md` T3) — relevés à 20 Hz, jamais à la
   *  frame : un armement de trait dure 0,25 s et une frame lente l'enjambe en entier. */
  private tirsArmes = new Map<number, { dx: number; dy: number; portee: number; charged: boolean }>()
  /** Les traits PARTIS depuis la dernière frame, en attente d'être peints. */
  private tirsPartis: { id: number; dx: number; dy: number; portee: number; charged: boolean }[] = []
  /** Qui armait un coup à la frame précédente, et sa zone — pour savoir quand il PART. */
  private armes = new Map<
    number,
    { x: number; y: number; dx: number; dy: number; zone: Zone; charged: boolean; ranged: boolean; portee: number }
  >()
  /** DEV : dernière demande de TP consommée (horodatage de la carte) — évite de la rejouer. */
  private lastTeleportAt = 0
  /** Relief continu (Y-shear vertical) — source du rendu et du picking, créé au boot. */
  private warp!: Warp

  constructor() {
    super('world')
  }

  create(): void {
    // Origine PIEDS (R12) — indépendante de la texture, posée une fois ;
    // position/taille/depth viennent de `syncActor` à chaque frame.
    this.playerSprite = this.add.image(0, 0, 'spr-player').setOrigin(0.5, 1)
    // L'OMBRE DE CONTACT sous l'avatar : rattachée au sprite, `syncActor` la pose chaque frame
    // (même canal que les PNJ/bêtes). Le sprite du joueur ne meurt jamais — son ombre non plus.
    this.playerSprite.setData('shadow', createContactShadow(this))
    // LE REGARD (audit UI/UX P3-11) : le pion d'orientation, posé chaque frame au bord de
    // l'avatar du côté de son `facing`. Caché jusqu'au premier placement (sinon il naîtrait
    // en (0,0), au coin du monde).
    this.gaze = this.add.image(0, 0, 'fx-gaze').setOrigin(0.5, 0.5).setVisible(false)
    // LE SON : réveil au PREMIER geste (les navigateurs bloquent l'audio sans interaction),
    // et bascule du mute sur N (retenu d'une session à l'autre). Le son est un décor sobre.
    this.input.once('pointerdown', () => this.audioFx.resume())
    this.input.keyboard?.once('keydown', () => this.audioFx.resume())
    // LA TOUCHE VIENT DU JEU EFFECTIF, plus d'un `keydown-N` en dur : elle est réglable comme
    // les autres, et le message qui l'annonce cite CE que le joueur a mis, pas ce qu'on a livré.
    for (const nom of keymapEffectif().toggleMute) {
      const code = Phaser.Input.Keyboard.KeyCodes[nom as keyof typeof Phaser.Input.Keyboard.KeyCodes]
      if (code === undefined) continue
      this.input.keyboard?.addKey(code, false).on('down', () => {
        const muted = this.audioFx.toggleMute()
        const t = libelleTouche(nom)
        publishHint(this.registry, muted ? `Son coupé (${t}).` : `Son rétabli (${t}).`, this.time.now)
      })
    }
    // Le VOLUME maître (curseur du menu pause) : on publie l'état courant du moteur, et on
    // l'observe ensuite (le moteur vit ici ; le menu, dans UIScene, ne peut que poser la valeur).
    setHud(this.registry, 'audioVolume', this.audioFx.getVolume())
    this.lastAudioVolume = this.audioFx.getVolume()
    this.view = new SnapshotView(this)
    // LE CHAT DE PROXIMITÉ : Entrée ouvre la saisie, Entrée envoie, Échap annule. On
    // écoute le clavier au niveau caractère (comme le champ de craft) ; `chatTyping`
    // neutralise déplacement et raccourcis pendant qu'on tape. L'affichage (panneau +
    // historique) vit dans l'UIScene — pas de bulle au-dessus des têtes.
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => this.onChatKey(event))
    this.hitFx = new HitFx()
    // Le combat se voit : la lame qui s'arme, l'impact, et l'écran qui saigne.
    // Juste sous les overlays — au-dessus du monde, sous le HUD.
    this.attackFx = createAttackFx(this, OVERLAY_DEPTH - 10)
    // Sous le télégraphe : l'arme se pose SUR le corps, la zone se peint AU SOL.
    this.handWeapons = createHandWeapons(this, OVERLAY_DEPTH - 12)
    this.recolteFx = new RecolteFx(this)
    this.sprintFx = new SprintFx(this)
    this.chuteArbre = new ChuteArbre(this)
    this.view.setHitFx(this.hitFx) // elle seule dessine les nœuds : à elle le tressaillement
    this.view.setRecolteFx(this.recolteFx) // …et la gerbe d'éclats, qui a besoin des mêmes px
    this.view.setChuteArbre(this.chuteArbre) // …et la chute, qui a besoin de la MÊME tuile qu'avant la dérive
    this.reveilFx = new ReveilFx(this)
    this.view.setReveilFx(this.reveilFx) // …et le sol qui travaille, qui a besoin du TERRAIN de la tuile
    this.buildGhost = new BuildGhost(this)
    // LA FRONTIÈRE DE CONSTRUCTION SE VOIT (demande d'Alexis, 2026-08-04) : le liseré du
    // carré, le tapis de constructibilité et l'extinction du dehors — marteau en main.
    this.carreVillage = new CarreVillage(this)
    this.fellGauge = new FellGauge(this)
    this.flankGlow = new FlankGlow(this)

    const zoom = zoomForFraming(VISIBLE_TILES_TALL, TILE_PX, this.scale.height)
    this.cameras.main.setZoom(zoom)
    this.cameras.main.setBackgroundColor('#0f0b08') // fond chaud de la maquette (palette bg)
    // Le suivi ne démarre qu'une fois l'avatar posé au spawn (onReady) : `startFollow`
    // ancre la caméra sur la position COURANTE de la cible, et ici elle vaut (0, 0).

    // La vallée n'existe pas encore : UIScene ne montrera que son écran de
    // chargement tant que ce drapeau est faux (posé AVANT le lancement — un
    // rechargement à chaud pourrait sinon lui laisser un `true` périmé du monde
    // précédent, et le HUD paraîtrait sur du vide).
    setHud(this.registry, 'worldReady', false)
    // ET LE JOUEUR N'A PAS LA MAIN. Les bindings sont posés dès maintenant, mais devant
    // un écran de chargement une touche n'a aucun sens : elle partirait quand même à
    // l'hôte (qui, lui, obéit), ouvrirait le sac derrière le voile, ou peindrait un
    // message par-dessus la barre. On rend l'input à la dernière étape du montage.
    this.input.enabled = false
    if (this.input.keyboard) this.input.keyboard.enabled = false
    this.scene.launch('ui')

    // Les handlers lisent l'état à la frappe : on passe des ACCESSEURS.
    this.inputs = bindInputs(this, {
      sendAction: (action) => this.sendAction(action),
      predicted: () => this.predicted,
      playerId: () => this.playerId,
      structures: () => this.view.structures,
      nodes: () => this.view.nodes,
      corpses: () => this.view.corpses,
      // LES PILES AU SOL (spec chasse C18) : ce qu'on a jeté, et les flèches retombées
      // (`tir.md` T6). Elles étaient DÉJÀ dessinées et déjà dans le snapshot ; il ne
      // manquait que le fil jusqu'au geste qui les ramasse.
      piles: () => this.view.groundItems,
      // L'ACCUSÉ DE RÉCEPTION DU DÉCOCHAGE : ma charge telle que le dernier SNAPSHOT la
      // connaît. Tant qu'elle est là, la sim n'a pas vu l'`attack_release` — et rebander
      // l'écraserait (une seule action par tick).
      chargeEnCours: () => this.myCharging,
      // Les autres ENTITÉS vivantes pour le DON — SANS soi ni les monstres (la sim les
      // refuse de toute façon). Position LOGIQUE (tuiles), depuis le dernier snapshot.
      others: () => {
        const monsterIds = new Set(this.view.monsters.map((m) => m.entityId))
        return this.lastEntities
          .filter((e) => e.id !== this.playerId && e.hp > 0 && !monsterIds.has(e.id))
          // `wounds` accompagne la position : c'est ce qui permet de PANSER un tiers et pas
          // seulement de lui donner. Le snapshot les porte déjà — il ne manquait que le fil.
          .map((e) => ({ id: e.id, x: e.x, y: e.y, wounds: e.wounds }))
      },
      // TOUS LES CORPS, avec la silhouette qu'ils occupent VRAIMENT à l'écran — bêtes
      // comprises, cette fois : c'est la cible d'un coup, pas d'un don. La position
      // reste LOGIQUE (du snapshot), la silhouette est RENDUE (le sprite interpolé) :
      // on vise ce que l'œil montre, vers ce que la sim connaît (voir `visee-corps.ts`).
      corps: () =>
        this.lastEntities.flatMap((e) => {
          if (e.id === this.playerId || e.hp <= 0) return []
          const sprite = this.view.others.get(e.id)?.sprite
          if (!sprite) return []
          return [
            silhouetteDepuisSprite(e.id, e.x, e.y, sprite.x, sprite.y, sprite.displayWidth, sprite.displayHeight, TILE_PX),
          ]
        }),
      // Les handlers d'input sont posés dès `create`, mais `this.warp` n'existe
      // qu'après `onReady` (génération de carte). Avant, on renvoie le point plat :
      // de toute façon les actions sont des no-op sur structures/nodes vides.
      unproject: (px, py) => (this.warp ? this.warp.unproject(px, py) : { x: px, y: py }),
      simTick: () => this.lastSnapshotTick,
    })

    // Le mode debug (P) — DEV seulement : en prod la condition est statiquement
    // fausse, le bloc et l'import sont éliminés du bundle.
    if (import.meta.env.DEV) {
      const debugDeps = {
        sendAction: (action: PlayerAction) => this.sendAction(action),
        setSpeed: (factor: number) => this.send({ type: 'debug_speed', factor }),
        isNight: () => this.lastTime?.isNight ?? false,
      }
      bindDebugKeys(this, debugDeps)
      createDebugPanel(this, debugDeps) // les toggles cliquables (P) — remplacent F5, doublent F2-F4
    }

    // Hook de debug/pilotage (pattern __MANIF__) : smoke tests et futurs bots.
    // `audio` : les fonctions PURES du son, exposées pour la vérification hors-ligne
    // (OfflineAudioContext) — le SYSTÈME se contrôle même si l'esthétique se juge à l'oreille.
    ;(window as unknown as { __BRAISES__: unknown }).__BRAISES__ = { scene: this, audio: { buildSound, soundForEvent } }

    // L'aiguillage solo/multi vient de l'écran principal (`MenuScene`), par les `data`
    // de scène. « Seul le transport change » : le reste de la scène ne sait pas lequel
    // des deux parle. Lancement direct sans menu (smoke, deep-link absent) → on retombe
    // sur `VITE_SERVER_URL` (rétrocompat).
    const data = (this.scene.settings.data ?? {}) as WorldSceneData
    const serverUrl = data.mode === 'multi' ? data.url : data.mode === 'solo' ? undefined : import.meta.env.VITE_SERVER_URL
    // SOLO : quelle case, quelle seed. `MenuScene` les pose toujours (écran des mondes ou
    // deep-link) ; le repli — case 0, seed canonique — sert le lancement direct sans menu.
    this.slot = data.slot ?? 0
    this.serverUrl = serverUrl
    this.serverNom = SERVERS.find((e) => e.url === serverUrl)?.name ?? serverUrl ?? ''
    this.host = serverUrl
      ? createColyseusHost(serverUrl)
      : createWorkerHost({ slot: this.slot, seed: data.seed ?? VEILLEE_SEED, nom: data.nom ?? '' })
    // MULTI : les autres entités sont rendues ~100 ms en retard (tampon de gigue,
    // spec Tranche B) ; en solo on garde le tick de retard par défaut, ~0 latence.
    if (serverUrl) this.view.interpDelayMs = INTERP_DELAY_MULTI_MS
    this.host.onMessage((msg) => this.onHostMessage(msg))
    this.host.onError((message) => {
      // L'hôte est mort : plus AUCUN snapshot n'arrivera. Ce n'est pas une erreur de
      // jeu qu'on chasse au bout de trois secondes — c'est la fin de la partie. Elle
      // va sur le canal de RUPTURE, qui reste à l'écran et propose de recharger.
      setHud(this.registry, 'fatal', { reason: `hôte perdu : ${message}` })
    })

    // Onglet caché : le rAF de Phaser s'arrête mais PAS le timer du Worker —
    // sans pause, l'hôte répéterait le dernier input (avatar sans pilote) et
    // empilerait des snapshots. Veillée = solo : on fige le monde.
    // Onglet caché OU menu pause ouvert → l'hôte se fige (voir syncPause). On ne « reprend »
    // pas un monde qui n'a pas encore commencé : la dernière étape de montage le lance.
    const onVisibility = (): void => this.syncPause()
    document.addEventListener('visibilitychange', onVisibility)
    this.events.once('shutdown', () => {
      document.removeEventListener('visibilitychange', onVisibility)
      this.host.terminate()
      // CE QUI NE VIT PAS DANS LA LISTE D'AFFICHAGE, le shutdown de scène ne le détruit PAS :
      // les GameObjects tombent tout seuls, mais les TEXTURES appartiennent au gestionnaire du
      // JEU et lui survivent. Chacune de ces couches a un `destroy()` qui rend ses clés — il
      // n'était appelé nulle part, parce que jusqu'au 2026-07-29 aucune partie ne s'arrêtait
      // sans que la page entière ne meure avec elle. La deuxième Veillée retrouvait alors
      // « Texture key already in use: water-field » et rendait l'EAU DE LA VALLÉE PRÉCÉDENTE
      // (`water-layer`, seul à créer ses clés sans garde — les autres se réécrivent, mais
      // fuyaient un canvas par partie). Le scénario smoke `retour` surveille cette famille :
      // il échoue sur toute clé déjà prise, donc sur la couche qu'on oublierait ici demain.
      for (const couche of [
        this.nightVeil, this.water, this.combeMist, this.morningMist, this.mistBanks,
        this.fireFx, this.fireGround, this.poissons, this.feuilles, this.cendre,
      ]) couche?.destroy()
    })

    // La génération de la grande carte alpine prend quelques secondes côté worker.
    // L'attente est TENUE PAR UIScene (caméra neutre) : un texte à scrollFactor 0
    // dans la caméra zoomée d'ici ne serait cadré que par chance.
    this.send({ type: 'join', protocolVersion: PROTOCOL_VERSION })
  }

  /**
   * Le monde arrive de l'hôte (carte, calendrier, spawn) — mais on ne le MONTE pas
   * ici : on ne fait qu'aligner les étapes. Les monter d'un trait bloquait le thread
   * principal ~3 secondes (mesuré : bake de la texture de terrain, maillages du sol,
   * décor procédural…), et pendant ces 3 secondes l'écran de chargement était FIGÉ,
   * barre coincée. Découpées, elles se jouent une par frame (voir `pumpBuild`) : le
   * navigateur reprend la main entre chaque, la barre monte, le texte tourne.
   */
  /** LES COINS DE CHASSE (spec faune R17) — donnée de monde, reçue une fois. */
  grounds: { x: number; y: number }[] = []

  private onReady(msg: ReadyMessage): void {
    this.grounds = msg.grounds ?? []
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      // Rien ne sera jouable : on ne sait pas lire ce que cet hôte enverra. Rupture.
      setHud(this.registry, 'fatal', {
        reason: `protocole hôte v${msg.protocolVersion} ≠ client v${PROTOCOL_VERSION}`,
      })
      return
    }
    this.playerId = msg.playerId
    this.worldSeed = msg.seed
    // QUEL MONDE ON JOUE — pour les deux boutons d'UIScene qui en ont besoin : « rouvrir la
    // vallée » (stèle de fin de saison : même case, même seed) et « retour au menu principal ».
    setHud(this.registry, 'veillee', { slot: this.slot, seed: msg.seed })
    // LE SIGNET DE LA VALLÉE PARTAGÉE — « REPRENDRE » à l'accueil n'a que ça pour parler d'une
    // partie multi : le monde vit sur le serveur, pas sur ce disque (voir `derniere-partie.ts`).
    if (this.serverUrl) noteMulti(this.serverUrl, this.serverNom, Date.now())
    this.calendarScale = msg.calendarScale
    this.map = msg.map

    // LE BROUILLARD DE GUERRE (spec worldgen R19) : on relit ce que ce joueur a déjà arpenté DANS
    // CETTE VALLÉE-CI, ou on ouvre une carte vierge. L'estampille (seed + fondation) est ce qui
    // rattache un savoir à son monde : `depackBrouillard` rend un brouillard NEUF dès qu'elle ne
    // correspond pas — vallée refondée, monde régénéré après une sauvegarde illisible, ou hôte
    // qui ne nomme pas son monde. On redécouvre plutôt que d'afficher un savoir faux.
    // Il vit ici, côté client : aucune règle de jeu n'en dépend (voir l'en-tête de `fog`).
    this.mondeFog = msg.createdAt !== undefined ? { seed: msg.seed, neA: msg.createdAt } : undefined
    const memoire = this.mondeFog ? loadFog(this.slot) : null
    this.fog =
      memoire && this.mondeFog
        ? depackBrouillard(memoire, this.mondeFog, this.map.width, this.map.height)
        : creerBrouillard(this.map.width, this.map.height)
    setHud(this.registry, 'fog', this.fog)
    setHud(this.registry, 'fogVersion', 1)

    // LA CHRONIQUE REPRISE (persistance P1-6) : sur une reprise, l'hôte joint le récit déjà
    // vécu. On réamorce `eventLog` — mais on ne PUBLIE pas encore : les noms de village
    // arrivent avec le premier snapshot. On arme un forçage pour republier là (voir
    // `chronicleReseedPending`). Sur un monde neuf, `msg.chronicle` est absent : rien à faire.
    if (msg.chronicle && msg.chronicle.length > 0) {
      this.eventLog = msg.chronicle.slice(-EVENT_LOG_CAP)
      this.chronicleReseedPending = true
    }
    const worldW = this.map.width * TILE_PX
    const worldH = this.map.height * TILE_PX

    // L'ORDRE EST CELUI D'AVANT, à la ligne près : découper n'est pas réordonner.
    // Le `Record` typé par BUILD_PHASES est le garde-fou : ajouter une étape sans
    // l'annoncer (ou l'inverse) ne compile pas — la barre ne peut donc pas se
    // désaccorder en silence de ce qu'elle compte.
    const steps: Record<BuildPhase, () => void> = {
      relief: () => {
        // Carte PLATE (pivot RimWorld) : le warp est un no-op (lift ≡ 0, unproject ≡ identité). On
        // le garde pour ne pas churner les couches qui l'appellent ; il ne soulève plus rien.
        this.warp = createWarp()
        this.view.setWarp(this.warp)
      },
      // Terrain baké à 1 px/tuile (texture = map.width×map.height px, sous la limite
      // WebGL même pour une grande carte) puis étiré à la taille monde : les tuiles
      // étant des aplats, l'étirement NEAREST est pixel-identique au bake 16 px/tuile.
      bake: () => this.bakeMapTexture(),
      ground: () => {
        this.ground = new GroundLayer(this, this.map, this.warp, 'map-demo')
        this.ground.poserMatiere(this.worldSeed)
      },
      water: () => {
        // L'eau, par-dessus le sol : un shader qui défait le cisaillement du relief et
        // réfracte le fond (le bake `map-demo` lui sert de lit).
        const bootEau0 = performance.now()
        this.water = new WaterLayer(this, this.map, 'map-demo')
        this.view.rive = this.water.rive // une seule vérité de « où est l'eau » (eau-vivante R2)
        ensureEauFxTextures(this) // anneaux de flottaison, gerbe, empreinte — bakés une fois
        this.eauEvents = new EauEvents(this, (moi) => this.sonsEau.splash(moi, (sp, d2) => this.audioFx.play(sp, d2)))
        this.eauEvents.joueur = this.playerSprite
        this.view.eau = this.eauEvents
        if (this.water.rive) this.poissons = new PoissonsOmbres(this, this.map, this.water.flow, this.water.rive)
        // Le courant se voit (R15) — sur le champ PARTAGÉ avec le shader (source unique).
        this.feuilles = new FeuillesDerive(this, this.map, this.water.flow, this.water.rive)
        this.reflets = new RefletsLayer(this, this.map)
        this.view.reflets = this.reflets
        // LA SONDE A10 (eau-vivante) : le boot de l'eau se CHRONOMÈTRE, il ne s'affirme pas.
        this.bootEauMs = Math.round(performance.now() - bootEau0)
        this.cendre = new CendreLayer(this, this.map, String(this.map.width))
        this.cliffs = new CliffLayer(this, this.map)
      },
      pois: () => {
        this.pois = new PoiLayer(this, this.map, this.warp) // les lieux se voient enfin
        // Les BORNES qui annoncent les seuils (worldgen R21) et la brume de la Combe : du
        // décor dérivé de la carte (map.seuils, zone `combe_brumeuse`) — rien n'est deviné.
        this.bornes = new BorneLayer(this, this.map, this.warp)
        this.combeMist = new CombeMist(this, this.map)
        this.gueStones = new GueStones(this, this.map, this.warp)
        this.morningMist = new MorningMist(this, this.map) // la brume de l'aube naît de l'eau (da-feeling R13)
        this.mistBanks = new MistBanks(this, this.map) // les bancs voyageurs (V2) — nés des grandes eaux
        // LE PEUPLEMENT AVANT LES NŒUDS : la vue doit savoir sur quelle carte elle pose ses
        // arbres avant d'en dessiner un, sinon la première image sort en arbres ordinaires.
        this.view.setPeuplement(this.map, this.worldSeed)
        this.view.setNodes(msg.nodes)
      },
      clutter: () => {
        this.clutter = new ClutterLayer(this, this.map, this.worldSeed, this.warp)
      },
      world: () => {
        this.nightVeil = new NightVeil(this)
        this.fireFx = new FireFx(this)
        this.fireGround = new FireGroundGlow(this)
        this.dynLight = new DynamicLighting(this)
        this.ambientLife = new AmbientLife(this, (tx, ty) =>
          tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height ? -1 : (this.map.terrain[ty * this.map.width + tx] ?? -1),
        )
        this.cameras.main.setBounds(0, 0, worldW, worldH)
        this.prediction = createPrediction(msg.playerSpawn.x, msg.playerSpawn.y)
        this.view.syncActor(this.playerSprite, this.predicted.x, this.predicted.y, 'spr-player')
        // Bornes posées et avatar au spawn : le suivi peut s'ancrer sans panoramique.
        this.cameras.main.startFollow(this.playerSprite, true, 0.16, 0.16)
        // La carte plein écran (M, rendue par UIScene) a besoin de la carte : pour
        // la mettre à l'échelle et pour nommer la zone/POI sous le curseur.
        setHud(this.registry, 'mapData', this.map)
        this.worldReady = true
        // Le monde est debout (carte bakée, couches montées, avatar au spawn) : UIScene
        // peut lever son écran de chargement et découvrir le HUD. On le dit EN DERNIER —
        // le drapeau ne doit pas devancer ce qu'il annonce.
        setHud(this.registry, 'worldReady', true)
        // Le joueur reprend la main (elle lui était retirée pendant le montage), et
        // l'hôte peut ENFIN faire tourner le monde : il nous attendait (sim-worker).
        this.input.enabled = true
        if (this.input.keyboard) this.input.keyboard.enabled = true
        this.send({ type: 'resume' })
      },
    }
    this.buildQueue = BUILD_PHASES.map((p) => [p, steps[p]])
    this.publishBuildProgress() // la barre passe la main à l'étage client
  }

  /**
   * Une étape de montage par frame. Entre deux, le navigateur peint : c'est tout
   * l'objet du découpage. On ne pompe qu'une seule étape — deux d'affilée, et on
   * aurait re-fabriqué le gel qu'on vient de défaire.
   */
  private pumpBuild(): void {
    const step = this.buildQueue.shift()
    if (!step) return
    step[1]()
    this.publishBuildProgress()
  }

  /**
   * La barre, vue du client : les passes de l'hôte SUIVIES de nos étapes de montage.
   * On ne connaît pas le détail du ladder de l'hôte — juste son total (`hostPhases`,
   * lu de ses `progress`) : on ajoute le nôtre derrière. Le compte ne recule donc
   * jamais, et 100 % veut vraiment dire « le monde est debout ».
   */
  private publishBuildProgress(): void {
    const total = this.hostPhases + BUILD_STEPS
    setHud(this.registry, 'loadProgress', {
      phase: this.buildQueue[0]?.[0] ?? 'world',
      done: total - this.buildQueue.length,
      total,
    })
  }

  override update(time: number, deltaMs: number): void {
    // ON S'EN VA (retour au menu principal) : plus une ligne. `scene.start`/`stop` passent par la FILE
    // du gestionnaire de scènes, pas par un arrêt immédiat — cette scène peut donc encore être
    // steppée alors que sa liste d'affichage est déjà détruite, et le premier `setTexture` de
    // `setLighting` explose sur un GameObject sans scène (MESURÉ : c'est ce qui cassait le
    // scénario `retour` avant cette garde). On ne compte pas sur l'ordonnancement de Phaser :
    // on refuse de rendre dès l'instant où le départ est décidé.
    if (this.quitte) return
    // Le monde se monte encore : UNE étape, et on rend la main au navigateur (il a
    // un écran de chargement à peindre). Deux étapes d'affilée refabriqueraient le
    // gel qu'on cherche à défaire.
    if (this.buildQueue.length > 0) {
      this.pumpBuild()
      return
    }
    if (!this.worldReady) return
    // LES REFLETS (eau-vivante R13) : pool par frame — ouvert ici, servi par syncActor et
    // renderNodes au fil du tick, refermé en toute fin d'update (le surplus s'éteint).
    this.reflets?.begin()
    // LE BROUILLARD SE LÈVE SOUS LES PAS (spec worldgen R19). On dévoile autour de la position
    // PRÉDITE (celle qu'on voit, pas celle du dernier snapshot : le brouillard suit l'œil).
    // `revele` ne rend `true` que si du neuf est apparu — on ne prévient donc l'écran de carte
    // que dans ce cas, au lieu de le faire repeindre à chaque frame pour rien.
    if (this.fog && revele(this.fog, this.predicted.x, this.predicted.y, FOG_RAYON_TUILES)) {
      setHud(this.registry, 'fogVersion', (getHud(this.registry, 'fogVersion') ?? 0) + 1)
    }
    // LE MENU PAUSE (ESC) : quand `menuOpen` bascule (par ESC ou le bouton REPRENDRE), on
    // fige ou reprend l'hôte. Piloté en niveau (sur le changement), pas à chaque frame.
    const menuOpen = Boolean(getHud(this.registry, 'menuOpen'))
    if (menuOpen !== this.menuPaused) {
      this.menuPaused = menuOpen
      this.syncPause()
    }
    // QUITTER VERS LE MENU : UIScene pose la demande (menu pause), on la sert ici — c'est
    // nous qui tenons l'hôte, donc la sauvegarde. Le départ part sur le `saved` (voir plus haut).
    if (Boolean(getHud(this.registry, 'quitMondes')) && !this.quitEnCours) {
      this.quitEnCours = true
      this.quitDepuis = this.time.now
      this.send({ type: 'pause' }) // l'hôte ÉCRIT sur `pause` (sim-worker) — c'est la vraie prise
    }
    // Le garde-fou, EN NIVEAU et pas sur un front : une horloge headless saute, et un départ
    // qui DOIT partir ne se pilote pas sur un `delayedCall` qu'un saut peut enjamber.
    if (this.quitEnCours && this.time.now - this.quitDepuis >= QUIT_ATTENTE_MS) {
      this.quitEnCours = false
      this.quitterVersMondes()
    }
    // LE VOLUME : le curseur du menu pause pose `audioVolume` ; on l'applique au moteur (ici),
    // sur changement seulement (le moteur vit dans WorldScene, le curseur dans UIScene).
    const av = Number(getHud(this.registry, 'audioVolume') ?? 1)
    if (av !== this.lastAudioVolume) {
      this.lastAudioVolume = av
      this.audioFx.setVolume(av)
    }
    // LE MOMENT DE MORT (mort-suite 1+5) : fige la caméra, coupe l'input, snappe au
    // respawn sous le voile, rend la main à la fin — piloté ici, en niveau.
    this.tickDying()
    // LE TRAQUEUR DE DÉPOUILLE (mort-suite 2) : repère d'écran vers le sac tombé, republié
    // chaque frame (la caméra bouge). Rendu par UIScene (HUD non zoomé).
    this.publishCorpseHint()
    // Les gestes d'inventaire posés par UIScene (elle ne parle pas à l'hôte).
    for (const action of drainQueuedActions(this.registry)) this.sendAction(action)
    // Le clic MAINTENU : il récolte en boucle, à la cadence du rechargement. Coupé pendant
    // le voile de mort (input neutralisé) : rien ne s'arme ni ne s'émet tant qu'on tombe.
    if (!this.dying) this.inputs.tickHold()
    // CE QU'ON VISE, à chaque frame — le curseur bouge, le nœud s'épuise, et la
    // caméra glisse encore après la course : une visée figée mentirait aussitôt.
    const aim = this.inputs.aim(this.input.activePointer)
    const overlay = Boolean(getHud(this.registry, 'mapOpen')) || Boolean(getHud(this.registry, 'characterMenuOpen'))
    this.view.setAim(overlay ? null : aim.nodeId, aim.inRange)
    // CE QUE `F` PRENDRAIT SOUS LE CURSEUR (demande d'Alexis, 2026-08-03) → le contour blanc.
    // On ne résout RIEN ici : `interactTarget` est le résolveur de la touche elle-même, gardes
    // comprises (il rend `null` sous un overlay, le modal du feu compris — d'où l'absence de
    // `overlay` dans cette ligne, contrairement à la visée juste au-dessus).
    this.view.setInteractTarget(this.inputs.interactTarget(this.input.activePointer))
    // Le fantôme de pose VIRE AU VERT selon les VRAIES règles de pose (portée de
    // BÂTI, terrain, landmark) — pas la portée de bras `aim.inRange`, qui vaut pour
    // récolter, pas pour poser (sinon un feu posable à 3 tuiles s'affiche « perdu »).
    const placing = overlay ? null : this.inputs.placing()
    const edgeArme = getHud(this.registry, 'buildEdge') ?? EDGE_BITS[0]!
    // CE QUE LE MARTEAU DÉTRUIRAIT (décision d'Alexis, 2026-08-01) : le mode DÉMOLIR armé,
    // on surligne en rouge MA construction sous le curseur — la MÊME que le clic enverra
    // (`demolishTargetAt`, mêmes arguments : structures, tuile, arête armée, moi). Deux
    // résolutions différentes détruiraient ailleurs que là où on voit.
    const demolir = !overlay && getHud(this.registry, 'demolir') === true
    const curseur = demolir ? this.inputs.curseur(this.input.activePointer) : null
    const cible = curseur
      // Le levage du plan de toit, DÉRIVÉ (`MUR_HT / TILE_PX`) : le toit se vise où il se voit.
      ? demolishTargetAt(this.view.structures, curseur.x, curseur.y, this.playerId, MUR_HT / TILE_PX)
      : undefined
    this.view.setDemolishTarget(
      cible?.id ?? null,
      // La portée du BÂTI (6 tuiles), pas celle du bras : c'est celle que la sim exige pour
      // démolir. Hors d'elle, le surlignage se grise — l'action serait refusée.
      cible !== undefined &&
        (cible.tx + 0.5 - this.predicted.x) ** 2 + (cible.ty + 0.5 - this.predicted.y) ** 2 <=
          BALANCE.BUILD_RANGE * BALANCE.BUILD_RANGE,
    )
    this.buildGhost.update(
      placing,
      aim.tx,
      aim.ty,
      placing !== null && this.placeable(aim.tx, aim.ty, placing, edgeArme),
      this.view.structures,
      this.warp,
      edgeArme,
    )
    // LA FRONTIÈRE DU DOMAINE (demande d'Alexis, 2026-08-04). Elle s'allume au MARTEAU EN
    // MAIN — pas à la pièce armée : la question « jusqu'où puis-je bâtir ? » se pose avant
    // d'avoir choisi quoi poser. Le TAPIS, lui, attend la pièce (son verdict en dépend).
    //
    this.carreVillage.update({
      marteau: !overlay && getHud(this.registry, 'marteau') === true,
      village: this.monVillage(),
      placing,
      map: this.map,
      structures: this.view.structures,
      nodes: this.view.nodes,
      corps: this.lastEntities,
      camera: this.cameras.main,
    })
    // La jauge d'abattage flotte au-dessus de l'arbre qu'on charge (spec recolte-maitrise).
    this.fellGauge.update(this.fells, this.view.nodes, this.warp)
    // La lueur du bon flanc sur les rochers à portée — dimensionnée à MON niveau de minage,
    // et REFORMÉE au rythme du rechargement (le tempo se voit : terne au coup, brillante prête).
    const meNow = this.lastEntities.find((e) => e.id === this.playerId)
    const cooldownMs = (BALANCE.GATHER_COOLDOWN_TICKS / BALANCE.TICK_RATE_HZ) * 1000
    const readiness = (time - this.lastStrikeAt) / cooldownMs
    this.flankGlow.update(this.view.nodes, this.predicted, skillLevel(meNow?.skills.mining ?? 0), readiness, time, this.warp)
    // Les stations à portée : elles grisent (ou non) les vignettes du panneau de
    // craft. Miroir pur du client — la sim revalide tout, à l'enfilage et à chaque
    // tick (spec craft-file F7, F14).
    publishStationsInRange(this.registry, this.predicted, this.view.structures)
    // Un groupe de réfugiés à portée → la fenêtre à trois gestes (V2-25). Étouffée en overlay.
    publishRefugeesNearby(this.registry, this.predicted, overlay ? [] : this.view.refugeeGroups)
    // LE MODAL DU FEU (spec feu-station S17-S19) : un feu OUVERT (F) résout son état / combustible /
    // cuisson + le BOUTON contextuel « Fonder » / « Améliorer » — qui REMPLACENT les deux fenêtres
    // flottantes d'avant. Jamais étouffé par l'overlay : le modal EST l'overlay.
    publishOpenFire(
      this.registry,
      this.view.structures,
      this.view.villages,
      this.predicted,
      this.playerId,
      this.lastSnapshotTick,
      getHud(this.registry, 'inv') ?? [],
    )
    this.checkVitals()

    // LE COMBAT SE VOIT. Tout se redessine à chaque frame à partir du SNAPSHOT : la
    // zone qui va être frappée, la charge qui mûrit, l'arme qu'on tient. Rien n'est
    // anticipé au clic (invariant §3) — et rien n'est inventé : la forme de la zone
    // vient du `strike` que la sim transporte, sinon le télégraphe apprendrait une
    // règle qui n'existe pas.
    this.attackFx.beginFrame()
    const spriteOf = (id: number): Phaser.GameObjects.Image | null =>
      id === this.playerId ? this.playerSprite : (this.view.others.get(id)?.sprite ?? null)

    // LA CHARGE : le clic est enfoncé quelque part, et le coup mûrit. On peint la zone
    // qui partirait MAINTENANT — elle change de forme à maturité, et ce basculement
    // est le seul « c'est prêt » dont le joueur ait besoin.
    //
    // ET POUR L'ARC, LA LIGNE SE POSE AU LIEU DE SAUTER (demande d'Alexis, 2026-08-02) : la
    // direction du snapshot ne bouge qu'aux 100 ms de la re-visée, donc l'aiguille de seize
    // tuiles restait figée six frames puis basculait d'un bloc. On la fait REJOINDRE sa cible
    // par un lissage réactif (`visee-lissee.ts`) : les petits ajustements glissent, un
    // revirement claque. La MIENNE vise le curseur — c'est lui que `attack_release` enverra à
    // la sim, donc c'est lui la vérité du « si je relâchais maintenant » ; celle des autres
    // vise l'écho du snapshot, faute de mieux, et le lissage n'y efface que l'escalier.
    //
    // ⚠ La LONGUEUR de la ligne n'est PAS lissée : elle vaut la portée que la sim interpole
    // (`porteeBandee`), et c'est une promesse sur le point de chute — on ne la retarde pas.
    const visees = new Map<number, { dx: number; dy: number }>()
    for (const c of this.charges) {
      const sprite = spriteOf(c.id)
      if (!sprite) continue
      let dx = c.dx
      let dy = c.dy
      if (c.ranged) {
        const cible = c.id === this.playerId ? this.inputs.visee() : c
        const vers = Math.atan2(cible.dy, cible.dx)
        // À LA PREMIÈRE FRAME D'UNE BANDE, on part DE la cible : sinon chaque lever d'arc
        // ferait balayer la ligne depuis la direction d'un tir précédent, ou depuis l'est.
        const angle = suivreAngle(this.viseeLissee.get(c.id)?.angle ?? vers, vers, deltaMs)
        this.viseeLissee.set(c.id, { angle, cible: vers })
        dx = Math.cos(angle)
        dy = Math.sin(angle)
        visees.set(c.id, { dx, dy })
      }
      this.attackFx.charge(
        sprite.x,
        sprite.y - ANCRE_SOL_PX,
        dx,
        dy,
        c.ratio,
        zoneOf(c.strike),
        c.id === this.playerId,
        time,
        c.ranged,
        sprite, // c'est LE CORPS qui clignote (spec `tir.md` T2ter)
      )
    }
    // On n'entretient une visée lissée que tant que la corde est tendue : sans cet oubli, la
    // carte enflerait d'une entrée par archer croisé, et une corde reprise trois secondes plus
    // tard repartirait d'une direction périmée.
    for (const id of this.viseeLissee.keys()) if (!visees.has(id)) this.viseeLissee.delete(id)

    const encore = new Set<number>()
    for (const w of this.windups) {
      const sprite = spriteOf(w.id)
      if (!sprite) continue
      encore.add(w.id)
      const progress = Math.max(0, Math.min(1, 1 - w.ticksLeft / Math.max(1, w.strike.windupTicks)))
      const zone = zoneOf(w.strike)
      const ay = sprite.y - ANCRE_SOL_PX
      this.attackFx.telegraph(sprite.x, ay, w.dx, w.dy, progress, zone, w.id === this.playerId, w.side, w.charged, w.ranged)
      this.armes.set(w.id, { x: sprite.x, y: ay, dx: w.dx, dy: w.dy, zone, charged: w.charged, ranged: w.ranged, portee: w.strike.range * TILE_PX })
    }
    // UN WIND-UP QUI DISPARAÎT = LE COUP EST PARTI. La zone claque — y compris dans le
    // vide : un coup manqué coûte de l'endurance ET cloue sur place (récupération
    // punitive, spec R4). Le joueur doit le SENTIR.
    for (const [id, a] of this.armes) {
      if (encore.has(id)) continue
      // UN TIR NE CLAQUE PAS SA ZONE — il envoie un TRAIT, et il est peint plus bas, depuis
      // le relevé fait AU SNAPSHOT. Peindre le cône d'un arc bandé (onze tuiles, ±3°)
      // ferait clignoter une aiguille de 176 px en travers de l'écran : elle dirait « il a
      // tiré » aussi mal que possible, alors que la flèche le dit exactement.
      if (!a.ranged) this.attackFx.slash(a.x, a.y, a.dx, a.dy, a.zone, time, a.charged)
      this.armes.delete(id)
    }
    // LES TRAITS PARTIS DEPUIS LA DERNIÈRE FRAME (relevés au snapshot). On les peint depuis
    // la position du tireur MAINTENANT — sa flèche est déjà partie, mais l'œil attend qu'elle
    // sorte de l'arc qu'il voit, pas d'un fantôme de la frame d'avant.
    for (const t of this.tirsPartis) {
      const sprite = spriteOf(t.id)
      if (sprite) this.attackFx.trait(sprite.x, sprite.y - ANCRE_SOL_PX, t.dx, t.dy, t.portee, time, t.charged)
    }
    this.tirsPartis.length = 0
    this.attackFx.update(time)

    // LA GARDE SE VOIT (V0-1). Tout corps qui pare — le mien comme celui d'un PNJ ou
    // d'un ennemi — porte son arc d'acier, orienté par son `facing` autoritatif et
    // épousant le cône réellement protégé (120°). Depuis le SNAPSHOT (jamais du clic) :
    // `entity.blocking` est posé par la sim au tick, comme le reste du combat (§3).
    for (const e of this.lastEntities) {
      if (!e.blocking) continue
      const sprite = spriteOf(e.id)
      if (!sprite) continue
      this.attackFx.guard(sprite.x, sprite.y - ANCRE_SOL_PX, e.facing.x, e.facing.y)
    }

    // L'ARME EN MAIN, sur chaque corps : ce qui dit CE QUI PEUT arriver (hand-weapon.ts).
    this.handWeapons.render(
      this.hands.flatMap((h) => {
        const sprite = spriteOf(h.id)
        if (!sprite) return []
        // LA CORDE SE TEND AVEC LA MÊME JAUGE QUE LE TÉLÉGRAPHE (spec `tir.md` T2) : on
        // rebranche `charges` plutôt que de recompter la bande — deux comptes finiraient
        // par diverger, et c'est la corde que l'adversaire regarde pour savoir quand
        // s'abriter. Absent = arc au repos, corde molle.
        const draw = this.charges.find((c) => c.id === h.id)?.ratio
        // ET L'ARC SUIT LA MÊME LIGNE. Il s'oriente d'ordinaire sur le `facing` du snapshot —
        // mais pendant une bande, ce facing EST la direction de la charge (T2quater), donc il
        // saute aux mêmes 100 ms que le télégraphe. Une ligne qui glisse à côté d'un arc qui
        // cliquette se lit comme un défaut : les deux prennent la visée lissée.
        const v = visees.get(h.id)
        return [
          {
            x: sprite.x,
            y: sprite.y,
            fx: v?.dx ?? h.fx,
            fy: v?.dy ?? h.fy,
            kind: h.kind,
            ...(draw !== undefined ? { draw } : {}),
          },
        ]
      }),
    )

    this.ground.render(this.cameras.main)
    // LE VENT DE LA SIM (spec chasse C17) : le décor plie DANS SON SENS. C'est
    // la seule affordance de l'odorat — et elle doit exister, sans quoi la règle
    // « approcher sous le vent » serait une injustice invisible (C19).
    if (this.clutter) this.clutter.wind = this.view.wind
    // LE BÂTI GOMME LE DÉCOR (décision d'Alexis) : mur/sol effacent le décor de leur
    // tuile. On rafraîchit à chaque frame — pose et démolition rouvrent la tuile.
    this.clutter?.setBarriers(this.view.structures)
    this.clutter?.update(this.cameras.main, time) // le vent : le décor plie
    this.view.renderNodes(this.cameras.main, this.predicted.x, this.predicted.y, time)
    // LE CONTOUR DE L'INTERACTION — APRÈS la boucle de nœuds, et c'est un ORDRE : le pool des
    // nœuds se réattribue à chaque frame, et c'est cette boucle qui relève le sprite du nœud
    // survolé. Peint avant, le contour soulignerait la position d'hier.
    this.view.renderContourInteraction()
    // LA MÉMOIRE DES COUPS S'OUBLIE **APRÈS** LA BOUCLE DE NŒUDS, JAMAIS AVANT.
    //
    // Elle s'oubliait avant, et ça rendait le retour de frappe MUET dès que la frame
    // s'allongeait : la mémoire d'un coup ne vit que 220 ms, et une frame lente (le
    // rendu logiciel du smoke tourne à ~3 im/s, mais une simple hoquet suffit) la
    // purgeait AVANT que la boucle de nœuds ait eu sa seule chance de la lire. Le
    // tressaillement partait avec — un défaut ANTÉRIEUR aux éclats, que personne
    // n'avait vu parce que rien ne le regardait (aucun scénario ne pilotait une vraie
    // récolte jusqu'à l'écran). Dans cet ordre, tout coup reçu obtient exactement une
    // passe de rendu, quelle que soit la durée de la frame. Mesuré : `--scenario eclats`
    // ne voyait NAISSER aucune gerbe avant cette inversion, trois matières sur trois.
    this.hitFx.update(time)
    // APRÈS la boucle de nœuds : c'est elle qui vient d'y jeter les gerbes du coup reçu,
    // et les arbres qu'un dernier coup vient d'abattre.
    this.recolteFx.update(time, deltaMs)
    this.chuteArbre.update(time)
    // LA TERRE DU RÉVEIL vole, retombe et se pose (spec `cendreux.md` R21) — même horloge et
    // même `dt` borné que la gerbe de récolte : l'horloge headless saute.
    this.reveilFx.update(time, deltaMs)
    // LE SANG AU SOL (spec chasse C9) : la piste, et son horloge — les gouttes
    // fraîches sont vives, les vieilles pâlissent. C'est tout ce que le chasseur
    // a pour savoir s'il suit une bête ou un souvenir.
    this.view.renderBlood()
    // LES TERRIERS (spec chasse C16) : le trou EXISTE à l'écran, sans quoi le
    // lapin qui s'y engouffre s'évapore — et la géométrie de la chasse au lapin
    // (couper la ligne du terrier) resterait une règle invisible.
    this.view.renderBurrows(time)
    // LE SOL QUI TRAVAILLE (spec `cendreux.md` R14/R21) : le tertre enfle et se fend quatre
    // secondes avant que le Cendreux n'en sorte. C'est la contrepartie VISIBLE du
    // rapprochement à sept tuiles (R22) — sans elle, le mort poppait.
    this.view.renderReveils(time)
    // L'OVERLAY DES FONCTIONS (spec construction R22) : « Forge · N2 » au-dessus de
    // chaque amas reconnu, doré + ✦ quand l'enceinte donne son bonus.
    this.view.renderFunctions()
    if (this.lastTime) {
      const hour = this.lastTime.hourOfCycle
      this.cliffs.render(this.cameras.main) // les parois, auto-raccordées à la vue
      // LA CENDRE. Le client la RECALCULE du jour de saison — on ne lui transmet aucune tuile,
      // aucun état. Elle ne se recuit que quand le front a bougé, c'est-à-dire une fois par jour.
      //
      // Et elle mange les NŒUDS : sans cette ligne, le client dessinerait des arbres dans un pré
      // carbonisé, et le joueur s'y cognerait. Le protocole n'envoie jamais la disparition d'un
      // nœud (il ne transmet que les stocks) — mais il n'a pas à le faire : le client DÉRIVE.
      const front = avanceeDuFront(this.lastTime.seasonDay, this.map.cendreMax ?? 0)
      this.cendre.update(front)
      this.view.majCendre(this.map.cendre, this.map.width, front)
      // Les lieux ont besoin de savoir OÙ est le joueur (le nom grossit quand on
      // approche) et CE QU'IL CONNAÎT (on ne nomme pas un lieu qu'on n'a pas vu).
      this.pois.update(this.cameras.main, this.predicted.x, this.predicted.y, this.myKnownPois)
      // L'AIR DE LA ZONE — le second levier de la lisibilité, et le plus fort.
      //
      // Le monde ne change pas de couleur parce qu'on regarde ailleurs : il change parce qu'on est
      // ENTRÉ. La bascule se produit dans le couloir du seuil — c'est-à-dire exactement au moment
      // où le joueur doit comprendre qu'il vient de franchir une porte. C'est le geste de Valheim.
      //
      // L'air de la zone se pose PAR-DESSUS l'ambiance de l'heure : la nuit reste la nuit, mais la
      // nuit du Gouffre n'est pas celle des Prés Bas. On interpole d'une zone à l'autre pour que
      // la transition soit un fondu et non un clignotement — sur ~2 s, la durée d'un pas de seuil.
      const amb = ambientTint(hour)
      const cible = ambianceDe(zoneSlugAt(this.map, Math.floor(this.predicted.x), Math.floor(this.predicted.y))).air
      this.airCible = cible
      const k = Math.min(1, deltaMs / 900) // fondu ~0,9 s : on SENT le passage, on n'est pas ébloui
      this.airAlpha += (cible.alpha - this.airAlpha) * k
      this.airColor = lerpColor(this.airColor, cible.color, k)
      const day = daylight(hour)
      // Les Feux, résolus UNE fois : même `fireGlow` (seed/heure) pour la flaque au sol, le trou
      // du voile ET le reflet sur l'eau → les trois battent EN PHASE avec la flamme.
      const litFires = this.view.structures
        .filter((s) => s.type === 'fire')
        .map((s) => {
          const warmth = this.view.villages.find((vg) => vg.id === s.villageId)?.warmth ?? 0
          const g = fireGlow(warmth, day, time, s.id * 1.7)
          // La lueur suit l'ÉTAT du feu (spec feu-station S1/S3) : pleine allumé, faible en braises,
          // NULLE éteint — la flaque au sol, le trou du voile et le reflet sur l'eau s'éteignent ensemble.
          const st = fireStateAt(this.lastSnapshotTick, s)
          const factor = st === 'lit' ? 1 : st === 'ember' ? 0.4 : 0
          return { s, factor, g: { ...g, alpha: g.alpha * factor } }
        })
      // LES REMOUS (spec da-feeling R11) : qui MARCHE dans le haut-fond ? Suivi léger par
      // entité — la force s'éteint ~0,7 s après le dernier pas : un avatar immobile ne remue
      // pas l'eau, et les anneaux du dernier pas meurent d'eux-mêmes (critère A5).
      const waders: WaterWader[] = []
      const agitateurs: { x: number; y: number; force: number }[] = []
      const vue = this.cameras.main.worldView
      const vx0 = vue.x / TILE_PX - 3
      const vy0 = vue.y / TILE_PX - 3
      const vx1 = (vue.x + vue.width) / TILE_PX + 3
      const vy1 = (vue.y + vue.height) / TILE_PX + 3
      const vus = new Set<number>()
      for (const e of this.lastEntities) {
        vus.add(e.id)
        const moi = e.id === this.playerId && this.predicted
        const ex = moi ? this.predicted.x : e.x
        const ey = moi ? this.predicted.y : e.y
        const shallow = this.map.terrain[Math.floor(ey) * this.map.width + Math.floor(ex)] === TERRAIN_SHALLOW_WATER
        const prev = this.waderTrack.get(e.id)
        const bouge = prev !== undefined && (Math.abs(ex - prev.x) > 0.02 || Math.abs(ey - prev.y) > 0.02)
        const lastMove = shallow && bouge ? time : (prev?.lastMove ?? -1e9)
        // LE CAP DU SILLAGE (eau-vivante R6) : dérivé des positions, LISSÉ (le jitter
        // d'interpolation ne fait pas claquer le V) ; conservé à l'arrêt le temps que la
        // force meure — le sillage s'éteint en reculant, il ne pivote pas en rond.
        let dirX = prev?.dirX ?? 0
        let dirY = prev?.dirY ?? 0
        if (bouge && prev) {
          const ddx = ex - prev.x
          const ddy = ey - prev.y
          const n = Math.sqrt(ddx * ddx + ddy * ddy)
          if (n > 1e-6) {
            dirX += (ddx / n - dirX) * 0.35
            dirY += (ddy / n - dirY) * 0.35
            const nn = Math.sqrt(dirX * dirX + dirY * dirY)
            if (nn > 1e-6) {
              dirX /= nn
              dirY /= nn
            }
          }
        }
        const lastBouge = bouge ? time : (prev?.lastBouge ?? -1e9)
        this.waderTrack.set(e.id, { x: ex, y: ey, lastMove, lastBouge, dirX, dirY })
        // LA VÉGÉTATION FRÔLÉE (eau-vivante R16) : qui MARCHE écarte les brins qu'il
        // traverse. La poussée porte une FORCE continue (l'enveloppe des waders — revue :
        // l'appartenance binaire strobait à 20 Hz pour les bêtes et claquait à l'arrêt),
        // et le cap de 16 se sert APRÈS le filtre de vue (revue : des bêtes hors écran
        // volaient les slots des brins visibles).
        const forceAgit = Math.max(0, 1 - (time - lastBouge) / 500)
        if (
          forceAgit > 0 &&
          agitateurs.length < 16 &&
          ex >= vx0 &&
          ex <= vx1 &&
          ey >= vy0 &&
          ey <= vy1
        )
          agitateurs.push({ x: ex, y: ey, force: forceAgit })
        if (!shallow || waders.length >= 8) continue
        // PRIORITÉ À LA VUE (revue : 8 bêtes hors écran volaient les slots d'un cerf visible) —
        // un remous qu'on ne voit pas ne vaut aucun slot. Et le suivi, lui, couvre TOUT LE MONDE.
        if (ex < vx0 || ex > vx1 || ey < vy0 || ey > vy1) continue
        const force = Math.max(0, 1 - (time - lastMove) / 700)
        if (force <= 0) continue
        // Phase par identité : les anneaux de deux marcheurs ne battent pas ensemble.
        waders.push({ x: ex, y: ey, phase: (e.id % 97) * 0.211, strength: force, dirX, dirY })
      }
      // LA PURGE (revue : la Map croissait à vie — les ids sim sont monotones) : on oublie
      // toute entité sortie du snapshot.
      for (const id of this.waderTrack.keys()) {
        if (!vus.has(id)) this.waderTrack.delete(id)
      }
      this.lastWaderCount = waders.length // la sonde d'A5 (lue par le smoke)
      if (this.clutter) this.clutter.agitateurs = agitateurs
      this.water?.update(
        time,
        hour,
        day,
        // Portée du reflet un peu plus large que la lueur (comme le trou du voile déborde la flaque) ;
        // force = alpha de la lueur, déjà ∝ nuit → le reflet s'éteint tout seul de jour.
        litFires.map(({ s, g }) => ({ x: s.tx + 0.5, y: s.ty + 0.5, radius: g.radius * 2.3, strength: g.alpha })),
        waders,
        // Le chemin de l'astre est ancré à la CAMÉRA (le glitter est vue-dépendant, R12).
        { x: (vue.x + vue.width / 2) / TILE_PX, y: (vue.y + vue.height / 2) / TILE_PX },
      )
      // LE VENT LISSÉ porte toute la brume : cap de la sim rallié en ~15 s, force inventée —
      // jamais un saut, jamais un vecteur nul (vent-lisse.ts, diagnostic du 26/07).
      const vent = this.ventLisse.update(time, deltaMs, this.view.wind)
      this.morningMist?.update(time, hour, vent, day) // la marée : l'heure décide, le vent porte
      this.combeMist?.update(time, vent, day) // la combe garde son air, au quart du vent
      // LES BANCS VOYAGEURS (V2) : nés des grandes eaux autour de la caméra, ils dérivent
      // dans la bande des houppiers — devant un arbre, derrière l'autre.
      const centre = this.cameras.main.worldView
      this.mistBanks?.update(
        time,
        deltaMs,
        hour,
        vent,
        day,
        (centre.x + centre.width / 2) / TILE_PX,
        (centre.y + centre.height / 2) / TILE_PX,
      )
      this.aube.update(time, hour, (sp, d2) => this.audioFx.play(sp, d2)) // les oiseaux, fenêtre de l'aube
      // LES ÉVÉNEMENTS ET SONS DE L'EAU (eau-vivante R7-R8) : gerbes qui s'animent, traces
      // qui sèchent, patauge et clapotis pilotés par la position du joueur (champ de rive).
      this.eauEvents?.update(time)
      // LES POISSONS-OMBRES (R14) : ils errent sous la surface et fuient les entités.
      if (this.poissons) {
        const entites = this.lastEntities.map((e) =>
          e.id === this.playerId && this.predicted ? { x: this.predicted.x, y: this.predicted.y } : { x: e.x, y: e.y },
        )
        this.poissons.update(
          time,
          deltaMs,
          (centre.x + centre.width / 2) / TILE_PX,
          (centre.y + centre.height / 2) / TILE_PX,
          entites,
        )
      }
      // LES FEUILLES AU FIL DE L'EAU (R15) : elles dérivent vers l'aval, le vent chahute.
      this.feuilles?.update(
        time,
        deltaMs,
        (centre.x + centre.width / 2) / TILE_PX,
        (centre.y + centre.height / 2) / TILE_PX,
        vent,
      )
      if (this.water?.rive && this.predicted) {
        const dR = riveAt(this.water.rive, this.predicted.x, this.predicted.y + BALANCE.AVATAR_HITBOX_TILES / 2)
        const bouge =
          this.lastSonPos !== null &&
          (Math.abs(this.predicted.x - this.lastSonPos.x) > 0.008 ||
            Math.abs(this.predicted.y - this.lastSonPos.y) > 0.008)
        this.lastSonPos = { x: this.predicted.x, y: this.predicted.y }
        this.sonsEau.update(time, dR, bouge, (sp, d2) => this.audioFx.play(sp, d2))
      }
      this.fireFx?.update(this.view.structures, this.lastSnapshotTick, this.view.wind) // flammes/braises/fumée (∝ état), poussées par le vent
      // La chaleur du Feu au sol : cosmétique, ∝ nuit (voir world/fire-ground-glow.ts).
      this.fireGround?.update(this.view.structures, this.view.villages, day, time, this.lastSnapshotTick)
      // ÉCLAIRAGE DYNAMIQUE — le rendu PAR DÉFAUT (décision d'Alexis, docs/decisions.md 2026-07-24) :
      // il éclaire TOUS les sprites (couche 1) et pilote soleil/lune/Feux. Le flag n'existe (et n'est
      // posé) qu'en DEV, où le panneau P permet de l'ÉTEINDRE pour comparer avec l'ancien rendu à
      // plat ; absent (prod) → `?? true`, la lumière est allumée. Éteint = scène rendue « comme avant ».
      const lit = getHud(this.registry, 'debugLighting') ?? true
      this.view.lighting = lit
      if (this.clutter) this.clutter.lighting = lit
      this.pois.lighting = lit // le bloc erratique (couche POI cubique) suit le même toggle
      this.bornes?.setLighting(lit) // les bornes de seuil aussi (da-feeling R5)
      this.gueStones?.setLighting(lit) // et les dalles de gué (la revue a vu des dalles noires en OFF)
      // L'AVATAR bascule sur son _lit (R9 — un humain est un chip symétrique). Une fois par
      // changement de toggle : setTexture par frame réinitialiserait la frame pour rien.
      if (this.playerLit !== lit) {
        this.playerLit = lit
        this.playerSprite?.setTexture(lit ? 'spr-player_lit' : 'spr-player')
      }
      // Le voile descend SOUS les sprites quand ils sont éclairés (il ne tinte plus que le fond) ;
      // sinon il coiffe toute la scène. Et le Feu le CREUSE — sauf en mode éclairé, où la vraie
      // pipeline fait déjà la lumière (on ne troue pas deux fois).
      const ambientDepth = lit ? AMBIENT_DEPTH_LIT : AMBIENT_DEPTH
      // LA CLAIRIÈRE. Portée CONSTANTE (`fireHoleRadius` — décision Alexis 2026-08-03 : le trou
      // ne suit plus `fireGlow.radius`, qui double avec l'alignement et effaçait la nuit à
      // 25 tuiles ; l'engagement se lit à la flamme, que `warmthColor` teinte déjà). MÊME graine
      // et même `time` que le halo et la flaque → les trois battent EN PHASE. Le `factor` éteint
      // la clairière avec le foyer (braises atténuées, feu mort : rien).
      const veilFires = litFires.map(({ s, factor }) => ({
        worldX: (s.tx + 0.5) * TILE_PX,
        worldY: (s.ty + 0.5) * TILE_PX,
        radiusTiles: fireHoleRadius(time, s.id * 1.7) * factor,
      }))
      this.nightVeil?.update(
        { color: amb.color, alpha: amb.alpha },
        { color: this.airColor, alpha: this.airAlpha },
        veilFires,
        this.cameras.main,
        ambientDepth,
        // TOUJOURS creusé, y compris en mode éclairé : le SOL n'est pas sur la pipeline Light2D
        // (mesuré, le point-light ne lui apporte que ~+8 de rouge), donc personne d'autre ne lui
        // rend la nuit qu'il a prise. Le paramètre reste — le mode à plat, lui, n'a pas été
        // remesuré ; qui voudra le retirer devra d'abord le regarder.
        true,
      )
      this.dynLight?.update(lit, this.cameras.main, this.view.structures, this.view.villages, hour, day, time)
      // La vie ambiante : les oiseaux traversent, les lucioles ne sortent qu'à la nuit.
      this.ambientLife?.update(this.cameras.main, time / 1000, deltaMs / 1000, 1 - day)
    }

    // ON NE MARCHE PAS EN TAPANT. Le champ de recherche du panneau de craft prend
    // le clavier ; sans cette garde, écrire « hache » enverrait Z-A-H-E au
    // déplacement — le personnage partirait en courant pendant qu'on cherche.
    const typing = Boolean(getHud(this.registry, 'uiTyping')) || Boolean(getHud(this.registry, 'chatTyping'))
    const dx = typing ? 0 : this.axis('right', 'left')
    const dy = typing ? 0 : this.axis('down', 'up')
    const sprint = !typing && this.inputs.sprintKeys.some((k) => k.isDown)
    // LE PAS LENT (spec chasse C2) : il prime sur le sprint dans la sim — on
    // transmet les deux tels quels, c'est `speedScaleFor` qui arbitre.
    const sneak = !typing && this.inputs.sneakKeys.some((k) => k.isDown)
    // LA PARADE EST REVENUE (V0-1) : une STANCE maintenue (touche `block`, cf. keymap),
    // au même rang que le sprint et le pas lent — pas un verbe de ceinture. La sim, la
    // prédiction et `speedScaleFor` la connaissent depuis toujours ; on cesse enfin de
    // la forcer à `false`. Muette quand un champ de saisie a le clavier (on écrit).
    const block = !typing && this.inputs.blockKeys.some((k) => k.isDown)

    // Prédiction locale (spec reconciliation R1-R7). `predictFrame` consomme le
    // dt de frame en sous-pas de tick fixes (rejeu exact de la suite de dt du
    // serveur → pas de divergence de coin), numérote chaque input et le bufferise.
    // On transmet à l'hôte un `input` par tick consommé ; la réconciliation par
    // rejeu (dans `onHostMessage`) recalera l'ancre sur l'autorité.
    const world = this.predictionWorld()
    // LA formule de vitesse vient de /sim (`speedScaleFor`) : les conditions
    // d'endurance (sprint/blocage annulés à 0) sont prédites juste. Pendant
    // son propre wind-up, la sim immobilise — la prédiction gèle (scale 0).
    // LE POIDS ENTRE DANS LA VITESSE — et par la MÊME formule que la sim
    // (`speedScaleFor`, spec portage.md P10). Le client ne recopie rien : une
    // seconde formule divergerait au premier ajustement, et une divergence de
    // vitesse fait se téléporter l'avatar à chaque réconciliation.
    const carried = getHud(this.registry, 'inv') ?? []
    const { scale, sprinting } = speedScaleFor(
      {
        hunger: this.myHunger,
        wounds: this.myWounds,
        stamina: this.myStamina,
        exhausted: this.myExhausted,
        temperature: this.myTemperature,
        inventory: carried,
      },
      {
        sprint,
        block,
        moving: dx !== 0 || dy !== 0,
        charging: this.myCharging,
        sneak,
        // BANDER CHASSE LE PAS LENT (spec `tir.md` T2bis) — et la prédiction DOIT le
        // savoir : la vitesse d'un accroupi qui bande n'est pas celle d'un accroupi, et
        // une formule de vitesse qui diverge d'un cheveu fait se téléporter l'avatar à
        // chaque réconciliation. On lit la main comme la sim la lit.
        drawing: this.myCharging && isRangedWeapon(this.itemTenu() ?? 'unarmed'),
      },
    )
    const speedScale = this.myWindup ? 0 : scale
    // `sneak` n'entre pas dans PredictInput : la prédiction rejoue le
    // `speedScale` bufferisé, qui le contient déjà — mais l'HÔTE, lui, doit
    // savoir (l'allure décide du bruit, et la sim pose `Entity.gait`).
    const input: PredictInput = { dx, dy, sprint, block }
    for (const buffered of predictFrame(this.prediction, world, deltaMs / 1000, input, speedScale)) {
      this.send({ type: 'input', seq: buffered.seq, dx, dy, sprint, sneak, block })
    }
    // Rendu (R6-R7) : l'écart de correction résiduel fond chaque frame, puis le
    // sprite s'affiche à l'ancre extrapolée du reliquat sous-tick + cet écart —
    // fluide, sans latence, la sim restant exacte.
    decayRenderOffset(this.prediction, RENDER_OFFSET_DECAY)
    const render = renderPosition(this.prediction, world, input, speedScale)
    // La silhouette du rampeur se TASSE (spec chasse C19) — la sienne aussi :
    // le joueur doit SENTIR sa posture sans regarder une jauge.
    this.view.syncActor(this.playerSprite, render.x, render.y, 'spr-player', sneak)
    // LA COURSE SE VOIT (Alexis, 2026-08-01) — la foulée soulève le sol, le souffle qui
    // manque tasse la silhouette, et le mur la fait broncher. APRÈS `syncActor` : c'est
    // lui qui vient de poser les pieds (relief du warp compris), et c'est sa hauteur
    // d'affichage que le tassement corrige. La poussière est celle du SOL foulé — la
    // tourbière et la steppe ne lèvent pas la même chose.
    const solIdx = Math.floor(render.y) * this.map.width + Math.floor(render.x)
    const course = Math.hypot(dx, dy)
    const affaissement = this.sprintFx.frame({
      now: time,
      dtMs: deltaMs,
      x: this.playerSprite.x,
      y: this.playerSprite.y,
      // La direction de la COURSE, pas du regard : c'est le pas qui soulève la poussière.
      // Immobile (relâchement, bronchée), on garde le dernier cap plutôt qu'un vecteur
      // nul, qui enverrait la bouffée du mur dans un coin arbitraire.
      dirX: course > 0 ? dx / course : this.dernierCap.x,
      dirY: course > 0 ? dy / course : this.dernierCap.y,
      // `sprinting` vient de `speedScaleFor` — la formule de la SIM, celle-là même qui
      // refuse la course à bout de souffle ou trop chargé. Une seconde règle écrite ici
      // ferait fumer les pieds d'un porteur surchargé qui n'a pas le droit de courir.
      sprinting,
      stamina: this.myStamina,
      exhausted: this.myExhausted,
      // L'EAU N'EST PAS DU SOL. Au bord d'un lac la tuile sous les pieds est souvent de
      // l'eau peu profonde : la bouffée en sortait BLEUE (vu sur capture agrandie ×5) et
      // se lisait comme une éclaboussure, pas comme un pas. On retombe alors sur le ton
      // de poussière neutre — on ne devine jamais une couleur qui n'est pas un sol.
      teinteSol: WorldScene.EAU.has(this.map.terrain[solIdx] ?? 0)
        ? undefined
        : TERRAIN_COLORS[this.map.terrain[solIdx] ?? 0],
    })
    if (course > 0) this.dernierCap = { x: dx / course, y: dy / course }
    // Le tassement se pose SUR la hauteur que `syncActor` vient de calculer (emprise,
    // rampement compris) : on la corrige, on ne la remplace pas. L'origine du sprite est
    // aux pieds (0.5/1) — le coureur s'enfonce dans ses jambes, il ne flotte pas.
    if (affaissement > 0) {
      this.playerSprite.setDisplaySize(this.playerSprite.displayWidth, this.playerSprite.displayHeight * (1 - affaissement))
    }
    // LE REGARD (audit UI/UX P3-11) : on POSE le pion au bord de l'avatar, du côté du
    // `facing` autoritatif (la sim le règle sur le déplacement ET sur la visée d'attaque —
    // il dit donc « où je regarde », pas seulement « où je vais »). Sa position encode les
    // 8 directions sans faire basculer le billboard. Le facing est unitaire ; au repos il
    // garde sa dernière valeur — le pion ne disparaît jamais une fois posé.
    const me = this.lastEntities.find((e) => e.id === this.playerId)
    const f = me?.facing
    if (f) {
      const s = this.playerSprite
      const headY = s.y - s.displayHeight * 0.6 // haut du corps, pas les pieds (origine basse)
      this.gaze
        .setPosition(s.x + f.x * GAZE_REACH, headY + f.y * GAZE_REACH)
        .setDepth(s.depth + 0.1)
        .setDisplaySize(GAZE_PX, GAZE_PX)
        .setVisible(true)
    }

    // La tuile réellement sous le curseur (unproject), pas la projection plate —
    // elle nourrit la visée (`aim`, plus haut), la caméra de visée et le debug.
    const pointer = this.input.activePointer
    const pw = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2
    const groundPoint = this.warp.unproject(pw.x, pw.y)
    const gx = Math.floor(groundPoint.x / TILE_PX)
    const gy = Math.floor(groundPoint.y / TILE_PX)

    // DEV : exécute un TP demandé par la carte et nourrit l'overlay. Le corps vit
    // dans un module (pas une méthode) pour que la prod n'en garde rien — voir
    // l'en-tête de debug-overlay.ts.
    if (import.meta.env.DEV) {
      this.lastTeleportAt = syncDebug(this, {
        map: this.map,
        hover: { gx, gy },
        tick: this.lastSnapshotTick,
        lastTeleportAt: this.lastTeleportAt,
        sendAction: (action) => this.sendAction(action),
      })
    }

    // Interpolation des autres entités (R4) : vers le dernier snapshot, sur un tick.
    this.view.interpolate(this.time.now)
    // …ET LE RECUL SE PEINT PAR-DESSUS, jamais avant : `interpolate` vient de reposer la
    // position autoritative de chaque corps, et elle repasse à chaque frame. Un écart
    // appliqué plus haut (dans le bloc de combat) serait effacé dans la même frame — on
    // aurait un recul qui ne se voit pas, et l'on chercherait le défaut dans l'effet.
    this.attackFx.peindreRecul(this.time.now)
    // …ET LE CLIGNOTEMENT DE BANDE AVEC LUI, pour la même raison : `syncActor` vient de
    // reposer la teinte de chaque acteur. Un flash appliqué plus haut dans la frame était
    // effacé DANS la même frame — mesuré au banc, ΔL de 0 sur le torse de l'archer.
    this.attackFx.peindreBande()

    setHud(this.registry, 'zone', zoneAt(this.map, this.predicted.x, this.predicted.y)?.name)
    // Le marqueur « tu es ici » de la carte plein écran suit l'ancre autorité.
    setHud(this.registry, 'playerPos', { x: this.predicted.x, y: this.predicted.y })

    // Caméra « Foxhole » (R11) : SEULEMENT en visée (clic droit maintenu), le
    // point suivi se décale vers le curseur pour voir plus loin là où l'on vise.
    // Calcul en ÉCRAN-espace (écart au centre), jamais depuis la position monde
    // du pointeur → pas de boucle caméra↔curseur. Au relâchement, le lerp du
    // startFollow ramène la caméra en douceur (offset cible à zéro).
    const off = pointer.rightButtonDown()
      ? lookaheadOffset(
          pointer.x, pointer.y, this.scale.width / 2, this.scale.height / 2,
          LOOKAHEAD_STRENGTH, LOOKAHEAD_MAX_TILES, TILE_PX,
        )
      : { x: 0, y: 0 }
    // followOffset est SOUSTRAIT du point suivi → on nie pour pencher VERS le curseur.
    this.cameras.main.setFollowOffset(-off.x, -off.y)
    // Le pool de reflets se referme : tout miroir non servi cette frame s'éteint.
    this.reflets?.end()
  }

  /** Le clavier au niveau caractère, pour le chat. Entrée ouvre la ligne de saisie
   *  (si rien d'autre ne tape) ; pendant la saisie, chaque frappe va au message,
   *  Entrée l'envoie, Échap annule. Le PANNEAU (UIScene) affiche brouillon et historique. */
  private onChatKey(event: KeyboardEvent): void {
    if (this.chatDraft !== null) {
      if (event.key === 'Enter') {
        const text = this.chatDraft.trim()
        this.closeChatInput()
        if (text) {
          this.send({ type: 'chat', text })
          // ÉCHO LOCAL optimiste : on s'affiche tout de suite dans le panneau, sans attendre
          // le relais de l'hôte (les autres nous reçoivent par lui). On IGNORE ensuite le
          // renvoi de l'hôte pour soi (voir onHostMessage) — pas de doublon.
          this.appendChat(this.playerId, text, true)
        }
        return
      }
      if (event.key === 'Escape') {
        this.closeChatInput()
        return
      }
      if (event.key === 'Backspace') {
        this.setChatDraft(this.chatDraft.slice(0, -1))
        return
      }
      // Un seul caractère imprimable (les touches spéciales font `key.length > 1`).
      if (event.key.length === 1 && this.chatDraft.length < CHAT_MAX_LEN) {
        this.setChatDraft(this.chatDraft + event.key)
      }
      return
    }
    if (event.key === 'Enter' && !getHud(this.registry, 'uiTyping')) {
      this.setChatDraft('') // ouvre la ligne de saisie
      setHud(this.registry, 'chatTyping', true)
    }
  }

  private setChatDraft(draft: string): void {
    this.chatDraft = draft
    setHud(this.registry, 'chatDraft', draft)
  }

  private closeChatInput(): void {
    this.chatDraft = null
    setHud(this.registry, 'chatDraft', null)
    setHud(this.registry, 'chatTyping', false)
  }

  /** Ajoute une ligne à l'historique (borné) et le mirroie au registry pour l'UIScene. */
  private appendChat(from: number, text: string, self: boolean): void {
    this.chatLog.push({ from, text, self, at: this.time.now })
    if (this.chatLog.length > 60) this.chatLog.splice(0, this.chatLog.length - 60)
    setHud(this.registry, 'chatLog', this.chatLog)
  }

  private onHostMessage(msg: HostToClient): void {
    if (msg.type === 'ready') {
      this.onReady(msg)
      return
    }
    if (msg.type === 'chat') {
      // Un message ENTENDU (diffusé à tous) : on FILTRE par proximité ICI (chacun compare
      // sa position à celle de l'émetteur), puis on l'ajoute au panneau. On saute SON propre
      // message (déjà affiché à l'envoi par écho local) — pas de doublon.
      if (msg.from !== this.playerId) {
        const dx = msg.x - this.predicted.x
        const dy = msg.y - this.predicted.y
        if (dx * dx + dy * dy <= CHAT_RADIUS_TILES * CHAT_RADIUS_TILES) this.appendChat(msg.from, msg.text, false)
      }
      return
    }
    if (msg.type === 'saved') {
      // L'HÔTE A ÉCRIT (ou n'a pas pu) : on le porte au HUD. Aucun effet de jeu — mais savoir
      // que la veillée est à l'abri (et surtout savoir quand elle ne l'est PAS) vaut son pixel.
      // Le brouillard se range AU MÊME MOMENT que la partie : un seul geste de sauvegarde,
      // donc jamais un savoir géographique en avance ou en retard sur le monde qu'il décrit.
      // …ESTAMPILLÉ du monde qu'il décrit : la case ne suffit pas à nommer une vallée (on y
      // refonde), et sans ce nom la suivante s'ouvrirait avec la carte de celle-ci.
      if (this.fog && this.mondeFog && msg.ok) saveFog(this.slot, packBrouillard(this.fog, this.mondeFog))
      publishSaved(this.registry, msg.at, msg.ok, this.time.now)
      // QUITTER VERS LE MENU attendait CE message : la partie est au disque (ou l'hôte a
      // dit qu'il n'y arrivait pas — dans les deux cas, attendre plus ne sauvera rien de plus).
      if (this.quitEnCours) {
        this.quitEnCours = false
        this.quitterVersMondes()
      }
      return
    }
    if (msg.type === 'perf') {
      // SONDE DE DEV : on empile, on ne juge rien. La fenêtre est bornée (~10 min de jeu) —
      // une sonde qui fuit en mémoire serait une belle ironie dans un chantier sur les gels.
      this.perfSamples.push(msg)
      if (this.perfSamples.length > PERF_ECHANTILLONS_MAX) this.perfSamples.shift()
      return
    }
    if (msg.type === 'progress') {
      // L'hôte bâtit. On relaie son compte, mais SUR NOTRE TOTAL : ses passes, puis nos
      // étapes de montage. Sans ça, la barre atteindrait 100 % à la fin de sa besogne à
      // lui, et se figerait là pendant qu'on monte les couches (~3 s mesurées).
      this.hostPhases = msg.total
      setHud(this.registry, 'loadProgress', { phase: msg.phase, done: msg.done, total: msg.total + BUILD_STEPS })
      return
    }
    if (msg.type !== 'snapshot') return // type inconnu : futur protocole, on ignore
    // L'hôte tique déjà (il a envoyé son `ready`) alors que les couches se montent
    // encore, une par frame : ce snapshot n'a nulle part où s'afficher — le warp, les
    // nœuds, les sprites n'existent pas tous. On le JETTE ; le suivant est à 50 ms.
    if (!this.worldReady) return
    // Rejette les snapshots périmés ou hors ordre (garanti trivial sur Worker,
    // vital sur un vrai réseau).
    if (msg.tick <= this.lastSnapshotTick) return
    this.lastSnapshotTick = msg.tick

    const myVillage = msg.villages.find((v) => v.memberIds.includes(this.playerId))
    this.myVillageId = myVillage?.id ?? null
    // Mon Feu faiblit-il ? (conseil d'onboarding « nourris-le » — le geste feed_fire est câblé.)
    this.fireLow = myVillage ? myVillage.fuel < FIRE_UPKEEP.CAPACITY * ONBOARD_FIRE_LOW_FRAC : false
    publishTimeAndVillage(this.registry, msg.time, myVillage)
    this.lastTime = msg.time

    // Le monde d'abord : la réconciliation ci-dessous rejoue la prédiction
    // contre les structures/nœuds de CE snapshot, pas du précédent.
    this.view.apply(msg, this.playerId, this.time.now)
    // Le conteneur ouvert (loot) résolu contre CE snapshot : une dépouille vidée
    // s'efface (spec R16), ou le joueur s'en est éloigné hors de portée → le
    // panneau se referme au lieu de planter sur un id mort ou de rester fantôme.
    publishOpenContainer(this.registry, this.view.structures, this.view.corpses, this.predicted)
    this.processEvents(msg)
    this.updateCorpseTracker(msg)


    this.lastEntities = msg.entities
    // QUI ARME UN COUP, cette frame — moi comme les bêtes. Lu du snapshot, avec LA
    // FORME du coup : c'est elle que le télégraphe dessine, jamais un arc supposé.
    this.windups = msg.entities.flatMap((e) =>
      e.windup
        ? [
            {
              id: e.id,
              dx: e.windup.dx,
              dy: e.windup.dy,
              ticksLeft: e.windup.ticksLeft,
              strike: e.windup.strike,
              side: e.windup.side ?? 1,
              charged: e.windup.charged === true,
              ranged: e.windup.ranged === true,
            },
          ]
        : [],
    )
    // ═══ LE TRAIT SE DÉTECTE AU SNAPSHOT, PAS À LA FRAME ═══
    //
    // Le départ d'un coup se lisait jusqu'ici d'une frame à l'autre (`armes`) : on notait
    // qui armait, et l'on peignait quand le wind-up disparaissait. Ça tient pour la mêlée
    // (0,3 à 0,55 s d'armement) et ça CASSE pour le tir — MESURÉ au smoke : l'armement d'un
    // trait dure 0,25 s, et une frame lente (le rendu logiciel du banc tourne à ~3 im/s,
    // mais un simple hoquet suffit) enjambe le wind-up ENTIER. Le coup partait, la flèche
    // sortait du carquois et retombait au sol — et rien ne se voyait.
    //
    // Les snapshots, eux, arrivent à 20 Hz quoi qu'il arrive : c'est là que la disparition
    // se lit sans jamais être ratée. On empile ce qui est PARTI ; la prochaine frame le
    // peint depuis la position du sprite. (Même leçon que le timer en niveau plutôt qu'en
    // front : ce qui DOIT partir ne se pend pas à la cadence d'affichage.)
    for (const [id, w] of this.tirsArmes) {
      if (this.windups.some((x) => x.id === id)) continue
      this.tirsPartis.push({ id, ...w })
      this.tirsArmes.delete(id)
    }
    for (const w of this.windups) {
      if (w.ranged) this.tirsArmes.set(w.id, { dx: w.dx, dy: w.dy, portee: w.strike.range * TILE_PX, charged: w.charged })
    }
    // QUI CHARGE — et où en est son coup. `pendingStrike` (de /sim) répond à la seule
    // question qui compte : « qu'est-ce qui partirait s'il relâchait maintenant ? ».
    // C'est la sim qui tranche, pas une règle recopiée ici — la seule façon que la
    // forme peinte à l'écran soit CELLE qui frappera.
    this.charges = msg.entities.flatMap((e) => {
      if (!e.charge) return []
      const max = Math.max(1, weaponProfile(e).chargeTicks)
      return [
        {
          id: e.id,
          dx: e.charge.dx,
          dy: e.charge.dy,
          ratio: Math.min(1, e.charge.ticks / max),
          strike: pendingStrike(e),
          // UN ARC ne se lit pas comme une hache : sa forme ne CHANGE PAS à maturité
          // (un cône qui se resserre, pas un tourbillon), donc rien ne dit « c'est prêt »
          // sans un signal à part. Voir `attack-fx.charge`.
          ranged: isRangedWeapon(weaponKind(e)),
        },
      ]
    })
    // QUI CHARGE UNE FRAPPE D'ABATTAGE, cette frame (spec recolte-maitrise). Le vert
    // se dimensionne au niveau `woodcutting` de CHACUN — lu du snapshot, comme le reste.
    this.fells = msg.entities.flatMap((e) =>
      e.harvestCharge
        ? [{ nodeId: e.harvestCharge.nodeId, ticks: e.harvestCharge.ticks, level: skillLevel(e.skills.woodcutting ?? 0) }]
        : [],
    )
    // CE QUE CHACUN TIENT. Aucun ajout au protocole : le snapshot transporte déjà
    // l'`Entity` complète (sac + case active), donc `weaponKind` lit la main de
    // n'importe qui — la mienne comme celle du villageois d'en face.
    this.hands = msg.entities.flatMap((e) => {
      const kind = weaponKind(e)
      return kind === 'unarmed' ? [] : [{ id: e.id, kind, fx: e.facing.x, fy: e.facing.y }]
    })

    // Mon entité autoritative : jauges HUD + réconciliation de la prédiction.
    const me = msg.entities.find((e) => e.id === this.playerId)
    if (me) {
      publishPlayerVitals(this.registry, me)
      this.myKnownPois = me.knownPois
      this.myHunger = me.hunger
      this.myWounds = me.wounds
      this.myStamina = me.stamina
      // LE VERROU D'ÉPUISEMENT (spec combat R1ter) voyage dans le snapshot, et la
      // prédiction DOIT le lire : sans lui le client se croirait en train de courir
      // pendant que la sim le fait marcher, et la réconciliation téléporterait l'avatar
      // à chaque tick d'une course refusée.
      this.myExhausted = me.exhausted
      this.myTemperature = me.temperature
      this.myWindup = me.windup !== undefined
      this.myCharging = me.charge !== undefined
      this.myWeapon = weaponKind(me)
      this.reconcile(me, msg.lastProcessedInput)
      // UN VOISIN À PORTÉE D'UN DON : un PNJ d'un AUTRE village (ou de nul village mien),
      // assez proche pour qu'on puisse le NOURRIR — le seul signal du conseil « give »
      // (ui/onboarding). Purement client, aucun effet de jeu. On CESSE de scanner (O(npcs×
      // entités) par snapshot) dès que le conseil a été montré : il ne revient jamais, et
      // c'est le seul lecteur de `neighborNear` — inutile de le tenir à jour la saison durant.
      if (!this.shownHints.has('give-neighbor')) {
        const r2 = ONBOARD_NEIGHBOR_TILES * ONBOARD_NEIGHBOR_TILES
        this.neighborNear = msg.npcs.some((npc) => {
          if (this.myVillageId !== null && npc.villageId === this.myVillageId) return false
          const e = msg.entities.find((ent) => ent.id === npc.entityId)
          if (!e || e.hp <= 0) return false
          const dx = e.x - me.x
          const dy = e.y - me.y
          return dx * dx + dy * dy <= r2
        })
      }
    }
  }

  /** Événements du snapshot : erreurs/alarme pour MOI, chronique, marqueurs. */
  /**
   * LES AVERTISSEMENTS DU CORPS. Le jeu punit — il doit donc PRÉVENIR, et assez tôt
   * pour qu'on puisse encore agir. Deux crans par danger : un rappel discret quand
   * ça commence à mordre, une alerte quand ça tue. Chacun a son propre répit : une
   * alerte qui se répète à chaque frame n'est plus une alerte, c'est un décor.
   */
  private warnedAt: Record<string, number> = {}

  private warn(key: string, message: string, repitMs: number): void {
    const now = this.time.now
    if ((this.warnedAt[key] ?? -1e9) + repitMs > now) return
    this.warnedAt[key] = now
    publishError(this.registry, message, now)
  }

  /**
   * LES TROIS PHRASES DU DÉBUT. Un jeu exigeant DOIT dire ses règles — sinon il
   * n'est pas exigeant, il est obscur, et le joueur meurt sans savoir pourquoi.
   *
   * Trois, pas trente : le strict nécessaire pour ne pas mourir la première nuit.
   * Elles ne se répètent jamais (ce serait du bruit), et elles arrivent au moment
   * où elles servent — pas dans un mur de texte qu'on ferme sans lire.
   */
  /** L'arme qu'on tient (snapshot) — lue pour enseigner le combat au bon instant. */
  private myWeapon: WeaponKind = 'unarmed'
  /** Les conseils d'onboarding déjà montrés — aucun ne revient (voir ui/onboarding). */
  private readonly shownHints = new Set<OnboardingHintId>()
  /** Un étranger est-il à portée d'un don ? (recalculé à chaque snapshot, cf. plus haut) */
  private neighborNear = false
  /** Le combustible de MON Feu est-il bas ? (recalculé à chaque snapshot — conseil « nourris-le ») */
  private fireLow = false
  /** Le menu pause est-il ouvert ? (miroir de `menuOpen` — fige/reprend l'hôte, cf. syncPause) */
  private menuPaused = false
  /** SOLO — la case du disque que cette partie occupe (brouillard, sauvegarde, retour au menu). */
  private slot = 0
  /**
   * DE QUEL MONDE EST LE BROUILLARD qu'on relit et qu'on range — seed + date de fondation, dites
   * par l'hôte au `ready`. `undefined` quand l'hôte ne les dit pas (un serveur) : on joue alors
   * sur une carte vierge et on ne range rien, plutôt que d'ouvrir la vallée d'à côté avec le
   * savoir d'une Veillée solo.
   */
  private mondeFog: IdentiteMonde | undefined
  /** MULTI — l'adresse rejointe et son nom, pour le signet de « REPRENDRE ». Vides en solo. */
  private serverUrl: string | undefined
  private serverNom = ''
  /**
   * ON QUITTE VERS LES VALLÉES, et on attend que le disque ait fini.
   *
   * Recharger la page à l'instant du clic perdrait jusqu'à 30 s de jeu (la période de
   * l'autosave) : on demande d'abord une écriture (`pause`), et c'est le `saved` de l'hôte qui
   * déclenche le départ. `quitDepuis` borne l'attente — un hôte mort ne doit pas séquestrer le
   * joueur dans une partie qu'il a demandé à quitter.
   */
  private quitEnCours = false
  private quitDepuis = 0
  /** LE DÉPART EST ORDONNÉ : cette scène ne doit plus rien rendre (voir `quitterVersMondes`). */
  private quitte = false

  /**
   * REVENIR AU MENU PRINCIPAL — sans recharger la page (2026-07-29 ; ça coûtait ~1,9 s de boot
   * complet pour afficher un menu qui est du DOM pur).
   *
   * On rentre par l'ACCUEIL, pas par la liste des vallées (demande d'Alexis) : quitter une
   * Veillée ne veut pas dire qu'on va en ouvrir une autre.
   *
   * `scene.start` ARRÊTE cette scène : son `shutdown` part, donc `host.terminate()`. Le Worker
   * est donc mort avant que `MenuScene` ne se monte — c'est exactement ce qu'exige `clearSlot`
   * (voir `persistence-store.ts`), et ce que le rechargement obtenait à coups de masse.
   *
   * `ui` tourne EN PARALLÈLE (`scene.launch`) : `start` ne la couche pas, il faut le dire. Et
   * ce qui reste après nous — le registry du jeu, les instances de scène — est remis à neuf
   * par `MenuScene` (`resetHud` et `rafraichirScenesDeJeu`), qui est la seule à savoir qu'on
   * revient de quelque part.
   */
  private quitterVersMondes(): void {
    if (this.quitte) return
    this.quitte = true
    // LA BARRE D'ADRESSE SUIT — comme avant, quand on partait sur `pathname` nu. Ce n'est pas du
    // contrôle de flux (`MenuScene` consomme son deep-link une fois, elle ne relit pas l'URL) :
    // c'est que l'adresse ne doit plus dire « joue la case 3 » quand on vient de quitter la
    // case 3. Un F5 depuis le menu rouvre le menu, pas la partie.
    window.history.replaceState(null, '', window.location.pathname)
    this.scene.stop('ui')
    this.scene.start('menu')
  }
  /** Dernier volume appliqué au moteur audio — n'applique que sur changement (curseur du menu). */
  private lastAudioVolume = 1

  /**
   * FIGE ou REPREND l'hôte solo. Le monde doit être EN PAUSE si l'onglet est caché OU si le
   * menu pause (ESC) est ouvert — sinon l'hôte tourne sans pilote (avatar figé, snapshots
   * empilés). Idempotent côté Worker (start/stopTicker sont gardés) : on peut le rappeler.
   */
  private syncPause(): void {
    if (document.hidden || this.menuPaused) this.send({ type: 'pause' })
    else if (this.worldReady) this.send({ type: 'resume' }) // pas avant que les couches soient montées
  }

  /**
   * L'onboarding est PILOTÉ PAR L'ÉTAT (voir ui/onboarding) : on passe l'instantané du
   * jeu au résolveur pur, il rend le prochain conseil à dire — ou rien. Fini l'horloge
   * qui débitait « fais un feu » à qui en avait déjà un.
   */
  private checkHints(): void {
    const hint = nextOnboardingHint(
      {
        msAlive: this.time.now,
        hasFire: this.myVillageId !== null,
        fireLow: this.fireLow,
        hasWeapon: this.myWeapon !== 'unarmed',
        neighborNear: this.neighborNear,
      },
      this.shownHints,
    )
    if (!hint) return
    // LE CONSEIL, PAS L'ALERTE (audit UI/UX P2-7) : il ENSEIGNE — il passe donc par le
    // canal neutre, en haut, tenu longtemps. Le rouge du bas reste au refus et au danger :
    // on n'apprend pas à jouer sous une alarme d'échec.
    this.shownHints.add(hint.id)
    publishHint(this.registry, hint.text, this.time.now)
  }

  private checkVitals(): void {
    if (!getHud(this.registry, 'worldReady')) return
    this.checkHints()
    // LA FAIM TUE désormais : à 0, les PV fondent. On le dit, fort.
    if (this.myHunger <= 0) this.warn('famine', 'VOUS MOUREZ DE FAIM.', 6000)
    else if (this.myHunger < 25) this.warn('faim', 'La faim vous tenaille — il faut manger.', 45000)
    // Le froid tue aussi, et il tue plus vite qu'on ne le croit.
    if (this.myTemperature <= TEMPERATURE.HYPOTHERMIA) this.warn('gel', 'VOUS GELEZ. Trouvez un feu.', 6000)
    else if (this.myTemperature < 45) this.warn('froid', 'Le froid vous prend.', 45000)
  }

  /** Ce fait me concerne-t-il DIRECTEMENT (le « sur moi » du son) ? D'après le champ d'entité
   *  ou de village que porte l'événement — sinon c'est un son de MONDE (nuit, mort d'une bête). */
  private eventConcernsMe(e: SimEvent): boolean {
    const any = e as { entityId?: number; targetEntityId?: number; villageId?: number }
    if (any.entityId !== undefined) return any.entityId === this.playerId
    if (any.targetEntityId !== undefined) return any.targetEntityId === this.playerId
    if (any.villageId !== undefined) return any.villageId === this.myVillageId
    return false
  }

  private processEvents(msg: SnapshotMessage): void {
    // Une reprise a réamorcé `eventLog` mais n'a pas pu publier (pas de noms de village
    // avant ce premier snapshot) : on force UNE republication ici, puis on désarme.
    let chronicleDirty = this.chronicleReseedPending
    this.chronicleReseedPending = false
    // LES DEUX BATTANTS D'UNE PORTE DOUBLE GRINCENT D'UNE SEULE VOIX (R27) : `toggle_door` émet
    // un fait PAR VANTAIL qui change, donc un cadre apparié en émet deux au même tick. On ne joue
    // que le premier — deux oscillateurs identiques superposés ne font pas une seconde porte,
    // ils font la même porte trop fort. Seul le SON est dédoublonné : le battant, lui, pivote
    // par `structureId` (`porte-anim`), chacun le sien.
    let grincementTick = -1
    for (const event of msg.events) {
      // LE SON (échafaudage) : chaque fait de domaine peut sonner (table pure `soundForEvent`),
      // « sur moi » ou non selon l'entité concernée. Muet si coupé / contexte pas réveillé.
      const grincementDouble = event.type === 'door_toggled' && event.tick === grincementTick
      if (event.type === 'door_toggled') grincementTick = event.tick
      if (!grincementDouble) this.audioFx.play(soundForEvent(event, this.eventConcernsMe(event)))
      // LE BATTANT PIVOTE SUR LE FAIT (`door_toggled`), jamais sur la différence d'état — c'est
      // ce qui empêche tout un village de s'ouvrir en fanfare à la reconnexion. Il ne se déplie
      // PLUS ici : `SnapshotView.apply` le lit en tête, avant de peindre quoi que ce soit. D'ici,
      // on arrivait UN SNAPSHOT trop tard et la porte se montrait ouverte avant de s'ouvrir
      // (constaté par Alexis le 2026-07-30 ; le pourquoi est écrit sur `pousserPorte`).
      if (event.type === 'action_rejected' && event.entityId === this.playerId) {
        publishError(this.registry, event.reason, this.time.now)
      } else if (event.type === 'resource_harvested' && event.entityId === this.playerId) {
        // LE COUP A PORTÉ — et on ne le sait QUE parce que la sim le dit (G9). Rien
        // n'est affiché au clic : un « +1 bois » qui monte avant le refus de la sim
        // serait un mensonge, et le client n'a pas le droit de mentir (invariant §3).
        // Le nœud tressaille, ET la matière lui est arrachée — la gerbe part de la face
        // qui me fait FACE, d'où la position du récolteur (`playerSprite`, en px monde).
        // C'est `snapshot-view` qui l'émet : elle seule sait où le sprite du nœud est
        // réellement posé cette frame. Ici on ne fait que consigner le coup.
        this.hitFx.hit(
          event.nodeId,
          this.time.now,
          this.playerSprite.x,
          this.playerSprite.y,
          event.count,
          event.clean === true,
        )
        publishPickup(this.registry, event.item, event.count) // et le butin s'inscrit au HUD
        // LE TEMPO du minage : le dernier coup relance le rechargement, que la lueur du
        // bon flanc REFORME visiblement (verbe 2 — la cadence se voit, pas de timer caché).
        this.lastStrikeAt = this.time.now
      } else if (event.type === 'poi_discovered' && event.byEntityId === this.playerId) {
        // MONTER, C'EST VOIR (spec lieux.md) : un lieu qui révèle un RAYON dévoile aussi le
        // TERRAIN de ce rayon, pas seulement les pastilles. C'est ce qui referme la boucle
        // d'exploration — on repère un monument, on y va, et la carte s'ouvre autour de lui.
        // La sim reste seule juge de la découverte (elle a émis l'événement) ; le client ne
        // fait que lever SON brouillard, qui est un objet d'affichage (voir `fog`).
        const rayon = revealRadiusOf(event.kind)
        const lieu = this.map.zones[event.poiId]
        if (rayon > 0 && lieu && this.fog) {
          if (revele(this.fog, lieu.x + lieu.w / 2, lieu.y + lieu.h / 2, rayon)) {
            setHud(this.registry, 'fogVersion', (getHud(this.registry, 'fogVersion') ?? 0) + 1)
          }
        }
      } else if (event.type === 'item_crafted' && event.entityId === this.playerId) {
        // FABRIQUÉ (audit UI/UX P0) : la fabrication était l'une des deux boucles les plus
        // gratifiantes SANS aucun retour. On l'inscrit en bandeau à part (plus lourd qu'une
        // récolte). L'étincelle sur le corps n'est qu'un extra — souvent le sac est ouvert et
        // masque le monde ; le bandeau, lui, se voit à coup sûr. Sur l'event, jamais le clic.
        publishCraft(this.registry, event.item)
        this.attackFx.spark(this.playerSprite.x, this.playerSprite.y - 6, 0, false, this.time.now)
      } else if (event.type === 'skill_level_up' && event.entityId === this.playerId) {
        // NIVEAU (audit UI/UX P0) : franchir un palier de métier était muet. C'est le plus
        // rare et le plus gros des trois retours — un bandeau doré qui NOMME le métier et le
        // cran. La sim tient le niveau (`gainXp`), l'écran ne fait que l'annoncer (§3).
        publishLevelUp(this.registry, event.skill, event.level)
      } else if (event.type === 'entity_damaged') {
        // LE COUP A PORTÉ — et on ne le sait QUE parce que la sim le dit. Un coup
        // qui « part » à l'écran mais que la sim refuse serait un mensonge (G9) —
        // et EN MULTI, le jus des autres joueurs ne peut venir que de là : d'eux, on
        // ne reçoit que des événements.
        const now = this.time.now
        const onMe = event.entityId === this.playerId
        const cible = onMe ? this.playerSprite : (this.view.others.get(event.entityId)?.sprite ?? null)
        // D'OÙ LE COUP EST VENU : la gerbe part à l'opposé du frappeur (attack-fx).
        // `byEntityId` vaut 0 pour ce qui n'a pas d'auteur (un saignement qui achève) —
        // il n'y a alors ni frappeur ni axe, et la gerbe se tait.
        const frappeur =
          event.byEntityId === this.playerId
            ? this.playerSprite
            : (this.view.others.get(event.byEntityId)?.sprite ?? null)
        if (cible) {
          this.attackFx.impact(cible, now, frappeur?.x, frappeur?.y)
          this.attackFx.spark(cible.x, cible.y, event.amount, onMe, now, frappeur?.x, frappeur?.y)
        }
        if (onMe) {
          this.attackFx.hurt(now) // l'écran saigne…
          // …et la caméra encaisse. PUREMENT visuel : la position reste autoritative,
          // rien de ce qui suit ne touche la simulation (multi).
          this.cameras.main.shake(90, 0.006)
        } else if (event.byEntityId === this.playerId) {
          // MON COUP A PORTÉ. Une secousse BRÈVE et trois fois plus faible que celle
          // qu'on encaisse : elle doit confirmer le contact, jamais le disputer au coup
          // reçu — sinon frapper et être frappé se ressentent pareil, et la seule
          // information qui compte vraiment dans une mêlée (« qui prend ? ») se noie.
          this.cameras.main.shake(60, 0.002)
        }
      } else if (event.type === 'monster_slain') {
        // LA MISE À MORT claque : deux étincelles là où la bête est tombée. C'est le
        // seul retour qui dit « c'est fini » — sans lui, le loup disparaît, point.
        const tueur = this.view.others.get(event.byEntityId)?.sprite ?? this.playerSprite
        this.attackFx.spark(tueur.x, tueur.y - 6, 0, false, this.time.now)
      } else if (event.type === 'night_started') {
        // LA NUIT S'ANNONCE. C'est la règle la plus dure du jeu (loin d'un feu, on
        // est chassé) : elle doit être DITE, une fois, chaque soir. Une punition
        // qu'on n'a pas vue venir n'est pas une règle, c'est une injustice.
        publishError(this.registry, 'La nuit tombe. Loin d’un feu, on est chassé.', this.time.now)
      } else if (event.type === 'alarm_raised' && event.villageId === this.myVillageId) {
        publishAlarm(this.registry, this.time.now)
      } else if (event.type === 'wolf_howl' && event.targetEntityId === this.playerId) {
        // LE HURLEMENT (spec faune R13). C'est le seul avertissement que le joueur
        // recevra avant de voir la meute se placer autour de lui — et le GDD §9bis
        // en fait une règle : « annoncés, pas surprises ». Il passe par le canal
        // des erreurs faute d'audio (le son est acté « après GATE 1 ») : c'est un
        // pis-aller assumé, la vraie place de cette ligne est un cor dans le noir.
        const meute = event.packSize > 1 ? `${event.packSize} loups` : 'Un loup'
        publishError(this.registry, `Un hurlement, tout près. ${meute} vous ont choisi.`, this.time.now)
      } else if (event.type === 'cendreux_prowl' && event.targetEntityId === this.playerId) {
        // LE PENDANT DU HURLEMENT, pour les morts (spec `cendreux.md` R11). La nuit bascule
        // d'espèce avec les actes, et son avertissement bascule avec elle : le joueur doit
        // savoir CE QUI vient, parce qu'on ne distance pas un loup et qu'on distance un
        // Cendreux — la parade n'est pas la même.
        const combien = event.count > 1 ? `${event.count} Cendreux` : 'Un Cendreux'
        publishError(this.registry, `Un raclement dans le noir. ${combien} vous ont senti.`, this.time.now)
      } else if (event.type === 'cendreux_risen') {
        // IL SORT DE TERRE (spec `cendreux.md` R21). `cendreux_risen` a DEUX émetteurs — la
        // levée d'un cadavre, qui est déjà couché sur le sol et ne creuse rien, et
        // l'émergence d'un réveil. `emerger` les distingue sur le SITE (il rend `false` pour
        // la levée) : la sim n'a pas à porter un second nom pour un seul fait, et on ne
        // touche pas à /sim pour une question de rendu.
        this.reveilFx.emerger(event.x, event.y, event.entityId, this.time.now)
      } else if (event.type === 'reveil_etouffe') {
        // LE FEU A GAGNÉ (R21). Le tertre s'affaisse et se tait : c'est le RETOUR DE GESTE
        // du joueur qui a rallumé. Sans lui, « on veille ses morts au feu » n'aurait aucune
        // preuve à l'écran — la parade marcherait sans qu'on sache qu'elle a marché.
        this.reveilFx.etouffer(event.x, event.y, this.time.now)
      } else if (event.type === 'prey_escaped') {
        // LE LAPIN RENTRE CHEZ LUI (spec chasse C16). Il disparaît — mais le TROU,
        // lui, reste un moment : sans ça, la bête s'évaporerait et ce serait le
        // décor qui avoue. Le joueur doit VOIR où elle est passée, et comprendre
        // qu'il fallait couper la ligne. Purement visuel : la sim n'en sait rien.
        this.view.markEscape(event.x, event.y, this.time.now)
      } else if (event.type === 'entity_bandaged' && event.entityId === this.playerId) {
        // ON S'EST PANSÉ (V0-2) : le saignement cesse, une plaie se referme. Une
        // étincelle claire sur le corps le DIT — sinon la seule preuve serait
        // l'absence d'un dégât qu'on ne voyait pas venir. Le libellé de blessure du
        // HUD s'efface au même snapshot (hud-core) : le geste a un avant et un après.
        this.attackFx.spark(this.playerSprite.x, this.playerSprite.y - 6, 0, false, this.time.now)
      } else if (event.type === 'season_day_started') {
        // LE TÉLÉGRAPHE DE LA CENDRE (GDD §536) : la méga-horde de l'acte III est un fait
        // DÉTERMINISTE du calendrier — on l'annonce des jours à l'avance, sur le canal
        // d'alerte (c'est LE danger). Le couplage V0-9 a rendu cet acte observable ; sans
        // lui, ce préavis n'aurait jamais eu de nuit à annoncer.
        const cendre = cendreTelegraphForDay(event.day)
        if (cendre) publishError(this.registry, cendre, this.time.now)
      } else if (event.type === 'entity_died' && event.entityId === this.playerId) {
        // LE JOUEUR EST TOMBÉ (audit UI/UX P1) : on lève le voile de mort. La sim a
        // DÉJÀ fait respawn au Feu — ce n'est qu'un moment de présentation, il ne bloque
        // rien. On NOMME la chute (froid/faim/tueur), rappelle que le sac est resté sur
        // le corps, et rassure (compétences gardées). Le type du tueur vient du snapshot
        // (le monstre d'`byEntityId`), jamais recalculé (§3).
        const killer = msg.monsters.find((m) => m.entityId === event.byEntityId)
        // TRAQUEUR DE DÉPOUILLE (mort-suite 2+4) : le sac tombé ne crée un cadavre QUE si je
        // portais quelque chose. On lit l'inventaire d'AVANT la mort (`lastEntities`, encore
        // le snapshot précédent : `processEvents` tourne avant `this.lastEntities = …`). Mains
        // vides → pas de cadavre, pas de flèche, et le voile ne promet pas de dépouille.
        const preDeath = this.lastEntities.find((e) => e.id === this.playerId)
        const hadLoot = preDeath ? preDeath.inventory.some((s) => s !== null) : false
        publishDeath(this.registry, event.cause, event.byEntityId, killer?.type ?? null, hadLoot, this.time.now)
        // La sim a respawn au même tick : l'entité porte déjà son `deathCount` à jour (V2-21).
        // On le retient pour le bandeau de réveil (l'épuisement croissant, enfin lisible).
        this.dyingDeaths = msg.entities.find((e) => e.id === this.playerId)?.deathCount ?? 1
        // On note le lieu de la chute (`predicted` est ENCORE dessus, avant reconcile) pour
        // verrouiller MON cadavre au prochain snapshot, par proximité.
        this.myCorpseId = null
        this.corpseDeathPos = hadLoot ? { x: this.predicted.x, y: this.predicted.y } : null
        // …et on TIENT le moment (mort-suite 1+5). On est ici AVANT `reconcile` (l'ordre du
        // snapshot) : `this.predicted` — donc la caméra qui la suit — est ENCORE sur la
        // tuile de chute. On l'y fige avant que le respawn ne la fasse traverser la carte.
        this.enterDying()
      }
      if (CHRONICLE_EVENT_TYPES.has(event.type)) {
        this.eventLog.push(event)
        if (this.eventLog.length > EVENT_LOG_CAP) {
          this.eventLog.splice(0, this.eventLog.length - EVENT_LOG_CAP)
        }
        chronicleDirty = true
        if (event.type === 'evacuation_opened') {
          this.evacMarker?.destroy()
          this.evacMarker = this.add
            .circle(event.tx * TILE_PX + 8, event.ty * TILE_PX + 8, 10, 0xffd94a, 0.6)
            .setStrokeStyle(2, 0xfff2b0)
            .setDepth(OVERLAY_DEPTH)
          publishError(this.registry, 'Une arche s’est ouverte. Embarquez AVANT qu’elle ne lève l’ancre.', this.time.now)
        }
        if (event.type === 'ark_departed') {
          // L'ARCHE EST PARTIE (V2-24) : le marqueur disparaît, on le DIT (le train est passé).
          this.evacMarker?.destroy()
          this.evacMarker = null
          publishError(this.registry, event.saved > 0 ? `L’arche a levé l’ancre — ${event.saved} à bord.` : 'L’arche est partie. À vide.', this.time.now)
        }
        if (event.type === 'season_ended') {
          publishSeasonEnded(this.registry, event.verdicts, this.myVillageId)
          // La saison est finie : l'objectif d'évacuation n'a plus de sens.
          this.evacMarker?.destroy()
          this.evacMarker = null
        }
      }
    }
    if (chronicleDirty) {
      publishChronicle(this.registry, this.eventLog, this.calendarScale, msg.villages)
    }
  }

  /**
   * LE MOMENT DE MORT (mort-suite 1+5) : de la chute au réveil au Feu. On FIGE la caméra
   * là où elle est — sur la tuile de chute, où la dépouille va se poser — et on COUPE
   * l'input (on ne joue pas pendant qu'on tombe). Le respawn au Feu (un saut à travers la
   * carte) est neutralisé le temps que le voile devienne opaque, puis SNAPPÉ dessous
   * (`DEATH_FADE_MS`) : le saut ne se voit jamais. À la fin du voile, on rend la main et
   * la caméra reprend l'avatar, réveillé au Feu.
   */
  private enterDying(): void {
    this.dying = true
    this.dyingAt = this.time.now
    this.dyingSnapped = false
    this.cameras.main.stopFollow() // gèle la caméra sur la tuile de chute
    this.input.enabled = false // plus de clic (pas d'attaque en tombant)
    if (this.input.keyboard) this.input.keyboard.enabled = false // les touches gelées → input neutre
    // ABANDONNE tout geste maintenu : sans ça, une charge d'attaque en cours à la chute
    // (mourir face à un loup, cas fréquent) survivrait au voile — `input.enabled = false`
    // empêche le `pointerup`, donc `charging` resterait vrai — et cracherait un coup chargé
    // involontaire au réveil au Feu, peut-être sur un PNJ posté là.
    this.inputs.cancelHold()
  }

  /**
   * Les transitions du moment de mort, testées EN NIVEAU (voir `dying`). Appelé chaque
   * frame tant qu'on tombe : au passage du fondu opaque, on snappe la caméra au respawn
   * (caché) ; à la fin du voile, on rend la main. Robuste à un pas d'horloge qui bondit —
   * un seuil franchi reste franchi, là où un timer sur front raterait le saut.
   */
  private tickDying(): void {
    if (!this.dying) return
    const age = this.time.now - this.dyingAt
    if (!this.dyingSnapped && age >= DEATH_FADE_MS + 80) {
      // Sous le voile OPAQUE : on repose la caméra sur l'avatar (désormais au Feu) et on
      // reprend le suivi. Invisible — le voile couvre tout à cet instant.
      this.dyingSnapped = true
      this.recenterCamera()
      this.cameras.main.startFollow(this.playerSprite, true, 0.16, 0.16)
    }
    if (age >= DEATH_VEIL_MS) {
      // Fin du voile : le monde réapparaît au Feu, jouable — on rend la main.
      this.dying = false
      this.input.enabled = true
      if (this.input.keyboard) this.input.keyboard.enabled = true
      // LE RÉVEIL (mort-suite 3) : un mot au réveil au Feu, sur le canal conseil (neutre,
      // pas l'alerte). Il rend LISIBLE l'épuisement croissant de V2-21 — sinon un malus de
      // régén qu'on subit sans le comprendre. Mourir en série coûte plus ; survivre l'oublie.
      publishHint(
        this.registry,
        this.dyingDeaths > 1
          ? 'Réveil au Feu, plus épuisé qu’avant — mourir en série coûte cher. Tenez, et le corps oublie.'
          : 'Réveil au Feu : les jambes lourdes, mais vos mains savent encore. Reprenez souffle.',
        this.time.now,
      )
    }
  }

  /**
   * TRAQUEUR DE DÉPOUILLE (mort-suite 2) — verrouille MON cadavre au premier snapshot après
   * la chute (le plus proche du lieu de mort, en tuiles), puis le LÂCHE quand il disparaît
   * (fouillé ou décanté). Mains vides → `corpseDeathPos` était `null`, rien à verrouiller.
   */
  private updateCorpseTracker(msg: SnapshotMessage): void {
    if (this.corpseDeathPos && this.myCorpseId === null) {
      let bestId: number | null = null
      let bestD = 2.5 * 2.5 // tolérance ~2,5 tuiles² autour du lieu de chute
      for (const c of msg.corpses) {
        const dx = c.x - this.corpseDeathPos.x
        const dy = c.y - this.corpseDeathPos.y
        const d = dx * dx + dy * dy
        if (d <= bestD) {
          bestD = d
          bestId = c.id
        }
      }
      if (bestId !== null) {
        this.myCorpseId = bestId
        this.corpseDeathPos = null
      }
    }
    if (this.myCorpseId !== null && !msg.corpses.some((c) => c.id === this.myCorpseId)) {
      this.myCorpseId = null // fouillé ou décanté : plus rien à suivre
    }
  }

  /**
   * Publie le repère de dépouille à CHAQUE frame (la caméra bouge entre deux snapshots) :
   * position ÉCRAN de la flèche + angle + compte à rebours, ou `null`. UIScene le rend dans
   * son HUD NON zoomé (la caméra du monde, elle, est zoomée : un objet fixé à l'écran y serait
   * mis à l'échelle — d'où le calcul ici, le rendu là-bas).
   */
  private publishCorpseHint(): void {
    if (this.myCorpseId === null) return setHud(this.registry, 'corpseHint', null)
    const corpse = this.view.corpses.find((c) => c.id === this.myCorpseId)
    if (!corpse) return setHud(this.registry, 'corpseHint', null)
    const cam = this.cameras.main
    const hint = corpseArrow(
      this.predicted.x * TILE_PX,
      this.predicted.y * TILE_PX,
      corpse.x * TILE_PX,
      corpse.y * TILE_PX,
      cam.worldView,
      cam.width,
      cam.height,
    )
    setHud(this.registry, 'corpseHint', {
      onScreen: hint.onScreen,
      x: hint.x,
      y: hint.y,
      angle: hint.angle,
      secs: corpseSecondsLeft(corpse.decayAt, this.lastSnapshotTick, BALANCE.TICK_RATE_HZ),
    })
  }

  /**
   * La caméra suit l'avatar par lerp : sur un SAUT (TP de debug, respawn au Feu
   * d'un village lointain), elle traverserait la carte en glissant pendant des
   * secondes. Au-delà du seuil de snap, on la repose sèchement sur l'avatar.
   */
  private recenterCamera(): void {
    this.view.syncActor(this.playerSprite, this.predicted.x, this.predicted.y, 'spr-player')
    this.cameras.main.centerOn(this.playerSprite.x, this.playerSprite.y)
  }

  /** Le monde vu par la prédiction locale (collisions, vitesses). */
  private predictionWorld(): {
    map: WorldMap
    structures: SnapshotMessage['structures']
    nodes: ResourceNode[]
    moverVillageId: number | null
  } {
    return {
      map: this.map,
      structures: this.view.structures,
      nodes: this.view.nodes,
      moverVillageId: this.myVillageId,
    }
  }

  /**
   * Réconciliation par rejeu (spec reconciliation R3-R6) : purge les inputs
   * acquittés, pose l'ancre sur l'autorité et rejoue les inputs en attente. La
   * sim reste exacte ; l'écart de correction va dans `renderOffset` (lissé au
   * rendu), et au-delà du seuil de snap c'est un vrai téléport (respawn au Feu).
   */
  private reconcile(authoritative: Entity, lastProcessedInput: number): void {
    // Mesuré AVANT le rejeu : au-delà du seuil de snap, l'avatar n'a pas marché,
    // il a sauté (TP de debug, respawn) — la caméra doit sauter avec lui.
    const jumped =
      Math.abs(authoritative.x - this.predicted.x) > SNAP_DISTANCE_TILES ||
      Math.abs(authoritative.y - this.predicted.y) > SNAP_DISTANCE_TILES
    reconcilePrediction(
      this.prediction,
      this.predictionWorld(),
      { x: authoritative.x, y: authoritative.y },
      lastProcessedInput,
      SNAP_DISTANCE_TILES,
    )
    // Pendant le MOMENT DE MORT, le saut au respawn est VOULU caché : `enterDying` tient
    // la caméra et la snappera sous le voile opaque. On ne la recentre donc pas ici, sinon
    // le monde traverserait l'écran à la vue de tous, avant que le voile ne couvre.
    if (jumped && !this.dying) this.recenterCamera()
  }

  private axis(plus: 'right' | 'down', minus: 'left' | 'up'): -1 | 0 | 1 {
    const p = this.inputs.keys[plus].some((k) => k.isDown)
    const m = this.inputs.keys[minus].some((k) => k.isDown)
    if (p === m) return 0
    return p ? 1 : -1
  }

  private send(msg: ClientToHost): void {
    this.host.send(msg)
  }

  /**
   * CE QU'ON TIENT, tel que la sim le lirait — la ceinture, jamais le sac (spec
   * inventaire R8/R9). La borne de ceinture est revalidée ici comme `heldSlot` la
   * revalide dans /sim : sans elle, une case active hors ceinture ferait dire au client
   * qu'il tient une arme que la sim ne lui reconnaît pas.
   */
  private itemTenu(): ItemId | null {
    const inv = getHud(this.registry, 'inv') ?? []
    const slot = getHud(this.registry, 'activeSlot') ?? -1
    if (slot < 0 || slot >= SLOTS.BELT) return null
    return inv[slot]?.item ?? null
  }

  private sendAction(action: PlayerAction): void {
    this.send({ type: 'action', action })
  }

  /** Bake la carte statique en une texture (R8) — API generateTexture éprouvée dans Manif.
   *  La couleur d'une tuile = biome × grain (bruit par tuile). Le RELIEF n'est PLUS
   *  cuit ici : l'ombre du versant est dynamique (ShadeLayer, suit le soleil).
   *  Le facteur reste CONSTANT PAR TUILE : c'est ce qui autorise le bake à 1 px/tuile.
   *  Grain gardé faible (nearest) sinon le damier par tuile masque l'ombre.
   *
   *  LA MATIÈRE (2026-07-30, spec da-feeling §8) ajoute ici TROIS choses, la passe de grain
   *  elle-même vivant dans `ground-layer` :
   *  (a) une variation macro (fbm ~10 tuiles, ±6 %) qui casse l'aplat à l'échelle de l'écran ;
   *  (b) LE DAMIER DE LA FAMILLE à la place du damier global — sur un biome clair, ±3,5 % par
   *  tuile ne se lit pas comme de la matière mais comme une GRILLE de 16 px (R20) ;
   *  (c) LA COMPENSATION DU MULTIPLY. La passe de grain ne peut qu'assombrir — de 1 % sur la
   *  neige à 6,6 % sur le minéral. Sans contrepartie, la matière ferait foncer le monde en
   *  silence, inégalement selon le biome. Chaque tuile est donc relevée de
   *  `1 / moyenneFamille`, mesurée sur le bloc RÉELLEMENT cuit — une seule vérité, donc
   *  l'atlas et sa compensation ne peuvent pas diverger. */
  private bakeMapTexture(key = 'map-demo'): void {
    const { width, height } = this.map
    const N = width * height
    const g = this.add.graphics()
    // LE SOL PREND LA TEINTE DE SA ZONE — et c'est ce qui rend enfin le critère de lisibilité
    // du directeur de jeu (« d'un coup d'œil »). On ne REPEINT pas les terrains, on les MODULE :
    // l'herbe reste de l'herbe, mais celle de la Vieille Sylve est froide et sourde, celle des
    // Prés Bas chaude et haute. On reconnaît encore ce qu'on foule ; on sait juste où on le foule.
    //
    // Sans ça, aucune palette ne pouvait distinguer deux zones — les TERRAINS sont partagés (de
    // l'herbe pousse aux Prés Bas comme à la Combe aux Ruines).

    // ── PASSE 1 : la couleur de BIOME de chaque tuile (avant modulation de zone) ──
    // La forêt de la racine a son propre sol : une litière qui verdit dans les clairières.
    const br = new Uint8Array(N)
    const bg = new Uint8Array(N)
    const bb = new Uint8Array(N)
    const bio = new Uint8Array(N) // 1 = biome (participe au fondu), 0 = structurel (falaise, eau…)
    for (let i = 0; i < N; i++) {
      const terr = this.map.terrain[i] ?? 0
      const base = terr === TERRAIN_FOREST
        ? solForet(i % width, (i - (i % width)) / width, this.worldSeed)
        : (TERRAIN_COLORS[terr] ?? 0xff00ff)
      br[i] = (base >> 16) & 0xff
      bg[i] = (base >> 8) & 0xff
      bb[i] = base & 0xff
      bio[i] = BAKE_NON_BIOME.has(terr) ? 0 : 1
    }

    // ── PASSE 2 : une frontière de biome = UNE couleur de transition, sur UNE seule tuile de large
    // (demande d'Alexis, resserrée le 2026-07-20 ; l'ancien flou-boîte 3×3 étalait la limite sur une
    // bande dégradée). On ne peint la transition que d'UN côté : la tuile ne fond que vers ses
    // voisins d'un biome à id de terrain PLUS GRAND. Sur une frontière A|B, seul le côté au plus
    // petit id reçoit la médiane 50/50, l'autre reste pur → un trait d'une tuile, pas deux. Le grain
    // interne d'un même biome (litière de forêt) ne déclenche RIEN — on compare l'identité de
    // terrain, pas la couleur, sinon toute la forêt se voilerait. Les terrains STRUCTURELS (falaise,
    // eau, mur) gardent leur couleur pure : pas de halo gris au pied d'une paroi, et ils sont
    // recouverts par leurs propres couches. Puis modulation de zone + grain.
    const solParZone = new Map<string | undefined, readonly [number, number, number]>()

    // LE CHAMP DE LISIÈRE, calculé UNE fois à la maille de la grille de zones (~10 k cellules)
    // et non par tuile (~2,5 M) : un BFS multi-source, négligeable devant le bake lui-même.
    const zonePas = this.map.zonePas ?? 0
    const zoneGrid = this.map.zoneGrid
    const zoneDefs = this.map.zoneDefs
    const champ =
      zoneGrid && zonePas > 0 && zoneDefs
        ? champLisiere(zoneGrid, Math.ceil(width / zonePas), Math.ceil(height / zonePas), LISIERE_PORTEE)
        : undefined
    // La modulation d'un pays voisin, par id de zone — mémoïsée comme `solParZone`.
    const solVoisinCache = new Map<number, readonly [number, number, number] | undefined>()
    const solVoisinDe = zoneDefs
      ? (id: number): readonly [number, number, number] | undefined => {
          if (id < 0) return undefined
          const cached = solVoisinCache.get(id)
          if (cached !== undefined || solVoisinCache.has(id)) return cached
          const s = zoneDefs[id] ? ambianceDe(zoneDefs[id]!.slug).sol : undefined
          solVoisinCache.set(id, s)
          return s
        }
      : undefined
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const i = ty * width + tx
        let base: number
        if (!bio[i]) {
          base = (br[i]! << 16) | (bg[i]! << 8) | bb[i]! // structurel : couleur pure, aucun fondu
        } else {
          const terr = this.map.terrain[i] ?? 0
          let sr = 0, sg = 0, sb = 0, n = 0
          const near = [[tx - 1, ty], [tx + 1, ty], [tx, ty - 1], [tx, ty + 1]] as const
          for (const [x, y] of near) {
            if (x < 0 || y < 0 || x >= width || y >= height) continue
            const j = y * width + x
            if (!bio[j] || (this.map.terrain[j] ?? 0) <= terr) continue // seul le côté au plus petit id peint
            sr += br[j]!; sg += bg[j]!; sb += bb[j]!; n++
          }
          if (n === 0) {
            base = (br[i]! << 16) | (bg[i]! << 8) | bb[i]! // cœur de biome / côté « haut » : couleur pure
          } else {
            // Frontière : lerp vers la moyenne des biomes voisins, mais le taux ONDULE autour de
            // 50 % via un fbm2 basse fréquence (échelle ~8 tuiles, seed 1 pour ne pas corréler au
            // grain) → le trait serpente en larges ondulations douces plutôt qu'une couture nette.
            // ±17,5 % : intensité faible.
            const t = 0.5 + (fbm2(tx, ty, 8, 1) - 0.5) * 0.35
            const lerp = (a: number, b: number): number => Math.round(a + (b - a) * t)
            base = (lerp(br[i]!, sr / n) << 16) | (lerp(bg[i]!, sg / n) << 8) | lerp(bb[i]!, sb / n)
          }
        }

        const slug = zoneSlugAt(this.map, tx, ty)
        let sol = solParZone.get(slug)
        if (!sol) {
          sol = ambianceDe(slug).sol
          solParZone.set(slug, sol)
        }
        // LA LISIÈRE (R21) : près d'une frontière, la modulation du pays dérive vers celle du
        // pays d'en face — la forêt s'éclaircit AVANT la neige, l'éboulis annonce la pierre. Le
        // poids se lit dans le champ (maille de 16 tuiles) ; le GRAIN par tuile le tramé, sinon
        // la maille se verrait en bandes. Aucune tuile de terrain n'est touchée : c'est une
        // teinte, donc zéro effet sur les nœuds, la faune ou les villages.
        if (champ && solVoisinDe) {
          const cell = Math.min(champ.cols - 1, Math.floor(tx / zonePas)) +
            Math.min(champ.rows - 1, Math.floor(ty / zonePas)) * champ.cols
          const t = poidsLisiere(champ, cell, LISIERE_MAX) * (0.55 + 0.9 * hash2(tx, ty, 0x115132))
          if (t > 0.01) {
            const autre = solVoisinDe(champ.voisin[cell]!)
            if (autre) {
              sol = [
                sol[0] + (autre[0] - sol[0]) * t,
                sol[1] + (autre[1] - sol[1]) * t,
                sol[2] + (autre[2] - sol[2]) * t,
              ] as const
            }
          }
        }
        // LE FACTEUR DE LUMINANCE DE LA TUILE. Sans matière : le damier global, tel qu'il a
        // toujours été. Avec : le damier DE LA FAMILLE (MESURÉ — sur la neige, le damier global
        // se lisait comme une grille de 16 px et écrasait le grain sous-tuile), les taches
        // macro, et la contrepartie du MULTIPLY. Un seul chemin par cas, aucun facteur défait
        // après coup.
        const famille = bio[i] ? familleDe(this.map.terrain[i] ?? 0) : null
        let grain: number
        if (famille) {
          const d = profilDe(famille).damier // de moyenne 1 : aucune compensation propre
          grain = (1 - d / 2 + d * hash2(tx, ty)) / moyenneFamille(famille, this.worldSeed)
          // Les taches macro : la seconde échelle, celle qui se lit à l'écran entier.
          grain *= 1 + (fbm2(tx, ty, 10, 0x7ac3) - 0.5) * 0.12
        } else {
          // Aucune matière au-dessus (eau, falaise, mur, vide) : le damier historique, seul.
          grain = 0.96 + 0.07 * hash2(tx, ty)
        }
        const couleur = moduler(base, sol)
        if (famille) {
          // LE PLAFOND, ET IL PRÉSERVE LA TEINTE. MESURÉ le 2026-07-30 : la neige (0xeef2f8)
          // écrête DÉJÀ un canal sur 42 % de ses tuiles, et la matière portait ça à 70 %. Or
          // `shade` clampe canal par canal — le bleu bute avant le vert, le rouge jamais : les
          // taches macro s'y écrasent ET la neige vire au chaud. On borne donc le facteur au
          // plus grand qui ne fasse buter AUCUN canal : l'échelle reste uniforme, donc la
          // teinte est intacte. Ce qu'on y perd (≈ 1 % de compensation sur la neige seule) est
          // sans commune mesure avec une dérive de couleur sur 11 % de la carte.
          // (L'écrêtage PRÉEXISTANT du sol, lui, n'est pas touché : le corriger éclaircirait
          // le Névé, donc c'est un choix de direction artistique, à Alexis.)
          const maxCanal = Math.max((couleur >> 16) & 0xff, (couleur >> 8) & 0xff, couleur & 0xff)
          if (maxCanal > 0) grain = Math.min(grain, 255 / maxCanal)
        }
        g.fillStyle(shade(couleur, grain))
        g.fillRect(tx, ty, 1, 1) // 1 px/tuile — étiré à la taille monde par setDisplaySize
      }
    }
    g.generateTexture(key, width, height)
    g.destroy()
  }
}
