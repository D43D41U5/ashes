# Design — La Vallée alpine, SP1 : le substrat procédural (/sim)

**Date** : 2026-07-07 · **Statut** : validé en brainstorming, en attente de relecture écrite

## Contexte et objectif

Les passes précédentes ont rendu la carte *moins droite* (bruit gradient, warp, méandre) mais
pas *alpine* : la génération reste un semis de biomes à plat sur 192×192, sans relief ni
composition. Alexis veut que **la carte donne la sensation d'une vraie vallée alpine** —
organique, complexe, exploitable, où **l'exploration récompense** par des paysages variés — et
qu'elle soit **traversable en ~10 min en X et ~15 min en Y**.

Ce document spécifie **SP1 : le substrat**, entièrement dans `/sim`, headless et déterministe.
Deux sous-projets suivront dans leurs propres cycles :
- **SP2** — rendu chunké côté `/client` (+ passage `terrain`/`height` en tableaux typés Uint8),
  prérequis pour *voir* un monde de cette taille (la cuisson en texture unique dépasse la limite
  GPU — dette déjà notée `docs/decisions.md`).
- **SP3** — palette alpine + ombrage de relief côté `/client`.

**Hors périmètre de SP1** : tout rendu client, la palette, l'ombrage, l'optimisation
transfert/mémoire par tableaux typés (SP2). SP1 se valide **headless** : tests + **vignettes
PNG hors-ligne** générées par un script de dev (je les regarde pour juger la composition avant
que SP2 existe).

## Décisions de design actées (brainstorming 2026-07-07)

1. **Ambiance « entre les deux »** : fond de vallée généreux mais nettement encaissé, conifères
   denses sur les pentes, ceinture d'éboulis/roche franche, sommets enneigés tout autour, lac
   glaciaire turquoise (la couleur = SP3 ; ici on pose le terrain `deep_water` du lac).
2. **Structure pilotée par l'altitude** : un champ de hauteur déterministe pilote le terrain, au
   lieu des rectangles de région actuels. `paintBiomes` (régions) est **retiré**.
3. **Terrain complexe, pas un bol** : une **épine habitable** (fond de vallée : rivière +
   prairie, spawn, villages, chemins) + une **périphérie explorable** sculptée en crêtes/combes/
   balcons/poches par du bruit multi-échelle warpé. Franchir une crête = découvrir un paysage.
4. **Variété par deux champs** : altitude **×** humidité → une dizaine d'ambiances (prairie,
   tourbière de fond, conifères denses en combe, conifères clairsemés près de la limite des
   arbres, éboulis, falaises, tarn d'altitude, névé…) au lieu de 4 bandes uniformes.
5. **Deux nouveaux terrains** (léger gameplay) : `scree` (éboulis, **marchable**, speedFactor
   0.7), `snow` (neige, **bloquant**, comme la roche — les pics ne se franchissent pas).
6. **Pics scellés** : l'enceinte reste infranchissable tout autour (invariant « on ne sort pas
   de la carte »). C'est un **cirque alpin** fermé, pas une vallée ouverte à un bout.
7. **Échelle ~2400×3600 tuiles** (WALK_SPEED 4 t/s → 10 min ≈ 2400, 15 min ≈ 3600 ; le relief
   fait contourner, donc le *chemin* réel dépasse la distance à vol d'oiseau — la taille exacte
   se **calibre en chronométrant une vraie traversée**). Dimensions = **paramètres**, jamais en
   dur. SP1 garde `number[]` (les tableaux typés = SP2).
8. **Peuplement procédural + ancres** : la rivière **suit le thalweg** (hydrologie descendante) ;
   cols, tarns, forêts, poches de ressources, sites de village sont **placés par règles** sur le
   relief ; une poignée d'**ancres artisanales normalisées** (coord 0-1 → tuiles) fixe le spawn
   et 2-3 lieux majeurs. Renverse la philo « squelette artisanal » vers **procédural d'abord,
   artisanal en accent** — assumé pour tenir un monde 150× plus grand.

