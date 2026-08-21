# La saison sans fin — une loi, deux réglages

*Source : décisions d'Alexis du 2026-07-31 (journal). **Supersède le cadre de `saison.md`** (60 jours, trois actes, fin au jour 61) sans en annuler les mécanismes : la méga-horde, la chronique et les verdicts survivent, ils changent d'ancrage. Statut : **en cours — T1 (les dix lois totales) livrée le 2026-08-21, à comportement identique ; plan en cinq tranches dans `docs/superpowers/plans/2026-08-21-saison-sans-fin-tranches.md`**. Jalon : avant GATE 1 (O7 tranchée de fait par « continue », 2026-08-21). O1 est RÉPONDUE : **l’arc oscille** (décision d’Alexis 2026-08-21) — pas de dernier acte, un hiver qui revient plus dur.*

## Objectif de design

Le jeu ne se termine plus au bout de soixante jours. La pression monte **indéfiniment**, ce qui force à s'organiser et à se protéger **tôt** plutôt qu'à tenir un compte à rebours. La saison cesse d'être la *forme* du jeu pour devenir un *réglage* : en solo elle n'existe pas, en multi c'est la période de wipe, exprimée en journées réelles.

Ce qui a déclenché le pivot : le recensement des Cendreux du 2026-07-31 a mesuré une population **plate** — 29 au jour 20, 32 au jour 60. Le défaut n'était pas le nombre d'actes, c'était que l'escalade est une **table de trois valeurs**. Huit actes tabulés à la main auraient donné la même platitude, plus longtemps, contre 80 nombres à calibrer.

## Règles

