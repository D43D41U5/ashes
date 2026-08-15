# t0-exploration — la Racine donne envie de marcher

*Source : mandat d'Alexis du 2026-07-25 (« monte une équipe pour traiter l'ensemble des points détectés — que du prod ») sur l'analyse indépendante de la zone T0 du même jour. Références externes étudiées : Valheim (repères/biomes), Don't Starve (set-pieces, top-down sans horizon), Rust (routes comme colonne vertébrale sociale), V Rising (gradient de corruption visible). Statut : **implémentée le 2026-07-25** — A1-A9 en tests headless (`t0-exploration.test.ts` + gardes existantes), A10 au scénario smoke `t0` (captures regardées). Notes d'implémentation : la lueur nocturne de R16 est COUVERTE par la braise du front existante (`cendre-layer`) — pas de FX doublon ; le plafond des Pierres levées suit la surface (`capFor`) ; les 9 menhirs du Cercle sont un décor client dérivé du rect. Jalon : calibrage Veillée / GATE 1.*

---

## Objectif de design

Le diagnostic, mesuré sur la seed du jeu (2026) : les Prés Bas font 1424×560 tuiles dont **80,5 % d'herbe nue**, 38 lieux de **7 espèces seulement** (empreintes de 2-4 tuiles : des timbres, pas des endroits), une seule silhouette qui perce la canopée (le Grand Chêne), une eau invisible depuis presque partout, et aucune anisotropie — le nord-ouest ressemble au sud-est. L'ossature du monde (zones, seuils, rareté géographique, front de cendre) est bonne ; **la chair du premier quart d'heure ne l'est pas**.

> **Le principe unique de cette spec : à chaque écran (35×20 tuiles), le joueur voit une raison de marcher vers l'écran suivant.**

Cinq gestes, qui attaquent le même défaut par cinq angles : des repères qui percent l'horizon (§1), une rivière colonne vertébrale (§2), des endroits à grande empreinte (§3), un sud qui annonce le feu (§4), et les traces du pays d'avant (§5). Tout est rectiligne (worldgen R32), tout est plat (pivot RimWorld), rien n'interdit jamais rien au joueur (worldgen R17) : **le monde prévient, il ne guide pas** (worldgen R21).

---

## §1 — Les repères d'horizon : le ciel comme boussole

Le mécanisme existe déjà et il est bon : un lieu se voit à `POI.SIGHT_TILES`, entre dans la carte quand on l'aperçoit, donne sa charge quand on l'atteint (`poi-discovery.ts`), et sa `crown` perce la couche des houppiers (`poi-layer.ts`). Le Grand Chêne prouve la boucle — mais il est **seul dans 614 000 tuiles**. On généralise le langage, sans le diluer.

