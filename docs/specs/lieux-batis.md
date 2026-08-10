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

## Étage 2 — le vocabulaire naturel (décision d'Alexis, 2026-08-10)

La grammaire des plans gagne le MINÉRAL et le VÉGÉTAL — pour que les ébauches de lieux
naturels (grotte, carrière…) aient autre chose que de la maçonnerie. Le souterrain reste
différé : l'`antre` est une poche À CIEL OUVERT (pas de toit).

### Le contrat

| pièce | nature | pose | bloque | usage |
|---|---|---|---|---|
| `roc` | sol (molle) | monde | non | le plancher de pierre nue d'un antre |
| `paroi` | barrière d'ARÊTE | monde | oui | la roche dressée — dérivée du pourtour de l'antre, hauteur `MUR_HT` |
| `rocher` | plein-tuile | monde | oui | le bloc erratique de poche — on le contourne |
| `eboulis` | plein-tuile basse | monde | enjambe | les pierres croulées — on passe par-dessus |

**Région neuve `antre`** : sol `roc`, contour `paroi` (le patron `CLOTURE_DE`) — brèches,
seuils et passages du contour valent comme pour la salle. **Végétal = NŒUDS réels** (jamais
du décor) : la légende gagne `Y` (nœud `tree`) et `B` (nœud `berry_bush`), semés par le
plan et modulés par le sort (le patron des gravats). Légende : `r` roc/antre, `R` rocher,
`e` éboulis. (`#` est INTERDIT comme caractère de grille — il ouvre un commentaire `.plan`.)

### Critères d'acceptation

- **N1** — les quatre pièces au registre (`pieces.ts`), `StructureType` suit (dérivé) ; la
  paroi est une barrière d'arête au rendu (`FAMILLES_BARRIERE`) mais PAS dans `BARRIER_TYPES`,
  qui dérive de `pose: 'marteau'` (le menu de construction — la paroi ne se bâtit pas) ;
  collision et navigation passent par le registre
  (`bloque`), zéro liste nouvelle.
- **N2** — la région `antre` : `verifierPlans` la traite comme les autres (bord interdit,
  triplets côté région) ; `batirLieu` pose `roc` + dérive `paroi` ; PAS de toit sur antre.
- **N3** — l'art : `st-paroi-e<masque>` par le MÊME moteur de barrières (tons roche),
  empreinte de coupe au tableau `COUPE_DE`, ancrages `EDGE_ORIGIN_Y`/`EDGE_SPRITE` ;
  `st-roc` au sol ; `rocher`/`eboulis` en chips `_lit` (la recette cubique). Les gardes de
  couverture d'art existantes restent vertes.
- **N4** — le rendu : `snapshot-view` traite la paroi comme une barrière d'arête (branche,
  fam, teinte presque blanche comme la clôture) et `roc` comme un sol (FLOOR_DEPTH) — pans
  et nappe suivent sans cas nouveau.
- **N5** — déterminisme : aucun tirage neuf ; double génération identique ; parité d'amorce
  intacte ; le généré ne bouge pas tant qu'aucun plan n'emploie le vocabulaire neuf.
- **N6** — le picker par THÈMES (éditorial) : Construction, Minéraux, Végétaux, Stations &
  mobilier — table char→thème explicite dans l'Atelier, GARDÉE par un test de couverture
  (tout caractère de légende a un thème ET une aide) ; les raccourcis suivent l'ordre lu.
- **N7** — un plan d'essai (brouillon) mêlant antre, rochers, éboulis et nœuds végétaux se
  bâtit, se valide, se rend — capturé au smoke.

## Étage 3 — les corps de lieux (décision d'Alexis, 2026-08-10)

« Transforme tous les sprites de POI en structures posables comme les autres structures. »
C'est la décision différée « corps solide des POI naturels » (S-R13) qui s'ouvre — et elle
s'ouvre par la CAPACITÉ, pas par le monde : chaque sprite-corps devient une pièce du registre
(`art: 'poi'`), posable dans les `.plan` par un caractère de légende. Le monde, lui, ne bouge
pas tant qu'aucun plan n'emploie ces caractères (le registre et la légende sont inertes —
`buildPoiStructures` ne bâtit que `PLANS[kind]`, et `poi-batis` ne tire rien sur le PRNG).

### Le contrat

- **24 pièces** (les kinds de `POI_ART` moins `BUILT_KINDS` moins les set-pieces), toutes
  `pose: 'monde'`, `occupe: 'tuile'`, `usurable: false` — la nature ne s'use pas à l'échelle
  d'une saison. `StructureType` suit (dérivé), `POI_BODY_TYPES` est la projection exportée.
- **Solidité PAR NATURE** (décision d'Alexis) : les masses debout bloquent leur ancre
  (grotte, erratique, arche, pierre levée, tour de guet, belvédère, sanctuaire, chêne,
  arbre, cairn, filon, carrière, cascade, pétroglyphes, source chaude, repaire) ; les traces
  au sol s'enjambent (saline, tarn, fondrière, charnier, gisement, tanière, crevasses,
  verger). L'ANCRE occupe UNE tuile : le sprite déborde et le débord se traverse — la masse
  au-delà se complète aux rochers/parois du plan (précédent : la charrette).
- **L'art reste le sprite du lieu** : la clé de naissance est `poi-<slug>` (poi-art), la
  nuit `poi-<slug>_lit` (poi-lit ; l'erratique tire une de ses trois variantes par sa
  position), la partie haute est portée en COURONNE (bande houppier — sans elle un sprite
  de plus de ~44 px se fait recouvrir par les cimes voisines et les toits). Jamais de
  redessin `st-<slug>` dans bati-art — gardé par test.
- **Le feu** : le minéral, la terre et l'eau survivent (`SURVIT_AU_FEU`) ; brûlent le bois
  vif (verger, chêne, arbre) et la hutte de peaux (repaire).
- **La légende** : un caractère par pièce, mnémonique français, jamais `#`, jamais les
  minuscules `s`/`i` (garde d'épellation), un seul code-unit UTF-16.
- **L'Atelier** : thème « Terres & eaux » ajouté au picker ; vignettes par les albédos
  poi-lit extraits en canvas pur (`albedosPoiAtelier`) ; le fantôme montre `poi-<slug>` ;
  l'ébauche d'un lieu naturel PRÉ-POSE son caractère-corps au centre — la promotion ne
  change plus la silhouette.

### Critères d'acceptation

- **C1** — chaque pièce `art: 'poi'` a exactement UN caractère de légende et désigne un
  lieu de `POI_TYPES` (garde sim) ; elle a son sprite `POI_ART`, sa `_lit`, et sa couronne
  alignée art↔lit (garde client).
- **C2** — aucun corps de lieu dans `BATI_KEYS` ni `BATI_LIT_TYPES` (le grand art, pas un
  chip 16 px) — gardé.
- **C3** — le registre seul est INERTE : mêmes cartes, même flux RNG, mêmes événements
  tant qu'aucun plan n'emploie les caractères (les suites seedées passent inchangées).
- **C4** — un brouillon mêlant corps de lieux et vocabulaire naturel se valide, se bâtit,
  se rend — capturé au smoke (probe N7 étendu).
- **C5** — au premier PLAN promu employant un corps : recensement A7 et passe de tests
  complète (le monde change à ce moment-là, pas avant).
