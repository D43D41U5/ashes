# Mesure des Cendreux — une nuit par acte, avec un corps qui marche (2026-08-21)

*Instrument : `tools/diag-cendreux.mts` (neuf). Vraie carte du banc (`construireMondeDuBanc`,
548 × 342), deux graines (2026, 77), trois nuits entières de 18 min réelles (jours 10 / 30 / 50 =
actes I / II / III), six comportements scriptés du joueur. 36 nuits jouées. Le joueur ne meurt
pas (PV remis à 1 000 à chaque tick, la perte est relevée) ; sa température court. Commande :*
`node --import tsx tools/diag-cendreux.mts --seeds=2026,77 --jours=10,30,50`

## Ce que ça mesure, et ce que ça ne mesure pas

| Colonne | Ce qu'elle lit | Limite connue |
|---|---|---|
| réveils / cris | `cendreux_risen`, `cendreux_cri` | — |
| rampants (pré / mort) | part de rampants parmi les réveils, bucketés par `densiteDesMorts` au site (≥ 0,5 = sol mort) | 2 graines : bruyant |
| acquis, dist. | acquisition **par les yeux** : `lastSeen` = position exacte du joueur (un réveil naît déjà ciblé, la chaleur désigne sans voir — ni l'un ni l'autre ne comptent) | le bâtisseur pose un mur sur SA tuile : l'impact égale sa position → 1-2 fausses « acquisitions » à 6-8 t |
| détournés / impacts | Cendreux dont `lastSeen` = point d'impact, hors vue du joueur | — |
| extrapol. justes | le joueur repasse à 2 t du point extrapolé sous 30 s | **artefact** : le marcheur tourne en boucle de 12 tuiles, il repasse toujours — la colonne ne dit rien de R28 |
| morsures / dégâts | perte ≥ 20 PV en un tick = morsure de Cendreux ; `dégâts` = toute perte (loups et froid compris) | les 2 000-12 000 PV d'acte I sont des LOUPS (la nuit d'acte I n'envoie que des loups — A13) |
| pic / plafond | Cendreux vivants au plus fort / `plafondGlobal` | le pic compte aussi ~7 de sédiment hors plafond (Repaires, convois) |

## La table (moyennes sur 2 graines)

```
jour  comportement   réveils  rampants(pré/mort)  acquis  dist.acq  détournés/impacts  morsures  dégâts  T°min  pic/plafond  ms/tick
 10   feu-immobile     0.0              — / —     0.0       0.0            0.0 / 0        0.0       0     71       7.0/20     1.92
 10   marche           0.0              — / —     0.0       0.0            0.0 / 0        0.0    4103     64       7.0/20     2.45
 10   pas-lent         0.0              — / —     0.0       0.0            0.0 / 0        0.0    1821     64       7.0/20     2.46
 10   sprint           0.0              — / —     0.0       0.0            0.0 / 0        0.0    1738     64       7.0/20     2.56
 10   bucheron         0.0              — / —     0.0       0.0          0.0 / 158        0.0   10227     65       7.0/20     2.39
 10   batisseur        0.0              — / —     0.0       0.0           0.0 / 10        0.0       0     65       7.0/20     1.78
 30   feu-immobile     0.0              — / —     0.0       0.0            0.0 / 0        0.0       0     71       7.0/36     2.02
 30   marche           1.5            0 % / —     1.5       2.1            0.0 / 0        1.0    3727     35       8.0/36     2.61
 30   pas-lent         1.0            0 % / —     1.0       1.1            0.0 / 0        5.5    1562      0       8.0/36     2.54
 30   sprint           1.0            0 % / —     1.0       2.8            0.0 / 0        4.5    2197      8       8.0/36     2.53
 30   bucheron         1.5          100 % / —     0.5       1.7          0.0 / 158        2.0    2168     20       8.0/36     2.22
 30   batisseur        0.5            0 % / —     0.5       2.4           0.0 / 11       30.5    1469     20       7.5/36     1.62
 50   feu-immobile    74.0        50 % / 41 %     0.5       1.3            0.0 / 0      411.5   19950      0      33.0/52     2.22
 50   marche          56.5           24 % / —    52.5       4.1            0.0 / 0      383.0   22664      0      59.0/52     6.25
 50   pas-lent        66.5         0 % / 43 %     1.0       1.2            0.0 / 0       17.0    4997      0      33.0/52     2.61
 50   sprint          27.0           13 % / —    27.0       5.5            0.0 / 0      267.5   16914      0      33.5/52     4.54
 50   bucheron        38.5         0 % / 47 %     1.5       2.9         11.0 / 158      375.0   19099      0      33.0/52     2.39
 50   batisseur       53.0        40 % / 32 %     1.5       6.7           1.0 / 10        0.0     275     16      33.0/52     2.13
```

Distance d'acquisition par ALLURE (toutes nuits, toutes graines) :

| allure | n | moyenne | max |
|---|---|---|---|
| marche | 139 | **4,1 t** | 6,7 t |
| pas lent | 4 | **1,1 t** | 2,0 t |
| sprint | 28 | **6,6 t** | 10,7 t |
| immobile | 6 | 4,2 t | 7,6 t *(dont 4 artefacts du bâtisseur ; les 2 vraies sont à 1,3 t, au contact)* |

Détournés par une secousse : n = 24, à 3,0 t en moyenne, 8,7 t au plus loin.

## Ce qui est MESURÉ, règle par règle

