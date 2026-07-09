# Ruisseaux continus sur les diagonales — design

**Date :** 2026-07-09
**Fichier concerné :** `packages/sim/src/alpine-hydro.ts` (`carveIceStreams`)

## Problème

Les ruisseaux de fonte sont tracés en suivant l'arbre de drainage (`dir`) tuile
par tuile, et chaque pas ne peint qu'**une seule tuile** (largeur 1). L'arbre de
drainage est 8-connexe (diagonales comprises). Sur un segment en diagonale, deux
tuiles consécutives ne se touchent que **par le coin**, jamais par une arête :
le ruisseau devient une suite de carrés reliés coin-à-coin, que l'œil et le rendu
lisent comme une ligne pointillée. Impression de « flot cassé », alors que le flot
rejoint bien son exutoire (rivière / lac / marais).

C'est le classique de la ligne fine 8-connexe rendue sur une grille : elle n'est
pas 4-connexe, donc visuellement discontinue.

## Objectif

Rendre les ruisseaux **continus** (4-connexes) tout en les gardant **fins**
(1 tuile de large sur les segments droits). Ne pas toucher à leur densité, ni à
l'hydrologie du reste (lacs, tronc central, tarns, mares).

## Solution retenue (approche A — pont diagonal au tracé)

Dans la boucle de tracé de `carveIceStreams`, à chaque pas de la tuile courante
`c=(cx,cy)` vers sa tuile aval `next=(nx,ny)=dir[c]` :

- si le pas est **diagonal** (`dx = nx-cx` et `dy = ny-cy` tous deux non nuls),
  peindre **une** tuile-pont orthogonale intermédiaire, choisie parmi les deux
  candidates `(cx+dx, cy)` et `(cx, cy+dy)` :
  - **candidate = la plus basse en altitude** (`elevationAt`) — l'eau va vers le
    bas, c'est le choix naturel ;
  - **départage** (altitudes égales) par `hash2` sur `(cx, cy)` pour éviter un
    escalier systématique toujours du même côté ;
- la tuile-pont est peinte en `TERRAIN_SHALLOW_WATER`, comme le reste du filet,
  et **seulement si elle n'est pas déjà de l'eau** (ne pas écraser une eau
  profonde ni une berge existante — même prudence que `paintShallow`).

Le segment diagonal gagne ainsi +1 tuile par coude, ce qui suffit à le rendre
4-connexe. Les segments orthogonaux restent à 1 tuile.

### Pourquoi A et pas une passe morphologique globale

Une passe « comble-coins » sur tout le masque d'eau corrigerait aussi d'autres
discontinuités, mais risquerait de grignoter des coins de berge/lac volontaires
et ajouterait un balayage O(N). A est scopé exactement aux ruisseaux qui portent
le défaut, sans effet de bord.

## Pureté & déterminisme

- Uniquement `elevationAt`, `hash2`, comparaisons et arithmétique autorisée
  (`+ - * /`, `min/max`, `floor`…). Pas de trigo, pas de `Math.random`, pas de
  `Date`. Respecte les invariants `/sim`.

## Test de reproduction (à écrire avant le fix)

Dans `alpine-hydro`/`valleygen` (fichier de test des ruisseaux) :

1. **Repro (échoue avant fix)** : générer une carte alpine avec une seed connue,
   isoler les tuiles d'eau posées par `carveIceStreams`, et vérifier qu'**aucune
   tuile de ruisseau n'a de voisin d'eau uniquement en diagonale sans voisin
   d'eau orthogonal** le long du chemin — autrement dit, que la composante d'eau
   du ruisseau est 4-connexe de la source à l'exutoire. Avant le fix, au moins un
   ruisseau présente une rupture 4-connexe → le test échoue.
2. **Non-régression** : le nombre de tuiles d'eau n'augmente que sur les coudes
   diagonaux (pont), le tronc/lacs/tarns sont inchangés, et `check`/`lint`/`test`
   passent (déterminisme, pureté).

Formulation exacte de l'assertion à ajuster à l'implémentation du test (une piste :
BFS 4-connexe depuis la source sur le masque d'eau, vérifier qu'on atteint bien
l'exutoire ; ou compter les tuiles de ruisseau dont les seuls voisins-eau sont
diagonaux).
