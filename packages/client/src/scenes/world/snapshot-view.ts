/**
 * La vue du snapshot : les sprites qui MIROIRENT l'état reçu de l'hôte
 * (structures, nœuds, cadavres, autres entités interpolées) et leur cycle de
 * vie — création, mise à jour, destruction par diff d'ids `seen`. Extrait de
 * `WorldScene` : la scène délègue, ce module possède l'état des sprites.
 * AUCUNE logique de jeu ici — uniquement du rendu d'état reçu (spec client R4).
 */
import {
  BALANCE,
  cropStage,
  doorPairs,
  isPlot,
  HUNT,
  NODE_DEFS,
  noeudDefriche,
  noeudTombeParLaCendre,
  forageRichness,
  sentinelOf,
  STRUCTURE_HP,
  WALL_TIERS,
  treeJitter,
  type Corpse,
  type Entity,
  type Monster,
  type FunctionId,
  type Npc,
  type RefugeeGroup,
  type ResourceNode,
  type NodeType,
  type Structure,
  type WallMaterial,
  type NodeDelta,
  type SnapshotMessage,
} from '@ashes/sim'
import { estUnCoinDePeche, feuillageDenude, fireStateAt, hash2, tailleDeBloc, TERRAIN_CLIFF, terrainAt, VENT, type SimState, type WorldMap } from '@ashes/sim'
import { TransitionsFlore, retardDe } from '../../render/flore-gel'
import { cliffKey } from '../../render/cliff-art'
import { cleCarcasse, etatCarcasse } from '../../render/carcasse-art'
import Phaser from 'phaser'
import { FONT } from '../ui/typography'
import { windSway } from '../../render/wind'
import { pushSample, sampleAt, type Sample } from './interp'
// LA POSTURE ET LA TEINTE D'UNE BÊTE vivent à part (`beast-posture`) : sans Phaser, donc
// jouables headless. C'est ce qui permet à `tools/diag-cerf.mts` de compter ce que l'ÉCRAN
// montre, au lieu d'en garder une copie qui dérive.
import {
  BEAST_TINTS,
  beastTexture,
  beastTint,
  majMiroir,
  majRepos,
  nouveauMiroir,
  nouveauRepos,
  saigneBete,
  type MiroirLatch,
  type ReposLatch,
} from './beast-posture'
import { decorerSang, SANG_TEXTURES, teinteSechage, type DecorSang } from './sang-sol'
import { GOUTTE_CADENCE_MS, type SangFx } from './sang-fx'
export { BEAST_TINTS } from './beast-posture'
import {
  actorPlacement,
  corpseDepth,
  crownAlpha,
  crownDepth,
  DEMI_BANDE_TUILES,
  FLOOR_DEPTH,
  GROUND_FIRE_DEPTH,
  nodeDepth,
  barriereDepth,
  ROOF_DEPTH,
  seuilDepth,
  structureDepth,
  TIE_SEUIL,
  tileFeetAnchor,
  TILE_PX,
  type ActorFootprint,
} from '../../render/framing'
import { ancrageHouppierPx, cleHouppier, houppierLargeur, hauteurTuiles, TOUTES_VARIANTES, VARIANTES } from '../../render/arbre-art'

/** Le débord de fenêtre, en TUILES : la hauteur du plus haut arbre de la table. Dérivé une fois
 *  au chargement — un arbre qui grandit l'emporte avec lui, sans qu'on ait à y penser. */
const MARGE_CIMES = Math.ceil(Math.max(...TOUTES_VARIANTES.map((v) => hauteurTuiles(v.mesures))))
import { cimeDe, varianteArbre } from '../../render/arbre-peuplement'
import { warmthColor } from '../../render/lighting'
import { LIT_NODE_TYPES } from '../../render/lit-props'
import { BATI_LIT_TYPES, COUPE_DE, EDGE_ORIGIN_Y, MUR_HT, RUINE_SEUIL } from '../../render/bati-art'
import { creerPortesAnimees } from '../../render/porte-anim'
import { calculerNappe, calculerPans, pansTombes } from '../../render/pans'
import { LIT_STRUCTURE_TYPES } from '../../render/lit-structures'
import { shakeOffset, type HitFx } from './hit-fx'
import type { InteractTarget } from './aim'
import type { RecolteFx } from './recolte-fx'
import type { ChuteArbre } from './chute-arbre'
import type { ReveilFx } from './reveil-fx'
import { createContactShadow, positionShadow, SHADOW_ALPHA } from './contact-shadow'
import { riveAt, type RiveField } from '../../render/water-field'
import { coupeDeNeige, enfoncement } from '../../render/enfoncement'

/** Le nœud VISÉ à portée s'éclaire d'or ; hors de portée, il se grise (G4). */
const AIM_TINT = 0xffe9a8
const AIM_TINT_FAR = 0x8a8a92
/**
 * LA PLANTE GELÉE (spec `flore-froid.md` F8, RÉVISÉE le 2026-08-22 — Alexis a tranché la DA
 * que le marqueur provisoire en aplat bleu attendait : « les fleurs, champignons, brins
 * d'herbe devraient disparaître lorsqu'il gèle, avec un effet juicy, et respawn lorsque la
 * température le permet »).
 *
 *   • Le CHAMPIGNON et le TAS DE FEUILLES DISPARAISSENT — geste d'effondrement, gerbe de givre
 *     (`render/flore-gel.ts`, `RecolteFx.givre`) — et repoussent au dégel (pop, gerbe verte).
 *     La sim ne perd rien (F6) : le nœud attend, invisible ; un clic dessus est un refus que
 *     l'absence annonce mieux qu'un aplat.
 *   • Le BUISSON À BAIES reste : c'est un arbuste, l'hiver ne l'efface pas. Il est DORMANT —
 *     sans ses baies (la texture à 0 point : un buisson gelé ne rend rien, F3) et sous une
 *     teinte froide et terne (un multiply peut assombrir et désaturer, c'est ce qu'on lui
 *     demande ici — pas de rendre du givre clair, ce qu'il ne sait pas faire).
 */
const DORMANT_TINT = 0xb4bfcc
/** LA PLANTE À FIBRES reste aussi — et se cueille toujours (F7 : sa fibre est sèche, le gel ne la
 *  prend pas). Elle passe à la PAILLE : un vert sous la neige lirait « herbe », or l'herbe est
 *  partie ; jaunie, elle dit « tige sèche qu'on peut encore prendre ». */
const SEC_TINT = 0xd9cfa6
/** LA COUPE DE NEIGE, en px MONDE, pour une hauteur continue dans [0, 2] (gel.md G9) : la
 *  poudreuse couvre les chevilles (`NEIGE_CHEVILLES_PX` à 1), la profonde les genoux
 *  (`NEIGE_GENOUX_PX` à 2) — constants comme l'eau : la neige a UNE hauteur, chaque corps y
 *  trempe selon sa taille (le lapin y disparaît presque). Bornée à une part du corps. */
// ⚠ LES PROFONDEURS DE MILIEU (neige, vase, eau) ONT DÉMÉNAGÉ dans `render/enfoncement.ts`
// le 2026-08-24 : elles se composent, donc elles se prouvent ensemble — et ce module-ci n'est
// pas testable en Node (il tient des sprites).
/**
 * LE ROUGE DE LA DÉMOLITION — plus CHAUD que le rouge d'interface du fantôme refusé (#d9614f),
 * et il le faut : il se pose sur du BOIS, qui est déjà orange.
 *
 * MESURÉ au navigateur (2026-08-01), silhouette à 0,72 d'alpha sur un mur de bois debout :
 * #d9614f rendait (219,114,84) là où le mur non visé rend (223,156,97) — 44 d'écart euclidien,
 * soit deux planches presque identiques. À #ff3a2a et 0,8, le même mur rend (248,78,53) : 93
 * d'écart, et la teinte quitte la famille du bois au lieu d'y ajouter une nuance.
 * Hors de portée, elle retombe sur le gris de visée : le geste est perdu d'avance.
 */
const DEMOLISH_TINT = 0xff3a2a

/**
 * LES CORPS DE LIEUX (spec lieux-batis, étage 3) — les pièces dont l'art est le SPRITE DE
 * POI du même nom, DÉRIVÉES du registre (`art: 'poi'`), jamais recopiées ici. Leur clé de
 * naissance est `poi-<slug>`, pas `st-<slug>` : on ne redessine pas une grotte en 16 px.
 */
/**
 * LE CONTOUR DE CE AVEC QUOI ON PEUT INTERAGIR (demande d'Alexis, 2026-08-03) — blanc, et
 * blanc PUR : c'est la seule couleur que le monde n'a pas. Le jeu est fait de bruns, d'ocres
 * et de verts sourds, et ses deux affordances existantes tiennent déjà la famille chaude (l'or
 * de visée, le rouge de démolition). Le blanc ne s'y confond avec rien, de jour comme de nuit.
 * Hors de portée, il retombe sur le gris de visée : le geste ne partirait pas.
 */
const CONTOUR_TINT = 0xffffff

/**
 * L'ÉPAISSEUR DU CONTOUR : UN pixel d'ART, jamais un pixel d'écran (règle maison — un FX
 * se quantifie sur la grille de l'art). Le zoom suit la hauteur de la fenêtre
 * (`zoomForFraming` : 20 tuiles de 16 px à l'image), donc ce pixel vaut 2,25 px d'écran au
 * cadrage du smoke et davantage sur un grand écran — il garde en toute résolution le GRAIN
 * du sprite qu'il souligne. Le déclarer en pixels d'écran l'aurait fait maigrir en montant
 * en résolution, jusqu'à ne plus border qu'un sous-multiple de l'art.
 */
const CONTOUR_PX = 1

/** Les huit voisins : les quatre côtés ET les diagonales. À quatre, une silhouette courbe
 *  (un buisson, une flèche de biais) laisse des trous dans son propre contour. */
const CONTOUR_DECALAGES: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
]

/** Plafond de morts consignées en une frame. Un front qui rase un bosquet ne doit pas
 *  jeter mille chutes à l'écran — et au-delà, plus personne ne les distingue. */
const MAX_EPUISEMENTS = 12

/** Combien de temps le TROU reste visible après qu'un lapin y est rentré (C16).
 *  Assez pour qu'on comprenne où il est passé — pas assez pour joncher la carte. */
const ESCAPE_LINGER_MS = 6000

/**
 * DÉLAI d'interpolation par DÉFAUT : un tick. C'est le comportement Veillée (solo) —
 * les snapshots arrivent à cadence fixe, ~0 latence, on rend un tick en retard et
 * c'est fluide. En MULTI, `SnapshotView.interpDelayMs` est monté (≈100 ms) pour
 * absorber la gigue réseau (voir `INTERP_DELAY_MULTI_MS`).
 */
const INTERP_DELAY_DEFAULT_MS = 1000 / BALANCE.TICK_RATE_HZ

/**
 * DÉLAI d'interpolation en MULTI (≈100 ms). Un joueur distant est rendu 100 ms dans
 * le passé, entre deux snapshots encadrants : c'est le tampon de gigue standard
 * (Source, Overwatch). On paie 100 ms de retard visuel sur les AUTRES contre de la
 * fluidité — l'avatar local, lui, est prédit et ne subit aucun retard.
 */
export const INTERP_DELAY_MULTI_MS = 100

/** Emprise VISUELLE par texture d'acteur (tuiles) — R12. Découplée de la
 * résolution native de l'art. LES HUMANOÏDES font 12 × 24 px (0,75 × 1,5 tuile, décision
 * d'Alexis 2026-07-27) : la LARGEUR est celle de leur hitbox — le dessin et le corps s'arrêtent
 * ensemble — et la texture fait 12 × 24 elle aussi, donc ses pixels restent CARRÉS.
 * L'emprise logique (collision/clic) reste AVATAR_HITBOX_TILES, inchangée.
 * `facesRight` : le sens dans lequel la silhouette est DESSINÉE — le flip du
 * regard (spec R9bis : la bête regarde où elle va) s'en déduit. */
const ACTOR_FOOTPRINTS: Record<string, ActorFootprint & { facesRight?: boolean }> = {
  'spr-player': { widthTiles: 0.75, heightTiles: 1.5 },
  'spr-player_lit': { widthTiles: 0.75, heightTiles: 1.5 }, // même emprise que la version peinte
  'spr-npc': { widthTiles: 0.75, heightTiles: 1.5 },
  'spr-npc_lit': { widthTiles: 0.75, heightTiles: 1.5 },
  // Le Cendreux : une silhouette d'HOMME, parce que c'en était un — c'est tout le lore.
  // Il n'avait aucune emprise déclarée et tombait donc sur le repli, alors qu'il hérite du
  // rôle du zombie (spec `cendreux.md` R1) : même gabarit que celui qu'il remplace.
  'spr-cendreux': { widthTiles: 0.75, heightTiles: 1.5 },
  // LE RAMPANT (spec `cendreux.md` R26ter) : le même homme, COUCHÉ — la hauteur devenue
  // longueur (texture 24 × 10 : pixels carrés à 1,5 × 0,625 tuile). Sans cette entrée il
  // tombait sur le repli et se dessinait aux dimensions du marcheur, debout dans une
  // texture à plat — MESURÉ au smoke `rampant` : 12 × 24 pour une texture de 24 × 10.
  'spr-cendreux-rampant': { widthTiles: 1.5, heightTiles: 0.625 },
  // Le gibier (spec faune) : sa TAILLE est la première information, et sa
  // POSTURE est la seconde (R9bis/C19) — tête au sol elle broute, tête dressée
  // elle a vu quelque chose, corps tendu elle fuit. Le lapin rase le sol, le
  // cerf domine le joueur — on sait ce qu'on approche, et dans quel état c'est.
  'spr-boar': { widthTiles: 1.5, heightTiles: 1 },
  'spr-boar-root': { widthTiles: 1.5, heightTiles: 1 },
  'spr-boar-charge': { widthTiles: 1.65, heightTiles: 0.85 },
  'spr-deer': { widthTiles: 1.4, heightTiles: 1.8, facesRight: true },
  'spr-deer-graze': { widthTiles: 1.4, heightTiles: 1.4, facesRight: true },
  'spr-deer-flee': { widthTiles: 1.75, heightTiles: 1.35, facesRight: true },
  'spr-deer-bed': { widthTiles: 1.4, heightTiles: 0.95, facesRight: true },
  'spr-rabbit': { widthTiles: 0.6, heightTiles: 0.6, facesRight: true },
  'spr-rabbit-graze': { widthTiles: 0.6, heightTiles: 0.45, facesRight: true },
  'spr-rabbit-flee': { widthTiles: 0.8, heightTiles: 0.45, facesRight: true },
  'spr-wolf': { widthTiles: 1.5, heightTiles: 1.15 },
  'spr-wolf-stalk': { widthTiles: 1.5, heightTiles: 0.8 },
  'spr-wolf-eat': { widthTiles: 1.45, heightTiles: 1 },
  // L'alpha DÉBORDE : il est visiblement plus gros que les siens. C'est le
  // signal qui rend la règle jouable — on ne peut pas le rater dans la meute.
  'spr-wolf-alpha': { widthTiles: 2, heightTiles: 1.55 },
}
const DEFAULT_FOOTPRINT: ActorFootprint = { widthTiles: 0.75, heightTiles: 1.5 }

/** Combien la canopée prend le vent (voir render/wind.ts). Un houppier est lourd :
 * il oscille moins qu'un roseau, mais il est large, donc ça se voit. */
const CROWN_WIND_TAKE = 0.5

/** LES NŒUDS-PLANTES PLIENT AUSSI (demande d'Alexis 2026-07-24). Le sway n'était branché que sur le
 *  décor (clutter, `WIND_TAKE`) et les houppiers — la fibre restait DROITE à côté d'une touffe qui se
 *  couche. On applique donc la MÊME logique aux nœuds-plantes, à une prise cohérente avec leur cousin
 *  de décor : fibre ≈ roseau/herbe, buisson à baies ≈ buisson-décor (0,45). La roche et le tronc
 *  adulte restent RIGIDES (absents ici → prise 0) — un tronc interactif ne doit pas dodeliner ; seul
 *  son houppier bouge. Une pousse d'arbre (état `growing`) plie un peu, comme un jeune plant. */
const NODE_WIND_TAKE: Record<string, number> = { fiber_plant: 1, berry_bush: 0.45 }
const SAPLING_WIND_TAKE = 0.4

/**
 * LA SILHOUETTE TASSÉE (spec chasse C19). Qui se fait discret se PLIE : le
 * rampeur (`gait: sneak`) perd un quart de sa hauteur — les pieds ne bougent
 * pas, c'est le corps qui descend. Les BÊTES, elles, ont désormais de vraies
 * POSTURES (`beastTexture`) ; seul l'alpha garde l'écrasement (sa silhouette
 * propre n'a pas de variante tapie, et c'est lui qu'on doit reconnaître).
 */
export const CROUCH_FACTOR = 0.72

function isCrouched(monster: Monster | undefined, entity: Entity): boolean {
  // QUI DÉPÈCE SE PENCHE (spec `depecage.md` R2c) : la même silhouette tassée que le furtif —
  // le maintien se VOIT sur le corps, puisqu'il n'a pas de jauge.
  if (!monster) return entity.gait === 'sneak' || entity.butchering !== undefined
  return monster.alpha === true && (monster.stalking === true || monster.eatingUntil !== undefined)
}

/** Clé d'index tuile→nœud : `tx * STRIDE + ty`. STRIDE > toute coordonnée de
 * tuile (carte alpine pleine ≤ 3600) → injectif, pas de collision de clé. */
const NODE_TILE_STRIDE = 1_000_000

/** REPOUSSE (spec recolte-vivante D2) : échelle plancher d'un nœud qui vient de repousser
 *  — une pousse tout juste sortie reste visible (jamais une taille nulle). */
const GROWTH_MIN = 0.14
/** BUISSON À BAIES : au plus 3 baies dessinées (variantes `nd-berry_bush-0..3`), affichées
 *  PROPORTIONNELLEMENT au stock restant du nœud (demande d'Alexis 2026-07-19). Un buisson vidé
 *  (`stock 0`) reste dessiné NU (`-0`) : ses baies reviennent seules quand la ressource repousse.
 *  La capacité de référence est la MÊME formule que la sim à la repousse (`stock de base × la
 *  richesse seedée du coin`), donc l'affichage est EXACT dès la première repousse — et le client
 *  la recalcule sans état (miroir de la lueur de cueillette, C3). */
