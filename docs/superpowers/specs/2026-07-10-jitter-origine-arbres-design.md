# Décalage d'origine des arbres — casser l'alignement des troncs en grille

**Date** : 2026-07-10
**Branche** : feat/relief-terrasses
**Statut** : design validé (brainstorming), à implémenter (TDD).
**Suite de** : `2026-07-10-arbres-hauts-hitbox-tronc-design.md` (les troncs fins ont révélé leur alignement)

## Problème

Depuis que l'arbre a une hitbox de tronc, chaque tronc est dessiné et bloque
**au centre exact de sa tuile**. En forêt dense, les troncs voisins s'alignent
donc sur une grille parfaite : des rangées et des colonnes régulières que l'œil
lit immédiatement comme un quadrillage. La forêt paraît plantée au cordeau, et
cet alignement casse la lisibilité qu'on cherchait — un sous-bois naturel n'a
pas de rangées.

## Objectif

Décaler l'origine de chaque arbre d'une quantité pseudo-aléatoire **déterministe
par tuile**, en **X et en Y**, pour que ni les troncs dessinés ni leurs hitbox
ne s'alignent sur aucun axe. Le décalage déplace le sprite **et** la collision
ensemble : on ne se cogne jamais dans le vide.

## Décision actée (brainstorming du 2026-07-10)

**Décalage franc, collision comprise.** Le compromis est arithmétique et a été
tranché : un tronc de 0,25 tuile laisse un couloir de 0,75 tuile entre deux
voisins, soit 0,15 tuile (2,4 px) de marge sur un avatar de 0,6. Un décalage
visible (plusieurs pixels) mange forcément cette marge — un décalage garantissant
le passage serait sous 1,2 px, donc invisible. **Les deux sont incompatibles ;
on garde la visibilité.**

**Conséquence assumée** : deux arbres voisins dont les décalages se rapprochent
peuvent pincer le couloir sous 0,6 et former un **fourré infranchissable**. Ce
n'est pas un défaut — c'est un vrai sous-bois. Le joueur contourne d'une tuile ou
abat l'arbre. Les hordes ne sont pas concernées (voir plus bas).

## Architecture

Le décalage réutilise exactement le motif « deux familles de requêtes » posé par
la hitbox de tronc : la géométrie sous-tuile bouge, la sémantique tuile ne bouge
pas.

### `/sim` — la fonction de décalage

Une fonction pure **`treeJitter(tx, ty): { dx, dy }`** dans `economy.ts` (à côté
de `generateNodes`, réexportée par le barrel `index.ts` pour le client). Elle
rend un décalage en **tuiles**, chaque composante dans `[−J, +J]`.

```
dx = (hash2(tx, ty, JITTER_SALT_X) * 2 − 1) * J
dy = (hash2(tx, ty, JITTER_SALT_Y) * 2 − 1) * J
```

- **Deux sels constants distincts** (`JITTER_SALT_X`, `JITTER_SALT_Y`) : sans
  quoi `dx = dy` et les arbres ne se décaleraient qu'en diagonale, laissant
  l'anti-diagonale alignée.
- **Pas de seed de monde.** `hash2(tx, ty, sel)` avec un sel *constant* suffit :
  déterministe par tuile, identique des deux côtés sans rien propager. Comme
  `generateNodes` place déjà les arbres différemment d'une saison à l'autre, le
  motif de décalage superposé ne se répète pas de façon visible. On évite ainsi
  d'ajouter un `seed` à `WorldMap`/`MoveWorld` ou de toucher au protocole.
- **Déterminisme (invariant 2).** `hash2` n'utilise que `Math.imul`, xor, shifts,
  `+`, `*` — bit-exact entre moteurs. La conversion `(h·2−1)·J` n'utilise que
  `+ − * /`. Le résultat est donc identique au bit près sur le serveur, dans la
  prédiction du client et au rendu. Aucune fonction Math approximée.

**`J = BALANCE.TREE_JITTER_TILES`** — nombre d'équilibrage, jamais en dur.
Valeur de départ **0,22**, calibrée en jeu après coup (voir §Calibration).

### `/sim` — la collision

`blockedSubAt` décale le centre du carré bloquant, **et seulement pour les
arbres** :

```
si le nœud est un arbre :
  { dx, dy } = treeJitter(tx, ty)
  cx = tx*SUB + SUB/2 + dx*SUB
  cy = ty*SUB + SUB/2 + dy*SUB
sinon :
  cx = tx*SUB + SUB/2      (inchangé)
  cy = ty*SUB + SUB/2
```

Les rochers, filons et veines (`blockHalfSub = 4`) gardent leur centre : leur
collision reste **bit-identique à aujourd'hui**, la preuve d'exactitude de la
tranche précédente tient toujours pour eux.

**Borne dure, non négociable :** `J + blockHalfSub/SUB ≤ 0,5`. Tant qu'elle
tient, le carré bloquant d'un arbre décalé **reste entièrement dans sa tuile** —
`blockedSubAt(sx, sy)` n'a donc qu'à consulter le nœud de la tuile
`floor(sx/SUB)`, sans jamais regarder les tuiles voisines, et la collision reste
O(1). Avec le tronc actuel (`blockHalfSub = 1` → 0,125 tuile), la borne autorise
`J ≤ 0,375`. La valeur de départ 0,22 est confortablement dessous. **Cette borne
doit être testée**, pas seulement respectée par la valeur du moment : un futur
réglage de `J` ou de `blockHalfSub` ne doit pas la franchir en silence.

