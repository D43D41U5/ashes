# Calibration de saison entière — banc long, passe 1 (2026-08-16)

> **Nature.** Premier relevé du « seul vrai reste de GATE 1 » (`gate1-finition.md` P4) : la
> saison ENTIÈRE jouée au banc, 60 jours × 4 graines, relevé par cycle. Instrument :
> `tools/banc-saison.mts` (même monde que `pnpm scenario` — `construireMondeDuBanc`, parité
> d'amorce comprise —, graine paramétrable, JSONL par cycle dans `scratchpad/banc-saison/`).
> Je rapporte le MESURÉ ; les nombres et les remèdes sont des décisions d'Alexis.

## Les deux limites de l'instrument (à lire avant les nombres)

1. **Le banc n'a pas de joueur.** Toute règle qui vise l'avatar mesure zéro : personne ne
   défend un voisin, ne commerce, ne recrute des réfugiés côté joueur. Le banc mesure la
   dynamique du monde PNJ *seul* — c'est le décor dans lequel le joueur jouera, pas sa partie.
2. **Deux horloges.** `calendarScale` ≈ 30 fait d'un cycle réel un jour de saison : tout ce
   qui se cadence en cycles réels (péremption, cadences de convois/réfugiés) tourne ~30× plus
   vite qu'en vrai jeu. Les COMPTES absolus de convois/réfugiés ci-dessous sont des artefacts
   d'horloge ; les MÉCANISMES (mort définitive, recrutement nul) ne dépendent pas de l'horloge.

## Le fait central — MESURÉ sur 4 graines sur 4

**Le monde PNJ entier meurt entre le jour 20 et le jour 36, sur toutes les graines.** Les
actes II et III, les convois, les réfugiés, l'évacuation et l'Arche se jouent dans une vallée
vide — 24 à 40 jours de simulation d'un monde mort.

| graine | coins de chasse | marge ciblage | 1ʳᵉ chute | monde mort | morts | hordes | relevés d'affamés |
|---|---|---|---|---|---|---|---|
| 2026 (celle du jeu) | 2 | 91 % | j20 | **j24** | 10 | 15 | 24 |
| 7 | 1 | 57 % | j22 | **j30** | 10 | 17 | 24 |
| 31 | 3 | 52 % | j18 | **j23** | 10 | 9 | 72 |
| 1234 | 2 | 27 % | j18 (Foyer : j6) | **j33-36** | 11 | 9 | 72 |

## Le mécanisme — l'attrition sans remplacement

**Ce n'est PAS l'économie.** Sur 2026 et 7, les villages meurent avec leurs greniers garnis
(nourriture 12-19) et leurs Feux nourris (fuel > 100) — la boucle récolte/nourrit/répare
fonctionne. La faim n'est déclencheur que sur 31 (zone du neutre pauvre en baies, famine au
j9) et n'est qu'un symptôme tardif ailleurs.

**C'est un cliquet démographique.** MESURÉ identique sur toutes les graines :
- `member_joined` = 10 — les dix fondateurs, puis plus jamais ;
- `settler_arrived` = 0 — aucun colon, jamais ;
- `refugees_arrived` = 10 groupes par saison qui passent sur les routes… `refugees_recruited`
  = **0** — les villages PNJ ne recrutent jamais (le verbe est joueur-seulement) ;
- pendant que 9 à 17 hordes par saison (+ 44 monstres ambiants sur 2026 dès le j5) prélèvent
  ~1 membre tous les 2-3 jours, définitivement.

