# da-feeling — le monde entier sous la même lumière

*Source : mandat d'Alexis du 2026-07-25 (« même procédure pour améliorer l'ambiance, l'eau et son rendu, la brume le matin, passer l'ensemble des sprites en suivant la DA actée + normal map — même rigueur »). Cadre : les décisions DA des 14/17/19/20/22/23/24/25-07 (rectiligne, tout-ou-rien, un seul soleil, FX quantifiés, zéro post-FX, recette cubique figée). Statut : **livré le 2026-07-26** — §1-§7 implémentés (A1 partielle : la garde texte couvre props/nœuds ; st-/poi-/spr- gardés par la planche smoke `lieux-lit`), exceptions consignées : faune (recette par posture non actée), murs/porte (champ-de-hauteur à écrire), sol, pièces au ras du sol. Détails au journal du 26/07.*

---

## Objectif

Le tout-ou-rien du 2026-07-20 est acté mais inachevé : ~55 textures monde sur ~160 sont passées au pipeline `_lit` (albédo aplati + normale en dataSource). Le reste — nœuds, structures, ~24 lieux peints, bornes — vit en hillshade cuit sous une lumière dynamique qui le contredit (double ombrage). Et le feeling global a trois leviers connus et bon marché : l'eau (lisible et vivante), la brume du matin (un événement, pas un état), l'ambiance de l'aube.

> **Le principe : une seule lumière juge tout le monde.** Un sprite qui porte encore son ombrage peint est un mensonge sous le soleil dynamique.

## §1 — La factorisation (le socle)

- **R1** — `render/normal-map.ts` devient LA source de la recette : la `normalFromCanvas` de `poi-lit.ts` (passes/k/cell/plant/cracks — le surensemble strict) + `norm3`/`enc`/`FLIP_G`/`newCanvas`/`register`/`mirrorCanvas`. `lit-props` s'y rabat tel quel (cell≈2), `poi-lit` aussi, `lit-trees` pour le houppier (7 passes, cell 4, k 3,2 — vérifié au smoke `cubique`, à l'identique).
- **R2** — Les cadrans restent ceux du 24/07 : petit prop blocky = `passes:1, k:3,5` ; grosse masse = `4 / 2,6` ; POI 42 px = `cell:3, plant, cracks`. L'ombre bakée se peint TOUJOURS après la dérivation de la normale.

## §2 — La bascule mécanique (~50 textures, aucune décision d'art)

- **R3** — Tous les nœuds `nd-*` restants passent en `_lit` : `berry_bush` (×N états de stock — les baies restent un matériau plus satiné que le feuillage), `fiber_plant`, `sapling`, `rubble`, souches/cicatrices transitoires, tronc ET houppier du `old_tree` (le seul sprite du monde volontairement éteint aujourd'hui — `snapshot-view` lève l'exception).
- **R4** — Les chips de structures (coffre, ateliers, maison, composants…) suivent la même recette silhouette-partagée. Les MURS et la PORTE reçoivent leur recette champ-de-hauteur (généraliser celle des rondins de `st-fire`) — une fois écrite, elle sert aux 18 variantes.
- **R5** — Les pièces d'hier rejoignent le pipeline : bornes de seuil (+couronne), dalles de gué, et les 9 pierres du Cercle — qui exigent `pierre_levee_lit` ET `_lit_m` (le `setFlipX` actuel casserait le canal X ; on remplace par la texture pré-retournée).

## §3 — La bascule dessinée (~24 lieux, le gros du chantier d'art)

- **R6** — Chaque lieu peint de `poi-art.ts` reçoit sa version `_lit` : silhouette RECTILIGNE en liste de blocs (le format `ERRATIQUES` de `poi-lit.ts`), albédo aplati (la teinte-matériau, plus aucun hillshade), normale dérivée (cell 3, base plantée, fissures là où le matériau le veut), couronne = découpe haute du MÊME canvas. L'ordre : du plus rectangulaire au plus organique (cairn, pierre levée… les dômes de feuillage en dernier).
- **R7** — La preuve par la PLANCHE : le scénario smoke du pilote erratique (silhouette / albédo / normale / rendu JOUR / rendu NUIT aux constantes exactes) se généralise à tous les lieux basculés — et les captures se REGARDENT avant livraison. Le rendu nuit est le juge : une masse qui tombe en blob bleu est refusée.
- **R8** — `PoiLayer` perd son cas particulier : le hardcode `kind === 'erratique'` devient « tout kind qui possède une `_lit` » — le câblage suit la texture, la table n'a pas de liste à tenir à jour.

## §4 — Les acteurs : à la mesure de ce qui est acté

