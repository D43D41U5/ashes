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
import { SOUTERRAIN_STRATE, TILE_PX } from '../../render/framing'
import { armerLeSol, desarmerLeSol } from '../../render/gi/noeud-corps'
import {
  brosse, ensureGomme, ensurePres, luminance,
  FEU_CAVE_TUILES, FEU_KEY, GOMME_KEY, GRAIN_PX, JOUR_KEY, JOUR_PIC, JOUR_TUILES, NOIR, NOIR_ALPHA,
  PRES_KEY, SOI_KEY, SOI_PIC, SOI_TUILES, TORCHE_CAVE_TUILES, TORCHE_KEY, TORCHE_PIC,
} from '../../render/cave-brosses'

// Le noir, le grain, les portées et les brosses vivent dans `render/cave-brosses.ts` depuis la
// bascule (LG-R3, LG-R20) : le champ de la GI peint le même voile dans `gi-mn`, avec les mêmes brosses.
export { FEU_CAVE_TUILES, JOUR_TUILES, TORCHE_CAVE_TUILES }

/** Le voile au-dessus de TOUTE la strate −1, sous la lisière de la strate suivante. */
export const CAVE_VEIL_DEPTH = SOUTERRAIN_STRATE - 1
/** La braise de la torche : juste sous le voile, au-dessus de tout corps de la salle. */
export const BRAISE_DEPTH = CAVE_VEIL_DEPTH - 1
/** La chaleur de la torche — le MULTIPLY qui ôte le bleu — passe juste avant la braise. */
const CHALEUR_DEPTH = BRAISE_DEPTH - 1
/**
 * LA NAPPE DU JOUR QUAND LE CHAMP COMPOSE (LG-R20) : AU-DESSUS du quad du champ (qui est à
 * `CAVE_VEIL_DEPTH` dans un creux), sous la lisière de la strate suivante — armée en `lueur`, elle
 * lit elle-même la lumière du champ sous chaque pixel (`nappe × L`, la planche 28 (c)). Sous le quad,
 * elle prenait le plancher du près en plus du jour, et fuyait derrière l'angle (MESURÉ le 2026-09-19).
 */
const LUEUR_DEPTH = CAVE_VEIL_DEPTH + 0.5

/**
 * UNE BANDE HORIZONTALE DU MASQUE DE LA MASSE, en tuiles MONDE : la rangée `r` est une rangée
 * DESSINÉE (celle de l'écran, lift compris), `a` et `b` les colonnes extrêmes, incluses.
 * `EtageLayer` en produit deux listes — la masse, où la roche se pose, et son complément, où le
 * voile s'ouvre parce qu'il n'y a rien à assombrir.
 */
export interface BandeDeMasque {
  r: number
  a: number
  b: number
}

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
  /** LES FEUX DE LA SALLE (G-R7, le bivouac), en px MONDE dessinés, avec le battement de leur
   *  flamme (0 = éteint) : chacun perce le voile comme une torche posée, en plus grand. */
  feux: readonly { x: number; y: number; force: number }[]
}

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

