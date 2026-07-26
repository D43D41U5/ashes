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
 */
import type { SoundSpec } from './sound'

const PAS_MS = 340
const LAP_MS_MIN = 900
const LAP_MS_JITTER = 800
/** Portée du clapotis, en tuiles de distance à l'eau. */
const LAP_PORTEE = 6

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

  /** La gerbe : un souffle d'eau + une goutte claire qui retombe. `moi` sonne plein. */
  splash(moi: boolean, play: (spec: SoundSpec, delayS?: number) => void): void {
    const k = moi ? 1 : 0.45
    const pitch = 0.85 + this.bruit() * 0.4
    play({ wave: 'noise', freq: 0, dur: 0.22, gain: 0.11 * k, lowpass: 1100 * pitch })
    play({ wave: 'sine', freq: 620 * pitch, freqEnd: 260 * pitch, dur: 0.16, gain: 0.05 * k }, 0.05)
  }

  /**
   * Chaque frame : le patauge suit la marche immergée, le clapotis suit la proximité.
   * `dRive` : la distance signée du JOUEUR à la rive (+eau/−terre) ; `enMarche` : le
   * joueur a bougé cette frame ; `play` : le moteur (déjà muet/endormi si besoin).
   */
  update(
    nowMs: number,
    dRive: number,
    enMarche: boolean,
    play: (spec: SoundSpec, delayS?: number) => void,
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
      play({ wave: 'noise', freq: 0, dur: 0.28 + v * 0.15, gain: 0.028 * proche, lowpass: 420 + v * 260 })
    }
  }
}
