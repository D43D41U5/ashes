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
  COMBAT,
  CHRONICLE_EVENT_TYPES,
  NODE_DEFS,
  TEMPERATURE,
  TERRAIN_FOREST,
  terrainAt,
  terrainConstructible,
  createPrediction,
  decayRenderOffset,
  fbm2,
  SLOTS,
  hash2,
  isRangedWeapon,
  meteoSpeedFactorAt,
  meteoAspectAt,
  meteoColdAt,
  meteoIntensityAt,
  aspectAuPoint,
  aspectFroidDe,
  partDeNeige,
  ambientTemperature,
  baselineTemperature,
  cibleCorporelle,
  dehorsSansMeteo,
  estGele,
  neigeAuSol,
  niveauPourCouverture,
  predictFrame,
  reconcile as reconcilePrediction,
  renderPosition,
  pendingStrike,
  skillLevel,
  speedScaleFor,
  weaponKind,
  weaponProfile,
  zoneAt,
  toponymeAt,
  lieuAt,
  type Entity,
  type GameTime,
  type ItemId,
  type MeteoAspect,
  type PlayerAction,
  type PredictInput,
  type PredictionState,
  type ResourceNode,
  type SimEvent,
  type Structure,
  type Strike,
  type WeaponKind,
  type WorldMap,
  zoneSlugAt,
  PROTOCOL_VERSION,
  CHAT_MAX_LEN,
  CHAT_RADIUS_TILES,
  type ClientToHost,
  type HostToClient,
  type ReadyMessage,
  TERRAIN_CENDRE_PRE,
  tuileCendree,
  avanceesDepuisAges,
  fumerolleIci,
  fumerollesAutour,
  type SnapshotMessage,
  type PerfMessage,
  EDGE_BITS,
  edgeBarrierAt,
  floorAt,
  fullTileAt,
  noeudDefriche,
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
import { mainsLibres } from './world/mains-libres'
import { noteMulti } from '../derniere-partie'
import { SERVERS } from '../servers'
import { libelleTouche } from './world/touches'
import { getHud, setHud, type Placeable } from '../hud-state'
import {
  AMBIENT_DEPTH,
  AMBIENT_DEPTH_LIT,
  LIFT_TUILES,
  lookaheadOffset,
  OVERLAY_DEPTH,
  strateDeProfondeur,
  TILE_PX,
  VISIBLE_TILES_TALL,
  zoomForFraming,
} from '../render/framing'
import { deplierLeLift } from '../render/deplier-etage'
import { MUR_HT } from '../render/bati-art'
import { rafraichirCimes } from '../render/lit-trees'
import { cranDeSaison } from '../render/teinte-saison'
import { airSansLune, ambientTint, daylight, fireGlow, fireHoleRadius, flicker, heureCanonique, heureSolaire, lerpColor, lueurDeLune, multiplicateurDuVoile, partSansLune, plancherDeNuit, produitCouleurs, voileDeNuit, LUNE_PLEINE_JOUR } from '../render/lighting'
import { partDeNuitDesLucioles } from '../render/couvre-feu-lucioles'
import { createWarp, type Warp } from '../render/warp'
import { creerRelief, type Relief } from '../render/relief'
import { axesFeu } from '../render/feu-variante'
import {
  drainQueuedActions,
  publishAlarm,
  publishChronicle,
  publishCraft,
  publishError,
  publishHint,
  publishDeath,
  publishDecouverte,
  publishLevelUp,
  publishOpenFire,
  publishOpenContainer,
  publishPickup,
  publishPlayerVitals,
  publishSaved,
  publishSeasonEnded,
  publishStationsInRange,
  publishTimeAndVillage,
  KINDS_SANS_BANDEAU,
} from './world/hud-bridge'
import { ClutterLayer } from './world/clutter-layer'
import { TracesLayer } from './world/traces-layer'
import { familleDe, moyenneFamille, profilDe } from '../render/grain-sol'
import { GroundLayer } from './world/ground-layer'
import { PaveLayer } from './world/pave-layer'
import { ambianceDe, moduler } from '../render/zone-ambiance'
import { TERRAIN_COLORS } from '../render/terrain-colors'
import { contexteDesButtes, fondDeButte, tacheDeButte } from '../render/buttes'
import { CascadeFx } from './world/cascade-fx'
import { CliffLayer } from './world/cliff-layer'
import { EtageLayer } from './world/etage-layer'
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
import { AVANCE_S, intensiteEntendue, SonsDuCiel } from '../audio/meteo-audio'
import { riveAt } from '../render/water-field'
import { FumerolleFx } from './world/fumerolle-fx'
import { MorningMist } from './world/morning-mist'
import { FireFx } from './world/fire-fx'
import { FireGroundGlow } from './world/fire-ground-glow'
import { TorcheGroundGlow, type PorteurDeTorche } from './world/torche-ground-glow'
import { TORCHE_HOLE_FORCE, torcheHoleRadius } from '../render/torche'
import { createContactShadow } from './world/contact-shadow'
import { champLisiere, poidsLisiere, LISIERE_MAX, LISIERE_PORTEE } from '../render/ecotone'
import {
  creerBrouillard,
  depackBrouillard,
  estampilleCendre,
  FOG_RAYON_TUILES,
  loadFog,
  packBrouillard,
  revele,
  saveFog,
  type Brouillard,
  type IdentiteMonde,
} from '../render/fog'
import { peindreCarteArt, type CarteArt } from '../render/carte-art'
import { cellulesDuDisque, peindreSavoirRegion } from '../render/carte-savoir'
import { atteignableEntreEtages, etagesDuPas, niveauDuCorps, palierDuSol, TRACTION, eauPechable, estUnCoinDePeche, porteDeLEau, FISH_SPECIES, niveauDEau, torcheVive, partDeFlamme, clarteSurSoiAt, clarteDuCiel, partDuCiel, NUIT, MONSTER_DEFS, POI_CHARGES, TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER, CREUX, TERRAINS_BOISES_MASSIF, ventForceAt, VENT, type EtatVent } from '@ashes/sim'

/** L'assombrissement du sol au plafond de profondeur (§2quater R42) : au cœur d'un massif,
 *  le sol perd jusqu'à 14 % de luminance — en PENTE CONTINUE, jamais par bande. */
const PROFONDEUR_ASSOMBRIT = 0.14
/** La terre battue des coulées (forêts-vivantes §4) : un brun de sol nu, posé en alpha
 *  croissant vers l'eau — l'usure des pas qui convergent. */
const TERRE_BATTUE_COULEE = 0x7a6238
/** L'id de la sente (balance TERRAIN_ROAD = 2) — le décal de coulée s'interrompt dessus. */
const TERRAIN_ROAD_COULEE = 2

/**
 * Le rayon qu'un lieu dévoile, LU DANS LA TABLE DE LA SIM (`POI_CHARGES`) et jamais recopié :
 * une seconde source de vérité dériverait au premier réglage. 0 = ce lieu ne dévoile rien.
 */
function revealRadiusOf(kind: string): number {
  const charge = POI_CHARGES[kind]
  return charge && charge.devise === 'savoir' && charge.reveal === 'radius' ? charge.radiusTiles : 0
}
import { NightVeil } from './world/night-veil'
import { DynamicLighting, couleurDuCiel, deriveDOmbre, facteurDuFeu, forceDeLOmbre } from './world/dynamic-lighting'
import { WaterLayer, type WaterWader } from './world/water-layer'
import { flowAt } from '../render/flow-field'
import { AmbientLife } from './world/ambient-life'
import { FoudreFx } from './world/foudre-fx'
import { MeteoLayer } from './world/meteo-layer'
import { VentLayer } from './world/vent-layer'
import { GelLayer } from './world/gel-layer'
import { TUILE_GLACE_GUE, estNeige } from '../render/manteau'
import { creerEtatGel, majEtatGel, type EtatGel } from './world/etat-gel'
import { bindDebugKeys } from './world/debug-bindings'
import { createDebugPanel, type DebugPanel } from './world/debug-panel'
import { syncDebug } from './world/debug-overlay'
import { BuildGhost } from './world/build-ghost'
import { CarreVillage } from './world/carre-village'
import { FellGauge, type FellCharge } from './world/fell-gauge'
import { PecheFx, type LigneRendue } from './world/peche-fx'
import { FlankGlow } from './world/flank-glow'
import { HitFx } from './world/hit-fx'
import { RecolteFx } from './world/recolte-fx'
import { SprintFx } from './world/sprint-fx'
import { ChuteArbre } from './world/chute-arbre'
import { MurmureFx } from './world/murmure-fx'
import { ReveilFx } from './world/reveil-fx'
import { BRISURES_CENDRE, createAttackFx, type AttackFx, type Zone } from './world/attack-fx'
import { secousseDuCoup, SECOUSSE_PORTE_MS } from './world/encaissement'
import { SangFx } from './world/sang-fx'
import { createHandWeapons, type HandWeapons } from './world/hand-weapon'
import { bindInputs, type MovementBindings } from './world/input-bindings'
import { ciblesDesignees } from './world/cibles'
import { demolishTargetAt } from './world/aim'
import { GAZE_PX, GAZE_REACH, INTERP_DELAY_MULTI_MS, SnapshotView, type InterpolatedSprite } from './world/snapshot-view'
import { silhouetteDepuisSprite } from './world/visee-corps'
import { suivreAngle } from './world/visee-lissee'
import { corpseArrow, corpseSecondsLeft } from './world/corpse-arrow'
import { SoundEngine } from '../audio/engine'
import { INVENTAIRE } from '../audio/inventaire'
import { buildSound, filtreDeDoublons, soundForEvent } from '../audio/sound'
import { ChantsDeLAube } from '../audio/aube'
import themeAmbianceUrl from '../assets/audio/theme-ambiance.mp3'
import { dangerProche, ThemeAmbiance } from '../audio/musique'

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
  // LE CORPS DE LA CIBLE VOYAGE AVEC LA ZONE (2026-08-28) : c'est de lui que le télégraphe
  // tenait un mensonge. La sim résout sur la zone ÉLARGIE de ce rayon — portée ET angle
  // (R4quinquies) — et le dessin montrait la zone nominale : le coup portait HORS du
  // télégraphe, de +16 % (lance) à +36 % (poings) de surface. Voir `render/zone-frappe.ts`.
  corps: COMBAT.HIT_BODY_RADIUS * TILE_PX,
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
// LE REGARD (audit UI/UX P3-11) : `GAZE_REACH`/`GAZE_PX` vivent dans `snapshot-view` depuis que
// les Cendreux portent le même pion (R27) — un seul nombre pour l'avatar et les morts.

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

/** LE PAS DU CADRAN THERMIQUE (DEV) — quatre relevés par seconde de jeu. Un thermomètre se
 *  lit, il ne se filme pas ; et chaque relevé coûte un `baselineTemperature`, qui balaie les
 *  structures pour savoir si l'on est sous un toit. */
const THERMO_PAS_TICKS = Math.max(1, Math.round(BALANCE.TICK_RATE_HZ / 4))
/**
 * LE PAS DU RELEVÉ D'AIR de la barre haute — même cadence que le cadran thermique du debug,
 * et pour la même raison : `ambientTemperature` balaie les structures (les feux) et les zones
 * (les sources chaudes). Quatre fois par seconde de jeu suffisent largement à un nombre qui
 * bouge de moins d'un degré par jour — et qui doit malgré tout réagir vite quand on entre
 * dans la bulle d'un feu.
 */
const AIR_PAS_TICKS = THERMO_PAS_TICKS

/** LE SEUIL DU FRISSON (°C corporels) — mi-chemin de la rampe d'engourdissement, là où le
 *  bandeau « Le froid vous prend » se lève. Dérivé, jamais écrit : il suit les deux bornes. */
const SEUIL_FRISSON = (TEMPERATURE.CORPS_CONFORT + TEMPERATURE.CORPS_HYPOTHERMIE) / 2

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
// Le sol de la forêt est une LITIÈRE de feuilles PLUS OU MOINS MORTES (brun ↔ olive, selon un
// bruit fin) — et RIEN D'AUTRE : on reste sur du brun dans tout le biome.
//
// LE VERT DE CLAIRIÈRE EST RETIRÉ (Alexis, 2026-08-23). Il verdissait le sol au cœur des
// trouées, sur le champ des clairières que le semis d'arbres évidait. Deux défauts, l'un
// mesuré, l'autre tranché : (a) ce champ décide par MOTIF de 8 tuiles — porteur pour le SEMIS
// (un bloc est dégagé ou il ne l'est pas), mais peint en CARRÉS quand on en tire une couleur
// (MESURÉ sur le sol cuit : aplat à ±5 RGB dans le bloc, marches de 44 à 56 RGB pile aux
// multiples de 8, soit 432 px à l'écran) ; (b) même adouci en pente continue, le résultat
// reste des taches de couleur dans un biome qui doit se lire d'une seule matière.
const LITIERE_BRUN = 0x6b5730 // feuille bien morte
const LITIERE_OLIVE = 0x5c5e38 // feuille à demi morte (il reste du vert)

