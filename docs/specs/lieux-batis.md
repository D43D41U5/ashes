# Les lieux bâtis — étage 1 : les POI humains creux deviennent des constructions

*Spec du 2026-08-10. Périmètre validé par Alexis (« go ») après audit de l'état réel.
Étend le patron livré par `poi-batis.ts` (commit 29d0cae : « la Ferme ruinée EST ses murs »)
aux sept POI humains qui ne sont encore que des sprites traversants.*

## Le constat (audit du 2026-08-10)

Sur 36 types de POI, seuls `ferme_ruinee` et `cabane` ont un corps réel. Les sept types
humains suivants sont des sprites sans collision, sans fouille, sans sort : **ruines, abri,
mine, oratoire, bivouac, charrette, epave**. Aucun POI ne bloque par lui-même
(`collision.ts` ignore `map.zones`) : on marche à travers les Ruines comme à travers l'Épave.

## Le périmètre — et ce qui est DIFFÉRÉ

**Étage 1 (cette spec)** : corps en structures + sort brûlé/pillé/intact + fouille `rubble`,
pour les sept types ci-dessus. Plus les deux dettes qu'il faut payer avant de monter en
volume : la parité d'amorce (LAN/banc) et la mesure perf client.

**Différé, chaque point étant une décision d'Alexis à part** :
- le corps solide des POI *naturels* (erratique, arche, sanctuaire… — S-R13 les garde au
  semis neutre, et leur grammaire actée est le sprite/terrain) ;
- les coffres garnis, les dangers attachés aux ruines, tout « lieu qui donne » (lieux.md A9
  reste la loi : la fouille passe par des NŒUDS, jamais par le lieu) ;
