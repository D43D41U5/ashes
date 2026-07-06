# Design — La Vallée organique (sous-projet 1)

**Date** : 2026-07-06 · **Statut** : validé en brainstorming, en attente de relecture écrite

## Contexte et objectif

La vallée 192×192 (`valleygen.ts` + `VEILLEE_SKELETON`, mergée le 2026-07-06) est jouable
mais « fait générée » : le Lac est un cercle parfait, les bords sont rectilignes, la roche
mite les régions en confetti, il manque de l'eau vive, et la Mine est un pavé de roche
infranchissable où l'on ne pourra jamais s'installer.

Ce sous-projet est une **passe d'organicité du générateur** : contours bruités, réseau
d'eau, refonte géographique de la Mine. Tout vit dans `/sim` (générateur + squelette),
reste déterministe et testable. Il ne touche ni le rendu client ni la collision.

**Hors périmètre, reporté au sous-projet 2** : le Pont. Passer de son blob rond actuel à
une travée droite en bois *et* pouvoir passer dessous par le bas-fond est une vraie
mécanique (état d'entité `onBridge`, collision par niveau, tri de profondeur au rendu,
flag dans le snapshot). Le pont devient alors une *structure*, pas du terrain — sa propre
spec. En attendant, il reste tel quel.

## Principe transversal — SCALABILITÉ (contrainte utilisateur, non négociable)

Le générateur doit produire une carte cohérente **à n'importe quelle dimension**. Si la
carte grandit, les features se multiplient d'elles-mêmes. Règles :

1. **Aucune quantité en dur.** Tout « combien » (étangs, mines simples, amas de roche,
   éboulis détachés, nœuds) est une **densité** — un nombre par unité de surface
   marchable ou par unité de périmètre de bordure — arrondi via `Math.round(densité ×
   mesure)`. Jamais un entier littéral supposant 192×192.
2. **Le générateur lit toutes ses extents du squelette** (`skeleton.width/height`), jamais
   une constante 192. Ça vaut déjà pour l'existant ; on l'étend aux nouvelles passes.
3. **Amplitudes de bruit relatives à la feature.** Le tremblé d'une berge est une fraction
   de son rayon ; le crénelage de l'enceinte, une fraction de son épaisseur. Grossir la
   carte ne « lisse » ni ne « déchire » les contours.
4. **Deux natures d'éléments, assumées** (GDD §9 « squelette artisanal, chair
   procédurale ») :
   - *Artisanal* (dans le squelette, mis à l'échelle en ré-éditant) : le tracé de la
     rivière, les routes, les 5 régions, les landmarks nommés, **la mine profonde du
     nord-est** (le gisement contesté). Agrandir la carte = enrichir ce squelette à la
     main. C'est voulu — ce sont les *lieux*.
   - *Procédural* (généré par densité, se multiplie tout seul) : amas de roche, éboulis de
     bordure, ruisseaux, étangs, **mines simples**, nœuds de ressources. C'est la *chair*.
5. **Prouvé par test.** Un critère d'acceptation génère la carte à **deux tailles** et
   vérifie que les quantités procédurales suivent la surface/le périmètre (§Critères R6).

Les densités et amplitudes sont du **contenu de carte**, pas de l'équilibrage (convention
déjà posée dans `valley-veillee.ts`) : elles vivent en constantes documentées à côté du
générateur, pas dans `balance.ts`.

## Volet A — La primitive de bord bruité + la roche en amas

Le remède transversal au « ça fait généré ». Deux ajouts au générateur :

**A1. `stampBlob` — un disque à contour perturbé.** Remplace `stampDisk` pour les masses
d'eau et les poches. Une tuile est incluse si
`dx² + dy² ≤ r² + amplitude·r·(fbm2(tx,ty,seed)·2 − 1)`. Que des `+ − × /` et `fbm2` (déjà
déterministe et exact) — pas de trigonométrie. `amplitude` est une fraction de `r`
(règle 3). Réutilisé par le Lac, les étangs, les chambres de mine.

