/**
 * La vie ambiante — ce qui bouge sans que rien ne se passe (chantier ambiance).
 *
 * Deux habitants, et ils ne sont QUE du rendu : ils n'existent pas dans `/sim`,
 * ne portent aucun état de jeu, ne peuvent être ni touchés ni tués. C'est
 * délibéré : le jour où un oiseau devient une information (un vol qui s'envole
 * parce qu'une horde approche — GDD §9bis, « annoncés, pas surprises »), il
 * descendra dans la sim et sera émis comme un fait. Tant qu'il est décor, il
 * reste ici, et il ne coûte rien au réseau.
 *
 * - Les OISEAUX traversent le ciel par petits vols, au-dessus de la canopée.
 * - Les LUCIOLES ne sortent que la nuit, dérivent près du sol, et ÉCLAIRENT ce qui les
 *   entoure. ELLES RENTRENT UNE HEURE AVANT LE LEVER — l'obscurité seule ne les couchait pas
 *   (elle survit au soleil d'une heure et demie) : c'est l'HEURE qui les gouverne à l'aube,
 *   par `render/couvre-feu-lucioles.ts` (pur, donc prouvé). Elles vivent AU DÉCOUVERT — prés, landes, fonds humides (voir `FIREFLY_TERRAINS`).
 *   DEUX sources par essaim, parce que le moteur en exige deux : un point light pour ce qui a
 *   une carte de normales (`FIREFLY_LIGHT_*`), et une flaque additive au sol pour le terrain,
 *   qui n'est pas sur la pipeline Light2D (`firefly-ground-glow.ts`) — et depuis que l'essaim
 *   se pose dans un pré, c'est la FLAQUE qui porte la lecture : au découvert il n'y a presque
 *   rien à éclairer par normale, sinon l'avatar qui traverse.
 *   ET UN ESSAIM NE S'ALLUME PLUS D'UN COUP : il naît éteint, monte en `FONDU_ENTREE_S`,
 *   s'éteint en `FONDU_SORTIE_S`, et ses mouches s'éveillent l'une après l'autre — la courbe
 *   et le décalage vivent dans `render/fondu-essaim.ts` (pur, donc prouvé).
 *
 * Les deux sont culled à la vue : hors champ, ils sont recyclés, pas simulés.
 */
import Phaser from 'phaser'
import { souffleDEssaim } from '../../render/souffle-essaim'
import { FIREFLY_TERRAINS } from './firefly-biomes'
import { adoucir, fonduLuciole, FONDU_ENTREE_S, FONDU_SORTIE_S } from '../../render/fondu-essaim'
import { BIRD_SHADOW_DEPTH, fireflyDepth, FIREFLY_GROUND_DEPTH, FLYER_DEPTH, TILE_PX } from '../../render/framing'
import { cleOiseau, cleOmbreOiseau, GABARITS } from '../../render/oiseau-art'
import {
  altitudeDeMontee,
  densiteDeVol,
  especeDuVol,
  imageDAile,
  teinteDuVol,
  type EspeceOiseau,
} from '../../render/vol-des-oiseaux'
import {
  ensureFireflyGroundTexture,
  FIREFLY_POOL_ALPHA,
  FIREFLY_POOL_KEY,
  FIREFLY_POOL_SIZE_PX,
} from './firefly-ground-glow'

/** Vols simultanés au plus. La TAILLE d'un vol, elle, appartient à l'espèce (`GABARITS`). */
const MAX_FLOCKS = 2
/** Oiseaux vivants au plus, toutes espèces et tous vols confondus — le plafond de sécurité
 *  qui remplace l'ancien `MAX_FLOCKS × BIRDS_PER_FLOCK` (les vols n'ont plus tous la même
 *  taille, et une nuée de lisière peut naître par-dessus deux traversées). */
const MAX_BIRDS = 16
/** Secondes entre deux vols À DENSITÉ PLEINE (tiré dans cette fourchette) — l'intervalle réel
 *  est DIVISÉ par `densiteDeVol(heure)` : le plein jour (0,4) espace les passages deux fois et
 *  demie plus que le chœur de l'aube. Une densité nulle ne les espace pas, elle les REFUSE. */
const FLOCK_GAP_S: [number, number] = [9, 26]
/** Densité nulle : on ne replanifie pas au hasard, on revient voir dans quelques secondes. */
const CIEL_VIDE_RECHECK_S = 4

/* ── ④ LE VOL EST UN VOL, PAS CINQ SPRITES EN FILE ──────────────────────────────────────
 *
 * Avant : cinq oiseaux à vitesse identique, en ligne droite, décalés d'un `lag`. Rien ne les
 * reliait — c'était un peigne qui glisse. Un vol a maintenant une ANCRE VIRTUELLE (pas un
 * meneur : un meneur qui sort du champ emporterait la formation avec lui), un cap qui
 * s'INFLÉCHIT, et chaque oiseau tient SA PLACE avec du retard. Ce sont les écarts qui
 * respirent qui font un vol ; la ligne droite ne fait qu'un motif.
 */
/** L'inflexion du cap : amplitude (rad/s) et lenteur (rad/s de l'oscillateur). */
const CAP_INFLEXION = 0.5
const CAP_INFLEXION_HZ = 0.35
/** Le rapace ne traverse pas, il TIENT : un virage constant, un tour en ~11 s. */
const CAP_VIRAGE_RAPACE = 0.55
/** Avec quelle vigueur un oiseau rejoint sa place (1/s). Trop haut = une grille rigide. */
const PRISE_DE_PLACE = 1.8
/** L'écart de la formation : recul entre deux rangs, décalage latéral, en tuiles. */
const RANG_RECUL = 1.3
const RANG_COTE = 0.95
/** La nuée levée met ce temps à cesser de gicler pour redevenir un vol (s). */
const RASSEMBLEMENT_S = 1.4

