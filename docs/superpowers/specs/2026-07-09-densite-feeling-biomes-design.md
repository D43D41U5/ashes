# Densité & feeling des biomes — décor cosmétique + clustering des nœuds

**Date** : 2026-07-09
**Branche** : feat/vallee-alpine
**Statut** : design validé, en attente de plan d'implémentation

## Problème

Sur la carte alpine (1200×1800 = 2,16 M tuiles), les biomes se lisent comme
« vides » : une forêt ressemble à de l'herbe verte avec un arbre isolé de temps
en temps.

Cause racine identifiée dans le code :

- Ce qu'on voit comme « arbres » sont des **nœuds de ressource** (`generateNodes`,
  `economy.ts`), pas le terrain. Le terrain forêt est peint densément, mais les
  nœuds sont **sous-échantillonnés de façon uniforme** à `density = 0.025`
  (`client/src/worker/veillee.ts:57`).
- Effet : une tuile de forêt n'a plus que `0.025 × 0.22 ≈ 0.55 %` de chance de
  porter un arbre, soit ~1 arbre pour 180 tuiles, **distribués isolément**.
- Ce sous-échantillonnage existe parce que **chaque tick (20 Hz) `sim.nodes` est
  transporté en entier** (structured-clone worker aujourd'hui, réseau en multi
  demain — `sim-worker.ts:48`). Sans la borne, la grande carte produirait des
  centaines de milliers de nœuds transportés 20 fois/seconde.

Le `density = 0.025` est donc un pansement uniforme qui sacrifie le feeling pour
tenir le budget de transport.

## Objectif

Rendre chaque biome **visuellement dense et vivant** (« ça ressemble à une
forêt/lande/marais ») **et** la récolte plus **lisible et généreuse** (« ça se
joue comme une forêt : les ressources sont là où le biome le promet »), **sans
augmenter le budget de transport des nœuds**.

## Décisions actées (issues du brainstorming du 2026-07-09)

1. On veut **les deux** : densité visuelle ET récolte plus généreuse.
2. Côté nœuds réels : **clustering à budget constant** — on ne relève PAS la
   densité et on ne refactore PAS le protocole snapshot. On redistribue le même
   nombre de nœuds en bosquets/gisements.
3. Le décor dense est une **couche cosmétique côté client, culled à la vue** —
   jamais dans `/sim`, jamais dans les snapshots.
4. Les nœuds récoltables sont **visuellement distincts** du décor (plus gros,
   plus saturés) — repérables de loin.
5. Le traitement s'applique à **tous les biomes** (table biome → props), pas
   seulement aux forêts.
6. La répartition doit être **organique, réaliste et différente par biome** —
   jamais un semis uniforme. C'est une exigence de premier plan, pas un
   raffinement optionnel (voir « Réalisme des emplacements »).

## Invariants (non négociables pour cette feature)

- **INV-1 — Zéro collision, toujours traversable.** Le décor cosmétique n'existe
  que côté client, jamais dans `/sim`. Toute la collision (AABB terrain + nœuds
  bloquants) étant sim-side, un prop décoratif est un simple sprite : il est
  *structurellement* impossible qu'il bloque le déplacement. Aucune souche,
  aucun rocher décoratif ne doit jamais coincer le joueur.
- **INV-2 — Pas de confusion avec les vraies ressources.** Les props décoratifs
  sont plus petits (~0,6× l'emprise d'un nœud), ternis/désaturés, sans
  affordance d'interaction ni « fruit » visible (un buisson décoratif n'a pas
  les baies rouges d'un `berry_bush` récoltable).
- **INV-3 — Déterminisme du sim préservé.** Le clustering des nœuds reste une
  fonction pure, bit-exacte, mêmes seed+tuiles → mêmes nœuds (opérations
  autorisées uniquement : `+ - * / sqrt abs floor ceil round trunc sign min max`,
  pas de `sin/cos/pow/exp/log`).
- **INV-4 — Budget de transport inchangé.** Le nombre total de nœuds produits
  par `generateNodes` reste dans ±10 % du nombre actuel sur la carte alpine.
- **INV-5 — Stabilité visuelle.** Le décor est déterministe par tuile (fonction
  de `tx, ty, seed`) : aucun scintillement ni redistribution lors d'un pan/zoom.
- **INV-6 — Répartition organique et propre au biome.** Nœuds ET décor se
  placent via des champs spatiaux (amas + trouées) et l'affinité au voisinage,
  jamais par tirage indépendant par tuile. Chaque biome a sa signature de
  répartition (fréquence, seuil, affinité). Aucune régularité de grille
  perceptible.

