/**
 * LA SCÈNE DE L'ATELIER — LE RENDU DU JEU, PAS UN APERÇU (décision d'Alexis, 2026-08-10 :
 * « je veux avoir le même rendu que ingame », après avoir jugé le composeur illisible).
 *
 * La page embarque un vrai `Phaser.Game` : le VRAI `BootScene` génère toutes les textures,
 * puis démarre cette scène — elle porte la clé `menu`, parce que c'est la scène que
 * `BootScene` lance en sortie de boot : dans CE jeu-là, « menu » EST l'Atelier. Elle rend
 * par le VRAI `SnapshotView` — celui du monde, à l'identique : murs teintés et raccordés,
 * huisseries, toits levés qui s'effacent, pans qui tombent, nœuds, éclairage dynamique.
 * Le composeur canvas de la première version est RETIRÉ : plus de second renderer.
 *
 * L'AVATAR FICTIF est un vrai `spawnEntity` du sim d'aperçu : sa position dedans/dehors
 * fait jouer les VRAIES règles de révélation (nappe, pans) — pas une bascule d'affichage.
 *
 * Ce qui reste hors-jeu, assumé : le SOL est un aplat d'herbe (le vrai sol est tout un
 * système, ground-mesh + grain + warp), ni brouillard ni météo. Le juge du monde complet
 * reste le jeu (`pnpm smoke --scenario lieux-batis`).
 */
import Phaser from 'phaser'
import { getGameTime } from '@ashes/sim'
import type { SimState, SnapshotMessage } from '@ashes/sim'
import { SnapshotView } from '../scenes/world/snapshot-view'
import { DynamicLighting } from '../scenes/world/dynamic-lighting'
import { createContactShadow } from '../scenes/world/contact-shadow'
import { TILE_PX } from '../render/framing'

/** La grille d'édition au-dessus de tout (toits compris : on clique aussi à travers eux),
 *  le fantôme juste en dessous d'elle. Loin au-delà des bandes du monde (crowns ≈ 900k). */
const GRILLE_DEPTH = 1_500_000
const FANTOME_DEPTH = 1_490_000

/** Ce que le panneau demande de FANTÔMER sous le curseur — une seule forme à la fois. */
export type Fantome =
  | { tuile: { tx: number; ty: number; texture: string | null } }
  | { arete: { tx: number; ty: number; dir: 'N' | 'E' | 'S' | 'O'; couleur: number } }
  | { contour: { tx: number; ty: number; couleur: number } }