**A2. Roche en amas, pas en confetti.** Le semis actuel `hash2(tx,ty) < rock` par tuile
(indépendant tuile à tuile → confetti) est remplacé par un seuil sur bruit fractal :
`fbm2(tx,ty, échelle, seed) > (1 − rock)` → la roche forme des **blocs** contigus. Même
paramètre `rock` par région (une densité, donc scalable), rendu radicalement plus naturel.

**A3. Enceinte et crête organiques.** La bordure gagne : une **basse fréquence** de forte
amplitude (baies et avancées), une **haute fréquence** de faible amplitude (crénelage), et
de rares **éboulis détachés** vers l'intérieur (roche isolée via un seuil de hash épars,
densité). L'épaisseur reste ancrée sur `borderThickness` (fraction → scalable). La crête
du Col reçoit un `halfWidth` bruité par la même recette.

## Volet B — Le réseau d'eau

Deux ajouts, **entièrement procéduraux et par densité** (scalables).

**B1. Ruisseaux.** Des sources sont échantillonnées dans les régions hautes (roche/collines
et Plateau) — nombre = `Math.round(STREAM_DENSITY × surface_de_ces_régions)`. Chaque source
trace un ruisseau vers **l'eau la plus proche** (rivière ou Lac) par marche gloutonne
déterministe (à chaque pas, avancer vers la tuile d'eau existante la plus proche). Peint en
**eau peu profonde uniquement**, `halfWidth` 0-1, **jamais de cœur en eau profonde** : on
patauge partout, décor et non obstacle — un seul vrai franchissement politique reste (la
rivière). Un ruisseau qui n'atteint aucune eau en `N` pas est abandonné (pas de mare
pendante).

