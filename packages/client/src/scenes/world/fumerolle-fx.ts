/**
 * ═══ LA FUMÉE FROIDE DES FUMEROLLES (décision d'Alexis, 2026-08-24) ═══
 *
 * *« des trous qui émettent de la fumée froide ».* Le prop dit le TROU ; cette couche dit le
 * souffle — et c'est elle qui fait qu'on repère une fumerolle à un écran de distance, ce qui est
 * tout l'intérêt d'en avoir fait un LIEU plutôt qu'une texture.
 *
 * ═══ FROIDE, DONC ELLE TOMBE ═══
 *
 * Une fumée chaude monte et s'évase. Celle-ci est **plus lourde que l'air** : elle sort du trou,
 * s'élève à peine, puis **retombe et rampe** en s'étalant au ras du sol. C'est la seule chose qui
 * la distingue d'une fumée ordinaire à l'œil, et c'est donc la seule qui compte. Elle dit la même
 * chose que le froid qu'elle porte : *ça ne s'échappe pas vers le ciel, ça s'accumule ici.*
 *
 * ═══ PIXELLISÉE, VACILLANTE PAR L'ALPHA ═══
 *
 * Quads de `GRAIN_PX` alignés sur la grille de l'art, jamais lissés, et le vacillement passe par
 * l'ALPHA et non par la taille — la leçon consignée pour tous les FX de ce jeu (un grain qui
 * grandit et rétrécit fait respirer le pixel-art, ce qui le trahit).
 *
 * ═══ CE QU'ELLE NE FAIT PAS ═══
 *
 * Elle ne connaît ni la carte ni la cendre : `WorldScene` lui donne les bouches VISIBLES, elle
 * souffle. Aucun état de simulation, aucune décision de jeu — le froid, lui, vit dans `/sim`
 * (`froidDeFumerolle`), et les deux ne se parlent pas : on ne peut pas les faire diverger.
 */
import Phaser from 'phaser'
import { TILE_PX } from '../../render/framing'

/** Le grain de l'art (px monde) — la même maille que la brume et le Feu. */
const GRAIN_PX = 4
/** La bouffée fait DEUX grains de côté : à un seul, elle se perdait dans le bruit du sol. */
const QUAD_PX = GRAIN_PX * 2
/**
 * ⚠ AU-DESSUS DU SOL **ET DES PROPS** (`GROUND_PROP_DEPTH` = 2, `FLOOR_DEPTH` = 6). À 4,5 elle
 * passait sous les dalles et sous le bâti : on ne voyait rien. Elle reste sous tout ce qui a des
 * pieds (les acteurs sont triés par Y, très au-dessus).
 */
const FUMEE_DEPTH = 7
/**
 * Bouffées vivantes par bouche. ⚠ IL EN FAUT BEAUCOUP, et pas pour faire gros : à vingt, les
 * quads s'isolent sur cinq tuiles et l'œil lit des DALLES ABÎMÉES, pas de la fumée (vu au
 * navigateur). C'est leur recouvrement qui fabrique la nappe — chacune reste très pâle.
 */
const PAR_BOUCHE = 40
/** Plafond de machine, toutes bouches confondues — une vue n'en montre jamais plus d'une ou deux. */
const BUDGET = 128
/** Durée de vie d'une bouffée, en secondes. Longue : la nappe rampe, elle ne claque pas. */
const VIE_S = 4.5

/**
 * ═══ LA NAPPE NE QUITTE PAS SON TROU (Alexis, 2026-08-25) ═══
 *
 * *« entre le trou de la fumerolle et l'émission des particules, il y a parfois une sacré
 * distance. »* CONFIRMÉ, et mesuré en rejouant l'intégration au pas de 1/60 s : une bouffée
 * encore VISIBLE (alpha > 0,02) s'éloignait jusqu'à **5,5 tuiles** du trou — 4,8 vers le bas,
 * 2,8 de côté — et un dixième d'entre elles passaient 3,4 tuiles. Le gros de la nappe restait
 * sur la bouche (centroïde pondéré : 0,76 tuile), mais la QUEUE partait au loin : c'est elle
 * qu'on voit, et elle ne ressemble plus à de la fumée qui sort de ce trou-là.
 *
 * LES DEUX TERMES ÉTAIENT NON BORNÉS, et c'est toute la cause :
 *   · `vy += 11·dt` sans vitesse limite — la « retombée » devenait une CHUTE. Partie à −8 px/s,
 *     la bouffée finissait à +41 px/s : elle ne rampait pas, elle plongeait.
 *   · `vx *= 1 + 0,55·dt` — une croissance EXPONENTIELLE, ×11,9 sur une vie. Un étalement qui
 *     double puis quadruple n'est pas un étalement, c'est une fuite.
 *
 * On garde la LECTURE (elle sort, elle retombe, elle rampe) et on lui donne des VITESSES
 * LIMITES, comme en a tout ce qui tombe dans de l'air. Les deux plafonds se DÉRIVENT du seul
 * nombre qui a un sens à l'œil — le rayon de la nappe, en tuiles : au-delà, on ne lit plus
 * « la fumée de ce trou », on lit « du brouillard qui traîne ».
 */
