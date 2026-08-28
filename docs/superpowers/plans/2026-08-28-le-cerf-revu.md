# Le cerf revu — le dortoir, les traces, la cendre, le coin vivant

*Brainstorm d'Alexis du 2026-08-28, point par point (une question à la fois, reco d'abord — toutes tranchées). Spec : `docs/specs/faune.md` R23-R27 + A37-A44. Statut : **CONSTRUIT le jour même** — six commits sim (cendre → placement → dortoir → harde 5-8 → coin vivant → pastille), la pastille et les traces client, l'animation du déplacement (agent da-rendu, captures mesurées au pixel), la revue déterminisme passée (deux notes cosmétiques, corrigées). Les quatre suites vertes.*

## Ce qui reste à l'œil d'Alexis (le critère final)

- **Le rythme perçu des bonds de fuite à 60 fps réels** (le headless rend ~1 im/s) — `pnpm dev`, lever une harde.
- **La densité des traces** (59 sur le monde joué : 29 fumées, 30 frottis) et leur lisibilité au zoom de jeu.
- ⚠ **MESURÉ, préexistant, structurel : les coulées et les coins ne se rencontrent JAMAIS.** Deux graines sondées (7 et 2026) : fins de coulées à 28-448 tuiles du coin le plus proche (médiane ~150), une seule attache limite sur 18 coins. Cause : deux semis INDÉPENDANTS — les coulées partent des CŒURS de forêt vers l'eau (forêts-vivantes §4), les coins d'un Poisson à eau+couvert. Conséquences dormantes : `couleeStep` (la descente boire du crépuscule, chasse R5quater) ne se déclenche jamais sur le monde joué, et les empreintes de R24 n'existent pas. Élargir `COULEE_ATTACHE` ne répare rien (à 55+ tuiles, boire sortirait la harde de son canton de 46). **Reco acceptée par Alexis et CONSTRUITE le jour même** : chaque coin sème sa coulée au worldgen (`zonegen-coulees.ts`, même champ, même descente), l'attache scindée en possession (62, dérivée) et raccord (28). Mesuré après : 5 coins sur 8 attachés (seed 7, contre 0), 60 empreintes visibles en jeu (contre 0), les 3 coins restants ont leur eau imprenable à pied (falaises) et se taisent comme un bois sec.
- Le seuil « organe cendré » d'un coin ne juge que le CŒUR (la tuile du coin) — suffisant tant que le front avance en marée ; à re-regarder si un jour il mite.

## Les décisions, dans l'ordre où elles sont tombées

