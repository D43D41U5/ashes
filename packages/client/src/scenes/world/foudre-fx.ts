/**
 * LA FOUDRE — le télégraphe au sol, puis l'éclair (spec `meteo.md` R8, tranche de rendu).
 *
 * R8 promet un danger TÉLÉGRAPHIÉ : « sous l'orage on lit le sol et on se décale ». Ce n'est
 * pas de l'ambiance, c'est une INFORMATION DE GAMEPLAY — 35 points de dégâts dans 1,5 tuile,
 * annoncés 30 ticks (1,5 s) avant la frappe. Si la lueur n'est pas évidente, la règle est
 * injuste ; si elle ment sur son rayon, elle est pire qu'absente.
 *
 * ═══ RIEN NE TRANSITE — le client ÉLIT le même impact que la sim ═══
 *
 * Ni position d'éclair ni compte à rebours ne voyagent : `foudreTelegrapheAt` et
 * `foudreImpactAt` sont des fonctions PURES du front et du tick, les mêmes que `foudre.ts`
 * interroge pour encaisser les dégâts. Le cercle qu'on dessine est, au flottant près, celui
 * qui va frapper.
 *
 * ═══ CE QUI BOUGE EST L'ALPHA, JAMAIS LA GÉOMÉTRIE ═══
 *
 * Règle de maison sur les FX de lumière, et ici elle a une seconde raison : un cercle qui se
 * RESSERRE dirait un rayon qui rétrécit, or le rayon de dégâts est CONSTANT (`FOUDRE_RAYON`).
 * Le disque est donc figé à sa taille vraie et c'est son alpha qui monte — en PENTE CONTINUE
 * sur toute la fenêtre, aux bornes exactes (0 à `ticksLeft = FOUDRE_TELEGRAPHE_TICKS`, plein à
 * `ticksLeft = 1`), jamais un ease ni des paliers. Le disque et son anneau sont PIXELLISÉS au
 * grain de 4 px (NEAREST) — la DA des halos.
 *
 * ═══ L'ÉCLAIR EST UN CADRAGE ═══
 *
 * L'embrasement du ciel n'est PAS quantifié (un cadrage au grain baverait en bandes —
 * l'exception assumée de la règle) : il vit dans le shader du ciel (`meteo-layer`, uniforme
 * `uFlash`), piloté d'ici. Ce qui est ici, c'est ce qui a une FORME : le trait de foudre et
 * la brûlure au point d'impact. La décroissance suit l'horloge de la SCÈNE (le `time` de
 * frame), jamais un `window.setTimeout` — l'horloge headless galope, et un FX accroché à
 * l'horloge murale serait invisible au smoke comme au joueur qui change d'onglet.
 */
import Phaser from 'phaser'
import { METEO, foudreImpactAt, foudreTelegrapheAt, type MeteoFront } from '@ashes/sim'
import { TILE_PX } from '../../render/framing'

/** Le grain de l'art pour les FX de lumière (le même que la flaque du Feu). */
const LIGHT_PX = 4

/** Le disque du télégraphe couvre le rayon de DÉGÂTS et une marge de lecture. `FOUDRE_RAYON`
 *  vaut 1,5 tuile ; on dessine jusqu'à 2,5 pour que la lueur ait un dehors — mais l'ANNEAU,
 *  lui, tombe exactement sur 1,5 : c'est lui qui dit « ici on prend ». */
const HALO_TILES = 2.5
const HALO_CELLS = Math.round((HALO_TILES * TILE_PX) / LIGHT_PX)
const HALO_SIDE = HALO_CELLS * 2 + 1
const TELEGRAPHE_KEY = 'fx-foudre-telegraphe'

/** Le noyau blanc de la brûlure, au point d'impact. */
const IMPACT_TILES = 1.5
const IMPACT_CELLS = Math.round((IMPACT_TILES * TILE_PX) / LIGHT_PX)
const IMPACT_SIDE = IMPACT_CELLS * 2 + 1
const IMPACT_KEY = 'fx-foudre-impact'