Population fermée + pression ouverte = mort par arithmétique vers le j25, quelle que soit la
graine. Le signal de juillet (« la Meute s'auto-détruit avant J6 ») n'était pas un problème
de Meute : c'est la loi de TOUT village PNJ, que les correctifs de famine du 2026-07-24 ont
seulement retardée (l'économie tient désormais ; la démographie, non).

**Deux accélérateurs de PLACEMENT, secondaires mais réels** :
- graine 1234 : le Foyer naît sous la pression des monstres de POI — Feu affamé au j2, village
  mort au j6, sans une seule famine ;
- graine 31 : le neutre naît dans une zone sans baies — famine au j9 (le repli hors-zone du
  2026-07-24 nourrit mal un village LOIN de tout).

## Attrapé et déjà corrigé (commit `7072b00`)

**L'Arche repartait à chaque tick.** `evacuation = null` au départ re-remplissait la condition
d'ouverture : ouvre→part à chaque tick dès le j58 — 57 600 `evacuation_opened` + 57 600
`ark_departed` PAR JOUR (mesurés sur les 4 graines), embarqués recomptés en boucle au verdict
Foyer, un tirage RNG par réouverture, chronique inondée. Verrou `arkDeparted` posé (patron
`megaHordeSpawned`), test durci (215 départs sans le fix, 1 avec), revue `determinisme-sim`
au dossier. Au passage : `season_ended` tombe au jour 61 — un banc de 60 jours s'arrête une
journée trop tôt pour les verdicts ; les prochains runs vont à 62.

**Contre-vérifié in situ** (2026 rejoué à 62 jours avec le verrou) : `evacuation_opened` 1,
`ark_departed` 1, `season_ended` ×1 au jour 61 — et les cycles 1-57 sont **au bit près**
identiques au run pré-fix (hors temps mural) : le verrou est prouvé inerte avant le départ,
sur données réelles et pas seulement en revue.

## Ce qui MARCHE, mesuré au même banc

- L'économie de subsistance : greniers positifs, Feux nourris, `village_stage_up` ×5-6 par
  graine dans les premiers jours — tant qu'il y a des bras, le village vit.
- Le calendrier de saison : actes aux j21/j42, méga-horde, évacuation j55, départ j58 —
  toute la machinerie du finale se déclenche (elle joue juste devant une salle vide).
- Le coût : ~2 min/jour simulé à monde vivant (60 j ≈ 1 h 45 par graine) — les optimisations
  de horde de juillet-août tiennent sur la durée.

## Passe 1bis — l'effet du R12 (2026-08-17, décision ① tranchée et livrée)

Alexis a tranché la question ① : **les villages PNJ recrutent, plafonné à l'effectif de
fondation** (R12, commit `ddd4833`). Re-mesuré à 62 jours sur 2026 et 7 :

- **Le mécanisme marche** : 4 recrutements/saison (un par groupe survenu avant la fin du
  monde — la cadence de 6 jours est la borne), les villages tiennent à effectif PLEIN
  nettement plus longtemps (2026 : Foyer et Meute pleins au j12 contre une saignée dès le
  j5 ; 7 : Foyer plein jusqu'au j24 contre une chute au j22), la population se renouvelle
  (20 morts au lieu de 10 sur 2026 — deux générations).
- **L'issue ne change pas : effondrement vers j26-30 sur les deux graines.** L'arithmétique
  est chiffrée : réparation ~0,17 membre/jour (1 groupe de 3 tous les 6 jours, pour TROIS
  villages) contre ~0,4/jour de pertes aux hordes. **La contrainte liante est le taux
  d'échange milice/horde — la question ② devient décisive.**
- Le verrou de l'Arche tient in situ (1 ouverture, 1 départ, `season_ended` au j61, deux
  graines).

## Passe 2 — les quatre règles, la boucle mesure→règle→mesure (2026-08-17/18, « fais tout »)

Les quatre remèdes du diagnostic (β-garde, γ pansement, α2 la-nuit-rassemble, α1+α3
l'enceinte-d'abord) ont été livrés, et le banc a piloté DEUX itérations de calibrage :

- **Itération 1 attrapée par le banc** : la cadence enceinte à 120 s asphyxiait l'économie
  du bois (Feu affamé au j6) → 240 s, réserve de bois 12 → 18.
- **Itération 2, le vrai coupable** : un LIVELOCK préexistant du chantier — l'échec de la
  forge du marteau (`dropTask(false)`) rendait la tâche re-réclamable au tick suivant par
  le même PNJ ; R15, en mettant un ordre de chantier en tête de tableau AVANT l'économie
  de pierre, l'a rendu fatal (réclame→échoue→lâche à 20 Hz, 122 récoltes/6 j contre 436,
  village mort au j3 — et 67 % d'oisiveté mesurée sur le monde d'AVANT : la boucle mordait
  déjà). Corrigé (`dropTask(true)`, la doctrine écrite du fichier) — et le monde d'avant
  s'en trouve AUSSI amélioré (462 récoltes/6 j après fix, > 436).
- **Itération 3, le raffinement de γ** : céder la défense sans fibre nulle part est une
  désertion, pas un soin (graine 2026 : 10 morts aux j6-12, greniers pleins, 2 fibres pour
  un bandage à 3) → le sang ne cède la défense que si un bandage EXISTE.

**AVANT → APRÈS (62 jours, graines 2026 et 7)** :

| mesure | avant le paquet | après |
|---|---|---|
| famine (relevés d'affamés) | cause n°1 — 46 % des morts, jusqu'à 298 relevés | quasi éteinte (27 sur 2026) |
| acte I | saignée dès j5-9, greniers pleins | effectif PLEIN jusqu'à j12-18 (sauf le Foyer 2026, broyé par ses monstres ambiants — l'accélérateur de placement, question ③) |
| enceinte | jamais commencée du vivant du village | montée dès j1,5 — 28 arêtes à j4,5, gated par le bois ensuite |
| réparation démographique | 0 recrutement, 0 pansement | 1-4 recrutements + 5-7 pansements par saison |
| dernière chute | j24-36 | **j38-39** |

**La frontière restante est l'acte II** : hordes à 8, cadence accrue — la récolte se fait
épingler, la nourriture s'effondre en quelques jours (greniers 0 avec Feux pleins), et les
villages tombent entre j21 et j39. Ce n'est plus un bug ni un cliquet : c'est LA courbe de
difficulté voulue ou non — la question ④ ci-dessous, désormais seule en jeu avec la ③.

## Passe 3 — la garde de placement R17bis, et ce que la contre-mesure a montré (2026-08-18, question ③ tranchée : « vas-y, enchaîne »)

**La mesure a d'abord renversé l'attribution.** La sonde statique neuve (`tools/diag-placement.mts`)
et deux autopsies dynamiques ont montré que le tueur des Foyers n'était PAS le « POI hostile » du
récit de la passe 1 — le sanglier de la tanière à 40 tuiles n'a **aucun** mort à son compte sur
13 jours — mais le **territoire du coin de chasse** : la faune naît en anneau autour de tout
avatar (les PNJ de village sont des hôtes comme les joueurs, vérifié dans `advanceFauna`), donc
un Feu à moins de `GROUND_RADIUS + SPAWN_RING_MAX` (46+42 = 88) tuiles d'un coin reçoit des
loups à domicile. MESURÉ : graine 1234 (chasse@76), **les 4 fondateurs du Foyer saignent à mort
au JOUR 1** après le combat contre la meute née de l'anneau (le grenier de fondation porte
2 fibres pour un bandage à 3 — γ refuse à raison de déserter) ; graine 2026 (chasse@56), les
corvéables blessés DEHORS (15-24 t) se vident, leurs cadavres lèvent la contagion, et les
cendreux ambiants achèvent le village aux j11-12.