**R24 — la vue honnête tient ses promesses, au chiffre près.** Le marcheur est acquis à 4,1 t
(vue nominale 5, moins l'approche), le sprinteur à 6,6 t et jusqu'à 10,7 (le sol porte au-delà
des yeux : 5 × 1,6 = 8, litière comprise), le pas lent à 1,1 t (2,75 prévu, mesuré au contact
ou presque). **Le pas lent divise les morsures par 15 à 25** sur une nuit d'acte III (17 contre
383 pour le marcheur, 268 pour le sprinteur). C'est LE verbe de la nuit, et il marche.

**R24bis — l'immobile au feu est mordu.** La conséquence non tranchée du matin (« un joueur
immobile n'est vu qu'à 1,25 t ») est SANS EFFET pratique : le Cendreux qui vient à la chaleur
s'arrête contre le feu, donc contre le joueur assis à côté — plancher de contact, et il mord.
411 morsures sur la nuit. Rien à changer.

**R25 — la secousse existe, elle pèse peu.** 11 Cendreux détournés sur 158 coups de hache (7 %)
à 3 t en moyenne ; 1 sur 10 poses. En acte I-II il n'y a personne à détourner (0 réveil, ou 1) ;
en acte III ils sont déjà sur vous. Elle ne vaut que dans l'intervalle étroit « un mort éveillé à
5-9 tuiles qui ne vous a pas encore vu » — rare dans une nuit jouée.

**R26 — le rampant est là, sa part est bruyante.** 13 à 50 % des réveils en pré, 32 à 47 % près
d'un sol mort (PART_MIN 0,1 / PART_MAX 0,4 sont des ordres de grandeur ; deux graines ne
suffisent pas à les recaler). Sa part des morsures n'est pas mesurée (à ajouter si on calibre).

**R28 — non mesurable avec ce script** : le circuit en boucle rend « juste » toute
extrapolation. Il faudrait un marcheur qui fuit en ligne puis tourne.

**⑳ — le plafond global est LA borne, et elle est atteinte chaque nuit d'acte III.** Pic 59/52
(52 + 7 de sédiment) dans 5 nuits sur 6 sur la graine 77, 2 sur 6 sur la graine 2026.

## LE FAIT QUI DOMINE TOUT : la cascade du cri

À l'acte III, **un seul regard posé sur vous** déclenche la chaîne ④⑤⑥ : le crieur plante
5 réveils (rond(6 × 50/60)), chaque réveil sort ciblé sur vous et crie à son tour 30 s plus
tard. Mesuré : **15 à 54 cris par nuit, 27 à 147 réveils**, le plafond global (52) saturé en
deux à trois minutes, et **250 à 520 morsures** sur un corps qui ne se défend pas — soit,
à 34 PV la morsure, un joueur tué **170 à 280 fois** dans la nuit. La nuit d'acte I n'envoie
que des loups (A13) ; celle d'acte II, un seul Cendreux ; celle d'acte III, la vallée.

Deux lectures sont possibles, et ce n'est pas à l'instrument de choisir :

- c'est le **crescendo voulu** (« crescendo au plafond PILE », contrat livré ce matin : 56/56
  au jour 55) — la dernière décade est injouable hors d'un village, et c'est le propos ;
- c'est un **emballement** : la cascade ne laisse pas de rampe entre « un mort m'a vu » et
  « la vallée est sur moi » — 2-3 minutes, là où le GDD (§9bis) veut un danger *annoncé*.

Le seul abri mesuré est le **village** : le bâtisseur dans le carré du Feu encaisse 0 morsure
(milice + murs), contre 411 pour l'homme seul à son feu de camp.

## Perf

Le tick nominal est à 1,6-2,5 ms sur ces nuits ; **la cascade le porte à 4,5-6,3 ms** (59 Cendreux
qui pensent, cherchent, crient) et les pires ticks sont à 40-180 ms (recalcul du champ des feux,
ou GC — à profiler avec `tools/profil-tick`). Sous le budget de 50 ms, mais c'est « le moment le
plus chargé du jeu », et il dure toute la nuit.

## Recommandations (Alexis tranche)

1. **La cascade du cri** — si c'est un emballement : baisser la salve (`CRI.PLAFOND_FIN` 6 → 3)
   ou allonger le cooldown (30 s → 90 s), pour que le plafond se remplisse sur une nuit et non
   en deux minutes ; ou limiter le cri à un crieur **par proie** à la fois. Si c'est le
   crescendo voulu : ne rien toucher, et le dire dans la spec comme un contrat d'endgame.
2. **Le pas lent** est validé tel quel — ne pas y toucher.
3. **R24bis** (l'immobile) est validé tel quel — la question est close par la mesure.
4. **R25** : garder, mais ne rien en attendre en acte III ; si on veut qu'elle compte, c'est
   `SENS.COUP` 8 → 12 (la portée du chantier), pas un mécanisme de plus.
5. **Le plafond global ⑳** est désormais MESURÉ comme la borne effective : la forme « global
   qui monte » tient (elle a tenu 59/52 sédiment compris) — c'est le moment de l'acter.
6. **Perf** : un profil d'une nuit d'acte III saturée avant le GATE 1 (le spécialiste `perf`).
7. **Instrument** : ajouter un marcheur « qui fuit en ligne puis tourne » pour mesurer R28, et
   la part des morsures dues aux rampants pour calibrer R26.
