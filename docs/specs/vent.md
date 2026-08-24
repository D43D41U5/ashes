# LE VENT — spec

> **Décision fondatrice (2026-08-24, Alexis) : « le front est le vent, unifie ».** Le jeu portait
> **deux** vents qui ne se connaissaient pas — `state.wind` (8 relèvements qui SAUTENT toutes les
> 5 min, norme 1, sans force, un seul lecteur : l'odorat C17) et le **front météo** (une bande
> cardinale qui traverse la vallée en une demi-journée). Le même fait physique, modélisé deux
> fois : un front de pluie pouvait entrer par le nord pendant que les herbes se couchaient vers
> l'est. Cette spec les fond en **un seul vent, dérivé**.

## Le principe

**Le vent ne se pose pas, il se dérive.** Il n'y a plus de vent « à part » : il y a un front qui
marche, et le vent EST sa marche. Entre deux fronts, un vent d'ambiance tient le monde en vie.

Trois propriétés non négociables, chacune héritée d'un invariant existant :

1. **Pur À FRONT DONNÉ, et sans mémoire.** La loi ne garde aucun état propre : elle se calcule
   depuis `(front, tick, x, y)` plus le relèvement d'ambiance, lui-même `hash2(seed, tranche)`.
   `neigeAuSol` **rembobine** la géométrie des cycles passés (`gel.md` G7) : un vent qui garderait
   un cap lissé d'un tick à l'autre ne se rembobinerait plus. **Le lissage reste au client.**
   ⚠ La pureté s'arrête au front : `frontDuCycle` est pur, `state.meteo` **ne l'est pas** (il porte
   un `entre?` mutable, et n'existe pas si `meteoActive` est faux). Voir A6 — l'arbitrage est
   assumé, pas oublié.
2. **Zéro tirage PRNG.** `advanceWind` dérive par `hash2`, jamais par le PRNG de l'état — garde
   `chasse.test.ts` A18 (« un banc de test ne tire RIEN »). Tout ajout s'y tient.
3. **JSON-sérialisable, et déjà au contrat.** `wind` est dans `protocol.ts` et dans la liste
   persistée (`persistence.ts`). Toute forme nouvelle est une migration, pas un détail.

## Les lois

### V1 — LE CAP D'UN FRONT est son axe de traversée

`front.edge` donne le cap, **dérivé, jamais tiré** :

| `edge` | bord d'entrée | cap du vent | (l'axe `y` croît vers le sud) |
|---|---|---|---|
| 0 | ouest | `(+1, 0)` | il vient de l'ouest, il va vers l'est |
| 1 | est | `(−1, 0)` | |
| 2 | nord | `(0, +1)` | |
| 3 | sud | `(0, −1)` | |

C'est exactement la convention de `frontMeteoPos` (« ouest (0) et nord (2) traversent vers +axe »).
Écrivain unique : une fonction `capDuFront(edge)`, lue par la sim **et** par le client — la
doctrine de l'écrivain unique qui a déjà sauvé `meteoIntensityAt` d'une seconde formule divergente.

### V2 — LE VENT SE LÈVE AVANT LA PLUIE

Le **souffle** est l'intensité du front lue **en avance de phase** :

```
souffle(x, y, t) = meteoIntensityAt(front, t + VENT.AVANCE_TICKS, w, h, x, y)
```

Aucune géométrie nouvelle, aucune seconde rampe à calibrer : c'est la *même* bande, en avance.
Conséquence voulue et suffisante — **le vent monte à découvert avant que la bande n'arrive**, puis
retombe pendant que la queue de la pluie finit de passer. C'est le présage gagné diégétiquement
plutôt que décoré : le joueur *sent* le front venir avant de le voir.

`AVANCE_TICKS` vit dans `balance.ts` (bloc `VENT`) : c'est un réglage qui se calibre **en jouant**
— combien de temps d'avance donne-t-on au joueur pour rentrer le bois.