const BERRY_TEX_MAX = 3
function berryDots(node: ResourceNode): number {
  if (node.stock <= 0) return 0
  const full = Math.max(1, Math.floor(NODE_DEFS.berry_bush.stock * forageRichness(node.id)))
  // Au moins 1 point tant qu'il reste des baies ; jamais plus que la capacité l'exige.
  return Math.max(1, Math.min(BERRY_TEX_MAX, Math.round((BERRY_TEX_MAX * node.stock) / full)))
}
/** GAP DU BAS DE L'ART d'un nœud, en TEXELS : combien de rangées transparentes sous la silhouette,
 *  jusqu'au bord bas de sa tuile (16×N). L'ombre de contact se pose sur cette base VISIBLE, pas sur
 *  le bord de tuile — sinon un art qui REMPLIT sa hauteur (le tronc) verrait sa flaque remonter
 *  comme celle d'un BLOC qui, lui, laisse ~2 texels (bug vu par Alexis : ombres d'arbres/fibre trop
 *  hautes). Mesuré sur `BootScene.makeNodes`. Clé = la TEXTURE effective, pas le `type` : une
 *  repousse d'arbre montre `nd-sapling`, dont le gap n'est pas celui du tronc. */
function nodeArtGap(texture: string): number {
  // TOUT TRONC D'ARBRE est plein jusqu'au bas — et il y en a désormais dix (2026-07-29), pas
  // deux. La règle se lit sur la FORME de la clé (`nd-<variante>_trunk[_lit]`) plutôt que sur une
  // liste de noms : une variante ajoutée aurait sinon reçu le gap des BLOCS (2 texels) et son
  // ombre de contact serait remontée de deux pixels — exactement le bug qu'Alexis avait vu sur
  // les arbres et la fibre, à ceci près qu'il serait revenu par la porte de derrière.
  if (/^nd-.+_trunk(_lit)?$/.test(texture)) return 0 // tronc plein jusqu'au bas
  if (texture.startsWith('nd-bloc')) return 0 // le bloc d'affleurement est FLUSH : pleine tuile, sans offset
  if (texture.startsWith('nd-sapling') || texture.startsWith('nd-fiber_plant') || texture.startsWith('nd-stump')) return 1 // plantes fines, art bas (suffixe _lit compris — piège épinglé par la vague A)
  return 2 // blocs (roche, baies, minerais…) : l'art bombe et s'arrête ~2 texels avant le bord
}

/** SOUCHE : durée (ms client) pendant laquelle la marque d'un nœud qui a dérivé pâlit
 *  avant de disparaître. Purement cosmétique — la nature reprend le coin. */
const STUMP_FADE_MS = 9000

/** LE REGARD (audit UI/UX P3-11) : à quelle distance du centre du corps se pose le pion
 *  d'orientation (px monde), et sa taille à l'écran. Calé pour affleurer le bord de
 *  l'avatar (~16 px de large) sans le quitter. Partagé avec le regard des Cendreux (R27) :
 *  le même pion dit la même chose, qu'il soit sur un vivant ou sur un mort. */
export const GAZE_REACH = 6
export const GAZE_PX = 5

export interface InterpolatedSprite {
  sprite: Phaser.GameObjects.Image
  /** L'ombre de contact sous cet acteur — créée et détruite AVEC son sprite (pas d'orpheline). */
  shadow: Phaser.GameObjects.Image
  /** Clé de texture courante — évite setTexture/re-dimensionnement inutiles. */
  textureKey: string
  /** Silhouette TASSÉE ce snapshot (rampeur, tapi, fougeur) — lue par `interpolate`. */
  crouch: boolean
  /** Relevés de position datés — `interpolate` y rend à `now - interpDelayMs` (tampon de gigue). */
  buffer: Sample[]
  /** DEPUIS QUAND ELLE NE BOUGE PLUS — décide du couché (voir `beast-posture`). Une bête
   *  qui marche est debout, quelle que soit l'heure. */
  repos: ReposLatch
  /** LE SENS DESSINÉ, et depuis quand elle penche de l'autre côté (voir `majMiroir`). */
  miroir: MiroirLatch
}

/** Le dernier relevé connu d'un tampon (position autoritative la plus récente). */
function latest(buffer: Sample[]): Sample {
  return buffer[buffer.length - 1]!
}

/** Le nom affiché d'une fonction émergente (spec construction R22). Étendu par tranche. */
const FUNCTION_LABEL: Record<FunctionId, string> = {
  forge: 'Forge',
  atelier: 'Atelier',
  grenier: 'Grenier',
  ferme: 'Ferme',
}
const FUNCTION_FONT = FONT
/** L'overlay des fonctions passe au-dessus des toits et des houppiers (world-space). */
const FUNCTION_LABEL_DEPTH = 1_400_000

/**
 * LE MASQUE D'AUTOTUILE d'un mur (décision d'Alexis : murs CONTINUS) : un bit par
 * voisin (N=1, E=2, S=4, O=8) qui est un mur OU une porte. La texture `st-wall-<masque>`
 * dessine une paroi qui se raccorde à ses voisins, sans couture — pas un carré isolé.
 */
function wallMask(tiles: ReadonlySet<string>, tx: number, ty: number): number {
  let m = 0
  if (tiles.has(`${tx},${ty - 1}`)) m |= 1
  if (tiles.has(`${tx + 1},${ty}`)) m |= 2
  if (tiles.has(`${tx},${ty + 1}`)) m |= 4
  if (tiles.has(`${tx - 1},${ty}`)) m |= 8
  return m
}

/**
 * La teinte DOUCE d'une barrière d'ARÊTE selon son matériau — à mi-chemin entre le
 * blanc de l'ancienne teinte fixe et les tons pleins de `wallTint` : la texture garde
 * ses aplats, le matériau se lit quand même. Sans elle, un bourg de PIERRE était
 * indiscernable d'un hameau de BOIS (mesuré au pixel sur les captures smoke
 * `village-pnj` : Δ ≤ 3 sur les trois canaux entre les deux paliers).
 */
const EDGE_MATERIAL_RGB: Record<WallMaterial, readonly [number, number, number]> = {
  // Le bois est presque blanc : sa famille de texture (`wall-bois`) porte déjà ses tons
  // en aplat (retour d'Alexis, 2026-08-01 — une teinte seule ne se lisait pas).
  wood: [248, 250, 255],
  stone: [212, 214, 224],
  metal: [208, 221, 240],
}

/** La teinte d'un mur selon son PALIER DE MATÉRIAU (les textures d'autotuile sont
 *  neutres) et ses DÉGÂTS (elle s'assombrit). Bois chaud, pierre froide, métal acier. */
function wallTint(material: WallMaterial | undefined, ratio: number): number {
  const dim = 0.5 + 0.5 * Math.max(0, Math.min(1, ratio))
  const rgb = material === 'stone' ? [176, 178, 192] : material === 'metal' ? [168, 192, 224] : [200, 154, 104]
  return Phaser.Display.Color.GetColor(Math.floor(rgb[0]! * dim), Math.floor(rgb[1]! * dim), Math.floor(rgb[2]! * dim))
}

// LE SEUIL DE RUINE (`RUINE_SEUIL`) vit dans `bati-art` depuis l'Atelier (2026-08-10) : le
// choix de texture ruinée appartient à l'art, et l'éditeur le lit au même endroit que nous.

/**
 * ⚙ CALIBRATION — À QUELLE DISTANCE UN PAN DE MUR TOMBE (décision d'Alexis, 2026-07-27).
 *
 * 2 tuiles, et le nombre n'est pas libre : c'est la hauteur apparente d'un mur (`MUR_HT` = 32 px
 * = 2 tuiles). On voit donc derrière un pan exactement quand il pourrait cacher quelqu'un à sa
 * hauteur — ni plus tôt (le bâtiment garderait ses murs pour rien), ni plus tard (il resterait
 * un angle mort d'une rangée, celui-là même qu'on voulait supprimer).
 *
 * Dans une salle de six rangées, on peut se tenir au milieu sans effacer le nord : la pièce
 * garde deux pans sur quatre. C'est ce qui la distingue d'un plan au sol.
 */
const PAN_DISTANCE_TUILES = 2

/** La demi-épaisseur d'une bande d'arête, en tuiles — DÉRIVÉE de l'équilibrage, comme le
 *  dessin (`bati-art`) et la collision (`collision.ts`). Trois lectures, une seule source. */

/**
 * ═══ LE MÉMO DU BÂTI (mesure A9, lieux-batis — 2026-08-16) ═══
 *
 * Les dérivations PURES du tableau de structures — index d'autotuile, `doorPairs`,
 * `calculerPans` — coûtaient ~1,3 ms par snapshot à 772 structures, recalculées 20 fois par
 * seconde sur un bâti qui ne change presque jamais. Elles sont désormais mémoïsées sur le
 * tableau reçu, et la clé de comparaison est EXACTEMENT l'ensemble des champs que ces
 * dérivations lisent : `id, type, tx, ty, edges` — rien d'autre. Si une dérivation ajoutée
 * ici se met à lire un champ de plus (`hp`, `open`…), la comparaison DOIT l'apprendre, sinon
 * elle servira du périmé. La nappe et `pansTombes`, qui dépendent de la position de
 * l'avatar, restent recalculées à chaque snapshot.
 */
interface DerivesBati {
  /** Le tableau pour lequel tout le reste a été calculé — la clé du mémo. */
  pour: Structure[]
  wallTiles: Set<string>
  clotureTiles: Set<string>
  massifTiles: Set<string>
  seuilTiles: Set<string>
  doubles: ReturnType<typeof doorPairs>
  pans: ReturnType<typeof calculerPans>
}

/** Le bâti est-il inchangé AU SENS DES DÉRIVATIONS ? (mêmes champs lus, même ordre — la sim
 *  n'y touche que par push/splice, l'ordre est stable entre deux changements). */
function memeBati(a: Structure[], b: Structure[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.id !== y.id || x.type !== y.type || x.tx !== y.tx || x.ty !== y.ty || x.edges !== y.edges) return false
  }
  return true
}

export class SnapshotView {
  /** Dernier état reçu — lu par la prédiction (collisions) et les inputs. */
  structures: Structure[] = []

  /**
   * LA NAPPE — l'ensemble des tuiles du bâtiment sous lequel se tient l'avatar, ou `null`
   * dehors. Recalculée à chaque snapshot ; jamais sérialisée (dérivé pur).
   *
   * Elle remplace le DISQUE des houppiers, et c'était une confusion de fond : `crownAlpha` est
   * la fonction des CIMES (`CROWN_R_IN = 6` tuiles, `CROWN_R_OUT = 16`), calibrée pour une
   * canopée où l'on voit loin à l'horizontale. Sur une maison de six tuiles, elle rendait le
   * toit transparent **alors qu'on était encore dehors** — il ne cachait donc jamais rien. Une
   * pièce n'est pas une cime : on efface le couvert de la pièce OÙ L'ON EST, entièrement, et on
   * laisse les autres pleins. C'est ce que font Project Zomboid et RimWorld.
   */
  private nappe: Set<string> | null = null

  /** Le mémo des dérivations pures du bâti — voir `DerivesBati` (mesure A9). */
  private derives: DerivesBati | null = null

  /** L'avatar est-il sous le même couvert que cette tuile ? */
  private dedansAvec(tx: number, ty: number): boolean {
    return this.nappe !== null && this.nappe.has(`${tx},${ty}`)
  }

  /** ESSAI éclairage dynamique (decisions.md 2026-07-20) : quand armé (toggle debug
   *  F5), l'arbre ORDINAIRE de la Racine passe sur ses textures normal-mappées
   *  (`*_lit`) éclairées par le LightsManager. Piloté par WorldScene. */
  lighting = false
  /** Le champ de rive (spec eau-vivante R1-R2), posé par WorldScene après la couche d'eau —
   *  la MÊME distance que le shader : l'immersion des acteurs ne peut pas la contredire. */
  rive: RiveField | null = null
  /** Les événements d'eau (gerbe, empreintes — R3/R7), posés par WorldScene avec la couche. */
  eau: import('./eau-events').EauEvents | null = null
  /** La tuile est-elle de la GLACE (eau gelée, praticable) ? Posé par WorldScene sur la couche
   *  du gel — une lecture de signature, jamais un appel à la sim par acteur et par image. */
  glaceAt: ((tx: number, ty: number) => boolean) | null = null
  /** La hauteur de neige en un point, continue dans [0, 2] (`GelLayer.hauteurNeige`). */
  hauteurNeigeAt: ((x: number, y: number) => number) | null = null
  /** LE SDF DU MARAIS (peche.md R13) — la distance signée à son bord, comme la rive de l'eau.
   *  Un CHAMP, pas un booléen : « s'enfoncer » est une pente, et une pente se lit sur une
   *  distance continue. Injecté par WorldScene, qui tient la carte. */
  vase: RiveField | null = null
  /** La flore de la tuile est-elle gelée ? Même source (`GelLayer.floreGeleeAt`). */
  floreGeleeAt: ((tx: number, ty: number) => boolean | null) | null = null
  /** Les bascules gel/dégel des nœuds gélifs (voir `render/flore-gel.ts`). */
  private readonly transitionsFlore = new TransitionsFlore()
  /** Les reflets du monde (R13) — pool par frame, posé par WorldScene avec la couche d'eau. */
  reflets: import('./reflets').RefletsLayer | null = null

  /** Le nœud sous le curseur (spec recolte.md G4), et s'il est à portée de bras. */
  private aimedNodeId: number | null = null
  private aimedInRange = false
  /** La structure que le mode DÉMOLIR détruirait, et si elle est à portée de bâti. */
  private demolishTargetId: number | null = null
  private demolishInRange = false
  /** La silhouette rouge posée dessus — une seule, recyclée (voir `peindreHalo`). */
  private demolishHalo: Phaser.GameObjects.Image | undefined
  /** CE QUE LA TOUCHE D'INTERACTION FERAIT (voir `setInteractTarget`) — la cible du contour. */
  private interactTarget: InteractTarget | null = null
  /** Les huit copies décalées qui forment le contour — recyclées (voir `peindreContour`). */
  private contourPool: Phaser.GameObjects.Image[] = []
  /** Le sprite du NŒUD survolé, relevé au passage de `renderNodes` : le pool des nœuds est
   *  indexé par SLOT (pas par id) et se réattribue chaque frame — seule cette boucle sait
   *  quel sprite porte quel nœud, et le savoir coûte alors une comparaison, pas une table. */
  private contourNodeSprite: Phaser.GameObjects.Image | null = null
  /** La mémoire des coups reçus — pour le tressaillement. Posée par WorldScene. */
  private hitFx?: HitFx
  /** LA GERBE D'ÉCLATS. Elle naît ICI et nulle part ailleurs : cette boucle est la seule
   *  à connaître la position RÉELLE du sprite du nœud (décalage d'arbre, tressaillement,
   *  relief du warp), sa hauteur affichée et sa texture du moment — les trois entrées de
   *  la gerbe. Les recalculer côté WorldScene les aurait fait diverger. Posée par WorldScene. */
  private recolteFx?: RecolteFx
  /** LES ARBRES QUI S'ABATTENT (G15). Posée par WorldScene, comme la gerbe. */
  private chuteArbre?: ChuteArbre
  /** LE SOL QUI TRAVAILLE et le corps qui s'en extrait (spec `cendreux.md` R21/R22). Posé
   *  par WorldScene ; `syncActor` lui demande l'enfouissement de chaque acteur. */
  private reveilFx?: ReveilFx
  /**
   * LES NŒUDS MORTS CETTE FRAME, à leur ANCIENNE tuile — la seule que la dérive va leur
   * prendre, et donc la seule où l'animation a un sens. Consignés par `applyNodeDeltas`
   * (à la réception du snapshot), joués et VIDÉS par `renderNodes`.
   */
  private epuisements: { id: number; tx: number; ty: number; type: NodeType; at: number }[] = []

  /** Ce que le curseur vise MAINTENANT. Purement de l'affichage : la sim revalide. */
  setAim(nodeId: number | null, inRange: boolean): void {
    this.aimedNodeId = nodeId
    this.aimedInRange = inRange
  }

  /**
   * CE QUE LE MARTEAU DÉTRUIRAIT (décision d'Alexis, 2026-08-01) — l'id de la structure que
   * le mode DÉMOLIR vise, et si elle est à portée de bâti. Rouge = ce clic la détruit ; gris
   * = trop loin. `null` = mode éteint, ou rien à moi sous le curseur.
   *
   * Une tuile porte jusqu'à trois couches et quatre arêtes : sans ce surlignage, le joueur
   * détruirait à l'aveugle. C'est LUI qui rend la règle de visée (`demolishTargetAt`) lisible
   * — les deux lisent la même fonction, aux mêmes arguments.
   */
  setDemolishTarget(id: number | null, inRange: boolean): void {
    this.demolishTargetId = id
    this.demolishInRange = inRange
    // ON ÉTEINT ICI, PAS SEULEMENT AU RENDU. `renderStructures` ne tourne qu'à l'arrivée d'un
    // SNAPSHOT ; cette méthode, elle, est appelée à chaque frame. Sans ça, ranger le marteau
    // ou ouvrir le menu pause (l'hôte se fige, plus un seul snapshot) laisserait la silhouette
    // rouge posée sur le monde, désignant un geste que plus rien ne peut déclencher.
    if (id === null) this.demolishHalo?.setVisible(false)
  }

  /**
   * CE QUE LA TOUCHE D'INTERACTION FERAIT (demande d'Alexis, 2026-08-03) — le feu, le buisson
   * de cueillette ou la pile au sol que `F` prendrait si on l'enfonçait MAINTENANT. Le contour
   * blanc l'entoure ; `null` l'éteint.
   *
   * La cible vient de `interactTargetAt` — la MÊME fonction, aux mêmes gardes, que le handler
   * de la touche (`input-bindings`). Rien n'est re-résolu ici : un contour qui désignerait
   * autre chose que ce que la touche déclenche promettrait un geste qui n'existe pas.
   *
   * ON ÉTEINT DANS LE SETTER, comme le halo de démolition : le contour se peint dans la passe
   * de rendu, or elle ne tourne pas quand l'hôte est figé (menu pause) — un survol laissé
   * allumé resterait posé sur le monde sous l'overlay.
   */
  setInteractTarget(target: InteractTarget | null): void {
    this.interactTarget = target
    if (target === null) this.eteindreContour()
  }

  setHitFx(fx: HitFx): void {
    this.hitFx = fx
  }

  setRecolteFx(fx: RecolteFx): void {
    this.recolteFx = fx
  }

