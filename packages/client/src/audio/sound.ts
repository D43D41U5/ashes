/**
 * LE SON — le premier échafaudage audio (l'audit : 0 son, « fatal au chef-d'œuvre »).
 *
 * WebAudio PROCÉDURAL, zéro asset externe (CSP : rien à charger). On sépare deux choses :
 *  - le CÂBLAGE (quel événement → quel son) : une table PURE, testable — `soundForEvent`.
 *  - la SYNTHÈSE (comment un son sonne) : `buildSound`, qui monte un petit graphe WebAudio.
 *
 * ⚠ ESTHÉTIQUE À VALIDER — je ne peux pas ENTENDRE le résultat. Les sons sont volontairement
 * SOBRES et BAS (gains ~0,04-0,12), coupables au besoin (mute) : un pis-aller qui ne doit pas
 * gêner le playtest, pas un design sonore final. À régler à l'oreille par Alexis (l'audit le
 * classe « oreilles »). Le SYSTÈME, lui, est vérifiable (routage + niveaux/durées des buffers).
 */
import type { SimEvent } from '@braises/sim'

export type Waveform = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise'

/** Un son procédural : une forme, une enveloppe, un glissando optionnel, un filtre optionnel. */
export interface SoundSpec {
  wave: Waveform
  /** Fréquence de départ (Hz) ; ignorée pour `noise`. */
  freq: number
  /** Glissando vers cette fréquence sur la durée (Hz). Absent = tenue. */
  freqEnd?: number
  /** Durée totale (s). */
  dur: number
  /** Gain crête (0..1) — GARDÉ BAS : le monde n'est pas un jeu d'arcade. */
  gain: number
  /** Coupe-bas (Hz) — surtout pour le bruit (impacts feutrés). */
  lowpass?: number
}

/**
 * LA TABLE DE ROUTAGE (pure) : un événement de domaine → un son, ou `null` (silencieux).
 * `onMe` distingue « ça m'arrive » de « ça arrive à un autre ». Haute fréquence bornée : on ne
 * sonne QUE les faits qui comptent (un déplacement n'est pas un son).
 */
export function soundForEvent(event: SimEvent, onMe: boolean): SoundSpec | null {
  switch (event.type) {
    case 'resource_harvested':
      return onMe ? { wave: 'square', freq: 440, freqEnd: 520, dur: 0.06, gain: 0.05, lowpass: 2200 } : null
    case 'entity_damaged':
      // Encaisser (sur moi) : un choc mat et grave. Toucher (un autre) : un « tac » plus clair.
      return onMe
        ? { wave: 'noise', freq: 0, dur: 0.16, gain: 0.12, lowpass: 700 }
        : { wave: 'triangle', freq: 320, freqEnd: 220, dur: 0.08, gain: 0.06 }
    case 'monster_slain':
      return { wave: 'triangle', freq: 180, freqEnd: 90, dur: 0.22, gain: 0.1 }
    case 'wolf_howl':
      return { wave: 'sine', freq: 520, freqEnd: 240, dur: 0.7, gain: 0.09 }
    case 'night_started':
      return { wave: 'sine', freq: 130, freqEnd: 98, dur: 0.9, gain: 0.07 }
    case 'entity_died':
      return { wave: 'sine', freq: 160, freqEnd: 70, dur: 1.1, gain: 0.11 }
    case 'entity_bandaged':
      return { wave: 'noise', freq: 0, dur: 0.14, gain: 0.05, lowpass: 1400 }
    case 'refugees_arrived':
      return { wave: 'triangle', freq: 392, freqEnd: 523, dur: 0.3, gain: 0.06 }
    case 'alarm_raised':
      return { wave: 'square', freq: 660, freqEnd: 660, dur: 0.18, gain: 0.1, lowpass: 2600 }
    case 'evacuation_opened':
      return { wave: 'sine', freq: 294, freqEnd: 440, dur: 0.5, gain: 0.08 }
    default:
      return null
  }
}

/**
 * Monte le graphe WebAudio d'un `SoundSpec` sur `dest`, démarré à `when` (s). Enveloppe
 * attack-court / release-linéaire vers 0 (pas de clic). Réutilisable en OfflineAudioContext
 * (test) comme en live. `noise` : un buffer de bruit blanc court, filtré. Retourne les nœuds
 * pour test/cleanup ; ils s'arrêtent seuls à `when + dur`.
 */
export function buildSound(ctx: BaseAudioContext, dest: AudioNode, spec: SoundSpec, when = 0): void {
  const g = ctx.createGain()
  const atk = Math.min(0.01, spec.dur * 0.2)
  g.gain.setValueAtTime(0, when)
  g.gain.linearRampToValueAtTime(spec.gain, when + atk)
  g.gain.linearRampToValueAtTime(0, when + spec.dur)

  let src: AudioScheduledSourceNode
  if (spec.wave === 'noise') {
    const frames = Math.max(1, Math.floor(ctx.sampleRate * spec.dur))
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // Bruit blanc déterministe (LCG) — pas de Math.random : reproductible, testable.
    let s = 0x2545f491
    for (let i = 0; i < frames; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      data[i] = (s / 0x40000000 - 1) * 0.9
    }
    const node = ctx.createBufferSource()
    node.buffer = buffer
    src = node
  } else {
    const osc = ctx.createOscillator()
    osc.type = spec.wave
    osc.frequency.setValueAtTime(spec.freq, when)
    if (spec.freqEnd !== undefined) osc.frequency.linearRampToValueAtTime(spec.freqEnd, when + spec.dur)
    src = osc
  }

  const tail: AudioNode = g
  if (spec.lowpass !== undefined) {
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = spec.lowpass
    src.connect(filter)
    filter.connect(g)
  } else {
    src.connect(g)
  }
  tail.connect(dest)
  src.start(when)
  src.stop(when + spec.dur)
}
