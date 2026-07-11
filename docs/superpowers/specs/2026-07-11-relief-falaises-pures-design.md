# Relief par falaises pures — on abandonne le warp continu

**Date** : 2026-07-11
**Statut** : validé par Alexis en session (design), prêt pour le plan
**Branche** : `feat/relief-terrasses`
**Portée** : rendu du relief + donnée `/sim` de paliers. **Abandonne et reverte**
le warp continu (spec `2026-07-10-relief-continu-warp-design.md`), remplacé par
un relief **discret** (paliers + faces de falaise).

---

## 1. La décision, et pourquoi

La spec précédente affichait l'élévation en **tordant le sol** (Y-shear continu).
Une longue session de playtest en a montré les limites structurelles, toutes
insolubles par calibration :

- **Repli du maillage** : un cisaillement vertical ne peut afficher plus d'~1
  tuile de chute par tuile sans se replier → impossible de montrer du raide/profond.
- **Désalignement collision↔visuel** : la collision est plate (grille), le visuel
  déplacé → on bute « avant » les murs, l'eau déborde des berges.
- **Relief doux illisible** OU **injouable** : le champ d'élévation est trop doux
  pour un déplacement visible sans casser l'alignement.
- **Intégration eau impossible** proprement : l'eau plate sur un maillage warpé
  se replie aux berges (échardes).

**Décision d'Alexis (2026-07-11)** : **abandonner le warp**, revenir à un relief
**discret par falaises** — l'occlusion (Zelda / Factorio / Songs of Syx). Ça
supprime toute cette classe de problèmes d'un coup, **aligne le relief sur la
collision** (falaises aux frontières de tuiles), et **renoue avec l'instinct
fondateur du projet** : « verticalité en **couches discrètes**, pas de hauteur
continue » (mémoire `verticalite-couches-2-5d`, GDD §14). C'est aussi ce que la
branche `feat/relief-terrasses` construisait **avant** le détour warp de cette
session (`terrace.ts`/`cliffs.ts`, virés à la Task 7, commit `576df8e`).

**Compromis assumé** : on perd le relief *doux roulant* (collines/pentes
continues) au profit de **plateaux à paliers** — masses nettes, lisibles,
alignées. Choix acté.

## 2. Le système — paliers + faces de falaise

