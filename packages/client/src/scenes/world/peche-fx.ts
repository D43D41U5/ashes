/**
 * LA LIGNE TENDUE — le rendu de la pêche (spec `peche.md` R1-R4).
 *
 * La sim ne connaît que des TICKS : le lancer (`castTick`), la touche (`biteAt`, puis
 * `windowEnd`), la prise / la fuite (événements). Tout ce qui bouge ici est du RENDU qui
 * écoute ces dates — la canne, le fil, le flotteur, le poisson qui sort — et rien n'est
 * décidé ici (invariant §3) : le client ne rapporte jamais un résultat.
 *
 * Quatre éléments, demandés par Alexis (2026-08-22) :
 *  - **le lancer de canne** : l'avatar tend la canne ; le flotteur part en ARC depuis la pointe
 *    jusqu'au coin, le fil se déroule derrière (R2) ;
 *  - **le fil à physique** : une corde de VERLET (N points, gravité, contraintes de distance,
 *    deux bouts épinglés — pointe de canne et flotteur). Lâche pendant l'attente (elle pend),
 *    TENDUE à la touche et au ferrage (R1). 100 % client : la sim n'a pas de fil ;
 *  - **le flotteur animé** : posé sur l'eau, il clapote d'un pixel ; à la touche il PLONGE
 *    franchement (quatre pixels, et des anneaux) — c'est le télégraphe, il doit se lire en un
 *    dixième de seconde (R3) ;
 *  - **le ferrage** : la canne se CAMBRE, le fil claque droit, le poisson (le sprite de
 *    l'espèce) sort en arc vers la main, la gerbe part à l'opposé de l'acteur (R4). Sur la
 *    fuite, le flotteur remonte mollement et la ligne rentre.
 *
 * RENDU EN ESPACE-MONDE (comme `fell-gauge`/`attack-fx`) : un Graphics à (0,0), coordonnées
 * px monde, la caméra applique scroll + zoom. Tout ce qui est posé l'est sur des PIXELS ENTIERS
 * (grille de l'art, jamais lissé — règle maison des FX) ; seule la corde, qui est une ligne,
 * se trace en continu.
 *
 * AUCUNE barre de progression pendant l'attente (interdit GDD l.402) : un flotteur, c'est tout.
 */
import type Phaser from 'phaser'
import { FISH_SPECIES, type ItemId, type ResourceNode } from '@ashes/sim'
import { OVERLAY_DEPTH, TILE_PX } from '../../render/framing'
import { itemIconKey } from '../../render/item-art'
import type { Warp } from '../../render/warp'

/** Une ligne tendue, lue du snapshot — position RENDUE (px monde) des pieds de celui qui pêche. */
export interface LigneRendue {
  entityId: number
  nodeId: number
  castTick: number
  biteAt: number
  windowEnd?: number
  /** Les pieds de l'avatar, en px monde (le sprite moins l'ancre du sol). */
  px: number
  py: number
}

type Phase = 'lancer' | 'attente' | 'touche' | 'ferrage' | 'fuite' | 'rentree'

interface Point {
  x: number
  y: number
  ox: number
  oy: number
}

interface Ligne {
  nodeId: number
  phase: Phase
  /** Début de la phase courante (ms, horloge Phaser). */
  t0: number
  /** La main et le coin, mis à jour chaque frame tant que la ligne est dans le snapshot. */
  handX: number
  handY: number
  /** Côté où l'on pêche : +1 le coin est à droite de l'avatar, −1 à gauche. */
  side: 1 | -1
  cibleX: number
  cibleY: number
  /** D'où le flotteur est parti (le lancer part de la pointe de la canne à cet instant). */
  departX: number
  departY: number
  /** La corde. */
  points: Point[]
  /** Le flotteur, en px monde (posé sur des pixels entiers au dessin). */
  flotX: number
  flotY: number
  /** Les anneaux sur l'eau : date de naissance de chacun (≤ 3 vivants). */
  anneaux: number[]
  /** Les gouttes de la gerbe (ferrage) — vitesse en px/s, nées à `t0` du ferrage. */
  gouttes: { x: number; y: number; vx: number; vy: number }[]
  /** Le poisson qui sort (ferrage) : le sprite de l'espèce, ou null. */
  poisson: Phaser.GameObjects.Image | null
}

