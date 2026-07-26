/**
 * LES POISSONS-OMBRES (spec eau-vivante R14) — l'eau réagit à ta présence avant même
 * que tu la touches.
 *
 * Des TACHES sombres fuselées glissent SOUS la surface (profondeur entre le sol et le
 * quad d'eau : la nappe les teinte d'elle-même). Le corps est une ombre de 8×4 px en
 * HUIT directions par TROIS textures (h/v/diagonale) + flips — jamais une rotation de
 * quad : à cette taille, tourner les texels hors de la grille les ferait ramper. La
 * queue bat par frames franches (cadence 300 ms), la naissance monte de la profondeur
 * par paliers d'alpha, le profond pâlit la tache d'un cran.
 *
 * LE COMPORTEMENT (chantier poissons, 2026-07-26) : nage en RAFALE-GLISSE (enveloppe de
 * vitesse en forme fermée — exacte à tout dt, l'horloge headless saute), virages à taux
 * BORNÉ (plus de demi-tours secs), et dans le couloir de courant la RHÉOTAXIE : le
 * poisson se tient FACE à l'amont, dérive lentement sous la poussée de l'eau (dont la
 * surface avance réellement — advection mesurée), puis rattrape sa station d'une rafale.
 * La FUITE reste le contrat de la spec : dard à 3,2 t/s sous 1,5 tuile d'une entité,
 * SOUTENU jusqu'à 2,4 t de la menace puis décroissance exponentielle continue — le
 * dimensionnement garantit la sonde A8 (≥ 1,2 t Chebyshev dégagées, preuve au journal).
 * Un sillage d'écume (fx-traine, le langage des feuilles) trouble la surface du dard.
 * 100 % client, seedé par hash (zéro `Math.random`).
 *
 * ══ LA FRONTIÈRE, écrite ici pour ne pas l'oublier (règle « objets de jeu réels ») ══
 * Tant que la PÊCHE n'existe pas, ces poissons sont du DÉCOR assumé — aucun état sim,
 * aucune interaction de jeu. LE JOUR où la pêche existe, les spawns montent dans /sim
 * (des nœuds récoltables, déterministes, snapshotés) et ce module devient leur RENDU.
 * (Ce jour-là : exp/cos/sin/atan2 d'ici sont INTERDITS dans /sim — LUT quantifiée et
 * décroissance géométrique par tick, c'est consigné.)
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { COURANT_VITESSE, flowAt, taperRive, type FlowField } from '../../render/flow-field'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import { riveAt, type RiveField } from '../../render/water-field'

/** AU-DESSUS du quad d'eau (−0,75), sous reflets (−0,72) et feuilles (−0,68) — revue,
 *  MESURÉ : sous le quad (alpha 0,88-0,96), le poisson était couvert à 88-96 %. Le premier
 *  correctif (+0,22 → −0,78) le laissait ENCORE dessous — attrapé par Alexis à l'œil, la
 *  leçon vaut d'être écrite : une profondeur se VÉRIFIE contre la constante voisine, pas
 *  de tête. Le poisson reste « sous la surface » par la COULEUR, pas par le tri. */
const POISSON_DEPTH = GROUND_MAP_DEPTH + 0.27
/** Le sillage du dard : juste au-dessus du poisson, sous les reflets (−0,72). */
const SILLAGE_DEPTH = GROUND_MAP_DEPTH + 0.275
/** 6 → 8 : absorbe les compagnons (naissances appariées) sans diluer les solitaires. */
const MAX_POISSONS = 8
/** Rayon (tuiles) autour de la caméra où un poisson peut vivre (cull à ×1,6). Le tirage
 *  de naissance se fait à ×1,2 — resserré : « par écran » se juge à l'écran (~28×18 t). */
const RAYON = 26
/** Une entité à moins d'1,5 tuile (euclidien) déclenche la FUITE en dard. */
const RAYON_FUITE = 1.5
const V_FUITE = 3.2
/** La fuite reste SOUTENUE (pleine vitesse, cap re-suivi) jusqu'ici, PUIS décroît.
 *  2,4 t euclidien = 1,7 t Chebyshev au pire diagonal ≥ la sonde A8 (1,2) + marge.
 *  NE JAMAIS redescendre sous 1,7·√2 ≈ 2,4 (contrat de sonde). */
