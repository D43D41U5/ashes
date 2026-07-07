# Design — La Vallée organique : bruit gradient + macro-structure

**Date** : 2026-07-07 · **Statut** : validé en brainstorming, en attente de relecture écrite

## Contexte et objectif

La passe d'organicité **sous-projet 1** (spec `2026-07-06-vallee-organique`, actée le
2026-07-07) a traité les *contours* : berges bruitées (`stampBlob`), roche de biome en amas,
enceinte multi-octave, réseau d'eau, mines creusées dans la bordure. La carte est nettement
mieux — mais elle reste perçue comme « pas organique, peu crédible, trop droite dans ses
features ». À la lecture du pipeline, trois causes précises, **toutes hors périmètre du
sous-projet 1**, subsistent :

1. **Le moteur de bruit est du *value noise* pur** (`noise.ts` → `valueNoise2`). Le bruit de
   valeur a des **artefacts alignés sur la grille des entiers** : les taches de biome
   naissent calées sur les axes, ce qui « fait généré » quelle que soit la primitive au-dessus.
2. **Les biomes sont découpés en rectangles alignés sur les axes.** `paintBiomes` fait
   `regions.find(r => tx >= r.x && tx < r.x + r.w …)` : chaque tuile appartient à exactement
   une région, et la densité de forêt saute d'un coup à la frontière. La Vieille Forêt
   (`forest: 0.62`) colle à la Plaine (`forest: 0.35`) → une **couture droite** à chaque bord
   de région.
3. **Rivière et routes sont des polylignes lerpées linéairement** (`paintPolyline`) : segments
   rectilignes entre points de contrôle. Une vraie rivière **méandre** ; là elle fait des angles.

Ce sous-projet est une passe de **fond (le bruit) + macro-structure (régions, rivière)**. Comme
le sous-projet 1 : tout vit dans `/sim` (générateur + squelette + `noise.ts`), reste
déterministe **au bit près entre moteurs JS** (invariant n°2), et ne touche ni le rendu client
ni la collision.

**Indépendant du « sous-projet 2 » (le Pont à deux niveaux)**, toujours en attente de son propre
cycle. Les deux ne se chevauchent pas : celui-ci ne transforme pas le Pont en structure.

## Principe transversal — DÉTERMINISME BIT-EXACT (invariant n°2, non négociable)

Tout le nouveau code n'utilise que les opérations autorisées : `+ − × /`, `Math.sqrt`, `abs`,
`floor`, `ceil`, `round`, `trunc`, `sign`, `min`, `max`, `imul`, `fround`, les constantes.
**Aucune** fonction Math approximée (`sin`, `cos`, `pow`, `exp`, `log`, `**`, `hypot`). Le lint
de pureté (`pnpm lint`) le fait respecter — on ne le contourne jamais.

Concrètement, chaque brique est vérifiée compatible :
- **Bruit gradient** : produits scalaires (`+ − ×`), *fade* quintique polynomiale, sélection de
  gradient par bits de `hash2` (`imul`, `>>>`). ✓
- **Domain warping** : décalage de coordonnées par `+ − ×` et `fbm2`. ✓
- **Méandre** : normale au segment via `Math.sqrt` (autorisé), décalage par `fbm2`. ✓

La **scalabilité** posée au sous-projet 1 reste la loi : amplitudes de warp et de méandre sont
des **fractions de la feature** (taille de région, largeur de rivière), jamais des constantes
supposant 192×192. Grossir la carte ne lisse ni ne déchire. Ces amplitudes sont du **contenu de
carte** (constantes documentées à côté du générateur), pas de l'équilibrage (`balance.ts`).

## Volet A — Le moteur de bruit gradient (`noise.ts`)

**A1. `gradientNoise2(x, y, seed)` remplace `valueNoise2` comme base du fractal.** Bruit de
Perlin 2D :
- À chaque nœud entier `(i, j)` de la grille, un **gradient** tiré d'une table de 8 directions
  `(±1,0), (0,±1), (±1,±1)`, sélectionné par les bits de poids fort de `hash2(i, j, seed)`.
- La valeur en `(x, y)` est l'interpolation bilinéaire des **produits scalaires**
  `gradient · (distance au nœud)` aux 4 coins, pondérée par le ***fade* quintique**
  `t³(t(6t − 15) + 10)` (le polynôme de Perlin, C² continu → contours plus doux que le
  smoothstep cubique, et exact).
- Sortie normalisée puis **remappée en `[0, 1)`** — même intervalle que l'ancien `valueNoise2`,
  pour que les seuils des appelants (`< forest`, `> 1 − rock`, comparaisons de rayon) gardent
  leur sens sans retouche.
- Pourquoi ça règle l'artefact grille : le bruit gradient vaut **0 aux nœuds** ; les features
  naissent *entre* les nœuds, orientées par les gradients — plus de patates calées sur les axes.