---

## Système 1 — Clustering des nœuds (`packages/sim/src/economy.ts`)

### Principe

Remplacer le filtre de sous-échantillonnage **uniforme** actuel :

```ts
if (density < 1 && hash2(tx, ty, keepSeed) >= density) continue // uniforme
```

par un filtre piloté par un **champ de densité spatial basse fréquence** (bruit
de valeur à base de hash, dans l'esprit de `fbm2` déjà utilisé dans
`alpinegen.ts`, opérations déterministes uniquement) :

```
grove(tx, ty) ∈ [0, 1]      // champ lisse basse fréquence, positionnel
boost(g)                     // fonction croissante de moyenne 1 sur le domaine
keep si hash2(tx, ty, keepSeed) < density × boost(grove(tx, ty))
```

- Au **cœur d'un bosquet** (`grove` élevé), `boost > 1` → beaucoup de tuiles
  gardées → nœuds groupés.
- **Hors bosquet** (`grove` bas), `boost < 1` → presque rien → clairières vides.
- `boost` étant de **moyenne 1** sur le domaine, le **nombre total attendu de
  nœuds reste ≈ inchangé** (INV-4).

La fréquence du champ `grove` détermine la taille des bosquets (échelle en
tuiles, à calibrer — ordre de grandeur : bosquets de quelques dizaines de
tuiles). C'est une constante de calibration, pas un nombre en dur dans la
logique.

**Paramètres par biome (INV-6).** L'échelle et le contraste du champ diffèrent
selon le type de ressource : gros massifs pour les forêts, poches plus petites
et resserrées pour les myrtilliers de lande, veines plus étirées pour la pierre
d'éboulis. Ces paramètres vivent dans une table de calibration, pas en dur.

### Portée

Le champ s'applique **en amont de tout le `switch` de terrain** de
`generateNodes` : forêts en bosquets, landes en fourrés de myrtilliers,
éboulis en champs de pierre, etc. Aucune branche de terrain n'est réécrite —
seule la décision « garder cette tuile candidate ? » change.

### Tests (`economy.test.ts`, headless)

- **Déterminisme** : `generateNodes(map, seed, d)` appelé deux fois → tableaux
  identiques (déjà couvert, à préserver).
- **Budget** : total de nœuds sur la carte alpine à `density = 0.025` reste dans
  ±10 % du total avant clustering (INV-4).
- **Clustering effectif** : une métrique de regroupement augmente — p. ex.
  variance du nombre de nœuds par tuile de grille grossière (ou distance moyenne
  au plus proche voisin qui diminue) versus la distribution uniforme.

---

## Système 2 — Décor cosmétique (client)

### Module pur `packages/client/src/render/clutter.ts`

Cœur testable, **sans Phaser** (même patron que `framing.ts`, `keymap.ts`) :

```ts
// Table de calibration centralisée — l'équivalent client de balance.ts pour le feeling.
BIOME_CLUTTER: Record<terrain, { density: number; props: PropKind[] }>

// Sélection déterministe et pure : quels props sur cette tuile ?
// `neighbourhood` = petit accès en lecture au terrain autour (distance eau,
// lisière, parois) pour l'affinité réaliste — cf. « Réalisme des emplacements ».
clutterAt(tx, ty, terrain, seed, neighbourhood): PropInstance[]
// PropInstance = { kind, offsetX, offsetY, scale, mirror } — position/échelle/
// miroir jitterés de façon déterministe depuis hash(tx, ty, seed). Peut
// renvoyer PLUSIEURS props (understory). Densité modulée par un champ de bruit
// spatial (amas + trouées), jamais un coin-flip indépendant par tuile.
```

- Déterministe par tuile (INV-5).
- `density` par biome pilote la proportion de tuiles portant un prop (forêt
  ~40-60 %, prairie faible, etc.) — calibrable sans toucher au rendu.
- `props` par biome = liste de catégories cosmétiques (voir table).

### Rendu culled (`WorldScene` / nouveau helper de scène)

