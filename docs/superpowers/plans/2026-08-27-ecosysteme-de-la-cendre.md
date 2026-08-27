# L'écosystème de la cendre — dix pistes pour remplir le désert

> ⚠ **CHIFFRES ET STATUT RÉVISÉS LE 2026-08-27 (après-midi).** ① et ② **sont tranchées, livrées et
> journalisées** : elles s'appellent **R20** (la succession en quatre bandes, comptées en TUILES) et
> **R21** (le caractère de quatre fosses sur dix) — leur source de vérité est désormais
> `docs/specs/cendre.md` § « La succession et le caractère », pas ce document. Les sections ① et ②
> ci-dessous restent pour la TRACE du raisonnement ; **leurs nombres sont recopiés dans la spec, et
> c'est la spec qui fait foi.** **⑥ a suivi le même chemin** : sa prémisse a été mesurée FAUSSE
> (voir « Ce qui a été mesuré pour ⑥ »), et Alexis a tranché « hantise + cendre froide » — c'est
> **R22/R23**, livrées elles aussi. Restent ouvertes, non tranchées : ③④⑤⑦⑧⑨⑩.

*Handoff de session, 2026-08-27. Demande d'Alexis : « la zone de cendre est un énorme désert ;
j'aimerais que la cendre remplace l'écosystème présent avant PAR SON ÉCOSYSTÈME — une nouvelle zone
qui se déploie au fur et à mesure de la partie ».*

*Lire d'abord `docs/specs/cendre.md` (le mécanisme) et `docs/specs/cendreux.md` §5 (le champ des
morts, dont les charniers sont les pics). Ce document ne les remplace pas ; il se pose dessus.*

---

## Le constat — pourquoi c'est un désert, et c'est par construction

| ce que la cendre a aujourd'hui | où |
|---|---|
| trois terrains (cendre de pré, de bois, minérale) + le cœur qui recycle la Cendrière | `cendre.ts` R11/R11a |
| du clutter : chicots, fûts calcinés, poussière (bois 0,26 · pré 0,12 · minéral rien) | R11quater |
| des fumerolles : elles se voient, refroidissent, déposent du **sel**, ancrent la Brume | `fumerolle.ts` |
| les charniers, pics du champ des morts | `cendreux.md` R20 |
| des arbres en agonie, récoltables 5 jours (`AGONIE_JOURS`) avant de tomber | R13 |

Et rien d'autre. **Zéro faune** : aucun `habitat:` de `MONSTER_DEFS` ne cite un terrain cendré
(vérifié — six espèces : `boar`, `cendreux`, `rabbit`, `deer`, `wolf`, `tetras`). **Zéro flore** :
R15 interdit toute repousse *et* la dérive de nœuds (`relocateNode`). Le désert n'est pas un oubli,
c'est la lettre de la spec.

## Trois axes existent déjà, et personne ne les lit

C'est là-dessus que tout ce qui suit se branche — **sans un octet de `SimState`**.

- **`ancienneteDeCendre(map, tx, ty, ages, seed)`** → jours depuis que la tuile a été prise.
  Recalculée par dichotomie (R13 « n'a coûté aucun état »). **Aujourd'hui elle ne sert qu'à une
  teinte** (le brun du feu qui refroidit sur 30 j) et à `agonise`. C'est un axe de SUCCESSION
  inexploité — la réponse littérale à « une zone qui se déploie au fur et à mesure ».
- **`profondeurDeCendre`** → de combien le front a dépassé la tuile. Ne sert qu'à la bande
  frange (`FRANGE_TUILES` = 3) / cœur de R11a. Zonation gratuite.
- **`map.cendreFoyer[i]`** → quelle fosse revendique la tuile. **Les dix fosses sont
  interchangeables** : rien ne les distingue.

## Le gabarit à suivre — la fumerolle

Semis positionnel par `hash2` (maille + part) × un prédicat dérivé (`auCoeurDeLaCendre`) = un
contenu qui apparaît **au fil de la corruption**, sans passe de worldgen, sans état, sans
sérialisation. Toute proposition qui demande de l'état mutable par tuile (une flore qui pousse
vraiment, un champignon qui colonise) se bat contre l'architecture.

## La ligne qui sépare le bon du casse-design

Deux phrases des specs en place, à opposer à chaque idée :

> *« Le cœur devient traversable, pas habitable »* (`fumerolle.ts`)
>
> *« La cendre tire autant qu'elle pousse : la frange qui approche est une échéance à
> exploiter »* (R14)

