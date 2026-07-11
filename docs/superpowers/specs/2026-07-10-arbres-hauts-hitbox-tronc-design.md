# Arbres hauts à hitbox de tronc — collision sous-tuile + canopée à disque

**Date** : 2026-07-10
**Branche** : feat/relief-terrasses
**Statut** : **IMPLÉMENTÉ** (2026-07-10, plan `docs/superpowers/plans/2026-07-10-arbres-hauts-hitbox-tronc.md`, branche feat/relief-terrasses). Verdict en jeu : sous-bois traversable, aucun réglage retouché — artefact `bbf4c077`.

## Problème

Un arbre est aujourd'hui un carré de 16×16 px qui bloque **une tuile entière**
(`NODE_DEFS.tree.blocks = true`, `balance.ts:253`). Deux conséquences.

D'abord l'échelle : un arbre a la même emprise visuelle qu'un caillou. Rien ne
distingue une forêt d'un champ de cailloux verts, et la verticalité du monde ne
se lit nulle part.

Ensuite la navigation : la forêt dense porte un arbre sur 22 % de ses tuiles
(`economy.ts:297`), la vieille forêt sur 30 % (`economy.ts:329`). Avec un avatar
large de 0,6 tuile (`BALANCE.AVATAR_HITBOX_TILES`), près d'une tuile sur quatre
est un mur plein. Une forêt se traverse comme un labyrinthe qui accroche, pas
comme un sous-bois.

Les deux problèmes ont la même racine et la même solution : un arbre doit être
**haut** (trois tuiles) et **fin** (un tronc). L'un justifie l'autre — un arbre
de trois tuiles qui bloquerait trois tuiles serait absurde ; un tronc fin sous un
sprite d'une tuile serait illisible.

## Objectif

Un arbre de **trois tuiles de haut** dont la collision se limite au **tronc**
(0,25 tuile), sans casser le déterminisme de `/sim` ni la parité
prédiction/autorité, et sans rendre la forêt dense illisible.

## Décisions actées (brainstorming du 2026-07-10)

1. **Les deux buts à la fois** : majesté visuelle *et* perméabilité. On se
   faufile entre les troncs.
2. **La hauteur est purement cliente.** `/sim` ne connaît que l'AABB du tronc.
   Le houppier n'a aucune existence simulée : ni couvert, ni ombre, ni occultation.
3. **Lisibilité par disque de découvert** dans la canopée : les houppiers
   s'effacent autour du joueur, les troncs restent opaques.
4. **Le pathfinding ne change pas.** Une tuile à arbre reste bloquée pour l'A* et
   les flow fields. Le joueur se faufile, la horde contourne : la forêt devient un
   refuge. C'est un fait de gameplay assumé, pas un défaut.
5. **`combat.ts` n'est pas touché.** Le coup reste un arc de 90° à portée 1,4
   sans test d'occultation — on frappe à travers un tronc, comme on frappait déjà
   à travers un arbre pleine tuile. La question de l'occultation se posera avec le
   tir (GDD ligne 662), pas maintenant.
6. **Le décor cosmétique est hors périmètre.** Les conifères d'une tuile au pied
   d'arbres de trois se jugeront sur capture, après.

## Architecture

### `/sim` — la collision sous-tuile

**Résolution : 8×8 sous-tuiles par tuile** (`BALANCE.SUBTILES_PER_TILE = 8`), soit
2 px de côté à 16 px/tuile.

Pourquoi 8 et non 4. Avec 4 sous-tuiles, une hitbox de 0,25 tuile ne se centre
pas (il faudrait une sous-tuile et demie), et la seule largeur centrable serait
0,5 — qui laisse un écart de 0,5 tuile entre deux troncs orthogonalement voisins,
moins que les 0,6 de l'avatar. On ne passerait pas, et tout l'intérêt tomberait.
Avec 8, un tronc de 2 sous-tuiles vaut 0,25 tuile, se centre exactement sur les
indices 3 et 4, et laisse **0,75 tuile** d'écart.

**Représentation.** `NODE_DEFS.blocks: boolean` devient
`blockHalfSub: number` — le demi-côté du carré bloquant, en sous-tuiles, depuis le
centre de la tuile.

| Valeur | Emprise | Nœuds |
|---|---|---|
| `4` | tuile entière (inchangé) | `rock`, `iron_vein`, `coal_seam` |
| `1` | tronc, 0,25 tuile | `tree` |
| `0` | ne bloque pas (inchangé) | `fiber_plant`, `berry_bush` |

