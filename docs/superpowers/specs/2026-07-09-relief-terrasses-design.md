# Relief en terrasses — tranche 1 : « je vois le dénivelé »

**Date** : 2026-07-09
**Statut** : validé par Alexis, prêt pour le plan d'implémentation
**Portée** : première des quatre tranches du programme *relief*. Purement visuelle.

---

## 1. Le problème

Le jeu ne dessine **jamais** l'élévation. `bakeMapTexture`
(`packages/client/src/scenes/WorldScene.ts:487`) peint chaque tuile avec
`shade(base, 0.92 + 0.16 * hash2(tx, ty))` : la couleur du biome modulée par un
bruit *par tuile*. Pas de gradient, pas de pente, pas de soleil.

Le hillshade validé en SP1a vit uniquement dans `packages/sim/src/vignette.ts`,
outil de revue headless qui crache un PNG. Il n'a jamais été porté dans le rendu
jeu. L'information est dans `map.elevation`, à 1200×1800 tuiles, et aucun photon
ne la transporte jusqu'à l'œil du joueur.

Symptôme rapporté par Alexis : « je n'ai aucune sensation de dénivelé ».

## 2. Le programme, et la place de cette tranche

Alexis veut les quatre : **je vois** le relief, je **sens** la pente, le relief
**structure** la carte, et je passe **dessus-dessous**. C'est un programme, pas
une tâche.

La colonne vertébrale : un champ d'altitude *continu* ne peut produire qu'un
ombrage — une jolie carte. Quantifié en **paliers** (`level`, un entier par
tuile), il produit d'un coup des faces de falaise à dessiner (*je vois*), des
bords infranchissables et des plateaux à rampe (*ça structure*), et l'entier
discret qui est le vocabulaire de la note 2.5D.

- `elevation` (continu) → grain, ombrage, coût de pente.
- `level` (entier, **dérivé** de `elevation`) → murs, plateaux, tactique.
- `layer` (entier, **indépendant**) → ce qui se superpose : ponts, mines, étages.

Ne reste vraiment neuf que `layer`, et seulement pour ce qui a un *dessous*.
Un plateau n'en a pas.

**Les quatre tranches, dans l'ordre :**

| # | Nom | Contenu | Touche |
|---|-----|---------|--------|
| 1 | **Je vois** | `level` dérivé, hillshade, parois dessinées. Rien ne bloque. | `/sim` (donnée) + client |
| 2 | **Ça structure** | Collision orientée, rampes, pathfinding dirigé | `/sim` |
| 3 | **Je sens** | La pente coûte (vitesse, endurance), sur `elevation` continu | `/sim` |
| 4 | **Dessus-dessous** | `layer`, ponts, mines | tout |

Cette spec ne couvre que la **tranche 1**.

## 3. Décisions de design actées

### 3.1 Langage visuel : face verticale dessinée (Zelda ALTTP)

La falaise a une hauteur à l'écran : on voit sa paroi. Choix d'Alexis contre
« arête + ombre portée » (Factorio, plus plat) et « relief doux » (la vignette
portée en jeu, insuffisant).

### 3.2 La paroi occupe des tuiles — rien n'est décalé

Convention rejetée : décaler les sprites à l'écran de `level × pas`. Elle
désynchronise le monde logique du monde écran (clic-vers-monde, bornes de
caméra, Y-sort, débogage de collision) pour un gain que la convention ALTTP
obtient sans rien casser.

Convention retenue : la **bande de tuiles au sud d'un plateau *est* la falaise**.
Le sol reste peint à sa place logique, la collision reste plate sur la grille,
le volume naît de la paroi.

Conséquence heureuse : **une paroi, c'est exactement un arbre.** Un sprite plus
haut qu'une tuile, ancré par les pieds (`tileFeetAnchor`), trié par
`ySortDepth` dans la bande unique. Le joueur sur le plateau a un `feetY` plus
petit → il se dessine *derrière* la paroi ; au pied, `feetY` plus grand →
*devant*. L'occlusion sort gratuitement du fix Y-sort du 2026-07-09, sans
machinerie nouvelle.

### 3.3 Franchissement (acté, implémenté en tranche 2)