- **R1 — Une loi, pas une table.** Les dix quantités de pression deviennent des fonctions du numéro d'acte, **définies pour tout acte ≥ 1, sans borne supérieure d'indice** : `ACT_COLD`, `ACT_HUNGER_FACTOR`, `HORDE_CHANCE_PER_NIGHT`, `HORDE_SIZE`, `UNDEAD_SHARE`, `UNDEAD_MAX_ALIVE`, `NIGHT_HUNT.CHANCE_PER_MIN`, `SEASON.REGROW_ACT_FACTOR`, `FIRE_UPKEEP.ACT_FACTOR`, `ALIGNMENT.ACT_FACTOR`. Chaque loi déclare sa **pente** et son **plafond** ; aucune n'accède plus à un tableau de trois cases.
  - **R1ter — La liste, RELEVÉE le 2026-08-21 (T1) et non plus supposée.** La refonte pression-croissante a tué `UNDEAD_SHARE` (le cadran de température le remplace) et la méga-horde, et mis `HORDE_CHANCE`/`HORDE_TAILLE` en rampes continues sur le jour. Les dix lois de T1 sont donc : `TEMPERATURE.ACT_COLD` (**la maîtresse** — depuis que « le froid est le cadran », refroidir escalade tout le reste), `ACT_HUNGER_FACTOR`, `SEASON.REGROW_ACT_FACTOR`, `ALIGNMENT.ACT_FACTOR`, `FIRE_UPKEEP.ACT_FACTOR`, `NIGHT_HUNT.CHANCE_PER_MIN`, `BRUME.CHANCE_PER_DAY`, `METEO.CHANCE_PER_CYCLE`, plus deux **tables totales** qui ne sont pas des pentes — `METEO.TYPES` (une mixture) et `CENDREUX.CONVERGE_TILES` (une portée de perception assumée par le plan pression-croissante : la continuifier est une décision d'Alexis). Bâtisseurs : `actLaw` / `actTable` (`balance.ts`). T1 tient le dernier palier au-delà de l'acte III — **le plafond provisoire** ; la pente par TOUR (l'arc oscillant) s'écrira en T2 dans ces fonctions, point unique.
- **R1bis — Déterministe par construction.** Les lois s'écrivent en `+ - * /`, `Math.min/max/round/floor` uniquement (invariant §2 : `**`, `exp`, `pow` interdits dans `/sim`). Une croissance géométrique se calcule par multiplications répétées bornées, jamais par exponentiation.
- **R2 — L'acte devient un marqueur de fiction.** Il ne porte plus les chiffres : il nomme (chronique, ciel, musique, bandeau). On peut en avoir quinze sans retabuler quoi que ce soit. `actForDay` cesse de rendre `1 | 2 | 3` et rend un entier non borné.
- **R3 — Deux réglages, indépendants.** (a) la **vitesse du calendrier** — combien de jours de jeu passent par cycle jour/nuit ; (b) le **reset** — jamais, ou toutes les `SAISON_JOURS_IRL` journées réelles.
- **R4 — Solo : pas de reset.** L'horloge monte à vie, les actes se succèdent sans fin. `VEILLEE_SEASON_CYCLES` perd son rôle actuel (faire tenir 60 jours dans 6 cycles) et devient le réglage de (a) : à quelle allure les jours passent pour le joueur.
- **R5 — Multi : la pression est celle du MONDE.** Elle n'est pas indexée sur l'âge du joueur ni de son village : deux voisins doivent vivre la même nuit, sinon la défense collective — le cœur du village — n'a plus de sens. Le problème du nouveau venu se règle par le **wipe**, qui borne l'injustice à une saison, et par une parade **constructible** : on rattrape en bâtissant, pas en ayant été là.
- **R6 — La longueur de saison règle la VITESSE, pas le point d'arrêt.** La vitesse (a) se **dérive** de `SAISON_JOURS_IRL` et de l'arc nominal (O1) — jumeau mécanique de `calendarScaleForSeasonCycles`, jamais recalée à la main. Tout serveur, quelle que soit sa durée, traverse le **même arc**. Une saison courte n'est donc pas un jeu tronqué : elle est plus **dure**, parce qu'on a moins d'heures de jeu pour bâtir contre la même menace. La longueur de saison est de fait le bouton de difficulté du serveur.
- **R7 — Passé un seuil, l'escalade change de nature : du NOMBRE vers la LÉTALITÉ.** Contrainte d'ingénierie, pas de goût. Mesuré le 2026-07-31 : 60 jours sur la carte de production coûtent 2 349 s de CPU, et le tick change de régime dès qu'il y a des monstres. Une escalade en population sans plafond fait diverger le coût du tick — le jeu se saborde vers l'acte 8. Au-delà du seuil, la montée passe par les dégâts, les PV, la vitesse et la coordination du siège, à population bornée.

## Ce qui reste ouvert

- **O1 — L'arc nominal.** ~~Combien d'actes, et surtout : à quoi ressemble le DERNIER ?~~ **RÉPONDUE le 2026-08-21 (Alexis) : l'arc OSCILLE.** Il n'y a pas de dernier acte : un hiver qui revient plus dur — `loi(acte) = min(plafond, socle(k) + AMPLITUDE[(acte − 1) mod 4])`, `k` le tour, `socle(k+1) = socle(k) + PAS`. A2 se réénonce alors sur `k`. Restent à poser pour T2, une à une : la longueur de l'année en jours, le nom des actes ≥ 4, l'ordre de grandeur des PAS.
- **O2 — Le sort de l'Arche.** `SEASON.EVAC_DAY = 55` / `EVAC_DEPART_DAYS = 3` (R3-R4 de `saison.md`) : l'évacuation *était* la fin. Pistes signalées, non tranchées — **solo** : sortie volontaire (« partir clôt ta partie », le geste d'extraction, ce qui donne un sens au « combien de jours as-tu tenu ») ; **multi** : événement de score en fin de saison, avant le wipe.
- **O3 — Les pentes et plafonds des dix lois** (calibrage playtest, via `pnpm scenario` et le recensement).
- **O4 — Le seuil de bascule nombre→létalité de R7**, et le plafond d'entités simultanées qu'il protège.
- **O5 — La parade monte-t-elle sur la même loi que la menace ?** Sans quoi « s'organiser tôt » n'achète que quelques jours de sursis.
- **O6 — Le verdict de fin de saison** (`season_ended`, R4 de `saison.md`) : que devient-il en solo, où il n'y a plus de fin ?
- **O7 — Le jalon.** Ce pivot précède-t-il GATE 1, ou joue-t-on GATE 1 sur la boucle actuelle ?

## Critères d'acceptation

- **A1** — `actForDay(jour)` est défini et **monotone non décroissant pour tout jour ≥ 1**, sans borne supérieure ; balayé sur 1…10 000, il ne lance pas et ne rend jamais `undefined`.
- **A2** — Chaque quantité de pression est **monotone non décroissante en acte** (décroissante pour celles qui doivent baisser) et **bornée** : chacune atteint son plafond déclaré et n'en bouge plus. Balayage exhaustif sur les 10 lois × 200 actes, pas des cas choisis.
- **A3** — Aucun accès indexé à un tableau d'actes ne subsiste. **Tenu PAR LE COMPILATEUR depuis T1** (une loi n'est pas indexable : `[act - 1]` est une erreur de compilation partout — `pnpm check`), et non par grep, qui crierait sur les commentaires et s'arrêterait au premier renommage. Le lint de pureté passe.
- **A4** — **LE COUPLAGE IRL, ET C'EST LA GARDE QUI A MANQUÉ EN SOLO.** Pour `SAISON_JOURS_IRL` ∈ {1, 3, 7, 30, 90} : la saison contient **exactement l'arc nominal**, le dernier acte **commence avant la fin**, et son premier crépuscule tombe **dans** la saison. C'est la reproduction du bug corrigé par `calendarScaleForSeasonCycles` (l'acte III arrivait après la fin), généralisée au réglage d'admin.
- **A5** — Le solo ne se réinitialise jamais : à `10 × 60` jours de jeu, la sim tourne encore, et l'acte y est strictement supérieur à celui du jour 60.
- **A6** — Déterminisme : une saison rejoue **au bit près** à toute vitesse de calendrier et à toute longueur de saison, chronique comprise.
- **A7** — La population de Cendreux **croît** entre le premier tiers et le dernier tiers de l'arc — la garde qui aurait attrapé la platitude mesurée le 2026-07-31 (29 → 32). Mesurée par `tools/recensement-cendreux.mts`, pas par lecture de constantes.

## Ce que ça casse, et qu'il faut mettre à jour

- **Le GDD §2 et la première ligne de `CLAUDE.md`** disent « saisons de 60 jours ». À amender par Alexis (le GDD est sa source de vérité) ; le présent document est la dérogation actée, comme le tick à 20 Hz l'a été le 2026-07-05.
- **`docs/specs/saison.md`** — R1 (courbe en trois actes), R3 (évacuation au jour 55) et R4 (fin au jour 61) sont superséds. R2 (méga-horde), R5 (noms de village) et R6 (chronique) survivent tels quels.
- **`BALANCE.SEASON_DAYS = 60` et `ACT_BOUNDARIES = [21, 42]`** cessent d'être des vérités du monde ; le premier devient la longueur de l'arc en jours de jeu, le second disparaît au profit d'une cadence.
- **Le wipe** n'existe pas encore (`saison.md` : « le wipe est une affaire d'hôte »). Il devient nécessaire en multi, et c'est lui qui porte R3(b).

## Hors périmètre

Le méta-jeu inter-saisons (Mémoires, blueprints, cosmétiques) ; l'habillage du ciel et de la musique par acte ; la persistance du classement de saison.