- **R1 — La Racine porte AU MOINS QUATRE repères qui percent la canopée.** Le Grand Chêne (existant), **la Tour de guet effondrée** (unique — le pays d'avant regardait déjà le sud), **les Pierres levées** (2-3 menhirs solitaires), et la couronne du **Cercle de pierres** (§3). Chacun a une `crown` haute : on le voit venir à plusieurs écrans.
- **R2 — Les charges suivent les devises de `lieux.md`, sans en inventer.** La Tour de guet est un *savoir* à rayon (le Belvédère de la plaine : on grimpe aux décombres, on voit) — rayon entre celui du Chêne et celui du Belvédère. La Pierre levée est un *savoir* au plus proche **parmi les pierres** (`pierre_levee`, `cercle_pierres`) : *les pierres se répondent* — une chaîne de menhirs qui mène au Cercle. Le Cercle est un *récit* (une ligne de chronique, comme le Sanctuaire).
- **R3 — Jamais deux repères dans le même écran.** L'espacement du semis (96 tuiles) y pourvoit ; les lieux réservés le respectent aussi (`placeReserveAnywhere` le vérifie déjà). Un horizon qui appelle partout n'appelle nulle part.
- **R4 — Les seuils de la Racine S'ANNONCENT (mise en œuvre de worldgen R21).** Chaque bouche de seuil porte **deux BORNES de pierre dressées** — du décor client, dérivé de `map.seuils` (nouveau champ, voir §6), planté aux deux flancs de la porte, assez haut pour percer la canopée. On ne cherche plus la porte en longeant le grillage : **on la voit de loin, on marche vers elle.** Les bornes d'un seuil de secours sont brisées (l'autre passage se mérite). Aucune règle de jeu : du décor, gratuit, à la Dark Souls.

## §2 — La rivière : une colonne vertébrale, pas un archipel

L'eau de la Racine (worldgen R45) est aujourd'hui un archipel timide tenu **loin des frontières** : 13 lacs rectangulaires reliés de chenaux d'1-3 tuiles, et la « rivière » n'est que la plus longue liaison du graphe. Depuis le spawn, la première eau est à 146 tuiles et rien ne la signale. On promeut UNE rivière en trait structurant.

- **R5 — LA rivière TRAVERSE la Racine du nord au sud.** Elle naît au pied d'une frontière de la ceinture (l'eau descend des hauteurs), enfile 1 à 3 lacs, et meurt à la frontière de la Cendrière : **l'eau descend vers le feu**, et le joueur qui la suit apprend la géographie de la saison. Tracé Manhattan quantifié au motif (R32), comme tout le reste.
- **R6 — Le lit est un haut-fond large, le CŒUR est profond.** Demi-largeur 3 (7 tuiles) de `shallow_water`, cœur `deep_water` de demi-largeur 1 (3 tuiles). L'invariant de worldgen R45 (« jamais d'eau profonde sans anneau de haut-fond ») tient par construction. La rivière fait donc une **vraie frontière interne** — rive gauche, rive droite — sans jamais enclaver personne.
- **R6bis — Le COUDE est ÉQUERRÉ.** *(ajouté le 2026-07-26, sur constat d'Alexis « l'extérieur des coudes est bizarre ».)* Le lit se peint en bandes perpendiculaires au fil ; au virage, chaque bras s'arrêtait au pivot et le quart EXTÉRIEUR n'appartenait à aucun des deux — un bloc de `demi × (demi+1)` = **12 tuiles sèches plantées dans le coin de chaque coude** (MESURÉ : portée de l'eau sur la diagonale extérieure, médiane **0,00 tuile** contre 4,24 à l'intérieur, là où un coude carré donnerait 4,24 des deux côtés). On pose donc, sur CHAQUE pivot, le **carré plein de côté `2·demi+1`** — ce qui revient exactement à prolonger chaque bras de `demi` tuiles au-delà du virage. La berge extérieure tourne son angle droit au lieu de couper le virage ; le cœur profond s'équerre pareil (carré de côté 3). Même géométrie pour les ruisseaux (`tracerChenal`, qui n'avait aucune correction de coude), à leur échelle. Rectiligne (R32) : un coude reste deux droites et un angle droit, jamais une courbe.
- **R7 — Les GUÉS sont les portes de la rivière.** Là où une sente (§5) croise la rivière, le cœur profond s'interrompt : haut-fond pleine largeur, on traverse en ralentissant. **Au moins deux gués garantis** — s'il en manque, on en force aux tiers du cours. Chaque gué porte un toponyme (« le Gué », sans `kind` : un nom qu'on foule, pas une pastille).
- **R8 — La rivière ne casse aucune promesse existante.** Elle se pose AVANT les seuils (un seuil qui la croise rouvre son couloir — la porte gagne, ordre des passes inchangé) ; les gardes A2/A5 de worldgen restent vertes ; la faune y gagne ses coins de chasse par la règle existante (`nearWater`) — la rivière devient un chapelet de rencontres sans une ligne de code faune.

## §2bis — LE MICRO-RELIEF MUET : une seule variable commande tous les Prés Bas

*Décision d'Alexis, 2026-07-29, sur la carte rendue : « l'enchaînement des biomes ne suit aucune logique et produit un patchwork de polygones sans inspiration (sauf les marais, assez logiquement posés) ; idem pour l'eau — on a juste posé l'eau sur le patchwork de biome. » Statut : **implémenté** (`racine-relief.ts`, passes 1.45/1.55 de `zonegen.ts`). Amende `worldgen.md` R45 (le lac et le ruisseau). Journal : `docs/decisions.md`.*

**LA MESURE, parce que ce grief avait un chiffre.** Distance moyenne à l'eau, par terrain de la Racine (BFS multi-source, en tuiles) :

| seed | marais | roselière | bosquet | herbe | fleuraie |
|---|---|---|---|---|---|
| 1 | **3** | **8** | 70 | 83 | 76 |
| 7 | **3** | **8** | 85 | 93 | 92 |
| 42 | **3** | **8** | 96 | 92 | 103 |

Deux terrains savaient où était l'eau ; les autres étaient tous à la même distance, **et leur ordre s'inversait d'une seed à l'autre**. C'est la signature de l'indépendance, pas une impression de lecture. Et l'exception d'Alexis désignait la cause : marais et roselière étaient les **seuls terrains du T0 posés par une règle dérivée**. Tout le reste sortait de deux `fbm2` seuillés à graines différentes, plus un tirage-rejet pour l'eau. Il n'y avait pas d'enchaînement parce qu'il n'y avait **aucune variable d'ordre**.

> **Ce qui se lit comme LOGIQUE, c'est ce qui est DÉRIVÉ. Ce qui se lit comme arbitraire, c'est ce qui est POSÉ.**

- **R22 — UN CHAMP D'ALTITUDE INVISIBLE, interne à la génération.** Il n'est jamais rendu, jamais stocké dans `WorldMap` ni dans `SimState` : **la carte reste plate** (pivot RimWorld). Il ne rouvre pas le renversement du §1 de `worldgen.md` — le graphe de zones décide toujours de toute la STRUCTURE ; le relief ne décide que de la CHAIR d'une zone, entre ses murs. C'est ce que R36 laissait déjà ouvert (*« l'élévation flottante ne survit que comme dérivée »*).
- **R23 — LA CHAÎNE, et elle va dans ce sens :** `relief → l'eau va dans les creux → l'humidité rayonne de l'eau → la végétation suit l'humidité`. Le relief est la CAUSE, l'humidité l'EFFET — c'est ce qui explique *pourquoi le lac est là*, ce qu'un champ d'humidité seul n'aurait pas donné.
- **R24 — LA SUCCESSION EST LISIBLE d'un bout à l'autre du pays** : roselière → marais → **bosquet** (les vallons et les rives) → **herbe** (le pré) → **fleuraie** (les dos secs et ensoleillés). Trois terrains repeints, un seul ordre. Rien d'autre n'est touché : eau, marais, roche, sente, lisière sud et set-pieces gardent leur nature.
- **R25 — LES SEUILS SONT DES QUANTILES, PAS DES VALEURS.** La distribution de `fbm2` bouge d'une seed à l'autre ; seuiller en absolu ferait sortir un jour une Racine boisée au tiers. La part de chaque terrain est donc un **contrat** : ~13 % de bosquet, ~13 % de fleuraie, le reste en pré. Lu dans un histogramme d'entiers, jamais par un tri.
- **R26 — L'ORDRE VIENT DU CHAMP, LA TEXTURE VIENT DU BRUIT.** Un premier réglage collait le bois à l'eau à **12 tuiles** de moyenne quand l'herbe était à 110 : un liseré sombre autour de chaque lac, pas un bois. *Une variable d'ordre trop obéissante ne fabrique pas de la logique, elle fabrique une courbe de niveau.* Le creux domine donc l'eau, sa portée est longue, et un bruit fin casse la bande.
- **R27 — LE LAC EST UNE CUVETTE INONDÉE** (amende `worldgen.md` R45) : point le plus bas, lame d'eau posée, on inonde ce qui est dessous, cœur profond **érodé depuis la rive**. Forme : union de motifs — rectiligne (R32), jamais un rectangle. On inonde la **grande ondulation** seule : à deux octaves, les lacs sortaient filandreux (l'octave fine creuse des rigoles que l'inondation enfile au lieu de remplir la cuvette).
- **R28 — LE RUISSEAU CHERCHE LE COL LE PLUS BAS** (amende `worldgen.md` R45) : depuis le déversoir du lac, un plus-court-chemin de **goulot** (coût = altitude maximale à franchir) jusqu'à une eau. Tracé à blanc d'abord, peint seulement s'il aboutit — donc **jamais de moignon**, par construction. Un lac dont le col est trop haut est une cuvette fermée, et c'est la bonne réponse.
- **R29 — AUCUNE EAU DORMANTE AUX ABORDS D'UNE PORTE** (worldgen R10.3, garde A16). Les cuvettes vont où le terrain descend, et le terrain descend parfois vers un seuil : mesuré, un lac noyait la bouche d'un seuil sur quarante tuiles d'eau profonde et la sente n'avait plus où se poser (A6 rouge, seed 2026). L'exclusion est désormais **explicite**, et son rayon couvre le plus long couloir de seuil ET la fenêtre où la sente cherche sa bouche.
- **R30 — PÉRIMÈTRE : la Racine SEULE.** Les onze autres zones gardent leurs deux bruits indépendants. La recette leur est applicable telle quelle, zone par zone — c'est une décision à prendre, pas une dette silencieuse.

- **R31 — LES BOSQUETS DE CRÊTE : le bois SEC, et c'est le lac à l'envers.** *(Demande d'Alexis, 2026-07-29 : « quelques patchs de forêt déposés de manière équilibrée loin des points d'eau » ; essence tranchée par lui : pin et mélèze.)*

  **CE QUE LA MESURE A CORRIGÉ, parce que l'hypothèse évidente était fausse.** Ce n'est PAS une pénurie de bois : au pire on est à 52 tuiles d'un arbre, une écran et demi — personne n'est bloqué. C'est que la **fleuraie ne porte pas un seul arbre** (0 sur 86 000 tuiles, vérifié) : `arbresDeLaRacine` sème épars sur l'herbe, dense en futaie, et s'arrête là. Ce trou existait AVANT ce chantier ; la fleuraie n'étant qu'un moucheté de 5 %, il ne se voyait pas. Elle est passée à 13 % en plaques cohérentes — le trou est devenu **un endroit**, et un endroit sans une seule verticale : rien ne casse l'horizon, rien n'appelle à marcher. C'est le principe unique de cette spec qui tombait, précisément là.

  - **Le placement est DÉRIVÉ, pas semé.** Une grille grossière garantit la couverture (le « de manière équilibrée ») ; à l'intérieur de chaque case, c'est le relief qui choisit — le **sommet sec**. On pose un chapeau sous ce sommet et l'on garde ce qui dépasse : le bosquet épouse la bosse comme le lac épouse la cuvette, **même champ, algorithme retourné**. Saupoudrer des patchs avec une graine de plus aurait réintroduit exactement le « posé » que §2bis retire.
  - **« Loin de l'eau » se tient par DÉRIVATION, jamais par une distance écrite** : le sommet doit tomber dans la bande sèche de l'humidité, laquelle dérive de la distance à l'eau. Une seule règle, donc rien qui puisse diverger. *(Mesuré : pin 176-211 tuiles de l'eau, mélèze 182-193, contre 24-27 pour le bosquet humide.)*
  - **DEUX BOIS QUI RACONTENT DEUX CHOSES.** Le pin et le mélèze étaient réservés aux zones de palier > 0 (`HAUT_BOIS`) ; ils descendent sur les crêtes sèches de la Racine. Feuillu sombre au fond humide, conifère clair sur la bosse — la logique de §2bis (humide = couvert, sec = ouvert) reste lisible, et le bois sec ne se lit pas comme son rattrapage. C'est aussi un avant-goût des hauteurs, même grammaire que le vieil arbre dérisoire du Bois Noir ou le filon du teaser.
  - **LA LIGNE SANS LAQUELLE CE N'EST QU'UN APLAT DE COULEUR** : le pin et le mélèze rejoignent la branche FUTAIE de `arbresDeLaRacine`. `terrainAdmet` laissait bien le pin porter des arbres, mais à la densité commune du semis (un nœud toutes les 36 tuiles) — on aurait peint un bois qui n'en est pas un.
  - **LE MASQUE DES SEUILS EST LE MÊME QUE CELUI DE L'EAU.** Un bosquet dans une porte la nourrirait — de bois — et R10.3 l'interdit au même titre. Une seule règle, un seul masque.
  - **UNE FAUTE QUI VALAIT LA MESURE** : la première écriture exigeait que CHAQUE cellule du chapeau soit dans la bande sèche. Les bosquets sortaient minuscules et hachés — la bande sèche est un quantile à 16 %, donc un ensemble **moucheté** (le bruit de lisière l'émiette à dessein), et l'on demandait à une colline d'être faite de confettis. La sécheresse qualifie le **lieu** (le sommet, une fois) ; la **forme** vient du relief.

**Critères** *(balayage de 24 seeds à la taille de production, plus les gardes existantes)* :

- **A11** — L'ORDRE À L'EAU EST STABLE : sur toute seed, `d(marais) < d(roselière) < d(bosquet) < d(herbe) < d(fleuraie)`. C'est le critère qui dit qu'une variable d'ordre existe — celui que l'ancienne carte échouait, ses rangs s'inversant d'une seed à l'autre.
- **A12** — LA COMPOSITION EST UN CONTRAT : bosquet ∈ [9, 16] %, fleuraie ∈ [10, 18] %, herbe ∈ [50, 62] % de la Racine, sur toute seed. *(Mesuré sur 24 seeds : 10,7-12,9 / 12,7-14,5 / 54,3-56,5.)*
- **A13** — RIEN N'A CÉDÉ AILLEURS : A17 (emplacements de village), A2/A5 de `worldgen.md`, A2bis (l'anneau de haut-fond) et A6 (la sente à chaque bouche de seuil) restent verts, et la Racine marchable reste d'**un seul tenant**. *(Mesuré sur 24 seeds : A17 au pire 48 pour 16 exigés, une seule composante partout.)*
- **A14** — LES BOSQUETS DE CRÊTE EXISTENT ET SONT SECS : ≥ 5 bois de conifère d'au moins 400 tuiles (20 de côté) dans la Racine, et leur distance moyenne à l'eau vaut **plus du triple** de celle du bosquet humide. Le critère porte sur la DEMANDE (« loin des points d'eau »), pas sur le moyen : si le placement change de mécanisme demain, il reste le bon. *(Mesuré : 7 à 10 bois de cette taille par seed, la plupart à 36 de côté — le plafond d'inondation ; pin à 176-211 tuiles de l'eau contre 24-27 pour le bosquet humide.)*

  **UN COMPTE DE COMPOSANTES N'EST PAS UN COMPTE DE BOSQUETS**, et la nuance est écrite parce qu'elle m'a fait publier un chiffre faux. Le balayage rend 11 à 14 composantes de conifère par seed, mais les bois posés sont moins nombreux : les **sentes les traversent** (une route de trois tuiles coupe un bois en deux) et le **murage de frontière** en rogne un bord. Vérifié : les fragments de 56 à 346 tuiles bordent tous une route ou une arête. Ce n'est pas un défaut — un chemin qui traverse un bois est ce qu'on veut — mais il faut compter ce qu'on croit compter. D'où le seuil de 400 tuiles dans A14 : il mesure des BOIS, pas des morceaux.

## §2ter — LE VOCABULAIRE DU PRÉ : la saulaie, la prairie humide, la lande à genévriers

*Décision d'Alexis, 2026-08-15 (« je valide la direction, ouvre le chantier du vocabulaire » puis « ok pour les trois mots »), sur diagnostic MESURÉ : dans toute la T0, la forêt ancienne tient en UN massif de 1 920 tuiles = 48×40 exactement (le tampon Bois Noir), le marais-en-tant-qu'endroit en UN massif (la Combe) plus 119 confettis de médiane 24 tuiles, et les conifères de crête sortent à 2 560/1 280×6 tuiles — la signature du plafond d'inondation, pas celle des collines. Le socle, lui, sait déjà des choses que trois ids écrasent (NO 63 % herbe / 5 % bosquet contre NE 42 / 22, massifs feuillus de 28 000 tuiles). Direction actée : la diversité de la T0 vient d'un VOCABULAIRE DÉRIVÉ du socle — étage 1 de trois (étage 2 : la profondeur intra-massif, lisière/corps/cœur ; étage 3 : la couronne — les set-pieces dérivés, la mort des tampons).*

- **R32 — L'ÉCHELLE D'HUMIDITÉ PASSE DE TROIS À CINQ ÉTAGES — même champ, mêmes quantiles, un seul ordre.** Le verdict de végétation (`vegetationAt`) lit toujours l'unique champ d'humidité de §2bis, avec deux quantiles de plus : **prairie humide** (le quantile le plus humide — les fonds mal drainés, l'auréole des eaux au-delà du marais franc), bosquet, herbe, fleuraie, **lande à genévriers** (le quantile le plus sec — les dos hauts et secs, l'écrin naturel des conifères de crête). Aucun bruit neuf ne décide d'un terrain : les parts sont des contrats (`CREUX.PART_*`), lues par `seuilParQuantile`.
- **R33 — LA SAULAIE LONGE L'EAU QUI COULE, par dérivation, jamais par semis.** Une bande de `willow` le long du fil de LA rivière et des chenaux entre lacs (le module d'eau publie ses tuiles de chenal), cœur plein puis frange effilochée par hash positionnel salé (`'RIPI'`). Elle ne cède que le THÈME du pré (les cinq étages de R32) — l'eau, le marais, la roselière, la roche gardent leur nature — et les passes ultérieures gardent leur priorité : set-pieces, sentes et gués la traversent (un chemin qui coupe un bois est un endroit), la lisière sud la convertit (R36).
- **R34 — CHAQUE MOT ARRIVE AVEC SES OBJETS DE JEU RÉELS, sans type de nœud neuf.** La saulaie est une FUTAIE : arbres récoltables au régime dense d'`arbresDeLaRacine` (l'essence client `saule` existe), champignons au régime humide. La prairie humide est LA place à fibre de la T0 (passe appendue salée `'FIBR'` — la ressource des bandages a enfin un endroit) et porte des champignons. La lande porte les baies du genévrier et sa pierre — et rien d'autre : pas d'arbre, pas de champignon.
- **R35 — LA FAUNE SUIT, ET L'EAU COMMANDE TOUJOURS.** `willow` entre dans les bois (`WOOD_TERRAINS`, habitats sanglier et cerf) ; `wet_meadow` et `juniper_heath` dans l'ouvert (`OPEN_TERRAINS`, habitats lapin et cerf pour la prairie, lapin pour la lande). **Aucun des trois n'entre dans `WATER_TERRAINS`** : la prairie humide est de l'habitat, pas de l'eau — le gibier reste commandé par l'eau réelle.
- **R36 — LE SIGNAL DU SUD EST PROTÉGÉ, deux fois.** La lande sèche est un **id neuf** (`juniper_heath`) : `heath` reste le mot du gradient sud (« le feu approche ») et du sol des Ruines — deux landes, deux teintes, deux sens. Et la lisière sud convertit AUSSI les trois mots neufs : dans la bande du gradient, rien ne perce l'annonce du feu.
- **R37 — LES CRÊTES COIFFENT AUSSI LA LANDE.** `peindreLesBosquetsDeCrete` accepte la lande à genévriers comme sol coiffable (herbe, fleuraie, lande) : le mot sec s'installe précisément là où naissent les conifères — sans cette règle, il les affamerait.