**L'ANGLE MORT DU BORD DE CYCLE, et sa sortie.** `state.meteo` est nul avant l'élection, et
l'élection tombe **au bord de cycle**. Or `frontDuCycle` pose `startTick = debut` quand la marge
est nulle — « une pluie d'automne occupe le CYCLE ENTIER : le front part à l'aube ». Pour ces
fronts-là — **précisément ceux où V2 compte le plus** — l'avance voudrait mordre sur le cycle
*précédent*, où le front n'existe pas encore. Sans traitement, le vent ne se lèverait jamais
avant les pluies les plus longues, et le critère A2 écrit à l'existentiel ne le verrait pas.

**Sortie** : quand `t + AVANCE_TICKS` franchit le bord de cycle, le souffle lit
`frontDuCycle(cycle + 1, …)`. Ce n'est pas une entorse, c'est **un patron déjà en place** :
`advanceMeteo` appelle exactement cette fonction au crépuscule pour annoncer le blizzard du
lendemain — « la même fonction que l'aube : le mensonge est impossible par construction ».
L'avertissement porté par `meteo.ts` (« elle dit ce que le cycle AURAIT élu ») vise les cycles
**passés** d'un monde qui ne les a pas vécus ; ici on regarde **en avant**, et le cycle à venir
sera élu par cette fonction même.

Gardé par `meteoActive` : un monde sans météo n'a pas de front, donc pas de souffle — l'ambiance
seule (V4).

### V3 — LA FORCE, et pourquoi elle n'habite pas la norme du cap

```
windForce = VENT.AMBIANT + (1 − VENT.AMBIANT) × souffle      ∈ [AMBIANT, 1]
```

**Jamais 0.** Deux raisons, et la seconde est une trappe :

- *de rendu* : un monde immobile est une image plate — jugé et rejeté le 2026-07-26 (`vent-lisse.ts`) ;
- *de sim* : **`state.wind = {x:0, y:0}` est une sentinelle vivante**, pas une valeur. Elle signifie
  « ce monde n'a pas de vent, et n'en aura jamais » — une décision d'HÔTE, comme `faunaCap`, dont
  les bancs se servent pour mesurer l'odorat en canal isolé. Une force qui pourrait légitimement
  atteindre 0 au calme entrerait en collision avec elle exactement comme les `max(…, 0)` sont
  entrés en collision avec le zéro Celsius.

**Donc : le cap reste unitaire dans `state.wind`, et la force vit dans un champ séparé
`state.windForce`.**

**Et la sentinelle ÉTEINT la force, explicitement.** Si `state.wind = {0,0}`, alors
`windForce = 0` — sans condition, avant tout calcul de souffle. Sans cette ligne, un monde en
calme plat garderait `windForce ≥ AMBIANT` : latent aujourd'hui, **faux le jour où V7 fait lire
la force à l'odorat** — la mesure en canal isolé dont les bancs se servent deviendrait
silencieusement fausse, et le calme plat fuirait par un champ qu'on n'a pas pensé à couper.

### V4 — LE CAP TOURNE PAR RELÈVEMENTS, ET NE DÉGÉNÈRE JAMAIS

**LE CAP EST GLOBAL, LA FORCE EST LOCALE.** Le souffle dépend du point (la bande est spatiale) ;
le cap, lui, ne peut pas : un front synoptique fait tourner le vent sur **toute** la vallée, et un
cap qui changerait de tuile à tuile serait absurde — et impossible à afficher au HUD. Donc :

- le **cap** se pilote sur le souffle pris **au centre de la carte** — une évaluation par tick,
  la même pour tout le monde. Il vit dans `state.wind` ;
- la **force** se lit **au point** (`ventForceAt(state, x, y)`) : c'est elle que consomment
  l'odorat, les herbes et le rendu. `state.windForce` en porte la valeur **au centre**, pour le
  HUD et les lecteurs grossiers.

