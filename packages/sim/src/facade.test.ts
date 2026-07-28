import { describe, expect, it } from 'vitest'
import * as sim from './index'

/**
 * LA FAÇADE EST UNE FRONTIÈRE DE SÛRETÉ, PAS UNE COMMODITÉ — et jusqu'ici elle n'était
 * tenue que par un commentaire.
 *
 * L'en-tête d'`index.ts` énonce noir sur blanc deux règles : le flux d'événements n'est
 * écrit QUE par la sim (`emitEvent`, `recordAct`, `recordHostility` ne sont pas exportés
 * — « un hôte qui les appellerait casserait le contrat de replay »), et les fonctions de
 * setup ne s'appellent qu'à la construction du monde. Or ces trois fonctions SONT
 * `export`ées de leur module : il suffit d'ajouter une ligne à `index.ts` — le réflexe
 * naturel du jour où un hôte veut « juste émettre un événement » — pour ouvrir le trou.
 * Ni `tsc`, ni `eslint`, ni aucun test ne l'aurait dit.
 *
 * Ce test rend ces règles EXÉCUTABLES — mais SANS épingler la liste entière des ~270
 * exports. C'était la première version, et elle a été retirée après contre-expertise : une
 * liste exhaustive à ré-acquitter à chaque export taxe exactement l'opération qu'on veut
 * rendre facile (« intégrer un nouveau système »), alors que toute la valeur de sûreté est
 * concentrée sur une poignée de noms interdits. On garde donc les interdits — qui ne
 * coûtent rien et disent POURQUOI —, et on laisse la façade grandir librement.
 */
describe('la façade de /sim — sa surface publique est un contrat, pas un hasard', () => {
  it('les mutateurs qui casseraient le replay ne sont PAS exposés', () => {
    // Le cœur du contrat écrit dans l'en-tête d'index.ts. Si l'un d'eux apparaît ici,
    // c'est qu'un hôte peut désormais écrire dans le flux d'événements ou dans
    // l'alignement sans passer par la sim — et le replay ne rejouera plus la partie.
    for (const interdit of ['emitEvent', 'recordAct', 'recordHostility']) {
      expect(Object.hasOwn(sim, interdit), `${interdit} ne doit pas être exporté par /sim`).toBe(false)
    }
  })

  it("n'expose rien qui trahisse un détail d'implémentation interne", () => {
    // Les fabriques d'index mémoïsés, les caches et les patchs d'index sont des dérivés
    // privés : les exposer inviterait un hôte à les tenir lui-même, donc à diverger.
    for (const interdit of ['relocateInIndex', 'nodeIndexFor', 'occupancyOf', 'blockedSubAt']) {
      expect(Object.hasOwn(sim, interdit), `${interdit} est un détail interne`).toBe(false)
    }
  })

  it('tout ce que la façade annonce est réellement défini', () => {
    // Un ré-export vers un nom disparu produit `undefined` sans casser la compilation
    // dans certains montages : on vérifie que chaque nom porte bien quelque chose.
    const noms = Object.keys(sim)
    expect(noms.length).toBeGreaterThan(100) // garde du test : la façade n'est pas vide
    const vides = noms.filter((k) => (sim as unknown as Record<string, unknown>)[k] === undefined)
    expect(vides).toEqual([])
  })
})