Une **seule primitive** : l'`elevation` continue est quantifiée en **paliers
entiers** ; partout où deux tuiles voisines changent de palier, une **face de
falaise** discrète est dessinée à la frontière. Le sol est **plat** (aucun
déplacement d'écran). L'eau est un palier plat comme un autre ; ses berges sont
des falaises vers ce palier — **terrain et eau unifiés**.

### 2.1 Donnée `/sim` : `level` (ressuscité)

- `terrace.ts` — `computeLevel(elevation, w, h)` → `number[]` de paliers entiers,
  via un **lissage** local (box blur, `smoothField`) puis quantification
  (`floor(smooth × LEVELS)`). Le lissage n'est pas cosmétique : quantifier le
  champ brut (crêtes, détail) donnerait des micro-terrasses déchiquetées.
- **Résurrection** : récupérer `packages/sim/src/terrace.ts` (+ `terrace.test.ts`)
  depuis `git show 8b84dcd:…`, et le champ `WorldMap.level?: number[]` (`map.ts`)
  + `levelAt` + les exports `index.ts`.
- **L'érosion (`alpine-hydro.ts`) RESTE et nourrit ça** : elle creuse
  `elevation` le long du drainage → les rivières/lacs tombent d'un ou plusieurs
  paliers → **canaux et cuvettes bordés de falaises**, gratuitement.
- Les **vallons haute fréquence** (`addReliefBumps`, octave HILL) : **retirés** —
  ils bruiteraient les paliers (micro-terrasses). `HILL_*` supprimés.

### 2.2 Rendu client : sol plat + falaises

- **Sol** : plat, coloré par biome. On garde le bake `map-demo` (texture
  1 px/tuile) affiché **à plat** (image étirée, comme avant le warp), OU le
  `Mesh2D` **sans déformation**. Choix d'implémentation tranché au plan (le plus
  simple : revenir à l'image plate ; `map-demo` sert déjà la minimap).
- **Faces de falaise** (`cliffs.ts` ressuscité + affiné) : sur la tuile BASSE, à
  chaque voisin d'un palier PLUS HAUT :
  - voisin **nord** plus haut → **FACE** (regarde la caméra), hauteur = Δpalier ×
    `STEP_PX`, plafonnée à `MAX_DROP` ;
  - voisin **est/ouest** plus haut → **TRANCHE** est/ouest (liseré vertical, pour
    la continuité sur les contours diagonaux).
  - **Liseré au biome** en haut de chaque face (le bon détail du proto de berge) :
    la couleur du plateau adjacent, éclaircie — pas un vert plaqué.
  - **Tri Y** (`ySortDepth`, bande `TIE_CLIFF`) : un acteur au pied passe *devant*
    la face, un acteur sur le plateau passe *derrière* → l'occlusion « je passe
    derrière la falaise » sort gratuitement. C'est le cue de profondeur.
- **Eau = palier plat** : rendue à plat à son niveau ; ses **berges = faces de
  falaise** vers ce palier, exactement les mêmes primitives (unifié). Frontière =
  terre↔eau (shallow ET profonde comptent comme « eau/bas », pas de mur parasite
  entre peu-profond et profond).

### 2.3 Ombre solaire (adaptée)

La `ShadeLayer` (dynamique selon le soleil de l'heure) est **conservée mais
réorientée** : au lieu d'ombrer un sol warpé, elle ombre les **faces de falaise**
selon la direction du soleil (une face qui tourne le dos au soleil s'assombrit ;
le matin/soir marquent les reliefs, midi les aplatit). `sunDirection(hour)` reste.
Détail d'intégration (par face vs par tuile de plateau) tranché au plan.

## 3. Ce qui part (revert du warp)

- `packages/client/src/render/warp.ts` (+ `warp.test.ts`) : supprimés.
- `RELIEF_H` + garde `assertNoFold` (`framing.ts`, `WorldScene`) : supprimés.
- Maillage warpé du sol (`GroundLayer` / `ground-mesh.ts`) : reverté (sol plat).
- Soulèvement des billboards (`SnapshotView.setWarp` + les `- lift` de
  `syncActor`/`renderNodes`/structures/cadavres) : revertés (positions à plat).
- Picking `unproject` (`input-bindings.ts`, `WorldScene` ghost) : reverté au
  `floor(px/TILE)` plat — qui est **correct** sur un sol plat.
- `ShadeLayer` : sa dépendance au `warp.lift` retirée (réorientée §2.3).
- Le **prototype jetable** (`shore-cliff.ts`, câblage temporaire, aplatissement
  d'eau démo dans `onReady`, `EROSION_DEPTH`/`RELIEF_H` bricolés) : supprimé,
  remplacé par le vrai système.

## 4. Invariants

- **`/sim` pur et déterministe** : `computeLevel`/`terrace.ts` n'utilisent que
  `+ - * / Math.floor/min/max` (aucune transcendante) — c'était déjà le cas.
  `level` = `number[]` JSON-sérialisable. Même seed → même `level`.
- **Client bête** : les falaises sont du **rendu** ; elles ne changent ni la
  collision ni le pathfinding en v1 (cf. §5).
- **Top-down 2D préservé** : pas de 3D, pas de perspective — occlusion par tri Y
  sur une grille plate. Conforme GDD §14 + mémoire `verticalite-couches-2-5d`.

## 5. Portée v1 et ce qui est différé

- **v1 = RENDU seulement.** Les falaises se **voient** (occlusion, tri Y), elles
  ne **bloquent pas** encore. Collision et pathfinding restent plats/inchangés.
- **Différé (tranche gameplay ultérieure, « ça structure ») :** bord de plateau
  **infranchissable** + **rampes/escaliers** pour changer de palier, pathfinding
  par palier. C'est là que `level` deviendra tactique. Hors de cette spec.
- **Différé aussi :** la **hauteur d'eau par plan d'eau** (chaque lac à son
  niveau) — v1 traite l'eau comme le palier le plus bas atteint, suffisant pour
  les berges. Raffinement si besoin.

## 6. Calibration (réglée en jeu, pas gravée)

- `TERRACE.LEVELS` (nombre de paliers) et `TERRACE.SMOOTH_RADIUS/PASSES` : dosent
  la fréquence des falaises (trop de niveaux → terrain en escalier permanent ;
  trop peu → relief plat). Départ = valeurs d'origine (`LEVELS 8`, `RADIUS 6`,
  `PASSES 2`), re-calibrées à la capture.
- `STEP_PX` (hauteur écran d'une marche), `SIDE_PX`, `MAX_DROP` : réglages
  visuels des faces (valeurs d'origine de `cliffs.ts` comme départ).
- `HYDRO.EROSION_DEPTH` : profondeur de creusement des rivières → nombre de
  paliers de berge.

## 7. Critères d'acceptation

1. **`/sim`** : `terrace.test.ts` (lissage séparable, quantification bornée) vert ;
   `level` déterministe (même seed → même champ) ; suite `/sim` verte, dont
   `replay`/`events` (le relief ne touche pas la logique) et le banc scénario
   (0 village affamé — le terrain de biomes est inchangé, seule la DONNÉE `level`
   s'ajoute).
2. **Rendu, en jeu** (capture Chromium/SwiftShader) : falaises dessinées aux
   frontières de palier, faces + tranches, **liseré au biome** ; **occlusion**
   vérifiée (un acteur passe derrière une falaise plus au nord, devant une plus
   au sud) ; **eau plate en contrebas de berges franches**, alignées à la grille
   (l'eau ne déborde plus) ; rivières en canaux bordés de falaises (érosion).
3. **Ombre solaire** : les faces s'assombrissent du côté opposé au soleil ;
   bascule matin↔soir, plate à midi.
4. **Revert propre** : plus aucune référence à `warp`/`RELIEF_H`/`unproject`/lift ;
   picking `floor(px/TILE)` correct ; `pnpm check`/`lint`/`test`/`build` verts.
5. **Alignement collision** : un clic sur une tuile vise la bonne tuile (picking
   plat exact) ; une falaise dessinée à une frontière coïncide avec la grille.

## 8. Décision à consigner

Ajouter à `docs/decisions.md` : « 2026-07-11 — [rendu] Abandon du warp continu
(spec 2026-07-10) au profit d'un relief DISCRET par falaises (paliers + faces,
occlusion, aligné collision). Motif : limites structurelles du warp démontrées en
playtest (repli, désalignement, intégration eau). Renoue avec la verticalité en
couches discrètes (GDD §14). L'érosion et l'ombre solaire sont conservées et
adaptées. »
