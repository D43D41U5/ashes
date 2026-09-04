/**
 * LE FEU, VIVANT — des langues de flamme, des braises qui montent, et de la fumée.
 *
 * Trois couches de particules, une par structure `fire`, réconciliées au diff `seen`
 * comme les sprites de snapshot :
 *
 *   1. LES FLAMMES — de petites particules chaudes, ÉMISES SUR UNE PETITE LARGEUR
 *      (jamais toutes au même point, sinon ça s'empile en un disque blanc), qui
 *      montent POSÉMENT (pas de fusée), rétrécissent, s'éteignent.
 *   2. LES BRAISES — quelques étincelles vives et rares qui filent vers le haut.
 *   3. LA FUMÉE — grise, plus lente, elle monte plus haut et gonfle en se dissipant.
 *
 * Le grain est PIXEL (carré dur, NEAREST — comme le reste du jeu), et LE VENT pousse les
 * trois couches : accélération latérale ∝ au vent de la sim, la fumée (légère) prend le
 * plus, la flamme (chaude, elle monte dru) le moins. Calme plat = aucune dérive.
 *
 * PAS DE LUMIÈRE AU SOL ici (retirée le 2026-07-21, demande d'Alexis) : l'éclairage des
 * VOLUMES par les Feux vit dans `dynamic-lighting.ts` ; le sol n'est plus traité.
 *
 * AUCUNE logique de jeu : pur habillage.
 */
import Phaser from 'phaser'
import { fireStateAt, VENT, type Structure } from '@ashes/sim'
import { TILE_PX, structureDepth } from '../../render/framing'
import { fireGlow } from '../../render/lighting'
import { axesFeu, varianteFeu, type AxesFeu, type VarianteFeu } from '../../render/feu-variante'

/** Une braise en PIXEL — un CARRÉ PLEIN et UNIFORME (demande d'Alexis : plus rond du
 *  tout). Pas de dégradé, pas de cœur brillant qui arrondit à l'œil : un aplat blanc à
 *  bords francs, teinté par émetteur, filtre NEAREST → un « gros pixel » carré net.
 *
 *  On RÉGÉNÈRE toujours (remove + recreate) : la texture vit sur le TextureManager GLOBAL
 *  du jeu, donc un simple `exists` la garderait figée à sa version d'un HMR précédent —
 *  le piège qui laissait voir les vieilles particules rondes sans hard refresh. */