## Invariants respectés

- **`/sim` pur, déterministe bit-exact** : tout le champ de hauteur, l'hydrologie et le placement
  n'utilisent que `+ − × /`, `Math.sqrt`, `abs/floor/ceil/round/trunc/sign/min/max/imul/fround`,
  constantes, et les primitives de bruit (`fbm2`/`fbmWarp2`/`hash2`, déjà exactes). **Aucune**
  trigonométrie ni `pow/exp/log/**`. Lint de pureté vert.
- **Pas de 3D** : `height` ne sert qu'à (a) typer le terrain et (b) l'ombrage 2D (SP3). Le
  déplacement/collision restent plats (AABB grille). Aucune perspective ni géométrie 3D.
- **État JSON-sérialisable** : `WorldMap` reste des tableaux/objets simples (pas de Map/Set).
- **`generateNodes` positionnel** (acquis) : la refonte du terrain ne peut plus affamer un
  village par ricochet RNG → le recalibrage du banc est robuste.

## Le champ de hauteur `H(x, y) ∈ [0, 1]`

Calculé une fois à la génération, stocké dans `WorldMap.height: number[]` (consommé par SP2/SP3).
Composé, dans l'ordre :

1. **Enceinte (seal)** : `edge = min(x, y, W-1-x, H-1-y)` ;
   `rim = clamp01((RIM_DEPTH − edge) / RIM_DEPTH)` → 1 au bord, 0 au-delà de `RIM_DEPTH`. Force
   l'anneau de pics. `RIM_DEPTH` = fraction de `min(W,H)` (scalable).
2. **Relief intérieur multi-échelle** (la complexité) :
   `relief = 0.55·fbmWarp2(x,y,S_MACRO,a,w) + 0.30·fbmWarp2(x,y,S_MID,b,w) + 0.15·fbmWarp2(x,y,S_FINE,c,w)`
   → crêtes, bassins, balcons, éperons organiques dans [0,1]. Les échelles `S_*` sont des
   fractions de `min(W,H)` (scalable). Le warp casse tout alignement.
3. **Combinaison** : `H0 = max(rim, relief)`. L'enceinte gagne toujours au bord ; l'intérieur
   prend son relief.
4. **Hydrologie (le thalweg)** : voir section suivante — les rivières creusent `H0` là où l'eau
   s'écoule, garantissant que le fond de vallée est le point bas et l'épine habitable.

`H = clamp01(H0 − channelCarve)`. Les constantes (RIM_DEPTH, poids, échelles) sont du **contenu
de carte** documenté à côté du générateur, pas de l'équilibrage.

## Hydrologie procédurale — la rivière suit le thalweg

Plutôt qu'une polyligne dessinée à la main, l'eau **découle du relief** (déterministe, pur) :

