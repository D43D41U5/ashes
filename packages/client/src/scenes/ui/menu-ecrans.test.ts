import { describe, expect, it } from 'vitest'
import type { SlotMeta } from '../../worker/persistence-store'
import { repriseLaPlusRecente } from './menu-ecrans'
import { EFFACER_ARMEMENT_MS, effacerArme } from './menu-dom'

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

/**
 * LE SEUL GESTE SANS RETOUR DU JEU NE DOIT PAS SE DÉCLENCHER PAR RÉFLEXE.
 *
 * Mesuré au pixel sur les captures du banc : la croix ✕ d'une ligne de vallée a son centre
 * en (327 ; 471,5) et le bouton EFFACER qui la REMPLACE occupe x[276,337] × y[468,490]. Le
 * centre de la croix tombe donc DANS le rectangle du bouton de destruction — et le passage
 * de l'un à l'autre est un repaint SYNCHRONE, sans délai ni garde. Un double-clic, un clic
 * réflexe de confirmation, une souris qui rebondit : le monde est parti.
 *
 * On arme donc le bouton après un souffle, et on le prouve dans les deux sens — un remède
 * qu'on ne voit jamais refuser n'est pas un remède.
 * (Audit UX 2026-08-20, P2 ① / L1-01.)
 */
describe('le bouton EFFACER s’arme après un souffle', () => {
  it('REFUSE le clic réflexe qui suit immédiatement l’apparition', () => {
    expect(effacerArme(1000, 1000)).toBe(false) // le rebond, à 0 ms
    expect(effacerArme(1000, 1000 + EFFACER_ARMEMENT_MS - 1)).toBe(false) // juste avant
  })

  it('ACCEPTE le clic délibéré', () => {
    expect(effacerArme(1000, 1000 + EFFACER_ARMEMENT_MS)).toBe(true)
    expect(effacerArme(1000, 1000 + 3000)).toBe(true) // on a lu la phrase, puis on tranche
  })

  it('le délai passe le double-clic système sans se faire sentir', () => {
    // Au-dessus du rebond et du double-clic, sous le seuil où un bouton paraît « mou ».
    expect(EFFACER_ARMEMENT_MS).toBeGreaterThanOrEqual(250)
    expect(EFFACER_ARMEMENT_MS).toBeLessThanOrEqual(500)
  })
})