  /** LE SANG QUI TOMBE (`sang-fx`) — posé par WorldScene, comme la gerbe de récolte.
   *  C'est CETTE vue qui l'alimente : elle seule tient ensemble l'état qui saigne
   *  (monstre `bleedMortal`/`bleedUntil`, entité `wounds.bleeding`) et le sprite
   *  d'où la goutte doit se détacher. */
  setSangFx(fx: SangFx): void {
    this.sangFx = fx
  }
  private sangFx?: SangFx
  /** La prochaine goutte de chaque acteur qui saigne (ms client) — cadence lente,
   *  désynchronisée par identité : deux bêtes ne gouttent pas en chœur. */
  private prochaineGoutte = new Map<number, number>()

  /** Une goutte se détache du corps de l'acteur `id` s'il est l'heure — `x/y` : le
   *  pied de son sprite, en px monde (relief compris). */
  private goutteDe(id: number, x: number, y: number, now: number): void {
    if (!this.sangFx) return
    const prochaine = this.prochaineGoutte.get(id)
    if (prochaine !== undefined && now < prochaine) return
    this.prochaineGoutte.set(id, now + GOUTTE_CADENCE_MS * (0.75 + ((Math.imul(id, 2654435761) >>> 16) % 100) / 200))
    this.sangFx.goutter(x, y, now, id)
  }

  setChuteArbre(fx: ChuteArbre): void {
    this.chuteArbre = fx
  }

  /**
   * LE SOL QUI TRAVAILLE (spec `cendreux.md` R21). Posé par WorldScene, comme la gerbe.
   *
   * On lui branche aussitôt son accès au TERRAIN : ce qui sort du trou dépend de ce qu'il y a
   * sous les pieds, et la carte ne vit que dans cette vue (`setPeuplement`). Sans carte, `null`
   * — la terre nue, jamais une couleur devinée : un banc headless ne peint pas un sol faux.
   */
  setReveilFx(fx: ReveilFx): void {
    this.reveilFx = fx
    fx.setTerrainSous((x, y) => (this.carte !== null ? terrainAt(this.carte, Math.floor(x), Math.floor(y)) : null))
  }
  nodes: ResourceNode[] = []
  corpses: Corpse[] = []
  /** LES RÉFUGIÉS (V2-25) : groupes de survivants sur les routes — WorldScene y branche la
   *  fenêtre à trois gestes, et on les dessine ici en huddle. */
  refugeeGroups: RefugeeGroup[] = []
  private refugeeSprites = new Map<number, Phaser.GameObjects.Image>()
  npcs: Npc[] = []
  monsters: Monster[] = []
  villages: SnapshotMessage['villages'] = []
  /** LES FONCTIONS ÉMERGENTES reconnues (spec construction R9-R22) : l'overlay les affiche. */
  functions: SnapshotMessage['functions'] = []
  /** Les autres entités (tout sauf l'avatar local, qui est prédit). */
  readonly others = new Map<number, InterpolatedSprite>()
  /** Délai d'interpolation des autres entités (ms). WorldScene le monte en multi. */
  interpDelayMs = INTERP_DELAY_DEFAULT_MS

  private structureSprites = new Map<number, Phaser.GameObjects.Image>()
  /** Pool d'étiquettes flottantes « Forge · N2 » (spec construction R22). */
  private functionLabels: Phaser.GameObjects.Text[] = []
  /** Sprites de nœuds POOLÉS, culled à la vue : la carte porte ~60k nœuds, on
   * n'en dessine que les ~centaines visibles (même trick que le décor). */
  private nodePool: Phaser.GameObjects.Image[] = []
  /** Pool PARALLÈLE au précédent : l'ombre de contact du nœud i est `nodeShadowPool[i]`.
   *  Servi et libéré par le MÊME compteur (`used`) — impossible qu'une ombre survive à son
   *  nœud ou glisse sur un autre. Toutes partagent une texture : elles se batchent. */
  private nodeShadowPool: Phaser.GameObjects.Image[] = []
  /** Pool SÉPARÉ : un arbre est deux sprites (tronc trié avec les acteurs,
   * houppier dans sa bande propre). Les autres nœuds n'en consomment aucun. */
  private crownPool: Phaser.GameObjects.Image[] = []
  /**
   * LA CANOPÉE RESTE PLEINE — pour les images, et pour elles seules.
   *
   * `crownAlpha` est une aide de JEU : la cime au-dessus de toi s'efface pour que tu voies où
   * tu marches. Sur une CAPTURE, c'est un défaut — l'atelier photographie une forêt de troncs
   * sous des houppiers fantômes, et la moitié de l'art ne se voit pas (constat d'Alexis).
   *
   * L'interrupteur ne sert donc qu'au harnais smoke, au même titre que le masquage du HUD, du
   * tampon de build et des noms de lieux : ce sont tous des retraits d'AFFORDANCE, des choses
   * que le joueur veut et que la photo ne veut pas. Il est FAUX par défaut et personne d'autre
   * ne l'appelle — le jeu joué ne peut pas tomber dessus par accident.
   */
  private canopeePleine = false
  /** Voir `setEtatGel`. */
  private etatGel: SimState | null = null
  /** Pool des SOUCHES/traces laissées par la dérive (spec recolte-vivante D1). */
  private stumpPool: Phaser.GameObjects.Image[] = []
  /** Index id→nœud pour appliquer les deltas de stock en O(1). */
  private nodeById = new Map<number, ResourceNode>()
  /** Index tuile→nœud (≤1 nœud/tuile) : le rendu n'itère que la fenêtre caméra,
   * pas les ~140k nœuds — coût par frame borné à la vue, comme le décor. */
  private nodeByTile = new Map<number, ResourceNode>()
  /**
   * LA CARTE ET LA SEED — pour savoir QUEL arbre pousse ici (2026-07-29).
   *
   * La vue ne les avait pas : son constructeur ne prend que la scène, et les nœuds arrivent par
   * `setNodes`. Or la variante d'un arbre se décide sur son SOL et sa ZONE (`arbre-peuplement`),
   * qui ne vivent que dans la carte. On les pousse donc ici, au même patron que `setWarp` —
   * plutôt que de recopier un choix de sprite dans la scène, qui le referait à chaque image.
   * Tant qu'elles sont absentes, tout arbre est l'arbre ordinaire : le repli est le sprite
   * historique, jamais une texture manquante.
   */
  private carte: WorldMap | null = null
  private worldSeed = 0
  /** Les âges des foyers de cendre du dernier snapshot — le rendu APPLIQUE R13 avec (voir
   *  `noeudTombeParLaCendre`). Vide tant qu'aucun snapshot n'est arrivé : rien ne tombe alors. */
  cendreAge: readonly number[] = []
  /** REPOUSSE EN COURS (spec recolte-vivante D2) : un nœud épuisé, avec la fenêtre
   * `[since, until]` en TICKS reçue au delta (`regrowAt`). Le rendu en tire la
   * fraction de croissance (pousse qui grandit / minéral qui se reforme), au lieu du
   * fantôme à 25 %. Purgé quand le stock revient (delta `stock > 0`). */
  private depleted = new Map<number, { since: number; until: number }>()
  /** SOUCHES (spec recolte-vivante D1) : la marque qu'un nœud de bois/plante a laissée
   * en DÉRIVANT ailleurs. Transitoire CLIENT pur (aucun état de sim) — s'efface tout
   * seul. `at` en ms client. */
  private stumps: { tx: number; ty: number; type: NodeType; at: number }[] = []
  private corpseSprites = new Map<number, Phaser.GameObjects.Image>()

  /** Où le sprite d'un cadavre est posé cette frame (px monde) — pour y faire gicler une coupe. */
  corpsePx(corpseId: number): { x: number; y: number } | null {
    const s = this.corpseSprites.get(corpseId)
    return s ? { x: s.x, y: s.y } : null
  }

  /** La texture qu'un cadavre porte cette frame (le smoke LIT l'état d'art de la carcasse). */
  corpseTexture(corpseId: number): string | null {
    return this.corpseSprites.get(corpseId)?.texture.key ?? null
  }
  /** Les gouttes de sang (C9), poolées : la sim les plafonne, le pool suit. */
  private bloodPool: Phaser.GameObjects.Image[] = []
  /** Les terriers de lapin (C16), poolés. */
  private burrowPool: Phaser.GameObjects.Image[] = []
  /** LES SOLS QUI TRAVAILLENT (spec `cendreux.md` R21) : les tertres, poolés comme les
   *  terriers — même couche, même problème (une poignée de trous à même le sol). */
  private reveilPool: Phaser.GameObjects.Image[] = []
  /** Les piles jetées au sol (C18). */
  private groundSprites = new Map<number, Phaser.GameObjects.Image>()
  /** Relief continu (Task 3) — soulève chaque billboard du sol sous ses pieds. */
  private warp?: import('../../render/warp').Warp

  constructor(private scene: Phaser.Scene) {}

  setWarp(warp: import('../../render/warp').Warp): void {
    this.warp = warp
  }

  /** Le tick et l'heure du dernier snapshot — la posture des bêtes en dépend
   * (sentinelle dérivée du tick, cerf couché hors de ses heures). */
  private tick = 0
  /**
   * LES BATTANTS EN MOUVEMENT (spec construction R26) — quelle frame de porte montrer, à cet
   * instant. Il vit ICI et pas dans `WorldScene` parce que c'est ici qu'on peint : le fait
   * (`door_toggled`) y entre par `pousserPorte`, l'état arrive avec chaque snapshot, et la
   * réconciliation des deux est tout le travail de `porte-anim`.
   */
  private readonly portes = creerPortesAnimees()
  private hour = 12

  /** LE SANG AU SOL (spec chasse C9), LE VENT (C17), LES PILES (C18). */
  blood: SnapshotMessage['blood'] = []
  wind: SnapshotMessage['wind'] = { x: 1, y: 0 }
  /** LA FORCE DU VENT au centre (`vent.md` V3) — le client la LIT désormais au lieu de
   *  l'inventer. `VentLisse` la consomme, le cadran du HUD la montre. */
  windForce: SnapshotMessage['windForce'] = VENT.AMBIANT
  /** LE FRONT MÉTÉO EN COURS (spec meteo.md), ou rien — le RECORD D'ÉLECTION, patron `wind`.
   *  Tout le reste (bande, gradient, éclairs) se recalcule du tick par les fonctions pures. */
  meteo: SnapshotMessage['meteo'] = null
  groundItems: SnapshotMessage['groundItems'] = []

  /** Applique un snapshot complet — hors avatar local (prédit par la scène). */
  /**
   * UNE PORTE VIENT D'ÊTRE POUSSÉE (fait `door_toggled`) — on lance son battant.
   *
   * C'est le SEUL déclencheur d'une animation : un simple changement d'état, lui, se CALE sans
   * jouer le geste (reconnexion, rechargement, fait perdu) — la règle et sa raison vivent dans
   * `porte-anim`.
   *
   * ═══ ET IL SE CONSOMME AVANT L'ÉTAT, PAS APRÈS (constaté par Alexis le 2026-07-30) ═══
   *
   * « Dès qu'on ouvre ou ferme une porte l'animation saute depuis son état final. » Exactement,
   * et l'ordre en était la cause entière : `WorldScene` appliquait le snapshot PUIS dépliait ses
   * faits. Le temps d'un snapshot, la porte se peignait donc à sa position de REPOS — grande
   * ouverte, `open` étant déjà vrai dans l'état — et le battant ne partait de sa position close
   * qu'à l'image suivante. On voyait la fin, puis le début : 50 ms de porte ouverte avant qu'elle
   * ne s'ouvre.
   *
   * Le fait et l'état arrivent dans le MÊME message : c'est donc ici, en tête d'`apply`, qu'ils
   * doivent se rencontrer — avant que quoi que ce soit ne se peigne. (Le module d'animation, lui,
   * était juste : rien à corriger dans `porte-anim`.)
   */
  pousserPorte(structureId: number, open: boolean): void {
    this.portes.pousse(structureId, open, this.scene.time.now)
  }

  /** Combien de battants bougent — surface de LECTURE pour le smoke test, rien d'autre. */
  get portesEnMouvement(): number {
    return this.portes.enCours(this.scene.time.now)
  }

  apply(msg: SnapshotMessage, playerId: number, now: number): void {
    // LES BATTANTS D'ABORD — avant que `syncStructures` ne choisisse une frame (voir
    // `pousserPorte` : peindre l'état avant d'avoir lu le fait montrait la porte déjà ouverte).
    for (const e of msg.events) if (e.type === 'door_toggled') this.pousserPorte(e.structureId, e.open)
    this.villages = msg.villages
    this.functions = msg.functions
    this.npcs = msg.npcs
    this.monsters = msg.monsters
    this.tick = msg.tick
    this.hour = msg.time.hourOfCycle
    this.blood = msg.blood
    this.wind = msg.wind
    this.meteo = msg.meteo
    this.groundItems = msg.groundItems
    // LES SOLS QUI TRAVAILLENT (spec `cendreux.md` R21) : le snapshot les portait déjà et
    // le client les jetait. Ils se recalent sur l'horloge du RENDU ici, une fois par
    // message ; la rampe, elle, avance à chaque frame (voir `reveil-fx`).
    this.reveilFx?.suivre(msg.reveils, msg.tick, now)
    // La position (autoritative) de l'avatar local — le FADE des toits en dépend (R24).
    const self = msg.entities.find((e) => e.id === playerId)
    // MON SANG TOMBE AUSSI (combat R7 : le sang est le sang). L'avatar local n'est pas
    // dans `others` (prédit par la scène) : sa goutte part de sa position autoritative —
    // un demi-pas derrière le sprite en pleine course, et c'est juste : le sang tombe
    // où l'on était.
    if (self?.wounds.bleeding === true) {
      const lift = this.warp?.lift(self.x, self.y) ?? 0
      this.goutteDe(playerId, self.x * TILE_PX, self.y * TILE_PX - lift, now)
    }
    this.syncStructures(msg.structures, self ? { x: self.x, y: self.y } : undefined)
    this.applyNodeDeltas(msg.nodeDeltas, now)
    this.syncCorpses(msg.corpses)
    this.syncRefugees(msg.refugeeGroups)
    this.syncEntities(msg.entities, playerId, now)
    this.syncGroundItems()
  }

  /** Le décor (variante/angle/échelle) de chaque goutte, calculé UNE fois par snapshot
   *  (`decorerSang` s'apparie aux gouttes précédentes — pas un travail de frame) et
   *  invalidé par la référence du tableau. */
  private bloodDecor: DecorSang[] = []
  private bloodDecorSource: SnapshotMessage['blood'] | undefined

  /**
   * LES GOUTTES (spec chasse C9). Une piste qu'on SUIT : les fraîches sont vives,
   * les vieilles pâlissent — c'est la seule horloge que le chasseur ait, et elle
   * doit se lire d'un coup d'œil. Poolé : le plafond de la sim (BLOOD_CAP) borne
   * ce que l'on dessine, et le pool ne grandit jamais au-delà.
   *
   * Chaque goutte a sa FORME (l'allure de la bête), son ANGLE (le sens de la
   * course) et son ÉCHELLE — tout dérivé de la donnée dans `sang-sol`, stable
   * frame après frame. Et le sang est ÉCLAIRÉ comme le reste du monde : sans
   * `setLighting`, le voile d'ambiance passant SOUS la bande de tri, une goutte
   * restait pleine couleur en pleine nuit — un décal fluorescent sur un monde
   * éteint (constaté par Alexis le 2026-08-16).
   */
  renderBlood(): void {
    if (this.bloodDecorSource !== this.blood) {
      this.bloodDecor = decorerSang(this.blood, HUNT.BLOOD_EVERY_TICKS)
      this.bloodDecorSource = this.blood
    }
    let used = 0
    for (let i = 0; i < this.blood.length; i++) {
      const b = this.blood[i]!
      const d = this.bloodDecor[i]!
      let g = this.bloodPool[used]
      if (!g) {
        g = this.scene.add.image(0, 0, 'fx-blood').setOrigin(0.5, 0.5)
        this.bloodPool[used] = g
      }
      const lift = this.warp?.lift(b.x, b.y) ?? 0
      g.setTexture(SANG_TEXTURES[d.variante]!)
      g.setPosition(b.x * TILE_PX, b.y * TILE_PX - lift)
      g.setRotation(d.angle)
      g.setDepth(corpseDepth(b.y, TILE_PX) - 1) // au sol, sous tout le reste
      // Elle sèche : de l'écarlate au brun (la teinte), et elle s'efface (l'alpha).
      const age = Math.max(0, Math.min(1, (this.tick - b.tick) / HUNT.BLOOD_TTL))
      g.setAlpha(0.85 * (1 - age * 0.8))
      g.setScale(d.echelle * (1 - age * 0.25))
      g.setTint(teinteSechage(age))
      g.setLighting(this.lighting) // pooled : réarmé chaque frame, comme les nœuds
      g.setVisible(true)
      used++
    }
    for (let i = used; i < this.bloodPool.length; i++) this.bloodPool[i]!.setVisible(false)
  }

  /**
   * LES TERRIERS (spec chasse C16). Le lapin naît avec le sien et il y court
   * quand on le lève. **Sans le trou dessiné, le lapin s'évapore** — et c'est le
   * décor qui avoue. Avec lui, la règle devient une géométrie qu'on LIT : je vois
   * le trou, je vois le lapin, je sais qu'il faut couper la ligne entre les deux.
   *
   * On dessine le terrier de chaque lapin vivant, plus ceux où l'on vient de voir
   * un lapin RENTRER (`markEscape`) — car la sim, elle, a effacé la bête : le
   * trou survivrait mal à son occupant, et le joueur n'aurait rien compris.
   */
  private escapes: { x: number; y: number; at: number }[] = []

  /** Un lapin vient de rentrer ICI (event `prey_escaped`) : le trou reste un moment. */
  markEscape(x: number, y: number, now: number): void {
    this.escapes.push({ x, y, at: now })
  }