**La garde livrée (worldgen R17bis/A17bis, commit de ce jour).** `emplacementsDeVillage` exige un
site TENABLE : hors du territoire de chasse (écart DÉRIVÉ des deux constantes de la faune, jamais
écrit), à ≥ `ECART_NID` (32) du rectangle d'un lieu à monstre résident (dérivé de
`POI_TYPES.monster`), et ≥ `BAIES_MIN` (4) baies dans la maille de fondation. Le paramètre
dangers est OBLIGATOIRE (le compilateur a forcé les trois hôtes et tous les outils). R17 est
intact : `found_village` ne consulte pas la liste, le joueur fonde où il veut. Garde A17bis
exhaustive (3 graines production), A17 reste vert, 1851 tests sur 4 suites.
*(Limite connue du plancher de baies : la maille ALIGNÉE sous-compte le vrai bassin — mesuré
jusqu'à ×4 (7 en maille, 30 en disque de rayon 40). Le plancher n'exclut donc que le désert
franc, et c'est suffisant : voir plus bas, la famine de démarrage n'est PAS une pauvreté de site.)*

**AVANT → APRÈS (62 jours ; « avant » = passe 2 pour 2026/7, passe 1 pré-paquet pour 31/1234)** :

| graine | avant | après | verdict |
|---|---|---|---|
| 2026 | Foyer broyé acte I (chasse@56) ; dernière chute j38-39 | **Braises anéanties NUIT 1 par un RAID de la Meute** (autopsie : 3 morts dans le carré, 0 loup, 0 faim) ; Gué j22, Levant j26 | pire — par la géométrie, pas par la garde |
| 7 | Foyer plein j24 ; chute vers j38-39 | **7 morts sur 7 par la FAIM, oisifs, dans le carré** (Gué j5-6, Braises j10) | pire — famine de démarrage, pas la garde |
| 31 | chute j18, monde mort j23 | Braises j16, Levant j25, **Gué à effectif plein j36, mort j40 sous les hordes d'acte II** | nettement mieux (+17 j, record du banc) |
| 1234 | Foyer mort j6 (loups), monde mort j33-36 | jour-1 éteint (Foyer plein j7), érosion j8-11, monde mort j31 | l'accident visé est éteint, l'issue égale |

