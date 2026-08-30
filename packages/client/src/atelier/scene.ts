/**
 * LA SCÈNE DE L'ATELIER — LE RENDU DU JEU, PAS UN APERÇU (décision d'Alexis, 2026-08-10 :
 * « je veux avoir le même rendu que ingame », après avoir jugé le composeur illisible).
 *
 * La page embarque un vrai `Phaser.Game` : le VRAI `BootScene` génère toutes les textures,
 * puis démarre cette scène — elle porte la clé `menu`, parce que c'est la scène que
 * `BootScene` lance en sortie de boot : dans CE jeu-là, « menu » EST l'Atelier. Elle rend
 * par le VRAI `SnapshotView` — murs teintés et raccordés, huisseries, toits levés qui
 * s'effacent, pans qui tombent, nœuds, éclairage dynamique. Plus de second renderer.
 *
 * L'AVATAR FICTIF est un vrai `spawnEntity` du sim d'aperçu : sa position dedans/dehors
 * fait jouer les VRAIES règles de révélation (nappe, pans) — pas une bascule d'affichage.
 *
 * ═══ L'ÉTABLI (spec `atelier-plans.md` P-A / P-Établi) ═══
 *
 * La scène porte le GESTE et les CALQUES ; le panneau DOM décide, elle montre :
 *   · zoom à la molette, pan au bouton du milieu ou à Espace+glisser (le panneau tient
 *     l'état d'Espace — le clavier reste au DOM, qui sait quand un champ a le focus) ;
 *   · les BADGES D'ARÊTES permanents (brèche/seuil/passage — on ne gomme plus à l'aveugle)
 *     et l'overlay des RÉGIONS, redessinés à chaque zoom (épaisseur en pixels ÉCRAN) ;
 *   · le calque « toits » est un FILTRE du snapshot montré, jamais un état de sim ;
 *   · les événements de TRAIT (enfoncé / glissé / relâché) remontent au panneau — c'est lui
 *     qui peint, gomme, et clôt une entrée d'historique par trait.
 *
 * Ce qui reste hors-jeu, assumé : le SOL est un aplat d'herbe (le vrai sol est tout un
 * système, ground-mesh + grain + warp), ni brouillard ni météo. Le juge du monde complet
 * reste le jeu (`pnpm smoke --scenario lieux-batis`).
 */
import Phaser from 'phaser'
import { getGameTime, VENT } from '@ashes/sim'
import type { SimState, SnapshotMessage } from '@ashes/sim'
import { SnapshotView } from '../scenes/world/snapshot-view'
import { DynamicLighting } from '../scenes/world/dynamic-lighting'
import { heureCanonique } from '../render/lighting'
import { createContactShadow } from '../scenes/world/contact-shadow'
import { poiTextureKey } from '../scenes/world/poi-art'
import { erratiqueVariantFor, litErratiqueKey, POI_LIT_KINDS, poiLitKey } from '../render/poi-lit'
import { TILE_PX } from '../render/framing'

/** Les couches de l'éditeur, au-dessus de tout le monde rendu (crowns ≈ 900k) :
 *  régions sous les badges, badges sous le fantôme, la grille par-dessus tout. */
const REGIONS_DEPTH = 1_480_000
const BADGES_DEPTH = 1_485_000
const SELECTION_DEPTH = 1_488_000
const FANTOME_DEPTH = 1_490_000
const GRILLE_DEPTH = 1_500_000

const ZOOM_MIN = 1
const ZOOM_MAX = 12

/** Ce que le panneau demande de FANTÔMER sous le curseur — une seule forme à la fois. */
export type Fantome =
  | { tuile: { tx: number; ty: number; texture: string | null } }
  | { arete: { tx: number; ty: number; dir: 'N' | 'E' | 'S' | 'O'; couleur: number } }
  | { contour: { tx: number; ty: number; couleur: number } }
  | { zone: { tx: number; ty: number; w: number; h: number; couleur: number } }