Aucune géométrie nouvelle là non plus : l'enveloppe du cap est simplement le souffle au centre —
naturellement trapézoïdale (rampe d'entrée, cœur de bande, rampe de sortie).

Hors front, le cap est le relèvement d'ambiance existant : un des 8 `BEARINGS`, tranche de
`HUNT.WIND_SHIFT_TICKS`, dérivé par `hash2(seed, tranche, …)`. Inchangé.

Sous un front, le cap **parcourt les relèvements intermédiaires** de l'ambiance vers le cap du
front, à mesure que le souffle monte — en **index entier**, jamais en vecteur interpolé :

```
i = (i₀ + sens × round(souffle × écart)) mod 8      →      cap = BEARINGS[i]
```

où `i₀` est l'index d'ambiance **gelé** (voir juste dessous), `i₁` l'index du cap du front (les 4
cardinaux sont les index **pairs** de `BEARINGS`), `écart` le nombre de crans qui séparent `i₀` de
`i₁` **dans le sens choisi**, et `sens ∈ {−1, +1}`
dérivé par `hash2(front.cycle, …)` — pur, déterministe, **stable pour toute la traversée** (le
vent ne change pas d'avis en cours de virage).

**`i₀` EST GELÉ POUR LA DURÉE DU FRONT**, et ce n'est pas un détail. Le relèvement d'ambiance se
retire tous les `HUNT.WIND_SHIFT_TICKS` (**5 min**) ; la fenêtre d'un front vaut `fenetre × cycle`,
soit **15 à 30 min** (`PAR_SAISON.fenetre` ∈ [0,5 ; 1] × `CYCLE_REAL_MINUTES` = 30). L'ambiance se
retire donc **3 à 6 fois à l'intérieur d'une seule traversée** : laissée libre, elle ferait bouger
`i₀` — et avec lui `écart` — en plein virage, et le cap sauterait de 1 à 2 crans en un tick, au
milieu même du passage que V4 est censée rendre continu.

Donc : sous un front, `i₀` est le relèvement de la tranche qui court **au `startTick` du front**,
pas de la tranche courante. Pur (dérivé de `front.startTick`), et le raccord à l'entrée est
**continu par construction** — à `startTick`, la tranche gelée *est* la tranche courante.

Hors front, rien ne change : l'ambiance tourne, et elle **saute** toutes les 5 min comme
aujourd'hui. Ce saut-là est le comportement existant, et le client le rallie déjà.

**POURQUOI PAS UN LERP DE VECTEURS.** La forme évidente —
`normalise(capAmbiant × (1 − souffle) + capDuFront × souffle)` — **produit `NaN` à une entrée
atteignable**. `BEARINGS` contient l'opposé de chaque cardinal : quand l'ambiance est
anti-parallèle au cap du front (**1 relèvement sur 8**, tiré par `hash2` — ça arrivera), la somme
vaut exactement `(0,0)` à `souffle = 0,5`, la division plante, et le `NaN` part dans `state.wind`
— donc dans le protocole **et** dans la sauvegarde. La parade connue du client (détecter
l'anti-parallélisme et pousser par le travers *avant* le lerp, `vent-lisse.ts`) **ne se transpose
pas** : elle marche parce que `VentLisse` possède `this.dir` d'une frame à l'autre. Une fonction
pure appelée par tick n'a rien à pousser. Le parcours en index, lui, n'a **aucun cas dégénéré** :
il n'y a rien à normaliser.

Le cap de la sim avance donc par crans de 45°. **C'est le client qui rend la pente continue** :
`VentLisse` rallie le cap en arc (demi-vie 4 s) — ce qu'il fait déjà — et c'est la contrainte 1
qui le veut ainsi. Un lissage entré dans la sim lui coûterait le rembobinage.

### V5 — LE VENT DE CENDRE GARDE SON BORD

`vent_de_cendre` force `edge: 3` : il descend de la Cendrière, au sud (`cortege-cendre.md` R6). Il
reste le seul front dont le cap ne se tire pas — et sous l'unification, il devient enfin *ce que son
nom dit* : un front dont le vent est l'effet principal.

### V6 — LE CLIENT CESSE DE RÉINVENTER

`VentLisse` (`packages/client/src/scenes/world/vent-lisse.ts`) **invente aujourd'hui la force** (deux
battements lents) et **re-normalise** le vecteur de la sim. Sous cette spec :

- il consomme `windForce` au lieu de l'inventer ;
- il ne garde que le **ralliement de cap** (demi-vie 4 s) — un banc ne casse pas sa route d'un coup,
  et le client interpole entre snapshots ;
- il peut garder un battement **résiduel** de faible amplitude (la respiration), mais posé *au-dessus*
  de la force de la sim, jamais à sa place.

Cette édition est **obligatoire et simultanée**, pas un suivi : ajouter une force côté sim sans
toucher au client, c'est la voir divisée aussitôt par la renormalisation.

Consommateurs déjà branchés, qui héritent gratuitement : la **brume**, les **herbes**
(`clutter.wind`), le **feu** (`fireFx`).

## Les critères d'acceptation

Headless, dans `/sim`, sauf mention contraire.

- **A1 — le cap suit le front.** Pour chacun des 4 `edge`, un monde dont le front est actif et la
  bande centrée sur le point testé rend le cap de la table V1, au signe près. *Balayage des 4
  bords, pas trois cas choisis.*
- **A2 — le vent précède la pluie, Y COMPRIS AU BORD DE CYCLE.** Il existe un tick `t` où
  `windForce(p) > AMBIANT` et `meteoIntensity(p) === 0`, et ce `t` est **avant** le premier tick
  où `meteoIntensity(p) > 0`. **Monté sur un front qui part à l'aube** (`marge ≤ 0` — une pluie
  des Pluies, qui occupe le cycle entier) : c'est le seul cas où l'avance franchit le bord de
  cycle, donc le seul qui prouve la sortie de V2. Un front de milieu de cycle passe le critère
  **sans rien prouver** — le critère existentiel serait vert avec l'angle mort intact.