**Critères** *(seeds de garde de la suite t0, à la taille de production)* :

- **A15** — CHAQUE MOT EXISTE ET SE DÉRIVE : saulaie, prairie humide et lande comptent chacune ≥ 2 000 tuiles par seed ; et TOUTE tuile de saulaie est à ≤ max(`RIPI_FIL_FRANGE`, `RIPI_RU_FRANGE`) tuiles (Chebyshev) d'une tuile d'eau — garde exhaustive, pas un échantillon.
- **A16** — LE RANG S'ÉTEND : `d(marais) < d(roselière) < d(prairie humide) < d(bosquet) < d(herbe) < d(fleuraie) < d(lande)` sur toute seed, et `d(saulaie) < d(bosquet)`. C'est A11 continué : la variable d'ordre commande les sept mots.
- **A17** — LA COMPOSITION RESTE UN CONTRAT : fourchettes ré-épinglées à la MESURE, et elles vivent dans la garde A12 ré-ancrée. *(Mesuré sur les trois seeds de garde : saulaie 1,6-2,1 % — plus mince que la cible initiale de 2-6, et c'est sa nature de GALERIE : l'élargir encore en ferait une bande-forêt ; prairie humide 5,1-6 ; lande 5,4-7,3 ; bosquet 14-16 ; fleuraie 12-14,5 ; herbe 38-40. Épinglé : saulaie 1-4, prairie 3-9, lande 3-9, bosquet 12-18, fleuraie 9-17, herbe 33-47.)* Et le CIEL des Prés Bas change de porteur : l'herbe seule ne peut plus le garantir — le contrat devient **l'OUVERT ≥ 55 %** (herbe + fleuraie + prairie humide + lande), tout ce qui laisse voir l'horizon.
- **A18** — LES NŒUDS SUIVENT : sur toute seed, la saulaie porte des arbres récoltables en densité de futaie, la prairie humide porte fibre ET champignons, la lande porte des baies ; A7 (rien sur sente ni rampe) s'étend aux trois mots.

