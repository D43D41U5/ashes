/**
 * ═══ LE VOILE DE LA CAVE — l'obscurité LOCALE, et les trois lumières qui la percent ═══
 *
 * *(spec `etages.md` §17, branche B1 : « ce que l'on voit, c'est ce que la LUMIÈRE atteint »)*
 *
 * La première livraison rendait E-R13 par une TEINTE PAR TUILE : chaque dalle prenait pour gris
 * sa propre clarté. Ça marchait pour un sol nu — et pour rien d'autre : ni la roche autour, ni les
 * parois, ni un corps, ni un signe au sol ne prenaient cette nuit-là, et une salle éclairée à la
 * torche rendait des CARRÉS de gris (vu à la capture : « cinq bandes de gris »). La lumière d'une
 * cave n'est pas une propriété des tuiles, c'est un CHAMP qui tombe sur tout ce qui est dedans.
 *
 * On reprend donc le patron du voile de nuit (`night-veil.ts`), qui a déjà résolu ce problème
 * pour le dehors : **une RenderTexture plein écran en MULTIPLY, au-dessus de TOUT ce qui vit à
 * l'étage −1** (sol, parois, roche, corps, nœuds, signes), dans laquelle chaque source de lumière
 * EFFACE un disque. Ce qui n'est pas effacé est presque noir ; ce qui l'est montre le monde tel
 * qu'il est peint. Trois sources, et pas une de plus :
 *
 *  • **LE JOUR**, par la gueule : `partDuCiel` dit qu'il pénètre de `CIEL_PENETRATION` tuiles en
 *    anneaux de Chebyshev, et sa force est celle de l'heure (`clarteDuCiel`). La brosse en tient
 *    la GÉOMÉTRIE (carré arrondi, chute linéaire, `1 − d/(P+1)` comme la loi) — la loi elle-même
 *    reste dans /sim, où l'autorité la lit ; ici on la MONTRE, on ne la recalcule pas.
 *  • **LA TORCHE**, autour de son porteur : un disque de `TORCHE_CAVE_TUILES`, qui BAT par son
 *    alpha et jamais par sa taille (la règle du voile de nuit — un rayon qui bat fait grouiller le
 *    grain). Et une braise ambrée en ADD sous le voile : la seule chaleur d'un lieu froid.
 *  • **SOI** : un souffle autour du corps, pour qu'on ne perde jamais son propre personnage dans
 *    le noir. Faible — il ne révèle RIEN autour, il rend juste le corps lisible.
 *
 * ⚠ **LE GRAIN EST CELUI DE L'ART : 4 px monde, NEAREST, jamais lissé.** Chaque brosse est un
 * canvas d'une cellule par texel de 4 px, affiché à `4 × zoom` pixels d'écran par cellule. Les
 * halos du Feu obéissent à la même règle depuis le 2026-08-26, et un halo doux au milieu d'un
 * monde de pixels se voit comme une photo collée sur un dessin.
 *
 * AUCUNE logique de jeu ici — la couche reçoit `LumiereDeCave` de `WorldScene`, qui tient la
 * façade d'état, et ne décide rien.
 */
import Phaser from 'phaser'
import { TEMPERATURE } from '@ashes/sim'
import { SOUTERRAIN_STRATE, TILE_PX } from '../../render/framing'

/** Le voile au-dessus de TOUTE la strate −1, sous la lisière de la strate suivante. */
export const CAVE_VEIL_DEPTH = SOUTERRAIN_STRATE - 1
/** La braise de la torche : juste sous le voile, au-dessus de tout corps de la salle. */
export const BRAISE_DEPTH = CAVE_VEIL_DEPTH - 1
/** La chaleur de la torche — le MULTIPLY qui ôte le bleu — passe juste avant la braise. */
const CHALEUR_DEPTH = BRAISE_DEPTH - 1

/** Ce que WorldScene sait de la lumière, en une structure — pas trois fermetures. */
export interface LumiereDeCave {
  /** La clarté du ciel à cette heure, dans [0, 1] (`clarteDuCiel`) : la force du jour à la gueule. */
  ciel: number
  /** La nuit du plateau (le multiplicateur du voile de nuit) : ce que la lumière du dehors traverse. */
  teinteDuJour: number
  /** La couleur de la lumière qui ENTRE (`couleurDuCiel(day)` ⊗ `teinteDuJour`) : ambre au couchant,
   *  blanc chaud à midi, bleu de lune la nuit — la nappe et le dehors vus par la gueule la prennent. */
  couleurDuJour: number
  /** La torche en main, en px MONDE, avec son battement ; `null` sans torche. */
  torche: { x: number; y: number; force: number } | null
  /** Le corps du joueur, en px monde. */
  joueur: { x: number; y: number } | null
}