/** Combien de temps l'éclair tient à l'écran, en ms d'horloge de scène. Court : un éclair
 *  qui s'attarde devient une lampe. La rémanence du ciel (`flash`) dure autant. */
const ECLAIR_MS = 340
/** Le trait de foudre, lui, ne dure qu'un souffle — c'est le ciel qui garde la lueur. */
const TRAIT_MS = 130

/**
 * LE DISQUE DU TÉLÉGRAPHE — un texel par cellule de 4 px, NEAREST : des carrés durs.
 * Deux registres dans la MÊME texture, et c'est voulu :
 *   • un halo doux qui décroît du centre au bord (on le repère du coin de l'œil) ;
 *   • un ANNEAU FRANC pile sur `FOUDRE_RAYON` (on lit où finit le danger).
 * Un anneau seul serait invisible sous la pluie ; un halo seul mentirait sur le rayon.
 */
function ensureTelegrapheTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TELEGRAPHE_KEY)) return
  const tex = scene.textures.createCanvas(TELEGRAPHE_KEY, HALO_SIDE, HALO_SIDE)
  if (!tex) return
  const ctx = tex.getContext()
  const img = ctx.createImageData(HALO_SIDE, HALO_SIDE)
  // Le rayon de dégâts, exprimé en cellules de la texture — l'anneau tombe DESSUS.
  const rDegats = (METEO.FOUDRE_RAYON * TILE_PX) / LIGHT_PX
  for (let j = 0; j < HALO_SIDE; j++) {
    for (let i = 0; i < HALO_SIDE; i++) {
      const dx = i - HALO_CELLS
      const dy = j - HALO_CELLS
      const r = Math.sqrt(dx * dx + dy * dy)
      const t = Math.min(1, r / HALO_CELLS)
      const s = 1 - t
      let a = s * s * (3 - 2 * s) * 0.55 // le halo, doux
      // L'ANNEAU : une couronne d'une cellule et demie autour du rayon de dégâts exact.
      const surAnneau = Math.abs(r - rDegats) <= 1.5
      if (surAnneau) a = Math.max(a, 0.95)
      // Blanc-bleu électrique : la couleur de ce qui va tomber, hors palette d'encre parce
      // que c'est le CIEL qui parle, pas l'UI (le monde emploie librement ses teintes).
      const k = (j * HALO_SIDE + i) * 4
      img.data[k] = surAnneau ? 236 : 150
      img.data[k + 1] = surAnneau ? 242 : 176
      img.data[k + 2] = 255
      img.data[k + 3] = Math.round(Math.min(1, a) * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  scene.textures.get(TELEGRAPHE_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

/** LA BRÛLURE — un noyau plein au point de frappe, même grille, même NEAREST. */
function ensureImpactTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(IMPACT_KEY)) return
  const tex = scene.textures.createCanvas(IMPACT_KEY, IMPACT_SIDE, IMPACT_SIDE)
  if (!tex) return
  const ctx = tex.getContext()
  const img = ctx.createImageData(IMPACT_SIDE, IMPACT_SIDE)
  for (let j = 0; j < IMPACT_SIDE; j++) {
    for (let i = 0; i < IMPACT_SIDE; i++) {
      const dx = i - IMPACT_CELLS
      const dy = j - IMPACT_CELLS
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / IMPACT_CELLS)
      const s = 1 - t
      const k = (j * IMPACT_SIDE + i) * 4
      img.data[k] = 255
      img.data[k + 1] = 253
      img.data[k + 2] = 245
      img.data[k + 3] = Math.round(s * s * (3 - 2 * s) * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  scene.textures.get(IMPACT_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

/** Le télégraphe est AU SOL — on le lit sous ses pieds, sous les acteurs qui s'en écartent.
 *  Même bande que la flaque du Feu (4) et les taches de soleil (5). */
const TELEGRAPHE_DEPTH = 4.5
/** L'éclair, lui, est devant tout — le ciel qui tombe (juste sous la couche météo). */
const ECLAIR_DEPTH = 1_119_000

export class FoudreFx {
  private halo: Phaser.GameObjects.Image
  private brulure: Phaser.GameObjects.Image
  private trait: Phaser.GameObjects.Graphics
  /** Dernier tick balayé — on ne saute aucun impact même si une frame en enjambe plusieurs. */
  private dernierTick = -1
  private eclairDebut = -1
  private eclairSeed = 0
  private eclairPoint = { x: 0, y: 0 }
  /** LU PAR LE SMOKE : combien d'éclairs ont été vus, et où en est le télégraphe. */
  readonly sonde = { eclairs: 0, telegraphes: 0, ticksLeft: 0, x: 0, y: 0, alpha: 0 }

  constructor(private scene: Phaser.Scene) {
    ensureTelegrapheTexture(scene)
    ensureImpactTexture(scene)
    this.halo = scene.add
      .image(0, 0, TELEGRAPHE_KEY)
      .setOrigin(0.5, 0.5)
      .setDepth(TELEGRAPHE_DEPTH)
      .setBlendMode('ADD')
      .setDisplaySize(HALO_SIDE * LIGHT_PX, HALO_SIDE * LIGHT_PX)
      .setVisible(false)
    this.brulure = scene.add
      .image(0, 0, IMPACT_KEY)
      .setOrigin(0.5, 0.5)
      .setDepth(ECLAIR_DEPTH)
      .setBlendMode('ADD')
      .setDisplaySize(IMPACT_SIDE * LIGHT_PX, IMPACT_SIDE * LIGHT_PX)
      .setVisible(false)
    this.trait = scene.add.graphics().setDepth(ECLAIR_DEPTH).setBlendMode('ADD').setVisible(false)
  }

  /**
   * Chaque frame. Rend l'EMBRASEMENT du ciel (0..1) que `meteo-layer` consomme.
   *
   * `now` est l'horloge de la SCÈNE (le `time` de `update`) : toute la décroissance s'y
   * accroche. `tick` est celui du dernier snapshot — on balaie tous les ticks depuis le
   * précédent appel, sans quoi une frame qui en enjambe deux perdrait un éclair.
   */
  update(now: number, front: MeteoFront | null, tick: number, mapW: number, mapH: number): number {
    if (!front || front.type !== 'orage') {
      this.halo.setVisible(false)
      this.sonde.ticksLeft = 0
      this.sonde.alpha = 0
      this.dernierTick = tick
      return this.rendreEclair(now)
    }

    // ── LES FRAPPES : on balaie chaque tick écoulé (borné — un saut de calendrier ne doit
    // pas faire tourner mille itérations). `foudreImpactAt` n'est vraie qu'à UN tick. ──
    const depart = this.dernierTick < 0 ? tick : Math.max(this.dernierTick + 1, tick - 600)
    for (let t = depart; t <= tick; t++) {
      const impact = foudreImpactAt(front, t, mapW, mapH)
      if (!impact) continue
      this.eclairDebut = now
      this.eclairSeed = t
      this.eclairPoint = { x: impact.x, y: impact.y }
      this.sonde.eclairs += 1
    }
    this.dernierTick = tick

    // ── LE TÉLÉGRAPHE : une PENTE CONTINUE sur toute la fenêtre, aux bornes exactes. ──
    const tel = foudreTelegrapheAt(front, tick, mapW, mapH)
    if (tel) {
      // `ticksLeft` ∈ [1, FOUDRE_TELEGRAPHE_TICKS] : 0 quand l'annonce commence, 1 au tick
      // qui précède la frappe. Linéaire — ni ease, ni palier (règle « feel = pente »).
      const u = 1 - (tel.ticksLeft - 1) / Math.max(1, METEO.FOUDRE_TELEGRAPHE_TICKS - 1)
      this.halo
        .setPosition(tel.x * TILE_PX, tel.y * TILE_PX)
        .setAlpha(u)
        .setVisible(true)
      this.sonde.telegraphes += 1
      this.sonde.ticksLeft = tel.ticksLeft
      this.sonde.x = tel.x
      this.sonde.y = tel.y
      this.sonde.alpha = u
    } else {
      this.halo.setVisible(false)
      this.sonde.ticksLeft = 0
      this.sonde.alpha = 0
    }

    return this.rendreEclair(now)
  }

  /** Le trait, la brûlure et la rémanence du ciel — tout sur l'horloge de la scène. */
  private rendreEclair(now: number): number {
    if (this.eclairDebut < 0) return 0
    const age = now - this.eclairDebut
    if (age > ECLAIR_MS) {
      this.eclairDebut = -1
      this.trait.setVisible(false)
      this.brulure.setVisible(false)
      return 0
    }
    // Décroissance : franche au départ, longue traîne — l'œil garde l'éclair.
    const k = 1 - age / ECLAIR_MS
    const flash = k * k

    this.brulure.setPosition(this.eclairPoint.x * TILE_PX, this.eclairPoint.y * TILE_PX).setAlpha(Math.min(1, flash * 1.4)).setVisible(true)

    if (age <= TRAIT_MS) {
      // LE TRAIT : une polyligne brisée qui descend du haut de l'écran au point d'impact.
      // Sa forme est tirée du TICK de la frappe (déterministe, pas de Math.random qui
      // ferait grouiller le trait d'une frame à l'autre), et elle est FIGÉE le temps du
      // trait — un éclair ne se tortille pas, il est là puis il n'est plus.
      const cam = this.scene.cameras.main
      const bas = { x: this.eclairPoint.x * TILE_PX, y: this.eclairPoint.y * TILE_PX }
      const haut = { x: bas.x - 3.2 * TILE_PX, y: cam.worldView.y - TILE_PX }
      this.trait.clear().setVisible(true)
      const points: { x: number; y: number }[] = []
      const N = 9
      for (let i = 0; i <= N; i++) {
        const u = i / N
        // Hash entier, sans Math.random ni sinus : le même trait tout le temps qu'il dure.
        const h = ((this.eclairSeed * 1103515245 + i * 12345) >>> 8) % 1000
        const ecart = i === 0 || i === N ? 0 : (h / 1000 - 0.5) * 2.6 * TILE_PX
        points.push({ x: haut.x + (bas.x - haut.x) * u + ecart, y: haut.y + (bas.y - haut.y) * u })
      }
      // LA LARGEUR EST FIXE, C'EST L'ALPHA QUI TOMBE — règle de maison sur les FX de
      // lumière, et elle vaut ici aussi : un trait qui MAIGRIT est un trait qui bouge, et
      // l'œil lit un mouvement là où il n'y a qu'une extinction.
      const fondu = 1 - age / TRAIT_MS
      // Deux passes : un halo large et pâle, puis le cœur blanc — un éclair a une gaine.
      for (const [w, couleur, alpha] of [
        [11, 0x6f86c8, 0.42],
        [4, 0xf2f6ff, 1],
      ] as const) {
        this.trait.lineStyle(w, couleur, alpha * fondu)
        this.trait.beginPath()
        this.trait.moveTo(points[0]!.x, points[0]!.y)
        for (let i = 1; i < points.length; i++) this.trait.lineTo(points[i]!.x, points[i]!.y)
        this.trait.strokePath()
      }
    } else {
      this.trait.setVisible(false)
    }
    return flash
  }

  destroy(): void {
    this.halo.destroy()
    this.brulure.destroy()
    this.trait.destroy()
  }
}