/* ── ② L'ALTITUDE SE VOIT — l'ombre portée ──────────────────────────────────────────────
 *
 * De combien l'ombre se décroche de l'oiseau à pleine altitude (tuiles), et ce que l'altitude
 * retire au sprite et à l'ombre. Le décalage est vers le SUD : c'est la convention de ce jeu
 * vu de dessus (le soleil est derrière l'épaule), et c'est le seul sens où l'ombre ne se cache
 * pas sous l'oiseau.
 */
const OMBRE_ECART_X = 0.3
const OMBRE_ECART_Y = 1.5
/** Un oiseau haut est plus petit et son ombre plus large et plus pâle. */
const ALT_RETRAIT = 0.25
/**
 * ⚠ **CALIBRÉ EN PIXELS, ET LA PREMIÈRE CALIBRATION ÉTAIT FAUSSE** (`__voir-oiseaux`,
 * 2026-09-08). L'A/B — ombres masquées, même image — rendait 3,3 de luminance, ce qui donnait
 * l'ombre pour noyée dans le grain du sol (qui varie d'une vingtaine entre deux points
 * voisins) ; on l'avait donc montée à 0,85. **Le nombre était un artefact de cadrage** : le
 * canvas 720 est centré dans une fenêtre de 800, la capture est décalée de 40 px, et la sonde
 * mesurait deux morceaux d'herbe à côté de la tache. Corrigé, 0,85 pesait **34 de luminance sur
 * cinq tuiles d'herbe nue** — un trou noir, pas une ombre. 0,5 la ramène à ~20, du même ordre
 * que la variation propre du terrain : présente, jamais une flaque de goudron.
 */
const OMBRE_ALPHA = 0.5
/** Ce que l'altitude RETIRE à l'ombre. Faible : une ombre haute est plus large et plus douce
 *  (c'est `OMBRE_ETALEMENT` qui le dit), pas transparente — la faire disparaître en montant
 *  supprimerait l'indice précisément quand il compte le plus. */
const OMBRE_ALPHA_ALT = 0.3
const OMBRE_ETALEMENT = 0.5

/**
 * Les lucioles ne se répandent pas : elles s'AGRÈGENT. Un semis uniforme sur
 * tout l'écran donne une guirlande de fête foraine — ce qu'on veut, c'est deux
 * ou trois essaims, petits, à des endroits éloignés, et beaucoup de nuit entre
 * eux. Le noir est ce qui fait exister la lumière.
 */
const MAX_SWARMS = 3
const FLIES_PER_SWARM: [number, number] = [7, 12]
/** Rayon d'un essaim (tuiles) : une nuée lâche au-dessus de l'herbe, pas un point. */
const SWARM_RADIUS = 3.4
/** Un essaim se pose à cette distance du joueur, et jamais plus près. */
const SWARM_DIST: [number, number] = [10, 28]
/** Deux essaims ne se posent jamais à moins de ça l'un de l'autre (tuiles). */
const SWARM_SEPARATION = 16
/** Au-delà : l'essaim est oublié et se reforme ailleurs. */
const SWARM_FORGET_DIST = 46
/** En-deçà de cette obscurité (1 - daylight), aucune luciole ne sort. Il commande le
 *  CRÉPUSCULE ; l'aube, elle, se règle à l'heure (`couvre-feu-lucioles.ts`). */
const FIREFLY_NIGHT_THRESHOLD = 0.45
const FIREFLY_DRIFT = 0.35 // tuiles/s — une luciole ne file pas, elle flotte

/* ── LA LUEUR D'UN ESSAIM (demande d'Alexis, 2026-08-26) ─────────────────────
 *
 * Jusqu'ici une luciole était un sprite additif : elle BRILLAIT sans rien éclairer. Elle porte
 * maintenant une vraie source dans le `LightsManager` — donc le décor volumique autour d'elle
 * (buisson, herbe haute, rocher, et l'avatar qui passe) prend sa teinte, et l'essaim se pose
 * DANS le monde au lieu d'être peint dessus. Le sol, lui, n'est pas sur la pipeline Light2D et
 * ne bougera pas (mesuré de longue date sur les Feux) : ce qui se voit, c'est ce qui a une
 * carte de normales. ⚠ Depuis que l'essaim vit au découvert (2026-08-26), cette source a MOINS
 * à mordre qu'en sous-bois — il n'y a plus de fûts autour d'elle. Elle n'est pas devenue
 * inutile pour autant (l'avatar qui traverse la nuée s'éclaire en vert, et c'est le moment que
 * l'effet vise), mais la lecture principale est passée à la flaque au sol.
 *
 * UNE lumière par ESSAIM, pas par luciole. Ce n'est pas de l'avarice de rendu, c'est le budget :
 * le manager plafonne à `maxLights = 40` (`main.ts`) et les Feux en réservent déjà 24
 * (`dynamic-lighting.FEU_MAX`) plus le soleil et la lune. Trois essaims = trois lumières, et le
 * compte total reste à 29.
 *
 * ELLE NE SUIT PAS LA LUCIOLE LA PLUS VIVE : le maximum saute d'une mouche à l'autre, donc la
 * source se téléporterait de plusieurs tuiles à chaque bascule (un stroboscope). Elle est plantée
 * sur l'ANCRE de l'essaim — celle-là même vers qui toutes les lucioles sont rappelées.
 *
 * ET SON INTENSITÉ N'EST PAS LA MOYENNE DES CLIGNOTEMENTS : moyenner sept à douze sinus de même
 * fréquence rend une constante, c'est-à-dire une lanterne posée dans un buisson. C'est un
 * SOUFFLE propre à l'essaim, lent, avec sa phase : la nuée respire.
 */
