/**
 * LE SOL QUI TRAVAILLE — ce qui se prouve sans navigateur.
 *
 * Ce chantier a deux moitiés, et une seule peut mentir en silence.
 *
 * Ce qui SE VOIT (la terre qui vole, le tertre qui enfle, le corps qui sort du trou) se juge
 * à l'œil, au smoke : une capture le montre ou ne le montre pas.
 *
 * Ce qui NE SE VOIT PAS est ici, et c'est là qu'est tout le risque :
 *
 *   1. `cendreux_risen` a DEUX émetteurs — la levée d'un cadavre (couché SUR le sol, il ne
 *      creuse rien) et l'émergence d'un réveil. Les confondre ferait creuser un cadavre, et
 *      ça ne se remarquerait qu'en tombant par hasard sur la seule levée de la saison.
 *   2. `advanceReveils` RETIRE le réveil de l'état au tick même où il émet l'événement : le
 *      message qui porte le fait ne porte plus le site. Une reconnaissance par présence
 *      n'aurait jamais reconnu une seule émergence — et l'animation serait restée muette
 *      sans que rien ne casse.
 *   3. Les rampes. Un cran rejoué à chaque image noierait le tertre sous sa propre gerbe ;
 *      une échelle rapportée au cran ferait pulser le tertre au lieu de le faire pousser.
 *
 * Les gardes de géométrie BALAIENT leur intervalle entier plutôt que trois points choisis :
 * une pente ne se prouve pas sur des échantillons.
 */
import { describe, expect, it } from 'vitest'
import type { Reveil } from '@ashes/sim'
import { TERRAIN_COLORS } from '../../render/terrain-colors'
import { familleDe } from '../../render/grain-sol'
import { nuance } from './recolte-fx'
import {
  cleSite,
  echelleMonticule,
  enfouissement,
  ENFOUISSEMENT_MAX,
  ETOUFFEMENT_MS,
  EXTRACTION_MS,
  MONTICULE_ECHELLE_MIN,
  REVEIL_MS,
  REVEIL_STADES,
  SITE_OUBLI_MS,
  SolsAuTravail,
  stadeMonticule,
  terreDe,
  TERRE_FRAICHE,
  TON_TERRE,
} from './reveil-fx'

/** Un réveil planté au tick 0, qui s'ouvrira au bout de sa rampe. */
function reveil(x: number, y: number): Reveil {
  return { x, y, at: (REVEIL_MS * 20) / 1000, preyId: 1 }
}

/** Les composantes d'une couleur 0xRRGGBB. */
function rgb(c: number): [number, number, number] {
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]
}

describe('la rampe du tertre — continue sur TOUT l’élément, bornes exactes', () => {
  it('part exactement de son minimum et arrive exactement à 1', () => {
    expect(echelleMonticule(0)).toBe(MONTICULE_ECHELLE_MIN)
    expect(echelleMonticule(1)).toBe(1)
  })

  it('ne redescend JAMAIS, sur tout l’intervalle — un tertre qui pulse lit comme un défaut', () => {
    // C'est le piège que le découpage en crans tend : une échelle rapportée au stade
    // repart à zéro quatre fois. On balaie donc les 4 s au pas de 10 ms, pas trois points.
    let precedente = -1
    for (let a = 0; a <= 1.0000001; a += 0.0025) {
      const e = echelleMonticule(a)
      expect(e).toBeGreaterThan(precedente)
      precedente = e
    }
  })

  it('reste bornée hors de [0, 1] : un recalage de snapshot ne fait pas exploser le tertre', () => {
    expect(echelleMonticule(-0.5)).toBe(MONTICULE_ECHELLE_MIN)
    expect(echelleMonticule(2)).toBe(1)
  })
})