- **R9** — Les acteurs (avatar, PNJ, bêtes) restent `setLighting(true)`. S'ils peuvent recevoir une normale PAR POSTURE sans recette nouvelle (silhouette stable entre frames d'une même posture), on la livre ; sinon ils restent à normale plate et la question « normale par frame des acteurs animés » est CONSIGNÉE comme réservée à Alexis (elle l'est déjà au journal). On ne fabrique pas une recette d'animation non actée dans un chantier de bascule.

## §5 — L'eau : lisible d'abord, vivante ensuite

- **R10** — LE GUÉ SE LIT EN LUMINANCE : contraste rendu profond/haut-fond ≥ 1,4:1, mesuré sur capture (moyenne de 3 instantanés — le clapot postérisé bruite ±0,1). Molettes : `mud`/`murk`, ET le ciel réfléchi un cran plus profond — la doctrine R45 est le GRADIENT de réflexion, pas la valeur du bleu (l'essai « vase sable clair » seul faisait lire la rivière comme une route : regardé, rejeté). Tenu à 1,44-1,5:1 ; re-mesuré après la berge d'eau-vivante (26/07) : FOURCHETTE 1,40-1,46:1 sur 6 runs — la marge s'est resserrée (+0,05), le gate est passé à 5 instantanés pour tuer le bruit inter-run ; racheter de la marge = +0,05-0,1 de gain sur la vase `mud` (retouche d'œil, à Alexis).
- **R11** — LES REMOUS : un acteur qui marche dans le haut-fond émet des anneaux quantifiés (grille 4 px, paliers de palette, alpha seul) — le patron `uFires` (positions poussées par frame) devient `uWaders`. C'est l'événement qui rend l'eau vivante, pas l'animation de toute la surface.
- **R12** — Rien d'autre ne bouge sans mesure : berge animée, éclats et reflets de Feux existent et sont calibrés. Le « trou noir nocturne » et la densité d'éclats restent des affinages à l'œil consignés.

## §6 — La brume du matin : un événement de l'aube

*Refonte du 2026-07-26 (V1+V2, choix d'Alexis sur trois variantes maquettées — voir décisions du 26/07) : le retour « toute blanche, ne progresse pas depuis l'eau, frontière dure » a tué l'assise au masque dilaté. R13-R15 ci-dessous sont la version en vigueur.*

- **R13** — La brume EST UNE MARÉE née de l'eau : le masque porte un CHAMP DE DISTANCE À L'EAU (chanfrein au boot, canal R, plafond 15 tuiles — le geste du champ de cendre), et `frontDeBrume(hour)` (fonction pure testée, à côté de `brumeDuMatin`) fait MONTER le front de la berge vers les terres (0→9 tuiles, 4h30→6h), l'étale (→6h48), puis le soleil le REPOUSSE vers l'eau (→8h30) — la dissolution est l'ordre inverse de la naissance, les dernières flaques flottent sur les mares. Le bord du front est une rampe de ~2,5 tuiles TROUÉE par le bruit : un archipel qui épouse chaque méandre, jamais une droite. L'eau elle-même fume du premier au dernier instant (plancher de couverture sur les tuiles-source).
- **R14** — LA DENSITÉ SUIT LE FRONT (pleine dès 3 tuiles de marée, fondue à ses tout derniers instants — regardé : l'enveloppe horaire multipliée éteignait le retrait) ; pente continue partout, zéro brume hors fenêtre (testé + smoke `maree`). La brume permanente de la Combe coexiste (SON identité : champ de distance à son empreinte, halo constant de 4 tuiles) ; la matinale l'évide de son champ.
- **R15** — LA BRUME EST UN SHADER DE NAPPES + DES BANCS : (a) le shader (`mist-layer.ts`) — deux couches de bruit-valeur qui dérivent au VENT LISSÉ (`vent-lisse.ts` : cap de la sim rallié en ~15 s, force inventée, jamais nul) et sa perpendiculaire, champ POSTÉRISÉ en crans francs (trous, corps, crêtes) dont l'OPACITÉ appartient à chaque brume (`ReglageCrans` : poids des trois paliers + rail — la marée du matin plus transparente en haut de l'échelle depuis le 26/07, la Combe aux valeurs de la maquette ; l'écart entre paliers fait lire le volume, deux paliers au même poids = un drap), cellule 4 px, UNE lecture de masque par fragment, hash SANS sinus (polynôme de permutation mod 289 — portable au bit près), temps replié à 24 h ; il COIFFE LE MONDE (sous oiseaux et voile) ; la nuit l'assombrit par la RACINE du jour (l'aube éclaire la brume avant le sol — le mix linéaire la rendait iso-luminante avec le sol de 6h, mesuré), plancher nocturne bleuté 0,42-0,60 ; sortie PRÉMULTIPLIÉE (contrat prouvé dans la source Phaser : blend NORMAL = ONE, ONE_MINUS_SRC_ALPHA). (b) LES BANCS VOYAGEURS (`mist-banks.ts`) — nappes discrètes nées des GRANDES eaux (voisinage ≤2 tout eau), ≤5 autour de la caméra, gabarits bakés au grain 4 px (bruit-valeur interpolé), vie 1h30-3h par paliers d'alpha, vacillement par l'alpha seul, dérive au vent lissé, PROFONDEUR dans la bande des houppiers (devant un arbre, derrière l'autre — le volume). Aucun post-FX. Le Feu ne troue PAS la brume (doctrine du 24/07).

## §7 — L'ambiance de l'aube (le pack au meilleur rapport effet/effort)

- **R16** — LES OISEAUX DE L'AUBE : one-shots WebAudio synthétisés (sinusoïdes courtes modulées, pitch/intervalle randomisés côté client), UNIQUEMENT dans la fenêtre de l'aube — le moteur procédural existe, zéro asset.
- **R17** — LES BRAISES MONTANTES : au-dessus de chaque Feu la nuit, de rares pixels chauds qui montent et s'éteignent — géométrie quantifiée, vacillement par alpha, EN PHASE avec `fireGlow` (même seed que la flaque, le trou de voile et le reflet d'eau).
- **R18** — Rien de plus dans ce chantier : pluie, vent visuel, feuilles portées sont notés comme candidats, pas livrés.

## Critères d'acceptation

- **A1** — LE COMPTE EST TENU : toute texture de sprite MONDE consommée par les couches (nœuds, structures, clutter, lieux, bornes, gué, pierres) possède sa `_lit` (et `_lit_m` si elle se retourne) — garde en données pures qui énumère les registres, pas une liste recopiée. Exception documentée : les acteurs si R9 conclut « consigné ».
- **A2** — LA PLANCHE JOUR/NUIT de tous les lieux basculés : aucune masse en « blob bleu » la nuit (mesure d'étendue des normales par lieu, comme le scénario `erratique`) ; captures regardées.
- **A3** — Le smoke `cubique` existant reste vert AU PIXEL (la factorisation n'a pas le droit de changer un rendu déjà calibré à l'œil).
- **A4** — GUÉ : luminance profond/haut-fond ≥ 1,4:1 mesurée sur capture de jour au même point que la mesure de référence (1,29:1).
- **A5** — REMOUS : un avatar immobile dans le haut-fond n'émet rien ; en marche, des anneaux naissent et meurent ≤ 2 s ; zéro remous sur terre. Vérifié au smoke.
- **A6** — BRUME (amendé le 26/07, refonte V1+V2) : `brumeDuMatin(hour)` ET `frontDeBrume(hour)` sont pures et testées (0 hors fenêtre 4h30-8h30, pentes continues — jamais un palier) ; le scénario smoke `maree` mesure le front CONTRE l'heure lue à 5h/6h12/7h36/12h, compte les bancs (≥1 dans la fenêtre près d'une grande eau, 0 à midi), et ses captures se REGARDENT : liseré → plein → retrait → rien, jamais de frontière droite hors la géométrie de la rivière elle-même.
- **A7** — AUBE : dans la fenêtre, des pépiements espacés (mesurables au compteur du moteur audio) ; hors fenêtre, silence de ce canal. Braises : présentes la nuit au-dessus d'un Feu, absentes le jour, alpha seul.
- **A8** — BUDGET : la génération des textures au boot reste sous 3 s de plus qu'avant (mesurée) ; aucun coût par tick côté /sim (le chantier est 100 % client) ; `check`/`lint`/tests verts, zéro touche `/sim` hors néant.
- **A9** — Chaque tranche livrée = capture(s) REGARDÉE(S) + verdict smoke, jamais une bascule à l'aveugle.

## Hors périmètre (consigné, pas oublié)

- Le SOL au pipeline (bake 1 px/tuile + ShadeLayer) — chantier entier, jamais séquencé ; réservé.
- Les ombres orientées soleil (réservé Alexis, réaffirmé 25/07) ; mat vs satiné ; normale par frame des acteurs si R9 conclut ainsi ; le choix de la variante d'erratique (les 3 tournent).
- La météo (pluie/rafales), les feuilles portées, le partage de brume — candidats notés.
- Les icônes d'UI (décision du 12/07 : hors atlas monde).