**B2. Étangs (ponds).** Nombre = `Math.round(POND_DENSITY × surface_marchable)`, **densité
délibérément basse** (l'eau stagnante reste rare et précieuse). Positions seedées sur terre
marchable, à l'écart de l'eau et des routes existantes. Berge bruitée via `stampBlob`
(A1) ; les plus grands ont un petit cœur en eau profonde, les petits sont peu profonds.

## Volet C — La refonte de la Mine

**C1. Dégager les Collines du Levant.** La région passe de `rock: 0.2` (semis dense
bloquant) à `rock: ~0.06` **en amas** (A2) : traversable, habitable. On y ajoute une
clairière pour un futur site de village. Le gisement n'y est plus à ciel ouvert — il
déménage dans la bordure (C2).

**C2. Les mines, galeries dans l'enceinte.** Une mine = un **couloir de sol marchable**
qui mord depuis l'intérieur dans la bordure rocheuse, terminé par une **chambre** ; les
filons sont dans la chambre. Chaque chambre est une petite `Zone` nommée avec un `kind`,
que `generateNodes` lit via `zoneAt` (mécanisme existant). Deux catégories :

- **La (les) mine(s) profonde(s) du nord-est** — *artisanale*, dans le squelette, adossée
  à la bordure près des anciennes Collines. Galerie **longue et ramifiée**, chambre riche
  en **fer + charbon** (`kind: 'gisement'`) : le vrai T2 contesté (« la carte est
  l'économie », GDD §8). Cul-de-sac défendable — futur poste de garde. Défaut : **une**.
- **Les mines simples** — *procédurales*, nombre = `Math.round(MINE_DENSITY ×
  périmètre_de_bordure)`. Positions seedées le long de la bordure. Galerie **courte**,
  chambre ne donnant que de la **pierre** (`kind: 'carriere'` → `generateNodes` y pose des
  `rock`). Flavor et ressource mineure, jamais le T2 — la rareté du gisement est préservée.
  Défaut à 192×192 : ~2.

Le creusement réutilise `paintPolyline` (couloir en sol, `Paint` qui écrase la roche) +
`stampBlob` (chambre). La connectivité gueule-de-mine → intérieur marchable est garantie
par construction (la galerie part d'un point intérieur marchable) et vérifiée au test (R4).

## Architecture

- **`packages/sim/src/valleygen.ts`** — reçoit `stampBlob` (A1), le seuil de roche en amas
  (A2), l'enceinte/crête organiques (A3), et les passes `paintStreams`/`paintPonds` (B) et
  `paintMines` (C2). Le fichier grossit : si les passes eau+mines dépassent ~120 lignes, les
  extraire dans `valleygen-water.ts` et `valleygen-mines.ts` (helpers purs consommés par
  `generateValley`), pour garder chaque unité tenable. Décision prise à l'implémentation
  selon la taille réelle.
- **`ValleySkeleton`** (dans `valleygen.ts`) gagne des champs **optionnels** (rétro-compat
  du `TEST_SKELETON` existant) : `mines?: {...}[]` (les mines profondes artisanales) et les
  densités procédurales avec valeurs par défaut si absentes.
- **`packages/sim/src/valley-veillee.ts`** — `VEILLEE_SKELETON` : Collines dégagées (C1) +
  clairière de site, la mine profonde du nord-est déclarée, `river`/`landmarks` inchangés.
- **`generateNodes`** (`economy.ts`) — nouveau `kind: 'carriere'` → pose des nœuds `rock`
  (le `'gisement'` existant reste fer+charbon). Un seul `else if` ajouté.
- **`balance.ts`** — inchangé (les densités de carte ne sont pas de l'équilibrage).

## Critères d'acceptation (`valleygen.test.ts`, `valley-veillee.test.ts`)

1. **R1 — Déterminisme** : même squelette + seed → `terrain` et `zones` identiques bit à
   bit. (Étend le test existant aux nouvelles passes.)
2. **R2 — Contours organiques** : le Lac n'est pas un disque parfait (au moins K tuiles de
   son rayon nominal sont hors-eau OU inversement — variance de contour non nulle) ; la
   bordure a une épaisseur **variable** (écart-type > 0 sur une traversée). Roche en amas :
   la proportion de tuiles de roche isolées (aucun voisin roche) est faible (< seuil) —
   preuve du dé-confettisage.
3. **R3 — L'eau ne bloque jamais à tort** : toute tuile de ruisseau est `shallow_water`
   (marchable) ; chaque ruisseau touche la rivière ou le Lac (pas de mare pendante).
4. **R4 — Mines** : chaque chambre de mine a au moins une tuile atteignable au flood-fill
   depuis le spawn ; la chambre profonde porte `kind: 'gisement'` et `generateNodes` y pose
   fer+charbon ; les mines simples portent `kind: 'carriere'` et n'y posent que de la
   pierre.
5. **R5 — Collines habitables** : la proportion marchable des Collines du Levant dépasse un
   seuil (ex. > 0.8) — plus de pavé bloquant ; la clairière de site est marchable.
6. **R6 — SCALABILITÉ (le critère qui tient la contrainte)** : `generateValley` sur un
   squelette de test à **deux tailles** (ex. 96×96 et 192×192, mêmes densités) produit un
   nombre d'étangs, de mines simples et de nœuds **proportionnel** à la mesure
   correspondante (surface marchable / périmètre), à tolérance près. Un doublement de côté
   (×4 surface) quadruple ~les étangs ; aucune quantité n'est figée. Les fonctions de
   densité sont aussi testées en unité (pures : `count = round(densité × mesure)`).
7. **R7 — Non-régression** : les 5 critères R1-R5bis de `valley-veillee.test.ts` (spec
   précédente — connectivité des landmarks, présence, sanité, atteignabilité du minerai)
   restent verts sur la nouvelle carte seed-2026.

## Séquence et estimation

A (la primitive que B et C réutilisent) → B → C → recalibrage du squelette de la Veillée →
smoke test visuel. Un lot cohérent de générateur. `valleygen.ts` +~200-300 lignes (ou
répartis en modules), squelette ajusté, tests. Pas de toucher au client ni à la collision.

Le sous-projet 2 (le franchissement à deux niveaux) suivra dans son propre cycle
brainstorm → spec → plan.