/** La nappe de jour au sol : la moitié NORD d'un carré arrondi BLANC à chute quadratique, au même
 *  grain — la couleur vient de la teinte (l'heure), jamais de la texture. Posée au pied de la
 *  façade, elle n'éclaire que la salle : au sud, c'est le dehors, et il a sa lumière (`grottes.md`
 *  §4sexies — le disque entier allumait l'herbe du seuil et de ses voisines, +40 MESURÉ à midi). */
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
          img.data[k + 3] = dy >= 0 ? 0 : Math.round((1 - t) * (1 - t) * 255)
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
  /** Une gomme par bande ouverte — même règle que les brosses : la commande `erase` ne retient
   *  qu'une RÉFÉRENCE et relit taille et position au `render()`, donc jamais un objet partagé. */
  private gommes: Phaser.GameObjects.Image[] = []
  private jour: { key: string; side: number }
  private pres: { key: string; side: number }
  private torche: { key: string; side: number }
  private feu: { key: string; side: number }
  private soi: { key: string; side: number }
  /** La braise et la chaleur de chaque feu de la salle (pool, comme `joursSol`). */
  private braisesFeu: { braise: Phaser.GameObjects.Image; chaleur: Phaser.GameObjects.Image }[] = []
  private w = 0
  private h = 0

  constructor(private scene: Phaser.Scene) {
    this.jour = brosse(scene, JOUR_KEY, JOUR_TUILES, 'carre')
    this.pres = { key: PRES_KEY, side: ensurePres(scene) }
    this.torche = brosse(scene, TORCHE_KEY, TORCHE_CAVE_TUILES, 'rond')
    this.feu = brosse(scene, FEU_KEY, FEU_CAVE_TUILES, 'rond')
    this.soi = brosse(scene, SOI_KEY, SOI_TUILES, 'rond')
    this.braiseSide = ensureBraise(scene)
    this.jourSolSide = ensureJourSol(scene)
    ensureGomme(scene)
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

  private gommeDe(i: number): Phaser.GameObjects.Image {
    let g = this.gommes[i]
    if (!g) {
      g = new Phaser.GameObjects.Image(this.scene, 0, 0, GOMME_KEY).setOrigin(0, 0)
      this.gommes[i] = g
    }
    return g
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
    // Les braises des feux aussi (G-R7) : un disque ADD oublié ici éclairait la terrasse à
    // l'aplomb du bivouac — MESURÉ au smoke `grotte` ④ (sol 42 → 101 sans feu à la surface).
    for (const b of this.braisesFeu) { b.braise.setVisible(false); b.chaleur.setVisible(false) }
  }

  /**
   * Redessine le voile pour cette image. `gueules` : le pied de la façade de chaque gueule, au
   * milieu de la paire, en px monde (le jour entre par là) ; `lum` : ce que la scène sait de la lumière.
   */
  update(
    lum: LumiereDeCave, gueules: readonly { x: number; y: number }[],
    camera: Phaser.Cameras.Scene2D.Camera,
    trouees: readonly BandeDeMasque[] = [], nTrouees = 0,
    /**
     * LE CHAMP DE LA GI PORTE-T-IL LE VOILE À NOTRE PLACE (LG-R3, LG-R20) ? Alors la RenderTexture
     * se tait — son noir, son près, son souffle sont repeints dans `gi-mn` avec NOS brosses, et le
     * jour de la gueule, la torche et le bivouac sont des émetteurs du champ, qui apprennent l'ombre
     * de la roche (planche 28, « Oui, comme le feu »). Restent ici la braise et la chaleur de la
     * torche et des feux — des lueurs ADD/MULTIPLY sous le champ, comme la flaque du feu dehors
     * (LG-Q3 c : « la flaque reste sous le champ ») — et la nappe chaude du jour, qui passe AU-DESSUS
     * du quad et lit le jour du champ sous chaque pixel (`lueur`, `LUEUR_DEPTH`) : `lift` est celui de
     * l'étage du regard, de combien la salle est dessinée plus haut que sa place logique (LG-R14).
     */
    composeExterne: { readonly lift: number } | null = null,
  ): void {
    const jour = JOUR_PIC * lum.ciel * luminance(lum.teinteDuJour)
    if (composeExterne) {
      this.rt.setVisible(false)
      this.poserLesLueurs(lum, gueules, jour, composeExterne)
      return
    }
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
    // ═══ LÀ OÙ RIEN NE SURPLOMBE, IL N'Y A RIEN À ASSOMBRIR ═══
    //
    // Le voile couvrait le CADRE, comme la roche qu'il double ; depuis qu'elle se borne à la
    // masse (`EtageLayer.ouvrirLeMasque`), le laisser plein rendrait NOIR tout ce qu'elle vient
    // de découvrir — on aurait troqué une roche menteuse contre un trou. Il s'ouvre donc sur le
    // complément du masque, bande par bande.
    //
    // ⚠ **PAR EFFACEMENT, ET NON PAR UNE `fill` PAR BANDE.** Un effacement est idempotent : deux
    // bandes peuvent se chevaucher d'un pixel sans laisser de trace, et c'est ce chevauchement
    // qui garantit l'absence de couture au zoom fractionnaire. Vingt `fill` à 0,62 posées bord à
    // bord auraient tracé, elles, une ligne plus sombre à chaque jointure.
    for (let i = 0; i < nTrouees; i++) {
      const t = trouees[i]!
      const g = this.gommeDe(i)
      const w = (t.b - t.a + 1) * TILE_PX * zoom
      const h = TILE_PX * zoom
      g.setDisplaySize(w + 2, h + 2)
      this.dt.erase(g, (t.a * TILE_PX - v.x) * zoom - 1, (t.r * TILE_PX - v.y) * zoom - 1)
    }
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
    for (const g of gueules) percer(this.jour, g.x, g.y, jour)
    // Le près AVANT les trous de lumière : une gueule ou une torche perce aussi au-delà — c'est
    // une lumière, elle porte plus loin que l'œil dans le noir.
    if (lum.joueur) percer(this.pres, lum.joueur.x, lum.joueur.y, 1 - NOIR_ALPHA)
    if (lum.torche) percer(this.torche, lum.torche.x, lum.torche.y, TORCHE_PIC * lum.torche.force)
    // Le bivouac (G-R7) : un feu de la salle perce comme la torche, en plus grand, et BAT par son
    // alpha (`force`, le battement de sa flamme) — jamais par sa taille.
    for (const f of lum.feux) percer(this.feu, f.x, f.y, TORCHE_PIC * f.force)
    if (lum.joueur) percer(this.soi, lum.joueur.x, lum.joueur.y, SOI_PIC)
    this.dt.render()
    this.poserLesLueurs(lum, gueules, jour, null)
  }

  /** Les lueurs SOUS le voile (ou sous le champ) : la braise et la chaleur de la torche et des feux,
   *  la nappe chaude d'une gueule — `jour` est la force du jour de l'image. Quand le champ compose
   *  (`champ`), la nappe passe au-dessus de lui, armée en `lueur` ; sinon elle reste sous le voile. */
  private poserLesLueurs(
    lum: LumiereDeCave, gueules: readonly { x: number; y: number }[], jour: number,
    champ: { readonly lift: number } | null,
  ): void {
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
    // La braise et la chaleur de chaque feu de la salle — le même disque que la torche, à
    // l'échelle du feu ; éteint (`force` 0), le feu ne réchauffe plus rien.
    const echelleFeu = FEU_CAVE_TUILES / TORCHE_CAVE_TUILES
    lum.feux.forEach((f, i) => {
      let b = this.braisesFeu[i]
      if (!b) {
        const cote = this.braiseSide * GRAIN_PX * echelleFeu
        b = {
          braise: this.scene.add.image(0, 0, BRAISE_KEY).setOrigin(0.5, 0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(BRAISE_DEPTH).setDisplaySize(cote, cote),
          chaleur: this.scene.add.image(0, 0, BRAISE_KEY).setOrigin(0.5, 0.5).setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(CHALEUR_DEPTH).setDisplaySize(cote, cote),
        }
        this.braisesFeu[i] = b
      }
      b.braise.setPosition(f.x, f.y).setAlpha(Math.min(1, BRAISE_ALPHA * f.force)).setVisible(f.force > 0)
      b.chaleur.setPosition(f.x, f.y).setAlpha(Math.min(1, CHALEUR_ALPHA * Math.min(1, f.force))).setVisible(f.force > 0)
    })
    for (let i = lum.feux.length; i < this.braisesFeu.length; i++) {
      this.braisesFeu[i]?.braise.setVisible(false)
      this.braisesFeu[i]?.chaleur.setVisible(false)
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
      // Sur un emplacement poolé, à chaque image (voir `armerLeSol`) ; et le retour sous le voile
      // rend à l'image son rendu nu, à sa profondeur d'avant.
      if (champ) {
        if (j.depth !== LUEUR_DEPTH) j.setDepth(LUEUR_DEPTH)
        armerLeSol(j, { lueur: true, lift: champ.lift })
      } else {
        if (j.depth !== BRAISE_DEPTH) j.setDepth(BRAISE_DEPTH)
        desarmerLeSol(j)
      }
    })
    for (let i = gueules.length; i < this.joursSol.length; i++) this.joursSol[i]?.setVisible(false)
  }

  destroy(): void {
    this.rt.destroy()
    this.braise.destroy()
    this.chaleur.destroy()
    for (const b of this.brushes) b.destroy()
    for (const g of this.gommes) g.destroy()
    for (const j of this.joursSol) j.destroy()
    for (const f of this.braisesFeu) {
      f.braise.destroy()
      f.chaleur.destroy()
    }
  }
}