/** Un badge d'arête (triplet posé) ou une tuile de région, dessinés en calques. */
export interface Arete { tx: number; ty: number; dir: 'N' | 'E' | 'S' | 'O'; couleur: number }
export interface Region { tx: number; ty: number; teinte: number }

export interface Calques { toits: boolean; aretes: boolean; regions: boolean; grille: boolean }

export class AtelierScene extends Phaser.Scene {
  private view!: SnapshotView
  private dyn!: DynamicLighting
  private avatar!: Phaser.GameObjects.Image
  private fond?: Phaser.GameObjects.Rectangle
  private naturel?: Phaser.GameObjects.Image
  private naturelG?: Phaser.GameObjects.Graphics
  private grilleG!: Phaser.GameObjects.Graphics
  private badgesG!: Phaser.GameObjects.Graphics
  private regionsG!: Phaser.GameObjects.Graphics
  private selectionG!: Phaser.GameObjects.Graphics
  private selection: { tx: number; ty: number; w: number; h: number } | null = null
  private fantomeImg!: Phaser.GameObjects.Image
  private fantomeG!: Phaser.GameObjects.Graphics
  private courant: SnapshotMessage | null = null
  private avatarPos = { x: 0, y: 0 }
  private cote = 0
  private aretes: readonly Arete[] = []
  private regions: readonly Region[] = []
  /** L'heure de l'éclairage (le curseur du panneau) — le soleil du jeu suit, chaque frame. */
  heure = 12
  calques: Calques = { toits: true, aretes: true, regions: false, grille: true }
  /** Espace enfoncé = PAN au glisser — tenu par le panneau (le clavier vit au DOM, qui sait
   *  quand un champ a le focus ; la scène ne doit pas voler les frappes de l'inspecteur). */
  espace = false
  /** Le TRAIT : enfoncé (avec bouton droit ? alt ?), glissé (case par case), relâché. */
  surClic: ((fx: number, fy: number, droit: boolean, alt: boolean) => void) | null = null
  surGlisse: ((fx: number, fy: number) => void) | null = null
  surRelache: (() => void) | null = null
  surSurvol: ((fx: number, fy: number) => void) | null = null
  surZoom: ((zoom: number) => void) | null = null
  pret = false

  constructor() {
    super('menu')
  }