  renderBurrows(now: number): void {
    // Les échappées vieillissent (purement visuel — rien de tout ceci n'est de la sim).
    if (this.escapes.length > 0) {
      this.escapes = this.escapes.filter((e) => now - e.at < ESCAPE_LINGER_MS)
    }

    let used = 0
    const draw = (x: number, y: number, alpha: number): void => {
      let g = this.burrowPool[used]
      if (!g) {
        g = this.scene.add.image(0, 0, 'fx-burrow').setOrigin(0.5, 0.5)
        this.burrowPool[used] = g
      }
      const lift = this.warp?.lift(x, y) ?? 0
      g.setPosition(x * TILE_PX, y * TILE_PX - lift)
      g.setDepth(corpseDepth(y, TILE_PX) - 2) // à même le sol, sous les gouttes
      g.setAlpha(alpha)
      g.setVisible(true)
      used++
    }

    for (const m of this.monsters) {
      if (m.burrowX === undefined || m.burrowY === undefined) continue
      draw(m.burrowX, m.burrowY, 0.9)
    }
    // Le trou où l'on vient de le perdre : il s'efface lentement, comme un regret.
    for (const e of this.escapes) {
      draw(e.x, e.y, 0.9 * (1 - (now - e.at) / ESCAPE_LINGER_MS))
    }
    for (let i = used; i < this.burrowPool.length; i++) this.burrowPool[i]!.setVisible(false)
  }

  /**
   * LE SOL QUI TRAVAILLE (spec `cendreux.md` R14/R21) — le tertre qui enfle et se fend.
   *
   * C'est la MOITIÉ VISIBLE du préavis que R22 achète en rapprochant le mort à sept tuiles.
   * Sans elle, le Cendreux poppait : la sim tenait ses quatre secondes, l'écran n'en montrait
   * aucune.
   *
   * Poolé et trié comme les terriers, une marche PLUS BAS qu'eux : c'est le trou d'où sort le
   * corps, il doit passer sous lui — et le corps, lui, est trié avec les acteurs. Le tertre
   * ne se peint donc jamais par-dessus ce qu'il laisse sortir.
   */
  renderReveils(now: number): void {
    let used = 0
    for (const m of this.reveilFx?.monticules(now) ?? []) {
      let g = this.reveilPool[used]
      if (!g) {
        g = this.scene.add.image(0, 0, 'fx-reveil-0').setOrigin(0.5, 0.5)
        this.reveilPool[used] = g
      }
      const lift = this.warp?.lift(m.x, m.y) ?? 0
      g.setTexture(`fx-reveil-${m.stade}`)
      g.setPosition(m.x * TILE_PX, m.y * TILE_PX - lift)
      g.setDepth(corpseDepth(m.y, TILE_PX) - 3) // sous les terriers, sous les gouttes, sous tout
      g.setScale(m.echelle)
      g.setAlpha(m.alpha)
      // LA TERRE EST CELLE DU SOL : la texture est peinte en VALEURS, la teinte lui donne
      // sa matière. C'est ce qui fait qu'un réveil dans la neige soulève de la neige.
      g.setTint(m.teinte)
      g.setVisible(true)
      used++
    }
    for (let i = used; i < this.reveilPool.length; i++) this.reveilPool[i]!.setVisible(false)
  }

  /** LES PILES AU SOL (C18) : ce qu'on a jeté existe, et ça se voit. */
  private syncGroundItems(): void {
    const seen = new Set<number>()
    for (const p of this.groundItems) {
      seen.add(p.id)
      let sprite = this.groundSprites.get(p.id)
      if (!sprite) {
        const lift = this.warp?.lift(p.x, p.y) ?? 0
        sprite = this.scene.add
          .image(p.x * TILE_PX, p.y * TILE_PX - lift, `it-${p.item}`)
          .setOrigin(0.5, 0.5)
          .setDepth(corpseDepth(p.y, TILE_PX))
          .setScale(0.8)
        // ═══ UNE FLÈCHE EST PLANTÉE, ELLE N'EST PAS POSÉE (décision d'Alexis) ═══
        //
        // Couchée à plat comme les autres piles, elle lisait comme une icône d'inventaire
        // tombée sur l'herbe. PLANTÉE, elle raconte le tir : elle est fichée là où le trait
        // a fini sa course, de biais, et l'on va la RECHERCHER. L'inclinaison vient de
        // l'identifiant de la pile — chacune la sienne, stable d'une frame à l'autre, et
        // sans un seul tirage (le client ne tire jamais : il dessine ce que la sim rend).
        if (p.item === 'arrow') {
          const biais = ((p.id * 47) % 60) / 60 // 0…1, déterministe par pile
          sprite
            .setOrigin(0.5, 0.85) // le pivot descend à la POINTE : elle entre dans le sol
            .setRotation(-0.55 + biais * 1.1) // ±32° autour de la verticale
            .setScale(0.95)
        }
        this.groundSprites.set(p.id, sprite)
      }
    }
    for (const [id, sprite] of this.groundSprites) {
      if (!seen.has(id)) {
        sprite.destroy()
        this.groundSprites.delete(id)
      }
    }
  }

  /** Rend les autres entités à `now - interpDelayMs`, entre les deux relevés qui
   *  encadrent cet instant (tampon de gigue, voir `interp.ts`). Solo : un tick de
   *  retard (fluide, ~0 latence) ; multi : ~100 ms (absorbe la gigue réseau). */
  interpolate(now: number): void {
    const target = now - this.interpDelayMs
    for (const [id, o] of this.others) {
      const p = sampleAt(o.buffer, target) ?? latest(o.buffer)
      // L'EXTRACTION SE PEINT ICI et nulle part ailleurs : c'est le seul passage qui repasse
      // sur chaque acteur À CHAQUE FRAME. La rampe de sortie est en millisecondes (elle dure
      // moins d'une seconde), la rendre au rythme des snapshots l'aurait fait monter par
      // marches de trois images.
      this.syncActor(o.sprite, p.x, p.y, o.textureKey, o.crouch, this.reveilFx?.enfouissementDe(id, now) ?? 0)
    }
  }

  /** Place un acteur (R12 + R13) en consommant TOUT l'`ActorPlacement` :
   * position pieds, depth Y-sort et taille d'affichage — l'emprise réelle est
   * déduite de la texture. `setDisplaySize` dépend de la frame courante : le
   * rappeler ici, chaque frame, couvre aussi les changements de texture.
   * `crouch` (spec chasse C19) : la silhouette se TASSE, les pieds ne bougent pas
   * (origine (0.5, 1)) — le tri en profondeur et l'emprise logique non plus.
   *
   * `enfoui` (spec `cendreux.md` R21/R22) : la part de sa hauteur encore SOUS TERRE, pendant
   * qu'un Cendreux s'extrait du sol. Même géométrie exactement que l'immersion dans l'eau,
   * et c'est délibéré : un corps qui entre dans l'eau et un corps qui sort de terre se
   * découpent pareil — on ne lui apprend pas une deuxième règle. */
  syncActor(
    sprite: Phaser.GameObjects.Image,
    x: number,
    y: number,
    textureKey: string,
    crouch = false,
    enfoui = 0,
  ): void {
    const footprint = ACTOR_FOOTPRINTS[textureKey] ?? DEFAULT_FOOTPRINT
    const p = actorPlacement(x, y, footprint, TILE_PX, BALANCE.AVATAR_HITBOX_DEPTH_TILES)
    const feetY = y + BALANCE.AVATAR_HITBOX_DEPTH_TILES / 2
    const lift = this.warp?.lift(x, feetY) ?? 0
    // ═══ DANS QUOI LE CORPS ENTRE — eau, neige, vase, terre (`render/enfoncement.ts`) ═══
    //
    // La composition a QUITTÉ cette méthode le 2026-08-24 : elle mêlait quatre milieux, deux
    // lois et trois portes au milieu du code qui pousse des sprites, et ses transitions étaient
    // sales (la vase descendait d'un coup en franchissant une arête). Elle vit maintenant dans
    // un module PUR, prouvé continu sur tout le domaine en Node — pas à l'œil sur une capture.
    //
    // Ici ne reste que ce qui demande la SCÈNE : lire les deux SDF et le manteau, et le cas de
    // la glace.
    let dRive = -99
    if (this.rive) {
      dRive = riveAt(this.rive, x, feetY)
      // SUR LA GLACE, ON MARCHE (spec gel.md G5) : une eau gelée n'immerge pas — ni coupe aux
      // genoux, ni ombre éteinte, ni reflet, ni gerbe, ni pas mouillés. Le prédicat est celui
      // du manteau (`GelLayer.etatAt`, la même lecture d'`estGele` que la glace peinte) :
      // l'acteur « plongeait » dans un lac pris parce que seule la rive était lue (grief
      // d'Alexis, 2026-08-22). `dRive` passe NÉGATIF pour que la semelle compte comme sèche.
      if (dRive > 0 && this.glaceAt?.(Math.floor(x), Math.floor(feetY)) === true) dRive = -dRive
    }
    const displayH = crouch ? p.displayH * CROUCH_FACTOR : p.displayH
    const milieux = enfoncement({
      dRive,
      dVase: this.vase ? riveAt(this.vase, x, feetY) : -99,
      hauteurNeige: this.hauteurNeigeAt?.(x, feetY) ?? 0,
      enfoui,
      displayH,
    })
    const immersion = milieux.immersion
    const coupe = milieux.coupe
    const descente = milieux.descente
    // L'OMBRE NE REMONTE QUE POUR CE QUI MONTE : la neige. Sur un sol qui cède (eau, vase),
    // le corps descend et l'ombre reste au sol.
    const coupeNeige = coupeDeNeige(this.hauteurNeigeAt?.(x, feetY) ?? 0, displayH)
    sprite.setPosition(p.px, p.py - lift + descente + 2 * immersion)
    sprite.setDepth(p.depth)
    sprite.setDisplaySize(p.displayW, displayH)
    if (coupe > 0) {
      const frame = sprite.frame
      const coupeTexels = (coupe / displayH) * frame.height
      sprite.setCrop(0, 0, frame.width, Math.max(1, frame.height - coupeTexels))
    } else if (sprite.isCropped) {
      sprite.setCrop()
    }
    sprite.setLighting(this.lighting) // couche 1 : acteurs (PNJ, faune, avatar) éclairés eux aussi
    // L'OMBRE DE CONTACT suit l'acteur (rattachée par `setData` à la création). `syncActor`
    // est le seul point où pieds/depth/emprise sont connus — la placer ici couvre joueur ET
    // autres, sans dupliquer le calcul de position. Aux pieds (p.py, pré-lift : l'ombre reste
    // au sol même si le sprite se soulève), à l'emprise du sprite, juste sous sa profondeur.
    // L'EAU LA FOND (R4) : l'anneau de flottaison prend le relais comme ancrage.
    const shadow = sprite.getData('shadow') as Phaser.GameObjects.Image | undefined
    if (shadow) {
      // SUR LA NEIGE : l'ombre remonte de la hauteur du manteau (le gap de l'art, pour une fois).
      // ⚠ LA VASE N'Y ENTRE PAS : l'ombre ne remonte que pour ce qui MONTE (la neige). Sur un
      // sol qui cède, le corps descend et l'ombre reste au sol — comme dans l'eau.
      positionShadow(shadow, p.px, p.py, p.displayW, p.depth, coupeNeige)
      // ELLE SE FOND AUSSI SOUS TERRE. Sans `enfoui` ici, un corps encore aux trois quarts
      // enfoui projetait l'ombre de contact d'un CORPS ENTIER autour du tertre — une ombre
      // pleine sous une tête qui perce, et le trou perdait toute sa profondeur.
      shadow.setAlpha(SHADOW_ALPHA * (1 - Math.max(immersion, enfoui)))
    }
    // LE REGARD DU CENDREUX (demande d'Alexis, 2026-08-21 — spec `cendreux.md` R27) : le même
    // pion d'orientation que l'avatar (`fx-gaze`), posé au bord de la tête du côté du `facing`
    // autoritatif du dernier snapshot. Un mort qui vous a vu se lit, et celui qui regarde
    // ailleurs aussi — c'est l'information qui décide de passer ou de contourner. Rattaché au
    // sprite par `setData`, comme l'ombre ; caché tant que le corps s'extrait du sol.
    const gaze = sprite.getData('gaze') as Phaser.GameObjects.Image | undefined
    if (gaze) {
      const f = sprite.getData('facing') as { x: number; y: number } | undefined
      if (f && enfoui <= 0) {
        const headY = p.py - lift + coupe - displayH * 0.6
        gaze
          .setPosition(p.px + f.x * GAZE_REACH, headY + f.y * GAZE_REACH)
          .setDepth(p.depth + 0.1)
          .setDisplaySize(GAZE_PX, GAZE_PX)
          .setVisible(true)
        if (sprite.getData('aggro') === true) gaze.setTint(BEAST_TINTS.menace)
        else gaze.clearTint()
      } else {
        gaze.setVisible(false)
      }
    }
    this.syncFlottaison(sprite, p.px, p.py - lift, p.displayW, p.depth, immersion)
    // LES ÉVÉNEMENTS D'EAU (R3/R7) : la gerbe au franchissement, les pas mouillés en sortant.
    if (this.rive) this.eau?.track(sprite, p.px, p.py, p.depth, dRive, this.scene.time.now, p.displayW)
    // LE REFLET (R13) : un acteur dans l'eau se redit tête-bêche sur la nappe sous lui.
    if (this.reflets && immersion > 0.05) {
      const coupeTexels = coupe > 0 ? Math.round((coupe / displayH) * sprite.frame.height) : 0
      this.reflets.miroir(
        sprite.texture.key,
        sprite.flipX,
        p.px,
        p.py,
        p.displayW,
        displayH,
        this.scene.time.now,
        coupeTexels,
      )
    }
  }

  /** L'ANNEAU DE FLOTTAISON (spec eau-vivante R5) : ellipse pointillée 3 phases (~7 im/s),
   *  posée à la ligne de flottaison, SOUS l'acteur dans le tri — c'est lui qui ancre le
   *  corps à l'eau quand l'ombre de contact s'est fondue. Vacillement par l'alpha seul. */
  private syncFlottaison(
    sprite: Phaser.GameObjects.Image,
    px: number,
    py: number,
    displayW: number,
    depth: number,
    immersion: number,
  ): void {
    let ring = sprite.getData('flottaison') as Phaser.GameObjects.Image | undefined
    if (immersion <= 0.08) {
      ring?.setVisible(false)
      return
    }
    if (!ring) {
      ring = this.scene.add.image(0, 0, 'fx-flottaison-0').setOrigin(0.5, 0.5)
      sprite.setData('flottaison', ring)
    }
    const now = this.scene.time.now
    ring.setTexture(`fx-flottaison-${Math.floor(now / 150) % 3}`)
    ring.setPosition(px, py)
    ring.setDepth(depth - 0.01)
    const w = displayW + 12
    ring.setDisplaySize(w, w * 0.45)
    ring.setAlpha(immersion * (0.34 + 0.1 * Math.sin(now / 260 + px)))
    ring.setVisible(true)
  }

  private syncEntities(entities: Entity[], playerId: number, now: number): void {
    const seen = new Set<number>()
    // Index par entityId, UNE fois par snapshot — le `.find` par entité était
    // O(N×M) à chaque snapshot.
    const npcByEntity = new Map(this.npcs.map((n) => [n.entityId, n]))
    const monsterByEntity = new Map(this.monsters.map((m) => [m.entityId, m]))
    // LES SENTINELLES du tick (R9bis) : dérivées ICI, avec exactement le même
    // calcul que la sim (`sentinelOf`) — la posture tête haute ne ment jamais.
    const herds = new Map<number, Monster[]>()
    for (const m of this.monsters) {
      if (m.herdId === undefined) continue
      const members = herds.get(m.herdId)
      if (members) members.push(m)
      else herds.set(m.herdId, [m])
    }
    const sentinels = new Set<number>()
    for (const members of herds.values()) {
      const id = sentinelOf(members, this.tick)
      if (id >= 0) sentinels.add(id)
    }
    for (const entity of entities) {
      if (entity.id === playerId) continue
      seen.add(entity.id)
      let record = this.others.get(entity.id)
      if (record) {
        pushSample(record.buffer, now, entity.x, entity.y)
      } else {
        const sprite = this.scene.add.image(0, 0, 'spr-npc').setOrigin(0.5, 1)
        const shadow = createContactShadow(this.scene)
        sprite.setData('shadow', shadow) // `syncActor` la retrouve par là
        // L'ENFOUISSEMENT DÈS LA PREMIÈRE POSE. Un Cendreux qui sort du sol NAÎT ici — c'est
        // le snapshot de son émergence qui crée son sprite — et le poser à pleine hauteur
        // pour se reposer sur `interpolate` à la frame suivante ferait dépendre la géométrie
        // d'un ordre d'appels. Elle doit être juste par construction.
        this.syncActor(sprite, entity.x, entity.y, 'spr-npc', false, this.reveilFx?.enfouissementDe(entity.id, now) ?? 0)
        record = {
          sprite, shadow, textureKey: 'spr-npc', crouch: false,
          buffer: [{ at: now, x: entity.x, y: entity.y }],
          repos: nouveauRepos(now),
          miroir: nouveauMiroir(false, now),
        }
        this.others.set(entity.id, record)
      }
      // Les villageois se distinguent des errants et des monstres ; un
      // dormeur s'estompe ; un wind-up flashe (lisibilité, spec R4).
      const npc = npcByEntity.get(entity.id)
      const monster = monsterByEntity.get(entity.id)
      // LE REGARD DU CENDREUX (R27) : le pion naît avec son premier snapshot, et le `facing`
      // de chaque snapshot l'accompagne — `syncActor` le pose là où il connaît la tête.
      if (monster?.type === 'cendreux') {
        if (!record.sprite.getData('gaze')) {
          record.sprite.setData('gaze', this.scene.add.image(0, 0, 'fx-gaze').setOrigin(0.5, 0.5).setVisible(false))
        }
        record.sprite.setData('facing', entity.facing)
        // LE REGARD S'ALLUME (R27bis, décision d'Alexis) : quand il a un VIVANT pour cible,
        // le pion prend la teinte MENACE — celle du loup qui bondit et du sanglier qui charge,
        // « ça vient sur toi ». C'est notre grognement d'aggro : un mort ne respire pas, il
        // n'a pas de voix à donner — il a un regard, et on voit quand il s'est posé sur vous.
        // Aller vérifier un dernier lieu (⑨) ou marcher vers un feu ne l'allume pas : il
        // cherche, il n'a pas trouvé.
        record.sprite.setData('aggro', monster.targetId !== null)
      }
      // LA POSTURE dit l'état (R9bis/C19) — et l'alpha garde sa silhouette
      // propre (spec faune R12) : le joueur doit pouvoir le désigner d'un coup
      // d'œil, c'est LUI qu'il faut abattre. Le PAS de l'entité (`moved`, dans le
      // snapshot) décide du couché : une bête qui marche est debout, fût-il 3 h
      // du matin (« ils bougent allongés », Alexis, 2026-08-01).
      const posee = majRepos(record.repos, entity.moved, now)
      const key = monster
        ? beastTexture(monster, sentinels.has(entity.id), this.hour, posee)
        : this.lighting ? 'spr-npc_lit' : 'spr-npc' // l'humain bascule (R9) ; la bête reste peinte (consigné)
      if (record.textureKey !== key) {
        // setTexture réinitialise la frame : ne le rappeler que si la texture
        // change vraiment. `syncActor` re-applique aussitôt l'emprise (R12).
        record.sprite.setTexture(key)
        record.textureKey = key
        const l = latest(record.buffer)
        this.syncActor(record.sprite, l.x, l.y, key)
      }
      // LE REGARD (R9bis) : le sprite se met dans le sens où la bête regarde —
      // la sim oriente déjà `facing` (marche, gel qui fixe, sentinelle qui
      // balaie). On ne bascule qu'au-delà d'un seuil : un regard plein nord ne
      // fait pas claquer le miroir à chaque frame. Et le sens doit TENIR
      // (`majMiroir`) : le pas est rangé en huit directions, une visée qui rase
      // une frontière de secteur alternait sinon d'un côté à l'autre à chaque
      // tick — le sprite entier se retournait, et ça se lisait comme un
      // tremblement (Alexis, 2026-08-01).
      if (monster && Math.abs(entity.facing.x) > 0.25) {
        const facesRight = ACTOR_FOOTPRINTS[key]?.facesRight === true
        record.sprite.setFlipX(majMiroir(record.miroir, facesRight ? entity.facing.x < 0 : entity.facing.x > 0, now))
      }
      record.crouch = isCrouched(monster, entity)
      record.sprite.setTint(beastTint(monster, entity.windup !== undefined, npc !== undefined, this.tick))
      record.sprite.setAlpha(npc?.sleeping ? 0.45 : 1)
      // LA PLAIE GOUTTE. L'état qui saigne (la même vérité que la teinte ci-dessus :
      // `saigneBete`, ou `wounds.bleeding` pour un humain) laisse TOMBER son sang —
      // la piste au sol, elle, reste l'affaire de la sim (C9) : ici on peint la chute.
      if (monster ? saigneBete(monster, this.tick) : entity.wounds.bleeding === true) {
        this.goutteDe(entity.id, record.sprite.x, record.sprite.y, now)
      }
    }
    for (const [id, o] of this.others) {
      if (!seen.has(id)) {
        o.shadow.destroy() // l'ombre s'en va avec son acteur — jamais orpheline
        ;(o.sprite.getData('flottaison') as Phaser.GameObjects.Image | undefined)?.destroy()
        ;(o.sprite.getData('gaze') as Phaser.GameObjects.Image | undefined)?.destroy() // le regard aussi
        o.sprite.destroy()
        this.others.delete(id)
        // Abattu ou dissipé pendant qu'il s'extrayait : son extraction n'a plus de corps.
        // Sans cet oubli, l'id resterait dans la table jusqu'à ce que sa rampe expire — et
        // un id d'entité se recycle.
        this.reveilFx?.oublier(id)
        this.prochaineGoutte.delete(id) // même raison : un id d'entité se recycle
      }
    }
  }

