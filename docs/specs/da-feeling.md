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

- **R10** — LE GUÉ SE LIT EN LUMINANCE : contraste rendu profond/haut-fond ≥ 1,4:1, mesuré sur capture (moyenne de 3 instantanés — le clapot postérisé bruite ±0,1). Molettes : `mud`/`murk`, ET le ciel réfléchi un cran plus profond — la doctrine R45 est le GRADIENT de réflexion, pas la valeur du bleu (l'essai « vase sable clair » seul faisait lire la rivière comme une route : regardé, rejeté). Tenu à 1,44-1,5:1.
- **R11** — LES REMOUS : un acteur qui marche dans le haut-fond émet des anneaux quantifiés (grille 4 px, paliers de palette, alpha seul) — le patron `uFires` (positions poussées par frame) devient `uWaders`. C'est l'événement qui rend l'eau vivante, pas l'animation de toute la surface.
- **R12** — Rien d'autre ne bouge sans mesure : berge animée, éclats et reflets de Feux existent et sont calibrés. Le « trou noir nocturne » et la densité d'éclats restent des affinages à l'œil consignés.

## §6 — La brume du matin : un événement de l'aube

- **R13** — La brume NAÎT DE L'EAU : une nappe sur les tuiles d'eau et de marais DILATÉES de ~4 tuiles (le champ existe — `water-field`/terrain), en PLAQUES quantifiées (grain 4 px, NEAREST, hash positionnel à avalanche — le vocabulaire de la Combe), posée au ras du sol (sous les pieds).
- **R14** — FENÊTRE COURTE, PENTE CONTINUE (règle maison) : densité nulle avant ~4h30, pleine (~0,26 d'alpha) vers 6h, dissoute en pente continue jusqu'à ~8h30 — une fonction PURE de l'heure, testée, dans le module lighting (à côté de `daylight`). La respiration reste par l'alpha. La brume permanente de la Combe coexiste (c'est SON identité) ; la matinale s'y superpose sans doubler l'alpha au-delà du plafond.
- **R15** — LA BRUME EST UN SHADER DE NAPPES (amendé le 25/07 : la clause « aucun shader si l'image suffit » est tombée par son propre critère — Alexis, sur l'image plate : « on doit sentir que ça bouge et qu'il y a du volume »). La recette de l'eau : deux couches de bruit-valeur qui dérivent au vent (et sa perpendiculaire — la parallaxe interne fait le volume), champ POSTÉRISÉ en crans francs (trous, corps, crêtes claires), cellule 4 px, masque NEAREST. Le bord est une ASSISE en marches sur ~7 tuiles qui déborde des deux côtés (la coupe au couteau : jugée trop franche). Elle COIFFE LE MONDE (au-dessus du personnage et des houppiers, sous les oiseaux et le voile de nuit — la nuit l'assombrit d'elle-même ; retour d'Alexis). Sortie PRÉMULTIPLIÉE (le contrat réel du pipeline — prouvé à l'écran : non prémultiplié = mur blanc). Aucun post-FX. Le Feu ne troue PAS la brume (matière, doctrine du 24/07).

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
- **A6** — BRUME : `brumeDuMatin(hour)` est pure et testée (0 avant 4h30 et après 8h30, max vers 6h, pentes continues — jamais un palier) ; à 6h la nappe est VISIBLE sur l'eau et absente des hauteurs sèches ; à midi il n'en reste rien. Captures 5h/6h/8h/12h regardées.
- **A7** — AUBE : dans la fenêtre, des pépiements espacés (mesurables au compteur du moteur audio) ; hors fenêtre, silence de ce canal. Braises : présentes la nuit au-dessus d'un Feu, absentes le jour, alpha seul.
- **A8** — BUDGET : la génération des textures au boot reste sous 3 s de plus qu'avant (mesurée) ; aucun coût par tick côté /sim (le chantier est 100 % client) ; `check`/`lint`/tests verts, zéro touche `/sim` hors néant.
- **A9** — Chaque tranche livrée = capture(s) REGARDÉE(S) + verdict smoke, jamais une bascule à l'aveugle.

## Hors périmètre (consigné, pas oublié)

- Le SOL au pipeline (bake 1 px/tuile + ShadeLayer) — chantier entier, jamais séquencé ; réservé.
- Les ombres orientées soleil (réservé Alexis, réaffirmé 25/07) ; mat vs satiné ; normale par frame des acteurs si R9 conclut ainsi ; le choix de la variante d'erratique (les 3 tournent).
- La météo (pluie/rafales), les feuilles portées, le partage de brume — candidats notés.
- Les icônes d'UI (décision du 12/07 : hors atlas monde).