  create(): void {
    this.view = new SnapshotView(this)
    this.dyn = new DynamicLighting(this)
    this.view.lighting = true //  l'éclairage du jeu, allumé par défaut — comme en jeu
    // L'avatar : créé comme dans WorldScene (origine pieds + ombre de contact) — `syncActor`
    // fait le reste à l'identique du jeu, taille d'affichage comprise.
    this.avatar = this.add.image(0, 0, 'spr-player').setOrigin(0.5, 1)
    this.avatar.setData('shadow', createContactShadow(this))
    this.regionsG = this.add.graphics().setDepth(REGIONS_DEPTH)
    this.badgesG = this.add.graphics().setDepth(BADGES_DEPTH)
    this.selectionG = this.add.graphics().setDepth(SELECTION_DEPTH)
    this.fantomeImg = this.add.image(0, 0, '__WHITE').setVisible(false).setDepth(FANTOME_DEPTH)
    this.fantomeG = this.add.graphics().setDepth(FANTOME_DEPTH)
    this.grilleG = this.add.graphics().setDepth(GRILLE_DEPTH)
    this.input.mouse?.disableContextMenu() //  le clic droit est la gomme, pas un menu

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.middleButtonDown() || this.espace) return //  ce clic ouvre un PAN, pas un trait
      const e = p.event as MouseEvent
      this.surClic?.(p.worldX / TILE_PX, p.worldY / TILE_PX, p.rightButtonDown(), e.altKey === true)
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      // LE PAN : bouton du milieu, ou Espace tenu — la caméra suit la main, en px monde.
      if (p.isDown && (p.middleButtonDown() || this.espace)) {
        const cam = this.cameras.main
        cam.scrollX -= (p.position.x - p.prevPosition.x) / cam.zoom
        cam.scrollY -= (p.position.y - p.prevPosition.y) / cam.zoom
        this.majFantome(null)
        return
      }
      const fx = p.worldX / TILE_PX
      const fy = p.worldY / TILE_PX
      if (p.isDown && p.button === 0) this.surGlisse?.(fx, fy) //  le TRAIT continue
      this.surSurvol?.(fx, fy)
    })
    // LE RELÂCHER SE VOIT MÊME HORS CANVAS (revue du 2026-08-10) : finir un glisser
    // au-dessus de la palette ou de l'inspecteur est le geste ORDINAIRE — sans
    // `pointerupoutside`, le trait restait armé et son entrée d'historique ne partait pas.
    this.input.on('pointerup', () => this.surRelache?.())
    this.input.on('pointerupoutside', () => this.surRelache?.())

    // LE ZOOM À LA MOLETTE, centré sur le curseur (le standard des éditeurs : on zoome
    // VERS ce qu'on regarde). Grille et badges se redessinent — leur épaisseur est en
    // pixels ÉCRAN, pas monde.
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main
      const avant = { x: p.worldX, y: p.worldY }
      const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom * (dy > 0 ? 1 / 1.15 : 1.15)))
      cam.setZoom(zoom)
      // Le point monde sous le curseur ne doit pas bouger : on compense le défilement.
      const apres = cam.getWorldPoint(p.x, p.y)
      cam.scrollX += avant.x - apres.x
      cam.scrollY += avant.y - apres.y
      this.redessinerCalques()
      this.surZoom?.(zoom)
    })
    this.pret = true
  }

  /** RECADRER : le plan entier dans la fenêtre (le bouton « ajuster » de la barre d'outils). */
  recadrer(): void {
    if (this.cote === 0) return
    const cam = this.cameras.main
    const px = this.cote * TILE_PX
    cam.centerOn(px / 2, px / 2)
    cam.setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor(Math.min(this.scale.width, this.scale.height) / px))))
    this.redessinerCalques()
    this.surZoom?.(cam.zoom)
  }

  /**
   * LE FANTÔME — ce que le geste FERAIT, avant de cliquer : la pièce translucide pour la
   * peinture (le patron du fantôme du marteau), un liseré coloré sur l'arête visée pour
   * brèche/seuil/passage, un contour pour la gomme. Le panneau DÉCIDE, la scène montre.
   */
  majFantome(spec: Fantome | null): void {
    this.fantomeG.clear()
    this.fantomeImg.setVisible(false)
    if (!spec) return
    const T = TILE_PX
    if ('tuile' in spec) {
      const { tx, ty, texture } = spec.tuile
      if (texture !== null && this.textures.exists(texture)) {
        this.fantomeImg
          .setTexture(texture)
          .setOrigin(0.5, 1)
          .setPosition(tx * T + T / 2, (ty + 1) * T)
          .setAlpha(0.6)
          .setVisible(true)
      } else {
        // Sans texture (l'effaceur `·` de la palette) : la case se montre, vide.
        this.fantomeG.fillStyle(0xe8b34a, 0.22).fillRect(tx * T, ty * T, T, T)
      }
    } else if ('arete' in spec) {
      this.traceArete(this.fantomeG, spec.arete, 3 / this.cameras.main.zoom, 0.9)
    } else if ('contour' in spec) {
      const { tx, ty, couleur } = spec.contour
      this.fantomeG.lineStyle(2 / this.cameras.main.zoom, couleur, 0.95).strokeRect(tx * T + 0.5, ty * T + 0.5, T - 1, T - 1)
    } else {
      // Le COLLAGE armé : l'emprise du fragment suit le curseur — on voit où ça tombera.
      const { tx, ty, w, h, couleur } = spec.zone
      this.fantomeG.fillStyle(couleur, 0.12).fillRect(tx * T, ty * T, w * T, h * T)
      this.fantomeG.lineStyle(2 / this.cameras.main.zoom, couleur, 0.9).strokeRect(tx * T, ty * T, w * T, h * T)
    }
  }

  /** LA SÉLECTION (P-B) — persistante, redessinée au zoom (épaisseur en pixels écran). */
  majSelection(z: { tx: number; ty: number; w: number; h: number } | null): void {
    this.selection = z
    this.redessinerCalques()
  }

  private traceArete(g: Phaser.GameObjects.Graphics, a: Arete, e: number, alpha: number): void {
    const T = TILE_PX
    const bande = (ep: number): [number, number, number, number] =>
      a.dir === 'N' ? [a.tx * T, a.ty * T - ep / 2, T, ep]
      : a.dir === 'S' ? [a.tx * T, (a.ty + 1) * T - ep / 2, T, ep]
      : a.dir === 'O' ? [a.tx * T - ep / 2, a.ty * T, ep, T]
      : [(a.tx + 1) * T - ep / 2, a.ty * T, ep, T]
    // L'ASSISE SOMBRE d'abord : un badge doit se lire sur N'IMPORTE QUEL fond — le passage
    // VERT sur l'herbe verte était invisible (relevé en capture, 2026-08-10).
    g.fillStyle(0x0c0f0a, alpha * 0.85)
    g.fillRect(...bande(e * 2.2))
    g.fillStyle(a.couleur, alpha)
    g.fillRect(...bande(e))
  }

  /** Grille, badges d'arêtes et régions — épaisseurs en pixels ÉCRAN : à redessiner à
   *  chaque zoom comme à chaque `montrer`. */
  private redessinerCalques(): void {
    const T = TILE_PX
    const zoom = this.cameras.main.zoom
    const px = this.cote * T
    this.grilleG.clear()
    if (this.calques.grille && this.cote > 0) {
      this.grilleG.lineStyle(1 / zoom, 0x0c0f0a, 0.28)
      for (let i = 0; i <= this.cote; i++) {
        this.grilleG.lineBetween(i * T, 0, i * T, px)
        this.grilleG.lineBetween(0, i * T, px, i * T)
      }
    }
    this.badgesG.clear()
    if (this.calques.aretes) {
      // LES ARÊTES POSÉES SE VOIENT (P-A) : on ne gomme plus à l'aveugle.
      for (const a of this.aretes) this.traceArete(this.badgesG, a, 3.5 / zoom, 0.95)
    }
    this.regionsG.clear()
    if (this.calques.regions) {
      for (const r of this.regions) this.regionsG.fillStyle(r.teinte, 0.28).fillRect(r.tx * T, r.ty * T, T, T)
    }
    this.selectionG.clear()
    if (this.selection) {
      const s = this.selection
      this.selectionG.fillStyle(0xe8b34a, 0.10).fillRect(s.tx * T, s.ty * T, s.w * T, s.h * T)
      this.selectionG.lineStyle(2 / zoom, 0xe8b34a, 0.95).strokeRect(s.tx * T, s.ty * T, s.w * T, s.h * T)
    }
  }

  /** MONTRER l'état d'aperçu : un snapshot synthétique COMPLET, appliqué au vrai renderer.
   *  `garderCamera` : une édition en cours ne recadre pas — le zoom et le pan sont à
   *  l'auteur, pas à l'outil. */
  montrer(
    sim: SimState,
    playerId: number,
    aretes: readonly Arete[],
    regions: readonly Region[],
    garderCamera: boolean,
  ): void {
    const moi = sim.entities.find((e) => e.id === playerId)
    this.avatarPos = moi ? { x: moi.x, y: moi.y } : { x: 0, y: 0 }
    const msg: SnapshotMessage = {
      type: 'snapshot',
      tick: sim.tick,
      lastProcessedInput: 0,
      cendreAge: sim.cendreAge, // l'Atelier ne joue pas la cendre, mais le message est complet
      time: getGameTime(sim),
      entities: sim.entities,
      // LE CALQUE « TOITS » EST UN FILTRE DU MONTRÉ, jamais un état de sim : on retire les
      // toits du snapshot — la sim d'aperçu, elle, les a toujours.
      structures: this.calques.toits ? sim.structures : sim.structures.filter((s) => s.type !== 'roof'),
      villages: sim.villages,
      functions: [],
      nodeDeltas: [],
      npcs: [],
      monsters: [],
      corpses: [],
      reveils: [],
      blood: [],
      wind: { x: 1, y: 0 },
      windForce: VENT.AMBIANT,
      groundItems: [],
      // L'Atelier n'a pas de ciel : on y regarde un PLAN, pas une vallée. Jamais de front.
      meteo: null,
      events: [],
    }
    this.courant = msg
    this.cote = sim.map.width
    this.aretes = aretes
    this.regions = regions
    // Retour à une vue de PLAN : le sprite d'un lieu naturel montré avant s'efface.
    this.naturel?.setVisible(false)
    this.naturelG?.clear()
    const cote = this.cote * TILE_PX
    // L'herbe d'essai, sous tout — un aplat à la teinte du jeu (le vrai sol est un système).
    this.fond ??= this.add.rectangle(0, 0, 1, 1, 0xa9cd93).setOrigin(0, 0).setDepth(-10)
    this.fond.setDisplaySize(cote, cote)
    // Les arbres du jeu se rendent par ESSENCE (fût + houppier tirés du peuplement de la
    // carte) : sans lui, un nœud `tree` n'a pas de silhouette. Graine fixe = aperçu stable.
    this.view.setPeuplement(sim.map, 7)
    this.view.setNodes(sim.nodes)
    this.view.apply(msg, playerId, this.time.now)
    if (!garderCamera) this.recadrer()
    else this.redessinerCalques()
  }

  /**
   * UN LIEU NATUREL (grotte, erratique, arche…) — pas de plan : son corps est le SPRITE du
   * jeu. On le montre TEL QUE LE JEU LE CHOISIT (mêmes clés que `poi-layer`, copie de trois
   * lignes documentée : `_lit` par table, l'erratique par variante), avec son empreinte —
   * l'aperçu d'où partirait une ÉBAUCHE de plan. À appeler APRÈS `montrer` (la carte vide).
   */
  poserNaturel(kind: string, footprint: number, marge: number): void {
    const T = TILE_PX
    const lit = kind === 'erratique' || POI_LIT_KINDS.has(kind)
    const cle = kind === 'erratique'
      ? litErratiqueKey(erratiqueVariantFor(0))
      : POI_LIT_KINDS.has(kind) ? poiLitKey(kind) : poiTextureKey(kind)
    if (!this.textures.exists(cle)) return
    this.naturel ??= this.add.image(0, 0, cle).setOrigin(0.5, 1).setDepth(50_000)
    this.naturel
      .setTexture(cle)
      .setPosition((marge + footprint / 2) * T, (marge + footprint) * T)
      .setVisible(true)
    this.naturel.setLighting(lit)
    // L'EMPREINTE (POI_TYPES) : le carré que le lieu occupe sur la carte — le côté qu'aurait
    // son plan.
    this.naturelG ??= this.add.graphics().setDepth(BADGES_DEPTH)
    this.naturelG.clear()
    this.naturelG.lineStyle(2 / this.cameras.main.zoom, 0xe8b34a, 0.7)
      .strokeRect(marge * T, marge * T, footprint * T, footprint * T)
  }

  override update(time: number): void {
    if (!this.courant) return
    // Le soleil du jeu, à l'heure du curseur — c'est LUI qui fait vivre les `_lit`.
    this.dyn.update(true, this.cameras.main, this.courant.structures, this.courant.villages, heureCanonique(this.heure), 1, time)
    this.view.renderNodes(this.cameras.main, this.avatarPos.x, this.avatarPos.y, time)
    this.view.syncActor(this.avatar, this.avatarPos.x, this.avatarPos.y, 'spr-player')
  }
}