/** Rayon de la lueur d'un essaim (tuiles) : la nuée déborde largement autour d'elle. */
const FIREFLY_LIGHT_RADIUS = SWARM_RADIUS * 2.4
/** Montée deux fois (« un peu plus de lumière », puis « 2× + de lumière », Alexis 2026-08-26) :
 *  0,42 → 0,9 → 1,8. L'essaim éclaire désormais ses alentours comme un Feu de camp éclaire les
 *  siens (`dynamic-lighting` : 0,6 + 1,2×nuit, soit ~1,8 à minuit) — mais en vert, et sans le
 *  cœur incandescent, puisque la flaque au sol est diffuse. */
const FIREFLY_LIGHT_INTENSITY = 1.8

/** Vert-jaune de luciole — la MÊME teinte pour le sprite additif, pour la source, et pour la
 *  flaque au sol, sans quoi la lueur portée ne serait pas celle qu'on voit clignoter. */
const FIREFLY_TINT = 0xc8e87a
/** Le souffle de l'essaim vit dans `render/souffle-essaim.ts` — trois sinus incommensurables
 *  plutôt qu'un métronome (« organique en intensité », Alexis 2026-08-26). Pur, donc prouvé.
 *  Et le JEU DE BIOMES vit dans `firefly-biomes.ts`, pour la même raison : pur, donc gardé. */

/**
 * UN VOL — l'ancre virtuelle que les oiseaux suivent, et rien d'autre. Elle n'a pas de sprite :
 * c'est un point qui avance, s'infléchit, et sort du champ sans que personne ne meure avec lui.
 */
interface Flock {
  espece: EspeceOiseau
  x: number
  y: number
  /** Cap, en radians. */
  cap: number
  vitesse: number
  /** Virage imposé (rad/s) — nul pour qui traverse, constant pour le rapace qui tourne. */
  virage: number
  /** Déphasage de l'inflexion : deux vols ne serpentent pas ensemble. */
  phase: number
}

interface Bird {
  sprite: Phaser.GameObjects.Image
  /** L'ombre portée, au SOL : le seul indice d'altitude (voir `oiseau-art.dessinerOmbre`). */
  ombre: Phaser.GameObjects.Image
  vol: Flock
  espece: EspeceOiseau
  x: number
  y: number
  vx: number
  vy: number
  /** Sa place dans la formation, en repère du vol : recul derrière l'ancre, décalage latéral. */
  recul: number
  cote: number
  /** Déphasage du battement d'ailes : un vol n'est pas un métronome. */
  phase: number
  /** Instant de naissance (s de scène) — commande la montée d'altitude et le rassemblement. */
  neS: number
  /** Altitude de croisière de son espèce, dans [0, 1]. */
  altCible: number
  /** Vrai pour une nuée LEVÉE : elle part du sol (altitude 0) et monte. Un vol de traversée,
   *  lui, entre en scène à son altitude — il vient de loin. */
  monte: boolean
}

/** Une luciole tourne autour de l'ancre de SON essaim — elle ne vagabonde pas. */
interface Firefly {
  sprite: Phaser.GameObjects.Image
  /** Décalage par rapport à l'ancre de l'essaim (tuiles). */
  ox: number
  oy: number
  vx: number
  vy: number
  phase: number
  /** Son rang dans l'éclosion (0 → 1) : les mouches ne s'allument pas ensemble
   *  (voir `render/fondu-essaim.ts`). */
  retard: number
}

/** Un essaim : une ancre plantée dans le MONDE, ses quelques lueurs, et LA lumière qu'elles
 *  jettent ensemble sur le sous-bois. */
interface Swarm {
  x: number
  y: number
  flies: Firefly[]
  /** Déphasage du souffle : deux essaims ne respirent pas ensemble. */
  phase: number
  /** Avancement du fondu, 0 (rien) → 1 (plein). Il ne se pose JAMAIS d'un coup : un essaim
   *  naît à 0 et meurt à 0 (voir `render/fondu-essaim.ts`). Lu par le smoke. */
  fade: number
  /** Condamné : il redescend vers 0, et c'est en touchant 0 qu'il sera détruit. Il compte
   *  encore dans `swarms` (donc dans l'écart minimal entre essaims), mais plus dans le
   *  compte VIVANT que la nuit commande — et une nuit qui se referme peut le RANIMER. */
  dying: boolean
  /** `null` seulement si le `LightsManager` a refusé la source (budget saturé). */
  light: Phaser.GameObjects.Light | null
  /** La flaque verte au sol — le seul des deux qui touche le terrain. */
  flaque: Phaser.GameObjects.Image
  /** LE RELIEF SOUS L'ANCRE (spec `etages.md` E-R22, `terrasses.md` T-R7) : de combien de px le
   *  sol qu'il survole se dessine plus haut que sa rangée logique, et dans quelle STRATE ce sol
   *  se peint. Lus UNE FOIS à la naissance — l'ancre ne bouge jamais — et partagés par les trois
   *  objets de l'essaim (mouches, flaque, source) : un essaim est UNE chose, elle vit à UNE
   *  hauteur. Une mouche qui dérive au-delà du bord garde la hauteur de son essaim (elle plane
   *  au-dessus de la chute) plutôt que de sauter de deux tuiles en franchissant une ligne. */
  lift: number
  strate: number
}

export class AmbientLife {
  /** Lus par le smoke test (`--scenario faune`) : il OBSERVE le jeu, il ne le fabrique pas. */
  readonly birds: Bird[] = []
  readonly swarms: Swarm[] = []
  /** Les ancres virtuelles. Purgées quand leur dernier oiseau est recyclé — un vol sans
   *  oiseau est une fuite silencieuse, exactement comme une lumière d'essaim oubliée. */
  private readonly flocks: Flock[] = []
  private nextFlockAt = 3
  /** La dernière horloge vue par `update` — `envol()` est appelée par la scène SUR UN FAIT,
   *  hors de la boucle, et un oiseau qui naît doit connaître sa date pour monter. */
  private nowS = 0

