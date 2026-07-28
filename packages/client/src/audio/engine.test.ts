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
