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
  /** Le sprite du joueur — ses événements sonnent plus fort (posé par WorldScene). */
  joueur: Phaser.GameObjects.Image | null = null

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
    // LES PAS MOUILLÉS : sur terre, semelle humide → une empreinte tous les ~9 px de marche.
    if (dRive < 0 && now < e.wetUntil && e.pasRestants > 0) {
      const dx = px - e.sx
      const dy = py - e.sy
      if (dx * dx + dy * dy >= PAS_PX * PAS_PX) {
        e.sx = px
        e.sy = py
        e.pied = 1 - e.pied
        e.pasRestants--
        this.trace(px + (e.pied === 0 ? -2 : 2), py, now)
      }
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

  /** Chaque frame : la gerbe avance ses frames (12 im/s), les traces sèchent par paliers. */
  update(now: number): void {
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

  destroy(): void {
    for (const p of this.ploufs) p.img.destroy()
    for (const tr of this.traces) tr.img.destroy()
    this.ploufs.length = 0
    this.traces.length = 0
  }
}