**Le point central : la garde a tué exactement ses tueurs.** Sur les trois graines autopsiées
après garde (2026, 7, 1234), **zéro villageois tué par les loups d'anneau, un nid ou un
désert** — les loups qui restent ne prennent plus que des réfugiés sur les routes (victimes
« ? » des autopsies), et l'unique mort de nuit-1 sur 1234 est une hémorragie post-horde de
siège. **La contre-mesure nomme les trois dynamiques qui portent désormais toute la
mortalité** :

1. **Le raid de la Meute, dès la nuit 1.** `npc-errands` : dès `RAID_MIN_ALIVE` (3) vivants, la
   Meute envoie `RAIDERS_PER_RAID` (2) raiders chaque nuit sur le village le plus proche À VOL
   D'OISEAU — un village de fondation (3 membres, 0 mur, 2 fibres) ne survit pas à sa première
   nuit s'il est le plus proche. Avant-garde, la marge de 91 % (2026) aiguillait tout sur le
   Foyer déjà condamné par les loups : le neutre paraissait sain par accident.
2. **La famine de démarrage, sensible à la géométrie fine.** Graine 7 : deux villages meurent
   oisifs, greniers à zéro en 2-5 jours, sur des sites à ~30 buissons de rayon de cueillette —
   dont un site IDENTIQUE à celui qui survivait 24 jours sur l'ancien tirage. Ce n'est ni la
   richesse du site ni la garde : c'est la boucle de cueillette (famille de la question ②) qui
   décroche sur certaines géométries. À sonder (`trace-corvee` ?) avant tout réglage.
3. **La courbe d'acte II** — la question ④, enfin isolée : sur 31, le meilleur monde jamais
   mesuré tient à effectif plein jusqu'à j36 et tombe au j40 sous 12→19 hordes, nourriture
   jamais en cause. C'est la mort « propre », celle dont la ④ doit décider si elle est voulue.

**Leçon d'instrument, à consigner.** Le banc à trois villages est HYPER-SENSIBLE au tirage de
placement : filtrer la liste recompose le max-min, la marge de ciblage passe de 91 % à 28,6 %
(2026), et la doctrine du banc lui-même dit que sous une marge basse « on mesure une guerre,
pas une économie ». Toute comparaison avant/après de graine à graine mesure donc la LOTERIE de
géométrie autant que la règle testée. Piste (décision à part, c'est l'instrument) : asseoir la
marge dans `troisVillages`, ou moyenner sur plusieurs tirages par graine.