  /** Synchronise les sprites de structures avec le snapshot. `self` = position de
   *  l'avatar local, pour la RÉVÉLATION des toits (comme la cime des arbres, R24). */
  /** Les dérivations pures du bâti, servies par le mémo (voir `DerivesBati`) : recalculées
   *  SEULEMENT quand le tableau change au sens de `memeBati`. */
  private derivesDe(structures: Structure[]): DerivesBati {
    if (this.derives !== null && memeBati(this.derives.pour, structures)) {
      this.derives.pour = structures // des deux tableaux égaux on garde le neuf — l'ancien se libère
      return this.derives
    }
    // MURS CONTINUS (décision d'Alexis) : un mur s'autotuile sur ses voisins (murs
    // ET portes) pour former une paroi, pas des carrés juxtaposés. On indexe d'abord.
    const wallTiles = new Set<string>()
    for (const s of structures) if (s.type === 'wall' || s.type === 'door') wallTiles.add(`${s.tx},${s.ty}`)
    // LA CLÔTURE S'AUTOTUILE COMME LE MUR — et il le fallait : sans masque, elle dessinait ses
    // deux lisses HORIZONTALES quoi qu'il arrive, donc une barrière courant du nord au sud
    // montrait des barreaux en travers d'elle-même. Elle ne connaît pas les murs (une clôture
    // ne se raccorde pas à une maçonnerie : elle bute dessus).
    const clotureTiles = new Set<string>()
    for (const s of structures) if (s.type === 'cloture') clotureTiles.add(`${s.tx},${s.ty}`)
    // LE MASSIF S'AUTOTUILE SUR LA ROCHE (étage 2 révisé, 2026-08-11) : ses semblables,
    // le terrain falaise et le hors-carte — le masque du liseré se lit là-dessus.
    const massifTiles = new Set<string>()
    for (const s of structures) if (s.type === 'massif') massifTiles.add(`${s.tx},${s.ty}`)
    // LE SEUIL SE LIE À SON VOISIN (porte de deux cases) : il ne connaît que ses semblables à
    // l'ouest et à l'est — le montant tombe de ce côté-là, et la porte devient une ouverture.
    const seuilTiles = new Set<string>()
    for (const s of structures) if (s.type === 'encadrement') seuilTiles.add(`${s.tx},${s.ty}`)
    // LA PORTE DOUBLE SE LIT ICI (spec construction R27) : l'appariement est DÉRIVÉ du snapshot,
    // jamais posé en état — la même dérivation que la sim (`doorPairs`, une seule vérité pour
    // « ces deux vantaux font un cadre »). LES PANS — l'unité d'effacement du bâti — sont un
    // dérivé pur du même tableau : ici se calcule QUEL côté de bâtiment PEUT s'effacer (le
    // pourquoi vit dans `render/pans.ts`) ; quel pan est effectivement TOMBÉ suit l'avatar,
    // donc vit hors mémo (`pansTombes`, à chaque snapshot).
    this.derives = {
      pour: structures,
      wallTiles,
      clotureTiles,
      massifTiles,
      seuilTiles,
      doubles: doorPairs(structures),
      pans: calculerPans(structures),
    }
    return this.derives
  }

  private syncStructures(structures: Structure[], self?: { x: number; y: number }): void {
    this.structures = structures
    const { wallTiles, clotureTiles, massifTiles, seuilTiles, doubles, pans } = this.derivesDe(structures)
    this.nappe = calculerNappe(structures, self)
    const tombes = pansTombes(pans, self, PAN_DISTANCE_TUILES)
    const seen = new Set<number>()
    /** La cible de démolition a-t-elle été VUE cette frame ? Sinon le halo s'éteint — sans
     *  ça, il resterait accroché à un mur qu'on vient justement de détruire. */
    let haloVu = false
    for (const s of structures) {
      seen.add(s.id)
      const isRoof = s.type === 'roof'
      let sprite = this.structureSprites.get(s.id)
      if (!sprite) {
        const a = tileFeetAnchor(s.tx, s.ty, TILE_PX)
        const lift = this.warp?.lift(s.tx + 0.5, s.ty + 1) ?? 0
        // LES COUCHES (décision d'Alexis) : le SOL au ras du sol (sous les acteurs),
        // le TOIT au-dessus (comme un houppier, il se révèle au loin), le reste trié.
        const depth =
          s.type === 'fire'
            ? GROUND_FIRE_DEPTH
            : isRoof
              ? ROOF_DEPTH + s.ty
              : s.type === 'floor' || s.type === 'friche' || s.type === 'terre' || s.type === 'roc'
                ? FLOOR_DEPTH // friche et terre battue SONT le sol : un champ ne se dresse pas
                // LE MASSIF EST PLAT comme la falaise (pivot RimWorld) : au-dessus des sols,
                // sous tout ce qui a des pieds — la poche derrière lui reste visible.
                : s.type === 'massif'
                  ? FLOOR_DEPTH + 0.5
                // UNE BARRIÈRE TRIE SUR SA BANDE, pas sur sa tuile : sinon, collé à un mur par
                // le bas, on passe derrière lui (cf. `barriereDepth`). Et LE SEUIL APRÈS LE MUR :
                // une bande de mur déborde d'une demi-épaisseur chez ses voisins, et sa pierre
                // mordait le bois de la porte (constaté par Alexis).
                : s.edges !== undefined && (s.type === 'wall' || s.type === 'palissade' || s.type === 'cloture' || s.type === 'encadrement' || s.type === 'door')
                  // LE SEUIL **ET LA PORTE** APRÈS LE MUR (`TIE_SEUIL`). Une bande de mur déborde
                  // d'une demi-épaisseur chez ses voisins pour se recoudre ; à pieds égaux et
                  // départage identique, l'ordre tombait sur l'ordre de POSE, et la pierre du mur
                  // d'à côté mordait le bois. C'est le défaut corrigé pour l'`encadrement` le
                  // 2026-07-27 — la porte du joueur, née depuis, l'avait hérité intact.
                  ? barriereDepth(s.ty, s.edges, TILE_PX, DEMI_BANDE_TUILES,
                      s.type === 'encadrement' || s.type === 'door' ? TIE_SEUIL : undefined)
                  : s.type === 'encadrement'
                    ? seuilDepth(s.ty, TILE_PX)
                    : structureDepth(s.ty, TILE_PX)
        // LE TOIT SE DESSINE À LA CRÊTE DU MUR (calage mesuré, smoke `toits` 2026-08-10) :
        // levé de `MUR_HT`, son bord bas rejoint la crête de la façade sud à −2 px (le demi-
        // débord de bande) et son plan coiffe la face du mur nord. Ancré au sol, il était un
        // TAPIS : couture mesurée à −34 px — le toit recouvrait la façade au lieu de la
        // coiffer, et la face grise du mur nord dominait le lieu.
        const leve = isRoof ? MUR_HT : 0
        sprite = this.scene.add.image(a.px, a.py - lift - leve, `st-${s.type}`).setOrigin(0.5, 1).setDepth(depth)
        this.structureSprites.set(s.id, sprite)
      }
      sprite.setLighting(this.lighting) // couche 1 : murs, portes, ateliers… éclairés (pooled → chaque frame)
      // Les CHIPS dressés basculent sur leur albédo aplati + normale (da-feeling R4). Les murs,
      // la porte (autotile re-texturé plus bas) et le feu (swap dédié) ont leurs propres chemins.
      if (LIT_STRUCTURE_TYPES.has(s.type) || BATI_LIT_TYPES.has(s.type)) {
        sprite.setTexture(this.lighting ? `st-${s.type}_lit` : `st-${s.type}`)
      }
      if (s.type === 'cloture') {
        // La clôture prend la texture qui CONNECTE ses voisines : poteau au centre, lisses
        // vers chaque direction du masque. Un bout d'enclos n'a qu'une branche, un angle deux,
        // un poteau isolé reste un poteau — les seize cas d'un coup, sans table.
        const m = wallMask(clotureTiles, s.tx, s.ty)
        sprite.setTexture(this.lighting ? `st-cloture-${m}_lit` : `st-cloture-${m}`)
      }
      if (s.type === 'massif') {
        // ═══ LE MASSIF EMPRUNTE L'ART DE LA FALAISE (révision d'Alexis, 2026-08-11) ═══
        //
        // La roche d'un antre EST la roche du monde : même ardoise plate vue de dessus, même
        // liseré éclairé sur les bords ouverts — et PLATE (profondeur sous les acteurs), pour
        // que l'intérieur de la poche reste visible : « il faut que ça respire ». Le masque
        // lit les massifs voisins, le terrain falaise ET le hors-carte : au flanc d'un vrai
        // escarpement, la couture disparaît — deux roches, un seul dessin.
        const roche = (tx: number, ty: number): boolean => {
          if (massifTiles.has(`${tx},${ty}`)) return true
          if (this.carte === null) return false
          if (tx < 0 || ty < 0 || tx >= this.carte.width || ty >= this.carte.height) return true
          return terrainAt(this.carte, tx, ty) === TERRAIN_CLIFF
        }
        const nOuvert = !roche(s.tx, s.ty - 1)
        const eOuvert = !roche(s.tx + 1, s.ty)
        const oOuvert = !roche(s.tx - 1, s.ty)
        const variant = hash2(s.tx, s.ty) < 0.5 ? 0 : 1
        sprite.setTexture(cliffKey('top', (nOuvert ? 1 : 0) | (eOuvert ? 2 : 0) | (oOuvert ? 4 : 0), variant))
      }
      if (s.type === 'fire') {
        // Les BÛCHES normal-mappées : bois mat `_lit` quand l'éclairage est armé (relief
        // calculé par la normal map cylindrique), sinon le sprite ombré simple.
        sprite.setTexture(this.lighting ? 'st-fire_lit' : 'st-fire')
        // La couleur suit l'ÉTAT (spec feu-station S1) : allumé → couleur du Feu (alignement R9,
        // bleu↔blanc↔rouge) ; braises → ambre sombre ; éteint → bûches froides et grises.
        const st = fireStateAt(this.tick, s)
        if (st === 'out') sprite.setTint(0x555560)
        else if (st === 'ember') sprite.setTint(0x8a4a2a)
        else {
          const warmth = this.villages.find((v) => v.id === s.villageId)?.warmth ?? 0
          sprite.setTint(warmthColor(warmth))
        }
      } else if (s.edges !== undefined && (s.type === 'wall' || s.type === 'palissade' || s.type === 'cloture' || s.type === 'door')) {
        // ═══ LA BARRIÈRE SUR ARÊTE — la forme est PORTÉE, plus devinée ═══
        //
        // L'autotuilage lisait le voisinage ; ici `edges` dit tout. Seize masques suffisent, et
        // la question des coins rentrants disparaît : ils s'expriment directement.
        // LES PV DE RÉFÉRENCE SUIVENT LE MATÉRIAU. Comparer au barème de BASE (200, le bois)
        // alors qu'un mur de pierre en vaut 500 faisait passer la Ferme pour NEUVE : ses murs
        // à 45 % valent 225, soit au-dessus du seuil calculé sur 200. Le lieu s'appelait
        // « ruinée » et rendait une maçonnerie propre.
        const maxHp = s.material ? WALL_TIERS[s.material][s.type === 'door' ? 'door' : 'wall'].hp : STRUCTURE_HP[s.type]
        const ruine = s.villageId === 0 && s.hp < maxHp * RUINE_SEUIL
        // LA PORTE A SA FAMILLE (R23) : elle bloque l'étranger, donc elle se dessine FERMÉE —
        // l'`encadrement` du bâti généré, lui, est une huisserie percée. Pas de variante ruinée :
        // le monde bâti n'en pose pas, et une porte de joueur abandonnée n'existe pas encore.
        // LE MUR DE BOIS A SA FAMILLE aussi (retour d'Alexis, 2026-08-01) : les tons du
        // matériau vivent dans la TEXTURE (aplats de madriers), plus dans une teinte que
        // personne ne lisait. La pierre et le métal gardent la maçonnerie neutre + teinte.
        // ET LE VANTAIL APPARIÉ CHANGE DE FAMILLE (R27) : la moitié ouest/nord du cadre prend
        // `door2a`, l'autre `door2b` — un seul jambage chacune, les battants se rejoignent au
        // centre. Non apparié, il reste une porte simple ; démolir son jumeau l'y ramène seul.
        const paire = s.type === 'door' ? doubles.get(s.id) : undefined
        const fam =
          s.type === 'door' ? (paire === undefined ? 'door' : paire.premiere ? 'door2a' : 'door2b')
          : s.type === 'cloture' ? 'cloture'
          : s.type === 'palissade' ? 'palissade'
          : ruine ? 'wall-ruine'
          : (s.material ?? 'wood') === 'wood' ? 'wall-bois'
          : 'wall'
        // ═══ LA DÉCOUPE DE FAÇADE (à la Zomboid — décision d'Alexis, 2026-07-27) ═══
        //
        // QUEL MUR CACHE LA PIÈCE ? Celui qui est DEVANT elle, entre elle et la caméra — donc
        // celui posé au SUD de la salle. Et ce mur-là porte le bit NORD (1) : une barrière se
        // pose sur la tuile du DEHORS avec le bit qui REGARDE la région (`poi-batis`), si bien
        // que le mur du bas d'une pièce la regarde vers le nord. On testait le bit 4 — c'est
        // l'inverse : ça effaçait le mur du HAUT, dont la face ne monte que sur le dehors et ne
        // cachait donc rien. Le mur qui gênait, lui, restait plein.
        //
        // ET IL SE COUPE, il ne s'efface pas : la texture `coupe` ne garde que l'empreinte au
        // sol, sombre. Un mur à 22 % laissait un fantôme gris sur toute la hauteur de sa face —
        // la salle restait voilée par ce qu'on prétendait retirer. C'est ce qui achète la
        // hauteur : le mur peut avoir du corps dehors, puisqu'il se tranche dedans.
        // ON TRANCHE PAR PAN, JAMAIS PAR TUILE (décision d'Alexis) : un trou qui suit le
        // joueur dans un mur continu lit comme une brèche, donc comme une entrée. Le côté
        // entier tombe, ou rien. La règle et ses raisons : `render/pans.ts`.
        //
        // L'EMPREINTE SE LIT DANS `COUPE_DE`, jamais dans une cascade à défaut : c'est très
        // exactement ce qui a fait prendre à une porte OUVERTE l'empreinte pleine d'un MUR
        // (mesuré au navigateur le 2026-07-30 — `door-ouverte` ne figurait dans aucune branche).
        // La table vit à côté des textures qu'elle nomme, et un test la garde complète.
        //
        // ET C'EST ELLE QUI DIT AUSSI QUI NE TOMBE PAS : **une famille sans empreinte reste
        // DEBOUT**, quel que soit son pan. C'est le cas de la PORTE (décision d'Alexis,
        // 2026-07-30 : « contrairement aux murs, les portes sont toujours visibles »). Une porte
        // se pousse à portée de bras — 1,5 tuile — et un pan tombe à deux : tranchée avec son
        // mur, elle l'était donc TOUJOURS au moment précis où on la regarde s'ouvrir, et son
        // battant ne pivotait qu'à plat, en empreinte. Debout, l'entrée reste lisible dans la
        // ligne d'empreintes, et le geste se voit. Une seule table décide — pas de second
        // drapeau ici, qui finirait par la contredire en silence.
        const coupeFam = COUPE_DE[fam]
        const cacheLaSalle = coupeFam !== undefined && (pans.parBarriere.get(s.id) ?? []).some((i) => tombes.has(i))
        // ═══ LA PORTE PORTE SA FRAME (spec construction R26) ═══
        //
        // Son battant pivote en cinq positions ; l'état (`open`) n'est que la position de REPOS.
        // `portes` décide laquelle montrer maintenant — il anime sur le FAIT (`door_toggled`) et
        // se cale sur l'ÉTAT quand les deux se contredisent (voir `porte-anim`).
        //
        // ET LA DÉCOUPE S'ANIME AUSSI : on pousse une porte à portée de bras (1,5 tuile) et un
        // pan tombe à deux — la porte qu'on vient d'ouvrir est donc TOUJOURS rendue tranchée.
        // Une animation qui ne vivrait que debout ne serait jamais vue.
        const frame = s.type === 'door' ? this.portes.frame(s.id, s.open === true, this.scene.time.now) : -1
        const suffixe = frame >= 0 ? `-f${frame}` : ''
        const cle = cacheLaSalle
          ? `st-${coupeFam}-e${s.edges}${suffixe}`
          : `st-${fam}-e${s.edges}${suffixe}`
        sprite.setTexture(this.lighting && !cacheLaSalle ? `${cle}_lit` : cle)
        // L'ANCRAGE D'UNE BARRIÈRE N'EST PAS LE BAS DE SON IMAGE. Le mur est à cheval sur
        // l'arête : son sprite déborde d'une demi-épaisseur SOUS sa tuile. On ancre donc au bas
        // de la TUILE (`EDGE_ORIGIN_Y`) — à défaut, tout le bâti remonterait d'autant.
        sprite.setOrigin(0.5, EDGE_ORIGIN_Y[fam] ?? 1)
        // La teinte reste douce : la texture porte déjà ses aplats et ses tons. La réassombrir
        // autant qu'un mur endommagé écraserait ce travail. (Le mur COUPÉ ne se teinte pas : son
        // empreinte est déjà une ombre, une teinte de matériau n'y voudrait rien dire.)
        //
        // MAIS ELLE PORTE LE MATÉRIAU (spec construction R8) : bois chaud, pierre froide —
        // sinon l'amélioration d'un mur d'arête ne se voyait nulle part. Les RUINES gardent
        // leur presque-blanc : leur texture porte son propre appareil, et la DA de la Ferme
        // est calibrée dessus. La clôture n'a pas de palier — presque blanche aussi.
        const ratio = Math.max(0, Math.min(1, s.hp / (maxHp || 1)))
        const dim = 0.82 + 0.18 * ratio
        if (cacheLaSalle) sprite.clearTint()
        else {
          const rgb: readonly [number, number, number] =
            ruine || s.type === 'cloture' || s.type === 'palissade'
              ? [248, 250, 255]
              : EDGE_MATERIAL_RGB[s.material ?? 'wood']
          sprite.setTint(Phaser.Display.Color.GetColor(
            Math.floor(rgb[0] * dim), Math.floor(rgb[1] * dim), Math.floor(rgb[2] * dim),
          ))
        }
        sprite.setAlpha(1)
      } else if (s.type === 'wall') {
        // Le mur prend la texture qui CONNECTE ses voisins, teintée par son matériau
        // (les textures d'autotuile sont neutres) et assombrie par les dégâts.
        const max = s.material ? WALL_TIERS[s.material].wall.hp : STRUCTURE_HP.wall
        const ratio = s.hp / max
        const masque = wallMask(wallTiles, s.tx, s.ty)
        if (s.villageId === 0 && ratio < RUINE_SEUIL) {
          // LE MUR D'UNE RUINE A SON PROPRE APPAREIL (render/ruined-wall.ts) : crête ébréchée,
          // pierres descellées, joints gravés dans la normale. Une teinte ne pouvait pas le
          // donner — le mur ordinaire est une DALLE, quelle que soit sa couleur.
          sprite.setTexture(this.lighting ? `st-wall-ruine-${masque}_lit` : `st-wall-ruine-${masque}`)
          // Teinte ADOUCIE : la texture porte déjà son propre modelé (cinq gris, joints peints,
          // mousse, crête ébréchée). La réassombrir autant que le mur neuf écraserait ce
          // travail — on garde la couleur du matériau et un rien de vieillissement. Presque
          // BLANCHE, donc : le mur ruiné tient sa valeur de son albédo, pas de sa teinte.
          const dim = 0.82 + 0.18 * Math.max(0, Math.min(1, ratio))
          sprite.setTint(Phaser.Display.Color.GetColor(
            Math.floor(244 * dim), Math.floor(246 * dim), Math.floor(252 * dim),
          ))
        } else {
          sprite.setTexture(`st-wall-${masque}`)
          sprite.setTint(wallTint(s.material, ratio))
        }
      } else if ((s.type === 'floor' || s.type === 'roof') && s.villageId === 0 && s.hp < STRUCTURE_HP[s.type] * RUINE_SEUIL) {
        // LE SOL ET LE TOIT D'UNE RUINE ONT LEUR PROPRE TEXTURE, et il le fallait : une
        // teinte ne fait pas un TROU. Un chaume ruiné laisse voir dessous, un dallage percé
        // laisse voir la terre — c'est ce qui distingue « tombé » de « à l'ombre ».
        sprite.setTexture(`st-${s.type}-ruine`)
      } else if (s.type === 'friche' || s.type === 'terre' || s.type === 'roc') {
        // La friche tire sa variante de sa POSITION — un champ de vingt tuiles ne peut pas
        // porter vingt fois le même carré. Déterministe des deux côtés, sans une donnée de plus.
        sprite.setTexture(`st-${s.type}-${(((s.tx * 7 + s.ty * 13) % 4) + 4) % 4}`)
      } else if (isPlot(s.type)) {
        // LE POTAGER (agriculture) : parcelle/serre/terroir VERDISSENT à mesure que la culture pousse — terre
        // brune vide/semée, vert vif MÛRE (« c'est prêt » se lit d'un coup d'œil). Stade PUR
        // (`cropStage`, la même source que la récolte) — pas de sprite à gérer, juste la teinte.
        const stage = cropStage(s, this.tick) // -1 = vide, 0 → 1 en pousse
        if (stage < 0) sprite.clearTint()
        else sprite.setTint(Phaser.Display.Color.GetColor(Math.floor(150 - 44 * stage), Math.floor(150 + 95 * stage), Math.floor(90 - 30 * stage)))
      } else {
        // LE SEUIL NE SUIT PLUS SON MUR — il reste DEBOUT (décision d'Alexis, 2026-07-30 :
        // « idem pour un encadrement de porte sans porte »). Il tombait avec son pan, comme la
        // porte du joueur ; ce qu'on craignait alors — un LINTEAU flottant au-dessus d'une salle
        // ouverte — n'arrive pas, parce que ce n'est pas le linteau seul qui reste, ce sont ses
        // jambages avec lui : un portique, et un portique dit « on entre par ici » là où une
        // ligne d'empreintes ne dit plus rien.
        // (Le swap `_lit` est déjà posé plus haut par `BATI_LIT_TYPES` ; on ne repasse ici que
        // pour l'ancrage et l'autotuilage entre seuils mitoyens.)
        if (s.type === 'encadrement') {
          sprite.setOrigin(0.5, EDGE_ORIGIN_Y.encadrement ?? 1) //  à cheval, comme le mur qu'il perce
          const m = (seuilTiles.has(`${s.tx - 1},${s.ty}`) ? 1 : 0) | (seuilTiles.has(`${s.tx + 1},${s.ty}`) ? 2 : 0)
          sprite.setTexture(this.lighting ? `st-encadrement-${m}_lit` : `st-encadrement-${m}`)
        }
        const max = (s.type === 'door' && s.material ? WALL_TIERS[s.material].door.hp : STRUCTURE_HP[s.type]) || 1
        const ratio = Math.max(0, Math.min(1, s.hp / max))
        if (s.villageId === 0) {
          // LES PIÈCES DU MONDE (`poi-batis.ts`) NE SONT PAS « ENDOMMAGÉES », ELLES SONT VIEILLES.
          // Le rouge veut dire « répare-moi » : c'est un appel à l'action, et il n'a aucun sens
          // sur une ferme abandonnée depuis dix ans — vu à l'œil, il la faisait virer au ROSE.
          // Une chose ancienne perd sa lumière et sa couleur : on assombrit, et on tire vers le gris.
          //
          // La pente est FRANCHE (0,40 au lieu de 0,55 au pied) : la première version était trop
          // douce, la ruine lisait « maison à l'ombre ». Une ruine doit se distinguer d'un bâtiment
          // entretenu à la première seconde, sans lire son nom.
          const dim = 0.4 + 0.6 * ratio
          const gris = 0.58 + 0.42 * ratio // 1 = couleur pleine, plus bas = délavé
          const c = Math.floor(255 * dim)
          sprite.setTint(Phaser.Display.Color.GetColor(c, Math.floor(c * (1 - (1 - gris) * 0.2)), Math.floor(c * gris)))
        } else {
          // Une structure endommagée s'assombrit et rougit — lisible de loin.
          const shade = Math.floor(140 + 115 * ratio)
          sprite.setTint(Phaser.Display.Color.GetColor(255, shade, shade))
        }
      }
      // LE TOIT S'EFFACE COMME UN PAN DE MUR (décision d'Alexis, 2026-08-10 : « fais comme
      // les murs, ils disparaissent complètement lorsqu'on rentre dans un bâtiment ») :
      // dedans, le couvert disparaît TOUT À FAIT — le voile à 0,12 laissait un fantôme de
      // chaume au-dessus de la pièce qu'on habite.
      if (isRoof) {
        // PAR PIÈCE, PAS PAR DISQUE : le couvert de la pièce où l'on est s'efface d'un coup,
        // les autres restent pleins. Hors bâtiment, `nappe` est nul et tout reste opaque —
        // c'est ce que le disque des cimes ne savait pas faire.
        sprite.setAlpha(this.dedansAvec(s.tx, s.ty) ? 0 : 1)
      }
      // CE QUE LE MARTEAU VA DÉTRUIRE — en DERNIER, quand le sprite a fini de se peindre :
      // le halo en recopie l'état exact (texture, frame, ancre, échelle, profondeur).
      if (s.id === this.demolishTargetId) {
        this.peindreHalo(sprite)
        haloVu = true
      }
    }
    for (const [id, sprite] of this.structureSprites) {
      if (!seen.has(id)) {
        sprite.destroy()
        this.structureSprites.delete(id)
      }
    }
    if (!haloVu) this.demolishHalo?.setVisible(false)
  }

