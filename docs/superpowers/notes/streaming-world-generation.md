# Note de conception — Génération de monde en streaming (différé)

**Date** : 2026-07-09 · **Statut** : exploration, DIFFÉRÉ (chantier de fond, à cadrer brainstorm→spec→plan).
Contexte : après avoir posé la carte alpine par défaut et débloqué le rendu grande carte
(bake 1px/tuile étiré, commit `2583061`), la question « comment atteindre la taille prévue
2400×3600 ? » a mené à cette réflexion sur le streaming. À reprendre quand on voudra le grand large.

## État actuel (rappel)

- **Rendu : résolu pour toute taille.** Le terrain est fait d'aplats → on bake `map-demo`/`canopy`
  à **1 px/tuile** (texture = `map.width × map.height` px, sous la limite WebGL) puis on l'**étire**
  à la taille monde (`setDisplaySize`, NEAREST). Pixel-identique au 16 px/tuile, une petite texture
  couvre n'importe quelle carte. Idem overlay carte M. Plus de limite de rendu, **sans chunking**.
- **Ce qui reste plafonne la taille** (mesuré) : la **génération** (`generateAlpineTerrain` = **27 s**
  pour 8,6 M tuiles), le **transfert** du tableau terrain (number[] non typé), le **bake** client
  (N `fillRect`), et les **nœuds** (bornés via le nouveau param `density` de `generateNodes`).
- **Défaut client actuel** : 1200×1800 (boot ~27 s, écran de chargement). `veillee.ts`.

## Deux voies

- **Voie 1 — optimiser la gen actuelle (rapport effort/résultat le meilleur).** Profiler + optimiser
  le générateur (le **flow-field d'hydrologie** et le **domain-warping** dominent les 3,2 µs/tuile) ;
  transférer le terrain en **typed-array** (Int8Array, transferable) ; baker via **`putImageData`**
  (bien plus rapide que des millions de `fillRect`). Objectif réaliste : **le vrai 2400×3600 avec un
  boot ~10-15 s** (écran de chargement), **sans réarchitecture**.
- **Voie 2 — le streaming (le vrai endgame, ci-dessous).** Débloque n'importe quelle taille et un boot
  instantané, mais c'est une ré-architecture qui touche la sim, pas juste le rendu.

---

## Le streaming — l'idée

Le monde n'est pas une **donnée** qu'on stocke/transporte, mais une **fonction pure** évaluée à la
demande : `terrain(x, y) = f(seed, x, y)`. On ne génère/garde en mémoire qu'un **anneau de chunks
autour du joueur** ; le reste n'existe pas encore (ou plus) et est **re-générable à l'identique**.
→ monde immense/infini, **boot instantané**, **mémoire bornée**.

## Le mécanisme (lifecycle d'un chunk)

Monde découpé en **chunks** (p.ex. 64×64 tuiles), coordonnées `(cx, cy)`. Chaque frame :
```
rayon de chargement = ~3 chunks autour du joueur
pour chaque chunk dans le rayon absent → GÉNÉRER (terrain(cx,cy,seed)) + baker + activer
pour chaque chunk chargé hors du rayon → DÉCHARGER (jeter texture/données/entités)
```
États : **généré** / **actif** (rendu+simulé) / **déchargé** (n'existe plus, re-générable).

## La condition qui fait tout marcher : **déterminisme local**

La génération d'un chunk doit être une **fonction pure de `(cx, cy, seed)`** — **zéro état partagé,
zéro dépendance à l'ordre de visite**. Sinon, revenir sur ses pas déplace la forêt.
- Notre `hash2(x, y, seed)` (tirage positionnel) et le bruit gradient/fbm le remplissent **pour le
  détail**. C'est pourquoi les mondes à base de bruit (Minecraft…) streament trivialement.

## Le mur de Braises : notre structure est **globale**

Notre vallée n'est pas du bruit uniforme — elle a une **macro-structure** :
- `computeElevation` = **forme de vallée** (distance au bord → fond bas/murs hauts) : suppose de
  connaître les bords → global.
- **Hydrologie** (`computeFlowField`) = pire cas : la rivière **suit le gradient sur toute la carte**
  (des sommets au lac). Savoir si de l'eau passe en (1000,1500) exige d'avoir suivi l'écoulement
  **depuis les crêtes** — impossible en regardant un chunk isolé.
→ Un streaming **naïf** (chunks indépendants) donne des **rivières qui ne se raccordent pas** aux
coutures. C'est exactement ce qui rend la carte belle qui résiste au chunking.

## La solution : **génération en deux étages**

1. **Macro — global mais grossier & bon marché.** Calculé une fois, basse résolution : élévation en
   ~150×225, **squelette hydrographique** (grandes rivières = polylignes), lacs, cols. Petit → rapide,
   tient en mémoire, se transporte. Déterministe.
2. **Détail — local & à la demande, par chunk.** Le chunk `(cx,cy)` **lit** la macro (interpolée)
   pour son élévation de base + proximité rivière, puis ajoute le **détail fin** (bruit local, biomes,
   nœuds, POIs) par-dessus. Détail purement local (`hash2`) → streamable ; **cohérence globale** via
   la macro partagée par tous les chunks. La rivière traverse proprement 40 chunks car chacun lit la
   *même* polyligne.

## Le vrai coût : ça déborde hors du rendu, jusque dans la **sim**

Le rendu chunké est le quart facile. Le streaming impose de repenser la **simulation autoritative** :
- **`SimState` n'a plus la carte entière** ni tous les nœuds → devient **chunk-aware** (dict de chunks chargés).
- **Le snapshot** ne sérialise plus tout le terrain à chaque tick → n'envoie au client que **les chunks
  autour de son avatar** + gère l'entrée/sortie de chunks dans le protocole.
- **Pathfinding** (A\*, flow fields de horde) sur carte partielle : que faire si le chemin sort du chargé ?
- **Entités dans les chunks déchargés** (une méga-horde à 3000 tuiles) : geler ? simuler grossièrement
  (« simulation à distance ») ? despawner ? — choix de gameplay (le monde vit-il sans le joueur ?).
- **Features à cheval sur les coutures** (POI 4 tuiles, village, rivière) : règle d'**ownership** (le
  chunk contenant l'origine gère la feature) pour ne pas la couper ni la générer deux fois.
- **Persistance** : un chunk **modifié** par le joueur (mur bâti, arbre récolté) n'est plus
  « re-générable à l'identique » → sauvegarder le **delta** du chunk (PostgreSQL write-behind — colle à
  l'invariant #6). Les chunks vierges ne coûtent rien (juste la seed).

## Verdict

- **Streaming = le monde comme fonction lazy de `(coord, seed)`** + fenêtre de chunks vivante.
- Débloque n'importe quelle taille, boot instantané, mémoire bornée — **le vrai endgame** de la grande vallée.
- Condition = déterminisme local (`hash2` ✓ pour le détail) ; notre structure globale exige l'astuce
  **macro grossière → détail par chunk**.
- Coût réel = **ré-architecture de la sim** (état chunké, snapshot partiel, pathfinding partiel,
  entités lointaines, coutures, persistance des deltas), pas le rendu.
- **≠ le « rendu chunké (SP2) » de la roadmap** : SP2 ne parlait que d'afficher une grande carte ; le
  streaming va bien plus loin (générer + simuler à la demande). À traiter comme un chantier de fond,
  son propre cycle brainstorm→spec→plan, quand on voudra dépasser ce que la voie 1 permet.