- **A3 — la force est bornée, et ne touche zéro QUE par la sentinelle.** Dans un monde venté
  (`wind ≠ {0,0}`), sur une traversée complète et un point balayé sur toute la carte :
  `AMBIANT ≤ windForce ≤ 1` — jamais `0`, jamais `> 1`. *Les deux moitiés du domaine sont
  affirmées séparément : le plancher est une promesse de rendu, le zéro est une porte d'hôte.*
- **A4 — la sentinelle survit, ET éteint la force.** Un monde monté avec `wind = {0,0}` garde
  `{0,0}` sur une traversée entière de front, **`windForce` y reste à `0`**, et son odorat reste
  muet. *La décision d'hôte n'est écrasable ni par la météo, ni par le champ qu'on vient
  d'ajouter — c'est exactement par là qu'un calme plat fuit.*
- **A5 — zéro tirage.** `rngState` inchangé sur ≥ 6 × `WIND_SHIFT_TICKS` **et** sur une traversée
  de front complète. *L'extension d'A18, pas son remplacement.*
- **A6 — pur À FRONT DONNÉ, et rembobinable sous sa précondition.** `capAt`/`forceAt` appelés
  deux fois sur le même `(front, tick, x, y)` rendent le même résultat. ⚠ **La loi lit
  `state.meteo`** — de l'état, qui porte un `entre?` mutable et n'existe pas quand `meteoActive`
  est faux : la pureté est donc **conditionnelle au front**, pas absolue sur `(seed, tick)`. C'est
  un arbitrage **assumé** : le vent doit dire le front qui TOMBE VRAIMENT, pas celui que le cycle
  aurait élu dans un monde où la météo aurait toujours été armée. Le rembobinage n'est donc
  garanti que sur un monde dont `meteoActive` n'a pas changé en cours de route — et la garde le
  monte ainsi, explicitement.
- **A7a — le cap ne dégénère JAMAIS.** Sur le **produit** des 8 relèvements d'ambiance × 4 bords
  de front, joué sur une traversée entière : le cap est toujours un `BEARINGS` valide — jamais
  `NaN`, jamais nul hors sentinelle. Le cas anti-parallèle est **dans le balayage par
  construction**, pas monté à part : c'est ce qui empêche de le perdre au prochain refactor.