// ── Les nombres du rendu (px MONDE, ms). Un rendu se règle à l'œil, pas en jouant. ──
const CANNE_PX = 15
const MAIN_HAUTEUR_PX = 9
/** Le lancer : durée du vol du flotteur et de la bascule de la canne. */
const LANCER_MS = 380
/** L'arc du lancer culmine à cette hauteur au-dessus de la corde départ→cible. */
const LANCER_ARC_PX = 12
/** Le ferrage : cambrure + sortie du poisson. */
const FERRAGE_MS = 460
/** La fuite et la rentrée : le fil revient à la pointe. */
const RENTREE_MS = 260
/** La plongée du flotteur à la touche, en px (franche — un télégraphe, pas une oscillation). */
const PLONGEE_PX = 4
/** Le clapot d'attente : ±1 px, à cette période. */
const CLAPOT_MS = 900
/** La corde : points, gravité (px/s²), amortissement, itérations de contrainte, mou à l'attente. */
const CORDE_N = 12
const CORDE_G = 240
const CORDE_AMORTI = 0.985
const CORDE_ITER = 6
const CORDE_MOU = 1.08
/** La corde s'intègre à PAS FIXE (1/60 s), autant de fois que la frame l'exige (plafonné) : le
 *  même fil à 144 Hz, à 30 Hz et sous un rAF bridé — la physique ne dépend pas du framerate. */
const CORDE_PAS_S = 1 / 60
const CORDE_PAS_MAX = 60
/** Les anneaux : rayon max et durée. Rayon QUANTIFIÉ au pixel au dessin. */
const ANNEAU_PX = 6
const ANNEAU_MS = 520
const GOUTTES_N = 6
const GOUTTES_MS = 420

const BOIS = 0x6a4c2c
const BOIS_CLAIR = 0x8d6b40
const FIL = 0xe9e7da
const FLOTTEUR_HAUT = 0xc23b2e
const FLOTTEUR_BAS = 0xf0ece0
const FLOTTEUR_PLONGE = 0x7a2a22
const EAU_CLAIR = 0xe9e7da

export class PecheFx {
  private readonly g: Phaser.GameObjects.Graphics
  private readonly lignes = new Map<number, Ligne>()

  constructor(private readonly scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(OVERLAY_DEPTH - 12)
  }

  // ── Les trois faits de domaine (WorldScene les relaie depuis `processEvents`) ──

  /** La touche : le flotteur plonge, le fil se tend (R3). */
  bite(entityId: number, now: number): void {
    const l = this.lignes.get(entityId)
    if (!l) return
    l.phase = 'touche'
    l.t0 = now
    l.anneaux.push(now)
  }

  /** La prise : cambrure, poisson qui sort, gerbe à l'opposé de l'acteur (R4). */
  caught(entityId: number, item: ItemId, now: number): void {
    const l = this.lignes.get(entityId)
    if (!l) return
    l.phase = 'ferrage'
    l.t0 = now
    l.anneaux.push(now)
    // LA GERBE PART À L'OPPOSÉ de l'acteur (règle maison) : vers l'actor, elle se tasserait sur
    // son sprite. Elle s'éparpille depuis le flotteur, dans le demi-plan qui lui tourne le dos.
    const ax = l.flotX - l.handX
    const ay = l.flotY - l.handY
    const n = Math.max(1, Math.sqrt(ax * ax + ay * ay))
    const ux = ax / n
    const uy = ay / n
    l.gouttes = []
    for (let i = 0; i < GOUTTES_N; i++) {
      const e = (i - (GOUTTES_N - 1) / 2) / GOUTTES_N // éventail
      const vx = (ux + -uy * e * 1.4) * (38 + 16 * ((i * 7) % 3))
      const vy = (uy + ux * e * 1.4) * (38 + 16 * ((i * 7) % 3)) - 42 // et ça saute
      l.gouttes.push({ x: l.flotX, y: l.flotY, vx, vy })
    }
    const sp = FISH_SPECIES.find((s) => s.item === item)
    if (sp && this.scene.textures.exists(itemIconKey(sp.item))) {
      l.poisson?.destroy()
      l.poisson = this.scene.add.image(l.flotX, l.flotY, itemIconKey(sp.item)).setDepth(OVERLAY_DEPTH - 11)
    }
  }

