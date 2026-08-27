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
import { fireflyDepth, FIREFLY_GROUND_DEPTH, FLYER_DEPTH, TILE_PX } from '../../render/framing'
import {
  ensureFireflyGroundTexture,
  FIREFLY_POOL_ALPHA,
  FIREFLY_POOL_KEY,
  FIREFLY_POOL_SIZE_PX,
} from './firefly-ground-glow'

/** Vols simultanés au plus, et oiseaux par vol. */
const MAX_FLOCKS = 2
const BIRDS_PER_FLOCK = 5
/** Un vol traverse en ~14 s, à cette vitesse (tuiles/s). */
const BIRD_SPEED = 7
/** Secondes entre deux vols (tiré dans cette fourchette). */
const FLOCK_GAP_S: [number, number] = [9, 26]

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

interface Bird {
  sprite: Phaser.GameObjects.Image
  x: number
  y: number
  vx: number
  vy: number
  /** Déphasage du battement d'ailes : un vol n'est pas un métronome. */
  phase: number
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
}

export class AmbientLife {
  /** Lus par le smoke test (`--scenario faune`) : il OBSERVE le jeu, il ne le fabrique pas. */
  readonly birds: Bird[] = []
  readonly swarms: Swarm[] = []
  private nextFlockAt = 3

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
  ): void {
    this.updateBirds(camera, nowS, dtS)
    this.updateFireflies(camera, nowS, dtS, darkness, nuitLucioles, lit)
  }

  /* ── Les oiseaux ──────────────────────────────────────────────────────── */

  private updateBirds(camera: Phaser.Cameras.Scene2D.Camera, nowS: number, dtS: number): void {
    if (nowS >= this.nextFlockAt && this.birds.length + BIRDS_PER_FLOCK <= MAX_FLOCKS * BIRDS_PER_FLOCK) {
      this.launchFlock(camera)
      const [lo, hi] = FLOCK_GAP_S
      this.nextFlockAt = nowS + lo + Math.random() * (hi - lo)
    }

    const v = camera.worldView
    const marginPx = 6 * TILE_PX
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i]!
      b.x += b.vx * dtS
      b.y += b.vy * dtS
      b.sprite.setPosition(b.x * TILE_PX, b.y * TILE_PX)
      // Le battement d'ailes, vu de dessus : l'envergure se pince et s'ouvre.
      const flap = 0.55 + 0.45 * Math.abs(Math.sin(nowS * 9 + b.phase))
      b.sprite.setScale(1, flap)

      // Sorti du champ (avec marge) : recyclé. Un oiseau ne survit pas à sa traversée.
      const px = b.x * TILE_PX
      const py = b.y * TILE_PX
      if (px < v.x - marginPx || px > v.x + v.width + marginPx || py < v.y - marginPx || py > v.y + v.height + marginPx) {
        b.sprite.destroy()
        this.birds.splice(i, 1)
      }
    }
  }

  /**
   * L'ENVOL DE LA LISIÈRE (forêts-vivantes §3) — le SEUL cas où des oiseaux naissent à
   * l'écran, et c'est le point : ils giclent DES arbres, au fait de domaine `bird_flush`
   * que la sim vient d'émettre (l'en-tête de ce fichier promettait exactement cette
   * évolution). La nuée éclate du perchoir vers le haut, en éventail, puis les oiseaux
   * rejoignent le régime commun (dérive, culling) — rien d'autre à gérer.
   */
  envol(tx: number, ty: number): void {
    for (let i = 0; i < BIRDS_PER_FLOCK + 2; i++) {
      const angle = -Math.PI / 2 + (i / (BIRDS_PER_FLOCK + 1) - 0.5) * 1.6 // l'éventail vers le haut
      const vitesse = BIRD_SPEED * (1.6 + Math.random() * 0.8) //             plus vif qu'un vol de croisière
      const sprite = this.scene.add
        .image(0, 0, 'fx-bird')
        .setDepth(FLYER_DEPTH)
        .setAlpha(0.9)
        .setFlipX(Math.cos(angle) < 0)
        .setDisplaySize(TILE_PX * 0.55, TILE_PX * 0.35)
      this.birds.push({
        sprite,
        x: tx + (Math.random() - 0.5) * 1.5,
        y: ty + (Math.random() - 0.5) * 1.5,
        vx: Math.cos(angle) * vitesse,
        vy: Math.sin(angle) * vitesse * 0.6,
        phase: Math.random() * Math.PI * 2,
      })
    }
  }

  /** Un vol entre par un bord et sort par l'autre, en diagonale molle. */
  private launchFlock(camera: Phaser.Cameras.Scene2D.Camera): void {
    const v = camera.worldView
    const leftToRight = Math.random() < 0.5
    // Le point d'entrée est HORS champ : un oiseau ne se matérialise jamais à l'écran.
    const x0 = (leftToRight ? v.x - 5 * TILE_PX : v.x + v.width + 5 * TILE_PX) / TILE_PX
    const y0 = (v.y + Math.random() * v.height) / TILE_PX
    const heading = (leftToRight ? 1 : -1) * BIRD_SPEED
    const drift = (Math.random() - 0.5) * BIRD_SPEED * 0.5

    for (let i = 0; i < BIRDS_PER_FLOCK; i++) {
      // Une formation lâche : les retardataires traînent derrière et de biais.
      const lag = i * 1.5 + Math.random()
      const sprite = this.scene.add
        .image(0, 0, 'fx-bird')
        .setDepth(FLYER_DEPTH)
        .setAlpha(0.75)
        .setFlipX(!leftToRight)
        .setDisplaySize(TILE_PX * 0.55, TILE_PX * 0.35)
      this.birds.push({
        sprite,
        x: x0 - (leftToRight ? lag : -lag),
        y: y0 + (Math.random() - 0.5) * 3,
        vx: heading,
        vy: drift,
        phase: Math.random() * Math.PI * 2,
      })
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
        s.light.y = s.y * TILE_PX
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
        f.sprite.setPosition((s.x + f.ox) * TILE_PX, fy * TILE_PX)
        // Le fondu multiplie l'alpha COMPLET, plancher compris : 0,05 est un terme, pas un
        // facteur, et douze halos additifs à 0,05 sur une nuit noire, ça s'allume.
        f.sprite.setAlpha((0.05 + 0.85 * pulse * pulse * pulse) * fonduLuciole(s.fade, f.retard))
        // ELLE TRIE À CHAQUE IMAGE, puisqu'elle dérive : une luciole qui remonte d'une rangée
        // doit repasser DERRIÈRE le fût qu'elle vient de croiser. La profondeur posée une fois
        // à la naissance l'aurait figée au premier rang de l'essaim.
        f.sprite.setDepth(fireflyDepth(fy, TILE_PX))
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
      y * TILE_PX,
      FIREFLY_LIGHT_RADIUS * TILE_PX,
      FIREFLY_TINT,
      0,
      TILE_PX * 0.6, // la même hauteur qu'un Feu : une lueur qui RASE l'herbe
    ) ?? null
    // La flaque au sol. Centrée sur un multiple de 2 px (l'ancre est un flottant : on la CALE
    // sur la grille de l'art, sinon les carrés de 4 px tomberaient à cheval et grouilleraient).
    const flaque = this.scene.add
      .image(Math.round((x * TILE_PX) / 2) * 2, Math.round((y * TILE_PX) / 2) * 2, FIREFLY_POOL_KEY)
      .setOrigin(0.5, 0.5)
      .setDepth(FIREFLY_GROUND_DEPTH)
      .setBlendMode('ADD')
      .setAlpha(0)
      .setDisplaySize(FIREFLY_POOL_SIZE_PX, FIREFLY_POOL_SIZE_PX)
    return { x, y, flies, phase: Math.random() * Math.PI * 2, fade: 0, dying: false, light, flaque }
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
    for (const b of this.birds) b.sprite.destroy()
    for (const s of this.swarms) this.dropSwarm(s)
    this.birds.length = 0
    this.swarms.length = 0
  }
}