  /** `sample` rend l'id du terrain VU d'une tuile (-1 hors carte) : les lucioles choisissent
   *  leur biome, elles ne se posent pas n'importe où. **VU, et non `map.terrain`** : la cendre
   *  est dérivée au rendu et la carte n'est jamais mutée (`carte-immuable.test.ts`), donc qui
   *  interroge la carte trouve `grass` sur un sol cendré. L'appelant passe
   *  `PaveLayer.terrainAffiche` — c'est ce qui donne son sens au « sans cendre » de
   *  `FIREFLY_TERRAINS`. */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sample: (tx: number, ty: number) => number,
  ) {
    ensureFireflyGroundTexture(scene)
  }

  /**
   * LE RELIEF sous un point du monde — posé par la scène (`Warp.liftSol` / `strateSol`), même
   * patron que `fire-fx` et `fire-ground-glow` : la couche reçoit le relief, elle ne lit pas la
   * carte. Sans lui (Atelier, carte plate), tout vaut 0 : le nombre d'avant, au bit près.
   *
   * ⚠ MESURÉ le 2026-09-05 (graine 2026, terrasse de (1425,653), 1 h du matin) avant ce
   * branchement : un essaim ancré au palier 1 (`liftSol` 32, `strateSol` 100 000) posait sa
   * flaque à la profondeur 9 et ses mouches à ~11 500, sous les pavés de son palier (99 999),
   * à la rangée LOGIQUE — deux tuiles sous le sol dessiné. Invisible, sauf sa source, qui
   * éclairait la paroi deux tuiles au sud. « Les lucioles sur un étage ne fonctionnent pas. »
   */
  private reliefSous: ((x: number, y: number) => { lift: number; strate: number }) | undefined

  setReliefSous(f: (x: number, y: number) => { lift: number; strate: number }): void {
    this.reliefSous = f
  }

  /**
   * @param darkness 1 - daylight : 0 en plein jour, ~1 au cœur de la nuit.
   * @param dtS      secondes écoulées depuis la frame précédente.
   * @param nuitLucioles la part de nuit que l'HEURE accorde aux essaims
   *   (`render/couvre-feu-lucioles.partDeNuitDesLucioles`) : 1 en pleine nuit, 0 dès une heure
   *   avant le lever et toute la matinée. L'obscurité seule ne suffit pas à les rentrer — voir
   *   l'en-tête du module : elle survit au soleil d'une heure et demie.
   * @param lit      l'éclairage dynamique est-il armé ? Le mode à plat (debug DEV) éteint TOUTES
   *   les sources du jeu (`DynamicLighting.update(false)` met les intensités à zéro) mais laisse
   *   le manager actif — sans ce drapeau, les lucioles resteraient seules à éclairer le monde.
   */
  update(
    camera: Phaser.Cameras.Scene2D.Camera,
    nowS: number,
    dtS: number,
    darkness: number,
    nuitLucioles: number,
    lit = true,
    hourOfCycle = 12,
  ): void {
    this.nowS = nowS
    this.updateBirds(camera, nowS, dtS, hourOfCycle)
    this.updateFireflies(camera, nowS, dtS, darkness, nuitLucioles, lit)
  }

  /* ── Les oiseaux ──────────────────────────────────────────────────────── */

  private updateBirds(
    camera: Phaser.Cameras.Scene2D.Camera,
    nowS: number,
    dtS: number,
    hourOfCycle: number,
  ): void {
    // ③ L'HEURE COMMANDE LE PASSAGE — et elle ne commande QUE lui. `envol()` (la nuée de
    // lisière) naît d'un fait de la sim et se moque de l'heure : la museler la nuit rendrait
    // le défaut qu'on corrige, retourné (on entendrait la nuée sans la voir).
    const densite = densiteDeVol(hourOfCycle)
    if (nowS >= this.nextFlockAt) {
      if (densite <= 0 || this.flocks.length >= MAX_FLOCKS || this.birds.length >= MAX_BIRDS) {
        this.nextFlockAt = nowS + CIEL_VIDE_RECHECK_S
      } else {
        this.launchFlock(camera, hourOfCycle)
        const [lo, hi] = FLOCK_GAP_S
        this.nextFlockAt = nowS + (lo + Math.random() * (hi - lo)) / densite
      }
    }

    // LES ANCRES D'ABORD : un oiseau vise la place que son vol occupe CETTE image.
    const vue = camera.worldView
    for (const f of this.flocks) {
      // LE VIRAGE DU RAPACE NE S'ARME QU'À L'ÉCRAN. Un planeur qui tourne dès son entrée
      // boucle hors champ et se fait recycler sans qu'on l'ait vu : il entre droit, et il ne
      // se met en cercles qu'une fois arrivé. L'inflexion molle, elle, vaut partout.
      const px = f.x * TILE_PX
      const py = f.y * TILE_PX
      const dedans = px >= vue.x && px <= vue.x + vue.width && py >= vue.y && py <= vue.y + vue.height
      f.cap += ((dedans ? f.virage : 0) + Math.sin(nowS * CAP_INFLEXION_HZ + f.phase) * CAP_INFLEXION) * dtS
      f.x += Math.cos(f.cap) * f.vitesse * dtS
      f.y += Math.sin(f.cap) * f.vitesse * dtS
    }

    const teinte = teinteDuVol(hourOfCycle)
    const marginPx = 8 * TILE_PX
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i]!
      const gab = GABARITS[b.espece]
      // ── SA PLACE : l'ancre du vol, plus son rang tourné dans le repère du cap.
      const cs = Math.cos(b.vol.cap)
      const sn = Math.sin(b.vol.cap)
      const cibleX = b.vol.x - cs * b.recul - sn * b.cote
      const cibleY = b.vol.y - sn * b.recul + cs * b.cote
      // LA PRISE monte de 0 à 1 : une nuée qui vient de gicler FINIT SA GERBE avant de
      // rejoindre sa place. Un vol de traversée naît rassemblé — il vient de loin.
      const age = nowS - b.neS
      const prise = b.monte ? Math.min(1, age / RASSEMBLEMENT_S) : 1
      const vxVoulu = (cibleX - b.x) * PRISE_DE_PLACE + cs * b.vol.vitesse
      const vyVoulu = (cibleY - b.y) * PRISE_DE_PLACE + sn * b.vol.vitesse
      const k = Math.min(1, PRISE_DE_PLACE * prise * dtS)
      b.vx += (vxVoulu - b.vx) * k
      b.vy += (vyVoulu - b.vy) * k
      b.x += b.vx * dtS
      b.y += b.vy * dtS

      // ② L'ALTITUDE, et tout ce qu'elle fait voir.
      const alt = b.altCible * (b.monte ? altitudeDeMontee(age) : 1)
      const bx = b.x * TILE_PX
      const by = b.y * TILE_PX
      b.sprite.setPosition(bx, by)
      // ① LE BATTEMENT EST UNE IMAGE D'AILE, plus une compression du sprite entier.
      b.sprite.setTexture(cleOiseau(b.espece, imageDAile(nowS, gab.cadence, b.phase)))
      // LE CAP : la source pointe vers +X, on la TOURNE. Plus aucun `setFlipX` — un oiseau
      // retourné vole de travers dès que le vol dérive en diagonale.
      b.sprite.setRotation(Math.atan2(b.vy, b.vx))
      // ④ L'ÉCHELLE RESTE ENTIÈRE : le seul redimensionnement est celui de l'altitude, et il
      // est assumé (un oiseau haut est plus petit). Aucun `setDisplaySize`.
      b.sprite.setScale(1 - ALT_RETRAIT * alt)
      b.sprite.setAlpha(gab.alpha)
      b.sprite.setTint(teinte)

      // L'OMBRE CONSULTE LE RELIEF À CHAQUE IMAGE — un oiseau BOUGE, contrairement à l'ancre
      // d'un essaim qui le lit une fois pour toutes. Sans ça, elle se peindrait à sa rangée
      // LOGIQUE et passerait sous les pavés du palier au-dessus duquel elle glisse : le défaut
      // mesuré des lucioles sur un étage (E-R22 / T-R7), transposé à un objet mobile.
      const ox = b.x + OMBRE_ECART_X * alt
      const oy = b.y + OMBRE_ECART_Y * alt
      const { lift, strate } = this.reliefSous?.(ox, oy) ?? { lift: 0, strate: 0 }
      b.ombre.setPosition(ox * TILE_PX, oy * TILE_PX - lift)
      b.ombre.setDepth(strate + BIRD_SHADOW_DEPTH)
      b.ombre.setRotation(b.sprite.rotation)
      b.ombre.setScale(1 + OMBRE_ETALEMENT * alt)
      b.ombre.setAlpha(OMBRE_ALPHA * (1 - OMBRE_ALPHA_ALT * alt))

      // Sorti du champ (avec marge) : recyclé. Un oiseau ne survit pas à sa traversée.
      if (bx < vue.x - marginPx || bx > vue.x + vue.width + marginPx || by < vue.y - marginPx || by > vue.y + vue.height + marginPx) {
        this.dropBird(b)
        this.birds.splice(i, 1)
      }
    }

    // UN VOL SANS OISEAU EST UNE FUITE — silencieuse, comme la lumière d'essaim oubliée que
    // `dropSwarm` existe pour empêcher. Les ancres orphelines partent ICI, et nulle part ailleurs.
    for (let i = this.flocks.length - 1; i >= 0; i--) {
      const f = this.flocks[i]!
      if (!this.birds.some((b) => b.vol === f)) this.flocks.splice(i, 1)
    }
  }

  /**
   * LE SEUL ENDROIT OÙ UNE PAIRE (oiseau, ombre) NAÎT. Le rang commande la place dans la
   * formation : le 0 tient l'ancre, les suivants s'échelonnent en V derrière elle, alternés
   * d'un côté puis de l'autre — un vol n'est pas une file.
   */
  private naitre(vol: Flock, rang: number, x: number, y: number, vx: number, vy: number, nowS: number, monte: boolean): void {
    const gab = GABARITS[vol.espece]
    const sprite = this.scene.add
      .image(x * TILE_PX, y * TILE_PX, cleOiseau(vol.espece, 0))
      .setDepth(FLYER_DEPTH)
      .setAlpha(gab.alpha)
    const ombre = this.scene.add
      .image(x * TILE_PX, y * TILE_PX, cleOmbreOiseau(vol.espece))
      .setDepth(BIRD_SHADOW_DEPTH)
      // ÉTEINTE À LA NAISSANCE, comme une luciole : `updateBirds` lui rend son alpha la même
      // image, mais un sprite Phaser naît à 1 — l'oublier, c'est une image d'ombre à pleine
      // force sous un oiseau encore posé.
      .setAlpha(0)
    this.birds.push({
      sprite,
      ombre,
      vol,
      espece: vol.espece,
      x,
      y,
      vx,
      vy,
      recul: rang * RANG_RECUL,
      cote: rang === 0 ? 0 : (rang % 2 === 1 ? 1 : -1) * Math.ceil(rang / 2) * RANG_COTE,
      phase: Math.random(),
      neS: nowS,
      altCible: gab.altitude,
      monte,
    })
  }

  /** L'oiseau ET son ombre — deux objets, une vie. Le second se fuite en silence. */
  private dropBird(b: Bird): void {
    b.sprite.destroy()
    b.ombre.destroy()
  }

  /**
   * L'ENVOL DE LA LISIÈRE (forêts-vivantes §3) — le SEUL cas où des oiseaux naissent à
   * l'écran, et c'est le point : ils giclent DES arbres, au fait de domaine `bird_flush`
   * que la sim vient d'émettre.
   *
   * ⚠ **AUCUNE CONDITION D'HEURE ICI**, et c'est délibéré : la sim émet le fait sur un pas
   * bruyant à trois heures du matin comme à midi, et `soundForEvent` fait partir le cri avec.
   * Ce que l'heure lui accorde, c'est sa TEINTE, jamais son existence.
   *
   * ILS PARTENT DU SOL (`monte`) : leur ombre est collée sous eux à la première image et se
   * décroche pendant qu'ils montent — c'est ÇA qui fait une nuée qui quitte un arbre, au lieu
   * de sept sprites qui apparaissent. Puis la gerbe se RASSEMBLE et le vol file (④).
   */
  envol(tx: number, ty: number): void {
    if (this.birds.length >= MAX_BIRDS) return
    const gab = GABARITS.passereau
    // Une nuée levée est faite de PASSEREAUX par définition : ce sont les petits oiseaux du
    // sous-bois qui giclent d'un bois, pas un corbeau ni un planeur.
    const vol: Flock = {
      espece: 'passereau',
      x: tx,
      y: ty,
      cap: Math.random() * Math.PI * 2, // elle fuit le perchoir, direction tirée
      vitesse: gab.vitesse,
      virage: 0,
      phase: Math.random() * Math.PI * 2,
    }
    this.flocks.push(vol)
    const n = gab.parVol + 2
    for (let i = 0; i < n && this.birds.length < MAX_BIRDS; i++) {
      // L'ÉVENTAIL PART VERS LE HAUT : ce que le joueur voit d'abord, c'est la gerbe qui monte
      // de l'arbre. Le cap du vol ne se lit qu'après, une fois la nuée rassemblée.
      const angle = -Math.PI / 2 + (i / (n - 1) - 0.5) * 1.6
      const vitesse = gab.vitesse * (1.6 + Math.random() * 0.8) // plus vif qu'un vol de croisière
      this.naitre(
        vol,
        i,
        tx + (Math.random() - 0.5) * 1.5,
        ty + (Math.random() - 0.5) * 1.5,
        Math.cos(angle) * vitesse,
        Math.sin(angle) * vitesse * 0.6,
        this.nowS,
        true,
      )
    }
  }

  /** Un vol entre par un bord et traverse. Son ESPÈCE vient du lieu et de l'heure (⑤). */
  private launchFlock(camera: Phaser.Cameras.Scene2D.Camera, hourOfCycle: number): void {
    const v = camera.worldView
    // ⑤ ON INTERROGE LE SOL SOUS LE CENTRE DU CHAMP, pas le point d'entrée hors champ : c'est
    // le biome que le joueur TRAVERSE qui doit se voir dans le ciel, pas celui d'à côté. Et
    // c'est le terrain VU (`PaveLayer.terrainAffiche`), donc la cendre compte — le corbeau de
    // la Cendrière n'est pas un accident.
    const terrain = this.sample(Math.floor(camera.midPoint.x / TILE_PX), Math.floor(camera.midPoint.y / TILE_PX))
    const espece = especeDuVol(terrain, hourOfCycle, Math.random())
    const gab = GABARITS[espece]

    const leftToRight = Math.random() < 0.5
    // Le point d'entrée est HORS champ : un oiseau ne se matérialise jamais à l'écran.
    const x0 = (leftToRight ? v.x - 6 * TILE_PX : v.x + v.width + 6 * TILE_PX) / TILE_PX
    const y0 = (v.y + Math.random() * v.height) / TILE_PX
    const cap = (leftToRight ? 0 : Math.PI) + (Math.random() - 0.5) * 0.5
    const vol: Flock = {
      espece,
      x: x0,
      y: y0,
      cap,
      vitesse: gab.vitesse,
      // Le rapace TIENT au lieu de traverser — mais son virage ne s'arme qu'à l'écran (voir
      // `updateBirds`), sans quoi il bouclerait hors champ sans qu'on l'ait jamais vu.
      virage: espece === 'rapace' ? CAP_VIRAGE_RAPACE * (Math.random() < 0.5 ? 1 : -1) : 0,
      phase: Math.random() * Math.PI * 2,
    }
    this.flocks.push(vol)
    for (let i = 0; i < gab.parVol && this.birds.length < MAX_BIRDS; i++) {
      this.naitre(vol, i, x0, y0, Math.cos(cap) * gab.vitesse, Math.sin(cap) * gab.vitesse, this.nowS, false)
    }
  }

  /* ── Les lucioles ─────────────────────────────────────────────────────── */

  private updateFireflies(
    camera: Phaser.Cameras.Scene2D.Camera,
    nowS: number,
    dtS: number,
    darkness: number,
    nuitLucioles: number,
    lit: boolean,
  ): void {
    // ── CE QUE LA NUIT ACCORDE AUX LUCIOLES — UN SEUL NOMBRE, ET IL COMMANDE TOUT ──
    //
    // Le NOMBRE d'essaims et leur LUEUR sortent de la même rampe : sinon le troisième essaim
    // s'allumerait à pleine puissance d'un coup.
    //
    // DEUX FACTEURS, et il en faut bien deux. L'obscurité donne la pente du crépuscule ; mais
    // elle ne rentre PAS les lucioles au matin — la courbe de jour ne repasse sous le seuil
    // qu'une heure et demie APRÈS le lever, et à T−1 h elle vaut encore 0,94 à 1,00 d'obscurité.
    // `nuitLucioles` est l'HEURE, et c'est elle qui les couche (`couvre-feu-lucioles.ts`).
    const nuit =
      Math.max(0, Math.min(1, (darkness - FIREFLY_NIGHT_THRESHOLD) / (1 - FIREFLY_NIGHT_THRESHOLD))) *
      nuitLucioles
    const wanted = Math.round(MAX_SWARMS * nuit)

    const cx = camera.midPoint.x / TILE_PX
    const cy = camera.midPoint.y / TILE_PX

    // Un essaim que le joueur a laissé loin derrière n'existe plus : on le
    // reforme ailleurs plutôt que de le traîner. CELUI-LÀ part d'un coup, et c'est voulu :
    // à 46 tuiles il est hors cadre de très loin (le champ en fait une quinzaine de large),
    // personne ne le voit s'éteindre — et le faire fondre ferait cohabiter jusqu'à six
    // sources de lucioles quand le joueur voyage, sur un budget qui en compte déjà 30
    // (24 Feux + 4 torches + soleil + lune, `dynamic-lighting`).
    for (let i = this.swarms.length - 1; i >= 0; i--) {
      const s = this.swarms[i]!
      if (Math.hypot(s.x - cx, s.y - cy) > SWARM_FORGET_DIST) {
        this.dropSwarm(s)
        this.swarms.splice(i, 1)
      }
    }

    // ── CE QUE LA NUIT COMMANDE, ELLE NE LE COMMANDE PLUS D'UN COUP ──
    //
    // Le compte VIVANT est celui des essaims non condamnés. Un essaim de trop n'est pas
    // détruit : il est CONDAMNÉ, s'éteint en `FONDU_SORTIE_S`, et meurt en touchant zéro.
    // Un essaim qui manque RANIME d'abord un condamné s'il en reste un — c'est ce qui tient
    // le compte de lumières borné à `MAX_SWARMS`, et ce qui évite qu'une obscurité qui
    // hésite autour d'un palier ne fasse clignoter tout un essaim.
    let vivants = 0
    for (const s of this.swarms) if (!s.dying) vivants++
    for (let i = this.swarms.length - 1; i >= 0 && vivants > wanted; i--) {
      const s = this.swarms[i]!
      if (s.dying) continue
      s.dying = true
      vivants--
    }
    while (vivants < wanted) {
      const repris = this.swarms.find((s) => s.dying)
      if (repris) {
        repris.dying = false
        vivants++
        continue
      }
      const anchor = this.findSwarmSpot(cx, cy)
      // Aucun point assez éloigné des autres — les condamnés comptant toujours dans l'écart :
      // on n'en force pas un, la frame suivante retentera.
      if (!anchor) break
      this.swarms.push(this.makeSwarm(anchor.x, anchor.y))
      vivants++
    }

    for (let i = this.swarms.length - 1; i >= 0; i--) {
      const s = this.swarms[i]!
      // Le fondu avance AU TEMPS, jamais à l'image : une frame headless dure des secondes, et
      // un compteur d'images y bloquerait l'essaim à mi-course (mémoire « timer en niveau »).
      const pas = dtS / (s.dying ? FONDU_SORTIE_S : FONDU_ENTREE_S)
      s.fade = s.dying ? Math.max(0, s.fade - pas) : Math.min(1, s.fade + pas)
      if (s.dying && s.fade <= 0) {
        this.dropSwarm(s)
        this.swarms.splice(i, 1)
        continue
      }
      const fondu = adoucir(s.fade)
      // Plantées sur l'ANCRE (stable), les deux sources RESPIRENT ENSEMBLE, sur le même souffle
      // (voir l'en-tête FIREFLY_LIGHT_*) — sinon le sol et les fûts battraient en désaccord.
      const souffle = souffleDEssaim(nowS, s.phase)
      if (s.light) {
        s.light.x = s.x * TILE_PX
        s.light.y = s.y * TILE_PX - s.lift
        // Le point light, lui, s'éteint AVEC les autres sources en mode à plat ; la flaque non,
        // elle est cosmétique et additive, comme celle du Feu qui survit au même toggle.
        s.light.intensity = lit ? FIREFLY_LIGHT_INTENSITY * nuit * souffle * fondu : 0
      }
      s.flaque.setAlpha(FIREFLY_POOL_ALPHA * nuit * souffle * fondu)
      for (const f of s.flies) {
        // Elle flotte autour de l'ancre, et y est doucement rappelée : sans ce
        // rappel, l'essaim se dilue en quelques secondes et redevient un semis.
        f.vx += (Math.sin(nowS * 1.3 + f.phase) - f.ox / SWARM_RADIUS) * dtS * 0.6
        f.vy += (Math.cos(nowS * 1.1 + f.phase * 1.3) - f.oy / SWARM_RADIUS) * dtS * 0.6
        f.vx = Math.max(-FIREFLY_DRIFT, Math.min(FIREFLY_DRIFT, f.vx))
        f.vy = Math.max(-FIREFLY_DRIFT, Math.min(FIREFLY_DRIFT, f.vy))
        f.ox += f.vx * dtS
        f.oy += f.vy * dtS

        // Elle s'allume et s'éteint — et reste éteinte plus longtemps qu'allumée
        // (puissance 3 : la lueur est un événement, pas un régime).
        const pulse = 0.5 + 0.5 * Math.sin(nowS * 2.2 + f.phase)
        const fy = s.y + f.oy
        // À LA HAUTEUR DE SON ESSAIM (`lift`) : sur une terrasse, la rangée logique est deux
        // tuiles par palier sous le sol qu'on voit.
        f.sprite.setPosition((s.x + f.ox) * TILE_PX, fy * TILE_PX - s.lift)
        // Le fondu multiplie l'alpha COMPLET, plancher compris : 0,05 est un terme, pas un
        // facteur, et douze halos additifs à 0,05 sur une nuit noire, ça s'allume.
        f.sprite.setAlpha((0.05 + 0.85 * pulse * pulse * pulse) * fonduLuciole(s.fade, f.retard))
        // ELLE TRIE À CHAQUE IMAGE, puisqu'elle dérive : une luciole qui remonte d'une rangée
        // doit repasser DERRIÈRE le fût qu'elle vient de croiser. La profondeur posée une fois
        // à la naissance l'aurait figée au premier rang de l'essaim. ET DANS LA STRATE de son
        // essaim (E-R22) : le tri en Y ne départage qu'à l'intérieur d'un étage.
        f.sprite.setDepth(s.strate + fireflyDepth(fy, TILE_PX))
      }
    }
  }

  /**
   * Un point à bonne distance du joueur, loin des essaims déjà posés, ET dans un
   * biome où des lucioles ont une raison d'être. Si aucun tirage ne convient, on
   * ne pose RIEN : au-dessus d'un glacier — ou d'une vallée que la cendre a prise —
   * la nuit reste noire, et c'est correct.
   */
  private findSwarmSpot(cx: number, cy: number): { x: number; y: number } | null {
    const [dMin, dMax] = SWARM_DIST
    for (let tries = 0; tries < 24; tries++) {
      const a = Math.random() * Math.PI * 2
      const d = dMin + Math.random() * (dMax - dMin)
      const x = cx + Math.cos(a) * d
      const y = cy + Math.sin(a) * d
      if (!FIREFLY_TERRAINS.has(this.sample(Math.floor(x), Math.floor(y)))) continue
      if (this.swarms.every((s) => Math.hypot(s.x - x, s.y - y) >= SWARM_SEPARATION)) return { x, y }
    }
    return null
  }

  private makeSwarm(x: number, y: number): Swarm {
    const { lift, strate } = this.reliefSous?.(x, y) ?? { lift: 0, strate: 0 }
    const [lo, hi] = FLIES_PER_SWARM
    const count = lo + Math.floor(Math.random() * (hi - lo + 1))
    const flies: Firefly[] = []
    for (let i = 0; i < count; i++) {
      const sprite = this.scene.add
        .image(0, 0, 'glow') // le halo radial du boot : une luciole est une lueur, pas un point dur
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(FIREFLY_TINT)
        // MINUSCULE. Une luciole est un point de lumière, pas une lanterne.
        .setDisplaySize(TILE_PX * 0.3, TILE_PX * 0.3)
        // ÉTEINTE À LA NAISSANCE. `updateFireflies` lui rend son alpha la même image, mais un
        // sprite Phaser naît à 1 : l'oublier ici, c'est une image de nuée en pleine lumière —
        // exactement le « d'un coup » qu'on retire.
        .setAlpha(0)
      flies.push({
        sprite,
        ox: (Math.random() - 0.5) * SWARM_RADIUS,
        oy: (Math.random() - 0.5) * SWARM_RADIUS,
        vx: 0,
        vy: 0,
        phase: Math.random() * Math.PI * 2,
        // Son rang dans l'éclosion. Tiré, et non dérivé de l'index : un essaim qui s'allume
        // dans l'ordre de sa boucle s'allumerait aussi dans un ORDRE SPATIAL (les mouches
        // naissent par tirages successifs), et l'œil y lirait un balayage.
        retard: Math.random(),
      })
    }
    // La source de l'essaim. Créée éteinte : `updateFireflies` lui donne son souffle dès
    // l'image suivante, et un essaim posé en plein crépuscule ne s'allume pas d'un coup.
    const light = this.scene.lights?.addLight(
      x * TILE_PX,
      y * TILE_PX - lift,
      FIREFLY_LIGHT_RADIUS * TILE_PX,
      FIREFLY_TINT,
      0,
      TILE_PX * 0.6, // la même hauteur qu'un Feu : une lueur qui RASE l'herbe
    ) ?? null
    // La flaque au sol. Centrée sur un multiple de 2 px (l'ancre est un flottant : on la CALE
    // sur la grille de l'art, sinon les carrés de 4 px tomberaient à cheval et grouilleraient).
    // Le lift est un multiple de 32 : il ne dérange pas la grille. Et JUSTE AU-DESSUS DES PAVÉS
    // DE SON PALIER (`strate + FIREFLY_GROUND_DEPTH`) : au palier 0 c'est « juste au-dessus du
    // voile », comme avant ; à un palier haut, le voile ne monte pas (les parts hautes prennent
    // leur nuit par teinte) mais les pavés, eux, y vivent à `PAVE_DEPTH + strate`.
    const flaque = this.scene.add
      .image(Math.round((x * TILE_PX) / 2) * 2, Math.round((y * TILE_PX) / 2) * 2 - lift, FIREFLY_POOL_KEY)
      .setOrigin(0.5, 0.5)
      .setDepth(strate + FIREFLY_GROUND_DEPTH)
      .setBlendMode('ADD')
      .setAlpha(0)
      .setDisplaySize(FIREFLY_POOL_SIZE_PX, FIREFLY_POOL_SIZE_PX)
    return { x, y, flies, phase: Math.random() * Math.PI * 2, fade: 0, dying: false, light, flaque, lift, strate }
  }

  /** LE SEUL endroit où un essaim disparaît — les TROIS sites passent par ici, et ils sont
   *  nommés : ① l'oubli au loin (`SWARM_FORGET_DIST`, instantané), ② la fin du fondu de sortie
   *  (`fade` retombé à zéro), ③ `destroy()`. Une lumière fuitée mange le budget du manager EN
   *  SILENCE, et le symptôme serait des Feux qui perdent la leur : on la chercherait des heures
   *  dans le mauvais fichier. */
  private dropSwarm(s: Swarm): void {
    for (const f of s.flies) f.sprite.destroy()
    s.flaque.destroy()
    if (s.light) this.scene.lights?.removeLight(s.light)
    s.light = null
  }

  destroy(): void {
    for (const b of this.birds) this.dropBird(b)
    for (const s of this.swarms) this.dropSwarm(s)
    this.birds.length = 0
    this.flocks.length = 0
    this.swarms.length = 0
  }
}