  /** La fuite : le flotteur remonte mollement, la ligne rentre (R4). */
  escaped(entityId: number, now: number): void {
    const l = this.lignes.get(entityId)
    if (!l) return
    l.phase = 'fuite'
    l.t0 = now
    l.anneaux.push(now)
  }

  /** Chaque frame. `lignes` = ce que le snapshot dit ; ce qui en a disparu sans fait finit en `rentree`. */
  update(lignes: readonly LigneRendue[], nodes: readonly ResourceNode[], now: number, dtMs: number, warp: Warp | undefined): void {
    const dt = Math.min(CORDE_PAS_S * CORDE_PAS_MAX, dtMs / 1000)
    const vues = new Set<number>()
    for (const lr of lignes) {
      vues.add(lr.entityId)
      const node = nodes.find((n) => n.id === lr.nodeId)
      if (!node) continue
      const cibleX = (node.tx + 0.5) * TILE_PX
      const cibleY = (node.ty + 0.5) * TILE_PX - (warp?.lift(node.tx + 0.5, node.ty + 0.5) ?? 0)
      let l = this.lignes.get(lr.entityId)
      if (!l) {
        const side: 1 | -1 = cibleX >= lr.px ? 1 : -1
        l = {
          nodeId: lr.nodeId,
          phase: 'lancer',
          t0: now,
          handX: lr.px + side * 3,
          handY: lr.py - MAIN_HAUTEUR_PX,
          side,
          cibleX,
          cibleY,
          departX: 0,
          departY: 0,
          points: [],
          flotX: 0,
          flotY: 0,
          anneaux: [],
          gouttes: [],
          poisson: null,
        }
        const tip = this.pointe(l, now)
        l.departX = tip.x
        l.departY = tip.y
        l.flotX = tip.x
        l.flotY = tip.y
        for (let i = 0; i < CORDE_N + 1; i++) l.points.push({ x: tip.x, y: tip.y, ox: tip.x, oy: tip.y })
        this.lignes.set(lr.entityId, l)
      } else if (l.phase !== 'ferrage' && l.phase !== 'fuite' && l.phase !== 'rentree') {
        l.handX = lr.px + l.side * 3
        l.handY = lr.py - MAIN_HAUTEUR_PX
        l.cibleX = cibleX
        l.cibleY = cibleY
        if (l.phase === 'lancer' && now - l.t0 >= LANCER_MS) {
          l.phase = 'attente'
          l.t0 = now
          l.anneaux.push(now) // le flotteur touche l'eau
        }
        // Le snapshot a posé la fenêtre avant que l'événement n'arrive (même message) : on suit.
        if (l.phase === 'attente' && lr.windowEnd !== undefined) this.bite(lr.entityId, now)
      }
    }
    // Disparue du snapshot sans fait de domaine (ligne rentrée avant la touche, un pas, la mort) :
    // la corde revient à la pointe. Les phases terminales (ferrage/fuite) jouent leur durée.
    for (const [id, l] of this.lignes) {
      if (vues.has(id)) continue
      if (l.phase === 'lancer' || l.phase === 'attente' || l.phase === 'touche') {
        l.phase = 'rentree'
        l.t0 = now
      }
    }

    this.g.clear()
    for (const [id, l] of this.lignes) {
      const age = now - l.t0
      const fini =
        (l.phase === 'ferrage' && age >= FERRAGE_MS) ||
        (l.phase === 'fuite' && age >= RENTREE_MS + 120) ||
        (l.phase === 'rentree' && age >= RENTREE_MS)
      if (fini) {
        l.poisson?.destroy()
        this.lignes.delete(id)
        continue
      }
      this.poserLeFlotteur(l, now)
      this.simulerLaCorde(l, now, dt)
      this.dessiner(l, now, dt)
    }
  }

