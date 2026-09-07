/**
 * ═══ A32-A33 — LES MURMURES (spec `cendre.md` R27) ═══
 *
 * Le banc joue la VRAIE carte (`carteDeTest`, MONDE_JOUE — le monde joué, jamais le défaut :
 * la leçon des sondes qui disaient « atteignable » sur un monde que personne ne joue) avec un
 * âge de cendre AVANCÉ : la bande vieille et ses morts existent pour de vrai, le banc ne
 * fabrique aucune prémisse.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, HUNT } from './balance'
import { foyersDeLaCarte } from './cendre'
import { niveauDuCorps, palierDuSol } from './etages'
import { drainEvents } from './events'
import { spawnMonster } from './monsters'
import { advanceMurmures, MURMURE, sitesDeLaNuit } from './murmure'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { dayTicksPourJour, TICKS_PER_CYCLE } from './time'
import { MONDE, MONDE_JOUE } from './zonegraph'
import { carteDeTest } from '../../../tools/carte-cache'

/** Une salle sous le palier du sol : G-R1 — une salle de niveau 1 s'ouvre sur le palier −2 ;
 *  celle de niveau 0 (`-1` ici) passe sous le palier 0, celui de la vieille cendre. */
const SOUS_LA_ROCHE = -1

const SEED = 2026
const monde = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE)

/** Le banc : la vraie carte, la cendre MÛRE (200 jours d'âge — la vieille bande est vaste),
 *  et la NUIT (le cycle commence au lever ; après `dayTicks`, c'est elle). */
function banc(): SimState {
  const sim = createSim(SEED, { map: monde.map, faunaCap: 0, worldEvents: false, meteoActive: false })
  sim.cendreAge = foyersDeLaCarte(monde.map).map(() => 200)
  sim.tick = dayTicksPourJour(1) + Math.floor((TICKS_PER_CYCLE - dayTicksPourJour(1)) / 2)
  drainEvents(sim)
  return sim
}

describe('A32 — dérivé, stable, nocturne, et muet au PRNG', () => {
  it('des sites existent sur la carte mûre, les mêmes pour deux sims de même seed', () => {
    const a = banc()
    const b = banc()
    const sa = sitesDeLaNuit(a)
    expect(sa.length, 'la vieille cendre murmure quelque part — la prémisse du banc').toBeGreaterThan(0)
    expect(sitesDeLaNuit(b)).toEqual(sa)
  })

  it('de JOUR, rien — le murmure est une affaire de nuit', () => {
    const sim = banc()
    sim.tick = Math.floor(dayTicksPourJour(1) / 2) // midi du même cycle
    expect(sitesDeLaNuit(sim)).toHaveLength(0)
  })

  it('ni l’énumération ni la passe ne consomment UN tirage du PRNG d’état', () => {
    const sim = banc()
    const site = sitesDeLaNuit(sim)[0]!
    spawnEntity(sim, site.tx + 0.5, site.ty + 0.5)
    const avant = sim.rngState
    sitesDeLaNuit(sim)
    advanceMurmures(sim)
    expect(sim.rngState, 'le flux RNG du reste du jeu ne bouge pas').toBe(avant)
  })
})

describe('A33 — le calme donne une fois, le bruit et le Cendreux ne donnent pas', () => {
  it('un visiteur immobile à portée reçoit UN murmure — et le même site ne redonne pas', () => {
    const sim = banc()
    const site = sitesDeLaNuit(sim)[0]!
    const id = spawnEntity(sim, site.tx + 0.5, site.ty + 0.5)
    advanceMurmures(sim)
    const recueillis = drainEvents(sim).filter((e) => e.type === 'murmure_recueilli')
    expect(recueillis).toHaveLength(1)
    expect((recueillis[0] as { entityId: number }).entityId).toBe(id)
    // La passe suivante : le site lui a déjà parlé — silence, pas un événement par tick.
    advanceMurmures(sim)
    expect(drainEvents(sim).filter((e) => e.type === 'murmure_recueilli')).toHaveLength(0)
  })

  it('le murmure traverse le VRAI tick (la phase est branchée, pas seulement testée seule)', () => {
    const sim = banc()
    const site = sitesDeLaNuit(sim)[0]!
    const id = spawnEntity(sim, site.tx + 0.5, site.ty + 0.5)
    step(sim, [{ entityId: id, dx: 0, dy: 0 }])
    expect(drainEvents(sim).some((e) => e.type === 'murmure_recueilli')).toBe(true)
  })

  it('un SPRINTEUR à portée ne reçoit rien — la même lecture d’allure que la chasse', () => {
    const sim = banc()
    const site = sitesDeLaNuit(sim)[0]!
    const id = spawnEntity(sim, site.tx + 0.5, site.ty + 0.5)
    const e = sim.entities.find((x) => x.id === id)!
    e.gait = 'sprint'
    advanceMurmures(sim)
    expect(drainEvents(sim).filter((ev) => ev.type === 'murmure_recueilli')).toHaveLength(0)
  })

  it('un Cendreux à portée rend le site MUET', () => {
    const sim = banc()
    const site = sitesDeLaNuit(sim)[0]!
    spawnMonster(sim, 'cendreux', site.tx + 1.5, site.ty + 0.5)
    spawnEntity(sim, site.tx + 0.5, site.ty + 0.5)
    advanceMurmures(sim)
    expect(drainEvents(sim).filter((ev) => ev.type === 'murmure_recueilli')).toHaveLength(0)
  })

  it('le seuil du calme sépare vraiment les allures (garde des constantes)', () => {
    // La marche pleine vaut ~VIS_WALK (× couvert ≤ 1), le sprint part de VIS_SPRINT : le
    // seuil doit passer ENTRE — écrit avec les constantes SOURCES, jamais leurs valeurs
    // (l'étalon d'une garde n'est pas le nombre qu'elle teste).
    expect(MURMURE.SEUIL_CALME).toBeGreaterThan(HUNT.VIS_WALK)
    expect(MURMURE.SEUIL_CALME).toBeLessThan(HUNT.VIS_SPRINT)
  })
})

