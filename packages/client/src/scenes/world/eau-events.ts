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
import { ORIENTATIONS, posePas, poseTrainee } from '../../render/empreintes'
import { corpseDepth, TILE_PX } from '../../render/framing'

/**
 * ═══ LES EMPREINTES QUI TIENNENT — NEIGE (2026-08-22) ET CENDRE (2026-08-25) ═══
 *
 * Le même tampon que la semelle humide — un pas tous les `PAS_PX`, alternés gauche/droite,
 * pilotés en niveau — mais une autre MATIÈRE et une autre MÉMOIRE :
 *   • sur une tuile sous la neige (`neigeAt`, la signature du manteau), chaque pas CREUSE ; sur
 *     un sol de CENDRE (`cendreAt` — la cendre de pré SEULE : ni la cendre de bois, ni la forêt
 *     brûlée, demande d'Alexis), le pied enfonce la poudre et découvre le brûlé dessous ;
 *   • pas de plafond de pas par sortie, ni de séchage : ni la neige ni la cendre ne sèchent ;
 *   • la trace TIENT : `VIE_SOL_MS` sans chute (un long cooldown — assez pour suivre une piste),
 *     `VIE_SOL_CHUTE_MS` quand il neige (`neigeQuiTombe`, posé chaque image par WorldScene :
 *     la chute recouvre). La durée se relit à chaque image : une chute qui commence efface vite
 *     ce qui était là, une chute qui cesse laisse tenir ce qui reste.
 *
 * ⚠ **ET ELLE MEURT AVEC SON SOL.** Une empreinte est un creux DANS quelque chose : quand la
 * neige de la tuile fond (ou qu'une chute vient couvrir la cendre), le creux n'a plus de matière
 * où vivre et flottait au-dessus du sol nu jusqu'au bout de sa minute. Chaque trace retient donc
 * SA tuile et la relit toutes les `RELECTURE_MS` — la fonte est un fait du JOUR, pas de l’image.
 * `neigeAt` sait dire `null` : hors des chunks cuits, ON NE SAIT PAS — et une trace hors champ ne
 * doit pas mourir d'un silence (sans quoi tourner la caméra effacerait la piste qu'on suit).
 *
 * Les traces sont CLIENT : un poursuivant ne voit que ce qui s'est posé dans son écran.
 */
/** La vie d'une empreinte qui tient (neige, cendre), ciel sec (ms). */
const VIE_SOL_MS = 120_000
/** … et quand il neige : la chute la recouvre. */
const VIE_SOL_CHUTE_MS = 6_000
/** Plafond de traces tenantes à l'écran — une longue piste (512 pas ≈ 290 tuiles). */
const MAX_TRACES_SOL = 512
/** Tous les combien (ms) on redemande à chaque trace si son sol existe encore. La fonte est un
 *  fait du JOUR : la relire à 60 Hz coûterait 30 000 lectures par seconde pour la même réponse. */
const RELECTURE_MS = 500

/** Pénétration (tuiles) qui bascule l'état dans-l'eau / hors-de-l'eau. */
const HYSTERESIS = 0.2
/** La semelle reste humide (ms) après la sortie. */
const SEMELLE_HUMIDE_MS = 3500
/** Un pas mouillé tous les N px de marche. */
const PAS_PX = 9
/** … et LA TRAÎNÉE d'un rampant, tous les N px : trois fois plus serré que la foulée, pour que
 *  les marques se RECOUVRENT (elles font 6 px de long). C'est cet espacement, et lui seul, qui
 *  fait la différence entre une file d'empreintes et un sillon continu. */
const TRAINEE_PX = 3
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
  pied: 0 | 1 // l'alternance gauche/droite
  pasRestants: number // le plafond de pas par sortie (la semelle n'a qu'une eau à rendre)
}

/** Une trace qui TIENT : elle sait dans quoi elle est creusée, et où. */
interface TraceSol {
  img: Phaser.GameObjects.Image
  bornAt: number
  tx: number
  ty: number
  matiere: 'neige' | 'cendre'
}