**Descente libre, montée aux rampes.** On saute en bas de n'importe quelle
marche (petit hop, léger coût d'endurance) ; on ne remonte que par une rampe,
un éboulis ou un col.

Deux conséquences à porter dès maintenant dans les têtes, pas dans le code de
cette tranche :

1. **Le graphe de traversée devient orienté.** L'arête « plateau → sol bas »
   existe, l'inverse non. Les flow fields des hordes se construisent déjà en
   remontant depuis la cible : il faudra parcourir les arêtes à l'envers. Ça ne
   se rajoute pas après coup.
2. **Le saut vers le bas est une règle de déplacement**, donc elle vivra dans
   `collision.ts`, partagée entre la sim et la prédiction locale du client. Si
   elle ne l'est pas, l'avatar prédit une chute que le serveur refuse — voir la
   saga de prédiction (`docs/decisions.md`).

## 4. La donnée

Un seul champ nouveau sur `WorldMap` :

```ts
/** Palier de terrasse par tuile, row-major. Dérivé de `elevation`.
 *  Optionnel — absent des cartes sans élévation (generateValley). */
level?: number[]
```

Row-major comme `terrain` et `elevation`. Optionnel comme `elevation`. Entier.
Accesseur `levelAt(map, tx, ty)` jumeau de `elevationAt` : hors carte ou absent
→ `0`.

**Dérivation** (passe pure dans `/sim`, nouveau module `terrace.ts`) :

1. **Lissage** de `elevation` — une moyenne locale sur un rayon réglable.
2. **Quantification** du champ lissé en N paliers.

Le lissage n'est pas cosmétique, il décide de tout : quantifier directement le
champ actuel — qui porte du bruit de détail et des crêtes — donnerait des
micro-terrasses déchiquetées sur chaque bosse.

Moyenne = additions + une division ; quantification = une multiplication + un
`floor`. **Aucune transcendante** : conforme à l'invariant de déterminisme, et
le lint de pureté de `/sim` le garde.

### 4.1 Ordre de génération — impératif

```
computeElevation  (continu)
      ↓
alpine-hydro      (rivières et lacs creusés sur le continu)
      ↓
terrace           (lissage + quantification → level)
```

Dans cet ordre, une rivière qui franchit une frontière de palier devient une
**cascade** — un cadeau, pas un bug. Dans l'autre, l'eau coulerait sur des
marches et l'hydrologie perdrait la tête.

### 4.2 Ce que la passe ne casse pas (vérifié, pas supposé)

- **Les nœuds ne bougent pas.** `generateNodes` est devenu *positionnel* au fix
  du 2026-07-07 (`hash2(tx, ty, seed)` par tuile) : il ne se redistribue plus
  quand le terrain change. Terrasser ne déplace ni arbres ni filons.
- **Le banc de scénario reste vert par construction.** `pnpm scenario` passe par
  `generateValley`, qui ne produit pas d'élévation. `level` y est absent,
  `levelAt` y renvoie `0` partout.

### 4.3 Dette assumée

`level` ajoute 2,16 M d'entiers au message de join. En Veillée, c'est un
`postMessage` de Worker : indolore. En LAN, ce sera à sérialiser — au même ordre
de grandeur que `terrain` et `elevation`, déjà présents. C'est le **rendu chunké
(SP2)** qui règle la famille entière, pas cette tranche.

## 5. Le rendu

Trois objets, aucune machinerie nouvelle.

### 5.1 L'ombrage du sol

`bakeMapTexture` gagne un second facteur : la **pente**, lue sur le champ lissé,
éclairée depuis le nord-ouest. C'est le hillshade de `renderVignette`, porté.

Contrainte dure : il reste **une valeur constante par tuile**. C'est ce qui
autorise le bake à 1 px/tuile étiré ×16 en NEAREST (`WorldScene.ts:263-267`).

Le versant au soleil s'éclaircit, celui à l'ombre s'assombrit. À elle seule
cette modification change tout — et c'est la plus facile à trop pousser, d'où
un réglage d'intensité calibré à la capture.

### 5.2 Les parois

On ne dessine que les décrochements **vers le sud** : une tuile dont le voisin
sud est d'un palier plus bas. Seule orientation dont la face regarde la caméra
(convention ALTTP).

- Sprite d'**une tuile de large**, de `Δpalier × hauteur_de_marche` de haut.
- Ancré par les pieds sur sa rangée du bas via `tileFeetAnchor`.
- Trié par `ySortDepth`, **tout en bas du départage d'égalité** — sous les
  cadavres. À `feetY` égal, l'acteur passe devant la falaise.
- Texture procédurale au départ (roche, arête claire en haut, base assombrie),
  une variante par `Δpalier`, cuite au boot.

Les décrochements **est, ouest et nord** ne montrent aucune face : ils reçoivent
une arête sombre et une ombre portée courte, **cuites dans la texture du sol**,
donc plates par tuile, donc compatibles avec l'étirement.

Rendu comme le décor : un `CliffLayer` calqué sur `ClutterLayer`
(`packages/client/src/scenes/world/clutter-layer.ts`, 87 lignes) — pool de
sprites reconstruit depuis la vue caméra à chaque frame, jamais la carte entière.

Le voile de nuit et la canopée les couvrent, puisqu'ils sont remontés à 10⁶
depuis le fix Y-sort.

### 5.3 Ce qui est laid, et assumé

**Rien ne bloque dans cette tranche.** La bande de tuiles qu'occupe visuellement
une paroi reste marchable : on peut entrer dans la falaise, et y être *caché*
par elle. C'est exactement cette bande qui devient solide en tranche 2, où le
problème s'évapore. C'est le prix de savoir vite si les terrasses lisent comme
les Alpes.

## 6. Les quatre boutons

Tous calibrés à l'œil sur des captures, jamais sur une théorie. **Deux vivent
dans `/sim`, deux dans le client** — un pixel n'a rien à faire dans
`balance.ts`, qui ne connaît que la tuile :

| Bouton | Où | Effet |
|--------|-----|-------|
| Nombre de paliers | `sim/balance.ts` | Combien de marches sur l'amplitude d'altitude |
| Rayon de lissage | `sim/balance.ts` | Terrasses franches et larges ↔ déchiquetées |
| Hauteur de marche (px) | `client/render/cliffs.ts` | Hauteur à l'écran d'une paroi d'un palier |
| Intensité du hillshade | `client/render/` | Modelé du versant ↔ aplat |

## 7. Vérification

L'effort de test va sur ce qui le mérite — déterminisme et pureté — pas sur le
feeling, qui se regarde.

**`/sim`, testé :**
- même seed → même `level`, au bit près (déterminisme) ;
- le nombre de paliers produit est celui demandé ;
- le lissage ne crée aucun palier hors bornes ;
- **monotonie** : une tuile d'élévation lissée supérieure n'a jamais un palier
  inférieur ;
- le lint de pureté garde la passe (aucune transcendante).

**Client, testé** (fonctions pures seulement) :
- *cette* tuile porte-t-elle une face ? (voisin sud d'un palier plus bas)
- quelle hauteur ? (`Δpalier × hauteur_de_marche`)

On ne teste pas si c'est beau. On le regarde.

**Regard :** `pnpm build` puis preview, Chromium piloté par le `playwright-core`
de Manif, avatar mené par `window.__BRAISES__` (voir mémoire
`browser-smoke-test`). **Quatre captures, grille 2×2** : un versant au soleil ;
un plateau vu de son pied ; une cascade sur une frontière de palier ; un plan
large de la vallée.

## 8. Hors périmètre

Aucun blocage, aucune rampe, aucun pathfinding, aucun coût de pente, aucun
`layer`, aucun pont, aucune mine, aucune brume d'éloignement, aucun art
définitif de falaise, aucun rendu chunké.

## 9. Risques et porte de sortie

**Cette tranche est un instrument de mesure autant qu'une livraison.**

- Si les terrasses lisent comme les Alpes → on câble la collision (tranche 2),
  le design tient.
- Si elles lisent comme de la **soupe d'escalier** — le vrai risque de
  quantifier un champ qui n'a jamais été pensé pour ça → verdict : refaire
  `computeElevation` pour qu'il émette plateaux et cols *par construction*
  (approche B). On l'aura appris pour quelques jours de travail au lieu de
  quelques semaines.

**Risque sans parade toute prête :** le hillshade continu à l'intérieur d'un
palier peut brouiller la lecture des marches — deux signaux de relief qui se
contredisent. Parade si ça arrive : baisser l'intensité, ou ombrer le *résidu*
à l'intérieur du palier plutôt que l'altitude absolue. Se tranche à l'œil.

## 10. Fichiers touchés

**`/sim`**
- `terrace.ts` *(nouveau)* — lissage, quantification, `computeLevel`
- `terrace.test.ts` *(nouveau)*
- `map.ts` — champ `level`, accesseur `levelAt`
- `alpinegen.ts` — câblage après l'hydro
- `balance.ts` — nombre de paliers, rayon de lissage
- `index.ts` — exports

**`/client`**
- `render/cliffs.ts` *(nouveau)* — fonctions pures : où va une face, quelle hauteur
- `render/cliffs.test.ts` *(nouveau)*
- `scenes/world/cliff-layer.ts` *(nouveau)* — pool + culling, calqué sur `clutter-layer.ts`
- `scenes/WorldScene.ts` — hillshade dans `bakeMapTexture`, instanciation du `CliffLayer`
- `render/framing.ts` — constante de départage pour les falaises (sous les cadavres)