## Les décisions que ce relevé pose (à Alexis, une à la fois)

1. ~~**Les villages PNJ doivent-ils recruter les réfugiés ?**~~ **✅ TRANCHÉ ET LIVRÉ
   (2026-08-17, R12)** — voir la passe 1bis ci-dessus.
2. **Le siège cendreux — reformulée après autopsie (2026-08-17, `diag-mort-pnj`, 37 morts).**
   Ce n'est PAS un taux d'échange au combat : 33/37 meurent DANS le carré du village, 30/37
   la nuit, et la première cause est **la faim au grenier VIDE (46 %)** — le siège étrangle
   la récolte (137 → 9 gestes/jour) et la famine achève ; les cendreux ne tuent directement
   que 32 % (dans l'enceinte — comment ils entrent reste à sonder) ; **19 % saignent à mort
   faute de bandage** (verbe joueur-seulement) ; 1 seul mort en corvée lointaine. Trois
   leviers, un par cause : (α) l'enceinte compte — la horde bute sur les murs et les attaque,
   elle n'entre que par la brèche ; (β) casser la spirale famine — dont le garde-fou R12
   « pas de recrutement dans un grenier vide » (le piège à réfugiés est observé : 3 recrues
   au j24, mortes de faim au j25) ; (γ) le PNJ blessé se panse au village (fibre du grenier),
   sinon 1 mort sur 5 reste inévitable quelle que soit la règle de siège.

   **α précisée par la sonde de siège (2026-08-17, `diag-siege`, 23 sièges).** Trois régimes
   mesurés : sans murs (j1-5), entrée libre ; logis debout sans anneau (j6-19), les cendreux
   passent ENTRE les maisons — points d'entrée fixes, 0 PV de dégâts aux murs sur 17 sièges
   (on ne bat pas ce qu'on contourne) ; Feu affamé + acte II (j20+), les murs fondus par
   l'entretien sont battus et rasés, le Feu tué — la mécanique de brèche EXISTE et marche.
   **Le fait décisif : l'enceinte du plan n'est jamais fermée de son vivant** — logis
   d'abord, ~2,3 arêtes/jour de chantier, l'anneau en veut ~50 ; première palissade au j25,
   rasée le soir même. Les leviers d'α deviennent : **α1** l'ordre du chantier (l'anneau
   avant/avec les logis) ; **α2** le repli nocturne des oisifs (les morts hors murs à
   7-8 t) ; **α3** la calibration chantier/rayon/cadence.
3. ~~**Un village qui naît sous un Repaire / dans une zone sans baies est-il un sort voulu
   ou un défaut de placement ?**~~ **✅ TRANCHÉ ET LIVRÉ (2026-08-18, R17bis)** — défaut de
   placement ; voir la passe 3 ci-dessus (et la vraie cause mesurée : le territoire du coin
   de chasse, pas le Repaire).
4. **Un monde 100 % mort avant l'acte III est-il un état acceptable de la Veillée ?** Le GDD
   veut des villages qui PEUVENT tomber — tous, toujours, avant la mi-saison est une autre
   chose. **Reformulée par la passe 3 :** les accidents de naissance sont éteints, et TOUTE la
   mortalité restante passe par trois boutons nommés — (a) le raid Meute nuit-1
   (`RAIDERS_PER_RAID`, ciblage au plus proche dès la fondation), (b) la boucle de cueillette
   qui décroche sur certaines géométries (à sonder avant réglage), (c) la cadence/taille des
   hordes d'acte II (le meilleur monde meurt j40 à greniers pleins). La ④ devient : *quelle
   courbe veut-on, et lequel de ces trois boutons la porte ?*

*(Rappel : le chantier « IA-village » reste en pause et flaggé — ces questions sont des
décisions de design sur les règles, pas une réouverture de ce chantier-là.)*