- **A7b — et il ne saute pas PENDANT une traversée.** Le cap ne se déplace jamais de plus d'**un
  cran** entre deux ticks consécutifs, de `startTick − AVANCE` à **la fin du souffle**
  (`endTick − AVANCE`) — le domaine où le front commande.
  - ⚠ **La traversée du montage doit ENJAMBER au moins deux tranches d'ambiance.** C'est la
    prémisse, et elle est tout le test : `WIND_SHIFT_TICKS` vaut 6 000 ticks, et la première
    rédaction fabriquait des traversées de **2 000** — `i₀` ne se retirait jamais pendant le run,
    le montage épinglait lui-même la condition qu'il prétendait éprouver, et la garde passait
    **à l'identique avec ou sans le gel**. Elle ne gardait rien, et son propre commentaire
    décrivait le piège qu'elle était en train de commettre.
  - **Prouvée par mutation** : gel retiré (`debutSouffle = tick`), A7b rougit (saut de 2 crans en
    plein virage) ; gel remis, elle passe.
  - **Et le retour à l'ambiance s'affirme À PART**, plutôt que d'être caché dans la borne : après
    la sortie, le cap est **exactement** celui qu'un monde sans météo aurait au même tick. Ce
    retour-là peut valoir un demi-tour — c'est le relais que le vent fait toutes les cinq minutes
    depuis toujours, lissé par le client, et non une rupture du virage (mesuré : le saut tombe
    2 400 ticks **après** la fin du souffle, `frontQuiSouffle` déjà nul).
- **A8 — un seul écrivain.** Aucun module hors `vent.ts` ne compose un cap depuis `front.edge` ;
  aucun ne recalcule une force. *Garde par grep, comme A14 sur `largeurDe`.*
- **A9 — le client lit, il n'invente pas** (client). `VentLisse` alimenté d'une force constante
  rend une force constante à la même constante près ; il ne la renormalise pas.

## La persistance : `windForce` NE CASSE PAS LES VIEILLES SAUVEGARDES

`SAVE_REQUIRED_KEYS` pose exprès la question à l'auteur d'un champ neuf : **bosser la version, ou
donner un repli ?** Ajouter `windForce` en champ *requis* — le geste réflexe — aurait fait
**refuser toute vallée en cours**, pour un champ que `advanceVent` recalcule au tick suivant.

`windForce` est **dérivé** : il va donc dans `REPLIS_EPHEMERES`, avec `VENT.AMBIANT` pour repli.
Gardé dans `persistence.test.ts`, et la garde va plus loin qu'un simple « ça se relit » : elle
joue un tick et vérifie que **la valeur se refait vraiment** — un repli est une amorce, pas un
pansement.

## Le rayon d'explosion (mesuré)

- **Aucun test n'assère une séquence de relèvements.** `chasse.test.ts` A18 vérifie seulement
  « il a tourné » + « rien coûté au PRNG ». Les autres (`tir.test.ts`, `faune.test.ts`,
  `depecage.test.ts`, `interest.test.ts`, `chasse.test.ts`) écrivent `sim.wind` comme **fixture**
  — `{0,0}` pour le calme, `{−1,0}` pour poser un côté. Ajouter un champ ne les casse pas ;
  changer la forme de `wind` les casserait toutes.
- **Contrat** : `protocol.ts` (le champ voyage au client) et `persistence.ts` (liste persistée).
- **Attention RNG** : toute loi qui change *ce que fait une bête* (V7 ci-dessous) décale le flux de
  tirages et casse des tests sans rapport. À isoler sur un chemin neuf, jamais mêlée à V1-V6.
- **Pureté, la nuance qui compte** : `frontDuCycle` est pur — `state.meteo` **ne l'est pas**. La
  loi du vent lit le second pour le présent (cohérence avec ce qui tombe) et le premier pour
  l'avance qui franchit un bord de cycle (V2). C'est ce qui borne A6, et il ne faut pas laisser
  cette distinction se perdre : « le front est déjà une fonction pure » est vrai de l'élection,
  faux du front en cours.
- **Coût** : deux `hash2` de plus par tick, une seule fois (la pose de `state.wind`), pas par
  entité. Négligeable — mais à ne pas transformer en appel par point sans le mesurer.

## Les décisions, tranchées le 2026-08-24 (« fais tout, et ajoute un indicateur au HUD »)

- **V7 — L'ODORAT LIT LA FORCE. ✅ LIVRÉ.** Le nez porte ce que le vent porte : la portée du canal
  suit `ventGain` au point de la BÊTE. Le cône (`SCENT_COS`) ne bouge pas — la parade reste **un
  côté**. Ce qui l'a rendu livrable sans recalibrer la chasse : le gain vaut **exactement 1** hors
  front (`AMBIANT + 0` divisé par lui-même), donc tout monde sans météo renifle au bit près comme
  avant — les suites `chasse`/`faune`/`tir` sont passées inchangées. Gardé par `chasse.test.ts`,
  qui **prouve d'abord sa prémisse** (le front souffle vraiment sur la bête) avant de comparer.
