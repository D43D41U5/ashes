/**
 * LE MOTEUR AUDIO — possède l'AudioContext, un gain maître, le mute. Client SEUL (pas /sim :
 * le son n'est pas de la simulation). Créé PARESSEUSEMENT au premier geste (les navigateurs
 * bloquent l'audio sans interaction), et le mute se retient d'une session à l'autre.
 */
import { buildSound, type SoundSpec } from './sound'

const MUTE_KEY = 'braises.audio.muted'
const VOLUME_KEY = 'braises.audio.volume'
const MASTER_GAIN = 0.6 // le plafond global : le son reste un DÉCOR, jamais au premier plan

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

export class SoundEngine {
  private ctx: AudioContext | undefined
  private master: GainNode | undefined
  private muted: boolean
  /** Le curseur MAÎTRE, 0..1 (persisté) — multiplie le plafond `MASTER_GAIN`. */
  private volume: number

  constructor() {
    this.muted = readStorage(MUTE_KEY) === '1'
    const v = Number(readStorage(VOLUME_KEY))
    this.volume = Number.isFinite(v) && readStorage(VOLUME_KEY) !== null ? clamp01(v) : 1
  }

  /** Le gain effectif = 0 si muet, sinon le plafond × le curseur. Une seule source. */
  private applyGain(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : MASTER_GAIN * this.volume
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
      this.applyGain()
      this.master.connect(this.ctx.destination)
    }
    void this.ctx.resume()
  }

  /** Joue un son (ou rien si muet / contexte pas encore réveillé). */
  play(spec: SoundSpec | null, delayS = 0): void {
    if (!spec || this.muted || !this.ctx || !this.master || this.ctx.state !== 'running') return
    // `delayS` se planifie sur l'horloge WebAudio (la seule juste pour le son) — jamais un
    // setTimeout : les notes d'un pépiement restent serrées même si le thread principal souffle.
    buildSound(this.ctx, this.master, spec, this.ctx.currentTime + delayS)
  }

  /** Bascule le mute (persisté). Rend le nouvel état. */
  toggleMute(): boolean {
    this.muted = !this.muted
    this.applyGain()
    writeStorage(MUTE_KEY, this.muted ? '1' : '0')
    return this.muted
  }

  /** Règle le curseur maître (0..1, persisté). Rend la valeur clampée. */
  setVolume(v: number): number {
    this.volume = clamp01(v)
    this.applyGain()
    writeStorage(VOLUME_KEY, String(this.volume))
    return this.volume
  }

  getVolume(): number {
    return this.volume
  }

  isMuted(): boolean {
    return this.muted
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* stockage refusé : le réglage vaut pour la session */
  }
}