export class EauEvents {
  private readonly etats = new WeakMap<Phaser.GameObjects.Image, EtatEau>()
  private readonly ploufs: { img: Phaser.GameObjects.Image; bornAt: number }[] = []
  private readonly traces: { img: Phaser.GameObjects.Image; bornAt: number }[] = []
  private tracesSol: TraceSol[] = []
  /** Quand le prochain balayage « mon sol existe-t-il encore ? » aura lieu (ms d'horloge scène). */
  private prochaineRelecture = 0
  /** L'état du toggle d'éclairage à la dernière image — les traces ne sont pas poolées : on ne
   *  réarme `setLighting` que quand il BOUGE (en DEV seulement ; en prod il ne bouge jamais). */
  private lightingApplique = true
  /** Le sprite du joueur — ses événements sonnent plus fort (posé par WorldScene). */
  joueur: Phaser.GameObjects.Image | null = null
  /** La tuile est-elle sous la neige ? `null` = on ne sait pas encore (chunk non cuit) — le
   *  silence n'est PAS une réponse : une trace hors champ ne meurt pas de lui. Posé par WorldScene. */
  neigeAt: ((tx: number, ty: number) => boolean | null) | null = null
  /** La tuile est-elle un sol de CENDRE (cendre de pré) ? Posé par WorldScene sur le sol dessiné. */
  cendreAt: ((tx: number, ty: number) => boolean) | null = null
  /** Il neige ici (au joueur) : les traces se recouvrent vite. Posé chaque image par WorldScene. */
  neigeQuiTombe = false
  /** L'éclairage dynamique est-il armé ? Les traces sont ÉCLAIRÉES comme le reste du monde :
   *  le voile d'ambiance passe SOUS la bande de tri (`AMBIENT_DEPTH_LIT` ≪ `corpseDepth`), donc
   *  sans `setLighting` une empreinte reste pleine couleur en pleine nuit — le décal fluorescent
   *  sur un monde éteint que le sang a déjà connu (constaté le 2026-08-16). */
  lighting = true

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
    /** CE CORPS RAMPE-T-IL ? (le Cendreux au sol, spec `cendreux.md` R26ter). Il ne laisse
     *  alors pas des pas mais une TRAÎNÉE — il n'a pas de pieds. */
    rampe = false,
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
    // LA MATIÈRE SOUS LE PIED, par ordre de préséance : la neige recouvre la cendre (spec
    // `cendre.md` : la cendre vit SOUS le manteau), et un creux prime toujours sur une tache.
    const aTerre = dRive < 0
    const tx = Math.floor(px / TILE_PX)
    const ty = Math.floor(py / TILE_PX)
    const surNeige = aTerre && this.neigeAt?.(tx, ty) === true
    const surCendre = aTerre && !surNeige && this.cendreAt?.(tx, ty) === true
    const semelleHumide = aTerre && !surNeige && !surCendre && now < e.wetUntil && e.pasRestants > 0
    if (surNeige || surCendre || semelleHumide) {
      const dx = px - e.sx
      const dy = py - e.sy
      // UN CORPS QUI RAMPE TRAÎNE — il ne marche pas (Alexis, 2026-08-25). Même matière, mêmes
      // marques, même mort avec son sol : c'est le PAS D'ÉCHANTILLONNAGE qui change (trois fois
      // plus serré, les marques se recouvrent) et la pose qui cesse d'alterner les pieds.
      //
      // ⚠ SUR LA NEIGE ET LA CENDRE SEULEMENT. La semelle humide compte ses pas (`pasRestants`,
      //   « la semelle n'a qu'une eau à rendre ») : la tamponner trois fois plus vite viderait
      //   son budget en un tiers de la distance, et raccourcirait la piste au lieu de la
      //   changer de nature. Un rampant sorti de l'eau laisse donc des marques de pas — c'est
      //   un défaut connu et borné, pas un oubli.
      const trainee = rampe && (surNeige || surCendre)
      const seuil = trainee ? TRAINEE_PX : PAS_PX
      if (dx * dx + dy * dy >= seuil * seuil) {
        e.sx = px
        e.sy = py
        if (trainee) {
          this.traceSol(poseTrainee(px, py, dx, dy), surNeige ? 'neige' : 'cendre', now)
        } else {
          e.pied = e.pied === 0 ? 1 : 0
          // LE PAS SE POSE DANS LE SENS DE LA MARCHE, et de son côté de la ligne (`empreintes.ts`) :
          // le vecteur de foulée EST le cap, mesuré, jamais nul (on ne vient qu'au-delà de PAS_PX).
          const pose = posePas(px, py, dx, dy, e.pied)
          if (surNeige) this.traceSol(pose, 'neige', now)
          else if (surCendre) this.traceSol(pose, 'cendre', now)
          else {
            e.pasRestants--
            this.traceHumide(pose, now)
          }
        }
      }
    } else {
      // Sol nu et semelle sèche : le compteur de marche suit l'acteur, pour qu'un premier
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

  /** Le décalque d'une empreinte, quelle que soit sa matière — au sol, orienté, éclairé. */
  private poser(cle: string, pose: { orient: number; px: number; py: number }, alpha: number): Phaser.GameObjects.Image {
    const img = this.scene.add
      .image(Math.round(pose.px), Math.round(pose.py), `${cle}-${pose.orient % ORIENTATIONS}`)
      .setOrigin(0.5, 0.5) // l'empreinte tourne autour d'ELLE-MÊME : son centre, pas ses « pieds »
      .setAlpha(alpha)
      .setDepth(corpseDepth(pose.py / TILE_PX, TILE_PX) - 1)
    img.setLighting(this.lighting)
    return img
  }

  private traceHumide(pose: { orient: number; px: number; py: number }, now: number): void {
    if (this.traces.length >= MAX_TRACES) {
      this.traces.shift()?.img.destroy()
    }
    this.traces.push({ img: this.poser('fx-pas-humide', pose, 0.5), bornAt: now })
  }

  private traceSol(pose: { orient: number; px: number; py: number }, matiere: 'neige' | 'cendre', now: number): void {
    if (this.tracesSol.length >= MAX_TRACES_SOL) {
      this.tracesSol.shift()?.img.destroy()
    }
    this.tracesSol.push({
      img: this.poser(`fx-pas-${matiere}`, pose, 1),
      bornAt: now,
      tx: Math.floor(pose.px / TILE_PX),
      ty: Math.floor(pose.py / TILE_PX),
      matiere,
    })
  }

  /** La tuile de cette trace porte-t-elle encore sa matière ? `null` = on ne sait pas (chunk non
   *  cuit) : le doute laisse vivre — sinon un panoramique effacerait la piste qu'on suivait. */
  private solTientEncore(tr: TraceSol): boolean | null {
    const neige = this.neigeAt?.(tr.tx, tr.ty) ?? null
    if (tr.matiere === 'neige') return neige
    // La cendre ne s'en va jamais — mais la neige la RECOUVRE, et le creux d'alors n'est plus le sien.
    if (neige === true) return false
    return this.cendreAt?.(tr.tx, tr.ty) ?? null
  }

  /** Chaque frame : la gerbe avance ses frames (12 im/s), les traces sèchent par paliers. */
  update(now: number): void {
    // LE TOGGLE D'ÉCLAIRAGE (DEV) : les traces ne sont pas poolées, on les réarme au changement.
    if (this.lighting !== this.lightingApplique) {
      this.lightingApplique = this.lighting
      for (const tr of this.tracesSol) tr.img.setLighting(this.lighting)
      for (const tr of this.traces) tr.img.setLighting(this.lighting)
    }
    // LES EMPREINTES QUI TIENNENT : la vie se relit à chaque image (il neige, ou pas)…
    const vieSol = this.neigeQuiTombe ? VIE_SOL_CHUTE_MS : VIE_SOL_MS
    // …et le SOL se relit en entier, mais RAREMENT (la fonte est un fait du jour, pas de l'image).
    const relire = now >= this.prochaineRelecture
    if (relire) this.prochaineRelecture = now + RELECTURE_MS
    for (let i = this.tracesSol.length - 1; i >= 0; i--) {
      const tr = this.tracesSol[i]!
      const age = now - tr.bornAt
      const morte = age >= vieSol || (relire && this.solTientEncore(tr) === false)
      if (morte) {
        tr.img.destroy()
        this.tracesSol.splice(i, 1)
        continue
      }
      // Quatre paliers : la trace se comble, jamais un fondu lissé.
      tr.img.setAlpha(1 - Math.floor((4 * age) / vieSol) / 4)
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
    return this.tracesSol.filter((t) => t.matiere === 'neige').length
  }
  get tracesCendreVivantes(): number {
    return this.tracesSol.filter((t) => t.matiere === 'cendre').length
  }

  /** Sonde du smoke : ce que chaque trace tenante MONTRE — sa matière, la variante bakée qu'elle
   *  porte (donc son cap), où elle est posée, et la tuile dont elle dépend. C'est cette liste
   *  qu'on interroge pour prouver qu'une piste tourne au lieu de défiler tout droit. */
  get sondeTracesSol(): { matiere: string; orient: number; x: number; y: number; tx: number; ty: number }[] {
    return this.tracesSol.map((t) => ({
      matiere: t.matiere,
      orient: Number(t.img.texture.key.slice(t.img.texture.key.lastIndexOf('-') + 1)),
      x: t.img.x,
      y: t.img.y,
      tx: t.tx,
      ty: t.ty,
    }))
  }

  destroy(): void {
    for (const p of this.ploufs) p.img.destroy()
    for (const tr of this.traces) tr.img.destroy()
    for (const tr of this.tracesSol) tr.img.destroy()
    this.ploufs.length = 0
    this.traces.length = 0
    this.tracesSol.length = 0
  }
}