describe('les crans — quatre, francs, tous atteints', () => {
  it('les visite TOUS et dans l’ordre, sans en sauter un', () => {
    const vus: number[] = []
    for (let a = 0; a <= 1.0000001; a += 0.001) {
      const s = stadeMonticule(a)
      if (vus[vus.length - 1] !== s) vus.push(s)
    }
    expect(vus).toEqual([...Array(REVEIL_STADES).keys()])
  })

  it('commence à 0 dès le premier instant : le préavis démarre avec la rampe', () => {
    expect(stadeMonticule(0)).toBe(0)
  })

  it('finit au dernier cran et n’en déborde pas', () => {
    expect(stadeMonticule(1)).toBe(REVEIL_STADES - 1)
    expect(stadeMonticule(1.5)).toBe(REVEIL_STADES - 1)
  })
})

describe('l’enfouissement — de la tête qui perce au corps posé', () => {
  it('part du sommet du crâne (pas d’une frame vide) et finit exactement au sol', () => {
    expect(enfouissement(0, 0)).toBe(ENFOUISSEMENT_MAX)
    expect(enfouissement(EXTRACTION_MS, 0)).toBe(0)
  })

  it('ne remonte jamais, sur toute la durée de l’extraction', () => {
    let precedent = ENFOUISSEMENT_MAX + 1
    for (let t = 0; t <= EXTRACTION_MS; t += 5) {
      const e = enfouissement(t, 0)
      expect(e).toBeLessThan(precedent)
      precedent = e
    }
  })

  it('reste à zéro après coup : un corps sorti ne se réenterre pas', () => {
    expect(enfouissement(EXTRACTION_MS * 3, 0)).toBe(0)
  })

  it('DÉCOLLE lentement et FINIT lentement — c’est l’effort qui se lit, pas un ascenseur', () => {
    // À un quart du temps, une rampe linéaire aurait déjà rendu 25 % de la hauteur. Le
    // smoothstep en rend moins : il pousse encore contre la terre.
    const quart = 1 - enfouissement(EXTRACTION_MS * 0.25, 0) / ENFOUISSEMENT_MAX
    expect(quart).toBeLessThan(0.25)
    // Au milieu il est passé à la moitié pile — la vitesse maximale est au centre.
    expect(1 - enfouissement(EXTRACTION_MS * 0.5, 0) / ENFOUISSEMENT_MAX).toBeCloseTo(0.5, 6)
    // Aux trois quarts, l'inverse : il est plus avancé qu'une rampe droite, il se pose.
    expect(1 - enfouissement(EXTRACTION_MS * 0.75, 0) / ENFOUISSEMENT_MAX).toBeGreaterThan(0.75)
  })
})

describe('cleSite — la reconnaissance ne repose pas sur l’égalité de deux flottants', () => {
  it('rapproche deux coordonnées que le transport a fait dériver', () => {
    expect(cleSite(12.5, 30.5)).toBe(cleSite(12.500001, 30.499999))
  })

  it('sépare deux tuiles voisines : un site ne déteint pas sur celui d’à côté', () => {
    expect(cleSite(12.5, 30.5)).not.toBe(cleSite(13.5, 30.5))
    expect(cleSite(12.5, 30.5)).not.toBe(cleSite(12.5, 31.5))
  })
})

describe('LA GARDE CENTRALE — un cadavre qui se lève ne creuse pas', () => {
  it('refuse un `cendreux_risen` dont le site n’a jamais travaillé', () => {
    const sols = new SolsAuTravail()
    // C'est exactement la levée d'un cadavre (`advanceCendreux`) : même événement, même
    // forme, aucun réveil derrière. Elle ne doit RIEN déclencher.
    expect(sols.emerger(40.5, 40.5, 7, 1000)).toBeNull()
    expect(sols.extractionsEnCours).toBe(0)
    expect(sols.enfouissementDe(7, 1000)).toBe(0)
  })

  it('reconnaît une émergence dont le sol a travaillé', () => {
    const sols = new SolsAuTravail()
    sols.suivre([reveil(12.5, 30.5)], 0, 0)
    expect(sols.emerger(12.5, 30.5, 7, REVEIL_MS)).not.toBeNull()
    expect(sols.enfouissementDe(7, REVEIL_MS)).toBe(ENFOUISSEMENT_MAX)
  })

  it('ne reconnaît PAS une levée qui tombe à côté d’un réveil en cours', () => {
    const sols = new SolsAuTravail()
    sols.suivre([reveil(12.5, 30.5)], 0, 0)
    expect(sols.emerger(40.5, 40.5, 8, 1000)).toBeNull()
    expect(sols.solsAuTravail).toBe(1) // et le vrai réveil continue son travail
  })
})

