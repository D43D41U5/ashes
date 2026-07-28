import { describe, expect, it } from 'vitest'
import type { SlotMeta } from '../../worker/persistence-store'
import { repriseLaPlusRecente } from './menu-ecrans'

const meta = (savedAt: number, nom = ''): SlotMeta => ({ nom, seed: 2026, seasonDay: 3, savedAt, createdAt: 0 })

/**
 * « REPRENDRE » DOIT ROUVRIR CE QU'ON VIENT DE QUITTER — pas autre chose.
 *
 * C'est le premier bouton de l'accueil et celui qu'on presse sans lire. S'il se trompe de
 * partie, le joueur atterrit dans un monde qui n'est pas le sien ; en solo il le verra, en
 * multi il aura rejoint un serveur au hasard. On le prouve donc, y compris sur les cas
 * tordus : rien à reprendre, égalité, horodatage inconnu.
 */
describe('la partie que « REPRENDRE » rouvre', () => {
  it('n’existe PAS quand il n’y a rien à reprendre', () => {
    // L'accueil n'affiche alors pas le bouton du tout : un « REPRENDRE » grisé promettrait
    // à un nouveau venu quelque chose qu'il ne peut pas avoir.
    expect(repriseLaPlusRecente([null, null, null, null, null], null)).toBeNull()
  })

  it('prend la vallée solo la plus récemment SAUVÉE, pas la première case', () => {
    const r = repriseLaPlusRecente([meta(1000), meta(9000, 'La Combe'), meta(5000)], null)
    expect(r).toMatchObject({ genre: 'solo', slot: 1 })
  })

  it('prend le multi s’il est plus récent que toute Veillée', () => {
    const r = repriseLaPlusRecente([meta(1000)], { url: 'ws://x', nom: 'La Vallée', at: 9000 })
    expect(r).toMatchObject({ genre: 'multi', nom: 'La Vallée', url: 'ws://x' })
  })

  it('garde le solo quand c’est LUI le plus récent', () => {
    const r = repriseLaPlusRecente([meta(9000)], { url: 'ws://x', nom: 'La Vallée', at: 1000 })
    expect(r).toMatchObject({ genre: 'solo', slot: 0 })
  })

  it('à égalité parfaite, le SOLO l’emporte — il est sur ce disque, on sait ce qu’il vaut', () => {
    // Cas rare mais pas impossible (deux écritures dans la même milliseconde). On tranche
    // vers la partie dont on peut ANNONCER l'état, plutôt que vers celle dont on ne sait rien.
    const r = repriseLaPlusRecente([meta(5000)], { url: 'ws://x', nom: 'La Vallée', at: 5000 })
    expect(r).toMatchObject({ genre: 'solo' })
  })

  it('une date inconnue (0) CLASSE dernier, mais ne disqualifie pas', () => {
    // Une sauvegarde d'avant les métadonnées peut porter `savedAt: 0`. Elle reste reprenable :
    // on la propose plutôt que de laisser l'accueil muet devant une partie qui existe.
    expect(repriseLaPlusRecente([meta(0)], null)).toMatchObject({ genre: 'solo', slot: 0 })
    const r = repriseLaPlusRecente([meta(0)], { url: 'ws://x', nom: 'La Vallée', at: 1 })
    expect(r).toMatchObject({ genre: 'multi' })
  })

  it('ignore les cases vides sans se décaler d’un cran', () => {
    // Le `slot` rendu sert à OUVRIR la sauvegarde : un décalage d'index ouvrirait la voisine.
    const r = repriseLaPlusRecente([null, null, meta(4000)], null)
    expect(r).toMatchObject({ genre: 'solo', slot: 2 })
  })
})
