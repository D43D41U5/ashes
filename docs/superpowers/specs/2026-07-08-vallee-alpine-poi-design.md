# Design / handoff — POIs de la Vallée alpine (prochaine session)

**Date** : 2026-07-08 · **Statut** : **liste figée (26 types), à implémenter** (plan → subagents).
Fait suite au substrat alpin + Température/Cendreux (branche `feat/vallee-alpine`). **Villages & cols
mis de côté** volontairement (Alexis) — ici = **les POIs uniquement**.

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

## Catalogue — 26 types figés (reprise 2026-07-08)

**Règles de la reprise (Alexis)** :
- **Zéro nouvelle ressource** : tout POI qui aurait ajouté un item à l'économie est **coupé** —
  carrière d'argile, coupe de tourbe, ruche sauvage, source glaciaire (eau : pas de soif dans le jeu).
  On ne complexifie pas l'économie pour l'instant.
- **Zéro nouvelle créature** : seuls `boar` (sanglier) et `cendreux` (prêt) sont posés. L'**ours** devient
  une **variante d'abri sous roche** (hook « tanière », peuplé quand la faune s'enrichira) ; le **loup**
  est différé (nouveau type). Les tanières v1 = sanglier seul.
- Contenus autorisés = **Zones nommées + effet terrain léger + loot d'items existants** + branchement
  `generateNodes` **uniquement** sur gisement/carrière (kinds existants).

Poids **indicatifs** (le semis génère ~90 points, la table les distribue ; plafonds durs sur les types
rares). 26 familles à ~90 → certains types à **1-2 exemplaires** (rareté assumée).

**Économie (4)** — items existants uniquement
- Gisement (fer+charbon) · cirque minéralisé — Carrière de pierre · éboulis/blocs —
  Saline = **spot de chasse** (le gibier s'y rassemble ; viande existante, *pas de sel-item*) · alpage —
  Verger / bosquet à baies (baies existantes) · prés/lisières

**Abris (6)**
- Ruines / hameau abandonné (loot, histoire, réhabilitable) · fond/vieille forêt —
  Cabane de berger · alpage — **Abri sous roche** *(variantes : vide · tanière[hook ours])* · falaises/blocs —
  Mine abandonnée / galerie (loot + **hook souterrain 2.5D**) · cirque/falaise —
  Oratoire / chapelle de col (refuge + histoire) · cols — Vieux bivouac (trace + cache) · partout

**Danger (5)**
- Tanière de sanglier (`boar`) · forêt basse — **Repaire de Cendreux** (nid pré-placé, `cendreux` prêt) ·
  brûlis/grottes/hautes zones — Épave d'avalanche gelée (butin figé + **un mort qui peut se lever** →
  boucle Cendreux) · couloirs d'avalanche — Fondrière / marais traître (**piège du terrain**, pas de
  créature) · tourbière/roselière — Champ de crevasses (piège du glacier) · glacier

**Récompense / paysage (11)**
- Belvédère (révèle la carte) · sommets/crêtes — Grotte (loot + **hook 2.5D**) · falaises/cirque —
  Cascade (paysage + cache derrière) · falaise+eau — Bloc erratique géant (repère) · moraines/prés —
  Arbre remarquable (vieux mélèze) · old-growth — Cairn / borne (navigation + cache) · partout —
  Sanctuaire / vieil autel (rare, loot + histoire) · reculé — Source chaude / mare thermale (oasis de
  chaleur : **réutilise le warming de la jauge Température**, pas d'item) · haute altitude —
  Arche / pont naturel (spectacle + franchir) · falaise — Tarn / lac suspendu nommé (terrain eau,
  pas d'item) · cirque/alpage — Pétroglyphes / pierre gravée (lore muet, très rare) · reculé

Types différés (hors v1) : ours (variante d'abri à peupler), loup (nouveau type), et tout POI-ressource ci-dessus.

## Plan de la session
1. **Fondation** : `poissonPoints(width, height, seed, minSpacing, density)` (bruit bleu, pur,
   déterministe) + une **table de POI pondérée par prédicat de biome**.
2. **Types** : implémenter les 26 POIs, chacun posant sa `Zone` nommée (+ effet terrain léger si
   pertinent : entrée de grotte, tas de blocs, structure de ruine…), branchant `generateNodes`
   **uniquement** sur gisement/carrière (kinds existants), et posant les monstres existants
   (sanglier en tanière, `cendreux` en repaire) + le loot d'items existants. La saline ne fait que
   densifier la faune (spot de chasse), sans ressource.
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
