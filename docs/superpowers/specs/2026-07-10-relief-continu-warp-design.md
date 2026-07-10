# Relief continu — le sol se déforme, la falaise disparaît

**Date** : 2026-07-10
**Statut** : validé par Alexis en session, prêt pour le plan d'implémentation
**Branche** : `feat/relief-terrasses`
**Portée** : rendu client + une retouche de la génération alpine. Remplace
l'approche *palier discret + face de falaise* de la tranche 1 relief
(`2026-07-09-relief-terrasses-design.md`).

---

## 1. Le problème, et le virage

La tranche 1 relief dessinait le dénivelé par **marches** : `elevation` continu
quantifié en `level` entier (`packages/sim/src/terrace.ts`), et des **parois
verticales** aux frontières de paliers (`packages/client/src/render/cliffs.ts`,
`scenes/world/cliff-layer.ts`). Le monde monte par escalier, façon Zelda ALTTP.

Alexis a tranché en session pour l'**autre** réponse à « comment montrer un
dénivelé » : **arrêter d'afficher une grille orthogonale plate et tordre le sol
en continu** pour que les pentes, les côtes et les versants se lisent
directement. Décision explicite : **remplacement complet des falaises**, pas un
complément.

Ce document acte ce virage et sa portée exacte.

## 2. Le principe : un cisaillement vertical par la hauteur (Y-shear)

Le sol n'est plus une texture plate cuite. Chaque point du monde est **poussé
vers le haut de l'écran** proportionnellement à son altitude :

```
screenY = worldY · TILE − elevation(worldX, worldY) · H
screenX = worldX · TILE                    (X n'est JAMAIS déformé)
```

`H` est le facteur d'élévation à l'écran (px par unité d'altitude), une constante
`BALANCE`, calibrée en jeu comme `TREE_JITTER_TILES`.

Les pentes qui **s'éloignent** de la caméra s'étirent en hauteur et lisent comme
un versant dont on voit la face (spectaculaire, occlusion juste). Les pentes qui
**montent vers** la caméra se compriment et, au-delà d'un seuil, se **replient**
(les tuiles amont repassent par-dessus les tuiles aval) — c'est le seul mode de
rupture, traité en §6.

## 3. La contrainte qui commande tout : la vallée s'ouvre vers la caméra

Le repli n'arrive que sur une pente **raide qui monte vers la caméra** (le sud de
l'écran). Une cuvette scellée sur ses quatre côtés (ce que produit
`computeElevation` aujourd'hui, « murs hauts via distance au bord ») a
justement un tel mur au sud → il se replierait.

**Décision actée** : la génération alpine est retouchée pour que la vallée
**s'ouvre vers le bas de l'écran** — fond bas et ouvert au sud (fermé autrement :
lac, éboulis infranchissable à plat, ou bord de carte), grands murs au **nord et
sur les flancs**. C'est aussi une belle composition : on regarde *dans* la
vallée, les parois s'élèvent en s'éloignant.

Conséquence : le « mauvais sens » du cisaillement ne rencontre jamais de mur haut
→ **zéro repli, zéro clic ambigu**, par construction.

## 4. Architecture : une seule math, deux consommateurs

Le cœur est un **module pur `packages/client/src/render/warp.ts`** — aucun import
Phaser, testé headless. Il est la **source de vérité** partagée par le rendu et
le picking, qui ne peuvent donc pas diverger :

```ts
// Altitude continue à une position monde (échantillonnage du champ, clampé aux
// bords — jamais NaN, jamais hors carte).
elevAt(wx: number, wy: number): number

// Monde → écran. Transcrite telle quelle en GLSL pour le rendu GPU.
projectY(wx: number, wy: number): number

// Écran → monde. LE picking. X exact ; Y par résolution 1-D de colonne.
unproject(sx: number, sy: number): { wx: number; wy: number }
```

### 4.1 Le rendu du sol — GPU

Le sol devient un **maillage de grille déformé**, dessiné par le GPU, fenêtré à
la vue caméra (même trick de culling que les nœuds dans `snapshot-view.ts` :
coût borné à la vue, jamais à la carte entière). Deux saveurs, inégales en
risque — la v1 prend la sûre :

- **v1, voie de moindre risque** 🟢 : un **maillage de grille construit à la
  main** (le GameObject `Mesh` de Phaser 4.2 ; `Plane` n'existe **pas** en 4.2 —
  vérifié) sur la fenêtre caméra ; on écrit la position Y de ses sommets depuis
  `projectY`, le GPU dessine le sol déformé texturé. La fenêtre fait ~20×35
  tuiles ≈ 800 sommets : la mise à jour CPU des sommets est négligeable. C'est
  déjà « rendu GPU ». **Le choix exact de primitive et son API de sommets sont un
  point du plan** (un court spike de rendu tranche entre `Mesh` à sommets
  manuels et les replis ci-dessous).
- **optimisation différée, à dérisquer** 🟡 : un **vertex shader** custom qui
  déplace une grille statique en échantillonnant une texture d'élévation (zéro
  CPU par frame). Réservé à un **spike** ultérieur, à ne faire que si le profil
  le réclame (à 800 sommets fenêtrés, improbable). Phaser 4.2 expose `Mesh`,
  `Shader`/`ShaderQuad` (quad 4-sommets) et un système de filtres
  (`FilterDisplacement` inclus) ; que `Mesh` accepte proprement un vertex shader
  custom **reste à confirmer** — d'où le spike, hors v1.