**A2. `fbm2(x, y, scale, seed)` garde signature ET sémantique de `scale`.** Seule la base sous
le capot passe de `valueNoise2` à `gradientNoise2`. On conserve 3 octaves, lacunarité 2, la
même pondération normalisée `(a·4 + b·2 + c) / 7`. **Aucun appelant ne change** : `border`,
`ridges`, `mines`, `water`, `stampBlob`, `paintBiomes` héritent du nouveau grain gratuitement,
au même cadrage.

**A3. Nouveau helper `fbmWarp2(x, y, scale, seed, warpAmp)` — domain warping.** Décale les
coordonnées d'échantillonnage par un champ de bruit basse fréquence avant d'évaluer `fbm2` :
`fbm2(x + warpAmp·(qx·2 − 1), y + warpAmp·(qy·2 − 1), scale, seed)` où `qx`, `qy` sont deux
`fbm2` basse fréquence à seeds décorrélés. C'est le multiplicateur d'organicité — il tord toute
frontière qu'il touche. `warpAmp` **modéré** par défaut (décision de session : crédible sans
chaos), exposé en constante documentée pour ajustement au smoke test.

**A4. `valueNoise2` est retiré.** Plus aucun appelant une fois `fbm2` sur du gradient. On
supprime la fonction, son export dans `index.ts`, et ses tests dédiés dans `noise.test.ts`
(remplacés par les tests de `gradientNoise2`). Pas de code mort.

## Volet B — Biomes sans coutures (`valleygen.ts` → `paintBiomes`)

**B1. Frontières de région warpées.** Avant le `regions.find`, on **warpe la coordonnée de
lookup** : `(tx, ty)` → `(tx + wx, ty + wy)` avec un warp basse fréquence d'amplitude modérée
(≈ 8 tuiles à 192×192, exprimée en fraction de la plus petite dimension de région → scalable).
La frontière rectangulaire devient une **ligne irrégulière naturelle** : la Vieille Forêt
déborde en langues dans la Plaine au lieu de s'arrêter net. L'intention de design (« cette zone
est de la forêt ») est préservée — seul le *bord* devient organique.

**B2. Le même champ warpé alimente le seuil de biome.** `paintBiomes` échantillonne la densité
via `fbmWarp2` (au lieu de `fbm2`) avec le même warp. Un seul mécanisme, cohérent, réutilisé —
frontière et texture bougent ensemble, pas de dissonance.

## Volet C — Rivière et routes qui serpentent (`valleygen-primitives.ts` → `paintPolyline`)

**C1. Paramètre optionnel de méandre.** `paintPolyline(map, points, halfWidth, paint, meander?)`
avec `meander = { amp, scale, seed }`. Chaque disque tamponné le long d'un segment est **décalé
perpendiculairement** au segment : normale unitaire `n = (−dy, dx) / √(dx² + dy²)` (`sqrt`
autorisé), décalage `amp · (fbm2(arc, 0, scale, seed)·2 − 1) · n`, indexé sur l'**abscisse
curviligne** cumulée le long de la polyligne (continuité entre segments).

**C2. Taper aux extrémités — les jonctions ne bougent pas.** L'amplitude est fondue à 0 aux deux
bouts de chaque polyligne par une fenêtre `w(u) = min(1, 4·u·(1 − u))` (u = fraction d'arc
global). Conséquence : rivière → Lac, embranchements de routes, sources de ruisseaux restent
**exactement** où le squelette les pose. Rien en aval de la géométrie artisanale n'est cassé.

**C3. Amplitudes (décision « modéré »).** Rivière : `amp` ≈ `halfWidth + 1` (~3 tuiles). Routes :
méandre plus doux (~1 tuile) ou nul, jugé à l'œil au smoke test. Ridges et bordure : **pas** de
méandre (leur irrégularité vient déjà du bruit de largeur, sous-projet 1). Amplitudes en
fractions de `halfWidth` → scalables.

**C4. Croisements robustes au méandre.** Le Pont et le Gué sont tamponnés **après** la rivière,
sur un disque `stampDisk` de rayon `river.halfWidth + 2`. Comme la rivière méandre désormais, on
**élargit ce rayon de `ceil(amp)`** pour garantir qu'un croisement retombe toujours sur de
l'eau (sinon : pont sur l'herbe). Le taper C2 borne déjà le méandre près des extrémités, mais les
croisements sont en milieu de tracé → l'élargissement est la garantie.

## Architecture

- **`packages/sim/src/noise.ts`** — `gradientNoise2` (nouveau, base du fractal), `fbm2`
  inchangé en surface, `fbmWarp2` (nouveau), `valueNoise2` **retiré**. `hash2` inchangé (sert à
  la sélection de gradient et aux éboulis de bordure).
- **`packages/sim/src/index.ts`** — export : `valueNoise2` retiré, `gradientNoise2` et
  `fbmWarp2` ajoutés (miroir de la surface publique de `noise.ts`).