const NAPPE_TUILES = 1.6
/** Vitesse limite de chute, px/s — la moitié du rayon en une vie : elle se pose, elle ne plonge pas. */
const CHUTE_MAX = (NAPPE_TUILES * TILE_PX * 0.5) / VIE_S
/** Vitesse limite de reptation, px/s — le rayon plein en une vie, c'est l'étalement au sol. */
const RAMPE_MAX = (NAPPE_TUILES * TILE_PX) / VIE_S

interface Bouffee {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  vive: boolean
  graine: number
  /** Fausse-t-elle sa première vie ? cf. `DEPHASAGE` — une seule fois, à l'allumage initial. */
  neuve: boolean
}

export class FumerolleFx {
  private readonly bouffees: Bouffee[] = []
  readonly quads: Phaser.GameObjects.Rectangle[] = [] // public : le harnais smoke les LIT
  /** Combien de bouffées sont vivantes — LU PAR LE SMOKE. */
  vivantes = 0
  /**
   * Les dernières bouches soufflées — gardées pour le HARNAIS SMOKE, qui doit pouvoir faire VIVRE
   * la fumée sans le jeu. En headless la boucle tourne à ~1 image/s : une bouffée n'y a jamais
   * plus de quelques centièmes de seconde, donc toute capture la montre à peine née. Le smoke
   * rappelle donc `update` avec un `dt` franc pour l'amener à maturité — le seul moyen de
   * PHOTOGRAPHIER un FX éphémère (leçon consignée pour tous les FX de ce jeu).
   */
  dernieresBouches: readonly { tx: number; ty: number }[] = []
  private t = 0

  constructor(private scene: Phaser.Scene) {
    for (let i = 0; i < BUDGET; i++) {
      this.bouffees.push({ x: 0, y: 0, vx: 0, vy: 0, age: 0, vive: false, graine: 0, neuve: true })
      // BLANC BLEUTÉ, et c'est délibéré : sur un sol de cendre brun-gris, une fumée grise se
      // confond. Le froid a le droit d'être un peu bleu — c'est ce qui la fait LIRE.
      const r = scene.add.rectangle(0, 0, QUAD_PX, QUAD_PX, 0xdbe4e8)
      r.setOrigin(0.5, 0.5).setDepth(FUMEE_DEPTH).setVisible(false)
      this.quads.push(r)
    }
  }

