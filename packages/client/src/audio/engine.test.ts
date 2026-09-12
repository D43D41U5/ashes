import { afterEach, describe, expect, it } from 'vitest'
import { SoundEngine } from './engine'

/**
 * CE QUE CE FICHIER GARDE : les réglages de son du JOUEUR n'appartiennent qu'à la partie.
 *
 * Le banc d'écoute (`banc-son.html`) monte le VRAI moteur — c'est tout son intérêt — et il est
 * servi par le même Vite, donc sur la même origine, donc sur le même `localStorage` que le jeu.
 * Son curseur de volume écrivait par conséquent dans `braises.audio.volume` : caler un son à
 * bas volume rendait la Veillée muette, et le silence survivait au rechargement sans qu'aucun
 * écran du jeu n'en dise la cause. D'où `persist: false`, et d'où cette garde.
 */

/** Un `localStorage` de papier — les tests client tournent sur Node, qui n'en a pas. */
function fauxStockage(initial: Record<string, string> = {}): Record<string, string> {
  const data = { ...initial }
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v
    },
  }
  return data
}

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage
})

describe('SoundEngine et les réglages persistés', () => {
  it('le moteur du JEU relit et réécrit les réglages du joueur', () => {
    const disque = fauxStockage({ 'braises.audio.volume': '0.25', 'braises.audio.muted': '1' })
    const moteur = new SoundEngine()
    expect(moteur.getVolume()).toBe(0.25)
    expect(moteur.isMuted()).toBe(true)

    moteur.setVolume(0.5)
    moteur.toggleMute()
    expect(disque['braises.audio.volume']).toBe('0.5')
    expect(disque['braises.audio.muted']).toBe('0')
  })

  it("un moteur JETABLE (banc d'écoute) n'écrit JAMAIS dans les réglages du jeu", () => {
    const disque = fauxStockage({ 'braises.audio.volume': '0.8', 'braises.audio.muted': '0' })
    const banc = new SoundEngine({ persist: false })

    banc.setVolume(0) // le geste exact qui rendait le jeu muet : on descend le curseur du banc
    banc.toggleMute()

    expect(banc.getVolume()).toBe(0) // le banc, lui, obéit
    expect(disque['braises.audio.volume']).toBe('0.8') // …et le jeu ne bouge pas d'un cran
    expect(disque['braises.audio.muted']).toBe('0')
  })

  it("un moteur JETABLE ne se laisse pas non plus muter par un réglage du jeu", () => {
    fauxStockage({ 'braises.audio.volume': '0', 'braises.audio.muted': '1' })
    const banc = new SoundEngine({ persist: false })
    // Sinon un jeu coupé rendait le banc silencieux, et l'on cherchait la panne dans le son.
    expect(banc.getVolume()).toBe(1)
    expect(banc.isMuted()).toBe(false)
  })
})

/**
 * LES NAPPES ET LEUR GRAPHE (B1, 2026-09-12). Un `AudioContext` de papier qui note ses nœuds : ce
 * qu'on garde, c'est que la forme `cascade` seule reçoit un panoramique — la pluie et le vent
 * gardent leur graphe d'avant (un `StereoPannerNode` à pan 0 sort à cos(π/4) par canal : le leur
 * poser leur ôterait 3 dB sans que personne l'ait demandé) — et que `regler(…, pan)` le rampe.
 */
interface FauxParam {
  value: number
  cible: number | undefined
  cancelScheduledValues(t: number): void
  setValueAtTime(v: number, t: number): void
  linearRampToValueAtTime(v: number, t: number): void
}
const fauxParam = (v = 0): FauxParam => ({
  value: v,
  cible: undefined,
  cancelScheduledValues() {},
  setValueAtTime(x) { this.value = x },
  linearRampToValueAtTime(x) { this.cible = x },
})

function fauxContexte(): { ctx: unknown; panners: { pan: FauxParam }[]; filtres: { type: string; frequency: FauxParam }[]; gains: { gain: FauxParam }[] } {
  const panners: { pan: FauxParam }[] = []
  const filtres: { type: string; frequency: FauxParam }[] = []
  const gains: { gain: FauxParam }[] = []
  const noeud = <T extends object>(extra: T): T & { connect(): void } => ({ ...extra, connect() {} })
  const ctx = {
    state: 'running',
    currentTime: 0,
    sampleRate: 100,
    destination: {},
    resume: () => Promise.resolve(),
    createGain: () => { const g = noeud({ gain: fauxParam() }); gains.push(g); return g },
    createBuffer: (_c: number, frames: number) => ({ getChannelData: () => new Float32Array(frames) }),
    createBufferSource: () => noeud({ buffer: null, loop: false, start() {}, stop() {} }),
    createBiquadFilter: () => { const f = noeud({ type: 'lowpass', Q: fauxParam(1), frequency: fauxParam(350) }); filtres.push(f); return f },
    createOscillator: () => noeud({ type: 'sine', frequency: fauxParam(440), start() {}, stop() {} }),
    createStereoPanner: () => { const p = noeud({ pan: fauxParam() }); panners.push(p); return p },
  }
  return { ctx, panners, filtres, gains }
}

describe('SoundEngine.nappe — le graphe de chaque forme', () => {
  it("la cascade seule a un panoramique, et `regler(…, pan)` le rampe ; la pluie et le vent n'en ont pas", () => {
    fauxStockage()
    const { ctx, panners, filtres } = fauxContexte()
    ;(globalThis as unknown as { window: unknown }).window = { AudioContext: function () { return ctx } }
    try {
      const moteur = new SoundEngine({ persist: false })
      moteur.resume()
      expect(moteur.isReady()).toBe(true)

      moteur.nappe('pluie')
      moteur.nappe('vent')
      expect(panners).toHaveLength(0)
      expect(filtres.map((f) => f.type)).toEqual(['lowpass', 'bandpass'])

      const cascade = moteur.nappe('cascade')!
      expect(cascade).not.toBeNull()
      expect(panners).toHaveLength(1)
      expect(filtres[2]!.type).toBe('lowpass')
      cascade.regler(0.04, 900, 0.5, 0.42)
      expect(panners[0]!.pan.cible).toBeCloseTo(0.42, 9)
      expect(filtres[2]!.frequency.cible).toBe(900)
      // Le pan est borné : on ne colle jamais un son dans une seule oreille.
      cascade.regler(0.04, 900, 0.5, 3)
      expect(panners[0]!.pan.cible).toBe(1)
      // Une nappe sans pan (la pluie) accepte toujours `regler` à trois arguments.
      moteur.nappe('pluie')!.regler(0.02, 1600, 1.2)
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window
    }
  })
})