**Toute générosité dans la cendre inverse R14 et retire la raison de fuir.** Chaque proposition
doit répondre : est-ce que ça fait de la cendre un endroit où l'on **VA**, ou un endroit où l'on
**VIT** ?

## Et le test du jour 1

R3 pose 229 tuiles de cendre à chaque fosse **dès le premier jour**, explicitement comme pédagogie.
R8 endort le front jusqu'au jour 91. R10 écarte les spawns de ~150 de coût (≈ jour 195). Un
écosystème qui n'existe qu'au cœur profond est **invisible pendant deux actes**. Chaque proposition
doit dire ce qu'elle montre dans la tache initiale, au jour 1, à petite échelle.

---

## Les dix propositions

*Classées : ① et ② d'abord (l'ossature et la variété, zéro système neuf), ⑥ pour que le danger
monte en même temps, ④ comme première récompense. ③⑤⑦⑧⑨⑩ sont les habitants — chacun tient tout
seul une fois le sol daté.*

### ① La succession — la cendre a des ÂGES, et tout le reste les lit ★ — ✅ LIVRÉE (R20), mais EN TUILES

*⚠ Tranchée autrement que proposée : la mesure a écarté l'âge au profit de la PROFONDEUR (un seuil
en jours donne un anneau qui maigrit jusqu'à 1 tuile sur la roche à l'an 3). Voir `cendre.md` R20.*

`ancienneteDeCendre` cesse d'être une teinte et devient l'ossature : **cendre vive** (chaude, nue,
fumante) → **cendre prise** (croûtée, les premières colonisatrices) → **vieille cendre** (la vraie
cendrière, sa faune, ses trouvailles). Les neuf autres propositions sont ses *habitants* ; sans
elle, elles se posent toutes en même temps sur un sol uniforme.

- **Dérive de** : `ancienneteDeCendre`, déjà là. Rien à ajouter.
- **Jour 1** : la tache initiale est *vive* — nue, chaude, hostile. La pédagogie de R3 gagne un
  visuel qui dit « ça vient de se passer ».
- **VA / VIT** : c'est l'axe qui permet de répondre différemment aux deux. Frais = on n'y va même
  pas. Vieux = on y va.
- **Nature** : une convention, pas un système. Se tranche sur planche rendue.

### ② Le caractère de foyer — les dix fosses ne rendent pas la même cendre — ✅ LIVRÉE (R21)

*Quatre fosses sur dix portent un caractère (la Salée, la Gueule, la Muette, la Docile), cinq
cadrans surchargés (`fumerolles`, `sel`, `morts`, `froid`, `gel`). Voir `cendre.md` R21.*

`hash2(indexFoyer, seed)` tire un caractère par fosse, au patron exact de `modificateur.ts`
(« il surcharge des cadrans, il n'invente rien ») : la Salée (fumerolles ×3), la Muette (peu de
morts, beaucoup de froid), la Vive (avance vite, rend du charbon), la Grise, la Creuse. Le sud de
la vallée cesse d'être le nord.

- **Dérive de** : `map.cendreFoyer[i]`, déjà statique. Zéro état.
- **Jour 1** : les dix taches initiales sont déjà différentes à l'œil — la variété n'attend pas.
- **VA** : on choisit *quelle* cendre on visite, et R16 (quel foyer je tiens ?) devient un vrai
  choix au lieu d'un choix géographique.
- **Piège** : un caractère module le COMBIEN, jamais le SI (la leçon de `cendreux.md` R16 et de la
  mémoire `geographie-module-jamais-autorise`).

### ③ Les colonisatrices — la flore propre à la cendre

Trois espèces, maigres, semées à la fumerolle : **fougère-de-feu** (fibre), **lichen cendré**
(potasse / teinture), **champignon de souche** (nourriture pauvre, sur les fûts calcinés).

- **Croise R15 frontalement** — la seule proposition qui demande d'en amender la lettre : « rien ne
  repousse » devient « **rien de l'ancien monde** ne repousse ; la cendre a sa propre flore ». La
  dérive de nœuds (`relocateNode`) reste interdite : c'est elle que R15 protégeait vraiment.
- **Dérive de** : hash positionnel × `estCendre` × âge ≥ seuil (①). Pas de croissance simulée.
- **Jour 1** : rien — elles demandent la cendre *prise*. Assumé : c'est la récompense de la durée.
- **VA, ne VIT pas** : le rendement doit rester sous le seuil de subsistance, sinon R14 s'inverse.