- **replis connus** si `Mesh` à sommets manuels ne convient pas : un `Shader`
  plein-écran dont le fragment reconstruit le sol par le même `unproject` (draw
  et picking = math identique), ou `FilterDisplacement` en approximation. Notés,
  non retenus par défaut.

### 4.2 Le rendu des acteurs — un décalage d'une ligne

Tout ce qui est debout reste un **billboard** ancré aux pieds (avatar, tronc +
houppier, structures, nœuds, cadavres). Leur `py` gagne simplement le décalage
d'élévation via `projectY` : un arbre planté sur le versant **monte avec le sol
sous lui**. (Sol plat + billboard soulevé = arbre qui flotte : c'est pourquoi
mailler le sol est indissociable de soulever les acteurs.)

### 4.3 Le tri de profondeur — inchangé

`ySortDepth(worldY)` reste juste : le long de l'axe de vue, l'ordre reste le
`worldY` monde. On ne fait que déplacer le `py` à l'écran. **Zéro atteinte au
contrat de tri.** Deux acteurs à altitudes différentes s'occultent correctement
(le plus au sud passe devant).

### 4.4 Le picking — exact, pas approché

`unproject` inverse la projection. Parce que X n'est pas cisaillé :

- **X exact** : `wx = (sx + scrollX) / TILE`.
- **Y par colonne** : à `wx` fixé, `screenY(wy)` est **monotone** (garanti par
  §3), donc pour un pixel donné on descend la colonne d'élévation et on trouve
  **l'unique** `wy`. Borné (~20-40 tuiles), déterministe, exact.

**Tous les sites screen→monde** (déplacement au clic, visée de combat, placement
de structure, caméra Foxhole) routent par `unproject` au lieu du
`floor(pixel / TILE)` plat actuel.

## 5. Ce qui part à la retraite

Le remplacement complet **supprime** :