  /** La pointe de la canne, selon la phase : bascule au lancer, cambrure au ferrage. */
  private pointe(l: Ligne, now: number): { x: number; y: number } {
    const age = now - l.t0
    // L'angle de la canne, mesuré depuis l'horizontale côté eau (0 = vers l'eau, +π/2 = en l'air).
    // Repos (attente) : 35° au-dessus de l'horizontale ; avant le lancer : 110° (en arrière,
    // au-dessus de l'épaule) ; le lancer BALAIE de 110° à 35° sur LANCER_MS — une pente
    // continue (la moitié du temps pour la moitié de l'angle, quadratique : vite au départ).
    const repos = 0.61
    let a = repos
    let cambrure = 0
    if (l.phase === 'lancer') {
      const p = Math.min(1, age / LANCER_MS)
      a = 1.92 - (1.92 - repos) * (1 - (1 - p) * (1 - p))
    } else if (l.phase === 'touche') {
      a = repos - 0.12 // la pointe s'incline d'un rien : la ligne tire
    } else if (l.phase === 'ferrage') {
      // LA CAMBRURE : la pointe PLIE vers l'eau puis revient — un triangle, pas un sinus.
      const p = Math.min(1, age / FERRAGE_MS)
      cambrure = p < 0.35 ? p / 0.35 : 1 - (p - 0.35) / 0.65
      a = repos + 0.55 * cambrure // le manche se REDRESSE quand on ferre…
    }
    const x = l.handX + l.side * Math.cos(a) * CANNE_PX
    const y = l.handY - Math.sin(a) * CANNE_PX + cambrure * 6 // …et la pointe ploie
    return { x, y }
  }

  /** Le flotteur : vol du lancer, clapot, plongée, retour. */
  private poserLeFlotteur(l: Ligne, now: number): void {
    const age = now - l.t0
    switch (l.phase) {
      case 'lancer': {
        const p = Math.min(1, age / LANCER_MS)
        l.flotX = l.departX + (l.cibleX - l.departX) * p
        // Une parabole : 4·h·p·(1−p) culmine à h au milieu.
        l.flotY = l.departY + (l.cibleY - l.departY) * p - 4 * LANCER_ARC_PX * p * (1 - p)
        return
      }
      case 'attente': {
        // ±1 px, une onde triangulaire (pas de sinus lissé : c'est un pixel qui monte et descend).
        const ph = (now % CLAPOT_MS) / CLAPOT_MS
        const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2
        l.flotX = l.cibleX
        l.flotY = l.cibleY + Math.round(tri * 2 - 1)
        return
      }
      case 'touche':
        l.flotX = l.cibleX
        l.flotY = l.cibleY + PLONGEE_PX
        return
      case 'ferrage': {
        // Le flotteur ET le poisson remontent vers la main, en arc.
        const p = Math.min(1, age / FERRAGE_MS)
        const x = l.cibleX + (l.handX - l.cibleX) * p
        const y = l.cibleY + (l.handY - l.cibleY) * p - 4 * (LANCER_ARC_PX + 6) * p * (1 - p)
        l.flotX = x
        l.flotY = y
        if (l.poisson) {
          l.poisson.setPosition(Math.round(x), Math.round(y + 3))
          l.poisson.setAlpha(p < 0.85 ? 1 : 1 - (p - 0.85) / 0.15)
          // LE POISSON SE DÉBAT : un flip franc toutes les 70 ms, pas une rotation.
          l.poisson.setFlipX(Math.floor(age / 70) % 2 === 1)
          l.poisson.setFlipY(l.handX < l.cibleX)
        }
        return
      }
      case 'fuite': {
        // Remonte mollement de la plongée (120 ms), puis la ligne rentre.
        if (age < 120) {
          l.flotX = l.cibleX
          l.flotY = l.cibleY + PLONGEE_PX - Math.round((age / 120) * PLONGEE_PX)
          return
        }
        const p = Math.min(1, (age - 120) / RENTREE_MS)
        const tip = this.pointe(l, now)
        l.flotX = l.cibleX + (tip.x - l.cibleX) * p
        l.flotY = l.cibleY + (tip.y - l.cibleY) * p - 4 * 4 * p * (1 - p)
        return
      }
      case 'rentree': {
        const p = Math.min(1, age / RENTREE_MS)
        const tip = this.pointe(l, now)
        l.flotX = l.flotX + (tip.x - l.flotX) * Math.min(1, p * 1.6)
        l.flotY = l.flotY + (tip.y - l.flotY) * Math.min(1, p * 1.6)
        return
      }
    }
  }