### ④ La charbonnière — les fûts calcinés deviennent une économie

Le clutter existe déjà. En faire des **nœuds de charbon de bois** : forge, feu long, conservation.
Prolongement direct de R14 (« la cendre tire »), mais *après* le passage du front.

- **Dérive de** : `TERRAIN_BURNT_FOREST` + âge. Le semis existe (`BIOME_CLUTTER`, bois 0,26).
- **Jour 1** : oui, si une tache initiale tombe sur un bois — verbe immédiat dès la 1ʳᵉ année.
- **VA** : la meilleure raison économique d'entrer. Épuisable et non renouvelable (R15 tient),
  donc chaque foyer est un gisement fini.

### ⑤ Le nécrophage — une bête qui SUIT la frange

Une espèce dont l'habitat n'est pas un terrain mais une **bande mobile** : `profondeurDeCendre ≤ 3`.
Elle mange ce que la cendre tue, donc elle avance avec elle. Le seul gibier de la cendre, jamais
au cœur.

- **Croise `habitat:`** — première espèce déclarée sur un prédicat plutôt qu'une liste de terrains.
- **Jour 1** : oui — la tache initiale a une frange dès le premier jour. La plus précoce avec ⑧.
- **VA** : la frange est déjà l'endroit où l'on travaille (R14). Une raison de plus, et un danger.
- **Landmines** : un `MonsterType` de plus décale le flux RNG seedé et rougit des tests sans
  rapport (mémoire `rng-fragile-au-decompte-entites` — isoler sur un chemin neuf) ; `MONSTER_DEFS`
  est un `Record` exhaustif, le compilateur énumérera tous les sites ; et l'atteignabilité de
  l'habitat se prouve dans le **monde joué**, pas dans une table (mémoire
  `garde-atteignabilite-au-runtime`).

### ⑥ Le cœur est déjà le territoire des morts — ✅ LIVRÉE (R22/R23), MAIS PAS GRATUITEMENT

*La prémisse était FAUSSE, mesurée : vue ×1,01, champ des morts ±1 %, et le souffle des fumerolles
ne couvre que 5 % du cœur. Alexis a tranché « hantise + cendre froide » (contre ma reco, plus
prudente) : **R22** refroidit la cendre en rampe (4 °C au cœur mûr), **R23** ré-arme la hantise sur
le même axe. Source de vérité : `cendre.md` § R22/R23. Détail de la mesure en fin de document.*

Aucun mécanisme neuf : les fumerolles émettent du **froid**, et l'éveil du Cendreux est
**thermique** (`CENDREUX.TORPEUR` : vue ≈ `aggroRange` × éveil(°C)). Le cœur est donc déjà, par les
lois en place, l'endroit où les morts voient le plus loin. On branche le champ des morts
(`cendreux.md` R15, dérivé) sur `estCendre` — il *module*, il n'autorise jamais (R16).

- **Dérive de** : rien de neuf. Deux systèmes existants qui ne se parlent pas.
- **Jour 1** : oui, faiblement — la tache initiale entoure un charnier, déjà pic du champ.
- **VA armé** : c'est ce qui empêche ③④⑩ de rendre la cendre confortable. À poser AVEC elles.

### ⑦ La fosse s'ouvre — le charnier devient un lieu visitable

À mesure que son foyer vieillit, le charnier se creuse en **lieu bâti** (plans `*.plan`, « tout en
pièces, partout ») : une fosse descendue, du butin réel, des morts denses. Le verbe R16 (y allumer
un feu de jour) gagne un décor à la hauteur de son enjeu.

- **Dérive de** : `state.cendreAge[foyer]` — le seul état existant. Le plan est statique.
- **Jour 1** : la fosse est là, fermée. Elle s'ouvre avec l'âge — une horloge à l'échelle de la
  partie.
- **VA** : le cœur cesse d'être une étendue et devient dix adresses.

### ⑧ Le vent de cendre — la zone déborde avant d'arriver

Sous le vent d'un foyer, une bande de **retombées** : visibilité réduite, dépôt gris sur la neige,
froid accru. La cendre annonce son arrivée bien avant sa frange ; le préavis de R14 devient
sensoriel au lieu d'être cartographique.

- **Dérive de** : direction du vent (déjà simulée, `vent.md`) × distance au foyer. Zéro état.
- **Jour 1** : **oui, et c'est son point fort** — visible à un écran des taches initiales, sans y
  entrer.