- **V8 — `froidEolien` → `partDeBlizzard`. ✅ RENOMMÉ (et rien branché).** La fonction ne lit
  **aucun vent** : c'est une rampe sur `T₀`. Le refroidissement éolien que le nom promettait
  n'existait pas — un cas de loi lue à l'envers, invisible parce qu'elle a un appelant et des
  tests verts. Le renommage est **à comportement nul**, fait en dernier, après les suites.
  ⚠ **BRANCHER la morsure du froid sur `windForce` reste OUVERT** : ce serait un changement
  d'équilibrage du froid — mortel — donc son propre chantier, avec son banc.
- **V9 — LE SERPENTIN, EN CLIENT PUR. ✅ LIVRÉ** (`vent-serpentins.ts` + `vent-layer.ts`). Pas de
  `SimEvent` : rien à chroniquer, rien à synchroniser, zéro coût de tick, zéro risque RNG. La
  densité suit le **carré** de la part de souffle — à l'ambiance, **aucun ruban, jamais** : c'est
  un présage, pas une ambiance. Il sort donc pendant l'AVANCE DE PHASE (V2), avant la pluie.
  - *Deux corrections venues du banc, pas de l'œil* : la naissance était **par image** et non par
    seconde (le FX dépendait du framerate — le headless plafonnait à 5 rubans là où le jeu en
    montre 14) ; et peints à opacité constante, les rubans lisaient comme des **barres** de
    compression — la queue s'effile désormais par crans.
- **V10 — LE CADRAN. ✅ LIVRÉ — et C19 EST OFFICIELLEMENT AMENDÉ.** `chasse.md` C19 interdisait
  *« une flèche d'UI »*. Alexis l'a levé le 2026-08-24 : sous l'unification le vent commande
  l'odorat et annonce le front, donc il doit se lire **sans interprétation**. Une aiguille dans la
  barre haute, contre le pictogramme du ciel — le vent EST le front, les séparer les ferait mentir
  l'un sur l'autre.
  - Elle pointe **là où le vent VA** (le sens des herbes couchées), jamais la convention météo
    « vent d'ouest » : deux conventions opposées à l'écran se lisent à l'envers une fois sur deux.
  - Elle **LIT `state.wind`** et ne recompose jamais le cap (A8 vaut aussi pour le HUD).
  - L'angle est **déroulé** : sans ça, franchir l'est faisait faire un tour complet à l'envers à
    la transition CSS. Le lissage est confié au DOM — jamais un timer client.
  - **Les herbes restent la lecture première.** Le cadran est le recours.

## Ce que le banc a appris (et que l'œil n'aurait pas vu)

- **Le HUD a toujours une image de retard** sur le registre (`UIScene` tourne avant `WorldScene`),
  et en headless sur SwiftShader une image dure **une dizaine de secondes**. Une attente fixe
  photographiait le monde d'avant et accusait le cadran de mentir. `smoke --scenario vent` attend
  donc la **concordance** entre l'angle peint et le cap de la sim, pas une durée.
- **La capture peut être entièrement noire**, une fois sur trois : le canvas n'est pas repeint
  dans certaines fenêtres du headless. Le scénario reprend la photo jusqu'à ce qu'elle ait du
  contenu, et le **dit** si elle n'en a jamais — juger la DA sur une prise vide, c'est juger
  l'instrument.

## Ce que cette spec ne fait PAS

- Elle ne touche pas à l'élection des fronts (`meteoTypeDuCycle` reste l'écrivain unique).
- Elle n'ajoute aucun type de front, aucune saison, aucune géométrie.
- Elle ne fait pas du vent une force physique : rien n'est poussé, dévié ni renversé. Le vent
  **oriente** (l'odeur) et **module** (le rendu). Une flèche déviée par le vent serait un autre
  chantier, avec sa propre décision.