  /** LA CORDE DE VERLET : gravité, amortissement, contraintes de distance, deux bouts épinglés. */
  private simulerLaCorde(l: Ligne, now: number, dtFrame: number): void {
    const tip = this.pointe(l, now)
    // PENDANT LE LANCER, le fil SE DÉROULE derrière le flotteur : on pose les points le long de
    // la ligne pointe→flotteur, avec un creux qui pend. Sans ça, tous les points naîtraient au
    // même endroit — et deux points confondus n'ont pas de segment à contraindre (d = 0, ignoré) :
    // la corde restait un paquet collé là où la pointe était au départ. Verlet prend le relais
    // dès l'attente, avec ces positions pour état initial (vitesse nulle : ox = x).
    if (l.phase === 'lancer') {
      const n = l.points.length - 1
      for (let i = 0; i <= n; i++) {
        const t = i / n
        const p = l.points[i]!
        p.x = tip.x + (l.flotX - tip.x) * t
        p.y = tip.y + (l.flotY - tip.y) * t + 4 * 3 * t * (1 - t)
        p.ox = p.x
        p.oy = p.y
      }
      return
    }
    const pas = Math.min(CORDE_PAS_MAX, Math.max(1, Math.round(dtFrame / CORDE_PAS_S)))
    for (let k = 0; k < pas; k++) this.pasDeCorde(l, tip, CORDE_PAS_S)
  }

  private pasDeCorde(l: Ligne, tip: { x: number; y: number }, dt: number): void {
    const pts = l.points
    const n = pts.length - 1
    // Intégration (Verlet) — sauf les deux bouts, épinglés après.
    for (let i = 1; i < n; i++) {
      const p = pts[i]!
      const vx = (p.x - p.ox) * CORDE_AMORTI
      const vy = (p.y - p.oy) * CORDE_AMORTI
      p.ox = p.x
      p.oy = p.y
      p.x += vx
      p.y += vy + CORDE_G * dt * dt
    }
    pts[0]!.x = tip.x
    pts[0]!.y = tip.y
    pts[n]!.x = l.flotX
    pts[n]!.y = l.flotY
    // La longueur de repos : TENDUE (la distance exacte) à la touche et au ferrage, LÂCHE
    // (un peu plus — la corde pend) pendant l'attente et le lancer.
    const dx = l.flotX - tip.x
    const dy = l.flotY - tip.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const tendue = l.phase === 'touche' || l.phase === 'ferrage'
    const repos = (dist / n) * (tendue ? 1 : CORDE_MOU)
    for (let it = 0; it < CORDE_ITER; it++) {
      for (let i = 0; i < n; i++) {
        const a = pts[i]!
        const b = pts[i + 1]!
        const ex = b.x - a.x
        const ey = b.y - a.y
        const d = Math.sqrt(ex * ex + ey * ey)
        if (d < 1e-6) continue
        const corr = ((d - repos) / d) * 0.5
        const cx = ex * corr
        const cy = ey * corr
        if (i !== 0) {
          a.x += cx
          a.y += cy
        }
        if (i + 1 !== n) {
          b.x -= cx
          b.y -= cy
        }
      }
      pts[0]!.x = tip.x
      pts[0]!.y = tip.y
      pts[n]!.x = l.flotX
      pts[n]!.y = l.flotY
    }
  }

