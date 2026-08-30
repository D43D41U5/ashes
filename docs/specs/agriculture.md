# Agriculture — le potager (voie A)

*Source : GDD §8 (économie de flux, la branche Agriculture : Potager → Champs → Serres/cultures d'hiver → Semences maîtresses), §8bis (les trois cercles — le DOMESTIQUE est « sûr, renouvelable vite, MÉDIOCRE : un village y survit, n'y prospère jamais »). Statut : **proposition** (2026-07-23). Jalon : Veillée, phase 2.*

> **Note de cadrage.** L'agriculture (voie A) est un système **explicitement différé** par `direction-design` §2 (« ce n'est pas une fuite en avant vers plus de systèmes… charrette, agriculture… explicitement différées »). Il est construit maintenant **sur directive d'Alexis (« tu fais tout dans l'ordre », 2026-07-23)** qui le dé-diffère. On respecte le garde-fou du GDD (§8bis, ci-dessous), pas la seule envie d'ajouter.

## L'intention

La FERME existe déjà comme structures (parcelle → serre → terroir, composants craftés au Feu, reconnus en fonction `ferme`) — mais elle est **creuse** : rien ne pousse. Ce spec lui donne son gameplay : **une source de nourriture LOCALE et PASSIVE, près du Feu**, qui ne demande pas de sortir chasser ni cueillir au loin.

**Le garde-fou (§8bis), non négociable :** le potager est **médiocre**. Lent à pousser, rendement modeste — un village y **survit**, il n'y **prospère jamais**. Il ne doit PAS désamorcer la pression de faim/mortalité qu'on vient de câbler (upkeep, froid, hordes). C'est un filet domestique, pas un jackpot. Les nombres (temps de pousse, rendement) sont des **ordres de grandeur à calibrer en playtest** ; s'ils devaient dépasser « médiocre », c'est une décision T3 réservée à Alexis.

## Le modèle — déterministe, ZÉRO RNG, ZÉRO nouvelle entité

Le piège serait de modéliser les cultures comme des entités spawnées ou de tirer la pousse/le rendement au PRNG seedé — ce qui décalerait le flux RNG et casserait des replays sans rapport (mémoire projet). On l'évite entièrement :

- **La pousse est une FONCTION PURE du tick**, sur un état PAR PARCELLE stocké sur la **structure** `parcelle` : un champ `plantedAt?: number` (le tick de la mise en terre). La maturité se lit par arithmétique : `mûr ⇔ plantedAt !== undefined && tick − plantedAt ≥ AGRICULTURE.GROW_TICKS`. Le stade de rendu (semé → pousse → mûr) est `min(1, (tick − plantedAt) / GROW_TICKS)`.
- **Le rendement est FIXE** (`AGRICULTURE.YIELD`), pas tiré. Aucune entité créée, aucun `Math.random`. `plantedAt` est un `number` — JSON-sérialisable, transporté et sauvé comme le reste de la `Structure`.

## Les règles (tranche verticale v1 — la `parcelle` seule)