describe('LA PRÉMISSE — le site survit à sa disparition du snapshot', () => {
  it('reconnaît l’émergence alors que `reveils` est DÉJÀ vide', () => {
    // `advanceReveils` retire le réveil de l'état AU TICK MÊME où il émet l'événement : le
    // message qui porte `cendreux_risen` ne porte plus le site. Une garde par présence
    // n'aurait jamais rien reconnu — et rien n'aurait cassé, l'animation serait restée muette.
    //
    // On rejoue le VRAI flux, snapshot par snapshot (20 Hz) : chacun porte le réveil, sauf
    // le dernier — celui qui porte le fait. C'est la seule façon d'affirmer la prémisse sans
    // se donner un scénario de complaisance.
    const sols = new SolsAuTravail()
    const PAS = 1000 / 20
    for (let t = 0; t < REVEIL_MS; t += PAS) {
      const reste = Math.round(((REVEIL_MS - t) * 20) / 1000)
      sols.suivre([{ x: 12.5, y: 30.5, at: reste, preyId: 1 }], 0, t)
      sols.avancer(t)
    }
    sols.suivre([], 80, REVEIL_MS) // le snapshot de la sortie : la liste est vide
    expect(sols.emerger(12.5, 30.5, 7, REVEIL_MS)).not.toBeNull()
  })

  it('tient une coupure de rendu d’une seconde — une frame lente ne perd pas l’émergence', () => {
    // Le rendu logiciel du smoke tourne à ~3 im/s et le réseau hoquette : la fenêtre doit
    // être large devant l'intervalle des snapshots, sans quoi l'animation serait muette
    // exactement là où on essaie de la constater.
    const sols = new SolsAuTravail()
    sols.suivre([reveil(12.5, 30.5)], 0, 0)
    expect(sols.emerger(12.5, 30.5, 7, 1000)).not.toBeNull()
  })

  it('oublie un site que plus aucun snapshot ne montre, passé le délai', () => {
    const sols = new SolsAuTravail()
    sols.suivre([reveil(12.5, 30.5)], 0, 0)
    sols.suivre([], 80, SITE_OUBLI_MS + 1)
    expect(sols.solsAuTravail).toBe(0)
    // …et un `cendreux_risen` tardif sur cette tuile n'est plus une émergence.
    expect(sols.emerger(12.5, 30.5, 7, SITE_OUBLI_MS + 1)).toBeNull()
  })

  it('garde un site dont le snapshot précédent est plus récent que le délai', () => {
    const sols = new SolsAuTravail()
    sols.suivre([reveil(12.5, 30.5)], 0, 0)
    sols.suivre([], 80, SITE_OUBLI_MS - 1)
    expect(sols.solsAuTravail).toBe(1)
  })
})