/**
 * Le NOIR d'une cave : bleu-nuit, pas noir pur — multiplicateur (0,11 · 0,12 · 0,16) au plus
 * sombre. Un noir absolu ferait un TROU dans l'image (la leçon du socle, encore) ; celui-ci laisse
 * deviner la matière, ce qui est très exactement ce qu'on veut : *une forme, pas un contenu*.
 */
const NOIR = 0x0b0e18
const NOIR_ALPHA = 0.93
/** Un texel de lumière : 4 px monde, le grain de tous les halos du jeu. */
const GRAIN_PX = 4

/** Le jour entre de `CIEL_PENETRATION` tuiles ; la brosse va une tuile plus loin pour que sa chute
 *  linéaire atteigne 0 exactement là où la loi le dit (`1 − d/(P+1)`). */
export const JOUR_TUILES = TEMPERATURE.CIEL_PENETRATION + 1
/** La portée d'une torche SOUS TERRE. Plus courte que dehors (`TORCHE_HOLE_TILES` = 4) : il n'y a
 *  pas de ciel pour l'aider, et c'est ce qui fait de la torche un outil et de la cave un lieu. */
export const TORCHE_CAVE_TUILES = 3
/** Le souffle autour du corps. */
const SOI_TUILES = 1.25
const JOUR_PIC = 1
const TORCHE_PIC = 0.85
const SOI_PIC = 0.45
/** LA CHALEUR DU JOUR AU SOL — en ADD sous le voile, comme la braise de la torche : le trou du
 *  voile montre le sol tel qu'il est peint (froid), cette nappe lui rend la couleur de la lumière
 *  qui entre. C'est le contraste chaud/froid qui fait lire une cave : le dehors est chaud. */
const JOUR_SOL_ALPHA = 0.34
/** LA BRAISE EST DEUX IMAGES SUR UNE TEXTURE. Mesuré le 2026-09-02 : en ADD seul à 0,45, le sol
 *  d'une cave (bleu-gris, [50,52,62]) rendait un halo NEUTRE ([87,80,84] à une tuile de la main)
 *  — l'ambre additionné à un sol bleu fait du gris. Une lumière chaude, c'est d'abord du bleu en
 *  MOINS : un MULTIPLY ambré (`CHALEUR_ALPHA`) ôte le bleu du sol dans le rayon de la torche, et
 *  la braise en ADD (`BRAISE_ALPHA`) rend ensuite la clarté. Le même disque, deux fondus. */
const BRAISE_ALPHA = 0.65
const CHALEUR_ALPHA = 1
const JOUR_SOL_KEY = 'fx-cave-jour-sol'
/** LE LOIN. Sous un voile uniforme, le sol d'une salle (albédo [109,115,137]) reste 2,3 fois plus
 *  clair que la roche ([47,49,59]) : à dix tuiles de toute lumière on lisait encore le PLAN entier
 *  de la cave, en bleu sur noir (capture du 2026-09-02). Le voile se pose donc OPAQUE (tout tombe
 *  à la couleur du noir, salle comprise) et c'est le PRÈS qui l'ouvre à `NOIR_ALPHA` autour du
 *  joueur : plein jusqu'à `PRES_TUILES`, éteint à `LOIN_TUILES`. Près de soi on DEVINE (la
 *  curiosité), au loin on ne sait pas (l'inquiétude). Les lichens, en ADD au-dessus du voile,
 *  restent les seuls points du vide. (Un disque sombre DESSINÉ, essayé d'abord, laissait le voile
 *  plus clair hors de son rayon : un cercle sur l'écran.) */
const PRES_KEY = 'fx-cave-pres'
const PRES_TUILES = 6
const LOIN_TUILES = 11

type Metrique = 'rond' | 'carre'