  /**
   * LE HALO DE DÉMOLITION — une SILHOUETTE PLEINE rouge, calquée sur la pièce visée.
   *
   * Pourquoi pas une simple teinte sur le sprite (premier jet, 2026-08-01) : une teinte
   * MULTIPLIE. Sur un mur COUPÉ — et un mur qu'on s'approche de démolir est presque toujours
   * coupé, son pan tombe à 2 tuiles alors qu'on démolit à 6 — la texture n'est plus le mur
   * debout mais son EMPREINTE, sombre par construction. MESURÉ au navigateur : le mur visé
   * rendait RGB(26,11,10), quasi noir, quand son voisin non visé rendait (227,158,98). Rouge
   * dans le code, invisible à l'écran.
   *
   * `TintModes.FILL` peint la silhouette d'UNE couleur, quelle que soit la texture dessous :
   * c'est la seule façon d'être aussi lisible sur une empreinte que sur un mur debout. Le halo
   * recopie tout du sprite (texture, frame, ancre, échelle, miroir) — il ne peut donc pas se
   * décaler de ce qu'il désigne, même quand la porte s'anime ou que le mur se recoud.
   */
  private peindreHalo(sprite: Phaser.GameObjects.Image): void {
    const h = (this.demolishHalo ??= this.scene.add
      .image(0, 0, sprite.texture.key)
      .setTintMode(Phaser.TintModes.FILL))
    h.setTexture(sprite.texture.key, sprite.frame.name)
      .setOrigin(sprite.originX, sprite.originY)
      .setPosition(sprite.x, sprite.y)
      .setScale(sprite.scaleX, sprite.scaleY)
      .setFlipX(sprite.flipX)
      // JUSTE AU-DESSUS de ce qu'il désigne, jamais plus haut : +1 sauterait par-dessus le toit
      // voisin (les toits se trient sur `ROOF_DEPTH + ty`, de un en un).
      .setDepth(sprite.depth + 0.5)
      .setTint(this.demolishInRange ? DEMOLISH_TINT : AIM_TINT_FAR)
      // On laisse transparaître la pièce : on doit reconnaître CE QU'ON casse, pas seulement
      // sa silhouette. Et un toit au-dessus de soi (EFFACÉ, alpha 0) redevient visible par
      // le halo — le halo est un sprite à part, l'alpha du toit ne le touche pas.
      .setAlpha(0.8)
      .setVisible(true)
  }

  /**
   * LE CONTOUR DE L'INTERACTION (demande d'Alexis, 2026-08-03) — un liseré blanc d'un pixel
   * autour de ce que la touche `F` prendrait si on l'enfonçait maintenant.
   *
   * À CHAQUE FRAME, et pas à l'arrivée d'un snapshot : le curseur bouge entre deux ticks, le
   * nœud s'épuise, la caméra glisse encore après la course. Un contour posé au snapshot
   * traînerait derrière le survol.
   *
   * TROIS FAMILLES, TROIS FAÇONS DE RETROUVER LE SPRITE — parce que les trois ne se dessinent
   * pas pareil : le nœud vit dans un POOL réattribué chaque frame (relevé au passage par
   * `renderNodes`), la pile et la structure dans des tables par id, stables. Un sprite
   * introuvable (hors écran, snapshot pas encore arrivé) éteint le contour : on ne souligne
   * jamais un objet qu'on ne dessine pas.
   */
  renderContourInteraction(): void {
    const t = this.interactTarget
    if (t === null) return void this.eteindreContour()
    const sprite =
      t.kind === 'node'
        ? this.contourNodeSprite
        : t.kind === 'pile'
          ? (this.groundSprites.get(t.id) ?? null)
          : (this.structureSprites.get(t.id) ?? null)
    if (sprite === null || !sprite.visible) return void this.eteindreContour()
    this.peindreContour(sprite, t.inRange)
  }

  /**
   * LE LISERÉ — huit copies de la SILHOUETTE, décalées d'un pixel, peintes DERRIÈRE le sprite.
   *
   * C'est la seule construction qui donne un trait net ici. Une lueur de shader (glow) est
   * LISSÉE par nature — elle bave sur trois pixels et trahit le grain de l'art ; et cette
   * machine rend sous SwiftShader, sans GPU. Huit images plates ne coûtent rien et se voient
   * partout pareil.
   *
   * `TintModes.FILL` remplace la couleur du sprite au lieu de la multiplier : le contour est
   * BLANC quelle que soit la texture dessous — un albédo `_lit` normal-mappé, une empreinte
   * sombre, un buisson vidé. C'est la même raison qu'au halo de démolition (mesuré là-bas :
   * une teinte multiplicative rendait quasi noir un rouge écrit dans le code).
   *
   * DERRIÈRE (`depth - 0.5`), et c'est tout le principe : le sprite recouvre l'intérieur des
   * copies, seul dépasse le pixel de franges. Devant, on obtiendrait une silhouette pleine —
   * un objet blanc, pas un objet souligné.
   *
   * IL RECOPIE TOUT DU SPRITE, rotation comprise : une flèche plantée au sol est inclinée
   * (±32°, `syncGroundItems`), et un contour qui ne tournerait pas avec elle serait une croix.
   */
  private peindreContour(sprite: Phaser.GameObjects.Image, inRange: boolean): void {
    const teinte = inRange ? CONTOUR_TINT : AIM_TINT_FAR
    for (let i = 0; i < CONTOUR_DECALAGES.length; i++) {
      const [dx, dy] = CONTOUR_DECALAGES[i]!
      let c = this.contourPool[i]
      if (!c) {
        c = this.scene.add.image(0, 0, sprite.texture.key).setTintMode(Phaser.TintModes.FILL)
        this.contourPool[i] = c
      }
      c.setTexture(sprite.texture.key, sprite.frame.name)
        .setOrigin(sprite.originX, sprite.originY)
        .setPosition(sprite.x + dx * CONTOUR_PX, sprite.y + dy * CONTOUR_PX)
        .setScale(sprite.scaleX, sprite.scaleY)
        .setRotation(sprite.rotation)
        .setFlipX(sprite.flipX)
        .setDepth(sprite.depth - 0.5)
        .setTint(teinte)
        // OPAQUE, contrairement au halo de démolition : lui doit laisser reconnaître ce qu'on
        // casse, celui-ci ne recouvre rien — il n'a aucune raison d'être délavé.
        .setAlpha(1)
        .setVisible(true)
    }
  }

  private eteindreContour(): void {
    for (const c of this.contourPool) c.setVisible(false)
  }

  /**
   * L'OVERLAY DES FONCTIONS (spec construction R22) : une étiquette flottante
   * « Forge · N2 » au-dessus de chaque fonction reconnue ; dorée + ✦ si l'amas est
   * clos+toité (le bonus d'enceinte). Poolée (jamais recréée) — appelée chaque frame.
   */
  renderFunctions(): void {
    let used = 0
    for (const f of this.functions) {
      let t = this.functionLabels[used]
      if (!t) {
        t = this.scene.add
          .text(0, 0, '', { fontFamily: FUNCTION_FONT, fontSize: '13px', stroke: '#14141a', strokeThickness: 3 })
          .setOrigin(0.5, 1)
          .setDepth(FUNCTION_LABEL_DEPTH)
        this.functionLabels[used] = t
      }
      const a = tileFeetAnchor(f.tx, f.ty, TILE_PX)
      const lift = this.warp?.lift(f.tx + 0.5, f.ty) ?? 0
      t.setText(`${FUNCTION_LABEL[f.functionId]} · N${f.tier}${f.enclosed ? ' ✦' : ''}`)
        .setColor(f.enclosed ? '#e8c66a' : '#cfe0d0')
        .setPosition(a.px, a.py - lift - TILE_PX)
        .setVisible(true)
      used++
    }
    for (let i = used; i < this.functionLabels.length; i++) this.functionLabels[i]!.setVisible(false)
  }