  private dessiner(l: Ligne, now: number, dt: number): void {
    const g = this.g
    const tip = this.pointe(l, now)
    // LA CANNE : un trait de bois de la main à la pointe, 2 px, et sa face claire.
    g.lineStyle(2, BOIS, 1)
    g.beginPath()
    g.moveTo(Math.round(l.handX), Math.round(l.handY))
    g.lineTo(Math.round(tip.x), Math.round(tip.y))
    g.strokePath()
    g.lineStyle(1, BOIS_CLAIR, 0.9)
    g.beginPath()
    g.moveTo(Math.round(l.handX), Math.round(l.handY) - 1)
    g.lineTo(Math.round(tip.x), Math.round(tip.y) - 1)
    g.strokePath()
    // LE FIL : la corde, en continu (c'est une ligne, pas un objet).
    g.lineStyle(1, FIL, 0.85)
    g.beginPath()
    g.moveTo(l.points[0]!.x, l.points[0]!.y)
    for (let i = 1; i < l.points.length; i++) g.lineTo(l.points[i]!.x, l.points[i]!.y)
    g.strokePath()
    // LES ANNEAUX sur l'eau : rayon QUANTIFIÉ au pixel, alpha qui tombe — jamais lissés.
    l.anneaux = l.anneaux.filter((t) => now - t < ANNEAU_MS)
    for (const t of l.anneaux) {
      const p = (now - t) / ANNEAU_MS
      const r = Math.max(1, Math.round(p * ANNEAU_PX))
      g.lineStyle(1, EAU_CLAIR, 0.7 * (1 - p))
      g.strokeEllipse(Math.round(l.cibleX), Math.round(l.cibleY), r * 2, r)
    }
    // LE FLOTTEUR : 3×4 px, rouge dessus, clair dessous ; sombre quand il est sous l'eau.
    if (l.phase !== 'rentree' || now - l.t0 < RENTREE_MS * 0.6) {
      const fx = Math.round(l.flotX) - 1
      const fy = Math.round(l.flotY) - 2
      const plonge = l.phase === 'touche'
      g.fillStyle(plonge ? FLOTTEUR_PLONGE : FLOTTEUR_HAUT, 1).fillRect(fx, fy, 3, 2)
      g.fillStyle(plonge ? 0xb8b0a0 : FLOTTEUR_BAS, 1).fillRect(fx, fy + 2, 3, 2)
    }
    // LA GERBE (ferrage) : des gouttes d'un pixel, balistiques, qui s'éteignent.
    if (l.gouttes.length > 0) {
      const age = now - l.t0
      const alive = age < GOUTTES_MS
      for (const d of l.gouttes) {
        d.x += d.vx * dt
        d.y += d.vy * dt
        d.vy += 160 * dt
        if (alive) g.fillStyle(EAU_CLAIR, 0.9 * (1 - age / GOUTTES_MS)).fillRect(Math.round(d.x), Math.round(d.y), 1, 1)
      }
      if (!alive) l.gouttes = []
    }
  }

  /** Combien de lignes ont quelque chose à peindre, cette frame — la sonde du smoke `peche`. */
  lignesEnCours(): number {
    return this.lignes.size
  }

  /** La phase rendue de la ligne de cette entité (`null` si rien) — la sonde du smoke `peche`. */
  phaseDe(entityId: number): Phase | null {
    return this.lignes.get(entityId)?.phase ?? null
  }

  destroy(): void {
    for (const l of this.lignes.values()) l.poisson?.destroy()
    this.lignes.clear()
    this.g.destroy()
  }
}
