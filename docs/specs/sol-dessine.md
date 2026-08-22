# Le sol dessiné — ce qui pousse est mou, ce qui est taillé est droit

*Source : décision d'Alexis (2026-08-22), devant cinq variations rendues au même cadrage : « 2 et 4 c'est le type de DA que je kiffe » — organique (2) + pavés dessinés (4). Consignée dans `docs/decisions.md` ; amende `worldgen.md` R32.*

*Statut (2026-08-22) : **la berge (R13-R14) LIVRÉE** le soir même (smoke `berge` : 8 surplombs sur 34 chunks, 0 trou). **Chantier 2 (sim) LIVRÉ** — `humAt` (`racine-relief.ts`) : lecture bilinéaire du champ au motif + grain fin (`CREUX.GRAIN_TUILE_ECHELLE` 9, `GRAIN_TUILE_AMPLITUDE` 0,08), `vegetationAt` la lit ; tests `sol-dessine.test.ts` (A1, A3, R1). MESURÉ sur les trois seeds de garde : bords de végétation sur la grille de 8 **100 % → 12,0-12,6 %** (attendu 12,5), tuiles isolées 0,04 %, composition à ±1 point (A12 inchangé vert), 1 558 tests sim verts. **Chantier 4 (client) LIVRÉ le même jour** (« implémente ce que tu m'as montré ») — `render/paves.ts` (pur : propriétaires par priorité, frange 2-5 px, liseré, arête, tranche, ombre portée, brins ; 7 tests) + `world/pave-layer.ts` (chunks de 16 tuiles = 256 px, cuits à la demande, une couronne gardée, rendus après 30 frames hors vue). Le trait de transition d'une tuile du bake est retiré ; la passe MULTIPLY de `grain-sol` est cuite DANS les chunks. MESURÉ dans le navigateur (smoke `matiere`, SwiftShader) : 30 chunks à la première vue, **5,5-10,9 ms par chunk** au fil du déplacement (≤ 16 ms, une frame), 40 vivants en marche.*

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
- **R13 — LA BERGE EST UN PAVÉ DE TERRE SUR L'EAU** (décision d'Alexis 2026-08-22, sur planche : « très bien la reco »). L'eau (haut-fond, profond) entre dans l'ordre de recouvrement **tout en bas** (priorité 0) : toute terre déborde dessus — frange, liseré, ombre portée — exactement comme la prairie sur la litière. Une marque neuve, la seule : le **ressac**, 1 px clair (`PAVE.RESSAC`) sur l'eau, 4 px sous le bord bas d'une berge. L'eau n'a ni liseré, ni arête, ni tranche (une surface n'a pas d'épaisseur). **Le haut-fond reste une surface** : aucun pavé entre haut-fond et profond (refusé sur planche). R10 tient pour la falaise, le mur, le vide.
- **R14 — LE SURPLOMB passe au-dessus du shader d'eau.** Tout ce qui tombe sur une tuile d'eau — la frange de terre (opaque), l'ombre et la pénombre (noir à l'alpha 1 − f), le ressac (blanc à l'alpha f − 1) — sort dans une **seconde image** du chunk (`ChunkCuit.surplomb`, `null` sans eau), posée à `GROUND + 0,29` : au-dessus de l'eau (+0,25), des ombres de poissons (+0,27) et des reflets (+0,28) — une berge cache ce qui passe dessous — sous le gel (+0,30) et les feuilles (+0,32). L'eau nue y est transparente : le shader garde son clapot.
- **R12 — Mesuré, pas deviné** : coût de cuisson d'un chunk (ms, pire seconde au déplacement), nombre de chunks vivants, mémoire GPU — relevés par le harnais smoke avant de fixer N. MESURÉ le 2026-08-22 : à N = 32, 25 ms par chunk (Node/tsx, à chaud) — trop pour une frame ; **N = 16** → 5,5-10,9 ms dans le navigateur (SwiftShader), 30-40 chunks vivants soit ~10 Mo de textures.

## Critères d'acceptation

- **A1 (R2)** — test sim, trois seeds de garde : part des transitions de végétation sur la grille de 8 ≤ 25 % en x et en y.
- **A2 (R3)** — A12 de `t0-exploration.test.ts` vert sans toucher à ses fourchettes.
- **A3 (R4)** — test sim : part des tuiles de l'échelle isolées (aucun voisin de même terrain) ≤ 1 %.
- **A4 (R5)** — tenu par construction, pas par un test : le filtre de la passe (`zonegen.ts`, « seul le thème du pré cède ») n'a pas bougé, et `humAt` ne touche ni `hum` ni les seuils — vérifié à la relecture (`git diff main -- packages/sim`). Un test avant/après n'aurait rien à comparer : la seule « avant » est le même code.
- **A5 (R6)** — A11 vert.
- **A6 (R1)** — `replay`, `sim`, `events` verts : même seed → même carte, au bit près.
- **A7 (chantier 4, R8-R9)** — `paves.test.ts` : le pavé du dessus déborde de 2 à 5 px (jamais l'inverse), bord bas sombre + ombre dessous, l'eau transparente sans frange, cuisson déterministe ; capture smoke `default` regardée (frange, liseré, ombre, brins à la maille des props).
- **A8 (R12)** — smoke `matiere` : chaque chunk cuit au fil du déplacement ≤ 16 ms (une frame) — rougit au-delà.
- **A9 (R13-R14)** — `paves.test.ts` : sur un bord terre/eau, le sol est transparent sur l'eau ; le surplomb porte une frange opaque de 2-5 px, puis un voile d'ombre (noir translucide), puis le ressac (blanc translucide) au 4e px, puis rien ; entre haut-fond et profond, aucune marque. Smoke `berge` (--dev) : des surplombs vivent au bord de la rivière, 0 trou, capture regardée.

## Ce que ça change pour le joueur

- Les **sauvegardes existantes gardent leur sol carré** : la carte est écrite une fois à la naissance du monde (`slot:carte`, `serializePartie`, garde `carte-immuable`) et n'est pas régénérée à la reprise. Seuls les mondes **fondés après** ce chantier ont la végétation à la tuile. Un replay-log serveur qui régénère depuis la seed verra une autre végétation — le lot de tout changement de worldgen.
- Les nœuds, la faune et les villages se placent sur le terrain **après** cette passe : ils suivent d'eux-mêmes.

## Décisions ouvertes (à poser une à une, à Alexis)

- L'amplitude du grain fin **à l'œil** en jeu (R4 le borne par le haut ; le bas, c'est « assez de mollesse »).
- L'ordre de recouvrement des pavés (`PRIORITE_PAVE`, R9) : livré tel que la planche le montrait ; à recalibrer en regardant, terrain par terrain (la Cendrière n'a pas encore été regardée).
- Les réglages des pavés (`PAVE` : liseré 0,55, ombre 0,72, frange 2-5 px) — des ordres de grandeur, à l'œil.
- (Réglé par la mesure : N = 16.)
