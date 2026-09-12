/**
 * LES SONS DE L'EAU (spec eau-vivante R8) — « les yeux vérifient ce que les oreilles ont
 * déjà affirmé ». Trois voix, toutes procédurales (le moteur one-shot de `engine.ts`,
 * zéro asset), l'ordre du retour sur investissement donné par la recherche :
 *   1. le SPLASH d'entrée (déclenché par EauEvents) — trois hauteurs, jamais deux pareils ;
 *   2. le PATAUGE : un pas d'eau rythmé tant qu'on MARCHE immergé ;
 *   3. le CLAPOTIS de rive : de petits lapements espacés dont le volume monte à
 *      l'approche de l'eau (le champ de rive, côté terre — la même vérité que le shader).
 *
 * ⚠ ESTHÉTIQUE À VALIDER À L'OREILLE (comme tout l'audio : consigné) — gains bas, mutable.
 *
 * ═══ B3 (reprise de l'eau, 2026-09-12) : DEUX DE CES VOIX SE TIENNENT QUELQUE PART ═══
 * Le splash d'un AUTRE corps arrivait à l'oreille au même volume et au centre, qu'il plonge à
 * trois tuiles ou à trente ; le clapotis de rive montait des deux oreilles alors que l'eau est
 * d'un côté. Les deux passent désormais leur lieu au moteur (`placer` : pan, atténuation,
 * voile, et SILENCE hors de portée) — le splash du joueur et son patauge, eux, sont « ici » et
 * restent sans lieu, byte pour byte ce qu'ils étaient.
 */
import { riveAt, type RiveField } from '../render/water-field'
import type { SoundSpec } from './sound'

/** Le moteur tel que ces voix le voient : un son, son retard, et — B3 — OÙ il se tient (tuiles).
 *  Sans lieu, le son sonne au centre et plein (le régime des annonces, `engine.ts`). */
export type JoueUnSon = (spec: SoundSpec, delayS?: number, at?: { x: number; y: number }) => void

const PAS_MS = 340
const LAP_MS_MIN = 900
const LAP_MS_JITTER = 800
/** Portée du clapotis, en tuiles de distance à l'eau. Exportée : sous la roche, `WorldScene`
 *  cherche la nappe de la salle jusqu'à cette distance — au-delà, rien à entendre. */
export const LAP_PORTEE = 6

export class SonsDeLEau {
  private prochainPas = 0
  private prochainLap = 0
  private graine = 1

  private bruit(): number {
    // xorshift léger — le son n'est pas de la simulation, mais on reste sans Math.random.
    this.graine ^= this.graine << 13
    this.graine ^= this.graine >>> 17
    this.graine ^= this.graine << 5
    return ((this.graine >>> 0) % 1000) / 1000
  }

  /** La gerbe : un souffle d'eau + une goutte claire qui retombe. `moi` sonne plein — et sans
   *  lieu ; un AUTRE corps sonne d'où il plonge (`at`, tuiles), donc plus du tout hors de portée. */
  splash(moi: boolean, play: JoueUnSon, at?: { x: number; y: number }): void {
    const k = moi ? 1 : 0.45
    const pitch = 0.85 + this.bruit() * 0.4
    const ou = moi ? undefined : at
    play({ wave: 'noise', freq: 0, dur: 0.22, gain: 0.11 * k, lowpass: 1100 * pitch }, 0, ou)
    play({ wave: 'sine', freq: 620 * pitch, freqEnd: 260 * pitch, dur: 0.16, gain: 0.05 * k }, 0.05, ou)
  }

  /**
   * Chaque frame : le patauge suit la marche immergée, le clapotis suit la proximité.
   * `dRive` : la distance signée du JOUEUR à la rive (+eau/−terre) ; `enMarche` : le
   * joueur a bougé cette frame ; `play` : le moteur (déjà muet/endormi si besoin) ;
   * `rive` : LE POINT DE RIVE le plus proche (`pointDeRive`), d'où le clapotis se tient —
   * `null` quand on ne sait pas (sous la roche, dans l'eau) : il sonne alors au centre, comme avant.
   */
  update(
    nowMs: number,
    dRive: number,
    enMarche: boolean,
    play: JoueUnSon,
    rive: { x: number; y: number } | null = null,
  ): void {
    // LE PATAUGE — un pas d'eau feutré, cadencé, trois teintes.
    if (dRive > 0.08 && enMarche && nowMs >= this.prochainPas) {
      this.prochainPas = nowMs + PAS_MS + this.bruit() * 90
      const v = this.bruit()
      play({ wave: 'noise', freq: 0, dur: 0.1 + v * 0.04, gain: 0.045, lowpass: 700 + v * 400 })
    }
    // LE CLAPOTIS — la rive s'entend avant de se voir, et se tait au large comme au loin.
    const distTerre = Math.max(0, -dRive)
    const proche = dRive > 0 ? 0.6 : Math.max(0, 1 - distTerre / LAP_PORTEE)
    if (proche > 0.05 && nowMs >= this.prochainLap) {
      this.prochainLap = nowMs + LAP_MS_MIN + this.bruit() * LAP_MS_JITTER
      const v = this.bruit()
      play({ wave: 'noise', freq: 0, dur: 0.28 + v * 0.15, gain: 0.028 * proche, lowpass: 420 + v * 260 }, 0, rive ?? undefined)
    }
  }
}

/**
 * LE POINT DE RIVE LE PLUS PROCHE d'un corps À TERRE — où le clapotis se tient (B3).
 *
 * Le champ de rive est un SDF (eau-vivante R1) : son GRADIENT pointe vers l'eau, et sa valeur
 * dit à quelle distance elle est. Le point de rive est donc `p − sd × ∇sd/|∇sd|`, lu par
 * différences centrées sur `riveAt` (la même lecture bilinéaire que le shader et l'immersion).
 * `null` dans l'eau (le clapotis est « ici ») et là où le champ est plat (au-delà de sa borne,
 * `RIVE_MAX_TILES` ≈ 7,9 tuiles — plus loin que la portée du clapotis, `LAP_PORTEE`) : sans
 * direction, on ne fabrique pas un côté.
 */
export function pointDeRive(rive: RiveField, x: number, y: number): { x: number; y: number } | null {
  const d = riveAt(rive, x, y)
  if (d >= 0) return null
  const e = 0.5
  const gx = riveAt(rive, x + e, y) - riveAt(rive, x - e, y)
  const gy = riveAt(rive, x, y + e) - riveAt(rive, x, y - e)
  const n = Math.sqrt(gx * gx + gy * gy)
  if (n < 1e-6) return null
  return { x: x - (gx / n) * d, y: y - (gy / n) * d }
}
