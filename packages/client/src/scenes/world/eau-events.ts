/**
 * LES ÉVÉNEMENTS DE L'EAU (spec eau-vivante R3, R7) — entrer dans l'eau est un ÉVÉNEMENT,
 * en sortir laisse une TRACE.
 *
 * Le franchissement se détecte sur la position INTERPOLÉE avec HYSTÉRÉSIS (bascule à
 * ±0,2 tuile de pénétration) : le jitter des snapshots 20 Hz ne double jamais une gerbe.
 * À l'entrée : la gerbe surjouée (fx-plouf, 5 frames à ~12 im/s) + le son. À la sortie :
 * la semelle reste humide ~3,5 s — des EMPREINTES sombres (le sol, palier −1) se tamponnent
 * tous les ~9 px de marche, alternées gauche/droite, et sèchent par paliers d'alpha.
 *
 * Les ploufs et les traces sont pilotés EN NIVEAU (âge ≥ seuil dans update, jamais un
 * delayedCall sur front — l'horloge headless saute et enjambe les fronts, règle maison).
 */
import Phaser from 'phaser'
import { corpseDepth, TILE_PX } from '../../render/framing'

/**
 * ═══ LES EMPREINTES DANS LA NEIGE (demande d'Alexis, 2026-08-22) ═══
 *
 * Le même tampon que la semelle humide — un pas tous les `PAS_PX`, alternés gauche/droite,
 * pilotés en niveau — mais une autre MATIÈRE et une autre MÉMOIRE :
 *   • sur une tuile sous la neige (`neigeAt`, la signature du manteau), chaque pas CREUSE
 *     (`fx-empreinte-neige` : un bord haut sombre, un fond bleuté, une arête basse claire — la
 *     grammaire du pavé, en négatif) ; pas de plafond de pas par sortie, la neige ne sèche pas ;
 *   • la trace TIENT : `VIE_NEIGE_MS` sans chute (un long cooldown — assez pour suivre une piste),
 *     `VIE_NEIGE_CHUTE_MS` quand il neige (`neigeQuiTombe`, posé chaque image par WorldScene :
 *     la chute recouvre). La durée se relit à chaque image : une chute qui commence efface vite
 *     ce qui était là, une chute qui cesse laisse tenir ce qui reste.
 * Les traces sont CLIENT : un poursuivant ne voit que ce qui s'est posé dans son écran.
 */
/** La vie d'une empreinte dans la neige, ciel sec (ms). */
const VIE_NEIGE_MS = 120_000
/** … et quand il neige : la chute la recouvre. */
const VIE_NEIGE_CHUTE_MS = 6_000
/** Plafond de traces de neige à l'écran — une longue piste (512 pas ≈ 290 tuiles). */
const MAX_TRACES_NEIGE = 512

/** Pénétration (tuiles) qui bascule l'état dans-l'eau / hors-de-l'eau. */
const HYSTERESIS = 0.2
/** La semelle reste humide (ms) après la sortie. */
const SEMELLE_HUMIDE_MS = 3500
/** Un pas mouillé tous les N px de marche. */
const PAS_PX = 9
/** Plafond de pas par sortie d'eau (revue : sans lui, la piste courait ~14 tuiles à pleine
 *  vitesse — l'artefact validé promettait 2-3 ; huit pas ≈ 4-5 tuiles, la molette est là). */
const PAS_MAX = 8
/** Plafond de traces à l'écran — au-delà, la plus vieille sèche d'un coup. */
const MAX_TRACES = 64

interface EtatEau {
  dansLEau: boolean
  wetUntil: number
  sx: number
  sy: number
  pied: number // l'alternance gauche/droite
  pasRestants: number // le plafond de pas par sortie (la semelle n'a qu'une eau à rendre)
}

export class EauEvents {
  private readonly etats = new WeakMap<Phaser.GameObjects.Image, EtatEau>()
  private readonly ploufs: { img: Phaser.GameObjects.Image; bornAt: number }[] = []
  private readonly traces: { img: Phaser.GameObjects.Image; bornAt: number }[] = []
  private readonly tracesNeige: { img: Phaser.GameObjects.Image; bornAt: number }[] = []
  /** Le sprite du joueur — ses événements sonnent plus fort (posé par WorldScene). */
  joueur: Phaser.GameObjects.Image | null = null
  /** La tuile est-elle sous la neige ? Posé par WorldScene sur la couche du gel. */
  neigeAt: ((tx: number, ty: number) => boolean) | null = null
  /** Il neige ici (au joueur) : les traces se recouvrent vite. Posé chaque image par WorldScene. */
  neigeQuiTombe = false

  constructor(
    private readonly scene: Phaser.Scene,
    /** Le son de la gerbe — branché sur SonsDeLEau par WorldScene. */
    private readonly onSplash?: (moi: boolean) => void,
  ) {}

