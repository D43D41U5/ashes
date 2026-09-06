/**
 * LES SONS DE LA GROTTE (spec `grottes.md` §4bis) — la goutte qui tombe, LÀ OÙ ELLE TOMBE.
 *
 * Une cave vide n'est pas une cave muette. `CaveFx` fait déjà tomber des gouttes du plafond
 * (« le battement d'horloge d'une cave ») ; jusqu'ici on les voyait sans les entendre. Ici, la
 * goutte SONNE à l'instant où le trait touche le sol, et au point où il le touche : le son est
 * spatialisé sur la tuile d'impact (`PORTEE.GESTE`, ~11 tuiles — une goutte n'est pas un cri),
 * si bien qu'une goutte qui tombe à gauche de l'écran s'entend à gauche. Les yeux vérifient ce
 * que les oreilles ont affirmé — la même règle que l'eau vivante (R8).
 *
 * Deux voix par goutte : le « ploc », une sinusoïde brève qui MONTE (la bulle qui se referme
 * dans une flaque monte en fréquence, elle ne descend pas), puis son ÉCHO un dixième de seconde
 * après, plus bas et plus sourd — c'est l'écho qui dit la salle, pas la goutte. Le hasard
 * (hauteur) est client, comme la goutte elle-même : rien à rejouer.
 *
 * Aucune nappe : le silence entre deux gouttes EST le son de la grotte. Ce que la roche retire
 * (la pluie, le vent, les oiseaux, le clapotis du plateau) se règle dans `WorldScene`
 * (`dehorsIci`) ; ce fichier n'ajoute que ce que la cave possède.
 *
 * ⚠ ESTHÉTIQUE À VALIDER À L'OREILLE (comme tout l'audio : consigné) — gains bas, mutable.
 */
import type { SoundSpec } from './sound'
import { PORTEE } from './spatial'

type Jouer = (spec: SoundSpec, delayS?: number, at?: { x: number; y: number }) => void

/** Le ploc : court, clair, qui monte. */
export const GOUTTE: SoundSpec = { wave: 'sine', freq: 1900, freqEnd: 2500, dur: 0.05, gain: 0.045, portee: PORTEE.GESTE }
/** L'écho de la salle : la même note un peu plus bas, voilée, à un quart du gain. */
export const GOUTTE_ECHO: SoundSpec = { wave: 'sine', freq: 1500, freqEnd: 1850, dur: 0.09, gain: 0.012, lowpass: 2400, portee: PORTEE.GESTE }
/** Le retard de l'écho (s) — une salle de quelques dizaines de mètres, pas une cathédrale. */
export const ECHO_S = 0.11

export class SonsDeLaGrotte {
  /** Les gouttes sonnées depuis le boot — la sonde du smoke (« on entend la cave »). */
  readonly sonde = { gouttes: 0 }
  private graine = 0x2545f491

  private bruit(): number {
    // xorshift léger — le son n'est pas de la simulation, mais on reste sans Math.random.
    this.graine ^= this.graine << 13
    this.graine ^= this.graine >>> 17
    this.graine ^= this.graine << 5
    return ((this.graine >>> 0) % 1000) / 1000
  }

  /** Une goutte touche le sol en (`x`, `y`) — en TUILES, la position d'écoute du moteur. */
  goutte(x: number, y: number, play: Jouer): void {
    // Chaque goutte a sa hauteur (±18 %) : deux gouttes pareilles feraient une horloge.
    const pitch = 0.82 + this.bruit() * 0.36
    const at = { x, y }
    play({ ...GOUTTE, freq: GOUTTE.freq * pitch, freqEnd: GOUTTE.freqEnd! * pitch }, 0, at)
    play({ ...GOUTTE_ECHO, freq: GOUTTE_ECHO.freq * pitch, freqEnd: GOUTTE_ECHO.freqEnd! * pitch }, ECHO_S, at)
    this.sonde.gouttes += 1
  }
}