  /** Reçoit la liste COMPLÈTE des nœuds (message `ready`, une fois) et l'indexe
   * par id (deltas O(1)) ET par tuile (rendu culled O(1)/tuile visible). La carte
   * en porte ~330k. Un nœud reçu DÉJÀ épuisé (save rechargée en pleine repousse)
   * n'aura pas de delta `stock→0` à venir : on amorce sa repousse ici pour l'animer
   * plutôt que le montrer plein à tort. */
  setNodes(nodes: ResourceNode[]): void {
    this.reindexer(nodes)
    this.depleted.clear()
    for (const n of nodes) {
      if (n.stock <= 0 && n.regrowAt > 0) this.depleted.set(n.id, { since: this.tick, until: n.regrowAt })
    }
  }

  /**
   * L'ÉTAT DU GEL (spec `gel.md` G6) — posé par `WorldScene` à chaque image, `null` tant que
   * rien n'a été reçu. C'est la façade de `etat-gel.ts` : on ne lui demande QUE
   * `feuillageDenude`, la fonction de `/sim`, jamais un jugement local.
   */
  setEtatGel(etat: SimState | null): void {
    this.etatGel = etat
  }

  /** Fige la canopée à l'opacité pleine — l'atelier photo, jamais le jeu (cf. `canopeePleine`). */
  setCanopeePleine(v: boolean): void {
    this.canopeePleine = v
  }

  /** La carte et la seed du monde — d'elles dépend l'essence de chaque arbre. */
  setPeuplement(map: WorldMap, seed: number): void {
    this.carte = map
    this.worldSeed = seed
  }

  /**
   * LA VERSION DE LA CANOPÉE — s'incrémente quand le JEU D'ARBRES change (peuplement
   * initial, abattage, repousse, dérive, front de cendre). Les taches de soleil en
   * dépendent : leur masque se bâtit sur les couronnes RÉELLES (spec §5 R6 amendée,
   * 2026-08-16) et doit se rebâtir quand elles bougent. WorldScene la LIT à la frame
   * (un entier) et ne rebâtit que sur changement, throttlé — jamais par frame.
   */
  versionCouvert = 0

  private reindexer(nodes: ResourceNode[]): void {
    this.nodes = nodes
    this.nodeById = new Map(nodes.map((n) => [n.id, n]))
    this.nodeByTile = new Map(nodes.map((n) => [n.tx * NODE_TILE_STRIDE + n.ty, n]))
    this.versionCouvert++
  }


  /**
   * Applique les changements de nœud reçus par tick (récolte, repousse, DÉRIVE).
   *
   * Le cas courant est un stock qui baisse. À `stock 0`, le delta porte la fenêtre de
   * repousse (`regrowAt`) et la position : si celle-ci a changé, le nœud a DÉRIVÉ (spec
   * recolte-vivante D1) — on le déménage (index tuile patché en O(1)), on laisse une SOUCHE
   * à l'ancien coin (transitoire client), et on note la repousse en cours pour l'animer.
   * Quand le stock revient (`> 0`), la repousse est finie : on purge l'état.
   */
  private applyNodeDeltas(deltas: NodeDelta[], now: number): void {
    for (const d of deltas) {
      // ═══ UN NŒUD NEUF NAÎT ICI (spec `cendre.md` — les fumerolles ; `brume.md` — le filon) ═══
      //
      // ⚠ LA LIGNE `if (!n) continue` CI-DESSOUS EST UN PIÈGE ANCIEN : la liste complète des
      // nœuds ne part qu'UNE fois (message `ready`), donc tout nœud né APRÈS l'amorce voyait son
      // delta jeté en silence. **Le filon de la Brume portait ce défaut depuis sa naissance** :
      // il se posait dans la sim, et personne ne pouvait ni le voir ni le miner. Depuis, l'hôte
      // marque ces deltas-là (`neuf`), et on crée le nœud au lieu de l'ignorer.
      if (d.neuf !== undefined && !this.nodeById.has(d.id) && d.tx !== undefined && d.ty !== undefined) {
        const ne: ResourceNode = { id: d.id, type: d.neuf, tx: d.tx, ty: d.ty, stock: d.stock, regrowAt: d.regrowAt ?? 0 }
        this.nodes.push(ne)
        this.nodeById.set(ne.id, ne)
        this.nodeByTile.set(ne.tx * NODE_TILE_STRIDE + ne.ty, ne)
        continue
      }
      const n = this.nodeById.get(d.id)
      if (!n) continue
      // La CANOPÉE bouge ? Un arbre qui tombe à 0 (abattage/dérive) ou qui repousse
      // plein change la couverture réelle — les taches de soleil doivent suivre.
      if ((n.type === 'tree' || n.type === 'old_tree') && (d.stock > 0) !== (n.stock > 0)) this.versionCouvert++
      if (d.stock > 0) {
        n.stock = d.stock
        this.depleted.delete(d.id)
        continue
      }
      // LE NŒUD MEURT (spec recolte.md G15). On le CONSIGNE ici — à son ANCIENNE tuile,
      // avant que la dérive ne la lui prenne — et c'est la boucle de nœuds qui jouera la
      // chute / l'éclatement, elle seule sachant traduire une tuile en pixels. `depleted`
      // fait le garde-fou du doublon : un nœud déjà noté épuisé ne remeurt pas si un delta
      // à stock 0 repasse. Borné : une file qui grossit sans fin serait une fuite, et
      // personne ne verrait la millième chute.
      if (!this.depleted.has(d.id) && this.epuisements.length < MAX_EPUISEMENTS) {
        this.epuisements.push({ id: d.id, tx: n.tx, ty: n.ty, type: n.type, at: now })
      }
      // Épuisement. Déménagement éventuel (bois/plante qui dérive).
      if (d.tx !== undefined && d.ty !== undefined && (d.tx !== n.tx || d.ty !== n.ty)) {
        this.stumps.push({ tx: n.tx, ty: n.ty, type: n.type, at: now })
        this.nodeByTile.delete(n.tx * NODE_TILE_STRIDE + n.ty)
        n.tx = d.tx
        n.ty = d.ty
        this.nodeByTile.set(n.tx * NODE_TILE_STRIDE + n.ty, n)
      }
      n.stock = 0
      // `regrowAt > 0`, comme `setNodes` : à 0 la sim dit « aucune repousse en cours » — le
      // nœud défriché en porte la marque, et l'inscrire ici le ferait « grandir » sur une
      // fenêtre vide (`until - since` négatif).
      if (d.regrowAt !== undefined && d.regrowAt > 0) this.depleted.set(d.id, { since: this.tick, until: d.regrowAt })
      // DÉFRICHÉ : le nœud ne sera plus dessiné (`renderNodes` l'écarte), mais un tronc qui
      // s'évapore ne raconte rien. On pose la SOUCHE — le même transitoire que la dérive, à
      // sa propre tuile puisqu'il n'a pas bougé : la trace de ce qu'on vient de dégager.
      else if (noeudDefriche(this.villages, n)) this.stumps.push({ tx: n.tx, ty: n.ty, type: n.type, at: now })
    }
  }

  /** Dessine les nœuds visibles (pool réutilisé). N'itère que la FENÊTRE de
   * tuiles caméra (≤1 nœud/tuile via l'index) — coût borné à la vue, jamais
   * O(nombre total de nœuds). Appelé chaque frame ; un nœud épuisé s'estompe.
   *
   * Un arbre est DEUX sprites : le tronc (opaque, trié avec les acteurs) et le
   * houppier (bande propre, alpha du disque de découvert). `playerX/playerY` sont
   * la position LOGIQUE de l'avatar en tuiles : le disque suit l'avatar, pas la
   * caméra, sinon il glisserait avec le lookahead du pointeur. */
  renderNodes(camera: Phaser.Cameras.Scene2D.Camera, playerX: number, playerY: number, now: number): void {
    const v = camera.worldView
    // La fenêtre s'élargit vers le BAS pour les cimes qui débordent (un houppier planté sous
    // l'écran survole encore la vue). Colonnes ±2 pour le débord de houppier.
    //
    // ELLE SE DÉRIVE DE L'ARBRE LE PLUS HAUT (2026-07-29), elle ne se devine plus. Elle valait 4
    // tuiles quand le gros bois en fait SIX : un gros bois planté cinq tuiles sous l'écran voyait
    // sa cime apparaître d'un coup en avançant — un défaut ANTÉRIEUR aux variantes, que celles-ci
    // n'ont fait qu'élargir (le conifère en fait cinq). Le maximum de la table est la seule valeur
    // qui ne puisse pas dériver le jour où un arbre grandit.
    const crownMargin = MARGE_CIMES
    const tx0 = Math.floor(v.x / TILE_PX) - 2
    const ty0 = Math.floor(v.y / TILE_PX) - 1
    const tx1 = Math.ceil((v.x + v.width) / TILE_PX) + 2
    const ty1 = Math.ceil((v.y + v.height) / TILE_PX) + crownMargin
    const feetY = playerY + BALANCE.AVATAR_HITBOX_DEPTH_TILES / 2
    let used = 0
    let crownsUsed = 0
    this.transitionsFlore.image()
    // LE NŒUD SURVOLÉ N'A PAS ENCORE DE SPRITE À CETTE FRAME : le pool se réattribue ici. On
    // repart donc de rien — sinon un nœud sorti de l'écran laisserait son contour posé sur le
    // sprite qui a hérité de son slot, c'est-à-dire sur un autre nœud.
    this.contourNodeSprite = null
    const idSurvole = this.interactTarget?.kind === 'node' ? this.interactTarget.id : -1
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const n = this.nodeByTile.get(tx * NODE_TILE_STRIDE + ty)
        if (n === undefined) continue
        // DÉFRICHÉ : la sim ne le fera jamais repousser (`defriche.ts`), donc on ne le
        // dessine plus — le sol est dégagé, et c'est ce que le joueur vient de faire. Le
        // client APPLIQUE la règle, on ne la lui transmet pas, et c'est ce qui garantit qu'il
        // ne reste pas un arbre fantôme contre lequel la prédiction locale irait se cogner.
        if (noeudDefriche(this.villages, n)) continue
        // TOMBÉ AVEC LA CENDRE (spec `cendre.md` R13) : même leçon, même patron que le défrichage
        // ci-dessus — le protocole ne transmet jamais la disparition d'un nœud, seulement des
        // stocks. Sans cette ligne, la futaie morte restait DEBOUT sur la cendre (constaté au
        // navigateur), et la prédiction locale se serait cognée à des fantômes.
        if (this.carte && noeudTombeParLaCendre(this.carte, this.cendreAge, this.worldSeed, n,
          NODE_DEFS[n.type]?.vivant === true)) continue
        // LE GROS BOIS EST UN ARBRE : deux sprites (tronc + houppier), un décalage dans sa tuile,
        // et le houppier s'efface autour du joueur. Sans cette ligne, il naissait sans houppier —
        // un fût nu au milieu d'une futaie, ce qui est exactement ce qu'il n'est pas.
        const isTree = n.type === 'tree' || n.type === 'old_tree'
        // REPOUSSE (spec recolte-vivante D2) : un nœud épuisé GRANDIT sur sa fenêtre
        // `[since, until]` — la fraction pilote son échelle, au lieu du fantôme à 25 %.
        // Un arbre qui repousse est une POUSSE (petit, sans houppier) ; les autres se
        // reforment à l'échelle (le minéral se recristallise, le buisson repart).
        const dep = this.depleted.get(n.id)
        const growing = dep !== undefined
        // LE BUISSON À BAIES est VIVACE : il ne DÉRIVE ni ne rétrécit à la repousse (contrairement
        // aux autres plantes). Il reste dessiné à taille pleine (échelle 1), et c'est le NOMBRE DE
        // BAIES qui suit le stock — `min(BERRY_TEX_MAX, stock)` points, 0 quand il est vidé.
        const isBerry = n.type === 'berry_bush'
        // LA FLORE GÉLIVE (voir `DORMANT_TINT`) : gelée d'après la couche du gel (une lecture de
        // signature, la même que le fouillis — jamais `floreGelee` par nœud et par image).
        const gelif = NODE_DEFS[n.type].gelif === true
        // `null` : tuile pas encore relevée par la couche du gel — on dessine tel quel, sans bascule.
        const geleOuInconnu = (gelif || n.type === 'fiber_plant') && this.floreGeleeAt !== null ? this.floreGeleeAt(n.tx, n.ty) : false
        const gele = geleOuInconnu === true
        let echX = 1
        let echY = 1
        if (gelif && !isBerry && geleOuInconnu !== null) {
          const pose = this.transitionsFlore.pose(n.id, gele, now, retardDe(n.tx, n.ty))
          if (pose.eclat) {
            const a0 = tileFeetAnchor(tx, ty, TILE_PX)
            this.recolteFx?.givre(a0.px, a0.py - (this.warp?.lift(tx + 0.5, ty + 1) ?? 0), TILE_PX * 0.6, now, n.id * 7919, !gele)
          }
          if (!pose.visible) continue
          echX = pose.sx
          echY = pose.sy
        }
        const g = isBerry || dep === undefined
          ? 1
          : Math.min(1, Math.max(GROWTH_MIN, (this.tick - dep.since) / Math.max(1, dep.until - dep.since)))
        // ESSAI éclairage : l'arbre ORDINAIRE adulte passe sur son albédo UNIFORME `_lit`
        // (même forme/couleur, ombrage peint retiré) + `setLighting` → relief 100 % calculé.
        const litTree = this.lighting && (n.type === 'tree' || n.type === 'old_tree') && !growing
        // QUEL ARBRE POUSSE ICI. Une fonction PURE de (sol, zone, tuile) : rien n'est mémorisé,
        // rien ne transite, le même arbre est toujours le même. Sans carte, on retombe sur
        // l'arbre ordinaire — le repli est un sprite qui existe, pas un carré vert de texture
        // manquante (la faute des cinq structurants, qu'on ne refait pas).
        const variante = isTree && this.carte !== null
          ? varianteArbre(this.carte, n.tx, n.ty, this.worldSeed, n.type === 'old_tree')
          : VARIANTES[n.type === 'old_tree' ? 'old_tree' : 'tree']!
        const texture = isBerry
          ? `nd-berry_bush-${gele ? 0 : berryDots(n)}${this.lighting ? '_lit' : ''}`
          : growing && isTree
            ? (this.lighting ? 'nd-sapling_lit' : 'nd-sapling')
            : isTree
              ? `nd-${variante.slug}_trunk${litTree ? '_lit' : ''}`
              // LE BLOC D'AFFLEUREMENT a trois TAILLES — la même fonction pure que le stock
              // côté sim (`tailleDeBloc`) : l'art et la résistance coïncident au bit près,
              // rien ne transite. Pleine tuile, sans offset — c'est la demande, littéralement.
              : n.type === 'bloc'
                ? `nd-bloc-${tailleDeBloc(n.tx, n.ty)}${this.lighting ? '_lit' : ''}`
                : this.lighting && LIT_NODE_TYPES.has(n.type)
                    ? `nd-${n.type}_lit` // masse pâteuse (roche…) : albédo aplati + normal map quand éclairé
                    : `nd-${n.type}`
        let sprite = this.nodePool[used]
        if (!sprite) {
          sprite = this.scene.add.image(0, 0, texture).setOrigin(0.5, 1)
          this.nodePool[used] = sprite
        }
        // Un arbre est décalé dans sa tuile (spec décalage d'origine) — MÊME
        // fonction pure que la collision, donc sprite et hitbox coïncident au bit
        // près. Les autres nœuds restent centrés sur leur tuile.
        const j = isTree ? treeJitter(tx, ty) : { dx: 0, dy: 0 }
        const a = tileFeetAnchor(tx, ty, TILE_PX)
        // Le coup qui porte fait TRESSAILLIR le nœud (spec recolte.md G10). Le
        // décalage est purement visuel et transitoire : il s'ajoute au dessin, il
        // ne touche ni la tuile, ni la profondeur, ni l'emprise logique.
        const coup = this.hitFx?.coup(n.id)
        const shake = coup === undefined ? 0 : shakeOffset(now, coup.at)
        const px = a.px + j.dx * TILE_PX + shake
        const py = a.py + j.dy * TILE_PX
        const lift = this.warp?.lift(tx + 0.5 + j.dx, ty + 1 + j.dy) ?? 0
        sprite.setPosition(px, py - lift)
        // Le sprite est POOLÉ : sa depth suit la tuile qu'il occupe cette frame,
        // jamais celle où il a été créé. Le pied réel intègre le décalage Y, pour
        // que deux arbres proches se trient par leur vrai pied, pas par le pool.
        sprite.setDepth(nodeDepth(ty + j.dy, TILE_PX))
        sprite.setTexture(texture)
        sprite.setLighting(this.lighting) // couche 1 : TOUS les nœuds sont éclairés (arbres, blocs, buissons…)
        // LA SURBRILLANCE DIT CE QUI VA SE PASSER (spec recolte.md G4) : le nœud
        // visé s'éclaire s'il est à portée, et se GRISE s'il ne l'est pas. On
        // teinte le sprite plutôt que de dessiner un cadre au sol : la teinte suit
        // le billboard, donc elle reste juste quel que soit le relief. Les sprites
        // sont POOLÉS — d'où le `clearTint` systématique sur les autres.
        // LE BUISSON DORMANT (voir `DORMANT_TINT`). La visée PRIME : elle est transitoire et
        // répond au geste en cours, alors que le gel est un état du monde qu'on retrouvera au
        // relâchement. Le MODE se remet À CHAQUE BRANCHE, jamais une seule fois : les sprites
        // sont POOLÉS, et `clearTint()` ne touche pas au mode (le piège d'un slot qui a peint en
        // aplat et repeindrait la suivante de la même façon).
        if (n.id === this.aimedNodeId) {
          sprite.setTint(this.aimedInRange ? AIM_TINT : AIM_TINT_FAR).setTintMode(Phaser.TintModes.MULTIPLY)
        }
        else if (gele) sprite.setTint(isBerry ? DORMANT_TINT : SEC_TINT).setTintMode(Phaser.TintModes.MULTIPLY)
        else sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY)
        // LE SPRITE DU NŒUD QUE `F` PRENDRAIT — relevé ici, où l'on sait à quel nœud ce slot de
        // pool appartient CETTE frame. La teinte ci-dessus et le contour sont deux affordances
        // distinctes : la teinte dit « c'est ce que je vise » (tout nœud, arbre compris), le
        // contour dit « `F` agit dessus » (la cueillette seule). Elles se superposent sans se
        // gêner — un buisson visé à portée est à la fois doré et cerné de blanc.
        if (n.id === idSurvole) this.contourNodeSprite = sprite
        // Plus de fantôme à 25 % (spec recolte-vivante D2) : un nœud est TOUJOURS opaque.
        // Épuisé, il n'est pas « à moitié là » — il REPOUSSE, et c'est son échelle qui le dit.
        sprite.setAlpha(1)
        sprite.setScale(g * echX, g * echY) // plein = 1 ; repousse = fraction ; gel = le geste (origine basse)
        // LA MATIÈRE QUITTE LE NŒUD (spec recolte.md G10, 3e signe). Ici et pas ailleurs :
        // `px/py-lift` est le pied RÉEL du sprite, `displayHeight` sa hauteur APRÈS
        // `setScale` (une pousse qui repousse gicle donc à sa taille), et `texture` est
        // exactement ce que le joueur regarde — c'est d'elle que la gerbe tire sa couleur.
        // `eclater` se garde lui-même du double appel : la boucle repasse chaque frame, et
        // la sim peut émettre DEUX `resource_harvested` au même tick sur le même nœud (le
        // butin de maîtrise) — un coup, une gerbe.
        if (coup !== undefined) {
          this.recolteFx?.eclater(
            n.id, coup.at, now, n.type, texture,
            px, py - lift, sprite.displayHeight,
            coup.fromX, coup.fromY, coup.count, coup.clean,
          )
          // ET LE HOUPPIER LÂCHE DES FEUILLES (demande d'Alexis, 2026-07-29). La hache mord
          // le fût à hauteur de ceinture ; le choc, lui, remonte l'arbre — et ce qui se
          // détache là-haut n'est pas du bois. Deux gerbes pour un coup, à DEUX hauteurs :
          // c'est ce décalage qui donne son échelle à l'arbre (une seule gerbe au pied en
          // ferait un poteau qu'on gratte). Pas sur une POUSSE : elle n'a pas de houppier.
          if (isTree && !growing) {
            // DANS LE BAS DE LA CIME, ET SUR SON POURTOUR — deux corrections, deux raisons.
            // (1) À l'ancrage nu, les feuilles naissaient 8 px au-dessus des copeaux : à
            // cette distance les deux gerbes n'en faisaient qu'une. (2) Au CŒUR du
            // houppier, elles sont vertes sur du vert et il leur faudrait presque toute
            // leur vie pour sortir de la silhouette — invisibles. Le bas du feuillage,
            // sur sa couronne, résout les deux : l'écart aux copeaux se voit, et elles se
            // détachent de la masse dès la première image.
            const m = variante.mesures
            this.recolteFx?.feuillage(
              n.id, coup.at, now,
              cleHouppier(variante.slug, litTree, cimeDe(n.tx, n.ty)),
              // La HAUTEUR d'où les feuilles tombent suit la hauteur du houppier ; leur
              // dispersion suit sa LARGEUR, qui n'est plus la même depuis `houppierW` (le saule
              // et le parasol du vieux pin sont plus larges que hauts). Les feuilles d'un saule
              // tombaient dans un rayon de cime carrée, donc trop serré pour la sienne.
              px, py - lift, ancrageHouppierPx(m) + m.houppierS * 0.3, houppierLargeur(m) * 0.4,
            )
          }
        }
        // LE VENT PLIE LES NŒUDS-PLANTES (fibre, baies, pousse — cf. NODE_WIND_TAKE). POOLÉ : reposé
        // CHAQUE frame, car une prise 0 (roche, tronc adulte) fait rendre 0 à windSway → le sprite est
        // remis DROIT, jamais la rotation d'un voisin héritée. Pivot aux pieds (origine 0.5,1) → il
        // plie depuis sa base, comme le houppier et les touffes du décor.
        const windTake = growing && isTree ? SAPLING_WIND_TAKE : (NODE_WIND_TAKE[n.type] ?? 0)
        sprite.setRotation(windSway(tx + j.dx, ty + j.dy, now, windTake, this.wind))
        sprite.setVisible(true)
        // LE REFLET DE L'ARBRE (eau-vivante R13) : un fût de la rive nord se redit dans
        // l'eau au sud de son pied — la couche découpe elle-même à la course d'eau.
        if (this.reflets && isTree && !growing) {
          this.reflets.miroir(texture, false, px, py - lift, sprite.displayWidth, sprite.displayHeight, now)
        }
        // L'OMBRE DE CONTACT du nœud, au MÊME index de pool que lui (servie/libérée ensemble).
        // La largeur se lit sur `displayWidth` APRÈS `setScale` : une pousse qui repousse porte
        // donc une flaque qui grandit avec elle, sans calcul en plus. Posée au pied réel (`px`,
        // `py` — décalage d'arbre et tressaillement compris), juste sous la depth du nœud.
        let nodeShadow = this.nodeShadowPool[used]
        if (!nodeShadow) {
          nodeShadow = createContactShadow(this.scene)
          this.nodeShadowPool[used] = nodeShadow
        }
        // RÈGLE (Alexis) : le grand diamètre de l'ellipse pile sur le PIXEL LE PLUS BAS du sprite.
        // Ce pixel est au-dessus du bas de tuile du gap de l'art (texels) × échelle du sprite (une
        // repousse à g<1 réduit le gap d'autant). Sans ça, l'arbre (art plein) et le bloc (art
        // creux) ne s'aligneraient pas — bug vu par Alexis (ombres d'arbres/fibre trop hautes).
        // LA NEIGE MONTE SUR LE PIED DU NŒUD (gel.md G9) : le bas du sprite se coupe de sa
        // hauteur (la découpe révèle le manteau), l'ombre remonte d'autant. Jamais sur un coin
        // de pêche (il est sur l'eau, qui n'en porte pas).
        const coupeNeige = coupeDeNeige(this.hauteurNeigeAt?.(tx + 0.5 + j.dx, ty + 1 + j.dy) ?? 0, sprite.displayHeight)
        if (coupeNeige > 0) {
          const frame = sprite.frame
          sprite.setCrop(0, 0, frame.width, Math.max(1, frame.height - coupeNeige / Math.max(1e-6, sprite.scaleY)))
        } else if (sprite.isCropped) sprite.setCrop()
        const gapWorld = nodeArtGap(texture) * sprite.scaleY + coupeNeige
        positionShadow(nodeShadow, px, py, sprite.displayWidth, sprite.depth, gapWorld)
        // UN COIN DE PÊCHE est SUR l'eau : rien n'y projette d'ombre de contact (peche.md) — la
        // flaque sombre d'un nœud posé sur une surface qui n'en porte pas se verrait comme une tache.
        if (estUnCoinDePeche(n.type)) nodeShadow.setVisible(false)
        used++
        // Une POUSSE n'a pas encore de houppier — il reviendra avec l'arbre adulte.
        if (!isTree || growing) continue