### `/client` — le rendu

`renderNodes` applique le même `treeJitter(tx, ty)` à l'ancre du tronc et du
houppier :

- ancre du tronc : `((tx + 0.5 + dx) · TILE_PX, (ty + 1 + dy) · TILE_PX)` ;
- ancre du houppier : la même, moins 16 px en Y (inchangé) ;
- **profondeur de tri** : le pied réel est `ty + 1 + dy`, pas `ty + 1`. Le tronc
  se trie sur `nodeDepth(ty + 1 + dy)` et le houppier sur `crownDepth(ty + 1 + dy)`,
  de sorte que deux arbres proches s'ordonnent par leur vrai pied et non par le
  hasard du pool.

Le décalage est le **même flottant** des deux côtés (même fonction pure), donc le
sprite et la hitbox coïncident exactement.

## Ce qui ne change pas

- **Le pathfinding.** `isBlockedAt` / `makeIndexedIsBlockedAt` restent en tuiles
  pleines : une tuile portant un arbre vivant est bloquée pour l'A* et les flow
  fields, où que soit le tronc dans la tuile. Les hordes contournent comme avant.
- **La récolte.** Elle vise la tuile (`floor` de la position du clic). Le tronc
  décalé reste dans sa tuile, donc le clic sur le tronc récolte toujours ; cliquer
  le houppier ne récolte rien, comme déjà acté.
- **Tous les nœuds non-arbres.** Jamais décalés.
- **La hitbox de tronc elle-même** (`blockHalfSub`), la canopée à disque, les
  bandes de profondeur : inchangées.

## Critères d'acceptation

**`treeJitter` (`economy.test.ts` ou module dédié) :**

1. Déterministe : deux appels sur `(tx, ty)` rendent le même `{dx, dy}`.
2. Borné : `|dx| ≤ J` et `|dy| ≤ J` pour un échantillon de tuiles.
3. Non-diagonal : `dx ≠ dy` pour au moins une tuile de l'échantillon (les deux
   sels produisent bien des suites décorrélées).
4. Isotrope-ish : sur un échantillon, dx et dy couvrent chacun le négatif **et**
   le positif (le décalage n'est pas biaisé d'un côté).

**Collision (`collision.test.ts`) :**

5. **Non-débordement** : pour `J` et `blockHalfSub` du moment, le carré bloquant
   d'un arbre décalé au maximum reste dans `[tx, tx+1) × [ty, ty+1)`. Test
   paramétré par la borne `J + blockHalfSub/SUB ≤ 0,5`, pas par une valeur en dur.
6. Un avatar bute sur le tronc **décalé** : le clamp se fait à la position du
   tronc jittéré, pas au centre de la tuile.
7. Un rocher / filon / veine n'est **jamais** décalé : clamp au centre, valeur
   bit-identique à avant le jitter.
8. **Cas pincé** : deux arbres voisins avec des décalages opposés vers l'intérieur
   bloquent un avatar de 0,6 (le fourré est réel).

**Non-régression :** `replay.test.ts`, `sim.test.ts`, `events.test.ts` passent
sans qu'une assertion existante bouge. Le scénario peut changer de trajectoire
(les PNJ frôlent des troncs déplacés) — attendu, non-régression seulement s'il y
a effondrement réel.

**Vérification en jeu**, pas seulement en test : capture en forêt dense pour
juger que la grille a disparu et calibrer `J`.

## Calibration (en jeu, après coup)

`J` est un bouton de feeling, réglé à la capture (mémoire `fast-iteration-worldfeel`),
pas sur-spécifié :

| Symptôme | Bouton |
|---|---|
| La grille se lit encore, troncs trop réguliers | `TREE_JITTER_TILES` ↑ (plafond dur 0,375) |
| Trop de fourrés pincés, la forêt devient un mur | `TREE_JITTER_TILES` ↓ |
| Les troncs semblent « flotter » hors de leur touffe de décor | à regarder avec le décor cosmétique, pas ici |

## Risques

- **Parité prédiction/autorité** — nulle par construction : `treeJitter` est une
  fonction pure de `(tx, ty)`, appelée à l'identique par le tick serveur, la
  prédiction et le rendu. Aucune source de divergence.
- **Débordement du carré bloquant** — écarté *par test*, pas par la valeur du
  moment (critère 5). C'est le seul piège de correction ; il est verrouillé.
- **Coût** — un `hash2` de plus par arbre testé en collision et par arbre rendu.
  Négligeable (deux `imul` et quelques opérations entières), mais `treeJitter`
  est appelé dans la boucle chaude de `blockedSubAt` : le garder trivial.

## Hors périmètre

- Le décor cosmétique (`cl-conifer`, souches) — sa relation aux troncs décalés se
  juge avec lui, séparément.
- Toute rotation ou mise à l'échelle par arbre (seul le décalage d'origine est
  demandé).
- Le pathfinding hiérarchique / la coupe de coin A* (dette séparée, mémoire
  `milice-livelock`).