  /** Appelé par `syncActor` pour CHAQUE acteur, chaque frame, avec sa distance de rive.
   *  `largeur` : l'emprise affichée de l'acteur — la gerbe se met à SON échelle (revue :
   *  une gerbe unique faisait 1,5× le lapin et 0,5× le cerf). */
  track(
    sprite: Phaser.GameObjects.Image,
    px: number,
    py: number,
    depth: number,
    dRive: number,
    now: number,
    largeur = 16,
  ): void {
    let e = this.etats.get(sprite)
    if (!e) {
      e = { dansLEau: dRive > HYSTERESIS, wetUntil: 0, sx: px, sy: py, pied: 0, pasRestants: 0 }
      this.etats.set(sprite, e)
      return // le premier passage POSE l'état — jamais de gerbe au spawn/téléport initial
    }
    if (!e.dansLEau && dRive > HYSTERESIS) {
      e.dansLEau = true
      this.plouf(px, py, depth, now, largeur)
      this.onSplash?.(sprite === this.joueur)
    } else if (e.dansLEau && dRive < -HYSTERESIS) {
      e.dansLEau = false
      e.wetUntil = now + SEMELLE_HUMIDE_MS
      e.pasRestants = PAS_MAX
      e.sx = px
      e.sy = py
    }
    // LES PAS DANS LA NEIGE : sur une tuile enneigée, chaque pas creuse — sans plafond ni séchage.
    const surNeige = dRive < 0 && this.neigeAt !== null && this.neigeAt(Math.floor(px / TILE_PX), Math.floor(py / TILE_PX))
    // LES PAS MOUILLÉS : sur terre, semelle humide → une empreinte tous les ~9 px de marche.
    const semelleHumide = dRive < 0 && now < e.wetUntil && e.pasRestants > 0
    if (surNeige || semelleHumide) {
      const dx = px - e.sx
      const dy = py - e.sy
      if (dx * dx + dy * dy >= PAS_PX * PAS_PX) {
        e.sx = px
        e.sy = py
        e.pied = 1 - e.pied
        if (surNeige) this.traceNeige(px + (e.pied === 0 ? -2 : 2), py, now)
        else {
          e.pasRestants--
          this.trace(px + (e.pied === 0 ? -2 : 2), py, now)
        }
      }
    } else {
      // Hors neige et semelle sèche : le compteur de marche suit l'acteur, pour qu'un premier
      // pas dans la neige ne tamponne pas à une position d'il y a dix tuiles.
      e.sx = px
      e.sy = py
    }
  }

  private plouf(px: number, py: number, depth: number, now: number, largeur: number): void {
    const echelle = Math.max(0.8, Math.min(2, largeur / 16))
    const img = this.scene.add
      .image(px, py - 1, 'fx-plouf-0')
      .setOrigin(0.5, 1)
      .setDisplaySize(28 * echelle, 24 * echelle)
      .setDepth(depth + 0.02)
    this.ploufs.push({ img, bornAt: now })
  }

  private trace(px: number, py: number, now: number): void {
    if (this.traces.length >= MAX_TRACES) {
      this.traces.shift()?.img.destroy()
    }
    const img = this.scene.add
      .image(Math.round(px), Math.round(py), 'fx-empreinte')
      .setOrigin(0.5, 1)
      .setAlpha(0.5)
      .setDepth(corpseDepth(py / TILE_PX, TILE_PX) - 1)
    this.traces.push({ img, bornAt: now })
  }

  private traceNeige(px: number, py: number, now: number): void {
    if (this.tracesNeige.length >= MAX_TRACES_NEIGE) {
      this.tracesNeige.shift()?.img.destroy()
    }
    const img = this.scene.add
      .image(Math.round(px), Math.round(py), 'fx-empreinte-neige')
      .setOrigin(0.5, 1)
      .setAlpha(1)
      .setDepth(corpseDepth(py / TILE_PX, TILE_PX) - 1)
    this.tracesNeige.push({ img, bornAt: now })
  }

  /** Chaque frame : la gerbe avance ses frames (12 im/s), les traces sèchent par paliers. */
  update(now: number): void {
    // Les empreintes dans la neige : la vie se relit à chaque image (il neige, ou pas).
    const vieNeige = this.neigeQuiTombe ? VIE_NEIGE_CHUTE_MS : VIE_NEIGE_MS
    for (let i = this.tracesNeige.length - 1; i >= 0; i--) {
      const tr = this.tracesNeige[i]!
      const age = now - tr.bornAt
      if (age >= vieNeige) {
        tr.img.destroy()
        this.tracesNeige.splice(i, 1)
        continue
      }
      // Quatre paliers : la trace se comble, jamais un fondu lissé.
      tr.img.setAlpha(1 - Math.floor((4 * age) / vieNeige) / 4)
    }
    for (let i = this.ploufs.length - 1; i >= 0; i--) {
      const p = this.ploufs[i]!
      const frame = Math.floor((now - p.bornAt) / 85)
      if (frame >= 5) {
        p.img.destroy()
        this.ploufs.splice(i, 1)
        continue
      }
      p.img.setTexture(`fx-plouf-${frame}`)
    }
    for (let i = this.traces.length - 1; i >= 0; i--) {
      const tr = this.traces[i]!
      const age = now - tr.bornAt
      if (age >= 3500) {
        tr.img.destroy()
        this.traces.splice(i, 1)
        continue
      }
      // Trois paliers de séchage — jamais un fondu lissé.
      tr.img.setAlpha(0.5 * (1 - Math.floor(age / 1170) / 3))
    }
  }

  /** Sondes du smoke (spec A6) : combien de gerbes et de traces vivent. */
  get ploufsVivants(): number {
    return this.ploufs.length
  }
  get tracesVivantes(): number {
    return this.traces.length
  }
  get tracesNeigeVivantes(): number {
    return this.tracesNeige.length
  }

  destroy(): void {
    for (const p of this.ploufs) p.img.destroy()
    for (const tr of this.traces) tr.img.destroy()
    for (const tr of this.tracesNeige) tr.img.destroy()
    this.ploufs.length = 0
    this.traces.length = 0
    this.tracesNeige.length = 0
  }
}