- **`packages/sim/src/valleygen.ts`** — `paintBiomes` passe au lookup warpé (B1) + `fbmWarp2`
  (B2). Les constantes de warp (amplitude, échelle, seeds) documentées en tête de fichier, à
  côté de `DEFAULT_BIOME`.
- **`packages/sim/src/valleygen-primitives.ts`** — `paintPolyline` gagne le paramètre `meander`
  optionnel (C1-C2), rétro-compatible (absent = comportement actuel). `paintRiver`/`paintRoads`
  dans `valleygen.ts` passent leur méandre ; `paintCrossings` élargit son rayon (C4).
- **`valleygen-water.ts` / `valleygen-mines.ts`** — inchangés (ils consomment `fbm2`/`stampBlob`,
  qui héritent du nouveau grain sans modification d'API).
- **`balance.ts`** — inchangé (amplitudes de warp/méandre = contenu de carte, pas d'équilibrage).
- **`VEILLEE_SKELETON`** — a priori inchangé structurellement ; seul un éventuel **recalibrage de
  densités de région** (volet Calibrage) peut retoucher des seuils de biome existants.

## Volet Calibrage — le vrai gate

Régénérer la carte déplace des tuiles, donc déplace les écosystèmes vivriers : `generateNodes`
lit le terrain en **une passe RNG séquentielle ligne par ligne**, sensible à tout changement en
amont (leçon chèrement apprise au sous-projet 1 : une carrière déplacée effondrait un village en
6 jours). Le nouveau grain de bruit + le warp des biomes **vont** bouger la répartition
forêt/roche/herbe.

- Après implémentation : `pnpm test` complet, puis le **banc de scénario** (`pnpm scenario` /
  `scenario.test.ts`, seed 2026).
- **Gate non négociable** : banc **propre** — 0 échantillon affamé, villages tenus sur 6 jours,
  comme l'état actuel. Si un village meurt, on rééquilibre (densités `forest`/`rock` des régions
  concernées, ou amplitude de warp locale) jusqu'à un banc vert. Le recalibrage fait partie du
  travail, pas d'un « après ».

## Critères d'acceptation (`noise.test.ts`, `valleygen.test.ts`, `valley-veillee.test.ts`)

1. **R1 — Déterminisme bit-exact** : `gradientNoise2`, `fbm2`, `fbmWarp2` renvoient la **même
   valeur** pour les mêmes `(x, y, seed)` sur appels répétés ; `generateValley(skeleton, seed)`
   produit `terrain` et `zones` identiques bit à bit d'un run à l'autre. (Étend le test existant.)
2. **R2 — Grain gradient sain** : `gradientNoise2` est dans `[0, 1)`, continu (deux points
   proches → valeurs proches, remplace l'ancien test de continuité de `valueNoise2`), et
   **vaut ≈ 0.5 aux nœuds entiers** (propriété caractéristique du bruit gradient remappé —
   preuve qu'on n'est plus sur du value noise). Moyenne empirique sur un échantillon ≈ 0.5.
3. **R3 — Biomes sans couture droite** : sur une frontière de région donnée (ex. Vieille
   Forêt / Plaine), la ligne de transition forêt n'est **pas** verticale — mesurée par la
   variance de la position `x` du premier tuile-forêt le long de la frontière (> seuil), preuve
   du warp. La densité globale de forêt par région reste proche de son `forest` cible (le warp
   déforme le bord, pas la quantité).
4. **R4 — Rivière méandrée mais connectée** : la rivière n'est pas une suite de segments droits
   (variance d'écart à la corde entre points de contrôle > seuil) ; elle **touche toujours le
   Lac** ; le Pont et le Gué retombent sur de l'eau (`shallow`/`deep`) sous leur disque élargi.
5. **R5 — Non-régression sous-projet 1** : les critères R1-R7 de la spec `2026-07-06` (contours
   organiques, eau non bloquante, mines atteignables, Collines habitables, **scalabilité à deux
   tailles**) restent verts sur la nouvelle base de bruit.
6. **R6 — Non-régression monde** : les invariants de `valley-veillee.test.ts` (connectivité des
   landmarks, spawn atteignable, présence/sanité, atteignabilité du minerai) restent verts.
7. **R7 — Banc de scénario vert** : `scenario.test.ts` (seed 2026, 6 jours) — **0 échantillon
   affamé**, villages tenus. Gate de merge.
8. **R8 — Pureté** : `pnpm lint` vert — aucune opération Math interdite introduite dans
   `noise.ts` ni ailleurs.

## Séquence et estimation

A (le moteur, que tout le reste hérite) → B (biomes warpés) → C (méandre) → recalibrage densités
→ smoke test navigateur (build + preview, `window.__BRAISES__`) pour juger « organique » sur le
vrai rendu — seul juge qui compte pour ce critère. Un lot cohérent de générateur, `noise.ts` +
`valleygen.ts` + primitives touchés, tests re-pinnés. Pas de toucher au client ni à la collision.
