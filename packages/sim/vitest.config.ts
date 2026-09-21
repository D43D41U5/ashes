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
 * 30 s laissait la marge, sans transformer un vrai blocage en attente indéfinie.
 *
 * ⚑ 30 → 60 s LE 2026-09-20, avec LA CARTE JOUÉE DOUBLÉE (852 → 1 700 rangées) : une génération
 * du monde joué passe de ~11 à ~17 s, et le premier test d'une graine la paie quand le cache des
 * cartes est froid. Neuf tests ont expiré à 30 s sans qu'aucun ne soit cassé (G-A2, G-A3 ×4,
 * G-A7 ×2, L3, R21) — le bruit exact que ce harnais existe pour tuer.
 *
 * À ne pas confondre avec l'autre bruit connu de cette suite : les `Timeout calling "onTaskUpdate"`
 * sont un flake d'infrastructure de Vitest, indépendant, et qui ne fait pas échouer de test.
 */
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