const D_SORTIE = 2.4
const T_ATTAQUE_MS = 120 // rampe du C-start : lent tant qu'il est mal orienté
const TAU_FUITE_MS = 450 // décroissance exp. : queue de distance 3,2·0,45 = 1,44 t
/** Taux de virage (rad/s) : le C-start claque, l'errance dessine des arcs. */
const OMEGA_FUITE = 14
const OMEGA_ERRE = 1.8
const OMEGA_RAFALE = 6
const OMEGA_BERGE = 5
/** Rafale-glisse : bornes de vitesse d'errance ; moyenne ≈ 0,35 t/s (l'ancienne vitesse). */
const V_MIN = 0.1
const V_MAX = 0.8
const A_ATTAQUE = 0.15 // part montée du cycle (smoothstep) ; le reste glisse en (1−w)²
const E_CYCLE = A_ATTAQUE / 2 + (1 - A_ATTAQUE) / 3
/** Rhéotaxie : seuil de couloir, part du courant subie en tenue, rafale de rattrapage. */
const F_MIN = 0.15
const DERIVE_FRAC = 0.25
const V_RAFALE = 1.4
const SURVISEE_AMONT = 0.2
/** Whiskers de berge : 2 antennes riveAt en avant du cap. */
const L_WHISK = 0.75
const BETA = 0.6
const D_ALERTE = 0.9
/** Après la relâche de fuite, l'errance reste 5 s dans le demi-plan fuyant (sonde A8). */
const REFRACTAIRE_MS = 5000
/** Naissance appariée (« jamais un banc parfait » : zéro cohésion au runtime). */
const P_COMPAGNON = 0.35
/** Anti-tunnel : sous-pas de 0,5 t max (3,2 t/s × 1,5 s de dt headless = 4,8 t sinon). */
const SUBSTEP = 0.5
/** Le dard s'affiche (textures dédiées + sillage) au-delà de cette vitesse. */
const V_DARD_AFFICHE = 1.6
/** Sillage : 5 points d'écume recyclés, semés tous les 90 ms, morts à 360 ms. */
const SILLAGE_N = 5
const SILLAGE_PAS_MS = 90
const SILLAGE_VIE_MS = 360

const SHALLOW = 4
const DEEP = 6

function hache(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(s, 0x2c1b3c6d)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 13)) & 0xffff) / 0x10000
}

function wrapPi(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI))
}

/** Primitive EXACTE de l'enveloppe rafale-glisse (attaque smoothstep sur A, glisse (1−w)²).
 *  La distance parcourue entre deux instants est V_MIN·dt + ΔV·T·(D(τ2)−D(τ1)) — une forme
 *  fermée : exacte à tout dt, y compris les sauts d'horloge headless. */
function primitiveEnveloppe(tau: number): number {
  const k = Math.floor(tau)
  const u = tau - k
  let I: number
  if (u < A_ATTAQUE) {
    const s = u / A_ATTAQUE
    I = A_ATTAQUE * (s * s * s - (s * s * s * s) / 2)
  } else {
    const w = (u - A_ATTAQUE) / (1 - A_ATTAQUE)
    const c = 1 - w
    I = A_ATTAQUE / 2 + ((1 - A_ATTAQUE) * (1 - c * c * c)) / 3
  }
  return k * E_CYCLE + I
}

interface PointSillage {
  img: Phaser.GameObjects.Image
  neA: number
}

interface Poisson {
  sprite: Phaser.GameObjects.Image
  x: number // tuiles
  y: number
  /** Cap CONTINU (rad) — la géométrie ; le rendu le quantifie en 8 secteurs (doctrine). */
  theta: number
  capCible: number
  prochainVirage: number
  /** Rafale-glisse : période et phase propres — jamais deux poissons en métronome. */
  tBurstS: number
  phi: number
  /** Rhéotaxie : l'ancre de station, la laisse, l'état de rattrapage. */
  stationX: number
  stationY: number
  laisse: number
  rafale: boolean
  tRafale: number
  tStation: number
  /** Fuite : soutenue tant que d(ancre) < D_SORTIE, puis décroissance depuis tR. */
  fuiteActive: boolean
  fuiteT0: number
  fuiteTR: number
  ancreX: number
  ancreY: number
  /** Rendu : âge (paliers de naissance), phase d'animation, clé de texture cachée. */
  neA: number
  phase: number
  cle: string
  sillage: PointSillage[]
  silTete: number
  silProchain: number
}