describe('les ruptures — une par cran, jamais deux', () => {
  it('ne rend chaque cran qu’UNE fois, même appelée soixante fois par seconde', () => {
    // Le piège : `avancer` est appelée à chaque image. Sans mémoire du cran joué, la terre
    // repartirait à chaque frame et le tertre disparaîtrait sous sa propre gerbe.
    const sols = new SolsAuTravail()
    sols.suivre([reveil(12.5, 30.5)], 0, 0)
    let total = 0
    for (let t = 0; t <= REVEIL_MS; t += 1000 / 60) total += sols.avancer(t).length
    expect(total).toBe(REVEIL_STADES)
  })

  it('monte en intensité d’un cran à l’autre : le sol s’ouvre, il ne bégaie pas', () => {
    const sols = new SolsAuTravail()
    sols.suivre([reveil(12.5, 30.5)], 0, 0)
    const forces: number[] = []
    for (let t = 0; t <= REVEIL_MS; t += 1000 / 60) for (const r of sols.avancer(t)) forces.push(r.force)
    expect(forces).toHaveLength(REVEIL_STADES)
    for (let i = 1; i < forces.length; i++) expect(forces[i]!).toBeGreaterThan(forces[i - 1]!)
    // Et la sortie est plus forte que le dernier cran du sol : c'est lui qui CÈDE.
    const sortie = sols.emerger(12.5, 30.5, 7, REVEIL_MS)
    expect(sortie!.force).toBeGreaterThan(forces[forces.length - 1]!)
  })

  it('avance la rampe sans jamais la faire reculer, malgré le recalage des snapshots', () => {
    // Chaque snapshot recale `finAt` sur l'horloge client ; une dérive de quelques ms ferait
    // rétrécir le tertre d'une image si l'avancement n'était pas monotone.
    const sols = new SolsAuTravail()
    let precedente = -1
    for (let t = 0; t <= REVEIL_MS; t += 50) {
      // Le réveil se rapproche de son terme, et le snapshot dérive de ±8 ms.
      const reste = Math.max(0, Math.round(((REVEIL_MS - t) * 20) / 1000))
      sols.suivre([{ x: 12.5, y: 30.5, at: reste, preyId: 1 }], 0, t + (t % 100 === 0 ? 8 : -8))
      sols.avancer(t)
      const m = sols.monticules(t)[0]!
      expect(m.echelle).toBeGreaterThanOrEqual(precedente)
      precedente = m.echelle
    }
  })
})

describe('l’étouffement — le feu a gagné, et ça se voit', () => {
  it('retire le sol du travail et ne fait sortir PERSONNE', () => {
    const sols = new SolsAuTravail()
    sols.suivre([reveil(12.5, 30.5)], 0, 0)
    sols.avancer(REVEIL_MS / 2)
    sols.etouffer(12.5, 30.5, REVEIL_MS / 2)
    expect(sols.solsAuTravail).toBe(0)
    expect(sols.extractionsEnCours).toBe(0)
  })

  it('laisse un tas qui S’AFFAISSE, là où une sortie laisse un trou OUVERT', () => {
    const affaisse = new SolsAuTravail()
    affaisse.suivre([reveil(12.5, 30.5)], 0, 0)
    affaisse.avancer(REVEIL_MS)
    affaisse.etouffer(12.5, 30.5, REVEIL_MS)

    const ouvert = new SolsAuTravail()
    ouvert.suivre([reveil(12.5, 30.5)], 0, 0)
    ouvert.avancer(REVEIL_MS)
    ouvert.emerger(12.5, 30.5, 7, REVEIL_MS)

    // À mi-vie de l'affaissement, le tas a rapetissé ; le trou de la sortie, lui, est resté
    // à sa pleine ouverture. Les deux fins ne se ressemblent pas — c'est tout le propos.
    const a = affaisse.monticules(REVEIL_MS + ETOUFFEMENT_MS / 2)[0]!
    const o = ouvert.monticules(REVEIL_MS + ETOUFFEMENT_MS / 2)[0]!
    expect(a.echelle).toBeLessThan(1)
    expect(o.echelle).toBe(1)
    expect(a.alpha).toBeLessThan(o.alpha)
  })

  it('s’efface complètement quand sa vie est passée', () => {
    const sols = new SolsAuTravail()
    sols.suivre([reveil(12.5, 30.5)], 0, 0)
    sols.etouffer(12.5, 30.5, 0)
    expect(sols.monticules(ETOUFFEMENT_MS + 1)).toHaveLength(0)
  })

  it('accepte un étouffement sur un site jamais vu — il peut tomber au premier tick', () => {
    const sols = new SolsAuTravail()
    sols.etouffer(12.5, 30.5, 0)
    expect(sols.monticules(10)).toHaveLength(1)
  })
})