*Réglages : dans `CREUX` (`racine-relief.ts`), patron des autres blocs worldgen — `PART_PRAIRIE`, `PART_LANDE`, et les portées `RIPI_*` de la saulaie. Étages 2 et 3 : décisions à venir, une à une.*

## §2quater — LA PROFONDEUR INTRA-MASSIF : lisière, corps, cœur (étage 2)

*Décision d'Alexis, 2026-08-15 (« go pour le jeu dès l'étage 2 ») : la profondeur porte du JEU
dès sa naissance — nœuds, habitat et couvert par bande, pas seulement le rendu. Constat : à
l'intérieur d'un mot, seul le rendu variait (taillis d'amas, sous-bois de lisière ×1,35,
gradients de berge) — rien dans la sim ne savait « je suis au cœur de ce massif » : pas de
variable de profondeur, couvert plat par terrain, entrelacement de lisières sauté sur la Racine.*

- **R38 — LA PROFONDEUR SE DÉRIVE, elle ne se sème pas.** `map.profondeur` : par tuile, la
  distance (érosion entière 8-connexe, Chebyshev — le voisinage du reste du worldgen) au bord
  de son massif BOISÉ de la Racine, plafonnée à `PROF_CAP`. Boisé = forêt, futaie ancienne,
  pin, mélèze, saulaie ; zéro partout ailleurs (autres zones, terrains ouverts, eau). Aucun
  bruit : deux érosions du même terrain donnent le même champ. Les clairières ne percent PAS
  la profondeur (terrain encore boisé) : ce sont des chambres DANS la masse, pas des trouées
  de lisière. **Le champ est GELÉ à l'amorce et persiste avec l'état** (le patron des solides
  éternels : un état qui ne bouge jamais) — le feu qui ronge un bord ne recalcule rien, mais
  un bonus ne s'applique JAMAIS sur une tuile qui n'est plus boisée : l'étiquette survit,
  inerte ; le bonus meurt avec l'arbre.