- le démontage des ruines par le joueur (rouvrirait la décision du 2026-08-01 « le marteau
  défait ce qu'il a fait ») ;
- l'effet d'abri (`isSheltered`) sur les nouveaux lieux couverts — à VÉRIFIER et rapporter
  (si le toit abrite déjà, c'est dérivé et gratuit ; sinon, question de design à poser).

## Le contrat

### Pièces nouvelles (registre `pieces.ts` — commitées avec cette spec)

| pièce | fam | pose | bloque | pv | usage |
|---|---|---|---|---|---|
| `charrette` | vestige | monde | oui | 80 | la Charrette abandonnée, l'Épave |
| `autel` | mobilier | monde | oui | 250 | l'Oratoire |

`pose: 'monde'` = naturelle, non reproductible : aucune recette, aucune route joueur.
C'est le régime existant (D1) — rien d'autre à inventer.

### Légende étendue (`poi-batis.ts`)

Les plans des petits lieux posent des pièces **hors région** (pas de salle, pas de murs
dérivés — le précédent est `x`/friche). Caractères à ajouter, au choix de l'implémentation,
documentés dans `LEGENDE` : charrette, autel, mur_bas, poutre hors salle, âtre hors salle,
paillasse hors salle, tonneau hors salle, nœud `rubble` hors cour.

### Empreintes (`POI_TYPES`) — élargies, sous garde de recensement

Les empreintes actuelles (2-4) sont dimensionnées pour des sprites. Proposition de départ :
ruines 4→6, abri 2→4, mine 3→5, oratoire 2→3, bivouac 2→3, charrette 2→3, epave 2→4.
Réglage worldgen = se calibre EN REGARDANT LA CARTE : le recensement multi-seeds tranche,
pas le goût. Si un type cesse de naître (A19) ou s'effondre en effectif, on resserre.

### Les sept plans — intentions

| kind | intention | pièces pressenties |
|---|---|---|
| `ruines` | pans de murs très usés (usure ≈ 0,25), deux brèches, à ciel ouvert | salle + brèches, poutre, mur_bas, rubble ×2 |
| `abri` | un couvert minéral adossé, ouvert au sud | salle 2×2 couverte, brèches côté ouvert, paillasse |
| `mine` | l'entrée condamnée — le carreau de mine, pas le souterrain (différé) | petite salle pierre, seuil, poutres, rubble ×3 (la fouille la plus riche) |
| `oratoire` | l'édicule alpin : la pierre dressée et son enclos ruiné | autel, mur_bas, rubble ×1 |
| `bivouac` | le feu froid de ceux qui sont partis | âtre, paillasse, tonneau, rubble ×1 |
| `charrette` | échouée sur le bord du chemin | charrette, tonneau, rubble ×1 |
| `epave` | le convoi pris par l'avalanche (aiguilles/glacier) | charrette, poutres, rubble ×2 |

Orientation : `tourne` par défaut (seule la ferme est `fixe`, décision 2026-07-27).
Toponymes : `NOMS_PAR_SORT` étendu là où le sort a un sens (la charrette née près d'une
sente sera presque toujours « pillée » — c'est voulu, c'est la règle de lecture S-R17).

## Critères d'acceptation

- **A1** — chaque kind du périmètre a un `Plan` validé par `verifierPlans` ; côté = empreinte `POI_TYPES`.
- **A2** — collision : la garde de traversabilité (flood-fill dedans↔dehors) passe sur TOUS les plans ; garde exhaustive de non-pénétration (patron `wall-solid`) sur au moins un plan muré neuf.
- **A3** — fouille : chaque plan sème ≥ 1 nœud `rubble` ; stock modulé par le sort (S-R18, plancher 1) ; A9 intact — le lieu ne DONNE rien, l'inventaire ne change qu'en fouillant.
- **A4** — sort + toponyme + annales : `sortDuLieu` s'applique aux sept ; `nomSelonSort` couvre les kinds déclarés ; annales ere 1/ere 3 écrites (dérivé de `BUILT_KINDS`, automatique).
- **A5** — parité d'amorce : le serveur LAN (`createZone`) et le banc (`scenario.ts`) appellent `buildPoiStructures` comme la Veillée — même seed, même ordre. Un monde LAN porte les mêmes murs qu'un monde solo.
- **A6** — déterminisme : double génération identique sur TOUS les plans ; aucun tirage sur le PRNG partagé dans `poi-batis` (hash positionnel seulement).
- **A7** — recensement : sur ≥ 4 seeds, chaque type du périmètre naît (A19) et les effectifs avant/après élargissement d'empreinte sont rapportés MESURÉS.
- **A8** — rendu : `charrette` et `autel` ont leur art `bati-art` (albédo + `_lit`) ; aucun sprite-corps ne double un `BUILT_KIND` (dérivé, automatique).
- **A9** — perf : coût client (syncStructures, clone snapshot) MESURÉ au décompte projeté (~1 000-1 500 structures), pire seconde et pas moyenne ; le pooling/culling (patron des nœuds) ne s'implémente QUE si la mesure le justifie.
- **A10** — le banc avant/après (≥ 3 seeds) : deltas rapportés, famine jugée au seuil absolu.

## Étage 2 — le vocabulaire naturel (décision d'Alexis, 2026-08-10 ; **RÉVISÉ le
2026-08-11 : la paroi d'arête meurt, le MASSIF naît**)

La grammaire des plans gagne le MINÉRAL et le VÉGÉTAL — pour que les ébauches de lieux
naturels (grotte, carrière…) aient autre chose que de la maçonnerie. Le souterrain reste
différé : l'`antre` est une poche À CIEL OUVERT (pas de toit).

**Révision du 2026-08-11 (directive d'Alexis : « il faut que ça respire — de vraies parois
rocheuses, épaisses et non traversables sur au moins une tuile complète, il faut qu'on y
croie »).** La `paroi` — barrière d'ARÊTE au patron du mur, hauteur `MUR_HT` — est RETIRÉE :
un antre n'est pas un bâtiment. Sa clôture est désormais le **`massif`** : une pièce
PLEINE-TUILE **incassable**, PEINTE dans la grille (`H`), épaisse d'au moins une tuile.
Alexis a tranché « pièce structure pleine tuile mais incassable » contre l'option
terrain-falaise stampé.

### Le contrat

| pièce | nature | pose | bloque | usage |
|---|---|---|---|---|
| `roc` | sol (molle) | monde | non | le plancher de pierre nue d'un antre |
| `massif` | plein-tuile **INCASSABLE** | monde | oui | la roche en masse — l'épaisseur qui clôt un antre |
| `rocher` | plein-tuile | monde | oui | le bloc erratique de poche — on le contourne |
| `eboulis` | plein-tuile basse | monde | enjambe | les pierres croulées — on passe par-dessus |

**Région `antre`** : sol `roc`, et PLUS AUCUN contour dérivé (`CLOTURE_DE` ne connaît plus
l'antre). La clôture se PEINT en `massif`, et une **garde de clôture** l'exige : toute arête
du pourtour d'un antre donne sur une tuile `massif` (ou une autre tuile d'antre) ou porte un
`passage` explicite — sinon faute de plan. Brèches et seuils n'ont pas de sens sur un antre
(faute : la roche ne s'écroule pas en pan et ne porte pas d'encadrement). **Végétal = NŒUDS
réels** (jamais du décor) : la légende gagne `Y` (nœud `tree`) et `B` (nœud `berry_bush`),
semés par le plan et modulés par le sort (le patron des gravats). Légende : `r` roc/antre,
`H` massif, `R` rocher, `e` éboulis. (`#` est INTERDIT comme caractère de grille — il ouvre
un commentaire `.plan`.)

**L'incassable est du MONDE au sens fort** — la même loi que la falaise, portée par une
structure : `applyStructureDamage` est inerte sur lui ; le siège ne le désigne JAMAIS comme
cible (un monstre bloqué re-route au lieu de mâcher) ; le flow field le contourne comme il
contourne le terrain 23 ; et la joignabilité des spawns de morts le DISQUALIFIE comme la
roche (« la roche disqualifie, le mur non » — le massif est roche, pas mur). Un seul helper
(« solides éternels », dérivé des pièces `incassable` posées à l'amorce) nourrit ces trois
lectures — jamais trois listes.

### Critères d'acceptation

- **N1** — les quatre pièces au registre (`pieces.ts`), `StructureType` suit (dérivé) ; le
  massif porte `incassable` au registre et n'est PAS dans `BARRIER_TYPES` (qui dérive de
  `pose: 'marteau'` — la roche ne se bâtit ni ne se démolit) ; collision et navigation
  passent par le registre (`bloque`), zéro liste nouvelle.
- **N2** — la région `antre` : `verifierPlans` la traite comme les autres (bord interdit,
  triplets côté région) PLUS la garde de clôture (chaque arête du pourtour : massif, antre
  ou passage — exhaustive, jamais des cas choisis) ; `batirLieu` pose `roc` et ne dérive
  plus RIEN ; PAS de toit sur antre.
- **N3** — l'art : le `massif` emprunte l'ART DE LA FALAISE (autotuilage par masque de
  voisinage qui lit massifs + terrain 23 + hors-carte — la roche du plan se raccorde à la
  roche du monde) ; `st-roc` au sol ; `rocher`/`eboulis` en chips `_lit` (la recette
  cubique). La famille `st-paroi-e<masque>`, son empreinte `COUPE_DE` et sa branche de coupe
  sont RETIRÉES. Les gardes de couverture d'art restantes restent vertes.
- **N4** — le rendu : `snapshot-view` pose le massif à PROFONDEUR PLATE (le patron falaise :
  sous les acteurs, l'intérieur de la poche reste visible — « ça respire ») ; `roc` reste un
  sol (FLOOR_DEPTH) ; pans et nappe ne connaissent plus la paroi — aucun fondu n'est
  nécessaire puisque rien n'occlut.
- **N5** — déterminisme : aucun tirage neuf ; double génération identique ; parité d'amorce
  intacte ; les « solides éternels » dérivent des seules structures d'amorce (un état qui ne
  bouge jamais), jamais d'un recalcul en cours de partie.
- **N6** — le picker par THÈMES (éditorial) : Construction, Minéraux, Végétaux, Stations &
  mobilier — table char→thème explicite dans l'Atelier, GARDÉE par un test de couverture
  (tout caractère de légende a un thème ET une aide) ; les raccourcis suivent l'ordre lu.
- **N7** — un plan d'essai (brouillon) mêlant antre, rochers, éboulis et nœuds végétaux se
  bâtit, se valide, se rend — capturé au smoke.

## Étage 3 — tout en pièces, partout (décision d'Alexis, 2026-08-10, RÉVISÉE le soir même)

**L'histoire tient en deux temps.** L'après-midi : « transforme tous les sprites de POI en
structures posables » — 24 pièces `art: 'poi'` (le sprite du lieu comme corps, couronne
portée, massif qui s'efface comme un toit) ont été construites et la Grotte promue ainsi.
Le soir, Alexis tranche autrement en voyant le résultat : **« retire le corps sprite — il
faut que la mine soit construite de A à Z avec des éléments, comme un bâtiment »**, et au
choix des trois périmètres proposés : **tout en pièces, partout**. Les pièces-sprites sont
RETIRÉES ; un lieu naturel se COMPOSE, avec le vocabulaire des pièces — c'est la ligne
« le monde n'est pas décoré, il est construit » poussée à son terme.

### Le contrat

- **Plus aucune pièce `art: 'poi'`** : le champ, la projection `POI_BODY_TYPES`, le rendu
  poi-* des structures, les couronnes de structures et l'effacement de massif sont retirés.
  Le grand art poi-* reste ce qu'il était avant : le corps PEINT des lieux sans plan
  (poi-layer), qui tombe kind par kind à mesure que les plans arrivent (`BUILT_KINDS`).
- **Le VOCABULAIRE MINIER** ouvre le programme (la mine d'abord) : `chevalement` (D — la
  tour du puits, 40 px, bloque), `galerie` (n — la bouche boisée, MOLLE : un porche à poser
  devant le passage d'un antre), `etai` (I — le boisage, s'enjambe), `wagonnet` (w — la
  berline, bloque). Du bois d'œuvre : usurable, et le feu le prend (hors `SURVIT_AU_FEU`).
- **La MINE est le premier lieu composé de A à Z** : antre ceint de MASSIF (révision du
  2026-08-11 — plan 7×7, empreinte `POI_TYPES` 5→7, l'anneau d'une tuile pleine + un antre
  qui respire ne tiennent pas en 5×5 avec la cour), bouche boisée sur le passage,
  chevalement, étai, wagonnet, poutre — et ses TROIS tas de gravats (la fouille la plus
  riche, garde existante). **La GROTTE suit le même régime** : son plan est son antre ceint
  de massif (7×7, gueule = passage nu, éboulis au seuil) — plus de sprite.
- **La gueule s'ORIENTE** (révision du 2026-08-11) : le quart de tour d'un lieu à antre
  n'est plus le seul `hash2` — il tourne le PASSAGE vers l'entrée percée au placement
  (dérivé du terrain figé, `hash2` en départage d'égalité). Sous roche incassable, une
  gueule tournée vers un côté scellé n'est pas un défaut de lecture, c'est une poche morte
  (le problème du 2026-07-13) — l'orientation devient une contrainte de correction.
- **Entrable = les règles normales du marteau** : porte sur le passage, mobilier sur le roc
  — rien de spécial, c'était le but (« dans les limites de construction de POI »).
- **Les lieux suivants** (erratique, arche, cairn…) se composeront au même régime, chacun
  avec les pièces qu'il exige — chantier d'art au long cours, lieu par lieu, dans l'Atelier.

### Critères d'acceptation

- **C1** — plus aucune référence `art: 'poi'`/`POI_BODY_TYPES` dans /sim ni le client ;
  les caractères de légende retirés ne valident plus (faute « caractère inconnu »).
- **C2** — les quatre pièces minières au registre, leurs `_lit` dérivées (bati-art), leurs
  caractères en légende avec thème ET aide (garde N6).
- **C3** — la mine se bâtit : antre joignable par la gueule, trois `rubble`, déterminisme
  double-génération — et se JUGE à l'œil (capture smoke).
- **C4** — la grotte composée : antre joignable, ceinture de massif, entrée praticable.
- **C5** — le probe N7 du smoke peint galerie/chevalement/wagonnet ET l'anneau de massif
  (garde de clôture oblige) et valide à zéro faute.
- **C6** — le siège respecte la roche (2026-08-11) : un monstre dont le gradient traverse
  l'antre ne frappe JAMAIS un `massif` (testé : dégâts inertes, cible jamais désignée) et
  re-route par la gueule ; la garde de non-pénétration (`wall-solid`) balaie mine et grotte.
- **C7** — recensement A7/A19 re-mesuré (≥ 4 seeds) après le passage des empreintes à 7 :
  mine et grotte naissent partout, effectifs rapportés MESURÉS ; s'ils s'effondrent, on
  resserre (la loi écrite de l'élargissement).