describe('l’extraction — elle se purge, et un id d’entité se recycle', () => {
  it('rend zéro et cesse de suivre une entité sortie pour de bon', () => {
    const sols = new SolsAuTravail()
    sols.suivre([reveil(12.5, 30.5)], 0, 0)
    sols.emerger(12.5, 30.5, 7, 0)
    expect(sols.extractionsEnCours).toBe(1)
    expect(sols.enfouissementDe(7, EXTRACTION_MS)).toBe(0)
    expect(sols.extractionsEnCours).toBe(0)
  })

  it('oublie une entité abattue en pleine extraction', () => {
    const sols = new SolsAuTravail()
    sols.suivre([reveil(12.5, 30.5)], 0, 0)
    sols.emerger(12.5, 30.5, 7, 0)
    sols.oublier(7)
    expect(sols.enfouissementDe(7, EXTRACTION_MS / 2)).toBe(0)
  })

  it('ne fait sortir de terre que celui qui en sort — jamais son voisin', () => {
    const sols = new SolsAuTravail()
    sols.suivre([reveil(12.5, 30.5)], 0, 0)
    sols.emerger(12.5, 30.5, 7, 0)
    expect(sols.enfouissementDe(8, 0)).toBe(0)
  })
})

describe('ce qui sort du trou — de la TERRE, teintée par ce qu’il y a dessus', () => {
  const somme = (c: number): number => rgb(c).reduce((a, x) => a + x, 0)
  /** Combien un ton penche vers le vert, contre ses deux autres canaux. */
  const verdeur = (c: number): number => {
    const [r, v, b] = rgb(c)
    return v - (r + b) / 2
  }

  it('SE DÉTACHE de sa surface sur tous les sols où l’on peut creuser', () => {
    // La propriété qui compte n'est pas « plus sombre » — c'est « VISIBLE ». Sous une vieille
    // forêt, presque noire, un tas de terre est plus CLAIR qu'elle, et c'est très bien : ce
    // qu'il faut, c'est qu'on le voie. On balaie donc tous les terrains DIGGABLES (ceux qui
    // ont une famille de sol) et on affirme un écart, dans un sens ou dans l'autre.
    //
    // Les terrains SANS famille — eau, falaise, mur, void — sont hors sujet : `siteDansLaCouronne`
    // n'y plante jamais de réveil, ils ne sont pas marchables.
    for (const id of Object.keys(TERRAIN_COLORS).map(Number)) {
      if (familleDe(id) === null) continue
      const t = rgb(terreDe(id))
      const s = rgb(TERRAIN_COLORS[id]!)
      const ecart = t.reduce((a, x, i) => a + Math.abs(x - s[i]!), 0)
      expect(ecart).toBeGreaterThanOrEqual(30)
    }
  })

  it('NE SORT JAMAIS VERT, sur aucun terrain — c’est le défaut constaté à l’écran', () => {
    // La première version assombrissait le terrain tel quel : sous les arbres, le tertre
    // sortait vert et se lisait comme un buisson de plus, au milieu d'un décor qui en est
    // plein. La garde porte sur TOUS les terrains, y compris les plus verts du jeu.
    for (const id of Object.keys(TERRAIN_COLORS).map(Number)) {
      expect(verdeur(terreDe(id))).toBeLessThan(12)
    }
  })

  it('est plus terreuse que sa surface partout où il y a de la terre dessous', () => {
    // Herbe, forêt, vieille forêt, pré fleuri : la surface est franchement verte, le tas non.
    for (const id of [1, 3, 22, 17]) {
      expect(verdeur(terreDe(id))).toBeLessThan(verdeur(TERRAIN_COLORS[id]!))
    }
  })

  it('mais la NEIGE reste de la neige, et l’éboulis du gravier', () => {
    // C'est l'autre moitié de la règle : là, ce qu'on déterre EST la surface. Les deux
    // doivent rester nettement plus clairs que ce que rend un sol de forêt.
    const foret = somme(terreDe(3))
    expect(somme(terreDe(10))).toBeGreaterThan(foret * 1.8) // neige
    expect(somme(terreDe(9))).toBeGreaterThan(foret * 1.3) // éboulis
  })

  it('garde l’ORDRE des sols : la neige remuée reste plus claire que la vieille forêt remuée', () => {
    expect(somme(terreDe(10))).toBeGreaterThan(somme(terreDe(22)))
  })

  it('rend la TERRE NUE hors carte — un banc headless ne peint pas un sol faux', () => {
    expect(terreDe(null)).toBe(nuance(TON_TERRE, TERRE_FRAICHE))
  })
})