- **R39 — TROIS BANDES, ET LE CŒUR SE MÉRITE PAR LA TAILLE.** Bandes dérivées du champ, jamais
  stockées à part : lisière (`d ≤ PROF_LISIERE`), cœur (`d ≥ PROF_COEUR`), corps entre les
  deux. Un massif trop petit pour atteindre `PROF_COEUR` n'a pas de cœur — par construction,
  sans liste ni exception : la hiérarchie des bois vient de la géométrie que la carte possède
  déjà. La saulaie, galerie étroite, sera presque toute lisière — c'est sa nature.
- **R40 — CHAQUE BANDE PORTE DU JEU RÉEL, rien de neuf au registre.** Passes appendues salées
  (le patron 'FIBR'), tirage positionnel, aucun décalage du flux : ① la LISIÈRE porte les
  baies (`berry_bush`, sel `'LISI'`) — le bois se cueille au bord ; ② le CŒUR porte les
  champignons du cœur (`champignon`, sel `'COEU'`, plus dense que le régime forêt commun) et
  les VIEUX FÛTS : les arbres du cœur portent un stock MAJORÉ (`×VIEUX_FUT_FACTEUR`) — par une
  FONCTION PURE de la position, appliquée à la naissance ET réappliquée à la repousse (le
  patron `withForageRichness` : la repousse remet le stock au défaut du type, une donnée
  d'instance mourrait au premier épuisement). SAUF en futaie ancienne : le Bois Noir garde sa
  doctrine du teaser (« le gros bois existe. Pas ici. ») — le cœur majore l'ORDINAIRE, il
  n'importe jamais une structurante. A7 s'étend (rien sur sente ni rampe).
- **R41 — LA FAUNE ET LA CHASSE SENTENT LA PROFONDEUR, par le COUVERT — un seul canal.** Le
  couvert effectif se module par bande : au cœur, mieux couvert (facteur `COVER_COEUR`,
  appliqué SEULEMENT si la tuile est encore boisée — R38) ; la lisière garde le nominal. UNE
  seule fonction (`couvertEffectif`) nourrit les TROIS lecteurs : la détectabilité du chasseur
  (`coverAt`), le rôdeur qui traque, ET le choix de couche du gibier (`bedStep` lisait la
  table brute — il lirait un couvert que la chasse ne voit pas) — c'est le couchage qui envoie
  le gibier au cœur, pas la roulette de repeuplement : y peser une tuile déjà tirée serait
  inerte, et la rejeter décalerait le flux RNG (leçon consignée). S'enfoncer = plus caché,
  plus de valeur, moins de visibilité : le risque/récompense est spatial.
- **R42 — LE RENDU LIT LA PROFONDEUR EN PENTE CONTINUE.** Le sol s'assombrit continûment avec
  `d` (0 → `PROF_CAP`), jamais par paliers — les BANDES sont des règles de jeu, pas des
  marches visuelles. Le clutter suit les bandes (lisière : le sous-bois dense existant ;
  cœur : sous-bois plus nu, champignons au sol). Le client LIT `map.profondeur` reçu au
  `ready` (le canal existe : `WorldMap` part entier, champ additif optionnel — patron
  `map.fil`, `PROTOCOL_VERSION` ne bouge pas) — il ne re-dérive JAMAIS : un client qui
  rejoint après un feu dériverait un autre champ que celui, gelé, de la sim. Coût assumé et
  consigné : ~+10 Mo sur l'enregistrement carte (écrit UNE fois, zéro impact autosave) et
  autant sur le fil d'un join LAN (la carte y part déjà entière).

**Critères** *(seeds de garde, taille de production)* :

- **A19** — LA PROFONDEUR SE DÉRIVE ET SE MÉRITE : garde EXHAUSTIVE (toute la grille, pas un
  échantillon) — toute tuile boisée de la Racine porte `d ≥ 1` ; toute tuile non boisée ou
  hors Racine porte 0 ; une tuile de lisière a un voisin 8-connexe hors du masque ; aucun
  massif de moins de `(2·PROF_COEUR−1)²` tuiles ne porte de cœur ; sur chaque seed de garde,
  au moins un massif EN porte un.
- **A20** — LE CŒUR DONNE, LA LISIÈRE CUEILLE : baies présentes en lisière de bosquet ;
  champignons du cœur présents et PLUS denses au cœur que le régime forêt commun ; vieux fûts
  (`stock > NODE_DEFS.tree.stock`) présents UNIQUEMENT au cœur et JAMAIS en futaie ancienne ;
  rien sur sente ni rampe.
- **A21** — LE COUVERT SUIT, PARTOUT PAREIL : pour un même terrain boisé, le couvert effectif
  au cœur est STRICTEMENT meilleur qu'en corps/lisière ; sur une tuile déboisée après l'amorce
  (le feu), le bonus est mort ; le GIBIER SE COUCHE au cœur (une bête qui choisit sa couche
  avec un cœur à portée le prend — testé en unitaire) ; et le VIEUX FÛT SURVIT À LA REPOUSSE
  (le stock majoré est une fonction pure de la position, réappliquée à la repousse — jamais
  une donnée d'instance qui meurt au premier épuisement).
- **A22** — LE RENDU MONTRE LA PROFONDEUR : capture smoke lisière → cœur du même massif ; la
  luminance moyenne du sol décroît de la lisière au cœur (pente continue, mesurée sur la
  capture) ; les clairières restent lisibles (elles ne s'assombrissent pas).
- **A23** — DÉTERMINISME ET COÛT : double génération identique champ compris ; parité
  Veillée/LAN (même fonction, même amorce) ; coût de la dérivation MESURÉ à la génération et
  impact CHIFFRÉ sur la taille de sauvegarde — si l'un des deux déborde, on encode plus petit
  avant de livrer, pas après.

*Réglages : `PROF_LISIERE`, `PROF_COEUR`, `PROF_CAP` dans `CREUX` (géométrie — se règle en
regardant une carte) ; `VIEUX_FUT_FACTEUR`, `CHAMPIGNON_COEUR`, `BAIES_LISIERE` dans `CONTENU`
et `COVER_COEUR` dans `balance.ts` (jeu — se règle en jouant). Étage 3 (la couronne — les
set-pieces dérivés, la mort des tampons) : décision à venir.*

---

## §3 — Les set-pieces : des ENDROITS, pas des timbres

Un « Verger sauvage » de 3×3 tuiles ne peut pas produire d'émotion : on n'entre jamais *dedans*. Don't Starve le fait depuis dix ans : quelques morceaux de bravoure par carte, grands, nommés, qui ne ressemblent qu'à eux-mêmes.

- **R9 — La Racine porte TROIS set-pieces à grande empreinte, un de chaque, nommés :**
  - **le Bois Noir** (~48×40) : une mini-sylve — sol `old_growth`, futaie dense, sombre, clairières comprises. Il murmure ce que la Vieille Sylve promet.
  - **le Cercle de pierres** (~24×24) : une couronne de pierres levées sur la fleuraie. Il est la destination de la chaîne des menhirs (R2), et sa couronne se voit de loin (R1).
  - **la Combe brumeuse** (~40×32) : un creux de marais et de roselière autour d'une mare, noyé d'une brume au sol (client). Champignons et fibre y abondent — par les règles EXISTANTES d'admission de terrain, pas par une table neuve.
- **R10 — Un set-piece est un LIEU, pas un sprite.** Il a un `kind`, un nom, il se découvre et entre dans la carte (mécanisme `lieux.md` intact) — mais son corps est son TERRAIN : `PoiLayer` n'y pose pas d'image-centre (étiquette seule), et il est **exclu de `poiClearings`** (on ne « dégage » pas un endroit dont le contenu est la raison d'être — même exclusion que gisement/carrière). Techniquement, les trois kinds entrent dans `POI_TYPES` **hors semis** (`biomes: []`, jamais éligibles au tirage — ils se posent en passe dédiée du worldgen) : la garde A19 (« chaque type naît vraiment ») les couvre alors gratuitement, et `poiFamily` sait répondre pour le garde-fou des charges. Le semis de Poisson, lui, **écarte tout point à moins d'un espacement d'un lieu déjà enregistré** — la garde d'espacement minimal reste vraie avec des lieux posés hors semis.
- **R11 — Le Bois Noir porte un TEASER, patron du Filon.** UN `old_tree` unique, stock dérisoire (`TEASER_STOCK`) : *« le gros bois existe. Pas ici. »* Même grammaire que le fer — le joueur qui a compris le Filon comprend le Bois Noir sans un mot.
- **R12 — Placement au cœur.** Comme les lacs : marge aux frontières (l'eau et les seuils vivent aux bords), jamais sur l'eau ni un seuil, écartés entre eux d'au moins 200 tuiles. Tirage par rejet, salé, positionnel.

## §4 — Le sud brûle à vue : l'enfer au pas de la porte

La décision fondatrice dit : la T2 collée à la Racine existe « *pour qu'on VOIE l'enfer depuis son pas de porte* ». Aujourd'hui le sud du pré est le même vert que le nord jusqu'à la dernière tuile, puis une ligne grise d'une tuile. C'est la seule frontière qui AVANCE (le front de cendre la franchira au jour 1) — elle a droit à un traitement que les autres n'ont pas.

- **R13 — Une bande de GRADIENT le long de la frontière Cendrière, ~40 tuiles.** Herbe → lande (`heath`) → lisière calcinée (`burnt_forest`), décidée par MOTIF (8 tuiles) avec un dithering positionnel : des marches irrégulières de blocs, jamais une ligne droite. Les terrains existent déjà — aucun id nouveau.
- **R14 — Le gradient ne change AUCUNE règle.** Les nœuds suivent les admissions existantes (le calciné admet l'arbre : du bois noirci se coupe ; la lande admet baies et fibre). Les emplacements de village suivent les règles existantes. La garde A17 reste verte — c'est un critère, pas un espoir.
- **R15 — L'exception est ASSUMÉE et bornée.** Une frontière qui déteint sur sa voisine contredit « une zone = un thème » (worldgen R7) — on le fait quand même, UNIQUEMENT ici, parce que cette frontière-là est la menace de la saison : c'est worldgen R21 appliqué à la plus grande porte du jeu. Aucune autre frontière ne déteint.
- **R16 — Client : la lisière porte ses signes.** Arbres morts sur le calciné (le clutter du `burnt_forest` existe), cendres dans l'air de la bande (FX quantifié, mémoire projet : jamais de halo lissé), et la nuit, une lueur rouge basse sur l'horizon sud depuis la bande. *(La lueur est un SOUHAIT, pas un critère : si elle se paie en promotion d'éclairage dynamique, elle attend — décision consignée le cas échéant.)*

## §5 — Les traces du pays d'avant : sentes et ruines

Le pré est vierge comme un terrain de sport, alors que le lore dit l'inverse : une vallée qu'on PERD. Quelqu'un vivait là. Rust le montre : une route, même muette, est une promesse (« ça mène quelque part ») et un lieu social. Le terrain `road` existe déjà dans la table (id 2, ×1,25) — inutilisé sur la carte zonée.

- **R17 — Des SENTES relient les seuils de la Racine.** Terrain `road` existant, 3 tuiles de large, polylignes Manhattan : chaque seuil de la Racine est relié au réseau (topologie en étoile passant près du cœur de la zone). Elles contournent l'eau profonde des lacs, traversent la rivière **aux gués** (R7 — c'est le croisement qui CRÉE le gué), s'arrêtent à la bouche des seuils. Elles accélèrent (×1,25, la valeur de la table) : la route est un choix — plus rapide, plus exposée (Rust le dit : la route fabrique les rencontres, et c'est la feature).
- **R18 — Rien ne pousse sur une sente, et rien ne s'y adosse.** Comme un seuil (rampe) : aucune tuile `road` ne porte de nœud. Et **aucun lieu ne naît à cheval sur une sente** (l'empreinte d'un candidat du semis ne doit contenir aucune tuile `road`) — un verger coupé en deux par la route perdrait ses baies, et un lieu se poste AU BORD du chemin, pas dessus.
- **R19 — Les ruines basses du pays d'avant.** Deux lieux `shelter` nouveaux, réservés à la Racine : **la Ferme ruinée** (cap 2 — des murs bas effondrés, un pignon debout à `crown` modeste) et **la Charrette abandonnée** (cap 3 — une épave au bord d'une sente si possible, sinon dans le pré). Abri au sens des shelters existants, **aucun butin** (lieux.md A9). Avec la Tour de guet (R1), le pré raconte : on vivait ici, on guettait le sud, on est partis.

## §6 — Les données : ce que le client doit savoir

- **R20 — `WorldMap.seuils` : les seuils deviennent une donnée de premier ordre.** `{ x, y, ax, ay, secours, vers }[]` (position, axe de traversée, drapeau secours, nom de la zone de destination) — additif, JSON-sérialisable, rempli par `generateZonedTerrain`. Consommateurs : les bornes (R4), l'onglet carte (les portes peuvent se dessiner), et demain les toponymes de seuil qui cesseront d'être devinés par leur nom.
- **R21 — Les gués et set-pieces s'enregistrent dans `map.zones`.** Les set-pieces avec `kind` (des lieux) ; les gués en toponymes sans `kind` (des noms). Le `poiId` reste l'index : tout s'ajoute EN FIN de tableau, jamais au milieu.

---

## Critères d'acceptation

Sur la seed du jeu (2026) **et** les seeds de garde maison (7, 42 — celles de `zonegen.test.ts`) :

- **A1** — La Racine porte exactement : 1 Grand Chêne, 1 Tour de guet, 2-3 Pierres levées, 1 Cercle de pierres, 1 Bois Noir, 1 Combe brumeuse, ≥ 1 Ferme ruinée, ≥ 1 Charrette. Tous les lieux à `crown` de la Racine sont deux à deux écartés d'au moins 90 tuiles.
- **A2** — LA RIVIÈRE TRAVERSE : il existe un chemin 4-connexe de tuiles d'eau (`shallow`/`deep`) contiguës dont une extrémité est à ≤ 12 tuiles de la frontière NORD de la Racine et l'autre à ≤ 12 tuiles de la frontière SUD (Cendrière). Son cœur profond est partout ceint de haut-fond (échantillon exhaustif : toute tuile `deep` de la rivière a ses 8 voisins en eau ou haut-fond, jamais en terre sèche adjacente).
- **A2ter** — LE COUDE EST ÉQUERRÉ : à chaque coude du fil (changement de direction, comparé composante par composante) situé à ≥ `RIVIERE_BOUCHE` pas des deux bouts, aucune tuile du bloc extérieur `{ pivot + a·din − b·dout | a ∈ [1,demi], b ∈ [0,demi] }` n'est de la **terre marchable de la Racine**. Le prédicat exempte à dessein ce que la peinture refuse par construction : les murs (on ne noie pas une falaise), le hors-Racine (la rivière n'en sort jamais — R45) et les couloirs de seuil (`rampe` : la porte gagne).
- **A3** — AU MOINS DEUX GUÉS : ≥ 2 interruptions du cœur profond de ≥ 4 tuiles de long, chacune franchissable à pied (chemin marchable est↔ouest à travers la rivière au droit du gué).
- **A4** — LES GARDES DE WORLDGEN RESTENT VERTES : A2 (toute zone atteignable), A5 (seuils bouchés → île), A17 (≥ 17 emplacements de village aux Prés Bas). Ce sont les tests existants, relancés tels quels.
- **A5** — LE GRADIENT EST LOCAL : dans la bande [0, 40] tuiles de la frontière Cendrière (côté Racine), la part de `heath`+`burnt_forest` est ≥ 50 % ; au-delà de 70 tuiles, ≤ 5 %. Le dithering est réel : dans la bande [10, 30], aucune ligne de 32 tuiles d'un seul tenant du même terrain perpendiculaire au gradient.
- **A6** — LES SENTES RELIENT : depuis la bouche de chaque seuil de la Racine, en ne foulant QUE des tuiles `road` ou d'eau peu profonde, on atteint la bouche d'au moins un autre seuil (parcours BFS headless).
- **A7** — RIEN NE POUSSE LÀ OÙ ÇA ROULE : aucun nœud sur une tuile `road` ni `rampe`. Le Bois Noir contient ≥ 60 nœuds `tree` et **exactement 1** `old_tree` au stock `TEASER_STOCK`. La Combe contient ≥ 10 `champignon`.
- **A8** — LES CHARGES PAYENT : fouler la Tour de guet révèle tous les lieux du rayon (et aucun au-delà) ; fouler une Pierre levée révèle la pierre/cercle inconnue la plus proche et rien d'autre ; la première arrivée au Cercle écrit une ligne de chronique ; aucun des nouveaux lieux n'ajoute d'item à l'inventaire (lieux.md A9 étendu).
- **A9** — DÉTERMINISME : deux générations de la même seed rendent des cartes identiques au bit près (terrain, zones, seuils, nœuds) ; les contrats replay/events existants restent verts. Les nouveaux semis sont positionnels et salés (aucun tirage sur le PRNG partagé).
- **A10** — LES BORNES SE VOIENT (client, smoke) : à chaque bouche de seuil de la Racine, deux sprites de borne présents, percant la couche des houppiers ; bornes brisées sur un seuil de secours.

## Constantes (ordres de grandeur — calibrage en jouant)

Dans les modules worldgen (patron `EAU`/`CONTENU`), pas en dur :

| Constante | Valeur initiale | Note |
|---|---|---|
| `RIVIERE.DEMI_LARGEUR` | 3 | 7 tuiles de lit |
| `RIVIERE.DEMI_CŒUR` | 1 | 3 tuiles de profond |
| `SENTES.GUES_MIN` | 2 | forcés sur le cours (fractions étalées) si les croisements n'ont pas payé — le bouton vit avec les sentes, c'est le croisement qui crée le gué |
| `GRADIENT_SUD.LARGEUR` | 40 | tuiles depuis la frontière Cendrière |
| `SENTES.DEMI_LARGEUR` | 1 | 3 tuiles de large (le motif arrondit) |
| `SET_PIECES.ECART_MIN` | 200 | entre deux set-pieces |
| `POI.REVEAL_TOUR_TILES` | 240 | entre le Chêne (180) et le Belvédère (300) — mesurés dans `balance.ts` |

## Hors périmètre (et où ça revient)

- Le brouillard de guerre du TERRAIN (worldgen R19-R20) — chantier à part entière.
- Des rivières hors de la Racine (l'eau reste le marqueur de la zone basse — R45).
- Un effet des sentes sur les trajets des PNJ ou de la faune.
- La généralisation du gradient à d'autres frontières (R15 : exception unique, assumée).
- La DA cubique des nouveaux lieux : ils naissent PEINTS (le pilote cubique `poi-lit.ts` attend l'arbitrage d'Alexis sur l'erratique) — la bascule se fera avec tous les autres.