const EMBER_KEY = 'fx-ember'
function ensureEmberTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(EMBER_KEY)) scene.textures.remove(EMBER_KEY)
  const S = 8
  const tex = scene.textures.createCanvas(EMBER_KEY, S, S)
  if (!tex) return
  const ctx = tex.getContext()
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = 'rgba(255,255,255,1)'
  ctx.fillRect(0, 0, S, S) // carré PLEIN et uniforme : aucune rondeur possible
  tex.refresh()
  // NEAREST : le carré reste net au zoom (le LINEAR par défaut, posé après la passe de
  // BootScene, relisserait ses bords).
  scene.textures.get(EMBER_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

/**
 * ═══ LE HALO DE CHALEUR — la texture ═══
 *
 * Un disque radial PIXELLISÉ, posé EN L'AIR à la flamme (pas au sol : la flaque, elle, est
 * déjà là et fait la terre chaude). C'est le seul objet du banc qui occupe le VOLUME entre la
 * flamme et l'œil — la « lueur » qu'on voit autour d'un vrai feu n'est pas sur le sol, elle est
 * dans l'air chargé de suie qui diffuse la lumière.
 *
 * Grain de 4 px monde comme la flaque (`LIGHT_PX`), NEAREST : jamais un dégradé lissé, la DA
 * du jeu est pixel (cf. la mémoire « FX de lumière pixellisés »). Alpha faible et smoothstep au
 * carré : il doit se SENTIR, pas s'afficher — un halo qu'on remarque est un bug.
 */
const HALO_KEY = 'fx-fire-halo'
const HALO_PX = 4
const HALO_RADIUS_CELLS = 20 // 20 × 4 px = 80 px monde = 5 tuiles de rayon
function ensureHaloTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(HALO_KEY)) scene.textures.remove(HALO_KEY)
  const side = HALO_RADIUS_CELLS * 2 + 1
  const tex = scene.textures.createCanvas(HALO_KEY, side, side)
  if (!tex) return
  const ctx = tex.getContext()
  const img = ctx.createImageData(side, side)
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const dx = i - HALO_RADIUS_CELLS
      const dy = (j - HALO_RADIUS_CELLS) * 1.25 // légèrement APLATI : l'air chaud monte, la vue est du dessus
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / HALO_RADIUS_CELLS)
      const u = 1 - t
      const a = u * u * u // très creusé : presque tout au centre, une frange qui meurt vite
      const k = (j * side + i) * 4
      // Ambre pauvre en bleu, comme la flaque : en ADD c'est le bleu qui délave (en-tête de
      // `fire-ground-glow`). Le centre tire vers le jaune, la frange vers l'orange sombre.
      img.data[k] = 0xff
      img.data[k + 1] = Math.round(0xc4 - 0x74 * t)
      img.data[k + 2] = Math.round(0x50 - 0x46 * t)
      img.data[k + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  scene.textures.get(HALO_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

/** Combien chaque couche prend le vent (px/s² par unité de vent). La fumée est légère et
 *  dérive fort ; la flamme, chaude, monte presque droit ; les braises entre les deux. */
const FLAME_WIND = 14
const EMBER_WIND = 30
const SMOKE_WIND = 58

/**
 * ═══ LA FORCE COUCHE LA FUMÉE (2026-08-25) ═══
 *
 * La dérive suivait le CAP de la sim depuis toujours, mais pas sa FORCE : un feu fumait pareil
 * sous une brise et sous un front. Or la fumée est ce qu'on lit le mieux de loin — c'est une
 * colonne qui se couche, et un joueur voit le vent tourner à la fumée de son propre foyer avant
 * de le voir à l'aiguille du HUD.
 *
 * Elle prend plus que les herbes (`PRISE_FORCE` = 0,6 dans `render/wind.ts`) : une tige a une
 * racine, une bouffée n'a rien qui la retienne.
 */
const PRISE_FORCE = 1.2

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter
function applyWind(e: Emitter, wind: { x: number; y: number }, take: number, prise: number): void {
  e.accelerationX = wind.x * take * prise
  e.accelerationY = wind.y * take * prise
}

interface FireUnit {
  flame: Emitter
  ember: Emitter
  smoke: Emitter
  /** VARIANTE 5 seulement — le halo d'air chaud, sinon `null`. */
  halo: Phaser.GameObjects.Image | null
}

export class FireFx {
  private units = new Map<number, FireUnit>()

  /** La variante avec laquelle les émetteurs en vie ont été construits : leurs réglages sont
   *  posés à la CRÉATION (vitesse, durée de vie, teintes), donc changer de variante impose de
   *  les reconstruire — les retoucher un par un après coup laisserait des traînards. */
  private varianteEnCours: VarianteFeu | null = null

  /** LE RELIEF sous une tuile — posé par la scène : le décalage écran du sol (px) et sa strate. */
  private reliefSous: ((x: number, y: number) => { lift: number; strate: number }) | undefined

  /** La scène donne son accès au relief (`Warp.liftSol` / `strateSol`) — même patron que `reveil-fx`. */
  setReliefSous(f: (x: number, y: number) => { lift: number; strate: number }): void {
    this.reliefSous = f
  }

  constructor(private scene: Phaser.Scene) {
    ensureEmberTexture(scene)
    ensureHaloTexture(scene)
  }

  /** Réconcilie les particules avec les Feux du snapshot et LE VENT les pousse (vecteur
   *  unité de la sim, {0,0} = calme plat → aucune dérive). */
  update(
    /** LES FEUX de l'image — la sous-liste que `WorldScene` dérive UNE fois et sert aux trois
     *  couches de feu (PERF-08 : quatre balayages de `structures` par image cherchaient tous le
     *  même petit sous-ensemble). La garde `type !== 'fire'` ci-dessous RESTE : l'Atelier des
     *  plans, lui, passe encore tout le bâti, et une liste déjà filtrée la traverse sans frais. */
    structures: Structure[],
    tick: number,
    wind: { x: number; y: number } = { x: 0, y: 0 },
    /** La FORCE de la sim (`state.windForce`) : `VENT.AMBIANT` hors front, 1 au cœur d'une
     *  bande, 0 par calme plat. Par défaut l'ambiance — la dérive d'avant. */
    force: number = VENT.AMBIANT,
    /** `daylight(hour)` — le halo de la variante 5 ne vit que la nuit, comme la flaque. */
    day = 0,
    /** L'horloge de rendu (ms) — le halo bat sur le MÊME `fireGlow` que la flaque et le trou. */
    now = 0,
  ): void {
    // La part au-dessus de l'ambiance : 0 hors front (`AMBIANT` divisé par lui-même), donc un
    // monde sans météo fume exactement comme avant.
    const prise = 1 + PRISE_FORCE * Math.min(1, Math.max(0, (force - VENT.AMBIANT) / (1 - VENT.AMBIANT)))
    const v = varianteFeu()
    const ax = axesFeu(v)
    if (v !== this.varianteEnCours) {
      for (const u of this.units.values()) this.detruire(u)
      this.units.clear()
      this.varianteEnCours = v
    }
    const seen = new Set<number>()
    for (const s of structures) {
      if (s.type !== 'fire') continue
      seen.add(s.id)
      let unit = this.units.get(s.id)
      if (!unit) {
        // AU CENTRE de sa tuile, à la hauteur de son palier et dans SA strate (T-R7) — comme
        // le sprite des rondins. Un feu ne bouge pas : le relief se lit une fois, à la naissance.
        const relief = this.reliefSous?.(s.tx + 0.5, s.ty + 0.5) ?? { lift: 0, strate: 0 }
        const cx = s.tx * TILE_PX + TILE_PX / 2
        const cy = s.ty * TILE_PX + TILE_PX / 2 - relief.lift
        unit = this.spawn(cx, cy, relief.strate + structureDepth(s.ty, TILE_PX), ax)
        this.units.set(s.id, unit)
      }
      // Les particules suivent l'ÉTAT (spec feu-station S1/S3) : allumé → flammes + braises + fumée ;
      // braises → plus de flammes, seulement braises + fumée ; éteint → rien ne monte.
      const st = fireStateAt(tick, s)
      unit.flame.emitting = st === 'lit'
      unit.ember.emitting = st !== 'out'
      unit.smoke.emitting = st !== 'out'
      applyWind(unit.flame, wind, FLAME_WIND, prise)
      applyWind(unit.ember, wind, EMBER_WIND, prise)
      applyWind(unit.smoke, wind, SMOKE_WIND, prise)
      if (unit.halo) {
        // Le halo bat sur le MÊME `fireGlow` que la flaque, le trou du voile et le reflet sur
        // l'eau — même graine, même horloge : les quatre respirent en phase avec la flamme.
        const g = fireGlow(0, day, now, s.id * 1.7, ax.respiration)
        const facteur = st === 'lit' ? 1 : st === 'ember' ? 0.35 : 0
        // COMPOSITION ③ — le halo garde son gain : c'est la flaque qui rentre (voir
        // `fire-ground-glow`, COMPOSITION ①). Lui seul occupe le volume entre la flamme et
        // l'œil ; le rentrer aurait retiré la seule chose qu'aucun autre axe ne sait faire.
        unit.halo.setAlpha(Math.min(0.3, g.alpha * 0.26 * facteur))
      }
    }
    for (const [id, unit] of this.units) {
      if (seen.has(id)) continue
      this.detruire(unit)
      this.units.delete(id)
    }
  }

  private detruire(u: FireUnit): void {
    u.flame.destroy()
    u.ember.destroy()
    u.smoke.destroy()
    u.halo?.destroy()
  }

  /**
   * ═══ LES FLAMMES TRIENT EN Y COMME LE FOYER (rapporté par Alexis, corrigé le 2026-08-03) ═══
   *
   * Elles vivaient à `SPARK_DEPTH` (1 250 000) — au-dessus de la canopée, du voile, et de TOUS
   * les acteurs. Une flamme passait donc par-dessus l'avatar planté devant son feu : le foyer,
   * lui, triait bien, mais son feu lui passait au travers.
   *
   * `SPARK_DEPTH` avait sa raison — les lucioles devaient survivre au voile de nuit (elle a
   * disparu depuis : elles trient dans la bande Y, cf. `framing.fireflyDepth`) — mais elle ne
   * valait pas ici : la flamme appartient à une STRUCTURE, qui a une place dans le tri. Les trois
   * couches prennent donc la profondeur du foyer (`structureDepth`, pieds sur `ty + 1`), la
   * fumée juste dessous et les braises juste dessus, pour que leur ordre entre elles tienne.
   *
   * En mode éclairé le voile de nuit est SOUS les sprites (profondeur 8) : la flamme reste donc
   * au-dessus de lui, comme avant. Elle ne s'assombrit qu'en mode à plat, avec le reste — ce
   * qui est le sens même de ce mode.
   */
  private spawn(cx: number, cy: number, depth: number, ax: AxesFeu): FireUnit {
    // LES FLAMMES : de petites braises chaudes qui montent POSÉMENT (montée ralentie —
    // elles fusaient) en s'écartant un peu et se resserrent en pointe. Additif.
    const flame = this.scene.add
      .particles(cx, cy - 1, EMBER_KEY, {
        // La langue est PLUS COURTE ET PLUS DENSE : une flamme de camp est un paquet qui bat
        // vite, pas une colonne qui monte lentement. Durée de vie divisée par deux et cadence
        // doublée → autant de carrés à l'écran, mais qui se RENOUVELLENT.
        speedY: ax.escarbilles ? { min: -26, max: -13 } : { min: -18, max: -9 },
        speedX: ax.escarbilles ? { min: -6, max: 6 } : { min: -4, max: 4 },
        scale: ax.escarbilles ? { start: 1.45, end: 0.08 } : { start: 1.1, end: 0.12 },
        alpha: ax.escarbilles ? { start: 0.62, end: 0 } : { start: 0.5, end: 0 },
        lifespan: ax.escarbilles ? { min: 340, max: 700 } : { min: 620, max: 1100 },
        frequency: ax.escarbilles ? 40 : 72, // moins dense : on voit des CARRÉS distincts, pas un halo fusionné
        quantity: 1,
        // La flamme monte en TEMPÉRATURE : un blanc de braise au cœur, l'ambre au milieu, un
        // rouge profond au bout. L'étalon n'a que des oranges, donc pas d'écart de température
        // lisible dans la langue elle-même.
        tint: ax.coeurBlanc ? [0xfffbe8, 0xffcf72, 0xff6a14] : [0xffe27a, 0xffa842, 0xf05a1e],
        blendMode: 'ADD',
      })
      .setDepth(depth)

    // LES BRAISES : rares, vives, minuscules — elles filent vers le haut et meurent vite.
    /**
     * ═══ LES ESCARBILLES : elles RETOMBENT ═══
     *
     * L'étalon lance ses braises vers le haut à vitesse constante et les fait mourir en l'air :
     * elles montent en ligne droite, pour toujours, jusqu'à ce que l'alpha les efface. C'est le
     * mouvement d'une bulle, pas d'une escarbille — une braise est un CORPS, elle est lancée,
     * elle ralentit, elle bascule et elle retombe en s'éteignant. La parabole est ce qui donne
     * l'échelle et le poids : sans elle, un feu de camp et un incendie ont la même étincelle.
     *
     * D'où `gravityY` positif, une vitesse initiale plus franche (elles partent VITE), un
     * étalement latéral plus large et une durée de vie longue — assez pour que l'arc se voie
     * en entier. Et elles sont plus NOMBREUSES : trois fois la cadence, car une braise isolée
     * ne raconte rien, c'est la gerbe qu'on lit.
     */
    const ember = this.scene.add
      .particles(cx, cy - 2, EMBER_KEY, {
        speedY: ax.escarbilles ? { min: -66, max: -34 } : { min: -30, max: -18 },
        speedX: ax.escarbilles ? { min: -20, max: 20 } : { min: -8, max: 8 },
        scale: ax.escarbilles ? { start: 0.26, end: 0.07 } : { start: 0.18, end: 0 },
        alpha: ax.escarbilles ? { start: 1, end: 0 } : { start: 0.85, end: 0 },
        lifespan: ax.escarbilles ? { min: 1100, max: 2000 } : { min: 700, max: 1300 },
        frequency: ax.escarbilles ? 75 : 230,
        quantity: 1,
        tint: ax.escarbilles ? [0xfff4d2, 0xffc258, 0xff7a24] : [0xffe9a0, 0xffc258],
        blendMode: 'ADD',
      })
      .setDepth(depth + 0.2)
    // La pesanteur : elle vit hors du bloc de config parce que le vent écrase `accelerationY`
    // à chaque image (`applyWind`) — `gravityY` est le champ SÉPARÉ que le vent ne touche pas.
    if (ax.escarbilles) ember.gravityY = 42

    // LA FUMÉE : de petites volutes grises qui montent et se dissipent VITE (décision
    // utilisateur). Fondu normal, alpha faible, grain menu : elle n'OFFUSQUE rien.
    const smoke = this.scene.add
      .particles(cx, cy - 4, EMBER_KEY, {
        speedY: { min: -26, max: -15 },
        speedX: { min: -4, max: 4 },
        scale: { start: 0.5, end: 1.1 },
        alpha: { start: 0.14, end: 0 },
        lifespan: { min: 900, max: 1500 },
        frequency: 160,
        quantity: 1,
        tint: [0x5a554d, 0x6f6a61],
        blendMode: 'NORMAL',
      })
      .setDepth(depth - 0.2)

    // Le halo d'air chaud, posé EN L'AIR au-dessus des bûches, sous les braises (elles doivent
    // le traverser en clair) et au-dessus de la fumée.
    const halo =
      ax.halo
        ? this.scene.add
            .image(cx, cy - 6, HALO_KEY)
            .setOrigin(0.5, 0.5)
            .setDepth(depth - 0.1)
            .setBlendMode('ADD')
            .setDisplaySize((HALO_RADIUS_CELLS * 2 + 1) * HALO_PX, (HALO_RADIUS_CELLS * 2 + 1) * HALO_PX)
            .setAlpha(0)
        : null

    return { flame, ember, smoke, halo }
  }

  destroy(): void {
    for (const unit of this.units.values()) this.detruire(unit)
    this.units.clear()
  }
}