- `packages/client/src/render/cliffs.ts` et `scenes/world/cliff-layer.ts` ;
- `packages/sim/src/terrace.ts` + `computeLevel`, et le champ `map.level` s'il
  n'a pas d'autre consommateur (il n'était que pour les murs) ;
- `stepShadeAt` dans `hillshade.ts` (l'ombre au pied d'une marche — il n'y a plus
  de marche) ;
- les bakes `cliff-face-*` / `cliff-side-*` (`bakeCliffTextures`).

**Reste** : `hillshadeAt` (l'ombrage du versant devient *plus* utile), et le
champ `elevation` continu, désormais moteur du warp **et** de l'ombrage.

Bilan attendu : négatif en lignes de code (deux systèmes discrets → un maillage
continu).

## 6. La garde anti-repli

Contrainte dure, testable : le sol ne se replie jamais tant que, sur toute la
carte lissée,

```
H · max( pente d'élévation vers le sud ) < TILE
```

Deux gardes complémentaires :

1. **Structurelle** (§3) : la vallée n'a plus de mur raide orienté sud.
2. **Numérique** : au boot, on mesure le gradient sud maximal du champ
   `elevation` et on **assert** que le `H` choisi le respecte (sinon erreur de
   dev explicite, jamais un repli silencieux à l'écran). Le `H` sûr maximal se
   dérive de ce même gradient.

## 7. Direction artistique — laissée OUVERTE

Le warp est **art-neutre** : `warp.ts`, le picking et le déterminisme ne
dépendent pas du dessin. Le choix R10-R13 « pixel-art fin vs peint » reste
**ouvert** (« Alexis : on verra »). Deux points, et deux seuls, en dépendront —
notés ici comme **calibration différée**, pas tranchés :

- **Filtrage** : le warp cisaille les tuiles sur les pentes. Le **peint +
  linéaire** l'absorbe (une surface qui se courbe, flatteur) ; le **pixel-art
  net** le montre (grille de pixels déformée sur les versants) — acceptable sur
  les plats et pentes douces (l'essentiel de l'intérieur, conçu doux), marqué
  sur le mur raide du fond.
- **Mur du fond** : en pixel-art net, le versant raide du nord pourra être traité
  en **décor peint séparé** (« montagnes au loin ») plutôt qu'en tuiles warpées.

Le warp exprime une préférence douce pour le peint, mais **n'exige rien**. La v1
se construit art-neutre ; ces deux réglages se posent en playtest.

## 8. Invariants

- **Warp = purement visuel, côté client.** Zéro atteinte aux invariants `/sim`.
  `elevation` est déjà disponible côté client (le hillshade l'échantillonne).
- **La retouche de gen (§3) touche `/sim`** (`computeElevation`, alpinegen) :
  elle reste **pure et déterministe** (opérations autorisées uniquement). Elle
  change les mondes générés à seed égal → les tests golden d'alpinegen seront
  mis à jour ; `replay.test.ts` / `events.test.ts` restent verts (même seed →
  même monde → même flux).

## 9. Critères d'acceptation

1. **`warp.test.ts` (headless, pur)** :
   - aller-retour `unproject(project(p)) ≈ p` à tolérance sous-pixel sur plats
     et versants ;
   - `projectY` monotone en `wy` à `wx` fixé sur toute carte respectant §6 ;
   - garde anti-repli : `H · maxGradSud < TILE` asserté.
2. **En jeu** (capture Chromium/SwiftShader, artefact) : un arbre sur le versant
   monte *avec* le sol sous lui ; un clic sur un versant déplace l'avatar à la
   tuile réellement visée (parité picking mesurée).
3. **Tri** : deux acteurs à altitudes différentes s'occultent par leur `worldY`,
   `ySortDepth` inchangé.
4. **Gen** : la vallée est basse/ouverte au sud, murs au nord et flancs ; aucune
   pente sud ne viole §6.
5. **Retraite** : `cliffs.ts`, `cliff-layer.ts`, `terrace.ts`, `stepShadeAt`
   supprimés ; aucune référence morte ; le sol ne bake plus de texture plate.
6. `pnpm check` / `lint` / `test` / `build` verts.

## 10. Hors périmètre (différé)

- Le **vertex shader** GPU (spike d'optimisation, §4.1).
- Le **coût de pente** gameplay (tranche 3 « je sens » du programme relief, sur
  `elevation` continu) — le warp ne fait que *montrer*, il ne fait pas *sentir*.
- La verticalité 2.5D en **couches** (`layer` : ponts, mines, étages) — primitive
  indépendante, réservée (mémoire `verticalite-couches-2-5d`), intouchée ici.
- Le raffinement du **picking sur les billboards** (hit-test des sprites soulevés)
  au-delà du hit-test écran standard, si un cas le réclame.