- **Ni VA ni VIT** : elle rend la *proximité* désagréable, ce qui pousse au déménagement que R14
  réclame.
- Primairement visuelle : planche rendue avant toute plomberie (mémoire
  `montrer-le-look-avant-de-batir`).

### ⑨ L'eau morte — les mares que la cendre encercle

R12 dit que l'eau ne brûle pas, et c'est juste. Mais une eau **cernée** de cendre devient
saumâtre : imbuvable, impêchable — et une source de **sel** par évaporation, en plus des
fumerolles. Le détour que la cendre fait autour des lacs (R4) cesse d'être une protection gratuite.

- **Dérive de** : part de cendre sur la couronne du plan d'eau. Zéro état.
- **VA chercher** : le sel double sa raison d'être.
- **Piège** : ne pas rendre la soif insoluble près de la cendre — un joueur qui campe la frange
  (R14 le veut) doit pouvoir boire.

### ⑩ Ce que la cendre rend — les trouvailles

Sous la **vieille** cendre, un semis de trouvailles : outils, os travaillés, la cache d'un village
que la vallée a enterré. Du butin archéologique, pas de la ressource répétable.

- **Dérive de** : hash positionnel × âge ≥ seuil haut. Gabarit fumerolle exact.
- **Jour 1** : rien. Contenu d'acte tardif — à n'adopter que si ① est en place, sinon il n'existe
  jamais.
- **VA** : la seule chose qui justifie de traverser tout le cœur.

---

---

## Ce qui a été MESURÉ le 2026-08-27, pour ① et ②

*Instrument : `tools/diag-cendre-succession.mts` (neuf). Vrai worldgen, `MONDE_JOUE`, personne ne
touche aux fosses. Le réveil est au jour 91 ; le monde ouvre au jour 61.*

### L'âge et la profondeur sont PRESQUE le même ordre — et ce qui les sépare est un fait de design

⚠ **À foyers SYNCHRONES la mesure ne prouve rien** : les deux quantités sont monotones dans
`coût/(1+grain)` par construction, la corrélation est garantie. Le monde JOUÉ les désynchronise
volontairement — c'est la raison d'être de `SimState.cendreAge` (R16 gèle un foyer 15 jours, R18 le
module par saison). On relève donc les deux régimes (paires tirées à intervalle fixe) :

| | j.240 | j.600 | j.1200 |
|---|---|---|---|
| foyers synchrones | 4,07 % | 2,98 % | 7,01 % |
| foyers **décalés** (0 → 180 j) | **11,54 %** | **7,54 %** | 7,37 % |

La discordance **double à triple** quand les foyers se désynchronisent, et reste basse en absolu.
Deux conclusions :

1. **`ancienneteDeCendre` n'est pas un axe NEUF** — c'est `profondeurDeCendre` sur une autre
   échelle, à ~90 % près. Ce qui change entre les deux est l'ÉTIREMENT, et c'est là que se joue la
   décision de ①.