- À chaque frame, itérer **uniquement les tuiles visibles** (rect caméra), pool
  de sprites réutilisé (pas d'alloc par frame).
- Origine-pieds + tri de profondeur cohérent avec les entités et les nœuds
  (`computeSprite`, `framing.ts`) — un prop plus bas passe devant.
- Props rendus **sous** les vrais nœuds à profondeur égale, plus petits et
  ternis (INV-2).
- **LOD** : décor rendu seulement en-deçà d'un seuil de zoom (quand les props
  sont assez gros pour être lisibles). Dézoomé, le mouchetis `canopy` déjà baké
  (`bakeCanopyTexture`) porte la lecture des biomes. Borne la perf sur la grande
  carte (INV : jamais plus de ~N props à l'écran, N = tuiles visibles capées).

### Sprites placeholder (`BootScene`)

Un sprite placeholder par catégorie de prop, **généré procéduralement** via
`generateTexture` (même patron que les sprites de nœuds actuels — aucun pipeline
d'asset PNG introduit). Placeholders ternis/désaturés pour respecter INV-2, en
attendant un art définitif. Voir la section « Livrables — images placeholder ».

### Tests

- **`clutter.test.ts`** (pur, headless) : déterminisme de `clutterAt` (mêmes
  entrées → mêmes props), respect de la table par biome (un terrain sans décor
  renvoie `[]`, un biome dense renvoie des props de ses seules catégories), jitter
  borné dans la tuile.
- Le pooling/rendu Phaser reste dans la scène (non testé unitairement, cohérent
  avec la politique de test du projet centrée sur `/sim` et le cœur pur).

---

## Réalisme des emplacements (INV-6)

Le semis uniforme est banni pour les deux systèmes. Quatre leviers, tous
déterministes et sans données de sim supplémentaires (le client ne dispose que
du tableau `terrain` — les champs élévation/humidité de la génération ne sont pas
retransportés) :

1. **Champs de bruit spatial (amas + trouées).** La proportion locale de props
   dérive d'un champ basse fréquence, pas d'un tirage indépendant par tuile.
   Résultat : massifs pleins troués de clairières, au lieu d'une neige de points.
   **Paramètres propres à chaque biome** (dans `BIOME_CLUTTER`) :
   - Forêt / vieille forêt : grands massifs, fort contraste (couvert dense ↔
     clairières nettes).
   - Lande, pré fleuri : poches moyennes de fourrés/fleurs, densité modérée.
   - Alpage, prairie : semis fin et clairsemé, faible contraste.
   - Éboulis, chaos de blocs : trainées/champs de pierre.
   - Marais, roselière, tourbière : bouquets serrés.

2. **Affinité au voisinage** (analyse locale du tableau terrain, coût faible) :
   - **Roseaux/joncs collent au bord de l'eau** : densité fonction de la
     distance à une tuile d'eau (forte au contact, nulle à quelques tuiles).
   - **Sous-bois de lisière** : fougères/buissons plus denses là où la forêt
     jouxte un biome ouvert (prairie/lande) — la lisière est plus fournie que le
     cœur sombre.
   - **Débris au pied des parois** : cailloux plus denses le long des tuiles
     bloquantes (`ROCK`/`WALL`/`GLACIER`).

3. **Anti-grille** : position jitterée dans la tuile, variance d'échelle, miroir
   horizontal aléatoire — le tout déterministe depuis `hash(tx, ty, seed)`.
   Aucune régularité perceptible même à densité forte.

4. **Superposition (understory)** : en biome dense, une tuile peut porter
   plusieurs props de strates différentes (p. ex. fougère basse + conifère),
   triés par les pieds, pour un couvert en profondeur plutôt qu'un prop par case.

Ces mêmes principes (bruit spatial par biome, pas de tirage uniforme) régissent
le clustering des nœuds du Système 1 ; les deux systèmes doivent produire des
répartitions **cohérentes entre elles** (les bosquets de nœuds tombent dans les
massifs de décor, pas à côté) — obtenu en dérivant leurs champs du **même seed**.

### Tests du réalisme

- **Non-uniformité** : sur un biome homogène, la distribution des props/nœuds
  s'écarte significativement d'un Poisson uniforme (variance inter-cellules d'une
  grille grossière nettement supérieure à l'attendu uniforme).
- **Affinité eau** : la densité de roseaux décroît avec la distance à l'eau
  (fonction pure testable).
- **Cohérence** : un échantillon de tuiles à forte densité de décor forestier
  coïncide statistiquement avec les zones de bosquets de nœuds (même seed).

## Table biome → décor

Décor cosmétique (non récoltable) et cohérence avec la ressource groupée du
biome (Système 1) :

| Biome (terrain)              | Décor cosmétique dense                          | Nœuds groupés         |
|------------------------------|-------------------------------------------------|-----------------------|
| Forêt / ubac (`FOREST`)      | conifères sombres touffus, fougères, souches    | bosquets d'arbres     |
| Vieille forêt (`OLD_GROWTH`) | très gros troncs, sous-bois dense               | arbres abondants      |
| Pinède / adret (`PINE`)      | pins espacés, herbe sèche, cailloux             | arbres + baies        |
| Mélèzes (`LARCH`)            | mélèzes clairs dorés, herbes d'altitude         | arbres épars + fibres |
| Brûlis (`BURNT_FOREST`)      | troncs calcinés, jeunes pousses, cendres        | bois mort + baies     |
| Prairie (`GRASS`)            | touffes d'herbe, fleurs éparses, cailloux       | îlots rares           |
| Pré fleuri (`FLOWER_MEADOW`) | fleurs denses, hautes herbes                    | fibres + baies        |
| Lande (`HEATH`)              | bruyère, myrtilliers bas, cailloux              | buissons à baies      |
| Alpage (`ALPINE_MEADOW`)     | herbes hautes, gentianes, cailloux              | fibres                |
| Pelouse fleurie (`ALPINE_FLOWERS`) | edelweiss, gentianes                      | fibres                |
| Marais (`MARSH`)             | roseaux, joncs, flaques                         | baies + fibres        |
| Roselière (`REED_MARSH`)     | roseaux denses                                  | fibres riches         |
| Tourbière (`PEAT_BOG`)       | touradons, sphaigne                             | fibres                |
| Éboulis (`SCREE`)            | gravier, lichen, petits cailloux                | pierre                |
| Chaos de blocs (`BOULDERS`)  | gros blocs décoratifs, lichen                   | pierre dense          |
| Neige (`SNOW`)               | congères, rochers enneigés                      | —                     |

**Sans décor** : eau (`SHALLOW_WATER`, `DEEP_WATER`), `ROCK` / `WALL` / `GLACIER`
(bloquants — au plus des débris au pied), `ROAD`, `VOID`.

**Catégories de props placeholder à créer** (dédupliquées depuis la table) :
arbre-conifère, gros-tronc, souche, fougère, pin, mélèze, tronc-calciné,
touffe-herbe, fleur, cailloux, gros-bloc, bruyère/buisson-bas, roseau, sphaigne,
lichen, congère.

---

## Livrables — images placeholder

À la validation de la spec, créer un **placeholder par catégorie de prop**
ci-dessus (sprites procéduraux `generateTexture` dans `BootScene`), ternis pour
ne pas être confondus avec les vrais nœuds (INV-2). Une revue visuelle en
artefact (vignettes) accompagnera la livraison pour valider le rendu de chaque
décor avant l'art définitif.

---

## Hors périmètre (YAGNI)

- Pas de refactor du protocole snapshot (nœuds statiques hors-tick, deltas) —
  différé, non requis par le clustering à budget constant.
- Pas de streaming de monde (différé, cf. mémoire `streaming-world-gen`).
- Pas de props décoratifs interactifs ni destructibles.
- Pas de nouveaux biomes ni de nouvelles ressources.
- Pas de pipeline d'assets PNG — placeholders procéduraux uniquement.

---

## Critères d'acceptation

1. **Densité visuelle** : dans une forêt à zoom de jeu, l'écran est visiblement
   peuplé de décor (couvert dense), pas de l'herbe verte quasi vide.
2. **Tous les biomes** : chaque biome de la table présente son décor
   caractéristique (lande buissonnante, marais aux roseaux, éboulis pierreux…).
3. **Répartition organique (INV-6)** : à l'œil, massifs et clairières
   (pas de semis uniforme), signature distincte par biome, roseaux au bord de
   l'eau, lisières fournies, aucune grille perceptible. Vérifié en jeu + par les
   tests de non-uniformité/affinité.
4. **Lisibilité récolte** : les vrais nœuds ressortent du décor (plus gros/
   saturés) et se regroupent en bosquets/gisements cohérents avec le biome.
5. **INV-1** : impossible de se coincer sur un prop décoratif (traversée libre,
   vérifiée en jeu).
6. **INV-3/INV-4** : `pnpm test` vert — déterminisme préservé, total de nœuds
   dans ±10 % de l'ancien sur la carte alpine.
7. **INV-5** : aucun scintillement/redistribution du décor lors d'un pan/zoom.
8. **LOD** : dézoomé au maximum, la perf reste tenable (décor coupé, `canopy`
   prend le relais).
9. `pnpm check`, `pnpm test`, `pnpm lint` verts avant commit.