export class AtelierScene extends Phaser.Scene {
  private view!: SnapshotView
  private dyn!: DynamicLighting
  private avatar!: Phaser.GameObjects.Image
  private fond?: Phaser.GameObjects.Rectangle
  private grilleG?: Phaser.GameObjects.Graphics
  private fantomeImg!: Phaser.GameObjects.Image
  private fantomeG!: Phaser.GameObjects.Graphics
  private courant: SnapshotMessage | null = null
  private avatarPos = { x: 0, y: 0 }
  /** L'heure de l'éclairage (le curseur du panneau) — le soleil du jeu suit, chaque frame. */
  heure = 12
  /** La grille d'édition (demande d'Alexis) — un trait par tuile, par-dessus le rendu. */
  grilleVisible = true
  /** Le clic remonté au panneau, en TUILES de la carte d'essai (fraction comprise) —
   *  `droit` : le bouton droit, la GOMME rapide. */
  surClic: ((fx: number, fy: number, droit: boolean) => void) | null = null
  /** Le survol remonté au panneau — c'est lui qui décide du fantôme (`majFantome`). */
  surSurvol: ((fx: number, fy: number) => void) | null = null
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
    this.fantomeImg = this.add.image(0, 0, '__WHITE').setVisible(false).setDepth(FANTOME_DEPTH)
    this.fantomeG = this.add.graphics().setDepth(FANTOME_DEPTH)
    this.input.mouse?.disableContextMenu() //  le clic droit est la gomme, pas un menu
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.surClic?.(p.worldX / TILE_PX, p.worldY / TILE_PX, p.rightButtonDown())
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.surSurvol?.(p.worldX / TILE_PX, p.worldY / TILE_PX)
    })
    this.pret = true
  }

  /**
   * LE FANTÔME (demande d'Alexis) — ce que le geste FERAIT, avant de cliquer : la pièce
   * translucide pour la peinture (le patron du fantôme du marteau), un liseré coloré sur
   * l'arête visée pour brèche/seuil/passage, un contour pour la gomme. Une seule vérité :
   * le panneau DÉCIDE (il connaît l'outil et la légende), la scène ne fait que montrer.
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
      const { tx, ty, dir, couleur } = spec.arete
      const e = 3 / this.cameras.main.zoom
      this.fantomeG.fillStyle(couleur, 0.9)
      if (dir === 'N') this.fantomeG.fillRect(tx * T, ty * T - e / 2, T, e)
      else if (dir === 'S') this.fantomeG.fillRect(tx * T, (ty + 1) * T - e / 2, T, e)
      else if (dir === 'O') this.fantomeG.fillRect(tx * T - e / 2, ty * T, e, T)
      else this.fantomeG.fillRect((tx + 1) * T - e / 2, ty * T, e, T)
    } else {
      const { tx, ty, couleur } = spec.contour
      this.fantomeG.lineStyle(2 / this.cameras.main.zoom, couleur, 0.95).strokeRect(tx * T + 0.5, ty * T + 0.5, T - 1, T - 1)
    }
  }

  /** MONTRER l'état d'aperçu : un snapshot synthétique COMPLET, appliqué au vrai renderer. */
  montrer(sim: SimState, playerId: number): void {
    const moi = sim.entities.find((e) => e.id === playerId)
    this.avatarPos = moi ? { x: moi.x, y: moi.y } : { x: 0, y: 0 }
    const msg: SnapshotMessage = {
      type: 'snapshot',
      tick: sim.tick,
      lastProcessedInput: 0,
      time: getGameTime(sim),
      entities: sim.entities,
      structures: sim.structures,
      villages: sim.villages,
      functions: [],
      nodeDeltas: [],
      npcs: [],
      monsters: [],
      corpses: [],
      reveils: [],
      refugeeGroups: [],
      blood: [],
      wind: { x: 1, y: 0 },
      groundItems: [],
      events: [],
    }
    this.courant = msg
    const cote = sim.map.width * TILE_PX
    // L'herbe d'essai, sous tout — un aplat à la teinte du jeu (le vrai sol est un système).
    this.fond ??= this.add.rectangle(0, 0, 1, 1, 0xa9cd93).setOrigin(0, 0).setDepth(-10)
    this.fond.setDisplaySize(cote, cote)
    this.view.setNodes(sim.nodes)
    this.view.apply(msg, playerId, this.time.now)
    const cam = this.cameras.main
    cam.centerOn(cote / 2, cote / 2)
    cam.setZoom(Math.max(2, Math.min(6, Math.floor(Math.min(this.scale.width, this.scale.height) / cote))))
    // LA GRILLE D'ÉDITION (demande d'Alexis) — un trait d'un pixel ÉCRAN par tuile,
    // au-dessus de tout : on vise une case même sous un toit plein.
    this.grilleG ??= this.add.graphics().setDepth(GRILLE_DEPTH)
    this.grilleG.clear()
    if (this.grilleVisible) {
      this.grilleG.lineStyle(1 / cam.zoom, 0x0c0f0a, 0.28)
      for (let i = 0; i <= sim.map.width; i++) {
        this.grilleG.lineBetween(i * TILE_PX, 0, i * TILE_PX, cote)
        this.grilleG.lineBetween(0, i * TILE_PX, cote, i * TILE_PX)
      }
    }
  }

  override update(time: number): void {
    if (!this.courant) return
    // Le soleil du jeu, à l'heure du curseur — c'est LUI qui fait vivre les `_lit`.
    this.dyn.update(true, this.cameras.main, this.courant.structures, this.courant.villages, this.heure, 1, time)
    this.view.renderNodes(this.cameras.main, this.avatarPos.x, this.avatarPos.y, time)
    this.view.syncActor(this.avatar, this.avatarPos.x, this.avatarPos.y, 'spr-player')
  }
}
