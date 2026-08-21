# Les annales — le vocabulaire du pays d'avant, et ses garde-fous

*Source : session de lore du 2026-08-21 (P1+P4 des cinq propositions, actées en plan — « faisons comme ça », puis « enchaine »). Étend **S-R16 de `stratigraphie.md`** (méthode Caves of Qud : des faits estampillés par les passes de génération, **jamais d'agents simulés**) sans en changer la nature. Se conforme à `docs/bible-diegetique.md` (L6 : le pays d'avant vivait sous les mêmes lois ; L7 : le monde ne ment jamais ; I2 : aucun nom propre). Statut : **en cours**. Jalon : calibrage Veillée.*

## Objectif de design

Le diagnostic (écrivain, 2026-08-21) : les trois types actuels (`fondation`, `gue`, `sort`) parlent tous **du même objet** — le lieu bâti. Or une vallée n'est pas une collection de fiches : c'est un **réseau de causes**, et le worldgen calcule déjà presque tous les liens sans les estampiller. Le risque mesuré ailleurs (Starfield, NMS) : un vocabulaire mince fait qu'à la saison 3 le joueur a appris la distribution et **cesse de lire**.

> **Le livrable réel n'est pas le fait, c'est la JUXTAPOSITION.** `guet` + `sort: brule` = *ils ont vu venir, et sont restés*. `taille` + `intact` = *le minerai est encore là, personne n'est revenu*. Aucune de ces phrases n'est écrite — elles tombent du croisement de faits vrais.

## Le vocabulaire (R1-R3)

- **R1 — Le schéma s'étend, il ne casse rien.** `FaitDeGeneration.ere` devient `0 | 1 | 2 | 3` — l'**ère 0** est « la pierre et l'eau », ce qui précède l'humain. Le champ `type` gagne huit valeurs. Additif : une carte d'avant se relit sans.
- **R2 — Chaque fait DÉRIVE de ce que sa passe calcule déjà.** Jamais de simulation, jamais de tirage dédié. La table de cette tranche :

| type | ère | dérivé de | ce que le joueur en infère |
|---|---|---|---|
| `gravure` | 0 | pose d'une pierre levée, d'un cercle, de pétroglyphes | une écriture plus vieille que les routes |
| `essart` | 1 | lieu bâti dont le **centre est en terrain boisé** (le dégagement a mangé du bois — en pré, il n'a rien mangé) | le pré autour de la ruine est artificiel |
| `taille` | 1 | mine/carrière/gisement à portée d'un `map.affleurements` (cause = sa ressource) | la mine est là parce que la roche affleure — « suis la pierre » |
| `guet` | 1 | la Tour de guet + le **gradient de `map.cendre`** (cause = la direction de la Cendrière) | « ils guettaient le sud » — donc ils savaient |
| `porte` | 2 | chaque `map.seuils` (cause `secours` si c'en est un) | le pays d'avant bornait ses portes |
| `croisee` | 2 | le **point de raccord** d'une liaison de sente au réseau (le `best` du dernier raccord — le carrefour en Y émerge déjà là, on l'estampille) | des routes se sont trouvées ici — le lieu social |
| `fosse` | 3 | pose d'un charnier | où la vallée a enterré — et la hantise penche du même côté *par construction* |
| `fuite` | 3 | la charrette + le gradient de `map.cendre` **inversé** (cause = la direction de fuite) | l'exode a un sens, qu'on peut suivre |

- **R2bis — DIFFÉRÉS, et dits** : `crue` (exige le champ de relief interne, vivant seulement pendant la passe Racine), `halte` et `impasse` (exigent une analyse de desserte des tronçons). À reprendre quand un lecteur les réclame.
- **R3 — Les directions sont des mots, pas des degrés.** `guet` et `fuite` portent `'nord' | 'sud' | 'est' | 'ouest'` — le pays d'avant n'a pas de boussole graduée, et un lecteur n'aura jamais à formater un angle. Dérivées du gradient de `map.cendre` par échantillonnage cardinal ; **absentes si la carte n'a pas de Cendrière** (un banc ne guette rien).

## Les garde-fous (R4-R6) — conçus AVEC le vocabulaire, pas après

- **R4 — LE RARE SE DIT, LE COMMUN SE TAIT (la saillance).** Un lecteur ne verbalise un fait que s'il est **localement rare** (`saillant()` : au plus `ANNALES.SAILLANCE_MAX` faits du même type dans `ANNALES.SAILLANCE_RAYON`). Conséquence structurelle : la table fait→texte **dépend de la carte** — inapprenable par cœur, par construction. C'est la réponse au « tableau Excel ». *(Les 80 fosses de la vallée : une poignée parlera.)*
- **R5 — LA LACUNE SALÉE (`verbalise()`).** Une part déterministe des faits (`hash2` positionnel salé, `ANNALES.PART_MUETTE`) n'est **jamais verbalisée par un objet du monde** — la stèle est brisée, le fragment illisible. Deux bornes dures : ① la **conséquence physique du fait reste visible** (la clairière de l'essart est là même si sa stèle est muette — le joueur reconstitue en lisant le terrain : la lacune est une leçon, pas une privation) ; ② la lacune ne s'applique qu'aux **textes gravés dans le monde** (stèles, P2b) — jamais au constat d'un visiteur (la ligne de chronique dit ce que le marcheur voit de ses yeux).
- **R6 — DEUX TÉMOINS QUI NE SE CONCERTENT PAS.** Le toponyme lit l'ère **la plus récente** (c'est déjà `nomSelonSort`) ; la stèle lira l'ère **la plus ancienne**. Deux artefacts vrais, décalés — un passé, pas une sortie de générateur. Gratuit : c'est un ordre de priorité, pas une donnée.
- **R6bis — Le monde ne ment JAMAIS** (bible L7). Aucun fait faux, aucune annale piégée : la contradiction vient de la juxtaposition de faits vrais.