La géométrie se déduit de la tuile et d'un entier : la tuile `t` couvre les
sous-tuiles `[8t, 8t+8)`, son centre est `8t+4`, et le carré bloquant est
`[8t+4−h, 8t+4+h)`. Pour `h = 4` on retrouve exactement la tuile pleine. Aucune
AABB stockée, aucune structure de données par nœud, rien de nouveau dans
`SimState`.

**Deux familles de requêtes.** C'est le point structurant du design, et la
frontière doit rester nette.

- **Requêtes tuile** — `isBlockedAt(tx, ty)` et `makeIndexedIsBlockedAt`. Sémantique
  inchangée : une tuile portant un arbre vivant est bloquée. Consommateurs :
  `findPath`, `computeFlowField`, `npc.ts` (choix de cible, placement), spawns.
  **Zéro ligne à modifier chez eux.**
- **Requêtes sous-tuile** — `resolveMove`, `moveAxis`, `moveAvatar`,
  `moveAvatarStepped`, et **`overlapsBlocking`**. Ce dernier *doit* devenir
  sous-tuile-exact : `collision.test.ts:141` et `prediction.test.ts:110` affirment
  qu'un avatar n'est jamais dans un obstacle, et avec la sémantique tuile un avatar
  légalement debout entre deux troncs les ferait échouer à tort.

**Déterminisme (invariant 2).** `moveAxis` travaille intégralement en unités de
sous-tuile et ne divise qu'une fois, en sortie. Multiplier et diviser par 8 est
exact en binaire, et l'arrondi flottant commute avec une mise à l'échelle par
puissance de deux : `fl(8a − 8b) = 8·fl(a − b)`. Le résultat est donc **identique
au bit près** à celui d'aujourd'hui pour tout obstacle occupant une tuile pleine.
Aucune opération hors `+ − × ÷` et `Math.floor`.

**Coût.** `lineBlocked` balaie l'axe transverse en sous-tuiles : l'avatar en
couvre ~5 au lieu de 1, soit ~5× plus de tests O(1) par pas d'axe (`nodeAt` est
déjà indexé, `economy.ts:61`). Le pathfinding, lui, ne paie rien. À confirmer sur
`pnpm scenario` plutôt qu'à supposer.

### `/client` — le rendu

**Le sprite devient deux sprites.** `nd-tree` disparaît au profit de :

- `nd-tree_trunk` — 16 px de large, 22 de haut. Origine pieds
  (`tileFeetAnchor`), profondeur `ySortDepth(ty + 1, TILE_PX, TIE_NODE)`.
  **Inchangée**, et **toujours opaque**.
- `nd-tree_crown` — 32 px (deux tuiles) de large, 32 de haut, recouvrant le haut
  du tronc de 6 px. Total : 48 px = trois tuiles. Le houppier déborde la tuile pour
  que la canopée se referme à 22 % de densité au lieu de faire des pois.

L'ancrage pieds des nœuds, posé le 2026-07-09 avec le Y-sort à bande unique, était
le prérequis explicite pour « de l'art plus haut qu'une tuile » (`docs/decisions.md`).

**Profondeur des houppiers.** Une bande neuve :
`crownDepth(feetY) = CROWN_BASE + feetY × TILE_PX`, avec `CROWN_BASE = 900_000` —
au-dessus de tous les acteurs (la bande de tri Y plafonne à
`Y_SORT_BASE + 57 600` sur la vallée canonique de 3600 tuiles) et sous
`CANOPY_DEPTH = 1_000_000`. Les houppiers ne se trient qu'entre eux.

« Toujours au-dessus des acteurs » est **correct sans cas particulier**, parce
qu'un houppier ne s'étend que vers le haut de l'écran. Le houppier d'un arbre
planté en `ty` couvre les rangées `ty−2` à `ty`. Un acteur en `ty−1` est derrière
l'arbre — l'occulter est juste. Un acteur en `ty+1` est devant — le houppier ne
l'atteint pas.

**Le disque de découvert.** Une fonction pure `crownAlpha(distTiles)` :

```
crownAlpha(d) = A_MIN                       si d ≤ R_IN
                1                           si d ≥ R_OUT
                lerp(A_MIN, 1, ...)         entre les deux
```

avec `R_IN = 1.5`, `R_OUT = 4.0`, `A_MIN = 0.22`. La distance se mesure des pieds
du joueur au **pied du tronc**, pas au centre du houppier : l'arbre à ton contact
s'efface, celui dont la cime te survole de loin reste opaque.

Pas de masque, pas de `RenderTexture`, pas d'`erase` : un alpha par sprite,
fonction continue de la position du joueur, donc sans scintillement quand on
marche. À 16 px/tuile et 64 px de rayon, l'écart avec un vrai masque radial ne se
voit pas. Le tronc reste à alpha 1 en toutes circonstances : les troncs dessinent
la structure de la forêt, les houppiers s'ouvrent.

