/**
 * LE MOTEUR AUDIO — possède l'AudioContext, un gain maître, le mute. Client SEUL (pas /sim :
 * le son n'est pas de la simulation). Créé PARESSEUSEMENT au premier geste (les navigateurs
 * bloquent l'audio sans interaction), et le mute se retient d'une session à l'autre.
 */
import { buildSound, type SoundSpec } from './sound'

const MUTE_KEY = 'braises.audio.muted'
const MASTER_GAIN = 0.6 // le plafond global : le son reste un DÉCOR, jamais au premier plan

export class SoundEngine {
  private ctx: AudioContext | undefined
  private master: GainNode | undefined
  private muted: boolean

  constructor() {
    this.muted = (() => {
      try {
        return localStorage.getItem(MUTE_KEY) === '1'
      } catch {
        return false
      }
    })()
  }

  /** À appeler au premier geste utilisateur (clic/touche) : crée/réveille le contexte. */
  resume(): void {
    if (!this.ctx) {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return // navigateur sans WebAudio : le jeu tourne muet, sans planter
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN
      this.master.connect(this.ctx.destination)
    }
    void this.ctx.resume()
  }

  /** Joue un son (ou rien si muet / contexte pas encore réveillé). */
  play(spec: SoundSpec | null): void {
    if (!spec || this.muted || !this.ctx || !this.master || this.ctx.state !== 'running') return
    buildSound(this.ctx, this.master, spec, this.ctx.currentTime)
  }

  /** Bascule le mute (persisté). Rend le nouvel état. */
  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.master) this.master.gain.value = this.muted ? 0 : MASTER_GAIN
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0')
    } catch {
      /* stockage refusé : le mute vaut pour la session */
    }
    return this.muted
  }

  isMuted(): boolean {
    return this.muted
  }
}