/**
 * ═══ E-A3 — UN PLANCHER FAIT TAIRE LE MURMURE AUSSI (spec `etages.md` §19-20) ═══
 *
 * Les deux sites de `murmure.ts` étaient branchés sur l'accesseur le 2026-09-07 mais laissés
 * SANS garde behaviorale : on croyait devoir monter une bande de cendre sur la mesa de
 * laboratoire. C'était inutile — le banc de ce fichier joue DÉJÀ la vraie carte mûre. Il ne
 * manquait qu'un corps sous la roche.
 *
 * ⚠ **CE QUI LES FERAIT ROUGIR** : `atteignableEntreEtages` à `return true` — les deux cas
 * « à travers le plancher » passeraient alors. Et chaque cas garde son TÉMOIN au même étage
 * (déjà tenu par les cas d'A33 ci-dessus, repris ici pour être lus ensemble).
 */
describe('E-A3 — le murmure ne traverse pas un plancher', () => {
  /** LA PRÉMISSE, AFFIRMÉE ET NON SUPPOSÉE : un site assez loin de tout connecteur pour qu'une
   *  salle en dessous ne le rejoigne pas (E-R5 : « à moins de `ETAGE_PORTEE_CONNECTEUR` d'un
   *  connecteur qui les relie »). Sans elle, la garde mesurerait l'inverse de ce qu'elle croit. */
  function siteLoinDesConnecteurs(sim: SimState): { tx: number; ty: number; id: number } {
    const p = BALANCE.ETAGE_PORTEE_CONNECTEUR + 1
    const site = sitesDeLaNuit(sim).find(
      (s) => !(monde.map.connecteurs ?? []).some((c) => Math.abs(c.x - s.tx) <= p && Math.abs(c.y - s.ty) <= p),
    )
    expect(site, 'la carte mûre offre un site hors de portée de tout connecteur').toBeDefined()
    return site!
  }

  it('LE VISITEUR : on ne reçoit pas d’une salle un murmure qui se lit de la CENDRE', () => {
    const sim = banc()
    const site = siteLoinDesConnecteurs(sim)
    const id = spawnEntity(sim, site.tx + 0.5, site.ty + 0.5)
    const e = sim.entities.find((x) => x.id === id)!
    e.etage = SOUS_LA_ROCHE
    expect(niveauDuCorps(sim.map, e), 'prémisse : le visiteur n’est PAS au palier du site')
      .not.toBe(palierDuSol(sim.map, site.tx, site.ty))
    advanceMurmures(sim)
    expect(drainEvents(sim).filter((ev) => ev.type === 'murmure_recueilli')).toHaveLength(0)
    // TÉMOIN : le même visiteur au sol reçoit bien (c'est le premier cas d'A33, rejoué ici).
    const clair = banc()
    spawnEntity(clair, site.tx + 0.5, site.ty + 0.5)
    advanceMurmures(clair)
    expect(drainEvents(clair).filter((ev) => ev.type === 'murmure_recueilli')).toHaveLength(1)
  })

  it('LE CENDREUX : celui qui rôde SOUS la roche ne fait pas taire un site de surface', () => {
    const sim = banc()
    const site = siteLoinDesConnecteurs(sim)
    const beteId = spawnMonster(sim, 'cendreux', site.tx + 1.5, site.ty + 0.5)
    sim.entities.find((x) => x.id === beteId)!.etage = SOUS_LA_ROCHE
    spawnEntity(sim, site.tx + 0.5, site.ty + 0.5)
    advanceMurmures(sim)
    expect(
      drainEvents(sim).filter((ev) => ev.type === 'murmure_recueilli'),
      'sous la roche, il ne dissipe rien — « ce qui vient » doit pouvoir vous atteindre',
    ).toHaveLength(1)
    // TÉMOIN : le même Cendreux au sol rend bien le site muet (c'est le dernier cas d'A33).
  })
})