        // LE HOUPPIER. Ses mesures — hauteur du fût, côté du houppier, recouvrement — sont
        // déclarées dans `arbre-art` : c'est de là que sort son ancrage, plus d'un nombre écrit ici.
        const mesures = variante.mesures
        let crown = this.crownPool[crownsUsed]
        if (!crown) {
          crown = this.scene.add.image(0, 0, cleHouppier(variante.slug, false, 0)).setOrigin(0.5, 1)
          this.crownPool[crownsUsed] = crown
        }
        // LE POOL RÉUTILISE LES SPRITES : la texture doit être reposée à CHAQUE image, sinon un
        // houppier de gros bois se retrouve sur un arbre ordinaire (et l'inverse) selon l'ordre
        // dans lequel le pool a été servi. Le tronc le faisait déjà ; le houppier, non.
        // Albédo UNIFORME `_lit` quand éclairé (relief calculé par la normal map cubique).
        // LA CIME EST TIRÉE DE LA TUILE, comme la variante : cinq par type d'arbre depuis le
        // 2026-07-30, sinon une futaie pure remontre douze fois la même au pixel près. Sur la
        // tuile ENTIÈRE du nœud (`n.tx`), jamais sur les coordonnées tressaillées — celles-ci
        // sont fractionnaires, et deux consommateurs du même arbre en tireraient deux cimes.
        // LES FEUILLES TOMBENT (spec `gel.md` G6) — et c'est `/sim` qui le dit, sur le JOUR DE
        // SAISON et pas sur la température : une feuille qui tombe ne remonte pas. Sur la tuile
        // ENTIÈRE, comme la variante et la cime. `pine` et `larch` ne sont jamais caducs, donc
        // aucun conifère ne se dénude — mais la texture nue peut manquer (un slug nouveau, une
        // variante non cuite) : on retombe alors sur la cime feuillue plutôt que sur le carré
        // vert d'une texture absente.
        const cime = cimeDe(n.tx, n.ty)
        const feuillu = cleHouppier(variante.slug, this.lighting, cime)
        let cle = feuillu
        if (this.etatGel !== null && feuillageDenude(this.etatGel, n.tx, n.ty)) {
          const nue = cleHouppier(variante.slug, this.lighting, cime, true)
          if (this.scene.textures.exists(nue)) cle = nue
        }
        crown.setTexture(cle)
        crown.setLighting(this.lighting) // pooled : réarmé chaque frame (cf. le tronc)
        // L'ANCRAGE SE DÉRIVE, il ne s'écrit plus. C'était `py − 16` pour LES DEUX arbres alors
        // que leurs fûts n'ont pas la même hauteur : le houppier mordait 6 px sur l'un et 8 sur
        // l'autre, pendant que le commentaire d'ici affirmait 6 pour les deux (relevé au
        // navigateur, `smoke --scenario echelle`). Le recouvrement est désormais DÉCLARÉ.
        crown.setPosition(px, py - ancrageHouppierPx(mesures) - lift) // `px` porte déjà le tressaillement
        crown.setDepth(crownDepth(ty + 1 + j.dy, TILE_PX))
        // Un arbre visé s'éclaire ENTIER : teinter le tronc seul donnerait un
        // houppier flottant, détaché de ce qu'on vise.
        if (n.id === this.aimedNodeId) crown.setTint(this.aimedInRange ? AIM_TINT : AIM_TINT_FAR)
        else crown.clearTint()
        // Distance des pieds du joueur au PIED DU TRONC : l'arbre à ton contact
        // s'efface, celui dont la cime te survole de loin reste opaque.
        const dx = playerX - (tx + 0.5)
        const dy = feetY - (ty + 1)
        const d = Math.sqrt(dx * dx + dy * dy)
        crown.setAlpha(this.canopeePleine ? 1 : crownAlpha(d))
        // La canopée prend le vent, elle aussi. Sans ça, la forêt reste une photo
        // posée sur un sol qui remue — et c'est le contraste qui trahit le décor.
        // Origine (0.5, 1) : le houppier bascule autour du haut du tronc.
        crown.setRotation(windSway(tx + j.dx, ty + j.dy, now, CROWN_WIND_TAKE, this.wind))
        crown.setVisible(true)
        crownsUsed++
      }
    }
    for (let i = used; i < this.nodePool.length; i++) this.nodePool[i]!.setVisible(false)
    // Les ombres suivent EXACTEMENT le sort de leurs nœuds (même compteur) : aucune orpheline
    // ne reste allumée sur une tuile que le culling vient de quitter.
    for (let i = used; i < this.nodeShadowPool.length; i++) this.nodeShadowPool[i]!.setVisible(false)
    for (let i = crownsUsed; i < this.crownPool.length; i++) this.crownPool[i]!.setVisible(false)

    // ═══ LA MORT DES NŒUDS (spec recolte.md G15) ═══════════════════════════════════════
    //
    // LA FILE SE VIDE ENTIÈREMENT, CHAQUE IMAGE — et c'est la seule façon correcte de la
    // traiter. La tentation était de ne dépiler que les tuiles à l'écran : un nœud épuisé
    // hors caméra serait alors resté dans la file POUR TOUJOURS (`depleted` empêche de le
    // reconsigner), et la file n'aurait fait que grossir. On dépile donc tout, et ce qui
    // est mort hors du cadre est jeté SANS ANIMATION : personne ne l'a vu mourir.
    for (const e of this.epuisements) {
      if (e.tx < tx0 || e.tx > tx1 || e.ty < ty0 || e.ty > ty1) continue
      const arbre = e.type === 'tree' || e.type === 'old_tree'
      const j = arbre ? treeJitter(e.tx, e.ty) : { dx: 0, dy: 0 }
      const a = tileFeetAnchor(e.tx, e.ty, TILE_PX)
      const px = a.px + j.dx * TILE_PX
      const py = a.py + j.dy * TILE_PX - (this.warp?.lift(e.tx + 0.5 + j.dx, e.ty + 1 + j.dy) ?? 0)
      if (arbre) {
        // L'ARBRE TOMBE — À L'OPPOSÉ DU BÛCHERON, comme la gerbe (correction d'Alexis du
        // 29/07 : un arbre ne s'abat pas sur celui qui le coupe). La mémoire du dernier
        // coup porte sa position ; `applyNodeDeltas` tourne AVANT `processEvents`, mais
        // `renderNodes` tourne APRÈS les deux — d'où la lecture ici, où elle est sûre.
        // Sans coup en mémoire (l'arbre d'un AUTRE joueur, en multi), on prend un côté
        // stable tiré de la tuile : jamais juste, jamais faux, jamais scintillant.
        const coup = this.hitFx?.coup(e.id)
        const dir = coup
          ? { dx: px - coup.fromX, dy: py - coup.fromY }
          : { dx: ((e.tx * 31 + e.ty * 17) % 2 === 0 ? 1 : -1), dy: 0.35 }
        const variante = this.carte !== null
          ? varianteArbre(this.carte, e.tx, e.ty, this.worldSeed, e.type === 'old_tree')
          : VARIANTES[e.type === 'old_tree' ? 'old_tree' : 'tree']!
        this.chuteArbre?.tomber(px, py, variante, this.lighting, dir.dx, dir.dy, now, cimeDe(e.tx, e.ty))
      } else {
        // LA PIERRE S'EFFONDRE, LE VÉGÉTAL LÂCHE SES FEUILLES : une gerbe à 360°, de la
        // couleur du nœud — la même texture que celle qu'il affichait, donc la même
        // matière. `nd-berry_bush-0` : un buisson VIDÉ n'a plus de baies, ses feuilles
        // non plus.
        const texture = e.type === 'berry_bush'
          ? `nd-berry_bush-0${this.lighting ? '_lit' : ''}`
          : this.lighting && LIT_NODE_TYPES.has(e.type)
            ? `nd-${e.type}_lit`
            : `nd-${e.type}`
        this.recolteFx?.eclatement(e.type, texture, px, py, TILE_PX, now)
      }
    }
    this.epuisements.length = 0

    // LES SOUCHES (spec recolte-vivante D1) : ce qu'un nœud a laissé en DÉRIVANT. Elles
    // pâlissent puis disparaissent (la nature reprend le coin) — transitoire client pur.
    // On purge les périmées AVANT de dessiner : le pool ne garde que ce qui vit encore.
    if (this.stumps.length > 0) this.stumps = this.stumps.filter((s) => now - s.at < STUMP_FADE_MS)
    let stumpsUsed = 0
    for (const s of this.stumps) {
      if (s.tx < tx0 || s.tx > tx1 || s.ty < ty0 || s.ty > ty1) continue
      const isTreeStump = s.type === 'tree' || s.type === 'old_tree'
      let g = this.stumpPool[stumpsUsed]
      if (!g) {
        g = this.scene.add.image(0, 0, 'nd-stump').setOrigin(0.5, 1)
        this.stumpPool[stumpsUsed] = g
      }
      const a = tileFeetAnchor(s.tx, s.ty, TILE_PX)
      g.setTexture(
        isTreeStump
          ? (this.lighting ? 'nd-stump_lit' : 'nd-stump')
          : this.lighting ? 'nd-scar_lit' : 'nd-scar',
      )
      g.setLighting(this.lighting) // pooled : réarmé chaque frame, comme les nœuds
      g.setPosition(a.px, a.py)
      g.setDepth(nodeDepth(s.ty, TILE_PX))
      g.setScale(1)
      g.setAlpha(1 - (now - s.at) / STUMP_FADE_MS) // pâlit sur sa durée de vie
      g.setVisible(true)
      stumpsUsed++
    }
    for (let i = stumpsUsed; i < this.stumpPool.length; i++) this.stumpPool[i]!.setVisible(false)
  }

  private syncCorpses(corpses: Corpse[]): void {
    this.corpses = corpses
    const seen = new Set<number>()
    for (const c of corpses) {
      seen.add(c.id)
      // LA CARCASSE (spec `depecage.md` R1c) : une bête reste la bête, couchée, et son art suit
      // ce qui lui RESTE — pleine, entamée, dépouillée. Une dépouille humaine : les ossements.
      const cle = c.carcass ? cleCarcasse(c.carcass.species, etatCarcasse(c)) : 'spr-corpse'
      const existant = this.corpseSprites.get(c.id)
      if (existant === undefined) {
        // À plat : centrés sur la position de l'entité (pas d'ancrage pieds), mais dans
        // la bande de tri — un buisson au sud les recouvre.
        const lift = this.warp?.lift(c.x, c.y) ?? 0
        const sprite = this.scene.add
          .image(c.x * TILE_PX, c.y * TILE_PX - lift, cle)
          .setOrigin(0.5, 0.5)
          .setDepth(corpseDepth(c.y, TILE_PX))
        this.corpseSprites.set(c.id, sprite)
      } else if (existant.texture.key !== cle) {
        existant.setTexture(cle) // une coupe a porté : la carcasse change d'état
      }
    }
    for (const [id, sprite] of this.corpseSprites) {
      if (!seen.has(id)) {
        sprite.destroy()
        this.corpseSprites.delete(id)
      }
    }
  }

  /** LES RÉFUGIÉS (V2-25) : un marqueur PNJ par groupe, posé au centre du groupe (pieds).
   *  Modèle groupe-objet : ils ne bougent pas — on crée/détruit le sprite selon les groupes. */
  private syncRefugees(groups: RefugeeGroup[]): void {
    this.refugeeGroups = groups
    const seen = new Set<number>()
    for (const g of groups) {
      seen.add(g.id)
      if (!this.refugeeSprites.has(g.id)) {
        const lift = this.warp?.lift(g.tx + 0.5, g.ty + 0.5) ?? 0
        const sprite = this.scene.add
          .image((g.tx + 0.5) * TILE_PX, (g.ty + 1) * TILE_PX - lift, 'spr-npc')
          .setOrigin(0.5, 1)
          .setDepth(corpseDepth(g.ty + 1, TILE_PX) + 1)
          .setTint(0xcbb98a) // teinte terne : des survivants en haillons, pas des villageois
        this.refugeeSprites.set(g.id, sprite)
      }
    }
    for (const [id, sprite] of this.refugeeSprites) {
      if (!seen.has(id)) {
        sprite.destroy()
        this.refugeeSprites.delete(id)
      }
    }
  }
}