Corollaire de gameplay, cohérent avec le GDD : le houppier arrête le regard mais
jamais la flèche ; le tronc arrête la flèche mais jamais le regard. La forêt
lointaine reste un couvert opaque — le tir à l'arc y sera mauvais, ce que le GDD
veut déjà (« tir appuyé », positionnel, ligne 662).

**Culling.** `renderNodes` (`snapshot-view.ts:226`) élargit sa fenêtre de tuiles de
3 rangées vers le bas et d'une colonne de chaque côté, sinon les cimes des arbres
situés juste sous le bord de l'écran disparaissent.

## Critères d'acceptation

**Non-régression (le filet).** `collision.test.ts`, `prediction.test.ts`,
`replay.test.ts`, `sim.test.ts` et `events.test.ts` passent **sans qu'une seule
assertion soit modifiée**. Si l'un d'eux demande à être retouché, c'est
l'implémentation qui a tort, pas le test.

**Collision (`collision.test.ts`, tests neufs) :**

1. Un avatar (0,6) passe entre deux arbres orthogonalement adjacents (écart 0,75).
2. Un avatar buté frontalement sur un tronc est clampé flush à
   `tx + 0,5 − 0,125 − 0,3 = tx + 0,075`.
3. Un avatar glisse le long d'un tronc sans s'y accrocher (résolution par axe).
4. `rock`, `iron_vein` et `coal_seam` bloquent toujours leur tuile entière.
5. Un arbre à `stock = 0` ne bloque plus rien.
6. **Contrat tuile** : `isBlockedAt` reste `true` sur une tuile portant un arbre vivant.
7. **Contrat sous-tuile** : `overlapsBlocking` est `false` quand l'avatar se tient
   légalement entre deux troncs, `true` quand il chevauche un tronc.

**Rendu (`framing.test.ts`) :**

8. `crownAlpha` : bornes (`A_MIN` en deçà de `R_IN`, `1` au-delà de `R_OUT`),
   monotonie croissante, continuité aux jointures `1.5` et `4.0`.
9. `crownDepth` : supérieur à toute profondeur d'acteur atteignable sur 3600
   tuiles, inférieur à `CANOPY_DEPTH`, et ordonné par `ty` entre deux houppiers.

**Vérification en jeu**, pas seulement en test : capture headless en forêt dense,
avatar sous canopée, pour juger le disque et arbitrer le double assombrissement
(voir Points de calibration).

## Risques

**Parité prédiction/autorité** — le seul risque qui puisse faire mal. Adressé par
construction (`moveAvatarStepped` appelle le même `moveAvatar` que le tick serveur)
et par la preuve `fl(8a − 8b) = 8·fl(a − b)`. Le filet de non-régression est la
vérification.

**Livelock des PNJ** (cf. mémoire `milice-livelock`) — **écarté après vérification**.
Un marcheur peut désormais voir son centre glisser dans une tuile à arbre que le
pathfinding juge bloquée. Or `findPath` ne teste jamais l'origine (`pathfinding.ts:83`,
seule la destination est rejetée) et filtre les voisins à l'expansion ; et
`computeFlowField` est lu par `monsters.ts:128`, qui traite `-1` comme `Infinity`
et sort donc vers n'importe quel voisin de distance finie. Le code tolérait déjà
d'être physiquement là où le pathfinding refuse d'aller.

**Performance de `lineBlocked`** — facteur ~5 sur l'axe transverse, quelques tests
O(1) par tick. À mesurer sur `pnpm scenario`, pas à supposer.

## Points de calibration (playtest, pas blocage)

- Le voile d'ombre `canopy` existant (`WorldScene.ts:273`) assombrit déjà la forêt
  par `canopyDensity(terrain)`. Avec de vrais houppiers, on assombrit deux fois :
  l'alpha du voile est à revoir en jeu.
- `R_IN`, `R_OUT`, `A_MIN` : ordres de grandeur, à affiner sur capture.
- La largeur du houppier (32 px) contre la densité de 22 % : à regarder avant de
  toucher aux densités de `generateNodes`.

## Hors périmètre

- Le décor cosmétique (`clutter.ts`, `cl-conifer`, `cl-big_trunk`) — jugé sur
  capture, après.
- `combat.ts` : aucune occultation du corps-à-corps.
- Le combat à distance, qui n'existe pas encore.
- Le pathfinding : il reste en tuiles pleines.
- La récolte continue de viser la tuile du tronc. Cliquer un houppier ne récolte
  rien, ce qui est acceptable puisque le tronc reste toujours visible sous lui.