/** La couleur du sol forestier d'une tuile : la litière, du brun mort au brun-olive. */
function solForet(tx: number, ty: number, seed: number): number {
  const litter = fbm2(tx, ty, 6, (seed ^ 0x1eaf) | 0) // grain de litière, fin
  return lerpColor(LITIERE_BRUN, LITIERE_OLIVE, litter)
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
  /** Les gouttes, la brume et la lueur au pied des cascades (T-A9) — sur `cliffs.chutes`. */
  private cascadeFx: CascadeFx | null = null
  /** La chaleur du Feu tombée au sol — cosmétique, cf. world/fire-ground-glow.ts. */
  private fireGround: FireGroundGlow | null = null
  /** La lumière de la torche tombée au sol — le MÊME rôle, mais elle marche (spec `torche.md`). */
  private torcheGround: TorcheGroundGlow | null = null
  /** ESSAI éclairage dynamique (decisions.md 2026-07-20) : soleil + Feux normal-mappés,
   *  armés par le toggle debug F5. Inerte tant que le flag est éteint. */
  private dynLight: DynamicLighting | null = null
  private water: WaterLayer | null = null
  /** Oiseaux et lucioles — décor pur, hors sim (voir world/ambient-life.ts). */
  ambientLife: AmbientLife | null = null
  /** LES CINQ CIELS (spec meteo.md) — la bande du front, peinte. Publique : le smoke lit sa
   *  sonde d'intensité, et un rendu se juge sur ce qu'il montre. */
  meteoLayer: MeteoLayer | null = null
  /** LES SERPENTINS DU VENT (spec `vent.md` V9) — le présage, quand un front approche. */
  ventLayer: VentLayer | null = null
  /** La part de souffle AU POINT DU JOUEUR, au-dessus de l'ambiance : 0 au calme, 1 au cœur
   *  d'une bande. Relevée avec le reste du vent, à chaque image (une lecture de `ventForceAt`,
   *  sans garde de cadence — contrairement au thermo, qui balaie plus large). */
  private ventPartIci = 0
  /** LA FOUDRE (R8) — le télégraphe au sol, puis l'éclair. Publique, même raison. */
  foudreFx: FoudreFx | null = null
  /** LE PAYSAGE GELÉ (spec gel.md G5/G7) — la neige au sol et la glace. Publique : le smoke
   *  lit sa sonde de couverture, et un rendu se juge sur ce qu'il montre. */
  gelLayer: GelLayer | null = null
  /** LA FAÇADE D'ÉTAT que les fonctions de gel de /sim attendent — allouée une fois, remise
   *  à jour en place (voir `etat-gel.ts`, qui nomme aussi ce que le snapshot ne porte pas). */
  private etatGel: EtatGel | null = null
  /** LA FAÇADE DU VENT (spec `vent.md`) — les sept champs que ses lois lisent, réutilisés d'un
   *  relevé à l'autre. Le client lit LES MÊMES fonctions que la sim : une seconde formule ici
   *  aurait divergé au premier calibrage, comme la rampe de pluie avant elle. */
  private ventFacade: EtatVent = {
    tick: 0, map: null as never, wind: { x: 1, y: 0 }, calendarScale: 1, jourDeDepart: 1, meteo: null, meteoActive: true,
  }
  /**
   * LE CIEL DU FRONT (spec `meteo.md` R14) — la façade que le rideau reçoit : les DEUX aspects
   * d'un même front et de quoi lire la part de flocons en n'importe quel point. `mesure` est
   * LA loi de `/sim` (`partDeNeige` sur `dehorsSansMeteo`), jamais une copie ; la couche s'occupe
   * de l'échantillonner et de la lisser. Allouée UNE fois — la fermeture aussi : une fermeture
   * neuve par image serait du déchet pur sur un chemin appelé soixante fois par seconde.
   */
  private readonly cielFacade: { doux: MeteoAspect; froid: MeteoAspect | null; mesure: (x: number, y: number) => number } = {
    doux: 'pluie',
    froid: null,
    mesure: (x: number, y: number) => {
      const etat = this.etatGel
      const t = this.lastTime
      if (!etat || !t) return 0
      return partDeNeige(dehorsSansMeteo(etat, x, y, t.tick))
    },
  }
  /** LE NIVEAU D'EAU DU TICK (peche.md E5) — relevé une fois par snapshot, jamais par lecture :
   *  `niveauDEau` rembobine huit cycles d'élection météo, et la visée l'interroge sans cesse. */
  private niveauEauDuTick = 0
  /**
   * ═══ Y A-T-IL DE L'EAU ICI, AUJOURD'HUI ? (Alexis, 2026-08-25) ═══
   *
   * *« Il ne peut y avoir ni feuilles, ni coin de pêche sur une tuile sèche. »* Les deux
   * lisaient la CARTE — le champ de courant pour les feuilles, le terrain pour les coins — or
   * la carte de la fin de l'été est celle du printemps, lue autrement (`eau.ts`) : ni l'une ni
   * l'autre ne pouvait savoir que la mare était partie. Elles lisent désormais la MÊME loi que
   * la sim applique (`porteDeLEau`), sur le niveau déjà relevé ce tick.
   *
   * Champ-flèche et non méthode : elle se passe telle quelle à la vue et aux couches, comme
   * `floreGeleeAt`, sans qu'un `bind` traîne à trois endroits.
   */
  private readonly eauIci = (tx: number, ty: number): boolean =>
    this.etatGel !== null && porteDeLEau(this.etatGel, tx, ty, this.niveauEauDuTick)

  /**
   * QUI PORTE UNE FLAMME, À L'IMAGE (spec `torche.md`) — position MONDE en pixels et part de
   * flamme, pour les trois branchements de lumière.
   *
   * ⚠ POSITION INTERPOLÉE, ET PRÉDITE POUR SOI. Une torche est tenue à bout de bras : posée sur
   * `e.x/e.y` (le dernier snapshot), la lumière du joueur aurait traîné d'un intervalle de tick
   * DERRIÈRE lui — 50 ms à 20 Hz, soit un décalage visible en sprint, et l'impression très
   * exacte que la flamme n'est pas dans sa main. C'est le même détour que les poissons-ombres,
   * et pour la même raison.
   *
   * ⚠ ET C'EST LA SIM QUI DIT QUI BRÛLE, jamais le client : `torcheVive` relit la case active de
   * l'entité du snapshot, `partDeFlamme` relit son `wear`. Le client n'a pas d'horloge de torche
   * — il n'en aurait qu'une deuxième, qui dériverait de l'autorité.
   */
  /**
   * LE Y DESSINÉ D'UN CORPS (en tuiles) : sa rangée logique, moins son palier et son étage —
   * continu sur une rampe (`EtageLayer.niveauDuCorps`), le chapeau d'une mesa au-dessus de son
   * palier, la cave à la hauteur du palier qui la coiffe (`max`, comme `decalageDEtage`).
   *
   * ⚠ UNE SEULE ÉCRITURE pour tout ce qui se pose LÀ OÙ LE CORPS EST À L'ÉCRAN : le découvert,
   * la torche (sa flaque, son trou dans le voile, son point light). Le sprite lui-même suit la
   * même loi dans `snapshot-view` (`decalageDEtage` + `warp.lift`, sur l'entité interpolée).
   * `etage` absent ≡ le palier du sol (T-R3).
   */
  private yDessineDuCorps(x: number, y: number, etage: number | undefined): number {
    const palier = this.relief.palier(Math.floor(x), Math.floor(y))
    const niveau = this.etages.niveauDuCorps(x, y, etage ?? palier)
    return y - Math.max(niveau, palier) * LIFT_TUILES
  }

  private porteursDeTorche(): PorteurDeTorche[] {
    const out: PorteurDeTorche[] = []
    for (const e of this.lastEntities) {
      const slot = torcheVive(e)
      if (slot === null) continue
      const pos = e.id === this.playerId && this.predicted ? this.predicted : e
      // LÀ OÙ LE CORPS EST À L'ÉCRAN, pas à sa rangée logique : sur une terrasse de palier 2, la
      // flaque, le trou du voile et le point light de la torche étaient posés quatre tuiles au
      // sud du porteur (MESURÉ le 2026-09-04 sur le feu 474 de la graine 2026 — même défaut).
      out.push({ id: e.id, x: pos.x * TILE_PX, y: this.yDessineDuCorps(pos.x, pos.y, e.etage) * TILE_PX, part: partDeFlamme(slot) })
    }
    return out
  }
  /** Dernier tick où l'air de la barre haute a été relevé (voir `AIR_PAS_TICKS`). */
  private airAuTick = -Infinity
  private lastTime: GameTime | null = null
  /** Couvert de canopée lissé autour de l'avatar — piloté vers la valeur échantillonnée. */
  /** Le monde n'existe qu'après `ready` (carte, spawn, calendrier reçus de l'hôte). */
  private worldReady = false
  /** Ce que ce joueur a ARPENTÉ (spec R19). Vit côté client : aucune règle n'en dépend. */
  private fog?: Brouillard
  /** L'ART DE LA CARTE (onglet M) : la paire vive/grise dérivée du bake — bâtie une fois,
   *  dès que `solCouleurs` et le brouillard existent (voir `ensureCarteSavoir`). */
  private carteArt?: CarteArt
  /** La texture-canvas `carte-savoir` (1 px/tuile) et son tampon — l'image de l'onglet M. */
  private carteSavoirTex?: Phaser.Textures.CanvasTexture
  private carteSavoirImg?: ImageData
  /** Le canvas a changé sans être versé au GPU — versé au prochain update si la carte est
   *  ouverte (`refresh()` coûte un upload entier : on ne paie que devant témoin). */
  private carteSale = false
  /** La cellule de brouillard du joueur à la dernière peinture — le disque de VUE la suit. */
  private carteCellule = -1
  /** Les âges de foyer déjà estampillés (au dixième) — l'estampille ne repasse que si ça bouge. */
  private carteAgesVus = ''
  /** Les étapes de montage du monde qui restent à jouer — une par frame (voir `onReady`).
   *  Non vide ⇒ le monde est en train de naître : `update` ne fait QUE le monter. */
  private buildQueue: [phase: string, run: () => void][] = []
  /** Combien de passes l'hôte s'est-il annoncé ? (lu de ses `progress`) — la barre est
   *  la somme des siennes et des nôtres, sinon elle reculerait à la passation. */
  private hostPhases = 0
  private worldSeed = 0
  /** Les traces des coins de chasse (faune R24) — rebâties quand les coins bougent (R27). */
  private tracesLayer: TracesLayer | null = null
  private clutter?: ClutterLayer
  private ground!: GroundLayer
  /** LES PAVÉS (spec sol-dessine R8) : le sol à 16 px/tuile, par chunks, au-dessus du bake. Exposé
   *  pour le smoke (`matiere` lit `chunksVivants()` et `derniereCuissonMs`). */
  paves!: PaveLayer
  /** La couleur de sol de chaque tuile telle que le bake l'a cuite — la source des pavés. */
  private solCouleurs!: Uint32Array
  /** Le SECOND ton des tuiles de butte, cuit comme le premier (bit 24 posé s'il existe) —
   *  les pavés le sèment à 4 px (`mouchetureIci`). Zéro partout ailleurs. */
  private solMoucheture!: Uint32Array
  private cliffs!: CliffLayer
  /** LES ÉTAGES (spec `etages.md`) : le sol d'un plateau, et la rampe qui l'ouvre. */
  /** Publique pour le hook `__BRAISES__` : le smoke relève le BUDGET de la couche (E-A7 —
   *  combien de sprites vivent dans la vue), comme il lit `others.size` et `lastEntities`. */
  etages!: EtageLayer
  private pois!: PoiLayer
  /** Les bornes de seuil (worldgen R21) et la brume de la Combe — décor dérivé de la carte. */
  private bornes: BorneLayer | null = null
  private combeMist: CombeMist | null = null
  fumerolleFx: FumerolleFx | null = null // public : le harnais smoke LIT son compte de bouffées
  /** Les âges des foyers de cendre, tels que le dernier snapshot les a dits (spec `cendre.md`). */
  private cendreAge: number[] = []
  private morningMist: MorningMist | null = null
  /** Les bancs voyageurs (brume V2) et le vent lissé qui porte toute la brume. */
  private mistBanks: MistBanks | null = null
  private ventLisse = new VentLisse()
  /** Le cap RALLIÉ (direction seule — voir le commentaire au point d'appel) : le rideau, les
   *  brins et la fumée y lisent le sens du vent sans hériter du plancher de la brume. */
  private ventRendu = { x: 1, y: 0 }
  /** Les événements d'eau (gerbe/empreintes) et leurs sons (spec eau-vivante R7-R8). */
  private eauEvents: EauEvents | null = null
  private sonsEau = new SonsDeLEau()
  /** LES SONS DU CIEL (chantier audio météo, 2026-08-28) — les nappes de pluie et de vent,
   *  le tonnerre et le grésillement du télégraphe. Publique : le smoke lit sa sonde. */
  readonly sonsCiel = new SonsDuCiel()
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
  /** L'éclairage de CETTE image, posé en tête d'`update` et lu par tout le reste de la frame
   *  (le voile, la clairière…). Un seul écrivain, avant le premier rendu. */
  private lit = true
  /** Marcheurs à remous poussés cette frame — la sonde du critère A5 (lue par le smoke). */
  lastWaderCount = 0
  private calendarScale = 1
  private jourDeDepart = 1
  /** Dernier tick de snapshot appliqué — rejette les snapshots périmés/hors ordre. */
  private lastSnapshotTick = 0
  private playerId = 0
  /** Les lieux que MON joueur connaît — lu du snapshot, jamais décidé ici (client bête). */
  private myKnownPois: readonly number[] = []
  private playerSprite!: Phaser.GameObjects.Image
  /** LE REGARD (audit UI/UX P3-11) : pion d'orientation posé au bord de l'avatar. */
  private gaze!: Phaser.GameObjects.Image
  /** LE MOMENT DE MORT (mort-suite 1+5) : entre la chute et le réveil au Feu, on TIENT la
   *  caméra sur la tuile où l'on tombe (on voit sa dépouille) et on coupe l'input. Le saut
   *  au Feu et la main reviennent ENSEMBLE, au geste « SE RELEVER ». Faux hors de cette
   *  fenêtre. Les transitions sont pilotées DANS `update` en NIVEAU (état du voile, et
   *  `dyingAt` pour le filet) — robuste aux sauts d'horloge, là où un `delayedCall`,
   *  déclenché sur FRONT, se perd quand le pas d'horloge bondit. */
  private dying = false
  /** A-t-on VU le voile levé ? UIScene le pose à son update, une frame après la chute : tant
   *  qu'on ne l'a pas vu, son absence n'est pas « retombé » mais « pas encore levé ». */
  private dyingVeilVu = false
  /** LE TICK DE LA CHUTE qu'on a déjà voilée (`downedAt` de la sim) — l'identité d'une mort.
   *  Elle empêche le rattrapage par l'ÉTAT de relever le voile en boucle sur la même. */
  private dyingChute?: number
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
   * L'ÉTAGE DU JOUEUR, tel que l'AUTORITÉ le dit (spec `etages.md`). Il traverse déjà le
   * protocole — `SnapshotMessage.entities` porte l'`Entity` de /sim, `etage` compris — mais la
   * PRÉDICTION doit le connaître, sinon elle se trompe exactement là où le pas compte : sur la
   * rampe, elle jugerait le chapeau de mesa infranchissable (c'est de la roche à l'étage 0) là
   * où l'autorité le franchit, et chaque pas vers le plateau serait un rollback. C'est le même
   * raisonnement que le gel deux fonctions plus bas — la prédiction rejoue `moveAvatar`, elle
   * doit donc voir le même monde. 0 partout tant que personne n'est monté.
   */
  private etageJoueur = 0
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
    // ═══ LA RÈGLE DE `poseLibre`, LUE SUR L'INDEX (MESURÉ : 1 016 µs par image, marteau en main) ═══
    //
    // `poseLibre` de /sim balaie tout `nodes` — ~62 000 entrées sur la carte jouée — et ce
    // miroir tourne à chaque image tant qu'une pièce est armée. On garde la RÈGLE (elle vient
    // de /sim, `noeudDefriche`, et n'est pas recopiée) ; on ne garde pas le balayage. Un nœud
    // occupe sa tuile, sauf défriché : il n'en reste rien à contourner.
    //
    // ⚠ Ce raccourci vaut CÔTÉ CLIENT SEULEMENT, et pas par paresse : l'index de /sim
    //   (`nodeAt`) ne voit pas les nœuds nés en cours de partie (fumerolle, filon de la Brume :
    //   `state.nodes.push` sans patch d'index), là où celui de `SnapshotView` les inscrit à
    //   l'arrivée de leur delta (`applyNodeDeltas`, cas `neuf`). C'est pourquoi on ne touche
    //   PAS à `poseLibre` dans /sim — la sim y perdrait des nœuds, en silence et au replay.
    const noeudIci = this.view.noeudALaTuile(tx, ty)
    if (noeudIci !== undefined && !noeudDefriche(this.view.villages, noeudIci)) return false
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
  private murmureFx!: MurmureFx
  /** La silhouette de ce qu'on va poser, quand le mode construction est armé. */
  private buildGhost!: BuildGhost
  /** Le carré du Feu : liseré, tapis, extinction du dehors (spec construction R2). */
  private carreVillage!: CarreVillage
  /** La jauge d'abattage au-dessus de l'arbre qu'on charge (spec recolte-maitrise). */
  private fellGauge!: FellGauge
  /** LA LIGNE TENDUE (spec peche.md R1-R4) : canne, fil, flotteur, ferrage — le rendu de la pêche. */
  private pecheFx!: PecheFx
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
  /** LES SONS TUS PARCE QUE LEUR SUJET EST HORS DU RAYON D'INTÉRÊT (`lieuDeLEvenement`) —
   *  un PNJ qui forge à l'autre bout de la vallée. Informatif, lu par le smoke : c'est la
   *  mesure de ce que le monde émettait et qu'on entendait, plein pot, avant la 2026-08-27. */
  sonsHorsInteret = 0
  /** La hauteur RENDUE de mon avatar, en facteur d'échelle — le smoke y lit la posture (penché = tassé). */
  avatarScaleY(): number {
    return this.playerSprite.scaleY
  }
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

  /**
   * LE THÈME D'AMBIANCE (décision d'Alexis, 2026-08-27) — voir `audio/musique.ts` pour la forme.
   * La piste ne s'ouvre qu'au premier passage : les 4,3 Mo ne pèsent pas sur le chargement.
   * Ses sondes `passages` / `coupures` sont la surface mesurable au smoke (le son ne s'entend pas
   * sous swiftshader).
   */
  readonly theme = new ThemeAmbiance(() => this.audioFx.piste(themeAmbianceUrl))
  private eventLog: SimEvent[] = []
  /**
   * LE JOURNAL DES FAITS retenus par la chronique (`CHRONICLE_EVENT_TYPES`), tel quel —
   * surface de LECTURE du smoke test (`window.__BRAISES__.scene.eventJournal`), au même
   * titre que `lastEntities`. Le smoke lit l'état, il ne le fabrique pas : c'est ce qui lui
   * permet d'apprendre qu'une horde s'est levée ET OÙ (`horde_spawned` porte son berceau)
   * sans avoir à l'attendre au feu du village. Borné par `EVENT_LOG_CAP`, comme la chronique.
   */
  get eventJournal(): readonly SimEvent[] {
    return this.eventLog
  }
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

  /** Le panneau debug (DEV seulement) — porte le cadran thermique, qu'on alimente. */
  private debugPanel: DebugPanel | null = null

  /** Dernier tick où le cadran a été relevé : quatre lectures par seconde suffisent à lire
   *  un thermomètre, et chacune coûte un `baselineTemperature` (qui balaie les structures). */
  private thermoAuTick = -1
  /** Mon avatar télégraphie : la sim l'immobilise — la prédiction aussi. */
  private myWindup = false
  /** Je CHARGE : la sim me ralentit (COMBAT.CHARGE_MOVE_FACTOR) — la prédiction doit
   *  le savoir, sinon mon avatar file plus vite que l'autorité et se fait rappeler à
   *  chaque snapshot. La formule reste celle de /sim (`speedScaleFor`). */
  private myCharging = false
  /** MA ligne est-elle tendue (le dernier snapshot) ? Le clic suivant FERRE au lieu de lancer. */
  private myFishing = false
  /** JE DÉPÈCE (depecage.md R2c) : la silhouette se tasse, comme le pas lent. Lu du snapshot. */
  private myButchering = false
  /** Les WIND-UPS du dernier snapshot : qui arme un coup, vers où, avec QUELLE FORME.
   *  C'est le TÉLÉGRAPHE du GDD §7 — on doit voir venir le coup, le sien comme
   *  celui d'en face. Il vient du snapshot, jamais du clic (invariant §3). */
  /** L'axe et la récupération du dernier coup ARMÉ par chacun — lus au `attack_whiffed`. */
  private ratesAVenir = new Map<number, { dx: number; dy: number; ms: number }>()
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
  /** LE SANG QUI QUITTE LE CORPS (`sang-fx`) : la giclée du coup, la goutte de la plaie. */
  private sangFx!: SangFx
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
  /** LE RELIEF cuit une fois (`render/relief.ts`) : palier + chapeau par tuile, lu par toutes
   *  les couches qui lèvent quelque chose à l'écran (spec `terrasses.md` §4). */
  private relief!: Relief

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
    // LA TRACTION (traction.md T1) : R attelle le cadavre le plus proche, ou détache. La
    // sim seule juge (portée, déjà attelée) — ici on ne fait qu'ENVOYER, et dire le geste.
    this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.R, false).on('down', () => {
      if (this.registry.get('chatTyping') === true) return
      const moi = this.lastEntities.find((e) => e.id === this.playerId)
      if (moi?.attelage !== undefined) {
        this.sendAction({ type: 'detacher' })
        publishHint(this.registry, 'Longe relâchée.', this.time.now)
        return
      }
      let proche: { id: number; d2: number } | null = null
      for (const c of this.view.corpses) {
        const d2 = (c.x - this.predicted.x) ** 2 + (c.y - this.predicted.y) ** 2
        if (!proche || d2 < proche.d2) proche = { id: c.id, d2 }
      }
      if (!proche || proche.d2 > TRACTION.PORTEE * TRACTION.PORTEE) {
        publishHint(this.registry, 'Rien à traîner à portée.', this.time.now)
        return
      }
      this.sendAction({ type: 'atteler', kind: 'corpse', id: proche.id })
      publishHint(this.registry, 'On traîne (R pour relâcher) — lentement, et ça s’entend.', this.time.now)
    })
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
    this.murmureFx = new MurmureFx(this) // les fantômes de la vieille cendre (cendre.md R27d)
    this.sangFx = new SangFx(this)
    this.view.setSangFx(this.sangFx) // …et le goutte-à-goutte des plaies, qui a besoin du sprite qui saigne
    this.buildGhost = new BuildGhost(this)
    // LA FRONTIÈRE DE CONSTRUCTION SE VOIT (demande d'Alexis, 2026-08-04) : le liseré du
    // carré, le tapis de constructibilité et l'extinction du dehors — marteau en main.
    this.carreVillage = new CarreVillage(this)
    this.fellGauge = new FellGauge(this)
    this.pecheFx = new PecheFx(this)
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
      // Les deux INDEX de nœuds, tenus par `SnapshotView` et patchés en O(1) : la visée et
      // les résolveurs de touche les balayaient linéairement, à chaque image.
      noeudALaTuile: (tx, ty) => this.view.noeudALaTuile(tx, ty),
      noeudParId: (id) => this.view.noeudParId(id),
      corpses: () => this.view.corpses,
      // LES PILES AU SOL (spec chasse C18) : ce qu'on a jeté, et les flèches retombées
      // (`tir.md` T6). Elles étaient DÉJÀ dessinées et déjà dans le snapshot ; il ne
      // manquait que le fil jusqu'au geste qui les ramasse.
      piles: () => this.view.groundItems,
      // ═══ OÙ IL Y A DE L'EAU, AUJOURD'HUI (spec `peche.md` D9/E6) ═══
      //
      // La visée en a besoin depuis qu'on pêche l'EAU et non plus un nœud. On appelle la loi
      // de /sim (`porteDeLEau`) — jamais une relecture du terrain : elle seule sait que la
      // mare est partie à la sécheresse et que la crue en a ajouté ailleurs.
      //
      // ⚠ LE NIVEAU EST HOISTÉ par frame (`niveauEauDuTick`) et pas relu ici : `niveauDEau`
      // REMBOBINE huit cycles d'élection météo, et ce prédicat est appelé à chaque mouvement
      // de curseur. C'est la même précaution que la couche de gel, pour la même raison.
      porteDeLEau: (tx, ty) =>
        this.etatGel !== null && eauPechable(this.etatGel as unknown as Parameters<typeof eauPechable>[0], tx, ty, this.niveauEauDuTick),
      // ═══ LA JOIGNABILITÉ D'ÉTAGE (spec `etages.md` E-R5) ═══
      //
      // La MÊME loi que la sim (`strikeRejection`, `atteintLeSol`) : depuis MON étage
      // (`etageJoueur`, relu de l'autorité à chaque snapshot) vers le sol de la tuile visée
      // ou l'étage du nœud qu'elle porte. Sans elle, le bloc d'un chapeau se dorait depuis
      // le pied de la mesa, et `F` rendait « trop loin ».
      atteignable: (tx, ty, etage) => atteignableEntreEtages(
        this.map, this.predicted.x, this.predicted.y, this.etageJoueur,
        tx + 0.5, ty + 0.5, etage ?? palierDuSol(this.map, tx, ty),
      ),
      // L'ACCUSÉ DE RÉCEPTION DU DÉCOCHAGE : ma charge telle que le dernier SNAPSHOT la
      // connaît. Tant qu'elle est là, la sim n'a pas vu l'`attack_release` — et rebander
      // l'écraserait (une seule action par tick).
      chargeEnCours: () => this.myCharging,
      ligneTendue: () => this.myFishing,
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
      // PUIS LE LIFT DE L'ÉTAGE SE DÉPLIE (`deplierLeLift`) : un plateau se dessine deux
      // rangées plus haut que sa tuile, le curseur doit viser ce qu'on VOIT — sinon la pierre
      // d'une mesa se récolte deux tuiles sous son image (Alexis, 2026-09-02).
      unproject: (px, py) => {
        const plat = this.warp ? this.warp.unproject(px, py) : { x: px, y: py }
        return this.relief ? deplierLeLift(this.relief, plat.x, plat.y, this.etages?.souterrain ?? false) : plat
      },
      simTick: () => this.lastSnapshotTick,
    })

    // Le mode debug (P) — DEV seulement : en prod la condition est statiquement
    // fausse, le bloc et l'import sont éliminés du bundle.
    if (import.meta.env.DEV) {
      const debugDeps = {
        sendAction: (action: PlayerAction) => this.sendAction(action),
        setSpeed: (factor: number) => this.send({ type: 'debug_speed', factor }),
        isNight: () => this.lastTime?.isNight ?? false,
        seasonDay: () => this.lastTime?.seasonDay ?? 1,
      }
      bindDebugKeys(this, debugDeps)
      // les toggles cliquables (P) — remplacent F5, doublent F2-F4 ; et le CADRAN thermique
      this.debugPanel = createDebugPanel(this, debugDeps)
    }

    // Hook de debug/pilotage (pattern __MANIF__) : smoke tests et futurs bots.
    // `audio` : les fonctions PURES du son, exposées pour la vérification hors-ligne
    // (OfflineAudioContext) — le SYSTÈME se contrôle même si l'esthétique se juge à l'oreille.
    // `sim` : les TABLES de /sim, pour qu'un scénario lise le nombre livré au lieu de le
    // recopier (« le smoke LIT l'état, il ne le fabrique pas »). Le scénario `peche` s'en sert
    // pour se planter à la portée RÉELLE du coin (`NODE_DEFS[...].range`) : une portée qu'on
    // aurait écrite en dur dans `smoke.mjs` ne garderait rien le jour où elle change.
    // ⚠ CE HOOK N'EST PAS DEV-ONLY (contrairement au bloc `import.meta.env.DEV` ci-dessus) : il
    // part en prod. Les deux tables n'y ajoutent RIEN — elles sont déjà dans le bundle (le
    // client les importe), et `scene: this` donne déjà accès à tout ce qu'elles contiennent.
    // C'est de la commodité de lecture, pas une nouvelle surface.
    ;(window as unknown as { __BRAISES__: unknown }).__BRAISES__ = { scene: this, audio: { buildSound, soundForEvent }, sim: { NODE_DEFS, BALANCE, FISH_SPECIES } }

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
      // ⚠ LA MUSIQUE NE MEURT PAS AVEC LA SCÈNE. Le thème vit dans un `<audio>` DÉTACHÉ, branché
      // sur un `AudioContext` qui appartient au moteur et SURVIT au shutdown (rien ici ne le
      // détruit) : sans ce `taire()`, quitter vers les Mondes laissait le morceau tourner
      // par-dessus le menu, sans un objet à l'écran pour dire d'où il venait.
      this.theme.taire()
      // MÊME PIÈGE, MÊME REMÈDE : les nappes de pluie et de vent (`meteo-audio.ts`) sont des
      // sources BOUCLÉES branchées sur le master du moteur, qui survit lui aussi. Sans ça, on
      // quittait une partie sous l'averse et la pluie continuait par-dessus le menu — vu par
      // Alexis le 2026-08-31, « ça reste même sur l'écran d'accueil pendant des minutes ».
      this.sonsCiel.taire()
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
        this.fireFx, this.cascadeFx, this.fireGround, this.poissons, this.feuilles,
        this.meteoLayer, this.ventLayer, this.foudreFx, this.gelLayer, this.paves,
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
    this.jourDeDepart = msg.jourDeDepart
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
    // LES ANNÉES RÉVOLUES (T5) : déjà formatées par l'hôte — rien à recalculer, on les tient.
    setHud(this.registry, 'volumesScelles', msg.volumes ?? [])
    const worldW = this.map.width * TILE_PX
    const worldH = this.map.height * TILE_PX

    // L'ORDRE EST CELUI D'AVANT, à la ligne près : découper n'est pas réordonner.
    // Le `Record` typé par BUILD_PHASES est le garde-fou : ajouter une étape sans
    // l'annoncer (ou l'inverse) ne compile pas — la barre ne peut donc pas se
    // désaccorder en silence de ce qu'elle compte.
    const steps: Record<BuildPhase, () => void> = {
      relief: () => {
        // LE RELIEF EN TERRASSES (spec `terrasses.md`, T-R7) : le sol lui-même a des paliers, et le
        // warp les lève d'un LIFT par palier — sur une carte plate, il reste le no-op d'avant
        // (lift ≡ 0, unproject ≡ identité). Le relief est cuit UNE fois, les couches le lisent.
        this.relief = creerRelief(this.map)
        this.warp = createWarp(this.relief)
        this.view.setWarp(this.warp)
      },
      // Terrain baké à 1 px/tuile (texture = map.width×map.height px, sous la limite
      // WebGL même pour une grande carte) puis étiré à la taille monde : les tuiles
      // étant des aplats, l'étirement NEAREST est pixel-identique au bake 16 px/tuile.
      bake: () => this.bakeMapTexture(),
      ground: () => {
        this.ground = new GroundLayer(this, this.map, this.warp, 'map-demo')
        // LES PAVÉS DESSINÉS (décision d'Alexis 2026-08-22, spec sol-dessine R8-R10) : le sol
        // cuit à 16 px/tuile par chunks, grain de famille compris — la passe MULTIPLY d'hier
        // est dedans. Le bake reste le lit de l'eau et la source de la minicarte.
        this.paves = new PaveLayer(this, this.map, this.solCouleurs, this.worldSeed, this.solMoucheture, this.relief)
        // LA CENDRE PASSE PAR LE SOL DESSINÉ (spec `cendre.md` R11) : elle y gagne sa frange, son
        // liseré et son ombre portée comme n'importe quel terrain, au lieu d'être un calque posé
        // par-dessus. Le sol lit la MÊME fonction que la sim — écrivain unique.
        this.paves.cendreIci = (tx, ty) =>
          tuileCendree({ map: this.map, cendreAge: this.cendreAge, seed: this.worldSeed }, tx, ty)
      },
      water: () => {
        // L'eau, par-dessus le sol : un shader qui défait le cisaillement du relief et
        // réfracte le fond (le bake `map-demo` lui sert de lit).
        const bootEau0 = performance.now()
        this.water = new WaterLayer(this, this.map, 'map-demo', this.relief)
        this.view.rive = this.water.rive // une seule vérité de « où est l'eau » (eau-vivante R2)
        // …et une seule de « où est la vase » (peche.md R13) : le SDF du marais, cuit par la
        // même fonction que la rive. L'acteur s'y enfonce en PENTE, comme dans l'eau.
        this.view.vase = this.water.vase
        // ET LA CENDRE LA COUVRE (voir `SnapshotView.cendreIci`) : la MÊME fonction que la sim
        // — le décor l'appelle déjà pour ne rien faire pousser sur la cendre.
        this.view.cendreIci = (tx, ty) =>
          tuileCendree({ map: this.map, cendreAge: this.cendreAge, seed: this.worldSeed }, tx, ty)
        ensureEauFxTextures(this) // anneaux de flottaison, gerbe, empreinte — bakés une fois
        this.eauEvents = new EauEvents(this, (moi) => this.sonsEau.splash(moi, (sp, d2) => this.audioFx.play(sp, d2)))
        this.eauEvents.joueur = this.playerSprite
        this.view.eau = this.eauEvents
        if (this.water.rive) this.poissons = new PoissonsOmbres(this, this.map, this.water.flow, this.water.rive)
        // Le courant se voit (R15) — sur le champ PARTAGÉ avec le shader (source unique).
        this.feuilles = new FeuillesDerive(this, this.map, this.water.flow, this.water.rive)
        // L'EAU DU JOUR (voir `eauIci`) : une feuille ne dérive pas sur un lit à sec.
        this.feuilles.eauIci = this.eauIci
        // LES ROCHERS DU GUÉ (Alexis, 2026-08-28) : la feuille GLISSE le long du bord et
        // lâche ; le poisson CONTOURNE (berge de plus pour ses whiskers et ses sous-pas).
        // Le prédicat lit les NŒUDS VIVANTS — un rocher taillé rend son eau aux deux.
        const pierreIci = (tx: number, ty: number): boolean => {
          const n = this.view.noeudALaTuile(tx, ty)
          return n !== undefined && n.type === 'rock' && n.stock > 0
        }
        this.feuilles.pierreIci = pierreIci
        if (this.poissons) this.poissons.pierreIci = pierreIci
        this.reflets = new RefletsLayer(this, this.map)
        this.view.reflets = this.reflets
        // LA SONDE A10 (eau-vivante) : le boot de l'eau se CHRONOMÈTRE, il ne s'affirme pas.
        this.bootEauMs = Math.round(performance.now() - bootEau0)
        this.cliffs = new CliffLayer(this, this.map, this.relief)
        // LE PLATEAU par-dessus la falaise : elle lui donne déjà son FLANC (E-R12), il ne
        // manquait que son SOL et l'entaille de la rampe. Muet sur une vallée sans mesa.
        this.etages = new EtageLayer(this, this.map, this.relief)
        // LA RAMPE EST UN PLAN INCLINÉ (Alexis, 2026-09-01) : l'acteur lit sa hauteur à la couche
        // qui la PEINT, jamais à une seconde écriture de la même géométrie.
        this.view.niveauAt = (x, y, e) => this.etages.niveauDuCorps(x, y, e)
      },
      pois: () => {
        this.pois = new PoiLayer(this, this.map, this.warp) // les lieux se voient enfin
        // Les BORNES qui annoncent les seuils (worldgen R21) et la brume de la Combe : du
        // décor dérivé de la carte (map.seuils, zone `combe_brumeuse`) — rien n'est deviné.
        this.bornes = new BorneLayer(this, this.map, this.warp)
        this.combeMist = new CombeMist(this, this.map)
        this.fumerolleFx = new FumerolleFx(this)
        // LA CENDRE (spec `cendre.md`) : elle REPEINT le sol des tuiles prises, avec la couleur du
        // terrain converti. Elle ne reçoit aucune tuile — elle relit `estCendre` de /sim sur le
        // champ statique de la carte et les dix âges du snapshot.
        this.morningMist = new MorningMist(this, this.map) // la brume de l'aube naît de l'eau (da-feeling R13)
        this.mistBanks = new MistBanks(this, this.map) // les bancs voyageurs (V2) — nés des grandes eaux
        // LE PEUPLEMENT AVANT LES NŒUDS : la vue doit savoir sur quelle carte elle pose ses
        // arbres avant d'en dessiner un, sinon la première image sort en arbres ordinaires.
        this.view.setPeuplement(this.map, this.worldSeed)
        this.view.setNodes(msg.nodes)
      },
      clutter: () => {
        this.clutter = new ClutterLayer(this, this.map, this.worldSeed, this.warp)
        // LES TRACES DU COIN (faune R24) : posées une fois — la structure du coin
        // est une donnée de carte, elles ne bougent qu'avec les coins (R27).
        this.tracesLayer = new TracesLayer(this)
        this.tracesLayer.rebuild(this.map, this.grounds, this.worldSeed)
        // Rien ne pousse sur la cendre (R15) : le décor lit la MÊME fonction que la sim.
        this.clutter.tuileCendree = (tx, ty) =>
          tuileCendree({ map: this.map, cendreAge: this.cendreAge, seed: this.worldSeed }, tx, ty)
        // LES FUMEROLLES : dérivées, comme tout le reste de la cendre — le client appelle la
        // MÊME fonction que la sim, il ne reçoit aucune position.
        this.clutter.fumerolleIci = (tx, ty) => fumerolleIci(
          this.map, tx, ty, avanceesDepuisAges(this.cendreAge, this.cendreAge.length), this.worldSeed,
        )
      },
      world: () => {
        this.nightVeil = new NightVeil(this)
        this.fireFx = new FireFx(this)
        this.cascadeFx = new CascadeFx(this, this.map.width)
        this.fireGround = new FireGroundGlow(this)
        this.torcheGround = new TorcheGroundGlow(this)
        this.dynLight = new DynamicLighting(this)
        // UN FEU EST UNE STRUCTURE : il se dessine à la hauteur de sa tuile (`liftSol`, comme
        // son sprite dans `snapshot-view`), et ses flammes, sa flaque et son point light avec
        // lui — sans quoi, au palier 2, les trois vivaient quatre tuiles au sud des rondins.
        // Même patron que `reveil-fx` : la couche reçoit le relief, elle ne lit pas la carte.
        const reliefSous = (x: number, y: number) => ({ lift: this.warp.liftSol(x, y), strate: this.warp.strateSol(x, y) })
        this.fireFx.setReliefSous(reliefSous)
        this.fireGround.setReliefSous(reliefSous)
        this.dynLight.setReliefSous(reliefSous)
        // LE SOL **VU**, cendre comprise — et non `map.terrain` : la carte n'est jamais mutée
        // (`carte-immuable.test.ts`), la cendre est dérivée au rendu, donc `map.terrain` rend
        // encore `grass` sur un sol cendré. Sans ce détour, le « sans cendre » de
        // `FIREFLY_TERRAINS` (Alexis, 2026-08-26) serait un commentaire : les essaims
        // continueraient de se poser sur la cendre en croyant se poser dans un pré.
        // `this.paves` existe déjà ici (créé plus haut dans le même `world:`), et le repli sur
        // le terrain brut garde la fonction totale si l'ordre changeait un jour.
        this.ambientLife = new AmbientLife(this, (tx, ty) =>
          tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height
            ? -1
            : (this.paves?.terrainAffiche(tx, ty) ?? this.map.terrain[ty * this.map.width + tx] ?? -1),
        )
        // LA MÉTÉO (spec meteo.md) : la bande du front et la foudre. Le record d'élection
        // arrive par le snapshot ; TOUT le reste — bande, gradient, instants et points
        // d'impact — se recalcule ici des fonctions pures de /sim.
        this.meteoLayer = new MeteoLayer(this, this.map.width, this.map.height)
        // LE VENT SE VOIT (spec `vent.md` V9) : là où il n'y a rien à pousser — lande rase,
        // gué, champ de cendre — les herbes couchées ne disent plus rien. Les serpentins sont
        // le recours, et ils ne sortent QUE quand un front approche.
        this.ventLayer = new VentLayer(this)
        this.foudreFx = new FoudreFx(this)
        // LE TONNERRE (chantier audio météo, 2026-08-28) : la frappe se résout dans FoudreFx
        // (la loi d'abri s'y écrit déjà), le son l'écoute — spatialisé au point d'impact.
        this.foudreFx.onFrappe = (x, y) => this.sonsCiel.tonnerre(x, y, (sp, d2, at) => this.audioFx.play(sp, d2, at))
        // LE GEL (spec gel.md) : la neige qui tient au sol et la glace praticable. Comme la
        // cendre, RIEN n'est transmis — le client relit les fonctions pures de /sim sur un
        // état reconstitué du snapshot.
        this.gelLayer = new GelLayer(this, this.map, String(this.map.width), this.worldSeed, this.relief)
        // SUR LA GLACE, ON MARCHE : l'immersion des acteurs lit la glace peinte (même signature).
        const gel = this.gelLayer
        this.view.glaceAt = (tx, ty) => gel.etatAt(tx, ty) >= TUILE_GLACE_GUE
        // LA FLORE QUI GÈLE (flore-froid.md F8 révisée) : le fouillis et les nœuds gélifs lisent
        // le gel de la flore sur la même signature ; la gerbe de givre est celle de la récolte.
        const floreGeleeAt = (tx: number, ty: number): boolean | null => gel.floreGeleeAt(tx, ty)
        this.view.floreGeleeAt = floreGeleeAt
        this.view.eauIci = this.eauIci
        if (this.clutter) {
          this.clutter.floreGeleeAt = floreGeleeAt
          this.clutter.onGivre = (x, y, h, now, graine, degel) => this.recolteFx?.givre(x, y, h, now, graine, degel)
        }

        // LES EMPREINTES : la semelle lit le manteau (même signature) et le SOL DESSINÉ.
        //   • la neige sait dire `null` (hors chunk cuit, on ne sait pas) — une trace ne meurt
        //     pas du silence d'un chunk évincé quand la caméra tourne ;
        //   • la cendre se demande au sol PEINT (`terrainAffiche`) et non à `map.terrain` : les
        //     terrains de cendre sont DÉRIVÉS, la carte ne les porte pas. `cendre_pre` SEULE —
        //     ni la cendre de bois ni la forêt brûlée (demande d'Alexis, 2026-08-25).
        if (this.eauEvents) {
          this.eauEvents.neigeAt = (tx, ty) => {
            const e = gel.etatConnuAt(tx, ty)
            return e === null ? null : estNeige(e)
          }
          this.eauEvents.cendreAt = (tx, ty) => this.paves?.terrainAffiche(tx, ty) === TERRAIN_CENDRE_PRE
        }
        // LA NEIGE MONTE SUR LES PIEDS (gel.md G9) : acteurs, nœuds et fouillis se coupent de sa
        // hauteur, sans descendre — la découpe révèle le manteau ; l'ombre se pose sur la neige.
        const hauteurNeige = (x: number, y: number): number => gel.hauteurNeige(x, y)
        this.view.hauteurNeigeAt = hauteurNeige
        if (this.clutter) this.clutter.hauteurNeigeAt = hauteurNeige
        this.cameras.main.setBounds(0, 0, worldW, worldH)
        this.prediction = createPrediction(msg.playerSpawn.x, msg.playerSpawn.y)
        this.view.syncActor(this.playerSprite, this.predicted.x, this.predicted.y, 'spr-player', false, 0, 0, this.etageJoueur)
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
        // ═══ « TESTER EN JEU » (l'Atelier, spec atelier-plans P-D) ═══
        //
        // `?atelier=<kind>` : la Veillée dev s'ouvre TÉLÉPORTÉ au premier exemplaire du
        // lieu qu'on édite — la boucle édite → sauve → HMR → juge en marchant. DEV
        // seulement par construction : `debug_teleport` est inerte hors `import.meta.env.DEV`
        // (veillee.ts), le paramètre ne fait donc rien dans un build de prod.
        // Gardé par DEV en PLUS de l'inertie aval (`debug_teleport` inerte hors debug) : le
        // code lui-même n'embarque pas en prod — la ceinture ET les bretelles (revue).
        if (import.meta.env.DEV) {
          const kindAtelier = new URLSearchParams(window.location.search).get('atelier')
          if (kindAtelier) {
            const z = (this.map.zones ?? []).find((q) => q.kind === kindAtelier)
            if (z) this.sendAction({ type: 'debug_teleport', x: z.x + z.w / 2, y: z.y + z.h + 2 })
          }
        }
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
    // ═══ ÉCLAIRAGE DYNAMIQUE — POSÉ EN TÊTE D'IMAGE, AVANT TOUT RENDU (2026-08-25) ═══
    //
    // Le rendu PAR DÉFAUT (décision d'Alexis, docs/decisions.md 2026-07-24) : il éclaire TOUS les
    // sprites (couche 1) et pilote soleil/lune/Feux. Le flag n'existe (et n'est posé) qu'en DEV, où
    // le panneau P permet de l'ÉTEINDRE pour comparer avec l'ancien rendu à plat ; absent (prod) →
    // `?? true`, la lumière est allumée. Éteint = scène rendue « comme avant ».
    //
    // ⚠ IL SE POSAIT EN BAS D'`update`, dans le bloc `if (this.lastTime)` — donc APRÈS
    // `renderNodes`. La PREMIÈRE image qui portait des nœuds (celle qui suit le premier snapshot :
    // `lastTime` et les nœuds arrivent ensemble) les dessinait donc avec la valeur d'INIT, `false`
    // — c'est-à-dire sur l'art PEINT, le vieux houppier en rects. À l'image suivante la clé passait
    // au `_lit`, et `FonduDeCime` y lisait un changement de clé À ÉTAT CONSTANT : il armait le
    // fondu de SAISON, soit **trente secondes** d'ancien houppier en train de s'effacer sur les
    // arbres visibles au chargement. Un drapeau que le rendu LIT se pose avant le rendu, comme le
    // vent juste en dessous — un seul écrivain, en tête.
    const litFrame = getHud(this.registry, 'debugLighting') ?? true
    this.lit = litFrame
    this.view.lighting = litFrame
    if (this.clutter) this.clutter.lighting = litFrame
    this.pois.lighting = litFrame // le bloc erratique (couche POI cubique) suit le même toggle
    this.bornes?.setLighting(litFrame) // les bornes de seuil aussi (da-feeling R5)
    if (this.eauEvents) this.eauEvents.lighting = litFrame // et les empreintes au sol (leur creux EST la lumière)
    // La MATIÈRE éphémère prend la même nuit que le monde : gerbes de coup, sang, éclats de
    // récolte, fumée des fumerolles, ligne de pêche. Les SIGNAUX (télégraphe, étincelle,
    // chiffre, sang-écran) restent pleine couleur — la nuit ne doit pas manger une affordance.
    this.pecheFx.lighting = litFrame
    if (this.fumerolleFx) this.fumerolleFx.lighting = litFrame
    this.sangFx.lighting = litFrame
    this.recolteFx.lighting = litFrame
    this.attackFx.setLighting(litFrame)
    // L'AVATAR bascule sur son _lit (R9 — un humain est un chip symétrique). Une fois par
    // changement de toggle : setTexture par frame réinitialiserait la frame pour rien.
    if (this.playerLit !== litFrame) {
      this.playerLit = litFrame
      this.playerSprite?.setTexture(litFrame ? 'spr-player_lit' : 'spr-player')
    }
    // ═══ LE VENT DU RENDU — UN SEUL AVANCEMENT PAR IMAGE, EN TÊTE (2026-08-25) ═══
    //
    // `VentLisse` est un RESSORT : il porte son cap d'une image à l'autre et le rallie par un
    // lerp au dt. L'appeler deux fois dans la même frame l'avancerait deux fois — le décor et la
    // brume tourneraient à des vitesses différentes, sur le même vent. On l'avance donc ICI, une
    // fois, avant tout consommateur, et tout le monde LIT ensuite (`ventRendu`, `ventLisse.cap`).
    //
    // Les deux sorties ne disent PAS la même chose, et c'est délibéré :
    //   · `ventRendu` — cap × force, avec le PLANCHER de rendu et la respiration : ce qui PORTE
    //     (nappes de brume, bancs). Une brume immobile est une image plate.
    //   · `ventLisse.cap` — le cap SEUL, rallié : ce à quoi le décor PLIE. Sa force, il la prend
    //     de la sim, qui monte avant la pluie.
    this.ventRendu = this.ventLisse.update(time, deltaMs, this.view.wind, this.view.windForce)
    // LES REFLETS (eau-vivante R13) : pool par frame — ouvert ici, servi par syncActor et
    // renderNodes au fil du tick, refermé en toute fin d'update (le surplus s'éteint).
    this.reflets?.begin()
    // LE BROUILLARD SE LÈVE SOUS LES PAS (spec worldgen R19). On dévoile autour de la position
    // PRÉDITE (celle qu'on voit, pas celle du dernier snapshot : le brouillard suit l'œil).
    // Et le SAVOIR-CENDRE s'estampille du même pas (décision 2026-08-28) : chaque cellule du
    // disque retient l'avancée du front telle qu'on la VOIT — la carte la redérive, elle ne
    // montre jamais un front qu'on n'a pas regardé avancer.
    if (this.fog) {
      const neuf = revele(this.fog, this.predicted.x, this.predicted.y, FOG_RAYON_TUILES)
      this.ensureCarteSavoir()
      // L'estampille ne repasse que si quelque chose a PU changer : du neuf sous les pas, un
      // changement de cellule (on revient sur un savoir plus vieux que le front), ou des âges
      // de foyer qui ont bougé (au dixième — la maille du recuit des pavés).
      const cellule =
        Math.floor(this.predicted.y / this.fog.pas) * this.fog.cols + Math.floor(this.predicted.x / this.fog.pas)
      const ages = this.cendreAge.map((a) => Math.round(a * 10)).join(',')
      let su = false
      if (neuf || cellule !== this.carteCellule || ages !== this.carteAgesVus) {
        su = estampilleCendre(
          this.fog, this.map, this.predicted.x, this.predicted.y, FOG_RAYON_TUILES,
          avanceesDepuisAges(this.cendreAge, this.cendreAge.length),
        )
        this.carteAgesVus = ages
      }
      if (neuf || su) {
        setHud(this.registry, 'fogVersion', (getHud(this.registry, 'fogVersion') ?? 0) + 1)
      }
      // LA CARTE SE REPEINT PAR DISQUES : celui d'ici quand le savoir a changé, et l'ancien
      // quand le disque de VUE a bougé de cellule (ce qu'on ne voit plus se grise derrière soi).
      if (this.carteArt) {
        if (neuf || su || cellule !== this.carteCellule) {
          this.peindreCarteDisque(this.predicted.x, this.predicted.y, FOG_RAYON_TUILES)
          if (this.carteCellule >= 0 && cellule !== this.carteCellule) {
            const ox = (this.carteCellule % this.fog.cols + 0.5) * this.fog.pas
            const oy = (Math.floor(this.carteCellule / this.fog.cols) + 0.5) * this.fog.pas
            this.peindreCarteDisque(ox, oy, FOG_RAYON_TUILES)
          }
          this.carteCellule = cellule
        }
        // Le versement GPU ne se paie que devant témoin : la carte ouverte.
        if (this.carteSale && this.carteSavoirTex && Boolean(getHud(this.registry, 'mapOpen'))) {
          this.carteSavoirTex.refresh()
          // `refresh()` REMET LE FILTRE À LINEAR en `antialias` (Phaser 4, `canvasToTexture`) —
          // le même piège que le champ d'eau (`water-layer.ts`) : le savoir à trois états,
          // quantifié à la cellule, se lissait entre deux cellules. Reposé après chaque versement.
          this.carteSavoirTex.setFilter(Phaser.Textures.FilterMode.NEAREST)
          this.carteSale = false
        }
      }
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
    // `nodeInRange` : la teinte DORÉE (à portée) plutôt que GRISE doit suivre la portée du
    // NŒUD, sinon un coin de pêche joignable à 4 tuiles s'affiche « trop loin » alors que le
    // clic marche. Identique à `inRange` sur tout nœud qui ne déclare pas de portée.
    this.view.setAim(overlay ? null : aim.nodeId, aim.nodeInRange)
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
    // LA LIGNE TENDUE de quiconque pêche (spec peche.md) : la canne part de la position RENDUE
    // de l'avatar (son sprite, cette frame), le flotteur du coin visé. Le snapshot date tout.
    const lignes: LigneRendue[] = []
    for (const e of this.lastEntities) {
      if (e.fishing === undefined) continue
      const sprite = e.id === this.playerId ? this.playerSprite : (this.view.others.get(e.id)?.sprite ?? null)
      if (!sprite) continue
      lignes.push({
        entityId: e.id,
        // LA LIGNE VISE UNE TUILE depuis D9 — le nœud n'est plus qu'un bonus, souvent absent.
        tx: e.fishing.tx,
        ty: e.fishing.ty,
        castTick: e.fishing.castTick,
        biteAt: e.fishing.biteAt,
        ...(e.fishing.windowEnd !== undefined ? { windowEnd: e.fishing.windowEnd } : {}),
        px: sprite.x,
        py: sprite.y - ANCRE_SOL_PX,
      })
    }
    this.pecheFx.update(lignes, this.view.nodes, time, deltaMs, this.warp)
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
      // La façade du gel : le panneau du feu relit `meteoFeuConso` au point du feu (R5).
      this.etatGel,
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
      // `w.strike.lourd` : le coup est INANNULABLE (R4nonies). Lu du snapshot, jamais
      // reconstitué côté client — le télégraphe montre la règle que la sim appliquera.
      this.attackFx.telegraph(sprite.x, ay, w.dx, w.dy, progress, zone, w.id === this.playerId, w.side, w.charged, w.strike.lourd === true, w.ranged)
      this.armes.set(w.id, { x: sprite.x, y: ay, dx: w.dx, dy: w.dy, zone, charged: w.charged, ranged: w.ranged, portee: w.strike.range * TILE_PX })
      this.designerLesCibles(w, spriteOf)
      // CE QUE COÛTERAIT UN RATÉ, retenu tant que le coup est armé : l'événement
      // `attack_whiffed` arrive APRÈS la disparition du wind-up et ne porte pas la forme
      // du coup. On garde donc l'axe et la récupération sous la main — c'est la seule
      // façon de peindre la VRAIE durée (`recoveryWhiff`) plutôt qu'une constante inventée.
      this.ratesAVenir.set(w.id, { dx: w.dx, dy: w.dy, ms: (w.strike.recoveryWhiff * 1000) / BALANCE.TICK_RATE_HZ })
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
    this.paves.render(this.cameras.main)
    // LE VENT DE LA SIM (spec chasse C17) : le décor plie DANS SON SENS. C'est
    // la seule affordance de l'odorat — et elle doit exister, sans quoi la règle
    // « approcher sous le vent » serait une injustice invisible (C19).
    if (this.clutter) {
      // ⚠ LE CAP RALLIÉ, PAS CELUI DE LA SIM (voir `VentLisse.cap`) : le cap de la sim avance par
      //   crans de 45°, et un cran suffisait à redresser toutes les tiges d'une image à l'autre.
      this.clutter.wind = this.ventLisse.cap
      // La FORCE, pas seulement le cap : un front qui approche plie les herbes avant de les
      // mouiller (`windSway`). Le décor et les nœuds-plantes lisent la même valeur de sim.
      this.clutter.windForce = this.view.windForce
      // ET LE CAP DE L'ONDE, qui n'est PAS celui de l'assiette : voir `windSway`.
      this.clutter.ventSim = this.view.wind
    }
    // Et les nœuds-plantes et les houppiers plient sur le MÊME cap que le décor : une fibre
    // droite à côté d'une touffe couchée est précisément ce qu'on cherche à ne plus voir.
    // ⚠ HORS DU `if (this.clutter)` : les houppiers existent sans couche de décor (zoom, banc),
    //   et un `capLisse` resté nul les aurait laissés sur le cap à crans, en silence.
    this.view.capLisse = this.ventLisse.cap
    // LE BÂTI GOMME LE DÉCOR (décision d'Alexis) : mur/sol effacent le décor de leur
    // tuile. On rafraîchit à chaque frame — pose et démolition rouvrent la tuile.
    this.clutter?.setBarriers(this.view.structures)
    // LA TEINTE DE LA SAISON (S17) : la touffe prend la couleur de son année. Posée ici, à
    // chaque image, parce que la couche mémoïse par cran de dix jours — le coût est nul.
    if (this.clutter && this.lastTime) {
      // AVEC ses décimales (`jourFrac`) : c'est ce qui égrène les éclosions sur les trente
      // minutes du cycle au lieu d'une salve au changement de date (flore-especes.ts). La
      // teinte, elle, plancherise d'elle-même (cranDeSaison arrondit) — rien ne clignote.
      this.clutter.jourDeLAnnee = this.lastTime.seasonDay + this.lastTime.jourFrac
      // Le jour vient d'un VRAI snapshot : les fenêtres de floraison peuvent s'armer
      // (avant lui, le défaut jouerait de fausses bascules — voir `jourConnu`).
      this.clutter.jourConnu = true
    }
    // ET LE FEUILLAGE CADUC TOURNE AVEC ELLE (S17, loi ③ — décision d'Alexis 2026-08-25). Posé
    // ici, à chaque image, pour la même raison que le décor : `rafraichirCimes` ne recuit qu'au
    // CHANGEMENT DE CRAN (dix jours) et rend `false` le reste du temps. Le coût est nul, et le
    // feuillage ne peut pas prendre du retard sur la couleur du sol — ils lisent le même cran.
    // ═══ L'HEURE QUE LIT TOUT LE RENDU EST L'HEURE SOLAIRE ═══
    //
    // Pas `hourOfCycle` : la longueur du jour SUIT LA SAISON (`saisons.md` S6), et les
    // keyframes de `lighting.ts` sont écrites pour un jour d'équinoxe. `heureSolaire` recale
    // le crépuscule du rendu sur celui de la sim — 22 h aux Pluies, 17 h 30 au Grand Froid,
    // 23 h 15 à l'Ardeur — et vaut l'identité aux équinoxes (voir son bloc).
    //
    // ⚠ C'EST LA SEULE HORLOGE DE LA CHAÎNE, et ces deux `const` sont la raison pour laquelle
    // elle l'est : le voile, le soleil, la lune, l'eau, les deux brumes, les oiseaux de l'aube
    // et — depuis le 2026-08-27 — la dérive des ombres de socle reçoivent tous CES
    // variables-là. En calculer une seconde ailleurs, c'est rejouer le défaut du 2026-08-25
    // (deux chaînes pas à la même heure, le soleil qui se téléporte).
    //
    // ⚠ DÉCLARÉES ICI, ET PAS PLUS BAS AVEC LE RESTE DE L'ÉCLAIRAGE : `renderNodes` (juste
    // après) pose les ombres de contact, donc il lui faut l'heure AVANT. Le repli à midi ne
    // sert qu'à typer la variable tant qu'aucun snapshot n'est arrivé — tous les consommateurs
    // restent sous leur `if (this.lastTime)`, et la dérive retombe à 0 (flaque centrée).
    // Le jour porte ses DÉCIMALES (`jourFrac`) : la lune coule, elle ne saute pas d'un cran à
    // minuit. Sans snapshot, on retombe sur la pleine lune — l'étalon, donc le rendu d'avant.
    const hour = this.lastTime
      ? heureSolaire(this.lastTime.hourOfCycle, this.lastTime.dayTicks, this.lastTime.lever)
      : heureCanonique(12)
    const jourLune = (this.lastTime?.seasonDay ?? LUNE_PLEINE_JOUR) + (this.lastTime?.jourFrac ?? 0)
    // L'OMBRE DES SOCLES DÉRIVE À L'OPPOSÉ DE L'ASTRE (demande d'Alexis, 2026-08-27) — le côté
    // et la force sortent de `dynamic-lighting`, qui ARBITRE les deux astres avec la fonction
    // même qui pose leurs intensités ; l'amplitude vit dans `socle-mineral`. Sans snapshot :
    // centrée.
    this.view.deriveOmbre = this.lastTime ? deriveDOmbre(hour, jourLune) : 0
    // ET ELLE S'ÉTEINT AVEC L'ASTRE QUI LA JETTE (Alexis : « elle devrait disparaître en fade au
    // crépuscule »). Sans snapshot : pleine, comme avant.
    this.view.forceOmbre = this.lastTime ? forceDeLOmbre(hour, jourLune) : 1
    // ET LES FALAISES PRENNENT LE MÊME ASTRE (2026-09-04) : pied et flanc à la force de l'ombre,
    // flanc du côté que dicte la dérive. Même ligne, même heure — jusque-là la terrasse restait
    // figée « soleil au nord-ouest, pleine à toute heure » pendant que le rocher à son pied
    // couchait son ombre à l'ouest le matin : deux soleils sur le même sol.
    if (this.cliffs) {
      this.cliffs.deriveOmbre = this.view.deriveOmbre
      this.cliffs.forceOmbre = this.view.forceOmbre
    }
    if (this.lastTime) {
      rafraichirCimes(this, this.lastTime.seasonDay)
      // ET LE RENDU LIT LE MÊME CRAN QUE LA CUISSON — un seul écrivain (cf. `cranSaison`).
      this.view.cranSaison = cranDeSaison(this.lastTime.seasonDay)
      // ET LE SOL TOURNE AVEC EUX (S17, branchée le 2026-08-25). Même source, même ligne : le
      // décor, le feuillage et le sol ne peuvent pas prendre deux jours de retard l'un sur
      // l'autre. `saisonABouge` ne fait rien tant que le cran n'a pas bougé.
      if (this.paves) {
        this.paves.jourDeLAnnee = this.lastTime.seasonDay
        this.paves.saisonABouge()
      }
      // LE BIEF SOUILLÉ SUIT LE JOUR (cendre.md R26d) : la souillure n'avance qu'avec l'âge
      // des foyers — une recuisson du champ d'eau par bascule, la même loi que la sim.
      this.water?.recuireSuie({ map: this.map, cendreAge: this.cendreAge, seed: this.worldSeed }, this.lastTime.seasonDay)
    }
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
    // LES FANTÔMES DES MURMURES (cendre.md R27d) — la nuit seulement, la même loi que la sim.
    if (this.lastTime) {
      this.murmureFx.update(
        this.cameras.main,
        { map: this.map, cendreAge: this.cendreAge, seed: this.worldSeed, tick: this.view.tick, lieuxBrules: [] },
        this.lastTime.isNight,
        time,
      )
    }
    // LE SANG vole, retombe et s'écrase — même horloge, même `dt` borné.
    this.sangFx.update(time, deltaMs)
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
      // ET LE RELIEF DU PAVEMENT SUIT LE MÊME SOLEIL. Posé ICI et pas dans le bloc de saison
      // plus haut : c'est `hour` — l'horloge unique de la chaîne — qui commande, exactement
      // comme le voile, la lune et l'eau. `soleilABouge` ne fait rien tant que le cran du
      // soleil n'a pas bougé, et ne périme alors que les chunks qui portent du relief.
      if (this.paves) {
        this.paves.heureSolaire = hour
        this.paves.soleilABouge()
      }
      this.cliffs.render(this.cameras.main, time) // les parois, auto-raccordées à la vue — et les cascades au pas de `time`
      // …et le dessus des mesas. LE DÉCOUVERT NE PART QUE VERS LE HAUT (décision d'Alexis,
      // 2026-09-01) : c'est ici, et pas dans la couche, qu'on décide à qui elle doit céder — un
      // plateau ne s'efface que pour un joueur d'un étage PLUS BAS que lui. Sur le plateau, ou
      // au-dessus, il reste plein : on ne fond jamais le sol que l'on foule.
      // ⚠ **UN SEUL POINT DE DÉCISION, TROIS CONSOMMATEURS.** Le plancher, le décor et les nœuds
      // d'un étage cèdent ENSEMBLE ou pas du tout : deux d'entre eux se sont d'abord tus, et l'on
      // a vu des fleurs de mesa flotter, opaques, dans le creux que le fondu venait d'ouvrir.
      // DEPUIS LES TERRASSES (spec `terrasses.md` T-R9), le découvert porte le CENTRE DESSINÉ du
      // joueur — là où son corps est à l'écran, palier et étage déduits — et son NIVEAU : c'est
      // la pièce qui, en lisant les deux, sait si elle est au-dessus de lui (`alphaDeDecouvert`).
      // Un joueur au palier 2 n'a rien au-dessus de lui que le chapeau d'une mesa de palier 2.
      const yDessine = this.yDessineDuCorps(this.predicted.x, this.predicted.y, this.etageJoueur)
      const decouvert = { x: this.predicted.x, y: yDessine, niveau: this.etageJoueur }
      this.view.decouvert = decouvert
      if (this.clutter) this.clutter.decouvert = decouvert
      // ═══ SOUS LA ROCHE : la salle prend l'écran, et E-R13 s'y VOIT ═══
      // Le drapeau se pose ici parce que c'est `WorldScene` qui sait où le regard se tient —
      // la couche ne DÉCIDE rien, elle obéit (le patron du découvert, deux lignes plus haut).
      // « Sous » se lit du PALIER de la tuile, pas de zéro : la salle d'une mesa de palier 2 est
      // à l'étage 1, et elle est tout autant sous la roche.
      const palierJ = this.relief.palier(Math.floor(this.predicted.x), Math.floor(this.predicted.y))
      const souterrain = this.etageJoueur < palierJ
      this.etages.souterrain = souterrain
      // ═══ LA LUMIÈRE DE LA CAVE — une structure par image, et la loi de /sim une fois par tuile ═══
      //
      // La première version tenait une fermeture par tuile (`clarteAt`) qui MÉLANGEAIT le ciel
      // et la torche en un gris multiplicatif : des carrés éclairés, et une torche qui allumait
      // des TUILES. Depuis, la couche porte un VOILE (`CaveVeil`, le patron du voile de nuit) que
      // la lumière perce : le jour à la gueule, la torche autour de la main, un souffle autour du
      // corps. `WorldScene` ne lui donne que ce qu'elle seule sait — l'heure, la torche, le corps —
      // et la loi de /sim (`partDuCiel`, E-R13), que la couche mémorise par tuile : la géométrie
      // d'une cave ne change jamais, il serait absurde de la relire soixante fois par seconde.
      //
      // ⚠ **LA TORCHE BAT SUR L'ALPHA, jamais sur le rayon** (`flicker`, le battement étalon de
      // tout le jeu) — un halo qui change de taille se lit comme un objet qui respire, celui qui
      // change d'intensité comme une flamme.
      //
      // ⚠ Les CORPS ne prennent plus de clarté à part (`view.clarteAt = null`) : ils vivent sous
      // le voile, dans la même strate que le sol, et prennent la même lumière que lui — c'est le
      // voile qui les éteint, pas une teinte recopiée. Un homme au fond d'une salle noire est
      // noir, et sa torche le sort du noir avec le sol qu'il foule.
      this.view.clarteAt = null
      if (this.etatGel !== null && this.etages.partDuCielAt === null) {
        const gel = this.etatGel
        this.etages.partDuCielAt = (tx, ty) => partDuCiel(gel, tx, ty, this.relief.palier(tx, ty) - 1)
      }
      if (souterrain || this.etages.lumiere === null) {
        const moi = this.lastEntities.find((e) => e.id === this.playerId)
        const slot = moi ? torcheVive(moi) : null
        this.etages.lumiere = {
          ciel: this.etatGel ? clarteDuCiel(this.etatGel, this.lastSnapshotTick) : 1,
          // La couleur du dehors vu par la gueule = la nuit du plateau, DÉRIVÉE du voile (posée
          // plus bas dans cette même passe, donc d'une image de retard — même change que `teinte`).
          teinteDuJour: this.etages.teinte,
          couleurDuJour: produitCouleurs(couleurDuCiel(daylight(hour)), this.etages.teinte),
          // En px DESSINÉS : la salle d'une mesa de palier `p` est levée de `p × LIFT`, le corps
          // qui s'y tient aussi — la torche perce le voile là où le corps est à l'écran.
          torche: slot !== null
            ? { x: this.predicted.x * TILE_PX, y: yDessine * TILE_PX, force: partDeFlamme(slot) * flicker(time, 0.37) }
            : null,
          joueur: { x: this.predicted.x * TILE_PX, y: yDessine * TILE_PX },
        }
      }
      if (this.etages.actif) this.etages.render(this.cameras.main, decouvert, deltaMs)
      // Les lieux ont besoin de savoir OÙ est le joueur (le nom grossit quand on
      // approche) et CE QU'IL CONNAÎT (on ne nomme pas un lieu qu'on n'a pas vu).
      // LA FUMÉE FROIDE : on ne lui donne que les bouches VISIBLES — elle ne connaît ni la carte
      // ni la cendre, et le froid qu'elle illustre vit dans /sim (`froidDeFumerolle`). Deux
      // écrivains séparés qui ne peuvent pas diverger, parce qu'ils ne se parlent pas.
      if (this.fumerolleFx && this.map.cendreCout) {
        const v = this.cameras.main.worldView
        const cx = Math.floor((v.x + v.width / 2) / TILE_PX)
        const cy = Math.floor((v.y + v.height / 2) / TILE_PX)
        const rayon = Math.ceil(Math.max(v.width, v.height) / TILE_PX / 2) + 4
        this.fumerolleFx.update(
          fumerollesAutour(this.map, cx, cy, rayon,
            avanceesDepuisAges(this.cendreAge, this.cendreAge.length), this.worldSeed),
          Math.min(0.1, this.game.loop.delta / 1000),
        )
      }
      this.pois.update(this.cameras.main)
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
      // LA LUNE (2026-08-25) — un seul nombre, résolu à partir du `jourLune` hoisté plus haut
      // et partagé par les deux chaînes qui en dépendent (le voile du sol, la lumière dynamique
      // des sprites) : les faire calculer chacune la sienne, c'est très exactement le défaut
      // qu'on a corrigé sur le soleil — deux chaînes d'éclairage pas à la même heure.
      const lueurLune = lueurDeLune(hour, jourLune)
      // LA NUIT DU PLATEAU, en teinte plate (voir `EtageLayer.teinte`) : depuis qu'il trie dans la
      // bande Y, le voile ne l'atteint plus. On lui repose le multiplicateur que le voile lui
      // appliquait, DÉRIVÉ de ce même voile. Posé ici, il servira à l'image SUIVANTE (la couche se
      // rend plus haut dans `update`) — un décalage d'une image sur une nuit qui met des minutes à
      // tomber, contre une ligne d'éclairage recopiée : le change est bon.
      // …et BLANCHE en rendu à plat (debug) : là, le voile remonte au-dessus de toute la scène
      // et l'assombrit déjà — la teinter en plus, ce serait deux nuits l'une sur l'autre.
      // …et LA MÊME NUIT AUX PALIERS HAUTS : le sol des terrasses (`PaveLayer.teinte`) trie dans
      // sa strate, au-dessus du voile, exactement comme le chapeau.
      const teinteDesHauteurs = this.lit ? multiplicateurDuVoile(voileDeNuit(amb, lueurLune)) : 0xffffff
      if (this.etages) this.etages.teinte = teinteDesHauteurs
      if (this.paves) this.paves.teinte = teinteDesHauteurs
      if (this.gelLayer) this.gelLayer.teinte = teinteDesHauteurs
      if (this.water) this.water.teinte = teinteDesHauteurs
      if (this.cliffs) this.cliffs.teinte = teinteDesHauteurs
      // ═══ LA SOUS-LISTE DES FEUX, DÉRIVÉE UNE FOIS PAR IMAGE (PERF-08) ═══
      //
      // Quatre passes complètes sur `structures` cherchaient le même petit sous-ensemble à
      // chaque image : ici, puis dans `FireFx`, `FireGroundGlow` et `DynamicLighting`. Sur
      // les ~772 structures d'un monde bâti, c'est quatre balayages pour une poignée de
      // foyers, soixante fois par seconde. Une seule passe, et les trois couches reçoivent
      // la liste au lieu de la refaire — le patron des Feux « résolus UNE fois », étendu de
      // la LUEUR (déjà partagée ci-dessous) au BALAYAGE lui-même.
      //
      // ⚠ L'ORDRE EST CELUI DE `structures`, à l'identique : `DynamicLighting` plafonne à
      //   `FEU_MAX` en prenant les premiers du tableau, donc un tri changerait QUELS feux
      //   éclairent. (Que ce plafond prenne les premiers plutôt que les plus proches est un
      //   défaut connu — `FX-03` de l'audit du 2026-08-20 — mais c'est un défaut de RÈGLE,
      //   pas de coût : on ne le déplace pas en passant.)
      const feux = this.view.structures.filter((s) => s.type === 'fire')
      // Les Feux, résolus UNE fois : même `fireGlow` (seed/heure) pour la flaque au sol, le trou
      // du voile ET le reflet sur l'eau → les trois battent EN PHASE avec la flamme.
      const litFires = feux
        .map((s) => {
          const warmth = this.view.villages.find((vg) => vg.id === s.villageId)?.warmth ?? 0
          const g = fireGlow(warmth, day, time, s.id * 1.7, axesFeu().respiration)
          // La lueur suit l'ÉTAT du feu (spec feu-station S1/S3) : pleine allumé, faible en braises,
          // NULLE éteint — la flaque au sol, le trou du voile et le reflet sur l'eau s'éteignent ensemble.
          const factor = facteurDuFeu(this.lastSnapshotTick, s)
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
      this.lastWaderCount = waders.length // la sonde d'A5 (lue par le smoke) — MARCHEURS seuls
      // ═══ LES PIERRES DU GUÉ REMUENT L'EAU (Alexis, 2026-08-28 : « autour des pierres, le
      // même effet qu'autour du joueur dans l'eau ») ═══
      //
      // L'eau se brise en continu sur un obstacle planté dans le courant : chaque pierre de gué
      // VIVANTE (stock > 0 — taillée, elle quitte l'eau et l'eau se referme) émet les anneaux
      // isotropes d'un marcheur à l'arrêt, mais SANS son extinction (une pierre ne s'arrête
      // jamais de faire obstacle) et SANS sa turbidité (le drapeau `pierre` — la vase se soulève
      // sous un pas, pas contre un caillou). EN QUEUE du tableau, après les marcheurs : eux
      // bougent, ils gardent la priorité des 8 premiers slots ET la sonde `lastWaderCount`.
      // À MI-FORCE : cinq pierres à pleine force couvriraient le gué d'anneaux — l'obstacle
      // se lit, il ne crie pas. Phase par position : deux pierres ne battent pas ensemble.
      // ET LE REMOUS SUIT LE COURANT (Alexis : « qu'ils correspondent plus à des remous dans
      // le sens du courant ») : une pierre plantée dans un courant est un marcheur qui
      // « marche » CONTRE lui — le sillage du shader sème ses anneaux à l'opposé du cap, donc
      // vers l'AVAL, et fenêtre l'amont ; le V se traîne derrière la pierre comme derrière un
      // pied. Le cap vient du champ de courant (`flow-field.ts`, la source unique de « où
      // l'eau va ») ; une eau SANS courant (mare, lac) rend {0,0} et les ronds isotropes
      // reviennent d'eux-mêmes — une pierre dans une eau immobile fait des ronds, pas un V.
      for (const z of this.map.zones) {
        if (z.kind !== undefined || z.name !== 'le Gué') continue
        if (z.x + z.w < vx0 || z.x > vx1 || z.y + z.h < vy0 || z.y > vy1) continue
        for (let ty = z.y; ty < z.y + z.h && waders.length < 14; ty++) {
          for (let tx = z.x; tx < z.x + z.w && waders.length < 14; tx++) {
            if (this.map.terrain[ty * this.map.width + tx] !== TERRAIN_SHALLOW_WATER) continue
            if (!this.eauIci(tx, ty)) continue // gué à sec : la boue ne fait pas d'anneaux
            const n = this.view.noeudALaTuile(tx, ty)
            if (n === undefined || n.type !== 'rock' || n.stock <= 0) continue
            const f = this.water?.flow ? flowAt(this.water.flow, tx + 0.5, ty + 0.5) : null
            const nf = f ? Math.sqrt(f.x * f.x + f.y * f.y) : 0
            waders.push({
              // À LA LIGNE DE FLOTTAISON, pas au centre de la tuile : la pierre est un
              // billboard — son eau visible est à son PIED (le bord bas de la tuile, là où
              // la coupe d'immersion pose le trait). Émettre du centre plaçait le croissant
              // d'écume DERRIÈRE le sprite et les anneaux à mi-hauteur du corps.
              x: tx + 0.5, y: ty + 0.95,
              phase: ((tx * 31 + ty * 17) % 97) * 0.211,
              strength: 0.5,
              dirX: nf > 0.05 ? -f!.x / nf : 0,
              dirY: nf > 0.05 ? -f!.y / nf : 0,
              pierre: true,
            })
          }
        }
      }
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
        jourLune, // …et son couloir LUNAIRE suit la même lune que le voile et les sprites
      )
      // LE VENT LISSÉ porte toute la brume : cap de la sim rallié en ~15 s — et depuis
      // l'unification (`vent.md`), la FORCE vient de la sim au lieu d'être inventée ici.
      const vent = this.ventRendu
      // ⚠ ON EN GARDE LA DIRECTION, PAS LA FORCE. `VentLisse` porte un PLANCHER de rendu (0,4)
      // et une respiration : une nappe de brume doit dériver même par calme plat. Le rideau et
      // les brins, eux, ont leur propre force (celle du ciel, celle de la sim) — ce qu'ils
      // prennent ici, c'est le cap RALLIÉ EN DOUCEUR, qui évite le saut de 45° de la sim.
      // LA MARÉE : l'heure décide de la GÉOMÉTRIE, le vent porte — et depuis le 2026-08-25 la
      // CONDITION décide s'il y a brume du tout (écart jour/nuit × calme d'ICI, `ventPartIci`,
      // relevé du snapshot précédent : une condition qui bouge à l'échelle du front n'a que
      // faire d'une image de retard).
      this.morningMist?.update(time, hour, vent, day, this.lastTime, this.ventPartIci, this.cameras.main)
      // …et la Combe garde son air (quart du vent) — en pile de bandes elle aussi (2026-08-28).
      this.combeMist?.update(time, vent, day, this.cameras.main)
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
        // LA MÊME CONDITION QUE LA MARÉE : un seul phénomène, deux objets — voir `mist-banks`.
        this.morningMist?.part ?? 1,
      )
      this.aube.update(time, hour, (sp, d2) => this.audioFx.play(sp, d2)) // les oiseaux, fenêtre de l'aube
      // LE THÈME D'AMBIANCE : un passage espacé au hasard, coupé net par le danger. La position
      // lue est la PRÉDITE quand on l'a — c'est là qu'est le joueur à l'écran, et une portée qui
      // coupe la musique doit se mesurer d'où il se voit.
      const moiTheme = this.lastEntities.find((e) => e.id === this.playerId)
      this.theme.update(
        time,
        dangerProche(
          this.predicted ?? moiTheme,
          this.playerId,
          this.view.monsters,
          (id) => this.lastEntities.find((e) => e.id === id),
          this.view.reveils,
        ),
      )
      // LES ÉVÉNEMENTS ET SONS DE L'EAU (eau-vivante R7-R8) : gerbes qui s'animent, traces
      // qui sèchent, patauge et clapotis pilotés par la position du joueur (champ de rive).
      this.eauEvents?.update(time)
      // LES POISSONS-OMBRES (R14) : ils errent sous la surface et fuient les entités — et depuis
      // la pêche (peche.md R5) ils GROUILLENT autour des coins vivants : on voit où ça mord.
      if (this.poissons) {
        // ⚠ LES COINS À SEC SORTENT AUSSI D'ICI. Les poissons-ombres GROUILLENT autour d'un coin
        //   vivant (peche.md R5) — sur une vase craquelée, ils grouillaient sur de la terre. Même
        //   loi que le sprite du coin (`view.eauIci`) : un seul écrivain, deux lecteurs.
        this.poissons.setCoins(this.view.nodes.filter((n) => estUnCoinDePeche(n.type) && this.eauIci(n.tx, n.ty)))
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
      // Flammes/braises/fumée (∝ état), poussées par le vent — CAP RALLIÉ et FORCE de la sim :
      // sous un front la fumée se couche, et elle tourne sans le saut de 45° de la sim.
      this.fireFx?.update(
        feux, this.lastSnapshotTick, // la sous-liste dérivée en tête (PERF-08)
        this.view.wind.x === 0 && this.view.wind.y === 0 ? this.view.wind : this.ventRendu,
        this.view.windForce,
        day, time,
      )
      // Les cascades (T-A9) : gouttes, brume et lueur au pied des chutes que `cliffs` vient de
      // poser à cette image — même vent que le feu, même nuit des hauteurs que la paroi.
      this.cascadeFx?.update(
        this.cliffs.chutes, time, day, lueurLune, teinteDesHauteurs,
        this.view.wind.x === 0 && this.view.wind.y === 0 ? this.view.wind : this.ventRendu,
        this.view.windForce,
      )
      // La chaleur du Feu au sol : cosmétique, ∝ nuit (voir world/fire-ground-glow.ts).
      this.fireGround?.update(feux, this.view.villages, day, time, this.lastSnapshotTick)
      // L'ÉCLAIRAGE a été posé EN TÊTE D'IMAGE (voir le bloc du haut d'`update`) : ici on le LIT,
      // on ne le repose pas. Le poser en deux endroits, c'était le poser après le rendu.
      const lit = this.lit
      // Le voile descend SOUS les sprites quand ils sont éclairés (il ne tinte plus que le fond) ;
      // sinon il coiffe toute la scène. Et le Feu le CREUSE — sauf en mode éclairé, où la vraie
      // pipeline fait déjà la lumière (on ne troue pas deux fois).
      const ambientDepth = lit ? AMBIENT_DEPTH_LIT : AMBIENT_DEPTH
      // LA CLAIRIÈRE. Portée CONSTANTE (`fireHoleRadius` — décision Alexis 2026-08-03 : le trou
      // ne suit plus `fireGlow.radius`, qui double avec l'alignement et effaçait la nuit à
      // 25 tuiles ; l'engagement se lit à la flamme, que `warmthColor` teinte déjà). MÊME graine
      // et même `time` que le halo et la flaque → les trois battent EN PHASE. Le `factor` éteint
      // la clairière avec le foyer (braises atténuées, feu mort : rien).
      // LA CLAIRIÈRE RESPIRE EN PROFONDEUR : sa `force` suit le battement, son rayon ne bouge
      // pas d'un texel (voir `VeilFire.force`). C'est le seul chemin par lequel un battement de
      // flamme atteint LE SOL — le sol est un `Mesh2D` hors pipeline Light2D, la source du Feu
      // ne l'éclaire pas.
      const axFeu = axesFeu()
      // …ET À LA HAUTEUR DE SA TUILE (`liftSol`, comme le sprite du feu) : au palier 2, le trou
      // se creusait quatre tuiles au sud des rondins (MESURÉ le 2026-09-04, feu 474, graine 2026).
      const veilFires = litFires.map(({ s, factor, g }) => ({
        worldX: (s.tx + 0.5) * TILE_PX,
        worldY: (s.ty + 0.5) * TILE_PX - this.warp.liftSol(s.tx + 0.5, s.ty + 0.5),
        radiusTiles: fireHoleRadius(time, s.id * 1.7) * factor,
        force: axFeu.respiration || axFeu.coeurBlanc ? 1 + (g.beat - 1) * 0.7 : 1,
      }))
      // ═══ LES TORCHES (spec `torche.md`) — TROIS branchements, UNE liste ═══
      //
      // Résolue ICI, une fois, et partagée par le trou du voile, la flaque au sol et le point
      // light : c'est le patron des Feux (« résolus UNE fois … les trois battent EN PHASE »),
      // et il est encore plus impératif pour une source qui MARCHE — trois listes séparées se
      // seraient décalées d'une image chacune, et la lumière aurait traîné derrière le porteur.
      //
      // Il en faut TROIS, et pas un de moins : le point light n'atteint que ce qui a une carte
      // de normales (fûts, décor volumique, corps) ; le SOL, lui, est un `Mesh2D` hors pipeline
      // Light2D (mesuré : ~+8 de rouge, rien). Sans la flaque ET le trou, la torche allumerait
      // les arbres au-dessus d'une terre restée noire.
      const porteurs = this.porteursDeTorche()
      for (const p of porteurs) {
        const r = torcheHoleRadius(p.part, day)
        // La FORCE, pas 1 : le rayon a doublé le 2026-08-26, la profondeur du creusement a
        // baissé d'autant (`TORCHE_HOLE_FORCE`) — le réglage vit dans `render/torche.ts`, avec
        // le rayon qu'il compense, jamais en dur dans cette boucle.
        if (r > 0) veilFires.push({ worldX: p.x, worldY: p.y, radiusTiles: r, force: TORCHE_HOLE_FORCE })
      }
      this.torcheGround?.update(porteurs, day, time)
      this.nightVeil?.update(
        // LE VOILE SUIT LA LUNE — teinte ET opacité : `NIGHT_ALPHA_MAX` est désormais la PLEINE
        // lune (étalon posé par Alexis), et la nuit se ferme à mesure qu'elle décroît ou se
        // couche. Monter la seule opacité ne suffisait pas (le bleu du voile fuit à 36 % même à
        // opacité 1) : sans lune, la teinte glisse au noir. Le multiply conserve les rapports —
        // la nuit devient plus SOMBRE, jamais moins contrastée.
        voileDeNuit(amb, lueurLune),
        // L'AIR DE LA ZONE SUIT LA MÊME LUNE — sans quoi la brume reste la seule chose éclairée
        // d'une nuit noire, et son terme additif redevient le plancher de l'image (mesuré :
        // (15, 14, 12) de blanc chaud posés sur un sol descendu à (5, 4, 2)).
        airSansLune({ color: this.airColor, alpha: this.airAlpha }, partSansLune(amb, lueurLune)),
        // LE PLANCHER (décision d'Alexis, 2026-08-26 : « pas noir #000, un bleu très foncé, un
        // peu gris »). En ADD, donc il ne peut qu'AJOUTER : sur le noir il rend sa couleur, sur
        // une braise il ne change presque rien. Il suit la MÊME lune que les deux couches
        // au-dessus — sous la pleine lune il n'existe pas, c'est elle qui fait le bleu.
        plancherDeNuit(amb, lueurLune),
        veilFires,
        this.cameras.main,
        ambientDepth,
        // TOUJOURS creusé, y compris en mode éclairé : le SOL n'est pas sur la pipeline Light2D
        // (mesuré, le point-light ne lui apporte que ~+8 de rouge), donc personne d'autre ne lui
        // rend la nuit qu'il a prise. Le paramètre reste — le mode à plat, lui, n'a pas été
        // remesuré ; qui voudra le retirer devra d'abord le regarder.
        true,
      )
      // SOUS TERRE, le ciel n'entre pas et la gueule éclaire (`SousTerre`) : `etages.render` a
      // tourné plus haut dans cette même image, ses gueules visibles sont celles de l'écran.
      const sousTerre = this.etages.souterrain
        ? { gueules: this.etages.gueulesPx, ciel: this.etages.lumiere?.ciel ?? 1 }
        : null
      this.dynLight?.update(lit, this.cameras.main, feux, this.view.villages, hour, day, time, jourLune, lueurLune, porteurs, this.lastSnapshotTick, sousTerre)
      // La vie ambiante : les oiseaux traversent, les lucioles ne sortent qu'à la nuit — et
      // depuis le 2026-08-26 elles ÉCLAIRENT, d'où le `lit` (le mode à plat les éteint avec
      // toutes les autres sources).
      //
      // DEUX HORLOGES, ET C'EST VOULU. L'obscurité (`1 - day`) vient du cadran SOLAIRE et donne
      // la pente du crépuscule ; le couvre-feu de l'aube vient de l'horloge MURALE, parce que
      // « une heure avant le lever » est une heure réelle et que le cadran canonique dilate la
      // nuit avec la saison. Ce n'est pas une seconde chaîne d'éclairage — rien d'autre ne lit
      // cette valeur — et `couvre-feu-lucioles.ts` s'en explique.
      this.ambientLife?.update(
        this.cameras.main,
        time / 1000,
        deltaMs / 1000,
        1 - day,
        partDeNuitDesLucioles(this.lastTime.hourOfCycle, this.lastTime.lever),
        lit,
      )
      // ── LA MÉTÉO (spec meteo.md) — EN DERNIER : le ciel se pose devant tout le reste. ──
      // La foudre parle d'abord (elle rend l'embrasement que le ciel consomme le même frame ;
      // l'inverse aurait retardé le flash d'une image sur le trait qui le cause).
      const meteoFront = this.view.meteo
      const flash = this.foudreFx?.update(time, {
        front: meteoFront,
        tick: this.lastTime.tick,
        map: this.map,
        // Le tableau COMPLET du snapshot : la loi d'abri ne doit pas dépendre du cadrage.
        structures: this.view.structures,
        // La secousse décroît avec la distance AU JOUEUR — d'où ce paramètre, qui n'existait
        // pas : la foudre ne savait pas qui la regardait.
        joueur: this.predicted,
      }) ?? 0
      // ── LE PAYSAGE GELÉ (spec gel.md G5/G7) ──
      // La façade porte les SEPT champs que `estGele`/`neigeAuSol` lisent, et rien d'autre ;
      // `structures` vient du snapshot COMPLET (l'abri d'une maison ne doit pas dépendre du
      // cadrage — le raisonnement de `ContexteFoudre`, à la lettre). Elle se bâtit AVANT le
      // rideau météo : depuis R11 l'aspect du ciel (neige ou pluie) se lit sur le froid du
      // monde, par cette même façade.
      const source = {
        map: this.map,
        temps: this.lastTime,
        calendarScale: this.calendarScale,
        jourDeDepart: this.jourDeDepart,
        structures: this.view.structures,
        meteo: meteoFront,
        // LA NAPPE DE BRUME (etat-gel, point ③) : sans elle la façade relisait une température
        // trop chaude de `BRUME.COLD_MALUS` sous la nappe — une glace autoritative invisible.
        brume: this.view.brume,
        // LA CENDRE TRAVERSE (voir `SourceDuGel.cendreAge`) : depuis qu'elle commande le pas,
        // la prédiction locale doit la connaître aussi bien que l'autorité.
        cendreAge: this.cendreAge,
        seed: this.worldSeed,
      }
      if (this.etatGel) majEtatGel(this.etatGel, source)
      else this.etatGel = creerEtatGel(source)
      // Le niveau d'eau du tick, pour la visée de pêche (E5) — une lecture par image.
      this.niveauEauDuTick = niveauDEau(this.etatGel)

      // L'ASPECT DU CIEL À L'ŒIL DU JOUEUR (spec meteo.md R11) : `aspectAuPoint` — la loi de
      // la sim, sans le test d'empreinte, pour que le mur qui APPROCHE soit déjà de neige ou
      // de pluie selon le froid qu'il trouvera ici. Une lecture par image, pas par particule.
      const aspect = meteoFront
        ? aspectAuPoint(this.etatGel, meteoFront, this.predicted.x, this.predicted.y, this.lastTime.tick)
        : null
      // ── LE CIEL PASSÉ AU RIDEAU (spec meteo.md R14) : DEUX aspects et un champ, plus un
      // aspect seul. `aspectAuPoint` reste ce que la barre haute nomme (l'icône est un
      // pictogramme : elle tranche, elle ne dégrade pas) ; ce que le rideau PEINT, lui, est un
      // MÉLANGE — la part de flocons se relit au point de chaque particule, si bien que la
      // lisière marais/pré porte du grésil au lieu de faire commuter tout le ciel.
      // Façade mutée en place (patron `ventFacade`) : zéro allocation par image.
      const ciel = meteoFront ? this.cielFacade : null
      if (ciel && meteoFront) {
        ciel.doux = meteoFront.type
        // La paire doux → froid vient de la SIM (`aspectFroidDe`) : la recopier ici l'aurait
        // fait mentir en silence le jour où un type gagne un aspect froid.
        ciel.froid = aspectFroidDe(meteoFront.type)
      }
      // …et il part tel quel à la barre haute, qui en fait son icône : une seule lecture
      // par image, partagée par le ciel qu'on peint et par le pictogramme qui le nomme.
      setHud(this.registry, 'cielIci', aspect)
      // …ET LA BARRE SAIT SI ÇA COUVRE ICI : `cielIci` est délibérément SANS test d'empreinte
      // (le mur qui approche est déjà de neige ou de pluie), mais un pictogramme plein sous un
      // ciel encore sec mentait pendant des heures — l'icône s'estompe hors de la bande, comme
      // l'aiguille du vent s'estompe par force faible. Le cadran dev, lui, dit « clair ».
      setHud(
        this.registry,
        'cielCouvre',
        meteoFront !== null
          && meteoIntensityAt(meteoFront, this.lastTime.tick, this.map.width, this.map.height, this.predicted.x, this.predicted.y) > 0,
      )

      // ── LE VENT (spec `vent.md` V10) ── le cap vient de la sim tel quel (écrivain unique) ;
      // la FORCE se relit AU POINT DU JOUEUR par la fonction pure partagée, et non au centre de
      // la carte comme `windForce` : la bande est spatiale, et ce qu'on veut montrer, c'est ce
      // qui souffle ICI. Le cadran, lui, n'invente rien — il tourne.
      if (this.etatGel) {
        // La façade est remise à jour EN PLACE (patron `majEtatGel`) : une allocation par
        // relevé serait du déchet pur. `wind` vient du snapshot, le reste de l'état du gel —
        // qui porte déjà le front, l'échelle du calendrier et la carte.
        const f = this.ventFacade
        f.tick = this.etatGel.tick
        f.map = this.etatGel.map
        f.calendarScale = this.etatGel.calendarScale
        f.jourDeDepart = this.etatGel.jourDeDepart
        f.meteo = meteoFront
        f.meteoActive = true
        f.wind = this.view.wind
        const force = ventForceAt(f, this.predicted.x, this.predicted.y)
        // La PART au-dessus de l'ambiance — ce que les serpentins consomment. La sentinelle
        // du calme plat (force 0) tombe sous le plancher, donc à 0 par le clamp : un monde
        // sans vent n'a pas de rafale.
        this.ventPartIci = Math.min(1, Math.max(0, (force - VENT.AMBIANT) / (1 - VENT.AMBIANT)))
        // ⚠ L'AIGUILLE PREND LE CAP RALLIÉ, PAS LE CRAN DE LA SIM (Alexis, 2026-08-25 : « transition
        //   souple attendue sur l'icône »). Le cadran portait DÉJÀ une transition CSS de 900 ms et
        //   un angle déroulé (`barre-haute`) — mais on ne peut pas interpoler en douceur entre deux
        //   valeurs qui sautent de 45° : le DOM lissait fidèlement une marche d'escalier. C'est le
        //   même défaut que sur les tiges, au même endroit, et il se corrige au même robinet : le
        //   décor et l'aiguille disent maintenant le même vent, de la même façon.
        //   `force` reste celle de la SIM, mesurée AU POINT DU JOUEUR — elle ne se rallie pas.
        const capIcone = this.ventLisse.cap
        setHud(this.registry, 'vent', { x: capIcone.x, y: capIcone.y, force })
      }

      // ── LE CADRAN THERMIQUE (DEV) ── quatre fois par seconde de jeu, et par les fonctions
      // de `/sim` sur la MÊME façade que le gel : le panneau montre ce que la sim calcule,
      // il ne le refait pas. Depuis R11-R13 c'est la seule façon de VOIR pourquoi il neige.
      if (this.debugPanel && this.lastTime.tick - this.thermoAuTick >= THERMO_PAS_TICKS) {
        this.thermoAuTick = this.lastTime.tick
        const etat = this.etatGel
        const { x, y } = this.predicted
        const tx = Math.floor(x)
        const ty = Math.floor(y)
        const couverture = neigeAuSol(etat, tx, ty)
        this.debugPanel.majThermo({
          monde: dehorsSansMeteo(etat, x, y, this.lastTime.tick),
          lieu: baselineTemperature(etat, x, y),
          ressenti: ambientTemperature(etat, x, y),
          corps: this.myTemperature,
          cibleCorps: cibleCorporelle(ambientTemperature(etat, x, y)),
          ciel: meteoAspectAt(etat, x, y, this.lastTime.tick),
          intensite: meteoFront ? meteoIntensityAt(meteoFront, this.lastTime.tick, this.map.width, this.map.height, x, y) : 0,
          froidDuFront: meteoColdAt(etat, x, y, this.lastTime.tick),
          neige: couverture,
          niveauNeige: niveauPourCouverture(couverture, tx, ty),
          glace: estGele(etat, tx, ty),
        })
      }
      // ── LE CIEL S'ENTEND (spec meteo.md R9, chantier audio 2026-08-28) ──
      // Les deux nappes suivent l'ASPECT du front du jour au point du joueur (le même que
      // l'icône : le mur qui approche a déjà son timbre) et l'intensité ENTENDUE — le présent
      // plein, ou le murmure du front relu une minute de jeu EN AVANCE (la bande est une
      // fonction pure du tick : lire demain est gratuit). C'est le « on les entend avant de
      // les voir » de R9, au sens propre. Et le télégraphe de foudre GRÉSILLE au point visé
      // (R8), sur la sonde que FoudreFx vient de poser — un seul écrivain de la géométrie.
      {
        const iCiel = meteoFront
          ? meteoIntensityAt(meteoFront, this.lastTime.tick, this.map.width, this.map.height, this.predicted.x, this.predicted.y)
          : 0
        const iAvance = meteoFront
          ? meteoIntensityAt(
              meteoFront,
              this.lastTime.tick + AVANCE_S * BALANCE.TICK_RATE_HZ,
              this.map.width, this.map.height, this.predicted.x, this.predicted.y,
            )
          : 0
        this.sonsCiel.update((forme) => this.audioFx.nappe(forme), aspect, intensiteEntendue(iCiel, iAvance))
        const tel = this.foudreFx?.sonde
        if (tel && tel.ticksLeft > 0) {
          this.sonsCiel.gresille(time, tel.x, tel.y, tel.alpha, (sp, d2, at) => this.audioFx.play(sp, d2, at))
        }
      }
      // LA GERBE S'IMPUTE SUR LE BUDGET DE PARTICULES, elle ne s'empile pas à côté : le
      // rideau retranche de sa cible ce que les éclats occupent (au plus 48, ~7 %, 0,3 s).
      this.meteoLayer?.update(
        time, meteoFront, ciel, this.lastTime.tick, day, flash, this.predicted, this.cameras.main,
        this.foudreFx?.particulesReservees ?? 0,
        // LE RIDEAU PENCHE DANS LE SENS DU VENT (décision d'Alexis, 2026-08-25) : la force
        // latérale reste celle du CIEL (une pluie ne rase pas comme un blizzard), seul son
        // sens vient d'ici. Cap nul = calme plat = chute droite.
        this.view.wind.x === 0 && this.view.wind.y === 0 ? this.view.wind : this.ventRendu,
      )

      // LES SERPENTINS : le cap RALLIÉ, comme le rideau et l'aiguille — pendant les ~17 s d'un
      // virage, trois vents à l'écran (rubans sur le cran brut, pluie et aiguille sur le cap
      // lissé) racontaient deux vents différents. La part de souffle vient du relevé cadencé ;
      // à 0, la couche s'éteint entièrement — c'est un événement, pas une ambiance. La
      // sentinelle du calme plat passe telle quelle (cap nul = pas de rubans).
      this.ventLayer?.update(
        time,
        this.view.wind.x === 0 && this.view.wind.y === 0 ? this.view.wind : this.ventRendu,
        this.ventPartIci,
        this.cameras.main,
      )

      this.gelLayer?.update(this.etatGel, this.lastTime.tick, this.cameras.main)
      // LES EMPREINTES DANS LA NEIGE se recouvrent vite quand il neige ICI (au joueur) : la
      // chute est une bande qui traverse la carte — on lit son ASPECT au point (`null` hors
      // empreinte, `neige`/`blizzard` là où le froid du monde fait de la pluie des flocons).
      if (this.eauEvents) {
        const p = this.predicted
        const ici = meteoAspectAt(this.etatGel, p.x, p.y, this.lastTime.tick)
        this.eauEvents.neigeQuiTombe = ici === 'neige' || ici === 'blizzard'
      }
      // Les FEUILLUS SE DÉNUDENT (G6) — la vue des nœuds choisit la cime nue ou feuillue en
      // interrogeant `feuillageDenude` tuile par tuile, sur cette même façade.
      this.view.setEtatGel(this.etatGel)
    }

    // ON NE MARCHE PAS EN TAPANT. Le champ de recherche du panneau de craft prend
    // le clavier ; sans cette garde, écrire « hache » enverrait Z-A-H-E au
    // déplacement — le personnage partirait en courant pendant qu'on cherche.
    const typing =
      Boolean(getHud(this.registry, 'uiTyping')) ||
      Boolean(getHud(this.registry, 'chatTyping')) ||
      Boolean(getHud(this.registry, 'debugTyping'))
    // ON NE MARCHE PAS NON PLUS MORT, NI LE MENU OUVERT — deux trous du même mur.
    //
    // LA MORT : `tickHold` était déjà gardé par `this.dying` (dix lignes plus haut), le PAS
    // ne l'était pas. On mourait donc en fuyant — le cas normal —, et la prédiction continuait
    // d'intégrer ce cap sous l'écran noir : l'avatar réveillé au Feu s'en éloignait à l'aveugle.
    //
    // LE MENU PAUSE : `syncPause()` fige l'HÔTE, jamais la prédiction. Ouvrir ESC en tenant une
    // direction faisait glisser l'avatar sur un monde immobile, puis le premier snapshot le
    // rappelait sèchement — au-delà de `SNAP_DISTANCE_TILES` c'est un téléport franc avec
    // recentrage caméra. Et en MULTI le serveur ignore `pause` (« le monde des autres ne
    // s'arrête pas ») : on marchait pour de vrai. Un menu pause qui laisse jouer n'en est pas un.
    const fige = !mainsLibres({ saisit: typing, meurt: this.dying, enPause: this.menuPaused })
    const dx = fige ? 0 : this.axis('right', 'left')
    const dy = fige ? 0 : this.axis('down', 'up')
    const sprint = !fige && this.inputs.sprintKeys.some((k) => k.isDown)
    // LE PAS LENT (spec chasse C2) : il prime sur le sprint dans la sim — on
    // transmet les deux tels quels, c'est `speedScaleFor` qui arbitre.
    const sneak = !fige && this.inputs.sneakKeys.some((k) => k.isDown)
    // LA PARADE EST REVENUE (V0-1) : une STANCE maintenue (touche `block`, cf. keymap),
    // au même rang que le sprint et le pas lent — pas un verbe de ceinture. La sim, la
    // prédiction et `speedScaleFor` la connaissent depuis toujours ; on cesse enfin de
    // la forcer à `false`. Muette quand un champ de saisie a le clavier (on écrit).
    const block = !fige && this.inputs.blockKeys.some((k) => k.isDown)

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
    // LA CLARTÉ SUR SOI, lue AVANT le calcul de vitesse : elle sert deux fois — à prédire
    // comme l'autorité (4ᵉ argument ci-dessous), et à DIRE au joueur pourquoi son corps ne
    // suit pas. Avant la première façade d'état (toute première image), on suppose le jour.
    const clarte = this.etatGel
      ? clarteSurSoiAt(
          this.etatGel,
          this.lastSnapshotTick,
          this.predicted.x,
          this.predicted.y,
          this.itemTenu() === 'torche_vive',
          // LE PLANCHER : sous la roche le jour n'entre que par la gueule (E-R13, branche B1).
          this.etageJoueur,
        )
      : 1
    // Le sprint est sorti de la règle du noir (Alexis, 2026-09-02) : seule la GARDE la
    // rencontre encore, donc seul un joueur qui a levé sa garde a un refus à s'expliquer.
    this.direLeNoir(clarte, block)
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
      // LE FRONT SOUS LES PIEDS (spec meteo.md R7) — le 3ᵉ argument, et il n'est pas
      // décoratif : l'autorité multiplie déjà la vitesse par `meteoSpeedFactor` au point du
      // marcheur (`sim.ts`, dans `speedScaleFor`). Sans lui ici, la prédiction courrait 5 à
      // 20 % trop vite sous un front (jusqu'à ×0,8 sous blizzard) et l'avatar ferait de
      // l'élastique à chaque réconciliation. On lit le MÊME front, au MÊME point, par la
      // MÊME fonction pure — pas une seconde formule.
      // Depuis R12 le pas sous un orage dépend du froid du monde (heure, biome) : la loi lit
      // la façade d'état du gel, qui porte exactement ce que la sim lirait. Avant la première
      // façade (la toute première image), pas de front connu : facteur neutre.
      this.etatGel ? meteoSpeedFactorAt(this.etatGel, this.lastSnapshotTick, this.predicted.x, this.predicted.y) : 1,
      // LE PRIX DU NOIR (2026-08-26, **amendé le 2026-09-02**) — 4ᵉ argument. Il ne décide plus
      // de la VITESSE : le sprint est sorti de la règle, la clarté ne commande plus aucune allure
      // (`sim.ts`). Il reste passé parce que la formule est PARTAGÉE et qu'elle en tire encore la
      // parade — le client doit prédire la même chose que l'autorité, capacité par capacité, et
      // une seconde formule ici serait le défaut qu'on évite depuis le début.
      clarte,
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
    this.view.syncActor(this.playerSprite, render.x, render.y, 'spr-player', sneak || this.myButchering, 0, 0, this.etageJoueur)
    // ON NE SE VOIT PAS DEBOUT SUR SA PROPRE DÉPOUILLE (2026-08-31). Depuis que le corps reste
    // au sol, la caméra tient la tuile de chute pendant tout le voile — lequel est SEMI-opaque,
    // le monde y transparaît à dessein. L'avatar y restait planté, intact, à côté du cadavre
    // dont le voile dit « votre dépouille repose là où vous êtes tombé ». On l'efface : ce qui
    // reste à l'écran est la dépouille, et c'est exactement ce qu'on raconte.
    this.playerSprite.setVisible(!this.dying)
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
      // La poussière naît dans le monde du coureur : sur une terrasse, au-dessus de ses pavés.
      strate: strateDeProfondeur(this.playerSprite.depth),
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
    // ═══ CE QUE LA BARRE HAUTE DIT DU LIEU (2026-08-24) ═══
    // DEUX lectures, jamais `zoneAt` : `map.zones` mélange les toponymes et les lieux, et
    // `zoneAt` rend la première des deux selon l'ordre du tableau — la barre en fait deux
    // rangs, ils ne peuvent pas partager une lecture ambiguë. `zone` reste écrite telle
    // quelle : la carte plein écran et le survol s'en servent encore.
    setHud(this.registry, 'toponyme', toponymeAt(this.map, this.predicted.x, this.predicted.y))
    setHud(this.registry, 'lieu', lieuAt(this.map, this.predicted.x, this.predicted.y)?.name)
    // L'AIR QU'IL FAIT ICI, sur la MÊME façade que le gel et la neige (`etatGel`) : le nombre
    // ne peut donc jamais contredire la glace qu'on voit au sol. La façade ignore la Brume
    // (trou nommé dans `etat-gel.ts`) — le monde peint l'ignore aussi, les deux restent
    // d'accord, et c'est ce qui compte pour un HUD.
    if (this.etatGel && this.lastTime !== null && this.lastTime.tick - this.airAuTick >= AIR_PAS_TICKS) {
      this.airAuTick = this.lastTime.tick
      setHud(this.registry, 'ambiant', ambientTemperature(this.etatGel, this.predicted.x, this.predicted.y))
    }
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
    if (event.key === 'Enter' && !getHud(this.registry, 'uiTyping') && !getHud(this.registry, 'debugTyping')) {
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
    publishTimeAndVillage(this.registry, msg.time, myVillage)
    this.lastTime = msg.time
    // LES ÂGES DES FOYERS DE CENDRE — dix nombres, et toute la frange s'en dérive (spec
    // `cendre.md`). On les garde tels quels : la couche les compare d'une image à l'autre et ne
    // recuit que s'ils ont bougé.
    // LES ÂGES DES FOYERS — dix nombres, et toute la frange s'en dérive. Quand ils bougent (au
    // plus une fois par jour de saison, et pas du tout si tous les foyers sont gelés), on jette
    // les chunks de sol qui portent de la cendre : ils se recuiront à la demande, avec elle.
    const avant = this.cendreAge
    this.cendreAge = msg.cendreAge ?? []
    this.view.cendreAge = this.cendreAge // le rendu applique R13 (l'arbre tombé n'est plus dessiné)
    if (this.paves) {
      this.paves.cendreAge = this.cendreAge
      if (avant.length === 0 && this.cendreAge.length > 0) this.paves.cendreABouge()
      if (this.cendreAge.length !== avant.length
        || this.cendreAge.some((a, k) => Math.round(a * 10) !== Math.round((avant[k] ?? -1) * 10))) {
        this.paves.cendreABouge()
      }
    }

    // LES STRUCTURES D'AVANT, POUR LE SON — et pour elles seules. `syncStructures` fait
    // `this.structures = structures` : passé la ligne suivante, une structure DÉTRUITE à ce
    // tick a disparu du tableau, or c'est exactement celle dont `structure_destroyed` doit
    // dire l'endroit. On garde la référence du tableau précédent (il n'est pas muté).
    const structuresAvant = this.view.structures
    // Le monde d'abord : la réconciliation ci-dessous rejoue la prédiction
    // contre les structures/nœuds de CE snapshot, pas du précédent.
    this.view.apply(msg, this.playerId, this.time.now)
    // Le conteneur ouvert (loot) résolu contre CE snapshot : une dépouille vidée
    // s'efface (spec R16), ou le joueur s'en est éloigné hors de portée → le
    // panneau se referme au lieu de planter sur un id mort ou de rester fantôme.
    publishOpenContainer(this.registry, this.view.structures, this.view.corpses, this.predicted)
    this.processEvents(msg, structuresAvant)
    this.updateCorpseTracker(msg)
    this.publierMonEtatAuSol(msg)

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
      this.myFishing = me.fishing !== undefined
      this.myButchering = me.butchering !== undefined
      this.reconcile(me, msg.lastProcessedInput)
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
   * ═══ PAS DE TUTORIEL EN JEU (décision d'Alexis, 2026-08-25 : « retire les tutos ingame ») ═══
   *
   * Sept conseils naissaient d'une condition de jeu et passaient par la file `conseils` —
   * les bases, le feu, l'abattage, le don, la parade. Ils sont RETIRÉS, module compris : le
   * jeu ne s'explique plus par-dessus l'épaule du joueur.
   *
   * ⚠ CE QU'ILS DISAIENT N'EST PAS PERDU. Le menu pause porte les règles centrales depuis
   * qu'on a cessé de ne les dire qu'à l'accueil (`pause-menu.ts`), et les fiches de métier
   * (`skill-guide.ts`) portent les paliers. La file `conseils` reste vivante — elle sert
   * encore aux prises de pêche, aux refus et aux bascules de son : c'est le TUTORIEL qui
   * part, pas le canal.
   */
  /**
   * LE NOIR SE DIT UNE FOIS, ET IL SE REDIT LA NUIT SUIVANTE.
   *
   * Le refus de la parade (`NUIT.SEUIL_NOIR`) est une règle qu'on sent avant de la comprendre :
   * on appuie, le corps ne suit pas. Un joueur qui ne l'a jamais rencontrée lirait ça comme une
   * touche cassée — donc on le DIT, mais une seule fois par plongée dans le noir, et seulement
   * s'il a VRAIMENT essayé (la garde ; **le sprint est sorti de la règle le 2026-09-02**, la
   * phrase ne doit donc plus le nommer ni se déclencher dessus). Ce n'est pas un tutoriel
   * (2026-08-25) : c'est le canal de REFUS, celui qui explique un geste qui vient d'échouer.
   *
   * Le drapeau se relève dès que la clarté repasse le seuil — au feu, à la torche, à l'aube :
   * la nuit d'après, la phrase revient. Sans ce retour, un joueur qui l'a lue distraitement
   * la première nuit ne la reverrait jamais.
   */
  private noirDit = false
  private direLeNoir(clarte: number, aEssaye: boolean): void {
    if (clarte >= NUIT.SEUIL_NOIR) {
      this.noirDit = false
      return
    }
    if (!aEssaye || this.noirDit) return
    this.noirDit = true
    publishHint(this.registry, 'Trop noir pour parer — il faut une flamme.', this.time.now)
  }

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
   * LES CORPS QUE CE COUP ARMÉ PRENDRAIT MAINTENANT (item 2, spec R15).
   *
   * La DÉCISION vit dans `world/cibles.ts` — pure et gardée. Elle est sortie d'ici pour la
   * raison qui a déjà sorti `encaissement` et `desequilibre` d'`attack-fx` : du branchement
   * neuf sans garde est du code dont rien, à l'écran, ne distingue « ça marche » de « ça
   * sort tôt à chaque image ». Ici il ne reste que la peinture.
   */
  private designerLesCibles(
    w: { id: number; dx: number; dy: number; strike: Strike; ranged: boolean },
    spriteOf: (id: number) => Phaser.GameObjects.Image | null,
  ): void {
    for (const id of ciblesDesignees(w, this.lastEntities, this.playerId)) {
      const sp = spriteOf(id)
      if (sp) this.attackFx.cible(sp)
    }
  }

  private checkVitals(): void {
    if (!getHud(this.registry, 'worldReady')) return
    // LA FAIM TUE désormais : à 0, les PV fondent. On le dit, fort.
    if (this.myHunger <= 0) this.warn('famine', 'VOUS MOUREZ DE FAIM.', 6000)
    else if (this.myHunger < 25) this.warn('faim', 'La faim vous tenaille — il faut manger.', 45000)
    // Le froid tue aussi, et il tue plus vite qu'on ne le croit.
    // Les deux seuils sont ceux du CORPS, en °C (l'échelle est métrique depuis le
    // 2026-08-22) : 29 = hypothermie (les PV partent), 33 = on commence à trembler — la
    // moitié de la rampe d'engourdissement, là où l'ex-jauge disait 45.
    if (this.myTemperature <= TEMPERATURE.CORPS_HYPOTHERMIE) this.warn('gel', 'VOUS GELEZ. Trouvez un feu.', 6000)
    else if (this.myTemperature < SEUIL_FRISSON) this.warn('froid', 'Le froid vous prend.', 45000)
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

  /**
   * ═══ OÙ S'ENTEND CE FAIT ═══ (spatialisation du son, 2026-08-27)
   *
   * Trois issues, et la troisième est la plus intéressante :
   *  - un LIEU en tuiles — le son se panoramique et s'atténue autour de l'auditeur ;
   *  - `'monde'` — une ANNONCE (la nuit, l'acte, la fin de saison, le présage d'une horde née
   *    au loin). Elle sonne au centre et plein, par décision écrite dans `inventaire.ts` ;
   *  - `'hors'` — le sujet du fait n'est PAS dans le snapshot. Le son ne part alors pas du tout.
   *
   * ═══ POURQUOI « INTROUVABLE » VEUT DIRE « TROP LOIN », ET NON « DÉFAUT » ═══
   * Les collections spatiales du snapshot sont rognées au rayon d'intérêt (`interest.ts`,
   * 64 tuiles). Un PNJ qui forge à l'autre bout de la vallée n'est donc dans AUCUNE des deux
   * listes d'entités — et c'est très exactement ce qu'il fallait apprendre : il est à plus de
   * 64 tuiles, donc au-delà de la portée du son (26,7). Ne pas jouer est la bonne réponse,
   * pas un pis-aller. La prémisse — `PORTEE_TUILES < INTEREST_RADIUS_TILES` — est tenue par
   * une garde de `spatial.test.ts` : si quelqu'un pousse la portée au-delà de 64, ce
   * raisonnement cesse d'être vrai et le test rougit.
   * (Les NŒUDS échappent à la règle : leur liste part ENTIÈRE au `ready`, jamais rognée.
   * Un arbre qui tombe à 800 tuiles se situe donc parfaitement — et se fait couper par la
   * distance, ce qui est le même résultat par un plus beau chemin.)
   *
   * La règle de résolution est DÉCLARÉE fait par fait dans `inventaire.ts` (`ou`), et le type
   * l'exige de tout fait qui a une voix : pas de sonde sur les champs présents, qui rendrait
   * `null` là où elle ne trouve rien — c'est-à-dire qui rejouerait le défaut qu'on corrige.
   *
   * L'ORDRE DES SOURCES suit celui de `eventConcernsMe` :
   *  - MOI, c'est `predicted` et non ma position autoritative — un fait qui m'arrive doit sonner
   *    EXACTEMENT au centre, et l'autorité a un demi-pas de retard en pleine course. C'est ce
   *    qui rend inutile tout cas particulier « sur moi » : à écart nul, `placer` rend pan 0,
   *    gain 1, aucun voile — le son d'avant.
   *  - les entités de CE snapshot d'abord, celles du PRÉCÉDENT ensuite : `processEvents` tourne
   *    avant `this.lastEntities = msg.entities`, et c'est ce décalage qui permet de situer un
   *    `entity_died` — le mort n'est plus dans le message qui annonce sa mort.
   *  - les structures d'AVANT en second recours, pour la même raison (`structure_destroyed`).
   */
  private lieuDeLEvenement(
    e: SimEvent,
    entiteParId: (id: number) => { x: number; y: number } | null,
    structuresAvant: Structure[],
  ): { x: number; y: number } | 'monde' | 'hors' {
    const ou = INVENTAIRE[e.type].ou
    if (ou === undefined || ou === 'monde') return 'monde'
    const any = e as {
      x?: number
      y?: number
      tx?: number
      ty?: number
      entityId?: number
      targetEntityId?: number
      byEntityId?: number
      nodeId?: number
      structureId?: number
      villageId?: number
    }
    // Le champ déclaré manque, ou le sujet n'est pas dans le snapshot : dans les deux cas il
    // est au-delà du rayon d'intérêt (le type garantit que le champ EXISTE sur ce fait-là).
    // L'ACTEUR ZÉRO N'EST PAS « LOIN », IL EST « PERSONNE ». `/sim` écrit `byEntityId: 0`
    // quand c'est LE VILLAGE qui agit, pas quelqu'un (`village-growth.ts` :
    // « patron porte rituelle »). Le résoudre échouerait, et l'échec serait lu comme « hors
    // du rayon d'intérêt » — un fait qui se passe peut-être sous vos yeux, tu en silence.
    const parActeur = (id: number | undefined): { x: number; y: number } | 'monde' | 'hors' =>
      id === undefined ? 'hors' : id === 0 ? 'monde' : (entiteParId(id) ?? 'hors')

    switch (ou) {
      case 'xy':
        return any.x !== undefined && any.y !== undefined ? { x: any.x, y: any.y } : 'hors'
      case 'tuile':
        return any.tx !== undefined && any.ty !== undefined ? { x: any.tx + 0.5, y: any.ty + 0.5 } : 'hors'
      case 'entite':
        return parActeur(any.entityId)
      case 'cible':
        return parActeur(any.targetEntityId)
      case 'auteur':
        return parActeur(any.byEntityId)
      case 'noeud': {
        const n = any.nodeId !== undefined ? this.view.noeudParId(any.nodeId) : undefined
        return n ? { x: n.tx + 0.5, y: n.ty + 0.5 } : 'hors'
      }
      case 'structure': {
        const id = any.structureId
        if (id === undefined) return 'hors'
        const st = this.view.structures.find((v) => v.id === id) ?? structuresAvant.find((v) => v.id === id)
        return st ? { x: st.tx + 0.5, y: st.ty + 0.5 } : 'hors'
      }
      case 'village': {
        // ⚠ MON VILLAGE EST UNE ANNONCE, OÙ QUE JE SOIS. Trois des six faits ancrés sur un
        // Feu sont des ALERTES sur le sien — « le Feu tombe à SEC, les murs vont céder »,
        // « le village est TOMBÉ », l'alarme — et être ailleurs est très exactement le moment
        // où elles comptent. Les couper à 27 tuiles rendrait le joueur sourd à ce qu'il doit
        // le plus savoir. Le Feu des AUTRES, lui, se place et se coupe : c'était le correctif.
        if (any.villageId !== undefined && any.villageId === this.myVillageId) return 'monde'
        const v = any.villageId !== undefined ? this.view.villages.find((w) => w.id === any.villageId) : undefined
        return v ? { x: v.fireTx + 0.5, y: v.fireTy + 0.5 } : 'hors'
      }
    }
  }

  private processEvents(msg: SnapshotMessage, structuresAvant: Structure[]): void {
    // Une reprise a réamorcé `eventLog` mais n'a pas pu publier (pas de noms de village
    // avant ce premier snapshot) : on force UNE republication ici, puis on désarme.
    let chronicleDirty = this.chronicleReseedPending
    this.chronicleReseedPending = false
    // ═══ UN MÊME FAIT, DEUX FOIS DANS LE MÊME TICK : UNE SEULE VOIX ═══
    //
    // LES DEUX BATTANTS D'UNE PORTE DOUBLE (R27) : `toggle_door` émet un fait PAR VANTAIL qui
    // change, donc un cadre apparié en émet deux au même tick. On ne joue que le premier — deux
    // oscillateurs identiques superposés ne font pas une seconde porte, ils font la même porte
    // trop fort. Seul le SON est dédoublonné : le battant, lui, pivote par `structureId`
    // (`porte-anim`), chacun le sien.
    //
    // LE BUTIN DE MAÎTRISE fait exactement la même chose et personne ne l'avait vu : cueillir un
    // coin riche émet `resource_harvested` pour la poignée PUIS pour la graine (`economy.ts`,
    // « le butin de maîtrise »). Ça ne s'entendait pas tant que la récolte était un bip
    // d'interface ; depuis qu'elle est de la MATIÈRE, deux froissements superposés font un
    // froissement deux fois trop fort — et seulement sur les meilleurs coins, ce qui est
    // précisément l'endroit où on n'a pas envie que le jeu ait l'air cassé.
    const garderUneVoix = filtreDeDoublons()

    // ── LE SON SE PLACE (spatialisation, 2026-08-27) ─────────────────────────────────────
    // L'AUDITEUR, c'est l'avatar prédit — pas la caméra : `startFollow` est lissée (0,16) et
    // garde un décalage volontaire à la visée, donc panoramiquer sur elle ferait trembler le
    // côté d'un son à chaque pas.
    this.audioFx.setEcoute(this.predicted.x, this.predicted.y)
    // L'INDEX DES ACTEURS, monté À LA DEMANDE : la plupart des snapshots n'apportent aucun
    // fait, et ceux qui en apportent n'en ont souvent qu'un — le monter d'office serait une
    // Map de deux cents entrées vingt fois par seconde pour rien. `lastEntities` (le tick
    // PRÉCÉDENT) se pose en premier et `msg.entities` l'écrase : l'état frais gagne, mais un
    // mort — absent du message qui annonce sa mort — garde la position qu'il occupait.
    let index: Map<number, { x: number; y: number }> | undefined
    const entiteParId = (id: number): { x: number; y: number } | null => {
      if (id === this.playerId) return this.predicted
      let idx = index
      if (!idx) {
        idx = new Map<number, { x: number; y: number }>()
        for (const e of this.lastEntities) idx.set(e.id, { x: e.x, y: e.y })
        for (const e of msg.entities) idx.set(e.id, { x: e.x, y: e.y })
        index = idx
      }
      return idx.get(id) ?? null
    }

    for (const event of msg.events) {
      // LE SON (échafaudage) : chaque fait de domaine peut sonner (table pure `soundForEvent`),
      // « sur moi » ou non selon l'entité concernée. Muet si coupé / contexte pas réveillé.
      const spec = soundForEvent(event, this.eventConcernsMe(event))
      // La règle « une seule voix par tick » est PURE et testée (`filtreDeDoublons`) : elle
      // ne prend le tour que sur un fait qui SONNE vraiment, sans quoi la récolte muette des
      // PNJ avalerait mon coup de hache. Le détail vit sur la fonction, pas ici.
      if (spec && garderUneVoix(event.type, event.tick, true)) {
        const lieu = this.lieuDeLEvenement(event, entiteParId, structuresAvant)
        if (lieu === 'hors') this.sonsHorsInteret += 1
        else this.audioFx.play(spec, 0, lieu === 'monde' ? undefined : lieu)
      }
      // LE BATTANT PIVOTE SUR LE FAIT (`door_toggled`), jamais sur la différence d'état — c'est
      // ce qui empêche tout un village de s'ouvrir en fanfare à la reconnexion. Il ne se déplie
      // PLUS ici : `SnapshotView.apply` le lit en tête, avant de peindre quoi que ce soit. D'ici,
      // on arrivait UN SNAPSHOT trop tard et la porte se montrait ouverte avant de s'ouvrir
      // (constaté par Alexis le 2026-07-30 ; le pourquoi est écrit sur `pousserPorte`).
      if (event.type === 'bird_flush') {
        // LA NUÉE (forêts-vivantes §3) : rendue DEPUIS le fait — jamais une information
        // que la sim n'a pas émise. Le cri, lui, part par la table `soundForEvent`.
        this.ambientLife?.envol(event.x + 0.5, event.y + 0.5)
      } else if (event.type === 'action_rejected' && event.entityId === this.playerId) {
        publishError(this.registry, event.reason, this.time.now)
      } else if (event.type === 'fish_bite') {
        // LA TOUCHE (peche.md R3) : le flotteur plonge — pour quiconque pêche à l'écran.
        this.pecheFx.bite(event.entityId, this.time.now)
      } else if (event.type === 'fish_caught') {
        // LA PRISE (R4) : la canne se cambre, le poisson sort. Le butin, lui, passe par
        // `resource_harvested` (ci-dessous), comme toute récolte.
        this.pecheFx.caught(event.entityId, event.item, this.time.now)
        // LA FICHE DE PRISE (peche.md R11) : l'espèce et la TAILLE, en clair. Sans elle, D12
        // serait invisible — le sac ne dit que « brochet ×3 », jamais qu'il faisait 84 cm.
        if (event.entityId === this.playerId) {
          const sp = FISH_SPECIES.find((x) => x.id === event.species)
          const cm = Math.round(event.mm / 10)
          publishHint(this.registry, `${sp?.label ?? 'prise'} — ${cm} cm`, this.time.now)
        }
      } else if (event.type === 'fish_nibble') {
        // ÇA MORDILLE (D11/R10) : un tressaut, pas la plongée. C'est le SIGNAL d'une eau
        // pauvre — le seul retour d'information que D11 donne au joueur.
        this.pecheFx.nibble(event.entityId, this.time.now)
      } else if (event.type === 'fishing_junk') {
        // UNE TROUVAILLE (T4) : le même geste que la prise, mais ce n'est pas un poisson —
        // le FX dessine l'item remonté, quel qu'il soit.
        this.pecheFx.caught(event.entityId, event.item, this.time.now)
      } else if (event.type === 'fish_record') {
        if (event.entityId === this.playerId) {
          const sp = FISH_SPECIES.find((x) => x.id === event.species)
          publishHint(this.registry, `record : ${sp?.label ?? 'prise'} de ${Math.round(event.mm / 10)} cm`, this.time.now)
        }
      } else if (event.type === 'fishing_cancelled') {
        // LA LIGNE RENTRE, ET ON DIT POURQUOI (E4) : l'eau s'est retirée, a pris, ou ne donne
        // rien. Une ligne qui disparaît sans un mot est un bug aux yeux du joueur.
        this.pecheFx.escaped(event.entityId, this.time.now)
        if (event.entityId === this.playerId) publishHint(this.registry, event.reason, this.time.now)
      } else if (event.type === 'fish_escaped') {
        this.pecheFx.escaped(event.entityId, this.time.now)
      } else if (event.type === 'carcass_cut') {
        // LA COUPE (depecage.md R2c) : une part sort de la bête — le sang gicle à l'OPPOSÉ du
        // chasseur (la règle des gerbes), pour quiconque dépèce à l'écran ; le butin, lui,
        // n'est que le mien.
        const ou = this.view.corpsePx(event.corpseId)
        const qui = event.entityId === this.playerId ? this.playerSprite : (this.view.others.get(event.entityId)?.sprite ?? null)
        if (ou && qui) this.sangFx.gicler(ou.x, ou.y, 4, this.time.now, qui.x, qui.y, strateDeProfondeur(qui.depth))
        if (event.entityId === this.playerId) publishPickup(this.registry, event.item, 1)
      } else if (event.type === 'resource_harvested' && event.entityId === this.playerId) {
        // LE COUP A PORTÉ — et on ne le sait QUE parce que la sim le dit (G9). Rien
        // n'est affiché au clic : un « +1 bois » qui monte avant le refus de la sim
        // serait un mensonge, et le client n'a pas le droit de mentir (invariant §3).
        // Le nœud tressaille, ET la matière lui est arrachée — la gerbe part de la face
        // qui me fait FACE, d'où la position du récolteur (`playerSprite`, en px monde).
        // C'est `snapshot-view` qui l'émet : elle seule sait où le sprite du nœud est
        // réellement posé cette frame. Ici on ne fait que consigner le coup.
        // UN COIN DE PÊCHE ne tressaille pas (rien n'est frappé) : sa prise a son rendu
        // (`pecheFx.caught`), le coup de récolte commun n'y a rien à peindre.
        const noeudPeche = this.view.nodes.some((n) => n.id === event.nodeId && estUnCoinDePeche(n.type))
        if (!noeudPeche) {
          this.hitFx.hit(
            event.nodeId,
            this.time.now,
            this.playerSprite.x,
            this.playerSprite.y,
            event.count,
            event.clean === true,
          )
        }
        publishPickup(this.registry, event.item, event.count) // et le butin s'inscrit au HUD
        // LE TEMPO du minage : le dernier coup relance le rechargement, que la lueur du
        // bon flanc REFORME visiblement (verbe 2 — la cadence se voit, pas de timer caché).
        this.lastStrikeAt = this.time.now
      } else if (event.type === 'coin_eteint' || event.type === 'coin_seme') {
        // LE COIN VIVANT (faune R27) : la liste des coins reçue au `ready` n'est plus
        // immuable — le front la mange, le monde la ressème. Le client SUIT les faits :
        // c'est cette liste que liront les traces au sol (R24), jamais une copie figée.
        if (event.type === 'coin_eteint') this.grounds = this.grounds.filter((g) => g.x !== event.x || g.y !== event.y)
        else this.grounds = [...this.grounds, { x: event.x, y: event.y }]
        this.tracesLayer?.rebuild(this.map, this.grounds, this.worldSeed) // les traces suivent les coins
      } else if (event.type === 'poi_discovered' && event.byEntityId === this.playerId) {
        // MONTER, C'EST VOIR (spec lieux.md) : un lieu qui révèle un RAYON dévoile aussi le
        // TERRAIN de ce rayon, pas seulement les pastilles. C'est ce qui referme la boucle
        // d'exploration — on repère un monument, on y va, et la carte s'ouvre autour de lui.
        // La sim reste seule juge de la découverte (elle a émis l'événement) ; le client ne
        // fait que lever SON brouillard, qui est un objet d'affichage (voir `fog`).
        const rayon = revealRadiusOf(event.kind)
        const lieu = this.map.zones[event.poiId]
        if (rayon > 0 && lieu && this.fog) {
          const lx = lieu.x + lieu.w / 2
          const ly = lieu.y + lieu.h / 2
          const neuf = revele(this.fog, lx, ly, rayon)
          // Le savoir-cendre du même rayon : ce qu'un monument montre, la carte le retient.
          const su = estampilleCendre(
            this.fog, this.map, lx, ly, rayon,
            avanceesDepuisAges(this.cendreAge, this.cendreAge.length),
          )
          if (neuf || su) {
            setHud(this.registry, 'fogVersion', (getHud(this.registry, 'fogVersion') ?? 0) + 1)
            this.peindreCarteDisque(lx, ly, rayon)
          }
        }
      } else if (event.type === 'poi_first_visit' && event.byEntityId === this.playerId) {
        // ON ARRIVE QUELQUE PART, ET ÇA SE DIT UNE FOIS (2026-08-25, modèle The Long Dark).
        // C'est la contrepartie du silence du paysage : `poi-layer` ne suspend plus les noms
        // au-dessus du monde, donc c'est ici — et ici seulement — qu'un lieu se nomme de
        // lui-même. Le nom vient de la sim (`event.name`), qui l'a baptisé à la génération :
        // le client n'invente aucun toponyme.
        if (!KINDS_SANS_BANDEAU.includes(event.kind)) publishDecouverte(this.registry, event.name)
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
      } else if (event.type === 'attack_whiffed') {
        // ═══ LE COUP A FENDU L'AIR — ET ÇA SE VOIT ENFIN (2026-08-28) ═══
        //
        // `recoveryWhiff` cloue jusqu'à 1,6 s : c'est la meilleure mécanique du combat de
        // coût, et la fenêtre où le loup entre. Elle n'avait aucune expression à l'écran —
        // le joueur mourait pendant une immobilité qu'il attribuait au jeu, pas à son
        // geste. Le corps part maintenant avec son élan et se rattrape, garde ouverte.
        const rate = this.ratesAVenir.get(event.entityId)
        const corps =
          event.entityId === this.playerId ? this.playerSprite : (this.view.others.get(event.entityId)?.sprite ?? null)
        if (rate && corps) this.attackFx.rate(corps, this.time.now, rate.dx, rate.dy, rate.ms)
        this.ratesAVenir.delete(event.entityId)
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
          this.attackFx.impact(cible, now, frappeur?.x, frappeur?.y, event.amount)
          // LA MATIÈRE DE LA CIBLE décide de ce qui jaillit — la MÊME frontière que la
          // sim, qui ne fait saigner au sol que ce qui a du sang (`habitat` non vide,
          // combat.ts) : la chair GICLE (sang-fx, balistique, ça se pose), le Cendreux
          // s'EFFRITE (brisures de cendre et de braise morte). Un humain — avatar ou
          // PNJ, donc sans fiche de monstre — est de chair.
          const monstre = this.view.monsters.find((m) => m.entityId === event.entityId)
          const chair = monstre === undefined || (MONSTER_DEFS[monstre.type].habitat?.length ?? 0) > 0
          this.attackFx.spark(cible.x, cible.y, event.amount, onMe, now, frappeur?.x, frappeur?.y, chair ? null : BRISURES_CENDRE)
          if (chair) this.sangFx.gicler(cible.x, cible.y, event.amount, now, frappeur?.x, frappeur?.y, strateDeProfondeur(cible.depth))
        }
        if (onMe) {
          this.attackFx.hurt(now) // l'écran saigne…
          // …et la caméra encaisse. PUREMENT visuel : la position reste autoritative,
          // rien de ce qui suit ne touche la simulation (multi).
          this.cameras.main.shake(90, 0.006)
        } else if (event.byEntityId === this.playerId) {
          // MON COUP A PORTÉ. Une secousse BRÈVE et franchement plus faible que celle
          // qu'on encaisse : elle doit confirmer le contact, jamais le disputer au coup
          // reçu — sinon frapper et être frappé se ressentent pareil, et la seule
          // information qui compte vraiment dans une mêlée (« qui prend ? ») se noie.
          //
          // ELLE SUIT LES DÉGÂTS depuis le 2026-08-27, comme le recul peint : à secousse
          // fixe, un coup de poing et un tourbillon de hache rendaient le même cadre, et
          // l'identité par la FORME de `combat.md` R4bis s'arrêtait au sol. La borne haute
          // reste sous 0,006 — la garde de `encaissement.test.ts` l'affirme.
          this.cameras.main.shake(SECOUSSE_PORTE_MS, secousseDuCoup(event.amount))
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
        // ⚠ LE VERBE S'ACCORDE AVEC LA MEUTE, donc il vit DANS la branche : « Un loup vous ont
        // choisi » s'affichait tel quel à chaque hurlement solitaire — vu en capture le
        // 2026-08-26. Un accord laissé hors du ternaire est un accord qu'on oublie.
        const meute = event.packSize > 1
          ? `${event.packSize} loups vous ont choisi`
          : 'Un loup vous a choisi'
        publishError(this.registry, `Un hurlement, tout près. ${meute}.`, this.time.now)
      } else if (event.type === 'cendreux_prowl' && event.targetEntityId === this.playerId) {
        // LE PENDANT DU HURLEMENT, pour les morts (spec `cendreux.md` R11). La nuit bascule
        // d'espèce avec les actes, et son avertissement bascule avec elle : le joueur doit
        // savoir CE QUI vient, parce qu'on ne distance pas un loup et qu'on distance un
        // Cendreux — la parade n'est pas la même.
        const combien = event.count > 1 ? `${event.count} Cendreux` : 'Un Cendreux'
        publishError(this.registry, `Un raclement dans le noir. ${combien} vous ont senti.`, this.time.now)
      } else if (event.type === 'cendreux_cri') {
        // LE CRI DE FUREUR (décisions ④⑤, 2026-08-21). Il ne vise pas que le joueur — mais
        // c'est toujours à lui qu'on parle : le sol va se lever là où le crieur a VU.
        publishError(this.registry, 'Un cri qui n’a rien d’humain. Le sol se réveille tout autour.', this.time.now)
      } else if (event.type === 'presage_horde') {
        // LE PRÉAVIS DE LA VEILLE (décision ⑱) : la horde de CE SOIR s'annonce à l'aube —
        // avec sa DIRECTION (huit vents, patron des bandeaux existants), pour qu'on prépare
        // la nuit : rentrer du bois, fermer la porte, poster les siens.
        const me = this.lastEntities.find((e) => e.id === this.playerId)
        let dir = ''
        if (me) {
          const dx = event.x - me.x
          const dy = event.y - me.y
          const ns = dy < -8 ? 'nord' : dy > 8 ? 'sud' : ''
          const eo = dx > 8 ? 'est' : dx < -8 ? 'ouest' : ''
          dir = ns && eo ? `${ns}-${eo}` : ns || eo
        }
        publishError(this.registry, `Au loin${dir ? ' vers le ' + dir : ''}, le sol travaille — la faune s’est tue. La nuit prochaine appartiendra aux morts.`, this.time.now)
      } else if (event.type === 'blizzard_annonce') {
        // LA VEILLE DU BLIZZARD (spec meteo.md R9) : « la réponse est PRÉPARER — rentrer le
        // bois ». La sim émettait, la chronique gardait la phrase pour le voile de fin de
        // saison — et RIEN ne la portait à l'écran au moment utile : le joueur découvrait le
        // blizzard le matin même, à l'icône. Patron `presage_horde` (l'autre préavis de la
        // veille), par le canal des bandeaux faute d'audio (le son est acté « après GATE 1 »).
        // `blizzard_entre`/`blizzard_passe` restent muets : le ciel les dit lui-même (S17,
        // « le monde le dit, l'interface non » — la veille est la seule chose qu'il ne peut
        // pas dire).
        publishError(this.registry, 'Le vent du nord se lève — un blizzard couvrira la vallée demain. Rentrez le bois.', this.time.now)
      } else if (event.type === 'charnier_brule') {
        // LE GESTE A PRIS (décision ⑧) : sans retour à l'écran, brûler un charnier serait un
        // acte de foi — la parade doit prouver qu'elle a marché (le patron de `reveil_etouffe`).
        publishError(this.registry, 'Le feu a pris dans la fosse. Les morts d’ici dormiront plus profond, un temps.', this.time.now)
      } else if (event.type === 'cendreux_risen') {
        // IL SORT DE TERRE (spec `cendreux.md` R21). `cendreux_risen` a DEUX émetteurs — la
        // levée d'un cadavre, qui est déjà couché sur le sol et ne creuse rien, et
        // l'émergence d'un réveil. `emerger` les distingue sur le SITE (il rend `false` pour
        // la levée) : la sim n'a pas à porter un second nom pour un seul fait, et on ne
        // touche pas à /sim pour une question de rendu.
        this.reveilFx.emerger(event.x, event.y, event.entityId, this.time.now)
      } else if (event.type === 'bete_cendreuse_levee') {
        // LA BÊTE SORT DE TERRE (cendre.md R30a) — le MÊME tertre que le Cendreux : la cendre
        // rend ce qu'elle a pris par le même geste, l'œil n'a pas deux grammaires à apprendre.
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
      publishChronicle(this.registry, this.eventLog, this.calendarScale, this.jourDeDepart, msg.villages, this.map)
    }
  }

  /**
   * LE MOMENT DE MORT (mort-suite 1+5) : de la chute au réveil au Feu. On FIGE la caméra
   * là où elle est — sur la tuile de chute, où la dépouille va se poser — et on COUPE
   * l'input (on ne joue pas pendant qu'on tombe). Le respawn au Feu (un saut à travers la
   * carte) reste neutralisé TOUT le temps du voile : la sim, elle, a déjà relevé l'avatar
   * là-bas, mais on ne le montre pas avant que le joueur l'ait demandé.
   */
  private enterDying(): void {
    this.dying = true
    this.dyingVeilVu = false
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
   * Les transitions du moment de mort, testées EN NIVEAU (voir `dying`). Appelé chaque frame
   * tant qu'on tombe : quand le voile retombe — c'est-à-dire quand la SIM a confirmé le réveil
   * — on snappe la caméra au Feu ET on rend la main. Le même instant, parce que c'est le même
   * événement.
   */
  private tickDying(): void {
    if (!this.dying) return
    // LA MAIN REVIENT AVEC LE VOILE, PAS AVANT (décision d'Alexis, 2026-08-20, question ⑥).
    //
    // Elle était rendue à `DEATH_VEIL_MS` — exactement l'instant où le voile se retirait : les
    // deux n'étaient qu'un seul événement. Depuis que le voile attend le geste « SE RELEVER »,
    // les deux doivent le rester, sinon on se remet à marcher DERRIÈRE un voile qui couvre
    // tout l'écran. On lit donc l'état RÉEL du voile.
    //
    // ⚠ PLUS DE FILET ICI (2026-08-31). Il y en avait un, à `DEATH_VEIL_FILET_MS`, jumeau de
    // celui d'UIScene : deux minuteurs partis du même instant pour deux sorties différentes.
    // Depuis que la sim garde le corps à terre, celui-ci ne rendait qu'une main que la sim
    // REFUSE (`step` jette tout input d'un tombé) — et s'il gagnait la course d'une image, le
    // rattrapage par l'état relevait le voile sur une cause perdue. Un seul filet subsiste,
    // celui d'UIScene, et il pose ce qui débloque VRAIMENT : l'action `respawn`.
    //
    // ⚠ IL FAUT AVOIR VU LE VOILE LEVÉ. UIScene ne pose `deathVeilOpen` qu'à son propre update ;
    // entre la chute (lue dans le handler de snapshot) et ce moment-là, l'absence du drapeau
    // ne veut PAS dire « voile retombé », elle veut dire « pas encore levé ». Sans cette
    // mémoire, une frame malchanceuse rendrait la main — et, depuis que le saut de caméra
    // pend à la même condition, ferait le saut À L'AIR LIBRE.
    const voileLeve = getHud(this.registry, 'deathVeilOpen') === true
    if (voileLeve) this.dyingVeilVu = true
    if (this.dyingVeilVu && !voileLeve) {
      // ON NE SE RELÈVE QU'APRÈS L'AVOIR DEMANDÉ (2026-08-31). Le saut au Feu se faisait à
      // `DEATH_FADE_MS + 80` — sous un voile qu'on croyait opaque. Il ne l'est pas : il est à
      // 86 % et le monde y « transparaît en fantôme », À DESSEIN. On voyait donc son avatar
      // debout au Feu pendant les trente secondes du voile, relevé sans l'avoir demandé. Le
      // saut appartient au GESTE, comme la main : la caméra reste sur la tuile de chute (où
      // gît la dépouille dont le voile parle), et ne repart au Feu qu'à cet instant — DANS LA
      // MÊME FRAME que le début du fondu de sortie, donc encore couvert.
      this.recenterCamera()
      this.cameras.main.startFollow(this.playerSprite, true, 0.16, 0.16)
      // Fin du voile : le monde réapparaît au Feu, jouable — on rend la main. (`dying` retombe
      // ICI, donc ce bloc ne peut pas rejouer : le saut n'a pas besoin d'un verrou à lui.)
      this.dying = false
      this.input.enabled = true
      if (this.input.keyboard) {
        // ⚠ REMETTRE LES TOUCHES À PLAT AVANT DE RENDRE LA MAIN. Phaser vide sa file
        // d'événements clavier à chaque POST_STEP, mais `KeyboardPlugin.update()` sort
        // immédiatement tant que le plugin est éteint : les `keyup` survenus sous le voile
        // sont donc JETÉS sans jamais atteindre les objets `Key`, et `isDown` reste figé sur
        // la direction qu'on tenait en tombant. Le joueur ressuscitait en marche, jusqu'à
        // ré-appuyer ET relâcher cette touche précise. Phaser appelle lui-même `resetKeys`
        // sur BLUR / PAUSE / SLEEP — trois chemins que `enabled = false` court-circuite.
        // C'est le pendant clavier de ce que `cancelHold()` fait déjà pour la souris.
        this.input.keyboard.resetKeys()
        this.input.keyboard.enabled = true
      }
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
   * SUIS-JE À TERRE ? — l'état, publié à chaque snapshot (décision d'Alexis, 2026-08-31).
   *
   * `downedAt` vient de la sim, qui laisse désormais le corps au sol jusqu'au geste. UIScene
   * en tire la tenue du voile ; c'est LE signal qui referme, parce que c'est le seul qui dit
   * qu'on est vraiment debout.
   *
   * Il porte aussi le RATTRAPAGE : une partie rechargée alors qu'on gisait n'a plus d'événement
   * `entity_died` à recevoir — il est passé avec la session d'avant. Sans ce chemin, on
   * revenait dans un corps qui ne marche pas, sans voile, sans bouton, sans un mot. On lève
   * donc le moment de mort sur l'ÉTAT, cause « inconnue » (on ne l'invente pas : la cause,
   * elle, n'a pas survécu).
   */
  private publierMonEtatAuSol(msg: SnapshotMessage): void {
    const moi = msg.entities.find((e) => e.id === this.playerId)
    const tombeA = moi?.downedAt
    setHud(this.registry, 'playerDown', tombeA !== undefined)
    if (tombeA === undefined) return
    // ⚠ UNE CHUTE, UN VOILE. `downedAt` est le TICK de la chute : il identifie la mort, et
    // c'est lui qu'on retient. Sans cette identité, ce rattrapage se rallumait en boucle —
    // il suffit d'une image où l'on est encore à terre et où `dying` est déjà retombé pour
    // qu'il relève le voile, ÉCRASE la vraie cause par « sans témoin », recoupe l'input et
    // rearme le filet. Un joueur absent y serait resté pour toujours.
    //
    // Le chemin par ÉVÉNEMENT (`entity_died`) tourne juste avant, dans le même snapshot : il
    // a donc déjà posé la vraie cause, et la ligne ci-dessous ne fait qu'en prendre note.
    if (this.dyingChute === tombeA) return
    const dejaLeve = this.dyingChute === undefined && this.dying
    this.dyingChute = tombeA
    if (dejaLeve) return // l'événement vient de le lever, avec sa cause : on n'y touche pas
    // LE RATTRAPAGE — une partie RECHARGÉE alors qu'on gisait. Aucun `entity_died` à recevoir,
    // il est passé avec la session d'avant : la cause est perdue et on le DIT (« inconnue »),
    // au lieu d'en inventer une. La dépouille, elle, se lit sur le monde : elle est là où l'on
    // gît. On la donne aussi au traqueur — la flèche de bord retrouve le sac au réveil.
    const dep = msg.corpses.find((c) => (c.x - (moi?.x ?? 0)) ** 2 + (c.y - (moi?.y ?? 0)) ** 2 <= 2.5 * 2.5)
    publishDeath(this.registry, 'inconnue', 0, null, dep !== undefined, this.time.now)
    if (dep) {
      this.myCorpseId = dep.id
      this.corpseDeathPos = null
    }
    this.dyingDeaths = moi?.deathCount ?? 1
    this.enterDying()
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
    etages?: readonly number[]
    etat?: EtatGel
  } {
    // LE GEL SOUS LES PIEDS (gel.md G2, G9) : la glace et la neige changent le pas, et la
    // prédiction doit le savoir — sinon chaque tuile enneigée est un rollback. La façade est
    // celle du rendu (`etat-gel.ts`) : mêmes fonctions, même snapshot.
    // L'ÉTAGE SOUS LES PIEDS (spec `etages.md`) : même geste que `sim.ts`, et il le FAUT — la
    // prédiction rejoue `moveAvatar`, donc elle doit voir le même monde. `undefined` partout
    // sauf sur un connecteur : sur une carte sans étage, c'est le chemin d'avant, au bit près.
    const etages = etagesDuPas(
      this.map, this.etageJoueur, Math.floor(this.predicted.x), Math.floor(this.predicted.y),
    )
    const monde = {
      map: this.map,
      structures: this.view.structures,
      nodes: this.view.nodes,
      moverVillageId: this.myVillageId,
      ...(etages !== undefined ? { etages } : {}),
    }
    return this.etatGel ? { ...monde, etat: this.etatGel } : monde
  }

  /**
   * Réconciliation par rejeu (spec reconciliation R3-R6) : purge les inputs
   * acquittés, pose l'ancre sur l'autorité et rejoue les inputs en attente. La
   * sim reste exacte ; l'écart de correction va dans `renderOffset` (lissé au
   * rendu), et au-delà du seuil de snap c'est un vrai téléport (respawn au Feu).
   */
  private reconcile(authoritative: Entity, lastProcessedInput: number): void {
    // L'ÉTAGE VIENT DE L'AUTORITÉ, AVANT LE REJEU — la prédiction ne le calcule pas, elle le
    // LIT (invariant n°3 : le client est bête, il ne prédit que sa position). Posé ici, il est
    // en place pour tous les `predictionWorld()` du rejeu qui suit.
    // …et « absent » vaut LE PALIER DU SOL, pas zéro (T-R3) : la même lecture que /sim.
    this.etageJoueur = niveauDuCorps(this.map, authoritative)
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

  /**
   * ═══ L'ÉCRAN CARTE (onglet M) — bâti UNE fois, dès que ses deux sources existent ═══
   *
   * `carte-lecture` : la matière VIVE entière (`carte-art`), statique — c'est elle que la levée
   * debug affiche. `carte-savoir` : le canvas dynamique aux trois états (encre / grisé / vif,
   * décision d'Alexis 2026-08-28), repeint par disques au fil de la marche. Les deux vivent ici
   * et non dans UIScene : c'est WorldScene qui tient le brouillard, les âges de cendre et les
   * couleurs du bake — UIScene ne fait qu'afficher des textures par clé.
   */
  private ensureCarteSavoir(): void {
    if (this.carteArt || !this.fog || !this.solCouleurs) return
    this.carteArt = peindreCarteArt(this.map, this.solCouleurs)
    const { width, height } = this.map
    for (const cle of ['carte-lecture', 'carte-savoir']) {
      if (this.textures.exists(cle)) this.textures.remove(cle)
    }
    const lecture = this.textures.createCanvas('carte-lecture', width, height)
    if (lecture) {
      lecture.setFilter(Phaser.Textures.FilterMode.NEAREST)
      const img = lecture.context.createImageData(width, height)
      img.data.set(this.carteArt.vive)
      lecture.context.putImageData(img, 0, 0)
      lecture.refresh()
      lecture.setFilter(Phaser.Textures.FilterMode.NEAREST) // `refresh()` remet LINEAR (cf. plus haut)
    }
    const savoir = this.textures.createCanvas('carte-savoir', width, height)
    if (savoir) {
      savoir.setFilter(Phaser.Textures.FilterMode.NEAREST)
      this.carteSavoirTex = savoir
      this.carteSavoirImg = savoir.context.createImageData(width, height)
      // La première peinture couvre TOUT : l'encre du jamais-vu, et le savoir relu de la
      // sauvegarde (la carte arpentée d'hier se rouvre grisée, sa cendre telle que vue).
      this.peindreCarteRegion(0, 0, this.fog.cols - 1, this.fog.rows - 1)
    }
  }

  /** Repeint une RÉGION de cellules du canvas `carte-savoir` (bornes incluses). */
  private peindreCarteRegion(cx0: number, cy0: number, cx1: number, cy1: number): void {
    const fog = this.fog
    if (!fog || !this.carteArt || !this.carteSavoirTex || !this.carteSavoirImg) return
    const joueur = this.worldReady ? { x: this.predicted.x, y: this.predicted.y } : null
    peindreSavoirRegion(
      this.carteSavoirImg.data, this.carteArt, this.map, fog, this.worldSeed,
      joueur, FOG_RAYON_TUILES, cx0, cy0, cx1, cy1,
    )
    const x = Math.max(0, cx0) * fog.pas
    const y = Math.max(0, cy0) * fog.pas
    const w = Math.min(this.map.width, (Math.min(fog.cols - 1, cx1) + 1) * fog.pas) - x
    const h = Math.min(this.map.height, (Math.min(fog.rows - 1, cy1) + 1) * fog.pas) - y
    if (w <= 0 || h <= 0) return
    this.carteSavoirTex.context.putImageData(this.carteSavoirImg, 0, 0, x, y, w, h)
    this.carteSale = true
  }

  /** Repeint le disque de cellules autour d'un point en tuiles. */
  private peindreCarteDisque(tuileX: number, tuileY: number, rayonTuiles: number): void {
    if (!this.fog) return
    const r = cellulesDuDisque(this.fog, tuileX, tuileY, rayonTuiles)
    this.peindreCarteRegion(r.cx0, r.cy0, r.cx1, r.cy1)
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
    // LES BUTTES D'AFFLEUREMENT (t0-exploration §2sexies) : le pierrier D'UNE BUTTE prend sa
    // teinte minérale — rouille mouchetée (le chapeau de fer) ou anthracite (la strate). Par la
    // DONNÉE `map.affleurements`, jamais par le terrain : le pierrier du Karst reste neutre.
    //
    // ⚠ **C'EST LE CONTEXTE QUI FAIT FOI, PAS LE RECT** (2026-08-27) : `map.affleurements` ne
    // registre qu'une BOÎTE ENGLOBANTE, et la butte n'en occupe que 42 à 56 % depuis qu'elle
    // croît tuile à tuile. Le pierrier d'un Karst tombé dans la boîte sans toucher la butte
    // n'aurait rien à faire en rouille. La frange, elle, n'est pas de la butte : elle garde la
    // teinte de son terrain.
    const buttes = contexteDesButtes(this.map)
    // Le second ton d'une butte, AVANT les passes de couleur (le bit 24 marque « il y en a un »).
    const tacheBrute = new Uint32Array(N)
    for (let i = 0; i < N; i++) {
      const terr = this.map.terrain[i] ?? 0
      const tx = i % width
      const ctxButte = buttes.get(i)
      const butte = ctxButte && ctxButte.role !== 'frange' ? ctxButte : null
      // LES DEUX TONS : le fond est la teinte de la tuile, la tache se sème à 4 px dans les
      // pavés (`mouchetureIci`). Elle passe par les MÊMES passes que le fond — modulation de
      // zone, lisière, grain — sinon les deux tons ne seraient pas de la même matière.
      if (butte) tacheBrute[i] = tacheDeButte(butte.ressource) | 0x1000000
      const base = butte
        ? fondDeButte(butte.ressource)
        : terr === TERRAIN_FOREST
          ? solForet(tx, (i - tx) / width, this.worldSeed)
          : (TERRAIN_COLORS[terr] ?? 0xff00ff)
      br[i] = (base >> 16) & 0xff
      bg[i] = (base >> 8) & 0xff
      bb[i] = base & 0xff
      bio[i] = BAKE_NON_BIOME.has(terr) ? 0 : 1
    }

    // ── PASSE 2 : couleur pure par tuile, modulation de zone + lisière + grain. (Le trait de
    // transition d'une tuile entre biomes — demande d'Alexis du 2026-07-20 — est RETIRÉ le
    // 2026-08-22 : la frontière est désormais DESSINÉE par les pavés (frange, liseré, ombre —
    // `render/paves.ts`) ; un trait fondu sous un pavé ferait un halo.) Le résultat se garde
    // aussi par tuile dans `solCouleurs` : c'est la couleur que les pavés cuisent à 16 px.
    const sol32 = new Uint32Array(N)
    this.solCouleurs = sol32
    // La tache des buttes, cuite par le MÊME chemin que le fond (bit 24 : « cette tuile en a »).
    const mouch32 = new Uint32Array(N)
    this.solMoucheture = mouch32
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
        const base = (br[i]! << 16) | (bg[i]! << 8) | bb[i]!

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
          // LA PROFONDEUR (spec §2quater R42) : le sol d'un massif s'assombrit en PENTE
          // CONTINUE avec la distance au bord — le cœur se LIT au sol, jamais par paliers.
          // Gardé sur le terrain ENCORE boisé (une tuile brûlée garde son étiquette de
          // profondeur, pas son ombre), et les CLAIRIÈRES restent claires : la trouée est
          // une chambre de lumière DANS la masse — l'assombrir la refermerait.
          // (La clairière n'a pas à être écartée ici : elle N'EST PLUS un terrain boisé depuis
          // le 2026-08-25, donc `TERRAINS_BOISES_MASSIF` la refuse déjà. Une garde de moins,
          // et surtout une source de moins — le terrain décide, pas un champ recalculé.)
          const dProf = this.map.profondeur?.[i] ?? 0
          if (dProf > 0 && TERRAINS_BOISES_MASSIF.includes(this.map.terrain[i] ?? 0)) {
            grain *= 1 - PROFONDEUR_ASSOMBRIT * Math.min(dProf, CREUX.PROF_CAP) / CREUX.PROF_CAP
          }
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
        const cuite = shade(couleur, grain)
        sol32[i] = cuite
        if (tacheBrute[i]) mouch32[i] = shade(moduler(tacheBrute[i]! & 0xffffff, sol), grain) | 0x1000000
        g.fillStyle(cuite)
        g.fillRect(tx, ty, 1, 1) // 1 px/tuile — étiré à la taille monde par setDisplaySize
      }
    }
    // LES COULÉES (forêts-vivantes §4 R5ter) : le décal de terre battue, par-dessus le sol.
    // L'usure est une PENTE CONTINUE le long du chemin (les pas convergent vers l'eau :
    // l'aval est plus battu que l'amont), jamais un trait uniforme — et 1 px/tuile = NEAREST
    // par construction. La sente n'est pas dans la liste : le décal s'interrompt dessus.
    const coulees = this.map.coulees
    if (coulees) {
      let debut = 0
      for (let k = 0; k <= coulees.length; k++) {
        if (k < coulees.length && coulees[k]! >= 0) continue
        const fin = k // [debut, fin) : un chemin, couche → eau
        for (let j = debut; j < fin; j++) {
          const i = coulees[j]!
          if (this.map.terrain[i] === TERRAIN_ROAD_COULEE) continue // la sente reste une sente
          const t = (j - debut) / Math.max(1, fin - 1 - debut)
          // REGARDÉ le 2026-08-16 : à 0,35-0,7 le chemin ne se LISAIT pas sous le grain du
          // sol — un décal illisible est un décal qui ment par omission. Renforcé.
          const usure = 0.6 + 0.3 * t // l'aval se dénude
          const sol = TERRE_BATTUE_COULEE
          const cx = i % width
          const cy = (i - cx) / width
          g.fillStyle(sol, usure)
          g.fillRect(cx, cy, 1, 1)
          sol32[i] = lerpColor(sol32[i]!, sol, usure) // les pavés voient la même usure
        }
        debut = k + 1
      }
    }
    g.generateTexture(key, width, height)
    g.destroy()
  }
}