- **R1 — La graine.** Un item `graine` se **crafte au Feu** depuis des baies (`AGRICULTURE.SEED_FROM_BERRIES` baies → 1 graine). C'est l'investissement d'amorçage : cueillir une fois, semer ensuite.
- **R2 — Semer.** Action `plant` (VillageAction, cible `structureId`) : une `graine` en main + une `parcelle` VIDE (`plantedAt` absent) de son village, à portée (`INTERACT_RANGE`) → pose `plantedAt = tick`, consomme 1 graine, émet `crop_planted`.
- **R3 — Pousser.** Aucune logique de tick active : la maturité se DÉRIVE (R-modèle). Une parcelle semée est « en pousse » jusqu'à `GROW_TICKS`, puis « mûre ».
- **R4 — Récolter.** Action `harvest_crop` (VillageAction, cible `structureId`) : une `parcelle` MÛRE de son village, à portée → verse `AGRICULTURE.YIELD` `legume` à l'acteur, efface `plantedAt` (replantable), pose un cooldown, émet `crop_harvested`. Récolter une parcelle NON mûre est rejeté (« pas encore mûr »).
- **R5 — Le légume nourrit.** `legume` est une nourriture (`FOOD_VALUES.legume`), modeste — au niveau des baies, pas de la viande. C'est la « nourriture de base » du GDD (§8, tableau « Baies & légumes »).
- **R6 — Médiocrité (garde-fou §8bis).** `GROW_TICKS` est LONG (plusieurs cycles) et `YIELD` modeste : le potager est un trickle passif, jamais un remplacement de la chasse/cueillette. Calibration.
- **R7 — La SERRE : cultures d'hiver (GDD §8, « poussent quand le froid tue le reste »).** La `serre` se sème et se récolte comme la parcelle (même graine, même légume) MAIS **en acte III la terre à ciel ouvert GÈLE** : semer une `parcelle` (plein air) est refusé (« la terre est gelée — il faut une serre »), semer une `serre` reste possible. Le payoff stratégique : bâtir des serres AVANT l'hiver, ou ne plus rien planter quand la faim mord le plus. (Seuil « acte III » = calibration.) *(Une culture déjà mûre dans une parcelle se récolte encore.)*
  > **AMENDÉ le 2026-08-19 par `flore-froid.md` (décision d'Alexis).** Deux choses ont changé. ① **Le seuil passe de l'ACTE au CLIMAT DU LIEU** : semer une `parcelle` est refusé partout où `climatFlore < FLORE.SEUIL_GEL` — donc aussi les nuits d'acte II et sur la neige, jamais en acte I. ② **La culture MEURT.** R7 disait ici « pas de suivi *la culture meurt*, déterministe et simple » : c'est renversé. Une `parcelle` semée qui prend le gel MORTEL (`FLORE.SEUIL_MORTEL`, sous un blizzard ou une nuit d'acte III) perd sa culture et émet `crop_frozen`. C'est ce qui donne enfin son prix à la serre : sans perte possible, le plein air n'était qu'un semis retardé. Le suivi reste déterministe et pur — un prédicat sur le tick, aucun champ neuf.
- **R8 — Le TERROIR : le meilleur palier de la ferme.** Se sème/récolte comme la serre — **hivernal** (ni gel du semis, ni gel MORTEL — il est hivernal par son TYPE, jamais par le champ thermique, cf. `flore-froid.md` F4/F5) — ET rend **davantage** (`YIELD_TERROIR > YIELD`). C'est l'aboutissement de la ferme : plus de PV à défendre, plus long à bâtir, mais le rendement qui paie. *(Sa dimension « cultures EXCLUSIVES » du GDD — ce que les autres n'ont que par raid/troc — est une valeur **sociale** : elle prend tout son sens en multi ; en solo, le terroir est simplement le palier au meilleur rendement.)*

*(Différé aux tranches suivantes : l'entretien PNJ du potager (cercle domestique, GDD §5 — rattaché au chantier IA-village, EN PAUSE) ; les « semences maîtresses » héritables et l'exclusivité inter-village → P4/multi.)*

## Critères d'acceptation (headless, testés)

- **A1** — Cueillir des baies, crafter une `graine` au Feu (coût baies retiré) ; sans assez de baies → rejeté.
- **A2** — Semer une graine dans une parcelle vide pose `plantedAt` et retire la graine ; semer dans une parcelle déjà semée → rejeté (« déjà semé »).
- **A3** — Avant `GROW_TICKS`, la parcelle n'est pas mûre ; récolter → rejeté (« pas encore mûr »). À `GROW_TICKS`, elle est mûre.
- **A4** — Récolter une parcelle mûre verse `YIELD` légumes, efface `plantedAt` (replantable) ; manger un légume rend `FOOD_VALUES.legume` de faim.
- **A5** — **Déterminisme** : même seed + mêmes inputs (semer au tick T, récolter au tick T+GROW) ⇒ même état ET même flux d'événements (`crop_planted`/`crop_harvested`), rejoué au bit près. La suite complète (`replay.test`, `events.test`) reste verte — aucune entité ni RNG ajoutée au flux partagé.
- **A6** — **La serre (R7)** : en acte III, semer une `parcelle` de plein air est refusé (« la terre est gelée »), semer une `serre` réussit (`plantedAt` posé). L'acte se dérive du calendrier (pur) — testé via une échelle calendaire élevée. *(Amendé : le refus se juge sur `climatFlore`, pas sur l'acte — critères A9/A10 de `flore-froid.md`.)*
- **A7** — **Le terroir (R8)** : hivernal (se sème en acte III comme la serre) ET récolte `YIELD_TERROIR` légumes, strictement plus que la parcelle/serre (`YIELD`).

## La culture de braise — le jardin de suie (chantier ⑦ de la cendre, 2026-08-30)

*(Décision actée « on suit tes recos », prémisse corrigée à la reconnaissance : l'agriculture
existait — le jardin de suie ne l'introduit pas, il lui ajoute la culture QUE la cendre seule
porte. Le garde-fou §8bis tient : médiocre, un village y survit, n'y prospère jamais.)*

- **J1 — La parcelle de suie** : une pièce du registre (`parcelle_de_suie`), posable **hors
  village et hors carré** (`horsVillage`, le statut de la braise-mère — le jardin est LOIN, à
  la frange) et **sur sol cendré SEULEMENT** (`surCendre` — `tuileCendree`, l'écrivain
  unique). Son coût mange l'item orphelin : du bois et de la **cendre** (`ash` — le tas du
  Versant Brûlé trouve enfin son consommateur). C'est un PLOT (`isPlot`) : les gestes, le
  verdissement et la récolte existants la portent sans une ligne client.
- **J2 — L'orge-de-braise** : la culture `braise` du catalogue — graine `graine_de_braise`,
  récolte `orge_de_braise` (nourrit peu, se garde peu : médiocre, §8bis), pousse lente.
  **Compatibilité TOTALE dans les deux sens** (`cultureAdmise`) : la braise ne germe QUE dans
  la suie, et la suie n'accepte QU'elle — un légume dans la cendre ou une orge au potager
  sont refusés avec leurs mots. Ni fenêtre de saison ni gel : la parcelle de suie sème et
  pousse TOUTE l'année, F4/F5 l'ignorent par TYPE (le patron de la serre) — c'est sa raison
  d'être : la seule terre qui travaille en plein Grand Froid, à ses risques (la hantise).
- **J3 — La graine vient du MURMURE** (`cendre.md` R27c, la récompense matérielle actée en
  tranche 2 : soldée) : chaque murmure recueilli glisse une `graine_de_braise` dans le sac du
  visiteur (best-effort — sac plein, la graine se perd, assumé). L'agriculture de la cendre
  se DÉCOUVRE en écoutant ses morts ; ensuite la boucle des graines se referme toute seule
  (la récolte rend sa graine, comme toute culture).

### Critères d'acceptation du jardin de suie

- **J-A1** — La pose exige le sol cendré (« il faut un sol cendré » ailleurs) et passe sans
  village ; le coût consomme `ash`.
- **J-A2** — La compatibilité est totale : braise sur suie ✓ (même en plein gel, là où la
  parcelle refuse « la terre est gelée ») ; légume sur suie ✗ ; braise sur parcelle/serre ✗ ;
  et F5 (le gel qui tue les cultures) ne touche JAMAIS la parcelle de suie.
- **J-A3** — La boucle : semer → mûrir (pousse de la culture) → récolter rend l'orge ET une
  graine ; le murmure recueilli donne une graine (le témoin : le sprinteur n'en reçoit pas).
