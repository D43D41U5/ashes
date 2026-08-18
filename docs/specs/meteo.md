# La Météo — des fronts qui traversent la vallée, cinq ciels, la pression qui se voit venir

*Source : GDD §9bis (« Blizzard — carte entière, la température s'effondre, raider pendant est le pari des audacieux »), GDD §8 (« au Grand Froid, le domestique s'appauvrit — neige, gel »), décisions Alexis 2026-08-18 (session contours météo, sept fourches tranchées une à une). Statut : **décidé, à implémenter**. Requalification actée : le Blizzard QUITTE le catalogue d'événements §9bis — il devient l'état extrême du continuum météo, même mécanisme que la pluie, calibré à l'extrême.*

## Objectif de design

La météo est **locale** : des fronts traversent la vallée — il pleut sur un bout de carte pendant que l'autre est clair. Un front met la pression sur les systèmes EXISTANTS (froid, Feu, chasse, déplacement, perception) sans mécanique parallèle : la météo module, elle n'invente pas. Le contrat « annoncé, pas surprise » est tenu *géométriquement* — le mur de pluie se voit venir à l'horizon parce que sa position est une fonction pure partagée sim/client. La courbe de pression économique du §8 vit dans la table de fréquence par acte : la pluie bénigne de l'Éclosion cède aux neiges puis aux blizzards du Grand Froid.

## Règles

### Le front (R1-R3)

- **R1 — Géométrie : une bande analytique qui traverse.** Un front est une BANDE de largeur `METEO.LARGEUR[type]`, perpendiculaire à sa direction, qui entre par un bord élu et traverse la carte en ~une demi-journée (`METEO.TRAVERSEE_TICKS`). Sa position est **calculée du tick** par une fonction pure `frontMeteoAt(state)` (interpolation linéaire — patron `brumeAt`/`frontActuel`), partagée sim/client. Le front vit dans `state.meteo` (record JSON nullable : type, bord d'entrée, direction, largeur, tick d'entrée — purgé à la sortie, patron `state.brume`). Le blizzard est une bande exceptionnellement large (~la carte) : « carte entière » par calibrage, pas par mécanisme.
- **R2 — Élection : un seul front actif, tout par hash2.** Par jour de saison, `hash2(jour, seed)` élit s'il y a un front (`METEO.CHANCE_PER_DAY[acte]`), son type (table `METEO.TYPES[acte]` — la pluie domine l'acte I, la neige entre en II, le blizzard hante II-III, l'orage vit en I-II), son bord, sa trajectoire et son heure d'entrée. **Au plus un front actif à la fois** — chaque jour reste lisible et racontable. Zéro tirage sur le PRNG d'état (patron réfugiés/Brume R9) : activer la météo ne décale AUCUN flux existant.
- **R3 — Brume × blizzard : exclusifs à l'élection.** Un jour éligible à la Brume n'élit jamais un blizzard (l'élection météo lit l'éligibilité Brume — les deux étant des fonctions pures du jour, l'exclusion l'est aussi). Les autres types coexistent avec la Brume : les planchers tiennent par construction (A5 de brume.md).

### Les effets (R4-R7)

Un type de front est un **vecteur sur quatre accroches** — tous les nombres dans le bloc `METEO` de `balance.ts` :