  /**
   * UNE IMAGE. `bouches` sont les fumerolles VISIBLES, en tuiles ; `dt` en secondes (borné par
   * l'appelant, comme partout — une frame longue ne doit pas téléporter la fumée).
   */
  update(bouches: readonly { tx: number; ty: number }[], dt: number): void {
    this.t += dt
    this.dernieresBouches = bouches

    // ── ON RALLUME CE QUI EST MORT, réparti sur les bouches visibles ──────────────────────────
    if (bouches.length > 0) {
      const cible = Math.min(BUDGET, bouches.length * PAR_BOUCHE)
      let vivantes = 0
      for (const b of this.bouffees) if (b.vive) vivantes++
      let aRallumer = cible - vivantes
      for (let i = 0; i < this.bouffees.length && aRallumer > 0; i++) {
        const b = this.bouffees[i]!
        if (b.vive) continue
        const bouche = bouches[i % bouches.length]!
        // Un départ légèrement dispersé sur la gueule : une colonne parfaitement axée se lirait
        // comme un trait, et un trait n'est pas de la fumée.
        b.x = (bouche.tx + 0.5) * TILE_PX + (this.pseudo(i, 1) - 0.5) * GRAIN_PX * 1.5
        b.y = (bouche.ty + 0.5) * TILE_PX + (this.pseudo(i, 2) - 0.5) * GRAIN_PX
        // ⚠ ELLE SORT VERS LE HAUT, MAIS À PEINE : `vy` négatif et FAIBLE, que la pesanteur
        //   retourne en une seconde. C'est ce qui la rend FROIDE à l'œil.
        b.vy = -6 - this.pseudo(i, 3) * 5
        b.vx = (this.pseudo(i, 4) - 0.5) * 5
        // ⚠ DÉPHASAGE — LA CHOSE QUI FAIT QUE C'EST DE LA FUMÉE ET PAS UNE DALLE.
        //   Au tout premier allumage, les 22 bouffées d'une bouche partent ensemble : elles
        //   vieillissent en bloc, atteignent leur plein alpha en bloc et meurent en bloc. À
        //   l'image, ça donne un RECTANGLE opaque qui clignote (vu au navigateur). On leur donne
        //   donc un âge de naissance étalé sur toute la durée de vie : dès lors elles meurent à
        //   des instants différents, donc se rallument à des instants différents, et le
        //   déphasage se PERPÉTUE tout seul — un seul tirage, pour toujours.
        b.age = b.neuve ? this.pseudo(i, 7) * VIE_S : 0
        b.neuve = false
        b.vive = true
        b.graine = i
        aRallumer--
      }
    }

    // ── ON LES FAIT VIVRE ────────────────────────────────────────────────────────────────────
    this.vivantes = 0
    for (let i = 0; i < this.bouffees.length; i++) {
      const b = this.bouffees[i]!
      const q = this.quads[i]!
      if (!b.vive) { q.setVisible(false); continue }
      b.age += dt
      if (b.age >= VIE_S || bouches.length === 0) { b.vive = false; q.setVisible(false); continue }

      // LA PESANTEUR DE LA FUMÉE FROIDE : elle retombe, puis RAMPE — la vitesse verticale passe
      // par zéro et redevient positive, pendant que l'horizontale s'ouvre. Une fumée chaude ferait
      // l'inverse (elle accélère vers le haut et se disperse) : c'est la lecture qu'on achète ici.
      // La pesanteur pousse toujours, mais l'air freine : `vy` monte vers `CHUTE_MAX` et s'y
      // arrête. Le passage par zéro — le moment où elle cesse de sortir et commence à retomber —
      // est intact, c'est lui qui la dit FROIDE ; ce qui disparaît, c'est la chute libre après.
      b.vy = Math.min(CHUTE_MAX, b.vy + 11 * dt)
      // Elle s'étale au ras du sol — vers sa vitesse limite, plus en la MULTIPLIANT : une
      // croissance exponentielle n'a pas d'échelle, donc pas de rayon (voir `NAPPE_TUILES`).
      const cible = b.vx < 0 ? -RAMPE_MAX : RAMPE_MAX
      b.vx += (cible - b.vx) * Math.min(1, 0.55 * dt)
      b.x += b.vx * dt
      b.y += b.vy * dt

      const t = b.age / VIE_S
      // L'alpha monte vite puis s'éteint long : la bouffée APPARAÎT au trou et se dissout au loin.
      // Elle monte vite, tient un court plateau, puis s'éteint long. Le plateau existe parce que
      // sans lui une bouffée passait sa vie sous 30 % d'alpha et la nappe ne se voyait pas ; il
      // reste COURT parce qu'à plein alpha vingt bouffées superposées font une dalle.
      const enveloppe = t < 0.12 ? t / 0.12 : t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65
      // Le vacillement est dans l'ALPHA, jamais dans la taille (grammaire des FX de ce jeu).
      const scintille = 0.82 + 0.18 * this.pseudo(b.graine, Math.floor(this.t * 7) % 97)
      // POSITION QUANTIFIÉE sur la grille de l'art : sans ça, le quad glisse en sous-pixel et la
      // fumée se met à ramper « lisse » au milieu d'un monde qui, lui, est en pixels.
      q.setPosition(Math.round(b.x / GRAIN_PX) * GRAIN_PX, Math.round(b.y / GRAIN_PX) * GRAIN_PX)
      // ⚠ FAIBLE, ET C'EST VOULU : une bouche en porte vingt qui se chevauchent. C'est leur
      //   ACCUMULATION qui doit faire la nappe, pas chaque grain — à 0,9 chacun, on obtenait un
      //   bloc blanc opaque au lieu d'un voile.
      q.setAlpha(Math.max(0, enveloppe) * 0.34 * scintille)
      q.setVisible(true)
      this.vivantes++
    }
  }

  /** Un pseudo-aléatoire positionnel, sans état et sans toucher au PRNG du monde. */
  private pseudo(a: number, b: number): number {
    const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
    return n - Math.floor(n)
  }

  destroy(): void {
    for (const q of this.quads) q.destroy()
    this.quads.length = 0
    this.bouffees.length = 0
  }
}
