# Le sol dessiné — ce qui pousse est mou, ce qui est taillé est droit

*Source : décision d'Alexis (2026-08-22), devant cinq variations rendues au même cadrage : « 2 et 4 c'est le type de DA que je kiffe » — organique (2) + pavés dessinés (4). Consignée dans `docs/decisions.md` ; amende `worldgen.md` R32.*

*Statut (2026-08-22) : **chantier 2 (sim) LIVRÉ** — `humAt` (`racine-relief.ts`) : lecture bilinéaire du champ au motif + grain fin (`CREUX.GRAIN_TUILE_ECHELLE` 9, `GRAIN_TUILE_AMPLITUDE` 0,08), `vegetationAt` la lit ; tests `sol-dessine.test.ts` (A1, A3, R1). MESURÉ sur les trois seeds de garde : bords de végétation sur la grille de 8 **100 % → 12,0-12,6 %** (attendu 12,5), tuiles isolées 0,04 %, composition à ±1 point (A12 inchangé vert), 1 558 tests sim verts. Chantier 4 (client, pavés) : spécifié ici, pas commencé.*

## Objectif de design

Le sol des Prés Bas se lisait comme une **grille** : un motif de 8 tuiles fait 40 % de la hauteur d'écran (la caméra montre 20 tuiles), toutes les taches ont la même taille, et tous leurs bords tombent sur un multiple de 8 — **MESURÉ** : 1 408 bords de tache relevés autour du spawn (seed 2026, fenêtre 600-760 × 300-420), 1 408 sur la grille. Second défaut, plus profond : **deux échelles, deux langages** — des props cubiques à grain 4 px posés SUR une carte en aplats de 16 px, pas DANS un terrain.

La direction choisie : le sol est un **terrain dessiné** (grammaire Stardew / Zelda LTTP), pas une carte. Ce qui **pousse** (bosquet, fleuraie, lande, prairie humide, sous-bois) prend des formes **à la tuile** ; ce qui est **taillé** (zones, frontières, falaises, seuils, eau, bâti) reste **rectiligne** — R32 continue de le gouverner. Et le client **dessine** chaque tache comme un pavé : frange qui déborde, liseré, ombre portée — à la même échelle que les props.

## L'existant (relevé le 2026-08-22)

- **Le micro-relief muet** (`racine-relief.ts`) : `alt`, `altLarge`, `distEau`, `hum` vivent sur la **grille du motif** (`CREUX.MOTIF = 8`), rectangle de la Racine. `composerLHumidite` = creux (0,66) + proximité de l'eau (0,34) + bruit (échelle 52 tuiles, amplitude 0,42), **par cellule**. Quatre seuils par **quantile** (histogramme d'entiers) : prairie / bois / fleuraie / lande.
- **La lecture** : `vegetationAt(c, x, y)` lit `hum[celluleDe(x, y)]` — toute tuile du carré partage le verdict. C'est **la** source des carrés.
- **La peinture** (`zonegen.ts`, passe des Prés Bas) : seules les tuiles à thème de pré (herbe / forêt / fleuraie) cèdent ; l'eau, le marais, la roselière, la roche, les set-pieces ne sont pas touchés.
- **Restent cellulaires par construction, et le restent** : les lacs (cuvette inondée, union de motifs — R27 de `t0-exploration.md`), les chapeaux de crête (`coifferLesCretes`), les affleurements, la saulaie (frange par motif, 'RIPI'), le gradient sud (R13), les taches des autres zones (`solDe`).
- **Le bake client** (`WorldScene.bakeMapTexture`) : 1 px/tuile, un trait de transition d'une tuile (côté petit id), modulation de zone, lisière, grain par famille (`grain-sol.ts`, MULTIPLY, cellule 4 px). `ground-mesh.ts` : un quad par tuile, UV sur le bake.
- **Mesuré sur la planche offline** (`scratchpad/planche-sol.mts`, hors dépôt) : un autotile sur des carrés de 8 ne décore que de longs bords droits ; sur des formes à la tuile, la frange travaille à chaque coin — c'est ce qui se lit comme un terrain.

## Règles — chantier 2 (sim) : la végétation à la tuile