1. **Le coin de chasse gagne un troisième organe** : gagnage + eau (existant) + **couvert-dortoir** (massif boisé ≥ ~10 tuiles contiguës à ≤ `GROUND_COVER_NEAR`). → R23.
2. **Des traces mènent au coin** — décor logique (v1 sans interaction), dérivé des mêmes données que le comportement : empreintes le long des coulées, frottis en lisière de dortoir, fumées au gagnage. Trouver le coin pose sa **pastille** sur la carte (patron `knownPois`) ; la carte est une mémoire — la pastille d'un coin mort ne s'éteint qu'à revisite. → R24.
3. **La cendre** : non-habitat absolu, fuite comprise (paroi qu'on longe), **plus** la loi du monde — DoT rapide sur toute faune non-cendreuse au-delà de la frange (frange = 0, la grammaire de bandes du froid `cendre.md` R22). Mort par cendre ≠ `slainClean`, pas de silence R16. Coin mangé → extinction. *(La double couche « comportement + loi » vient d'une contre-proposition d'Alexis à mon mur seul — meilleure : le monde se nettoie tout seul et ça se raconte.)* → R25.
4. **La journée dessinée** : nuit au dortoir (sens bridés, pas de sentinelle, couchés espacés), guetteur levé par le bruit, **un seul kill par nuit** (le premier sang réveille tout), aube en file vers le gagnage, jour en pâture, crépuscule à la coulée puis retour. → R26.
5. **Une harde = son dortoir** (jamais deux hardes entremêlées — c'est ce qui évite « 20 cerfs dans un bosquet » la nuit, l'objection d'immersion d'Alexis sur le plafond de 30).
6. **Harde 5-8** (était 3-5 ; le cerf élaphe forestier réel vit en hardes de biches 5-20 — on prend le bas pour garder 2-3 hardes par coin et une approche nocturne jouable). `GROUND_CAP` 30 **inchangé**.
7. **Le coin vivant** : dortoir cendré/occupé (village, bâti, tanière) → re-choix du meilleur massif du canton ; plus aucun organe → le coin meurt (harde dissipée hors écran) et **renaît ailleurs** (RNG d'état, mêmes règles). Une seule maison ne tue jamais un coin — sinon c'est une arme de sabotage. → R27.
8. **L'animation du déplacement** (client) : cycles de pattes cadencés sur la distance, bond de fuite avec ombre détachée, micro-vie au broutage, transitions lever/coucher. Validation sur captures smoke.

## État des lieux (relevé du 2026-08-28)

- Tout le comportement gibier vit dans `packages/sim/src/faune.ts` (cascade de gardes dans `faunaStep`, pas d'enum d'état) ; réglages `MONSTER_DEFS.deer` + blocs `FAUNA`/`HUNT` de `balance.ts`.
- **Existe déjà et se réutilise** : les coulées (`map.coulees`, descente au crépuscule + boire), la sentinelle tournante, la contagion d'alarme, le repos R10 (mais *sur place* et *resserré* — c'est ce qui change), la carte plein écran + brouillard + pastilles `knownPois`, le froid de la vieille cendre (`froidDeCendre`, frange = 0), les bandes de cendre (`bandeDeCendre`).
- **N'existe pas** : conscience de la cendre dans `faune.ts` (zéro occurrence), notion de dortoir, traces au sol, re-vérification d'éligibilité d'un coin, re-semis en cours de partie, animation de marche (4 textures fixes : base/graze/flee/bed).
- **MESURÉ (2026-08-28, sonde `tools/__compte-coins.mts` via `carteDeTest`, monde joué = Racine à `JOUEURS_CIBLE`, cartes 1581×~840) — la ligne de base AVANT R23** : seed 3 → **7 coins** (4 clairières, 3 souilles) · seed 7 → **8** (6 + 2) · seed 2026 → **10** (7 + 3) · seed 909 → **12** (9 + 3). Soit **7-12 coins, dont 4-9 clairières à cerfs** — le T0 est bien plus pauvre que l'ancienne vallée entière (19 coins). Conséquence : perdre UN coin y pèse lourd — la renaissance de R27 n'est pas un luxe, et si R23 (le couvert) fait tomber ce compte, l'espacement du semis se rediscute (A37). *(Au passage, la sonde a coûté trois faux départs consignés pour la suite : générer avec `joueurs=1` n'est PAS le monde joué ; générer pleine taille hors cache OOM-tue la machine (11 Go) ; et `carteDeTest` rend une `CarteZonee` — c'est son `.map` qu'attend `placeHuntingGrounds`, l'oublier donne `width=undefined` et une boucle qui mange le tas.)*

## Ordre de chantier proposé

Chaque étape est livrable seule, testée, dans l'ordre des dépendances :

1. **R25 — la cendre** (le plus indépendant, corrige un trou réel dès aujourd'hui) : non-habitat + paroi en fuite + DoT. Tests A39-A40. ⚠ cadran cendreux : choisir jour/heure du montage (mémoire projet).
2. **R23 — le placement** : `GROUND_COVER_NEAR` + massif plancher dans `placeHuntingGrounds`, **mesure avant/après** du compte de coins et de la couverture (A37). C'est ici qu'on découvre si l'espacement du semis doit bouger — décision d'Alexis si oui.
3. **R26 — le dortoir et la journée** (le gros morceau) : élection du dortoir par harde (dérivée, déterministe), trajets aube/crépuscule, sommeil aux sens bridés, guetteur, premier sang. Tests A41-A43. ⚠ harde 5-8 en **commit isolé** (décalage du flux RNG — casse attendue de tests sans rapport, planchers de suites à surveiller).
4. **R27 — le coin vivant** : éligibilité re-vérifiée, re-choix du dortoir, extinction + re-semis par RNG d'état. Tests A44 + replay (A9) à travers une relocalisation.
5. **R24 — les traces et la pastille** : semis dérivé des données du coin (sim), rendu clutter (client), découverte + pastille + extinction à revisite (client/UI). Test A38.
6. **Animation** (client, parallèle possible dès 3) : frames procédurales par allure, phase sur distance parcourue, bond de fuite. Captures smoke à montrer AVANT câblage complet.

## Ce qu'on ne sait pas encore mesurer / à trancher en route

- Le **seuil** exact de « organe cendré » (fraction de tuiles du gagnage/dortoir) — à poser en construisant R27, sur une carte regardée.
- La **taille plancher** du massif-dortoir (« une dizaine de tuiles ») — à calibrer en regardant une carte, comme tout réglage de worldgen.
- Les seuils de bruit du sommeil (`SLEEP_SENSES`, distance marche vs course) — à calibrer en jouant (balance.ts).
- L'espacement du semis (`GROUND_SPACING`) si R23 fait trop chuter le compte de coins — décision d'Alexis, chiffres à l'appui.