- **R4 — Le froid.** Sous l'empreinte, `baselineTemperature` subit `−METEO.COLD[type]` — une EXPOSITION de plus, exactement comme la Brume (R4) : amortie par l'abri, plancherée par le Feu, la source chaude et la `tenue_hiver`. Toute la chaîne vitale (dérive, hypothermie, vitesse, endurance) suit par construction, zéro code neuf côté vitals. Le blizzard est calibré létal en plaine de jour dès l'acte II (même arithmétique que la Brume : 90 − 25 − 55 = 10 < HYPOTHERMIA 20) ; le brouillard ne refroidit pas.
- **R5 — Le Feu sous la pluie : pression, jamais d'extinction.** Un front mouillé (pluie, orage, neige, blizzard) n'éteint **jamais** un feu — il multiplie la consommation de combustible des feux sous l'empreinte (`METEO.FEU_CONSO[type]`) : la tâche communautaire zéro devient plus pressante (§8) sans spirale de mort. **Poser un feu NEUF à découvert** (`!isSheltered`) sous front mouillé est refusé (message d'échec lisible) ; **rallumer un feu existant reste toujours possible** — l'ancre de respawn se rallume sous l'orage, c'est elle qui est sacrée.
- **R6 — La faune se terre.** Sous l'empreinte d'un front de type mouillé (table `METEO.QUIET` — le brouillard ne fait pas taire le gibier : c'est le front tactique, pas un front mouillé), le gate des naissances ambiantes se tait, avec exactement les conséquences du silence Brume. L'empreinte du front s'interroge par prédicat pur (`meteoQuiet`) — les entrées `faunaQuiet` ne portent que les silences ponctuels (Brume, pression de chasse) : un front mobile en sèmerait à chaque tick, et la coexistence des deux silences est acquise par construction (aucune purge croisée possible). Le retour du gibier après l'averse est une fenêtre de chasse lisible.
- **R7 — Vitesse et visibilité : pendant le front, pas après.** Sous l'empreinte, la vitesse de déplacement est multipliée par `METEO.SPEED[type]` (pas d'accumulation au sol — le malus cesse avec le front) et la portée de perception des IA (`aggroRange` et lois de détection) par `METEO.VISION[type]`, évaluée **au point de la CIBLE** (on se cache dans la pluie, on n'aveugle pas le loup au soleil). Le brouillard est le porteur principal de la visibilité (fort, sans froid — équilibrable isolément) ; ça coupe dans les deux sens : le raider approche couvert, l'embuscade aussi.

### La foudre (R8)

- **R8 — Un danger télégraphié, à ciel ouvert seulement.** L'orage EST une pluie (R4-R7) plus la foudre : des impacts élus par `hash2(id du front, créneau)` — `METEO.FOUDRE_PAR_MIN` par minute dans l'empreinte, positions et instants fonction pure du tick (le client dessine l'éclair depuis la même fonction, rien ne transite). Chaque impact est **annoncé `METEO.FOUDRE_TELEGRAPHE_TICKS` avant** au point visé (lueur au sol, grésillement — le patron wind-up, en plus long) : sous l'orage on lit le sol et on se décale. Dégâts `METEO.FOUDRE_DEGATS` dans `METEO.FOUDRE_RAYON` — sérieux, **jamais létal d'un coup à PV pleins**. Aucune frappe sur une empreinte `isSheltered` : l'abri immunise (« rentrez, ou courez entre les coups »). Cause de mort dédiée `lightning` (chronique). Les PNJ villageois rejoignent l'abri le plus proche pendant un front d'orage (comportement — le monde ne s'adapte pas, les habitants si).

### L'annonce (R9)

- **R9 — Deux vitesses.** Les fronts ordinaires s'annoncent **géométriquement** : on les voit venir (rendu du mur à l'horizon — chantier client) et on les entend avant de les voir (audio) — pas de toast météo. Le **blizzard s'annonce la veille au crépuscule** (patron Brume : il est trop large pour être esquivé, la réponse est PRÉPARER — rentrer le bois, remplir le garde-manger) : événement `blizzard_annonce` (chronique : « le vent du nord se lève — rentrez le bois ») + `blizzard_entre` / `blizzard_passe` au passage. Seul le blizzard entre dans la chronique de saison — la pluie de mardi n'est pas un fait mémorable, « le blizzard du jour 34 » oui.

### Déterminisme et interrupteur (R10)

- **R10 — Zéro tirage, interrupteur dédié.** Occurrence, type, trajectoire, impacts de foudre : tout par `hash2` — les suites replay/events passent inchangées (exigence, pas préférence — mémoire : le décompte d'entités décale le flux seedé). La météo vit derrière un **interrupteur dédié** `state.meteoActive` (patron `worldEvents`, mais SÉPARÉ : le banc doit pouvoir mesurer l'économie sans le bruit météo, puis avec — les seuils de famine du banc sont absolus), éteint par défaut au banc et dans les tests, allumé dans le vrai jeu.

## Critères d'acceptation

- **A1** — Même seed → mêmes fronts (jours, types, trajectoires, heures) et mêmes impacts de foudre ; replay exact avec météo active.
- **A2** — Le flux RNG des autres systèmes est bit-identique avant/après le chantier (suites replay/events existantes vertes sans retouche).
- **A3** — Sous blizzard en plaine de jour acte II, sans tenue : température < `HYPOTHERMIA`, PV qui baissent ; il sort de l'empreinte, il récupère (la dérive laisse fuir). Les planchers tiennent : bulle d'un Feu actif = aucun dégât ; `tenue_hiver` = jamais sous `TENUE_FLOOR`.
- **A4** — Aucun feu ne s'éteint par météo ; consommation mesurablement accrue sous front mouillé ; feu neuf à découvert refusé sous pluie, rallumage d'un feu existant toujours accepté.
- **A5** — le silence faune (`meteoQuiet`) couvre l'empreinte pendant la traversée et se lève après ; une Brume et un front de pluie simultanés ne se purgent pas mutuellement.
- **A6** — Foudre : aucun impact sur tuile abritée ; télégraphe ≥ `FOUDRE_TELEGRAPHE_TICKS` ; un avatar à PV pleins survit à un impact ; l'abri du point visé immunise au moment de la frappe.
- **A7** — Sous brouillard, la portée de perception effective des IA vaut `aggroRange × VISION.brouillard` (test unitaire sur la loi de détection, pas sur un cas).
- **A8** — Banc 6 cycles × 3 seeds, météo active : **zéro mort PNJ** par froid de front ou par foudre (les villageois s'abritent — patron A7 de la Brume).
- **A9** — Un jour de Brume n'a jamais de blizzard (multi-seed) ; jamais deux fronts actifs au même tick.
- **A10** — `meteoActive=false` → aucun front, aucun impact, `state.meteo` reste nul ; le banc scénario par défaut est inchangé au bit près.

## Hors périmètre (et où ça revient)

- **Le rendu** — chantier client séparé (da-rendu, scénario smoke dédié) : le mur de pluie visible à l'horizon, les rideaux, la lueur de télégraphe de foudre, l'audio (la pluie s'entend avant de se voir — `packages/client/src/audio`). Le contrat sim est prêt : `state.meteo` dans le snapshot + `frontMeteoAt` pure exportée d'`index.ts`.
- Accumulation au sol (boue persistante, congères), incendies de foudre (attendra un système de propagation du feu), vent comme champ, effets sur la repousse/l'agriculture, orographie — différés, chacun une décision à part.
- Les spécialistes qui lisent mieux (Chasse P3 prédit la météo, GDD §9) — avec les professions.
- La visibilité côté joueur (le rendu voit mal) est du chantier rendu ; R7 ne couvre que la perception des IA.

## Ajouts à `balance.ts`

Bloc `METEO` (ordres de grandeur, à calibrer en jouant et au banc) : `CHANCE_PER_DAY = [0.5, 0.65, 0.8]` (par acte), `TYPES` par acte (I : pluie 0.5 / brouillard 0.25 / orage 0.25 ; II : pluie 0.3 / neige 0.35 / brouillard 0.15 / blizzard 0.1 / orage 0.1 ; III : neige 0.5 / blizzard 0.3 / brouillard 0.15 / orage 0.05), `LARGEUR` (pluie 60, brouillard 50, neige 70, orage 55, blizzard ≈ carte), `TRAVERSEE_TICKS` (~une demi-journée), `COLD = { pluie: 10, brouillard: 0, neige: 25, orage: 10, blizzard: 55 }`, `FEU_CONSO = { pluie: 1.5, neige: 1.5, orage: 1.5, blizzard: 2, brouillard: 1 }`, `QUIET = { pluie/neige/orage/blizzard : vrai, brouillard : faux }`, `SPEED = { pluie: 0.95, brouillard: 1, neige: 0.9, orage: 0.95, blizzard: 0.8 }`, `VISION = { pluie: 0.85, brouillard: 0.5, neige: 0.8, orage: 0.85, blizzard: 0.6 }`, `FOUDRE_PAR_MIN = 3`, `FOUDRE_TELEGRAPHE_TICKS = ticksFor(1.5)`, `FOUDRE_DEGATS = 35`, `FOUDRE_RAYON = 1.5`. Événements : `blizzard_annonce` (+ `CHRONICLE_EVENT_TYPES`), `blizzard_entre`, `blizzard_passe` ; cause de mort `lightning`.
