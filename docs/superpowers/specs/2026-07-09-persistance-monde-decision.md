# Persistance du monde & streaming — doc de décision

**Date** : 2026-07-09 · **Statut** : DÉCIDÉ (NO-GO streaming) · **Type** : décision d'architecture, pas un design prêt à coder.
**Antécédent** : `docs/superpowers/notes/streaming-world-generation.md` (note d'exploration — ce doc la **corrige** sur deux points).

## La question

Pour atteindre la Vallée alpine cible (**2400×3600**, ~8,6 M tuiles) avec une **persistance complète**
(terrain, nœuds de récolte, loot, mobs, POIs, structures) sur une saison de 60 jours :
faut-il **streamer** le monde (chunks générés/simulés/persistés à la demande), ou le garder **résident** ?

La note d'exploration penchait vers « le streaming est le vrai endgame, son coût est la ré-architecture
de la sim ». **Ce doc conclut l'inverse**, chiffres en main.

## Le crux

Le streaming ne se justifie que si le monde résident **ne tient pas**. Deux affirmations de la note
fondaient cette crainte — les deux sont fausses :

1. « On ne peut pas *tenir* 8,6 M tuiles. » → Faux : ça pèse des **dizaines de Mo** (voir chiffres).
2. « On ne peut pas *snapshoter* 8,6 M tuiles chaque tick. » → Faux : le terrain ne change pas chaque
   tick. On l'envoie **une fois**, puis seulement les **deltas**. C'est un problème de **protocole**,
   séparable du stockage.

Retiré ces deux-là, il ne reste qu'un forceur réel du stockage chunké : **un monde non borné (infini),
ou dont l'état dépasse la RAM d'un VPS**. La Vallée de Braises est une vallée **scellée**, bornée par
construction. Elle n'est ni l'un ni l'autre.

## Les chiffres

**Mesuré / lu dans le code :**

| Fait | Source |
|---|---|
| `terrain: number[]` (entiers petits → SMI packé, ~4 o/tuile) | `map.ts:25` |
| `elevation?: number[]` (optionnel) | `map.ts:29` |
| `ResourceNode` = 6 champs numériques (`id,type,tx,ty,stock,regrowAt`) | `economy.ts:44-52` |
| Échéances stockées en **tick absolu** : `regrowAt`, `decayAt`, `risesAt` | `economy.ts:147`, `combat.ts:283,381` |
| `advanceEconomy` **balaie tous les nœuds chaque tick** pour tester `regrowAt` | `economy.ts:223` |
| `spawnPoiMonsters` pose **un monstre par POI** | `poi.ts:150-161` |
| Rayon Poisson des POIs = `SPACING_FRAC × min(map.width, map.height)` | `poi.ts:85` |
| Client actuel : `generateAlpineTerrain(1200, 1800, …)` | `client/src/worker/veillee.ts:58` |
| Génération ≈ **27 s** pour 8,6 M tuiles | note streaming (mesuré) |
| Densité 0.70 → ~140k nœuds (≈ 6,5 % des tuiles) | git log (`7efefbe`) |

**Extrapolé à 2400×3600 (ordre de grandeur, à re-mesurer avant tout engagement) :**

| État | Poids | Dérivable de la seed ? |
|---|---|---|
| terrain + élévation | ~68 Mo | oui (généré une fois) |
| nœuds (~560k × ~80 o) | ~45 Mo | **oui** — `generateNodes` est positionnel (`hash2(tx,ty,seed)`) |
| POIs | ~90 (constant, cf. dette #2) | **oui** — `placePois(map, seed)` |
| mobs | ~1/POI + hordes | oui (spawn runtime) |
| structures / villages | activité joueur | non |
| **loot / cadavres** | **croissance monotone** | **non** |

**Total résident ≈ 130-150 Mo**, croissant avec l'activité de saison. Un VPS unique (invariant #6)
l'avale avec ~10× de marge. **La mémoire n'est pas le mur.**

## Ce que la « persistance complète » change réellement

Elle ne change pas le verdict. Elle change la **nature du travail**, et convertit trois « problèmes du
streaming » en « choses à faire de toute façon » :

1. **Persistance = seed + diff, jamais un dump du monde.** On ne sauve pas 560k nœuds : on sauve la
   **seed** et les quelques milliers de nœuds *touchés*. Ce qui rend ça possible, c'est que
   `generateNodes` est devenu **positionnel** (décision 2026-07-07, prise pour la robustesse de la
   carte). Elle débloque le diff-vs-regen — en résident **comme** en streamé. Le volume en base est
   proportionnel à l'**activité des joueurs**, pas à l'aire.

2. **Résolution paresseuse des échéances — obligatoire *sans* streaming.** Balayer 560k nœuds à 20 Hz
   (`economy.ts:223`) = 11 M comparaisons/s, hors budget d'un tick de 50 ms. Il faut résoudre les
   échéances **à la lecture** (ou n'indexer que les nœuds épuisés). C'est *exactement* la machinerie
   que la note attribuait au streaming : **c'est le noyau commun**, pas un coût du streaming.

3. **Loot et cadavres sont le seul état qui croît vraiment.** Non dérivables, ils s'accumulent sur
   60 jours. Le streaming **ne règle pas ça** (un monde chunké stocke les mêmes tas sur disque). La
   réponse est un **levier de gameplay : la décantation** — déjà dans le codebase (`decayAt`, et le
   cadavre de Cendreux explicitement « non-décantable »).

## Les trois catégories d'état — et pourquoi le monde peut vivre

Le point décisif. On classe l'état sur deux axes (*combien ça scale* × *comment ça évolue*) — et les
deux axes se superposent exactement :

| Catégorie | Combien | Comment ça évolue | Gel |
|---|---|---|---|
| terrain, **nœuds** | **scale avec l'aire** (~560k) | échéance absolue, **forme fermée du temps** | **sans perte** — rattrapage O(1) |
| PNJ, villages, **hordes** | **borné** (dizaines) | par **interaction** | **on ne gèle pas** — les ticker toujours coûte ~rien |
| mobs de repaire | ~1 par POI | **dormants par design** | **sans perte** — un mob endormi ne fait rien |

> **Ce qui est nombreux ne vit pas : ça attend. Ce qui vit n'est pas nombreux.**

Conséquence : **le monde vit intégralement, partout, tout le temps** — sans LOD, sans simulation à
distance grossière, sans dépendance à l'observateur, sans perte de déterminisme. La horde traverse
vraiment ses 400 tuiles la nuit ; le village PNJ bâtit vraiment sa grange. Aucune approximation.

### L'unité de gel n'est pas la région — c'est la catégorie d'état

Précision qui découle du tableau, et qui simplifie beaucoup : **il n'y a pas de « région gelée »**.
- Les **échéances** ne sont jamais tickées, nulle part, même sous le nez du joueur — elles sont
  résolues à la lecture. Le gel est *total et permanent*, pas spatial.
- Les **dormants** sont réveillés par proximité (index spatial) — seule notion spatiale du système.
- Le **vivant** est tické partout, toujours.

Donc pas de cycle de vie de chunk, pas d'activation atomique, pas de couture. Ces trois problèmes
étaient des artefacts du streaming.

### Le rattrapage, par l'exemple

Buisson récolté au tick 1 000 → `regrowAt = 7 000`. Personne ne le tick — **jamais**. Le joueur revient
au tick 27 000 ; à la **lecture** du nœud :
`stock = (regrowAt ≠ 0 && tick ≥ regrowAt) ? plein : stock` → il est plein.
Exactement comme s'il avait été tické 20 000 fois. **L'échéance contenait déjà la réponse** ; le nœud
n'avait pas besoin d'être observé.

### Le critère qui dit ce qu'on a le droit de geler

> **Geler puis dégeler doit produire exactement l'état qu'une simulation continue aurait produit.**

Testable au bit près (« gelé 20 000 ticks == tické 20 000 fois »). Il trie tout seul : repousse,
décantation, croissance de culture, consommation de bois **passent** ; position d'un monstre qui erre,
PNJ qui a faim et cherche à manger, horde qui assiège, combat **ne passent pas** — donc on ne les gèle
pas (et on n'en a pas besoin : ils sont peu nombreux).

Cas limite instructif : `risesAt`. Le **spawn** du Cendreux est une forme fermée (exact au dégel), mais
ses 15 000 ticks d'errance vers la chaleur ne le sont pas. Il apparaîtrait **sur le cadavre**, pas où il
aurait dérivé. Puisqu'on ne gèle pas le vivant, le cas ne se pose pas — mais il marque la frontière.

Deux garde-fous issus de l'invariant #2 :
- la **décision de réveiller un dormant** dérive de l'état de sim (positions des joueurs), **jamais**
  d'une horloge murale — sinon un replay diverge ;
- geler quelque chose sans forme fermée est un **choix de design assumé**, jamais une optimisation
  présentée comme transparente.

## Les options

- **A — Résident + activation paresseuse *(RETENUE)*.** Monde entier en RAM ; persistance = seed +
  deltas ; échéances résolues à la lecture ; tout le vivant tické en permanence. Zéro ré-architecture
  de la persistance. Débloque la Saison 0 pleine.
- **B — Streaming complet** (gen + sim + persistance chunkés). Justifié seulement au-delà du monde
  borné → **hors périmètre Braises tel que conçu**. Coût : ré-architecture de `SimState`, snapshot
  partiel, pathfinding partiel, ownership aux coutures, deltas par chunk.
- **C — Hybride** : stockage/sim résidents, diffusion client restreinte au proche. En pratique **c'est
  le volet réseau de A** (interest management sur le fil), pas une troisième architecture.

**Verdict : A. NO-GO sur le streaming pour la Saison 0.**

Corollaire important : le morceau le plus effrayant du streaming — l'**hydrologie globale non
chunkable** (`computeFlowField` suit le gradient des crêtes au lac) — **ne se pose jamais**. Dans un
monde persistant, le terrain est généré **une seule fois** à la création de la saison, puis stocké.
On n'a donc **jamais besoin de générer le terrain par chunks**, et l'astuce « macro grossière → détail
par chunk » devient inutile. Seules les **entités** se matérialisent paresseusement — et elles sont
déjà positionnelles.

## Le point de bascule (la courbe, pas le binaire)

> Le monde **résident tient** tant que : `état_monde_en_RAM < ~1-2 Go` **ET** le monde reste **borné**.
> Braises (~150 Mo, vallée scellée) est dans le vert avec ~10× de marge.
>
> Le **streaming devient GO** seulement si le design bascule vers un monde **non borné / infini** —
> ce que le GDD ne demande pas.

Noter ce que la formule **ne** contient **pas** : le **nombre de joueurs**. C'est délibéré — en résident,
N joueurs partagent **un seul** monde en RAM. Le coût par joueur ne vit pas dans le stockage mais sur le
**fil** (snapshot) et au **join** : voir la section suivante.

Ce qui casserait en premier si l'on poussait quand même, **dans l'ordre** :
1. **CPU par tick** (balayages O(entités) : `economy.ts:223`, filtres de cadavres) — réglé par la
   résolution paresseuse + index spatial. **Pas** par le streaming.
2. **Pathfinding à l'échelle de la carte** (flow fields de horde en O(aire)) — voir dette #1.
3. **Volume de loot/cadavres** — réglé par la décantation (gameplay).
4. **RAM** — très loin derrière, jamais atteint pour une vallée bornée.

Aucun de ces quatre n'est résolu par le stockage chunké. Trois sur quatre sont aggravés par lui
(complexité).

## Multijoueur & taille de carte — ni l'un ni l'autre ne flippe le verdict

*(Section ajoutée après coup : la première version du doc raisonnait sur l'état du monde, pas sur le
coût par joueur. C'était un angle mort.)*

### Le multijoueur **renforce** le NO-GO

Contre-intuitif mais mécanique : en résident, **N joueurs partagent UN monde** de ~150 Mo. En streamé,
chacun traîne son anneau de chunks. Dix joueurs dispersés, anneau de 3 chunks de 64 tuiles ≈ 147k tuiles
chacun → ~1,5 M tuiles chargées sur 8,6 M. On économiserait **~120 Mo** au prix de ré-architecturer
`SimState`, le snapshot, le pathfinding et la persistance. Et **plus les joueurs se dispersent, plus
l'union des anneaux tend vers la carte entière** : le streaming est à son pire précisément dans le cas
d'usage qui le motivait.

### Ce que le multi coûte vraiment : le fil, pas le stockage

Le coût par joueur est **réseau**, et le code actuel ne le porte pas :

```
SnapshotMessage { entities: Entity[]; monsters: Monster[]; corpses: Corpse[] }   // protocol.ts:87-99
sim-worker.ts:62 → entities: sim.entities        // la liste ENTIÈRE, chaque tick
```

Le snapshot envoie **tout le monde à tout le monde, 20 fois par seconde**. Parfait à 12 entités (la
Veillée). À ~20k mobs de repaire (une fois la dette #2 corrigée) × 10 joueurs × 20 Hz : des centaines de
Mo/s. **L'interest management sur le fil devient donc obligatoire en multi** — c'est l'option C, du
**protocole**, pas du stockage. Le streaming ne l'offrirait pas gratuitement : il faudrait le faire pareil.

L'idiome existe déjà : `ReadyMessage` possède un `NodeDelta` (`protocol.ts:82`) — les nœuds sont déjà
diffusés en deltas après le join. Il reste à l'étendre aux entités, filtré par voisinage du joueur.

### Le join : par la seed, jamais par transfert

`ReadyMessage` porte aujourd'hui `nodes: ResourceNode[]` (`protocol.ts:76`) — la liste complète. À 560k
nœuds plus le terrain, cela ferait **~100 Mo par joueur** qui se connecte. Absurde… et inutile : terrain
et nœuds sont **dérivables de la seed** (`generateAlpineTerrain(w,h,seed)`, `generateNodes` positionnel),
et l'**invariant #2** garantit un résultat **bit-identique entre navigateur et Node** — c'est sa raison
d'être explicite (« un replay enregistré dans un navigateur doit rejouer exactement sur Node »).

> **payload de join = seed + dimensions + deltas.** Le client régénère le reste lui-même.

Cela ne viole pas « client bête » (invariant #3) : le client ne simule rien, il **dérive de la donnée
statique** — exactement ce que fait déjà le worker solo. Conséquence : la **Voie 1** (gen 27 s → 10-15 s)
change de statut — ces secondes deviennent le **temps de connexion de chaque joueur**.

### La taille de carte : elle ne flippe rien, elle **promeut**

| Axe | Effet à 8,6 M tuiles | Flippe le verdict ? |
|---|---|---|
| RAM | ~150 Mo (bascule à ~1-2 Go) | Non — 10× de marge |
| balayage des nœuds | 560k × 20 Hz, hors budget de tick | Non → rend la **résolution paresseuse obligatoire** |
| pathfinding | `findPath` / flow fields en **O(aire)** | Non → rend le **hiérarchique obligatoire** |
| mobs dormants | ~20k (dette #2 corrigée) | Non → rend l'**index spatial obligatoire** |
| payload de join | ~100 Mo si transmis | Non → **seed + deltas** |

Le rôle de la taille est de transformer trois **optimisations** en trois **exigences**. Elle ne déplace
pas la frontière résident/streamé : elle est **déjà la variable** de la formule de bascule. Il faudrait
une carte **~10× plus grande** pour rouvrir la décision.

## Le vrai chantier (ce qu'on paie de toute façon)

1. **Persistance seed + diff.** Stocker la seed et les deltas (tuiles éditées, nœuds touchés,
   structures bâties, POIs pillés). PostgreSQL write-behind, invariant #6. *Déjà débloqué par le
   `generateNodes` positionnel.*
2. **Résolution paresseuse des échéances.** Ne plus balayer ; résoudre `regrowAt`/`decayAt` à la
   lecture, ou n'indexer que les entités en attente. *Le modèle de données est déjà prêt* : les trois
   échéances sont des ticks absolus.
3. **Index spatial d'activation.** Réveiller les dormants par index joueurs→région, pas par balayage.
   L'idiome existe déjà (index tuile→{structure,nœud} bâti dans `findPath`).
4. **Décantation** du loot et des cadavres — levier de gameplay, à calibrer.
5. **Interest management sur le fil** *(multi uniquement, obligatoire)*. Le `SnapshotMessage` diffuse
   aujourd'hui `entities`/`monsters`/`corpses` **en entier, chaque tick** (`sim-worker.ts:62`). Filtrer
   par voisinage du joueur, et passer les entités en deltas — l'idiome `NodeDelta` (`protocol.ts:82`)
   existe déjà pour les nœuds.
6. **Join par la seed.** `ReadyMessage` cesse de porter `nodes: ResourceNode[]` (`protocol.ts:76`) et le
   terrain ; il porte `seed + dimensions + deltas`, le client régénère. Autorisé par l'invariant #2
   (déterminisme bit-identique navigateur↔Node).

## Critères d'acceptation (pour l'implémentation à venir)

- **Équivalence de gel** : pour toute entité à forme fermée, `geler(N ticks) puis dégeler` produit un
  état **bit-identique** à `ticker N fois`. Test `seed + inputs → état attendu`.
- **Déterminisme préservé** : `replay.test.ts` et `events.test.ts` restent verts — même seed + mêmes
  inputs ⇒ même état **et** même flux d'événements, quel que soit le trajet des joueurs (donc quelles
  que soient les régions gelées).
- **Coût par tick** indépendant du nombre de nœuds : un banc à 560k nœuds tient le budget de tick.
- **Persistance** : recharger `seed + deltas` reproduit l'état sauvé, bit pour bit.
- **Coût de snapshot par joueur** borné par son voisinage, **indépendant** du nombre total d'entités :
  un banc à 20k mobs × 10 joueurs tient la bande passante.
- **Join** : un client qui reçoit `seed + dimensions + deltas` régénère un monde **bit-identique** à
  celui de l'hôte (contrat déjà couvert par `replay.test.ts` — même seed ⇒ même état sur les deux moteurs).

## Réversibilité (« design-for-later »)

Si un jour le design bascule vers un monde non borné, ce qu'il faut n'avoir **pas** cassé :

- garder l'accès terrain/nœuds **indexable par région** (ne jamais supposer « toute la carte est
  simulée chaque tick ») ;
- garder la génération d'entités **positionnelle** (`hash2(tx,ty,seed)`) — ne jamais réintroduire de
  RNG séquentiel par tuile (régression de la décision 2026-07-07) ;
- garder les processus lents exprimés en **échéances absolues**, jamais en compteurs décrémentés.

Ces trois contraintes sont **exactement** celles que l'option A impose déjà. Adopter A ne coince donc
en rien un éventuel streaming ultérieur : A **est** le chemin vers B.

## Dettes ouvertes (révélées par ce cadrage, indépendantes de la décision)

1. **Pathfinding hiérarchique.** `findPath` (A\*) et les flow fields de horde sont O(aire) : hors budget
   sur 8,6 M tuiles. C'est le vrai coût de « le monde vit ». Rejoint la dette connue du ciblage
   `nearestOtherVillage` (distance euclidienne pure) et la mémoire `milice-livelock`. Piste : graphe de
   régions + A\* local.
2. **Rayon Poisson des POIs.** `placePois` calcule `radius = SPACING_FRAC × min(w,h)` — proportionnel à
   la dimension. Le nombre de POIs est donc **constant (~90) quelle que soit la taille de carte** : sur
   2400×3600 la vallée serait quasi vide (un POI tous les ~500 tuiles). Il faudra un **rayon fixé en
   tuiles**. Indépendant de la persistance, mais bloquant pour la grande carte.

## Ce que ce doc ne tranche pas

- Le **schéma SQL** et l'API de persistance (design prêt-à-coder, à faire quand `packages/server` existe).
- La **calibration** de la décantation (durées de vie du loot/cadavres).
- Le **pathfinding hiérarchique** (dette #1) — chantier propre.
- La **Voie 1** (optimiser `generateAlpineTerrain` : 27 s → 10-15 s). Reste pertinente : la génération
  reste un coût **unique** à la création de saison, mais elle plafonne encore le boot du solo (Veillée),
  qui régénère à chaque lancement faute de persistance.