export class PoissonsOmbres {
  private readonly poissons: Poisson[] = []
  private graine = 0
  private prochaine = 0

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
    /** Le champ de courant partagé (WaterLayer.flow) — nul : pas de rhéotaxie, errance. */
    private readonly flow: FlowField | null,
    private readonly rive: RiveField,
  ) {
    if (scene.textures.exists('fx-poisson2-h-0')) return
    const CORPS = 'rgba(14,26,40,0.55)'
    const QUEUE = 'rgba(14,26,40,0.38)'
    const MUSEAU = 'rgba(14,26,40,0.35)'
    const fabrique = (cle: string, w: number, h: number, dessin: (c: CanvasRenderingContext2D) => void): void => {
      const cv = document.createElement('canvas')
      cv.width = w
      cv.height = h
      const c = cv.getContext('2d', { willReadFrequently: true })!
      dessin(c)
      scene.textures.addCanvas(cle, cv)
      scene.textures.get(cle).setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
    // ── L'ERRANCE : un fuseau (jamais la brique pleine), museau devant, queue qui bat
    // en 3 frames par orientation — le cycle [0,1,0,2] est une fonction de l'horloge. ──
    const queuesH = [
      (c: CanvasRenderingContext2D) => c.fillRect(0, 1, 2, 2),
      (c: CanvasRenderingContext2D) => {
        c.fillRect(1, 1, 1, 2)
        c.fillRect(0, 0, 1, 2)
      },
      (c: CanvasRenderingContext2D) => {
        c.fillRect(1, 1, 1, 2)
        c.fillRect(0, 2, 1, 2)
      },
    ]
    const queuesV = [
      (c: CanvasRenderingContext2D) => c.fillRect(1, 0, 2, 2),
      (c: CanvasRenderingContext2D) => {
        c.fillRect(1, 1, 2, 1)
        c.fillRect(0, 0, 2, 1)
      },
      (c: CanvasRenderingContext2D) => {
        c.fillRect(1, 1, 2, 1)
        c.fillRect(2, 0, 2, 1)
      },
    ]
    const queuesD = [
      (c: CanvasRenderingContext2D) => {
        c.fillRect(1, 1, 1, 1)
        c.fillRect(0, 0, 1, 1)
      },
      (c: CanvasRenderingContext2D) => {
        c.fillRect(1, 1, 1, 1)
        c.fillRect(1, 0, 1, 1)
      },
      (c: CanvasRenderingContext2D) => {
        c.fillRect(1, 1, 1, 1)
        c.fillRect(0, 1, 1, 1)
      },
    ]
    for (let f = 0; f < 3; f++) {
      fabrique(`fx-poisson2-h-${f}`, 8, 4, (c) => {
        c.fillStyle = CORPS
        c.fillRect(2, 1, 5, 2)
        c.fillRect(3, 0, 3, 1)
        c.fillRect(3, 3, 3, 1)
        c.fillStyle = MUSEAU
        c.fillRect(7, 1, 1, 2)
        c.fillStyle = QUEUE
        queuesH[f]!(c)
      })
      fabrique(`fx-poisson2-v-${f}`, 4, 8, (c) => {
        c.fillStyle = CORPS
        c.fillRect(1, 2, 2, 5)
        c.fillRect(0, 3, 1, 3)
        c.fillRect(3, 3, 1, 3)
        c.fillStyle = MUSEAU
        c.fillRect(1, 7, 2, 1)
        c.fillStyle = QUEUE
        queuesV[f]!(c)
      })
      fabrique(`fx-poisson2-d-${f}`, 6, 6, (c) => {
        c.fillStyle = CORPS
        c.fillRect(2, 2, 2, 2)
        c.fillRect(3, 3, 2, 2)
        c.fillStyle = MUSEAU
        c.fillRect(5, 4, 1, 1)
        c.fillRect(4, 5, 1, 1)
        c.fillStyle = QUEUE
        queuesD[f]!(c)
      })
    }
    // ── LE DARD : un fuseau TENDU dédié (ratio 4:1) — l'ancien setDisplaySize(10,4)
    // étirait ×1,25, échelle non entière : texels inégaux sous NEAREST, faute pixel. ──
    fabrique('fx-poisson2-dard-h', 12, 3, (c) => {
      c.fillStyle = CORPS
      c.fillRect(4, 0, 6, 3)
      c.fillRect(2, 1, 2, 1)
      c.fillStyle = MUSEAU
      c.fillRect(10, 1, 2, 1)
    })
    fabrique('fx-poisson2-dard-v', 3, 12, (c) => {
      c.fillStyle = CORPS
      c.fillRect(0, 4, 3, 6)
      c.fillRect(1, 2, 1, 2)
      c.fillStyle = MUSEAU
      c.fillRect(1, 10, 1, 2)
    })
    fabrique('fx-poisson2-dard-d', 8, 8, (c) => {
      c.fillStyle = CORPS
      c.fillRect(2, 2, 2, 2)
      c.fillRect(3, 3, 2, 2)
      c.fillRect(4, 4, 2, 2)
      c.fillStyle = QUEUE
      c.fillRect(1, 1, 1, 1)
      c.fillRect(0, 0, 1, 1)
      c.fillStyle = MUSEAU
      c.fillRect(6, 5, 1, 1)
      c.fillRect(5, 6, 1, 1)
    })
    if (!scene.textures.exists('fx-traine')) {
      // le point d'écume des feuilles — un seul langage de sillage sur tout le plan d'eau
      const cv = document.createElement('canvas')
      cv.width = 1
      cv.height = 1
      const c = cv.getContext('2d', { willReadFrequently: true })!
      c.fillStyle = '#e9e7da'
      c.fillRect(0, 0, 1, 1)
      scene.textures.addCanvas('fx-traine', cv)
      scene.textures.get('fx-traine').setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
  }

  private eau(tx: number, ty: number): boolean {
    if (tx < 1 || ty < 1 || tx >= this.map.width - 1 || ty >= this.map.height - 1) return false
    const t = this.map.terrain[Math.floor(ty) * this.map.width + Math.floor(tx)]
    return t === SHALLOW || t === DEEP
  }

  private nait(nowMs: number, tx: number, ty: number, g: number): void {
    const f = this.flow ? flowAt(this.flow, tx, ty) : null
    const nf = f ? Math.sqrt(f.x * f.x + f.y * f.y) : 0
    // dans le couloir, le poisson naît FACE à l'amont — la rhéotaxie se lit dès la frame 1
    const theta = f && nf >= F_MIN ? Math.atan2(-f.y, -f.x) : hache(g, 3, 9) * 6.2831853
    const sprite = this.scene.add.image(Math.round(tx * TILE_PX), Math.round(ty * TILE_PX), 'fx-poisson2-h-0').setDepth(POISSON_DEPTH).setAlpha(0)
    const sillage: PointSillage[] = []
    for (let k = 0; k < SILLAGE_N; k++) {
      sillage.push({
        img: this.scene.add.image(0, 0, 'fx-traine').setDepth(SILLAGE_DEPTH).setVisible(false),
        neA: -Infinity,
      })
    }
    this.poissons.push({
      sprite,
      x: tx,
      y: ty,
      theta,
      capCible: theta,
      prochainVirage: nowMs + 1500 + hache(g, 2, 11) * 3000,
      tBurstS: 1.8 + hache(g, 0, 21) * 1.4,
      phi: hache(g, 1, 23),
      stationX: tx,
      stationY: ty,
      laisse: 0.8 + hache(g, 2, 25) * 0.8,
      rafale: false,
      tRafale: 0,
      tStation: nowMs + (6 + hache(g, 4, 27) * 6) * 1000,
      fuiteActive: false,
      fuiteT0: -Infinity,
      fuiteTR: -Infinity,
      ancreX: tx,
      ancreY: ty,
      neA: nowMs,
      phase: (hache(g, 5, 31) * 4) | 0,
      cle: '',
      sillage,
      silTete: 0,
      silProchain: 0,
    })
  }

  /** Chaque frame : naissances au compte-gouttes, rhéotaxie/errance/fuite, cull. */
  update(
    nowMs: number,
    dtMs: number,
    camTx: number,
    camTy: number,
    entites: { x: number; y: number }[],
  ): void {
    // ── Naissances : une tuile d'eau LARGE tirée près de la caméra ; parfois un COMPAGNON
    // à 0,6-1,2 t (appariement à la naissance seulement — jamais un banc parfait). ──
    if (this.poissons.length < MAX_POISSONS && nowMs >= this.prochaine) {
      this.prochaine = nowMs + 900
      for (let essai = 0; essai < 5; essai++) {
        const g = this.graine++
        const tx = camTx + (hache(g, essai, 3) - 0.5) * RAYON * 1.2
        const ty = camTy + (hache(essai, g, 5) - 0.5) * RAYON * 1.2
        if (!this.eau(tx, ty) || riveAt(this.rive, tx, ty) < 0.8) continue
        this.nait(nowMs, tx, ty, g)
        if (this.poissons.length < MAX_POISSONS && hache(g, essai, 27) < P_COMPAGNON) {
          const a = hache(g, essai, 29) * 6.2831853
          const d = 0.6 + hache(g, essai, 33) * 0.6
          const cx = tx + Math.cos(a) * d
          const cy = ty + Math.sin(a) * d
          if (this.eau(cx, cy) && riveAt(this.rive, cx, cy) >= 0.8) this.nait(nowMs, cx, cy, this.graine++)
        }
        break
      }
    }

    const dtS = dtMs / 1000
    for (let i = this.poissons.length - 1; i >= 0; i--) {
      const p = this.poissons[i]!
      // ── 1. LA MENACE : l'entité la plus proche décide ──
      let menace: { x: number; y: number } | null = null
      let d2min = RAYON_FUITE * RAYON_FUITE
      for (const e of entites) {
        const dx = p.x - e.x
        const dy = p.y - e.y
        const d2 = dx * dx + dy * dy
        if (d2 < d2min) {
          d2min = d2
          menace = e
        }
      }
      if (menace) {
        if (!p.fuiteActive) {
          p.fuiteActive = true
          p.fuiteT0 = nowMs
        }
        p.ancreX = menace.x
        p.ancreY = menace.y
        p.fuiteTR = Infinity
      } else if (p.fuiteActive && p.fuiteTR === Infinity) {
        const dx = p.x - p.ancreX
        const dy = p.y - p.ancreY
        if (dx * dx + dy * dy >= D_SORTIE * D_SORTIE) p.fuiteTR = nowMs // la relâche : la décroissance part d'ICI
      }

      // ── 2. LES WHISKERS DE BERGE : 2 antennes riveAt en avant de la référence ──
      const refA = p.fuiteActive ? Math.atan2(p.y - p.ancreY, p.x - p.ancreX) : p.theta
      const dL = riveAt(this.rive, p.x + L_WHISK * Math.cos(refA + BETA), p.y + L_WHISK * Math.sin(refA + BETA))
      const dR = riveAt(this.rive, p.x + L_WHISK * Math.cos(refA - BETA), p.y + L_WHISK * Math.sin(refA - BETA))
      const urgence = Math.min(1, Math.max(0, (D_ALERTE - Math.min(dL, dR)) / D_ALERTE))
      const s = Math.abs(dL - dR) < 0.05 ? (hache(Math.floor(nowMs / 500), i, 23) < 0.5 ? -1 : 1) : Math.sign(dL - dR)

      // ── 3. CAP CIBLE ET VITESSE, selon le mode ──
      let thetaCible = p.capCible
      let omega = OMEGA_ERRE
      let deplX = 0
      let deplY = 0
      let vAffiche = 0
      const f = this.flow ? flowAt(this.flow, p.x, p.y) : null
      const nf = f ? Math.sqrt(f.x * f.x + f.y * f.y) : 0
      let vFuite = 0
      if (p.fuiteActive) {
        vFuite =
          p.fuiteTR === Infinity
            ? V_FUITE * Math.min(1, (nowMs - p.fuiteT0) / T_ATTAQUE_MS)
            : V_FUITE * Math.exp(-(nowMs - p.fuiteTR) / TAU_FUITE_MS)
        // La fuite ne s'éteint qu'en DÉCROISSANCE : sur la frame de déclenchement la
        // rampe d'attaque vaut 0 — une garde globale tuait la fuite à sa naissance,
        // chaque frame (attrapé à la trace : d figé à 1,01 t, tR posé, fuite jamais vraie).
        if (p.fuiteTR !== Infinity && vFuite < 0.05) p.fuiteActive = false
      }
      if (p.fuiteActive) {
        // ═ LA FUITE : radial + biais vers l'eau libre (les whiskers), C-start à 14 rad/s.
        // Le biais s'ÉLARGIT avec l'urgence de berge : en eau libre ±26° (le calcul A8),
        // collé à la rive jusqu'à ~±90° — la glissade TANGENTIELLE le long de la berge
        // (d croît en √(d0²+s²), le cas berge-droite du dimensionnement). Sans ça, un
        // poisson dont le radial pointe la berge restait épinglé à 0,9 t (tracé). ═
        const biaisMax = 0.46 + 1.1 * urgence * urgence
        const biais = 0.6 * (dL - dR) + s * urgence * urgence * 1.2
        thetaCible = refA + Math.max(-biaisMax, Math.min(biaisMax, biais))
        omega = OMEGA_FUITE
        deplX = Math.cos(p.theta) * vFuite * dtS
        deplY = Math.sin(p.theta) * vFuite * dtS
        vAffiche = vFuite
      } else if (f && nf >= F_MIN) {
        // ═ LA RHÉOTAXIE : face à l'amont, tenir la station, rattraper d'une rafale ═
        const fx = f.x / nf
        const fy = f.y / nf
        const dsx = p.x - p.stationX
        const dsy = p.y - p.stationY
        const dStation = Math.sqrt(dsx * dsx + dsy * dsy)
        if (!p.rafale && dStation >= p.laisse) {
          p.rafale = true
          p.tRafale = nowMs
        }
        if (p.rafale) {
          const cx = p.stationX - fx * SURVISEE_AMONT - p.x
          const cy = p.stationY - fy * SURVISEE_AMONT - p.y
          thetaCible = Math.atan2(cy, cx)
          omega = OMEGA_RAFALE
          const v = Math.min(V_RAFALE * Math.min(1, (nowMs - p.tRafale) / 150), dStation / Math.max(dtS, 1e-6))
          deplX = Math.cos(p.theta) * v * dtS
          deplY = Math.sin(p.theta) * v * dtS
          vAffiche = v
          if (dStation <= 0.1) p.rafale = false
        } else {
          // la TENUE : museau à l'amont, le courant repousse (25 % — il nage le reste)
          thetaCible = Math.atan2(-fy, -fx)
          omega = OMEGA_ERRE
          const derive = DERIVE_FRAC * COURANT_VITESSE * taperRive(riveAt(this.rive, p.x, p.y)) * nf
          deplX = fx * derive * dtS
          deplY = fy * derive * dtS
          vAffiche = derive
        }
        // la station se relocalise sans hâte (±1,5 t le long du fil, ±0,8 en travers)
        if (nowMs >= p.tStation) {
          const g = this.graine++
          p.tStation = nowMs + (6 + hache(g, i, 27) * 6) * 1000
          const nx = p.stationX + fx * (hache(g, i, 35) - 0.5) * 3 + -fy * (hache(g, i, 39) - 0.5) * 1.6
          const ny = p.stationY + fy * (hache(g, i, 35) - 0.5) * 3 + fx * (hache(g, i, 39) - 0.5) * 1.6
          if (this.eau(nx, ny) && riveAt(this.rive, nx, ny) >= 0.5) {
            p.stationX = nx
            p.stationY = ny
          }
        }
      } else {
        // ═ L'ERRANCE (mare, hors couloir) : rafale-glisse, virages en arc ═
        if (nowMs >= p.prochainVirage) {
          const g = this.graine++
          p.prochainVirage = nowMs + 1500 + hache(g, i, 13) * 3000
          let cible = hache(g, i, 17) * 6.2831853
          // le réfractaire post-fuite : rester dans le demi-plan fuyant (contrat A8)
          if (nowMs < p.fuiteTR + REFRACTAIRE_MS) {
            const rA = Math.atan2(p.y - p.ancreY, p.x - p.ancreX)
            if (Math.cos(cible - rA) < 0.1) cible = rA + (hache(g, i, 19) - 0.5) * 2 * 1.47
          }
          p.capCible = cible
        }
        thetaCible = p.capCible
        omega = OMEGA_ERRE
        // la distance du pas en FORME FERMÉE — exacte même quand l'horloge saute
        const t1 = (nowMs - dtMs) / 1000 / p.tBurstS + p.phi
        const t2 = nowMs / 1000 / p.tBurstS + p.phi
        const ds = V_MIN * dtS + (V_MAX - V_MIN) * p.tBurstS * (primitiveEnveloppe(t2) - primitiveEnveloppe(t1))
        deplX = Math.cos(p.theta) * ds
        deplY = Math.sin(p.theta) * ds
        vAffiche = dtS > 0 ? ds / dtS : 0
      }

      // ── 4. LE CAP TOURNE, borné — le pas ne dépasse jamais l'erreur (stable à tout dt) ──
      const e = wrapPi(thetaCible - p.theta)
      p.theta += Math.sign(e) * Math.min(Math.abs(e), omega * dtS)
      if (!p.fuiteActive) p.theta += s * Math.min(urgence * urgence * OMEGA_BERGE * dtS, 0.9)

      // ── 5. LE DÉPLACEMENT EN SOUS-PAS anti-tunnel ; au blocage, pivot SUR PLACE —
      // budgété PAR FRAME (0,9 rad) : par sous-pas, 8 blocages faisaient toupiller. ──
      const dist = Math.sqrt(deplX * deplX + deplY * deplY)
      const n = Math.max(1, Math.min(8, Math.ceil(dist / SUBSTEP)))
      let pivote = 0
      for (let k = 0; k < n; k++) {
        const qx = p.x + deplX / n
        const qy = p.y + deplY / n
        if (this.eau(qx, qy) && riveAt(this.rive, qx, qy) > 0.25) {
          p.x = qx
          p.y = qy
        } else {
          const pas = Math.min((OMEGA_BERGE * dtS) / n, 0.9 - pivote)
          if (pas > 0) {
            p.theta += s * pas
            pivote += pas
          }
        }
      }

      // ── Cull hors de portée de la caméra ──
      if (Math.max(Math.abs(p.x - camTx), Math.abs(p.y - camTy)) > RAYON * 1.6) {
        p.sprite.destroy()
        for (const pt of p.sillage) pt.img.destroy()
        this.poissons.splice(i, 1)
        continue
      }

      // ── 6. LE RENDU : 8 secteurs par 3 textures + flips, frames de queue, paliers ──
      const cosT = Math.cos(p.theta)
      const sinT = Math.sin(p.theta)
      const ax = Math.abs(cosT)
      const ay = Math.abs(sinT)
      const o = ax > 2.414 * ay ? 'h' : ay > 2.414 * ax ? 'v' : 'd'
      const frame = [0, 1, 0, 2][(((nowMs / 300) | 0) + p.phase) & 3]!
      const cle = vAffiche >= V_DARD_AFFICHE ? `fx-poisson2-dard-${o}` : `fx-poisson2-${o}-${frame}`
      if (cle !== p.cle) {
        p.cle = cle
        p.sprite.setTexture(cle)
      }
      p.sprite.setFlipX(o !== 'v' && cosT < 0)
      p.sprite.setFlipY(o !== 'h' && sinT < 0)
      p.sprite.setPosition(Math.round(p.x * TILE_PX), Math.round(p.y * TILE_PX))
      // naissance par paliers (il MONTE de la profondeur), profond ×0,62 (l'eau trouble avale)
      const age = nowMs - p.neA
      const cran = age < 250 ? 0.35 : age < 500 ? 0.7 : 1
      const prof = this.map.terrain[Math.floor(p.y) * this.map.width + Math.floor(p.x)] === DEEP ? 0.62 : 1
      p.sprite.setAlpha(cran * prof)

      // ── 7. LE SILLAGE DU DARD : des points d'écume semés derrière, par paliers ──
      if (vAffiche >= V_DARD_AFFICHE && nowMs >= p.silProchain) {
        p.silProchain = nowMs + SILLAGE_PAS_MS
        for (const pt of p.sillage) if (pt.img.visible) pt.img.setAlpha(0.2)
        const pt = p.sillage[p.silTete]!
        p.silTete = (p.silTete + 1) % SILLAGE_N
        pt.neA = nowMs
        pt.img.setPosition(Math.round(p.x * TILE_PX), Math.round(p.y * TILE_PX))
        pt.img.setAlpha(0.42)
        pt.img.setVisible(true)
      }
      for (const pt of p.sillage) {
        if (pt.img.visible && nowMs - pt.neA > SILLAGE_VIE_MS) pt.img.setVisible(false)
      }
    }
  }

  /** Sonde du smoke (A8) : combien de poissons vivent, et la distance min à un point. */
  get vivants(): number {
    return this.poissons.length
  }
  distanceMin(tx: number, ty: number): number {
    let d = Infinity
    for (const p of this.poissons) {
      const dd = Math.max(Math.abs(p.x - tx), Math.abs(p.y - ty))
      if (dd < d) d = dd
    }
    return d
  }

  destroy(): void {
    for (const p of this.poissons) {
      p.sprite.destroy()
      for (const pt of p.sillage) pt.img.destroy()
    }
    this.poissons.length = 0
  }
}
