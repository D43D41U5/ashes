# Design / handoff — POIs de la Vallée alpine (prochaine session)

**Date** : 2026-07-08 · **Statut** : cadré en brainstorming, à implémenter la prochaine session.
Fait suite au substrat alpin (branche `feat/vallee-alpine`, poussée). **Villages & cols mis de
côté** volontairement (Alexis) — cette session-là = **les POIs uniquement**.

## Objectif
Peupler la carte de **points d'intérêt denses mais bien espacés**, **variés**, avec **plusieurs
exemplaires de chaque type** (« une seule mine, c'est trop peu »). L'exploration doit récompenser
sans saturer.

## Décisions actées (Alexis)
- **Densité : « rare et précieux »** — cible **~90 POIs** sur le monde de **2400×3600 tuiles**
  (= 10 min de marche en X, 15 min en Y à `WALK_SPEED_TILES_PER_S = 4`). Ça donne un espacement
  typique voisin-à-voisin **~310 tuiles**, soit une trouvaille toutes les **~90 s de marche
  (~1 min 48 ressenti**, terrain lent + détours). **Espacement minimal ~120 tuiles** (plancher
  non contraignant : le max théorique à ce min-spacing est ~480 POIs). L'entre-deux reste
  sauvage/contemplatif ; chaque trouvaille compte.
  - *Validation (2026-07-08)* : l'ancienne cible « 40-60 s / 55-90 POIs » se contredisait d'un
    facteur ~2 — 40-60 s exigerait ~150-340 POIs, ce qui tuerait le contemplatif. Le compte est
    resté « rare/précieux », c'est la cadence affichée qui est corrigée. Barème complet dans le
    fil de session ; à ~90, traverser toute la carte E-O (10 min) ne croise que ~2-3 POIs à vue.
- **Les quatre familles** sont incluses dès la première fournée.

## Le mécanisme de placement (la clé)
- **Semis en bruit bleu / Poisson-disk** : tirage de points candidats avec une **distance
  minimale garantie** entre POIs → jamais de grappe, jamais deux collés. Déterministe (dérivé de
  la seed + hash), pur.
- **Un seul curseur de densité globale** + l'espacement mini → règle « dense mais pas tous les
  10 m » d'un cran. Densité par unité de surface → **scalable**.
- **Table pondérée par biome** : chaque point tiré reçoit un **type valide pour son biome local**
  (une tanière en forêt, un gisement en cirque rocheux, une cabane en alpage…), via des poids
  (cairns fréquents, sanctuaires rares). Certains types portent un espacement mini propre.
- **Sortie** : les POIs deviennent des `Zone` nommées (`map.zones`, mécanisme `zoneAt` existant),
  lisibles par le HUD/chronique et par `generateNodes` (kinds comme `gisement`/`carriere`).

## Catalogue (ordres de grandeur pour ~90 total, densité « rare/précieux »)

**Économie / ressources**
- Gisements (fer+charbon, cirques minéralisés) ~2-3 · Carrières de pierre (éboulis/blocs) ~3-4 ·
  Salines (le gibier s'y rassemble) ~2-3 · Sources glaciaires (eau pure, près des glaciers) ~2-4

**Abris / structures**
- Ruines / hameaux abandonnés (loot, histoire) ~3-4 · Cabanes de berger (refuges d'alpage) ~3-5 ·
  Abris sous roche (falaises) ~4-6

**Danger / faune**
- Tanières (sanglier/loup/ours, par biome) ~5-8 · Repaires de monstres (spawns de nuit) ~3-5

**Récompense / paysage**
- Belvédères (révèlent la carte) ~3-4 · Grottes (petit loot ; **futures entrées de souterrain
  2.5D** — voir mémoire verticalite-couches-2-5d) ~3-5 · Cascades (torrent qui saute une falaise)
  ~2-4 · Blocs erratiques géants (repères) ~3-5 · Arbres remarquables (vieux mélèze, en
  old-growth) ~2-3 · Cairns / bornes (navigation + petite cache) ~8-12 (les plus fréquents) ·
  Sanctuaires / vieux autels (rare, loot rare + histoire) ~1-2

## Plan de la session
1. **Fondation** : `poissonPoints(width, height, seed, minSpacing, density)` (bruit bleu, pur,
   déterministe) + une **table de POI pondérée par prédicat de biome**.
2. **Types** : implémenter les POIs des quatre familles ci-dessus, chacun posant sa `Zone` nommée
   (+ effet terrain léger si pertinent : entrée de grotte, tas de blocs, structure de ruine…),
   et branchant `generateNodes` là où il faut (gisements, carrières, salines).
3. **Réglage à la vignette** : afficher les POIs **en pastilles colorées par famille** sur la
   vignette PNG → on cale la densité/espacement **à l'œil ensemble** (workflow habituel, 4 images).

## Critères d'acceptation (headless)
- **Déterminisme** : même seed → mêmes POIs (position, type) bit à bit.
- **Espacement** : aucun couple de POIs à moins de `minSpacing` (invariant testé).
- **Biome-cohérence** : chaque POI est sur un biome autorisé pour son type (pas de gisement dans
  le lac, pas de cabane dans la neige).
- **Densité** : le nombre suit la surface (scalable, deux tailles) et tombe dans la fourchette
  « rare/précieux » visée — ~90 sur 2400×3600 (espacement typique ~310 t, cadence ~90 s de marche).
- **Connectivité** (léger) : les POIs sont majoritairement atteignables (flood-fill) — les rares
  enclavés sont assumés (récompense de crapahut) mais bornés.
- **Pureté** : `pnpm lint` vert.

## Notes
- Villages & cols : **différés** (pas cette session). Certains POIs (grotte/mine souterraine,
  tour) portent le hook **2.5D réservé** — ici on ne pose que leur **entrée en surface**.
- Le « cirque minéralisé » (biome ajouté au substrat) est le contexte naturel des gisements.