2. **Ce qui les sépare est le verbe du joueur.** Un foyer qu'on TIENT (R16) continue de vieillir sa
   cendre pendant que son front est immobile : la cendre contenue **mûrit sans s'étendre**. C'est
   soit une belle récompense (le foyer qu'on maîtrise devient le plus riche), soit un artefact
   déroutant. Décision à poser si ① part sur l'âge.

### Un seuil en JOURS donne un anneau qui MAIGRIT (largeur en tuiles au front, sol vivant)

| jour | vitesse (t/j) | 5 j | 15 j | 30 j | 90 j | 360 j |
|---|---|---|---|---|---|---|
| 92 (réveil) | 1,500 | 1,5 | 1,5 | 1,5 | 1,5 | 1,5 |
| 120 | 0,634 | 3,3 | 16,1 | 37,1 | 37,1 | 37,1 |
| 240 | 0,282 | 1,4 | 4,3 | **8,9** | 31,2 | 84,0 |
| 600 | 0,153 | 0,8 | 2,3 | **4,6** | 14,4 | 71,3 |
| 1200 | 0,103 | 0,5 | 1,6 | **3,1** | 9,5 | 40,9 |

⚠ **Sur la roche, diviser par `COUT_MINERAL` = 3.** Une bande « 30 jours » vaut donc **1 tuile** sur
un massif à l'an 3. Une bande « 5 jours » est **sous la tuile** dès le jour 600 partout.

### Des bandes en PROFONDEUR ont une largeur stable — et se déploient au fil de la partie

Seuils d'essai 3 / 15 / 40 tuiles (le 3 est `CENDRE.FRANGE_TUILES`, déjà en place) :

| jour | avancée | frange ≤3 | 3–15 | 15–40 | > 40 | âge médian du > 40 |
|---|---|---|---|---|---|---|
| **61** (ouverture) | 10,0 | 51,2 % | 48,8 % | 0 % | 0 % | — |
| 92 (réveil) | 11,5 | 45,9 % | 54,1 % | 0 % | 0 % | — |
| 120 | 47,1 | 12,2 % | 40,8 % | 44,2 % | 2,8 % | 29 j |
| 240 | 94,0 | 6,1 % | 22,7 % | 36,9 % | 34,3 % | 130 j |
| 360 | 122,9 | 3,7 % | 15,4 % | 31,1 % | 49,7 % | 217 j |
| 600 | 165,3 | 2,5 % | 9,6 % | 20,8 % | 67,1 % | 373 j |
| 1200 | 239,3 | 1,1 % | 4,7 % | 10,3 % | **84,0 %** | 776 j |

Lecture : **deux bandes au jour 1**, les quatre dès le **jour ~115**, et le stade mûr passe de 3 %
à 84 % sur la partie. C'est littéralement *« une nouvelle zone qui se déploie au fur et à mesure »*.

### Les dix fosses se partagent la cendre (proposition ②)

Part de la cendre revendiquée par chaque foyer (`map.cendreFoyer`), quatre graines :

| graine | j.240 (min → max) | j.1200 (min → max) |
|---|---|---|
| 2026 (10 foyers) | 7,4 % → 11,0 % | 7,4 % → 16,1 % |
| 7 (9 foyers) | 4,7 % → 13,4 % | 5,5 % → 16,9 % |
| 42 (10 foyers) | 6,7 % → 12,0 % | 4,3 % → 13,6 % |
| 1789 (10 foyers) | 6,4 % → 12,9 % | 6,0 % → 15,9 % |

**Aucun foyer n'avale les autres** : le plus gros pèse 11 à 17 %, le plus petit 4 à 7 %. Un
caractère par fosse touche donc une part réelle de la carte, et il y en a dix à différencier.

---

## Ce qui a été MESURÉ pour ⑥ — et sa prémisse est FAUSSE

*Instrument : `tools/diag-cendre-eveil.mts` (neuf). Vrai worldgen, `MONDE_JOUE`, seed 2026, pas de
6 tuiles. Le montage IMPRIME son heure et sa part de nuit — une nuit d'été sature l'éveil à 0
partout et ne dirait rien (mémoire `cadran-temperature-cendreux`).*

⑥ affirmait qu'aucun mécanisme n'était à écrire : les fumerolles soufflent du froid, l'éveil du
Cendreux est thermique, **donc le cœur serait déjà l'endroit où les morts voient le plus loin**.
C'est une affirmation empirique. Elle ne tient pas.

| relevé (nuit du jour de saison 10, la plus froide) | frange | nue | croûte | vieille | HORS cendre |
|---|---|---|---|---|---|
| vue d'un Cendreux (tuiles) | 2,55 | 2,54 | 2,54 | 2,55 | **2,52** |
| champ des morts | 0,2481 | 0,2490 | 0,2504 | 0,2526 | **0,2501** |
| tuiles sous le souffle d'une bouche | 1,5 % | 3,6 % | 4,1 % | 4,8 % | 0 % |

**Trois faits, et ils décident :**

1. **Les trois terrains cendrés ont un `BIOME_OFFSET` de ZÉRO** — la cendre n'est ni chaude ni
   froide. L'écart de vue entre le cœur et le reste de la vallée vaut **×1,007 à ×1,017**, du bruit.
2. **Le champ des morts ne connaît pas la cendre** : 0,248 → 0,253 contre 0,250 dehors, soit **±1 %**.
   La hantise a été RETIRÉE avec le front le 2026-08-24, et ses trois constantes sont orphelines —
   `MORTS.PART_CENDRE` (0,35), `HANTISE_MAX` (0,60), `HANTISE_PART` (0,35), *« à reprendre avec la
   nouvelle mécanique »*. Seul le caractère R21 déplace ce chiffre (Gueule ×1,58, Muette ×0,52).
3. **Les fumerolles, elles, MORDENT — mais sur 5 % du cœur.** Sous un souffle : vue **×1,12** un
   midi de printemps, **×1,34** une nuit froide. La couverture tombe de la géométrie
   (`MAILLE` 48, `RAYON` 7, `PART` 0,80 → π·49·0,8/48² = 5,3 %) et vaut **0 % dans la frange**
   (`auCoeurDeLaCendre` exige profondeur > 3). Et dans la moitié CHAUDE de la saison (nuit du
   jour 40, 16,5 °C), même sous un souffle l'éveil vaut **0** : rien ne se lève nulle part.

**Conséquence : ⑥ n'est pas gratuite, c'est une vraie décision** — « ré-arme-t-on la hantise sur les
bandes de R20, et jusqu'où ? ». Le hasard fait bien les choses : la loi orpheline était déjà écrite
en **part de la course du front**, c'est-à-dire en profondeur — exactement l'axe de R20.

### Ce que ⑥ rendrait, projeté sur la carte de production

Rampe `PART_CENDRE` (0,35) → `HANTISE_MAX` (0,60), plafonnée à l'entrée de la bande vieille
(`CROUTE_TUILES` = 40 t — un seul ancrage au lieu des deux d'avant, et `HANTISE_PART` devient
inutile) :

| champ des morts | frange | nue | croûte | vieille | HORS cendre |
|---|---|---|---|---|---|
| aujourd'hui | 0,2481 | 0,2490 | 0,2504 | 0,2526 | 0,2501 |
| ⑥ ré-armée | **0,6079** | **0,6556** | **0,7684** | **0,8526** | 0,2501 (intact) |
| tuiles saturées à 1 | 0 % | 0 % | 0,1 % | **9,8 %** | 0 % |

La saturation à 1 dans la vieille cendre est **exactement ce que la constante promettait** :
*« combiné au tier 2 de la Cendrière, le champ sature à 1 au cœur du vieux brûlé — le pire sol de
la vallée, et il se sent comme tel »*. Elle ne touche pas un pixel hors cendre.

---

## Reprise

**①, ② et ⑥ sont livrées** — R20/R21 (l'ossature et la variété) puis R22/R23 (le froid et la
hantise). Spec `cendre.md`, 32 gardes dans `cendre-succession.test.ts`, deux entrées au journal du
2026-08-27. **③④⑤⑦⑧⑨⑩ restent au catalogue, non tranchées.**

**La prochaine question à poser est ④ — la charbonnière** : ⑥ vient d'armer le danger, et R14 exige
que la cendre TIRE autant qu'elle pousse. Aujourd'hui la cendre mûre est le pire sol de la vallée
et ne rend toujours rien.

**La conséquence de neige a été tranchée** : le froid déplace la ligne pluie/neige et le manteau
est un pavé OPAQUE, donc à 4 °C **88 % de la vieille cendre disparaissait sous du blanc** la moitié
de la saison. Alexis a posé `FROID_COEUR` à **2** (mesuré : 4 → 88,1 % · 3 → 79,7 % · **2 →
18,5 %** · 1 → 5,5 %, contre 1,5 % hors cendre). La cendre reste le seul endroit où il neige plus
qu'ailleurs, et la morsure tient : sur la nuit la plus froide, la vieille cendre met encore 81,3 %
de ses tuiles sous la ligne d'hypothermie pour un corps nu (99,2 % à 4 °C, 5,2 % sans R22).

⚠ **Rien de tout cela n'est COMMITÉ** : l'arbre porte un très gros chantier parallèle (88 fichiers
de `/sim` modifiés) et une garde rouge qui ne vient pas de la cendre — `carte-immuable` A3, « un
landmark tombe dans le carré » : fonder un village est refusé parce qu'une zone `kind` tombe dans
l'emprise. À regarder du côté du chantier affleurements/buttes avant tout commit.

Instruments : `tools/diag-cendre-succession.mts` (l'âge, la profondeur, la part par foyer),
`tools/diag-cendre-eveil.mts` (l'éveil, la vue, le champ des morts et la survie d'un corps nu par
bande — ⑥), `tools/diag-cendre-neige.mts` (ce que R22 met sous la neige, par palier de froid),
`tools/diag-foyer-caractere.mts` (les cadrans de R21 sur la carte de production),
`tools/diag-cendre.mts` (la courbe d'avancée et ce qu'elle prend, `--compare A,plafond`),
`tools/diag-fumerolle.mts`, `tools/diag-frange.mts`.