1. **Sources** : échantillonnées dans les hauteurs (fort `H0`), nombre = densité × surface.
2. **Écoulement (steepest-descent D8)** : depuis chaque source, avancer vers le **voisin le plus
   bas** de `H0` (départage déterministe par `hash2` en cas d'égalité), en accumulant le flux,
   jusqu'à atteindre un exutoire (bord bas / eau existante) ou un **minimum local** (→ lac).
3. **Rivière vs ruisseau** : les cellules à forte accumulation de flux deviennent **rivière**
   (deep + berges shallow, franchissement politique) ; les faibles restent **ruisseaux** shallow
   franchissables (le méandre de ruisseau de `feat/ruisseaux-meandre` se fond ici). Les
   thresholds d'accumulation = contenu.
4. **Lacs & tarns** : un minimum local où l'eau s'accumule sans exutoire → poche d'eau. Bas =
   **Lac** (grand, turquoise) ; haut (dans un bassin de pente) = **tarn** d'altitude (récompense
   d'exploration). Berges bruitées (`stampBlob`).
5. **Carve** : les cellules d'eau abaissent `H` autour d'elles → le fond de vallée est bien le
   point bas, l'épine est basse et habitable.

Coût : accumulation O(N) après un tri par hauteur (~N log N). À 8,6 M tuiles, quelques secondes,
une seule fois à la création du monde. Acceptable (génération one-shot).

## Le champ d'humidité `M(x, y) ∈ [0, 1]` et l'attribution du terrain

`M = fbmWarp2(x,y,S_MOIST,seedM,warpM)` + bonus de **proximité à l'eau** + bonus de **basse
altitude**. Il diversifie *à l'intérieur* d'une bande de hauteur. Par tuile :

- **Eau** (rivière/lac/tarn issus de l'hydrologie) → `shallow_water`/`deep_water`.
- **Sinon**, par bande de `H`, modulée par `M` :
  - `H < T_FLOOR` (fond) : `M` haut → **marsh** (tourbière) ; sinon **grass** (prairie/alpage).
  - `T_FLOOR..T_FOREST` (pentes basses) : **forest** (conifères). Dense si `M` haut/abrité ;
    clairsemée près de `T_FOREST` (limite des arbres → mélange forest/scree).
  - `T_FOREST..T_SCREE` : **scree** (éboulis).
  - `T_SCREE..T_SNOW` : **rock** (falaises).
  - `H ≥ T_SNOW` : **snow** (névé/pics).
- L'anneau externe reste **scellé** (`sealBorderRing`), quoi qu'ait fait le bruit.

Les seuils `T_*` et cutoffs de `M` = **constantes de calibrage** (contenu), réglées à la vignette.

## Placement procédural des features + ancres

- **Ancres normalisées** (coord 0-1 → tuiles, poignée) : le **spawn** (sur le fond, près d'eau,
  central) et 2-3 lieux majeurs (ex. le **Col** en tête de vallée, l'**exutoire du Lac**). Chaque
  ancre est *snappée* au terrain valide le plus proche (fond marchable).
- **Features par règles** (densité → scalable), en scannant `H`/`M`/l'hydrologie :
  - **Cols/passes** : saddles bas dans les crêtes (minimum local de `H` sur une ligne de crête)
    → points de passage nommés, traversables.
  - **Tarns** : déjà issus de l'hydrologie (bassins hauts).
  - **Poches de ressources** : mine profonde (gisement) au fond d'un **cirque rocheux** en
    cul-de-sac ; carrières (scree/rock) ; tanières (forêt dense) ; prairies riches en baies.
  - **Sites de village** : replats de fond (`H` bas, pente faible mesurée par le gradient local
    de `H`) près d'eau, espacés entre eux et du spawn. Le générateur **renvoie** ces sites
    (`VEILLEE_SITES` en dérive — fin des coordonnées de village en dur).
- **Chemins** : reliant spawn → sites → cols le long du fond, via A* pur (`findPath` existant)
  sur un coût = `f(pente locale, eau)` → routes qui suivent le terrain, jamais droites. Le
  méandre reste une option mais l'A* sur relief donne déjà de l'organique.

## Structure des fichiers (indicative — le plan détaillera)

- `packages/sim/src/balance.ts` — ajout de `scree` (walkable, 0.7) et `snow` (bloquant) à la
  table `TERRAINS` (+ ids `TERRAIN_SCREE`, `TERRAIN_SNOW`).
- `packages/sim/src/map.ts` — `WorldMap` gagne `height: number[]` ; helpers (`heightAt`).
- Nouveau `packages/sim/src/alpinegen.ts` (ou refonte de `valleygen.ts`) — le pipeline :
  `computeHeight` → `computeMoisture` → `carveHydrology` → `paintElevationBands` →
  `placeFeatures` → `carvePaths`. Réutilise `noise.ts`, les primitives (`stampBlob`,
  `paintPolyline`, `stampDisk`), `findPath`.
- `packages/sim/src/valley-veillee.ts` — remplacé par des **ancres normalisées** + densités de
  features (plus de squelette 192×192 codé en dur). `VEILLEE_SITES` dérive de la sortie du
  générateur.
- `packages/sim/src/economy.ts` — `generateNodes` gagne les cas `scree`/tanière si besoin
  (éboulis → un peu de pierre ; sinon inchangé, déjà positionnel).
- Un script de dev (hors build) pour les **vignettes PNG** (downscale du height/terrain en image)
  — outil de validation visuelle headless, pas du code de jeu.

## Critères d'acceptation (tests headless)

1. **R1 — Déterminisme** : même seed + mêmes dimensions → `terrain`, `height`, sites de features
   identiques bit à bit.
2. **R2 — Bandes ordonnées & enceinte** : la neige n'apparaît qu'au-dessus de la roche au-dessus
   de l'éboulis au-dessus de la forêt au-dessus du fond (corrélation `H` ↔ terrain monotone) ;
   l'anneau externe est intégralement bloquant.
3. **R3 — Épine basse & habitable** : le fond de vallée (rivière + prairie) a un `H` bas ; les
   sites de village tombent sur du marchable nourrissable (prairie/forêt), pas dans l'éboulis/la
   neige.
4. **R4 — Hydrologie saine** : chaque cours d'eau s'écoule vers un exutoire ou un lac (pas de
   rivière suspendue) ; l'eau ne bloque jamais un ruisseau (shallow franchissable).
5. **R5 — Connectivité / exploitable** : flood-fill depuis le spawn atteint **tous** les sites de
   village, la mine profonde, et au moins un col vers chaque « salle » majeure. Rien
   d'important n'est muré.
6. **R6 — Variété** : au moins `N` ambiances distinctes présentes (prairie, marsh, forêt dense,
   forêt clairsemée, éboulis, roche, neige, tarn) au-dessus d'un seuil de surface chacune —
   preuve que le double champ produit du varié, pas 2 biomes.
7. **R7 — Scalabilité** : générer à **deux tailles** (ex. 480×720 et 960×1440) → quantités de
   features (cols, tarns, sites, ruisseaux) proportionnelles à la surface/au périmètre ; aucune
   quantité figée ; dimensions lues des paramètres.
8. **R8 — Banc de scénario vert** : villages sur les sites procéduraux, banc `test:scenario` à
   **0 échantillon affamé** (à une échelle de test raisonnable ; nœuds positionnels → robuste).
9. **R9 — Traversée chronométrée** : un test mesure le temps d'une traversée A*/marche bord-à-bord
   au fond de vallée ; il encadre les dimensions cibles pour viser ~10 min X / ~15 min Y (ajusté
   à la vignette). Documente l'écart vol-d'oiseau ↔ chemin réel.
10. **R10 — Pureté** : `pnpm lint` vert — aucune opération Math interdite.
11. **R11 — Vignette** : le script produit une image lisible du terrain + une du relief à seed
    fixe, pour la revue visuelle (critère « ça sent l'alpin » jugé à l'œil, comme au smoke).

## Séquence indicative

terrains balance → `height`+`moisture` → hydrologie → bandes → features+ancres → chemins →
`VEILLEE_SITES` dérivés + banc recalibré → script vignette + réglage des seuils à l'œil. Validé
headless ; le rendu en jeu vient avec SP2.

## Risques & notes

- **Performance de génération** à 8,6 M tuiles : quelques secondes one-shot ; le tri d'hydrologie
  est le point chaud. On teste la *correction* à échelle moyenne et la *scalabilité* à deux
  tailles ; le plein format se valide par vignette + un chrono de génération borné.
- **Mémoire** : `number[]` à 8,6 M est lourd (~70 Mo) — toléré en SP1 (génération Worker/Node
  one-shot) ; les tableaux typés arrivent en SP2 (transfert/rendu).
- **Le banc de scénario** à grande échelle : les 3 villages deviennent des points dans un vaste
  monde ; le banc valide l'écosystème *local* à leurs sites. On peut le faire tourner à une
  échelle de test réduite tout en générant la carte cible séparément.
- **Cohérence toponymique** : les noms (le Col, le Lac, la Vieille Forêt) deviennent des labels
  posés sur les features procédurales correspondantes, pas des rectangles.