## Le lecteur existant s'étend d'UN mot (R7)

- **R7 — La chronique de première visite gagne le `guet`, et seulement lui.** Précédence, sur les seuls faits **saillants** (R4 vaut pour TOUT lecteur — seule la lacune R5 est réservée aux stèles) : `sort: intact` **et fondation à cause** (intime) > `fondation` à cause (récit) > `guet` (récit — « Elle regardait le sud. »). Les autres types **attendent les stèles** (P2b) : la fosse au fil de l'eau ferait jusqu'à 80 lignes par saison — l'exact contraire de R4. L'événement `poi_first_visit` porte les faits du lieu en **tableau** (`faits`, avec leur verdict `saillant` — le formateur est pur sur les événements, il ne voit pas la carte : la sim témoigne du verdict comme du fait).
- **R7bis — L'INTIME EXIGE UNE FONDATION À CAUSE, et c'est la mesure qui l'a imposé.** Première écriture : tout `sort: intact` chuchotait. MESURÉ (harnais, seed 7) : **22 lignes intimes** — car l'intact est l'état NORMAL de l'arrière-pays (la doctrine « loin des routes = intact = riche » en fait un décor), et le registre qui chuchote se noyait sous son propre chuchotement. La saillance seule n'y suffisait pas (40 → 25 : elle discrimine, mais l'intact reste commun à l'échelle de la carte). La règle retenue : « Personne n'était revenu » ne se dit que d'un lieu **où quelqu'un s'était installé pour une raison** — la ferme de l'eau, la charrette de la route. L'arrière-pays intact appartient aux stèles. ⚠ Piège d'implémentation payé : le test porte sur `fondation.cause`, pas sur l'existence du fait — TOUT lieu bâti porte une fondation, c'est la cause qui dit la raison.

## Critères d'acceptation

*Sur la vraie carte (`generateZonedTerrain`), balayés — jamais des cas choisis.*

- **A1 — Chaque type émis existe et se tient.** Sur la seed du harnais : ≥ 1 `gravure`, ≥ 1 `guet` (si tour placée), ≥ 1 `porte` par seuil (compte exact = `map.seuils.length`), ≥ 1 `fosse` par charnier posé (compte exact), ≥ 1 `croisee` dès que trois bouches se relient. `taille`/`essart`/`fuite` : si le worldgen de la seed n'en produit pas, la garde le DIT (skip explicite), elle ne passe pas en silence.
- **A2 — Aucun fait n'est orphelin de sa cause matérielle** : un `taille` a un affleurement à portée ; un `essart` a un centre boisé ; un `guet`/`fuite` n'existe que si `map.cendre` existe ; une `fosse` est au centre d'un charnier ; une `porte` aux coordonnées d'un seuil.
- **A3 — Déterminisme et flux.** Deux générations de même seed rendent des annales **identiques** (ordre compris). Aucune émission ne consomme le PRNG d'état : le monde hors annales est **au bit près** celui d'avant (gardes existantes de `pays-d-avant.test.ts` et `carte-immuable.test.ts` vertes sans amendement).
- **A4 — La saillance discrimine sur la vraie carte** : il existe au moins un type à la fois **dit quelque part** et **tu ailleurs** (sinon le seuil est mort, dans un sens ou l'autre).
- **A5 — La lacune est une part, pas un interrupteur** : sur l'ensemble des faits de la carte, `verbalise()` en tait entre 5 % et 60 % — et le même fait rend toujours le même verdict.
- **A6 — La chronique ne spamme pas** : le POTENTIEL de lignes (les lieux dont les faits saillants produiraient une ligne au formateur) reste < 15 sur toute la carte — et ≥ 1 (un réglage qui tait tout est mort). *Compté sur la carte et non sur un flux de banc : le banc n'a pas de joueur, et les premières visites n'y tombent jamais (leçon consignée — « le banc ne mesure pas le joueur »).*