/** La luminance relative d'une teinte plate (Rec. 601), dans [0, 1]. */
function luminance(rgb: number): number {
  const r = ((rgb >> 16) & 0xff) / 255
  const g = ((rgb >> 8) & 0xff) / 255
  const b = (rgb & 0xff) / 255
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** Fabrique une brosse d'effacement : un disque (ou un carré arrondi) à chute LINÉAIRE, blanc,
 *  une cellule par texel, NEAREST. La taille monde vient de `setDisplaySize` à chaque usage. */
function brosse(scene: Phaser.Scene, key: string, rayonTuiles: number, metrique: Metrique): { key: string; side: number } {
  const cells = Math.round((rayonTuiles * TILE_PX) / GRAIN_PX)
  const side = cells * 2 + 1
  if (!scene.textures.exists(key)) {
    const tex = scene.textures.createCanvas(key, side, side)
    if (tex) {
      const ctx = tex.getContext()
      const img = ctx.createImageData(side, side)
      for (let j = 0; j < side; j++) {
        for (let i = 0; i < side; i++) {
          const dx = i - cells
          const dy = j - cells
          const euclide = Math.sqrt(dx * dx + dy * dy)
          // Le carré arrondi : la moyenne de Chebyshev (ce que la loi balaie) et d'Euclide (ce
          // que l'œil accepte comme une lumière). Un carré franc se lirait comme une dalle.
          const d = metrique === 'carre' ? 0.5 * Math.max(Math.abs(dx), Math.abs(dy)) + 0.5 * euclide : euclide
          const a = Math.max(0, 1 - d / cells)
          const k = (j * side + i) * 4
          img.data[k] = 255
          img.data[k + 1] = 255
          img.data[k + 2] = 255
          img.data[k + 3] = Math.round(a * 255)
        }
      }
      ctx.putImageData(img, 0, 0)
      tex.refresh()
      scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
  }
  return { key, side }
}

/** Le près : une brosse blanche pleine jusqu'à `PRES_TUILES`, éteinte à `LOIN_TUILES` — chute
 *  quadratique, au grain des halos. Elle EFFACE le voile opaque jusqu'à `NOIR_ALPHA`. */
function ensurePres(scene: Phaser.Scene): number {
  const cells = Math.round((LOIN_TUILES * TILE_PX) / GRAIN_PX)
  const pres = (PRES_TUILES * TILE_PX) / GRAIN_PX
  const side = cells * 2 + 1
  if (!scene.textures.exists(PRES_KEY)) {
    const tex = scene.textures.createCanvas(PRES_KEY, side, side)
    if (tex) {
      const ctx = tex.getContext()
      const img = ctx.createImageData(side, side)
      for (let j = 0; j < side; j++) {
        for (let i = 0; i < side; i++) {
          const dx = i - cells
          const dy = j - cells
          const d = Math.sqrt(dx * dx + dy * dy)
          const t = Math.max(0, Math.min(1, (d - pres) / (cells - pres)))
          const k = (j * side + i) * 4
          img.data[k] = 255
          img.data[k + 1] = 255
          img.data[k + 2] = 255
          img.data[k + 3] = Math.round((1 - t * t) * 255)
        }
      }
      ctx.putImageData(img, 0, 0)
      tex.refresh()
      scene.textures.get(PRES_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
  }
  return side
}

/** La braise : un disque ambré, chaud au cœur, orangé au bord — la palette de `fx-torche-ground`,
 *  au même grain. En ADD sous le voile : là où la torche perce, le sol froid se réchauffe. */
const BRAISE_KEY = 'fx-cave-braise'
function ensureBraise(scene: Phaser.Scene): number {
  const cells = Math.round((TORCHE_CAVE_TUILES * TILE_PX) / GRAIN_PX)
  const side = cells * 2 + 1
  if (!scene.textures.exists(BRAISE_KEY)) {
    const tex = scene.textures.createCanvas(BRAISE_KEY, side, side)
    if (tex) {
      const ctx = tex.getContext()
      const img = ctx.createImageData(side, side)
      for (let j = 0; j < side; j++) {
        for (let i = 0; i < side; i++) {
          const dx = i - cells
          const dy = j - cells
          const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / cells)
          const a = (1 - t) * (1 - t)
          const k = (j * side + i) * 4
          // Cœur ambre-orangé (ff,b0,58), pas jaune : en ADD sur un corps clair, le vert d'un
          // (ff,c8,74) faisait un jaune de lanterne ([211,210,129] mesuré le 2026-09-02).
          img.data[k] = Math.round(0xff + (0xe0 - 0xff) * t)
          img.data[k + 1] = Math.round(0xb0 + (0x6c - 0xb0) * t)
          img.data[k + 2] = Math.round(0x58 + (0x1c - 0x58) * t)
          img.data[k + 3] = Math.round(a * 255)
        }
      }
      ctx.putImageData(img, 0, 0)
      tex.refresh()
      scene.textures.get(BRAISE_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
  }
  return side
}

/** La nappe de jour au sol : un disque BLANC à chute quadratique, au même grain — la couleur
 *  vient de la teinte (l'heure), jamais de la texture. Un carré arrondi, comme le trou qu'elle double. */
function ensureJourSol(scene: Phaser.Scene): number {
  const cells = Math.round((JOUR_TUILES * TILE_PX) / GRAIN_PX)
  const side = cells * 2 + 1
  if (!scene.textures.exists(JOUR_SOL_KEY)) {
    const tex = scene.textures.createCanvas(JOUR_SOL_KEY, side, side)
    if (tex) {
      const ctx = tex.getContext()
      const img = ctx.createImageData(side, side)
      for (let j = 0; j < side; j++) {
        for (let i = 0; i < side; i++) {
          const dx = i - cells
          const dy = j - cells
          const d = 0.5 * Math.max(Math.abs(dx), Math.abs(dy)) + 0.5 * Math.sqrt(dx * dx + dy * dy)
          const t = Math.min(1, d / cells)
          const k = (j * side + i) * 4
          img.data[k] = 255
          img.data[k + 1] = 255
          img.data[k + 2] = 255
          img.data[k + 3] = Math.round((1 - t) * (1 - t) * 255)
        }
      }
      ctx.putImageData(img, 0, 0)
      tex.refresh()
      scene.textures.get(JOUR_SOL_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
  }
  return side
}

export class CaveVeil {
  private rt: Phaser.GameObjects.RenderTexture
  private dt: Phaser.Textures.DynamicTexture
  private braise: Phaser.GameObjects.Image
  private chaleur: Phaser.GameObjects.Image
  private braiseSide: number
  /** Une nappe chaude par gueule visible (pool, comme les brosses). */
  private joursSol: Phaser.GameObjects.Image[] = []
  private jourSolSide: number
  /** UNE BROSSE PAR TROU (voir `night-veil.ts` : la commande DRAW ne retient qu'une référence, et
   *  relit texture, taille et alpha au `render()`). Jamais dans la liste d'affichage. */
  private brushes: Phaser.GameObjects.Image[] = []
  private jour: { key: string; side: number }
  private pres: { key: string; side: number }
  private torche: { key: string; side: number }
  private soi: { key: string; side: number }
  private w = 0
  private h = 0

  constructor(private scene: Phaser.Scene) {
    this.jour = brosse(scene, 'fx-cave-jour', JOUR_TUILES, 'carre')
    this.pres = { key: PRES_KEY, side: ensurePres(scene) }
    this.torche = brosse(scene, 'fx-cave-torche', TORCHE_CAVE_TUILES, 'rond')
    this.soi = brosse(scene, 'fx-cave-soi', SOI_TUILES, 'rond')
    this.braiseSide = ensureBraise(scene)
    this.jourSolSide = ensureJourSol(scene)
    this.w = scene.scale.width
    this.h = scene.scale.height
    this.rt = scene.add
      .renderTexture(0, 0, this.w, this.h)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(CAVE_VEIL_DEPTH)
      .setVisible(false)
    this.dt = this.rt.texture as Phaser.Textures.DynamicTexture
    this.braise = scene.add.image(0, 0, BRAISE_KEY)
      .setOrigin(0.5, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(BRAISE_DEPTH)
      .setDisplaySize(this.braiseSide * GRAIN_PX, this.braiseSide * GRAIN_PX)
      .setVisible(false)
    this.chaleur = scene.add.image(0, 0, BRAISE_KEY)
      .setOrigin(0.5, 0.5)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(CHALEUR_DEPTH)
      .setDisplaySize(this.braiseSide * GRAIN_PX, this.braiseSide * GRAIN_PX)
      .setVisible(false)
  }

  private brosseDe(i: number, key: string): Phaser.GameObjects.Image {
    let b = this.brushes[i]
    if (!b) {
      b = new Phaser.GameObjects.Image(this.scene, 0, 0, key).setOrigin(0.5, 0.5)
      this.brushes[i] = b
    } else if (b.texture.key !== key) {
      b.setTexture(key)
    }
    return b
  }

  /** Hors du souterrain, le voile n'existe pas — et il ne coûte rien. */
  cacher(): void {
    this.rt.setVisible(false)
    this.braise.setVisible(false)
    this.chaleur.setVisible(false)
    for (const j of this.joursSol) j.setVisible(false)
  }

  /**
   * Redessine le voile pour cette image. `gueules` : les centres des gueules en px monde (le jour
   * entre par chacune) ; `lum` : ce que la scène sait de la lumière.
   */
  update(lum: LumiereDeCave, gueules: readonly { x: number; y: number }[], camera: Phaser.Cameras.Scene2D.Camera): void {
    const sw = this.scene.scale.width
    const sh = this.scene.scale.height
    if (sw !== this.w || sh !== this.h) {
      this.w = sw
      this.h = sh
      this.dt.setSize(sw, sh)
    }
    // « scrollFactor(0) » annule le défilement, pas le zoom — voir `night-veil.ts`, qui a payé
    // cette leçon : on rend la RT insensible au zoom, et la projection ci-dessous redevient vraie.
    const zoom = camera.zoom
    const midX = camera.width * camera.originX
    const midY = camera.height * camera.originY
    this.rt.setScale(1 / zoom)
    this.rt.setPosition(midX * (1 - 1 / zoom), midY * (1 - 1 / zoom))
    this.rt.setVisible(true)

    this.dt.clear()
    // Opaque, puis le près l'ouvre à `NOIR_ALPHA` autour du joueur (voir `PRES_KEY`). Sans
    // joueur connu, le voile est uniforme à `NOIR_ALPHA`, comme avant.
    this.dt.fill(NOIR, lum.joueur ? 1 : NOIR_ALPHA)
    const v = camera.worldView
    let n = 0
    const percer = (b: { key: string; side: number }, wx: number, wy: number, alpha: number): void => {
      if (alpha <= 0.002) return
      const dia = b.side * GRAIN_PX * zoom
      const tx = (wx - v.x) * zoom
      const ty = (wy - v.y) * zoom
      const marge = dia / 2
      if (tx < -marge || ty < -marge || tx > sw + marge || ty > sh + marge) return
      const brush = this.brosseDe(n++, b.key)
      brush.setDisplaySize(dia, dia).setAlpha(Math.min(1, alpha))
      this.dt.erase(brush, tx, ty)
    }
    // LA NUIT ENTRE AUSSI PAR LA GUEULE. `clarteDuCiel` est la clarté POUR L'ŒIL — celle de la
    // loi de jeu, qui vaut 1 sous la pleine lune (on y voit). Mais ce que la gueule laisse
    // entrer, c'est la lumière de l'heure : le trou ne dépasse pas la LUMINANCE de la teinte du
    // dehors (`teinteDuJour`, le multiplicateur du voile de nuit), sinon une nuit de pleine lune
    // faisait entrer un plein midi dans la salle (vu à la capture).
    const jour = JOUR_PIC * lum.ciel * luminance(lum.teinteDuJour)
    for (const g of gueules) percer(this.jour, g.x, g.y, jour)
    // Le près AVANT les trous de lumière : une gueule ou une torche perce aussi au-delà — c'est
    // une lumière, elle porte plus loin que l'œil dans le noir.
    if (lum.joueur) percer(this.pres, lum.joueur.x, lum.joueur.y, 1 - NOIR_ALPHA)
    if (lum.torche) percer(this.torche, lum.torche.x, lum.torche.y, TORCHE_PIC * lum.torche.force)
    if (lum.joueur) percer(this.soi, lum.joueur.x, lum.joueur.y, SOI_PIC)
    this.dt.render()

    if (lum.torche) {
      this.braise
        .setPosition(lum.torche.x, lum.torche.y)
        .setAlpha(Math.min(1, BRAISE_ALPHA * lum.torche.force))
        .setVisible(true)
      // La chaleur suit l'agonie de la flamme ; plafonnée à 1, elle ne bat qu'à peine.
      this.chaleur
        .setPosition(lum.torche.x, lum.torche.y)
        .setAlpha(Math.min(1, CHALEUR_ALPHA * Math.min(1, lum.torche.force)))
        .setVisible(true)
    } else {
      this.braise.setVisible(false)
      this.chaleur.setVisible(false)
    }
    // La chaleur du jour au sol, une par gueule — teintée de la lumière qui entre.
    gueules.forEach((g, i) => {
      let j = this.joursSol[i]
      if (!j) {
        j = this.scene.add.image(0, 0, JOUR_SOL_KEY)
          .setOrigin(0.5, 0.5)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(BRAISE_DEPTH)
          .setDisplaySize(this.jourSolSide * GRAIN_PX, this.jourSolSide * GRAIN_PX)
        this.joursSol[i] = j
      }
      j.setPosition(g.x, g.y).setTint(lum.couleurDuJour).setAlpha(JOUR_SOL_ALPHA * jour).setVisible(true)
    })
    for (let i = gueules.length; i < this.joursSol.length; i++) this.joursSol[i]?.setVisible(false)
  }

  destroy(): void {
    this.rt.destroy()
    this.braise.destroy()
    this.chaleur.destroy()
    for (const b of this.brushes) b.destroy()
    for (const j of this.joursSol) j.destroy()
  }
}