- **R1 — Le champ reste au motif, la LECTURE passe à la tuile.** `hum` n'est pas recalculé par tuile (le BFS à l'eau et les quantiles restent à la maille de 8 — 80× moins cher, et les seuils gardent leur contrat). `vegetationAt` interpole **bilinéairement** `hum` entre les centres des quatre cellules qui entourent la tuile, puis ajoute un **grain fin** (`fbm2`, échelle `CREUX.GRAIN_TUILE_ECHELLE`, amplitude `CREUX.GRAIN_TUILE_AMPLITUDE`), et compare aux **mêmes seuils**. Déterministe : `+ - * /`, `floor`, `fbm2` — rien d'autre.
- **R2 — Aucun bord de végétation ne privilégie la grille.** Sur la Racine, parmi les transitions entre deux terrains de l'échelle (prairie / bosquet / herbe / fleuraie / lande), la part de celles qui tombent sur `x ≡ 0 (mod 8)` (resp. `y`) est **≤ 25 %** (l'attendu d'une géométrie indifférente à la grille est 12,5 % ; avant : 100 %).
- **R3 — La composition reste un CONTRAT.** Les fourchettes de A12 (`t0-exploration.test.ts`) tiennent telles quelles : l'interpolation conserve la moyenne, le grain fin est symétrique. Aucun quantile n'est recalculé.
- **R4 — Pas d'éclaboussure.** Une tache est une forme, pas un semis : la part des tuiles de l'échelle sans **aucun** voisin (4-connexité) de leur terrain est **≤ 1 %** sur la Racine. C'est le garde-fou contre un grain fin trop fort — il se règle par `GRAIN_TUILE_AMPLITUDE`, pas par un filtre après coup.
- **R5 — Ce qui est taillé ne bouge pas.** Les tuiles d'eau, de marais, de roselière, de roche, de sente, de set-piece sont **identiques** avant et après la passe (la passe ne repeint que le thème du pré — inchangé). Les lacs restent des unions de motifs, les chapeaux de crête des unions de cellules : R27 et les bosquets de crête ne sont pas rouverts.
- **R6 — Le rang à l'eau tient.** A11 (marais < roselière < prairie < bosquet < herbe < fleuraie < lande) reste vrai sur les trois seeds de garde — la lecture à la tuile ne peut pas inverser un ordre que les quantiles garantissent.
- **R7 — Hors périmètre de ce chantier, consigné** : la frange de la saulaie (motif 'RIPI'), le gradient sud (R13, dither par motif), les taches des autres zones (`solDe`, Cendrière comprise). Ils sont « ce qui pousse » et devront suivre — un chantier chacun, mesuré de la même façon (R2), après que le pré ait été jugé à l'œil.

## Règles — chantier 4 (client) : les pavés dessinés

- **R8 — Une seule échelle.** Le sol se cuit à **16 px/tuile** (la maille des props), par **chunks** (le bake plein-carte à cette résolution ferait 2,5 M × 256 px — impossible en une texture) : une texture par chunk de N×N tuiles, cuite à la demande autour de la caméra, détruite hors portée. Le grain de famille (`grain-sol.ts`) y entre directement — plus de passe MULTIPLY séparée.
- **R9 — Chaque tache est un PAVÉ.** Un ordre de recouvrement par terrain (qui déborde sur qui : l'herbe sur la litière, la fleuraie sur l'herbe, la prairie humide sur l'herbe…) ; le pavé du dessus reçoit une **frange irrégulière** de 2 à 5 px qui déborde sur le terrain du dessous, un **liseré** sombre sur ses bords bas et latéraux, une **arête haute** éclairée, une **ombre portée** de 2 px sur le terrain du dessous. Autotile **procédural** (47 cas de blob résolus par le masque des 8 voisins), pas un tileset dessiné à la main.
- **R10 — L'eau, la falaise, le bâti gardent leurs couches.** Le pavé ne déborde jamais sur un terrain structurel (eau, falaise, mur, vide) : leurs shaders et sprites restent seuls maîtres de leur bord.
- **R11 — La lisière de zone et la modulation de zone restent** (R21 de `worldgen.md`) : elles modulent la teinte du chunk comme elles modulaient le bake.
- **R12 — Mesuré, pas deviné** : coût de cuisson d'un chunk (ms, pire seconde au déplacement), nombre de chunks vivants, mémoire GPU — relevés par le harnais smoke avant de fixer N.

## Critères d'acceptation

- **A1 (R2)** — test sim, trois seeds de garde : part des transitions de végétation sur la grille de 8 ≤ 25 % en x et en y.
- **A2 (R3)** — A12 de `t0-exploration.test.ts` vert sans toucher à ses fourchettes.
- **A3 (R4)** — test sim : part des tuiles de l'échelle isolées (aucun voisin de même terrain) ≤ 1 %.
- **A4 (R5)** — tenu par construction, pas par un test : le filtre de la passe (`zonegen.ts`, « seul le thème du pré cède ») n'a pas bougé, et `humAt` ne touche ni `hum` ni les seuils — vérifié à la relecture (`git diff main -- packages/sim`). Un test avant/après n'aurait rien à comparer : la seule « avant » est le même code.
- **A5 (R6)** — A11 vert.
- **A6 (R1)** — `replay`, `sim`, `events` verts : même seed → même carte, au bit près.
- **A7 (chantier 4, R8-R9)** — smoke : sur une capture au spawn, chaque frontière de végétation porte une frange et un liseré (profil de luminance relevé de part et d'autre) ; le sol et un prop voisin partagent la même maille de 4 px.
- **A8 (R12)** — smoke : la pire seconde au déplacement avec cuisson de chunks ≤ la pire seconde d'aujourd'hui + 2 ms.

## Ce que ça change pour le joueur

- Les **sauvegardes existantes gardent leur sol carré** : la carte est écrite une fois à la naissance du monde (`slot:carte`, `serializePartie`, garde `carte-immuable`) et n'est pas régénérée à la reprise. Seuls les mondes **fondés après** ce chantier ont la végétation à la tuile. Un replay-log serveur qui régénère depuis la seed verra une autre végétation — le lot de tout changement de worldgen.
- Les nœuds, la faune et les villages se placent sur le terrain **après** cette passe : ils suivent d'eux-mêmes.

## Décisions ouvertes (à poser une à une, à Alexis)

- L'amplitude du grain fin **à l'œil** sur la planche (R4 le borne par le haut ; le bas, c'est « assez de mollesse »).
- Le chunk : N = 32 ou 64 tuiles — une mesure (R12), pas un goût.
- L'ordre de recouvrement des pavés (R9) : une table de 20 terrains, à trancher en regardant.
