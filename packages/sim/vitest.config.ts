import { defineConfig } from 'vitest/config'

/**
 * LE HARNAIS DE /sim — et il n'en avait aucun jusqu'ici, donc `testTimeout` valait 5 s.
 *
 * Ce n'est pas une valeur tenable ici : plusieurs tests du projet simulent une JOURNÉE de saison
 * entière (`alignment.test.ts` — « le paquebot »), ou une session solo complète
 * (`session.test.ts`), et la règle de méthode du projet veut qu'ils tournent **à la taille de
 * production, sur la VRAIE carte** (voir l'en-tête de `zonegen.test.ts`). Ces tests-là frôlent la
 * seconde à vide et franchissent les cinq dès que la machine est chargée — ils échouaient alors
 * par TIMEOUT, sans que rien ne soit cassé. Un échec qui dépend de la charge de la machine
 * n'apprend rien et use la confiance dans la suite.
 *
 * 30 s laisse la marge, sans transformer un vrai blocage en attente indéfinie.
 *
 * À ne pas confondre avec l'autre bruit connu de cette suite : les `Timeout calling "onTaskUpdate"`
 * sont un flake d'infrastructure de Vitest, indépendant, et qui ne fait pas échouer de test.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
