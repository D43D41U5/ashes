/**
 * LES OISEAUX DE L'AUBE (spec da-feeling R16) — l'ambiance au meilleur rapport effet/effort.
 *
 * Des pépiements SYNTHÉTISÉS (zéro asset, comme tout le son du jeu) : de courtes sinusoïdes
 * glissées, pitch et intervalle randomisés, UNIQUEMENT dans la fenêtre de l'aube. Pas un lit
 * sonore continu — des one-shots espacés : l'oreille remplit le reste. La densité suit la
 * même pente continue que la brume (l'aube est UN moment) : rares à 5h, pleins vers 6h-7h30,
 * éteints à 8h45. Le hasard est client (l'ambiance n'est pas de la sim — rien à rejouer).
 *
 * `chirps` compte les pépiements émis : c'est la sonde du critère A7 (mesurable au smoke).
 */
import type { SoundSpec } from './sound'

/** La densité de chants selon l'heure — pente continue, bornes exactes (règle maison). */
export function chantsDensite(hour: number): number {
  if (hour <= 4.8 || hour >= 8.75) return 0
  if (hour < 6) return (hour - 4.8) / 1.2 // l'aube s'éveille
  if (hour <= 7.5) return 1 //               plein chœur
  return (8.75 - hour) / 1.25 //             le jour installé les disperse
}

export class ChantsDeLAube {
  /** Pépiements émis depuis le boot — la sonde d'A7. */
  chirps = 0
  private prochain = 0

  /** À appeler chaque frame. `play` est le moteur (SoundEngine.play) — injecté, testable. */
  update(nowMs: number, hour: number, play: (spec: SoundSpec, delayS?: number) => void): void {
    const d = chantsDensite(hour)
    if (d <= 0) {
      this.prochain = 0 // fenêtre fermée : le prochain chant se replanifiera à l'aube suivante
      return
    }
    if (this.prochain === 0) this.prochain = nowMs + 400 + Math.random() * 1200
    if (nowMs < this.prochain) return

    // Un pépiement : 2-4 notes brèves qui descendent — chaque oiseau a son timbre du moment.
    const base = 2100 + Math.random() * 1400
    const notes = 2 + Math.floor(Math.random() * 3)
    for (let n = 0; n < notes; n++) {
      const freq = base * (1 + (Math.random() - 0.5) * 0.16)
      // Les notes se planifient sur l'horloge WebAudio (delayS) — pas de setTimeout.
      play({ wave: 'sine', freq, freqEnd: freq * 0.82, dur: 0.07, gain: 0.028 }, n * (0.055 + Math.random() * 0.045))
    }
    this.chirps += 1
    // L'intervalle se resserre au plein chœur (≥ ~1,6 s), s'espace aux marges de la fenêtre.
    this.prochain = nowMs + (1600 + Math.random() * 4200) / Math.max(0.25, d)
  }
}
