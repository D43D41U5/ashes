# La piste de sang — le loup remonte le sang

*Spec du 2026-09-12. Trois décisions d'Alexis, journalisées le même jour (volet `gameplay-systemes`). Porteur de l'eau : `qualite-eau.md`.*

*Statut : **LIVRÉ le 2026-09-12** — `pisteStep` dans `faune.ts`, bloc `PISTE` dans `balance.ts`, 22 gardes dans `piste-de-sang.test.ts`. Ce que la livraison a ajouté à la spec est marqué **(livré)** ci-dessous. P1 (le sang de l'homme seulement) avait été posé en hypothèse à la livraison : **Alexis l'a confirmé le 2026-09-12** (ma reco, volet `gameplay-systemes`).*

## Objectif de design

Saigner doit se payer **en distance**, pas seulement en proximité. Aujourd'hui, un loup en chasse n'apprend qu'un homme saigne que s'il le **voit** — 13 tuiles la nuit, environ 6 à midi (`aggroRange × wolfVigor`). Au-delà, le sang ne compte que pour le peuplement (`bloodBias`). La piste allonge la menace dans le temps et dans l'espace : **le sang qu'on laisse derrière soi mène à soi.** La parade est déjà dans le jeu : bander la plaie (la piste cesse de grandir), rejoindre le Feu.

## Ce qui existe déjà, et qu'on ne réécrit pas

- **Les gouttes au sol** — `state.blood[]`, `{ x, y, tick, etage?, homme? }` (le dernier champ est de ce chantier, P1). Une goutte toutes les `HUNT.BLOOD_EVERY_TICKS` (0,8 s) par corps qui saigne, durée `BLOOD_TTL` (180 s), plafond FIFO `BLOOD_CAP` (256). **Le client les dessine** (`sang-sol.ts`) : la piste au sol se voit déjà.
- **Les souillures** — `state.souillures[]` (`qualite-eau.md`) : une origine `i`, un pas d'attache au fil `pas` (−1 en eau dormante), une traînée vers l'aval sur `SANG.DILUTION_PAS` pas de fil, 5 min de vie — et `homme?` (P1, ce chantier) si un homme y a saigné. **Pas encore dessinées** (voir Hors périmètre).
- **`chooseQuarry`** — la cible qui saigne pèse `WOUNDED_PREFERENCE` de plus (chasse C12) ; l'acquisition se fait à la distance perçue, la poursuite à la distance vraie jusqu'à `PURSUIT_RANGE`.
- **L13** — acquérir une cible qui saigne met le clan en rage. **R13 / `howlOnce`** — la meute hurle une fois quand elle choisit un homme.
- **`feedStep`** — un loup affamé va à une carcasse fraîche jusqu'à `CARCASS_SEEK_FRESH` (40 tuiles).
- **`bloodBias`** — le poids du sang au tirage de peuplement. **Inchangé** : Alexis a choisi la poursuite, pas un terme d'eau au peuplement.

## Les décisions (Alexis, 2026-09-12)

1. **Les loups VIVANTS remontent la piste** — gouttes au sol et souillures de l'eau, une seule règle.
2. **La piste GUIDE, elle ne réveille pas** — seul un loup déjà en chasse la suit. Une meute tranquille ou repue l'ignore (loup.md L5, trêve du repas R15).
3. **En silence jusqu'au contact** — pas de hurlement en prenant la piste ; le hurlement habituel part à l'acquisition. **Dérogation assumée** au GDD §9bis « annoncés, pas surprises », pour ce seul cas.

## Règles

- **P1 — Qui piste.** Un loup adulte qui **chasse** (la condition `hunts` de `wolfStep` : rage, ou non repu ET rôdeur de nuit ou en sortie) et qui **n'a pas de cible**. Jamais le petit (L15), le rompu, ni celui qui mange, **ni celui qui saigne lui-même (livré)** : ses propres gouttes sont à ≤ `FLAIR` de lui à chaque tick, il tournerait sur sa plaie. **Et il ne remonte que le sang de l'HOMME (livré ; décision d'Alexis du 2026-09-12, ma reco)** — avatar ou villageois : la goutte et la souillure disent qui a saigné (`homme`), le sang d'une bête n'est pas une piste. MESURÉ sans ce tri, sur le banc A26 de `faune.test.ts` (quatre loups ambiants, un coin de trente bêtes, 2 h, 150 s) : les loups pistaient chaque sanglier blessé jusqu'au bout — **9 → 19 sangliers tués, le coin vidé de 15 à 5 bêtes, 2 → 4 loups tués par les sangliers** ; la promesse R18 (« le reste du coin va au gibier ») tombait. L'objectif de cette spec est l'homme qui saigne et sa parade, pas une nouvelle écologie de la nuit. Le tag est en place : rendre le sang de bête pistable à nouveau tiendrait en deux lignes (les deux `homme !== true`), si un jour l'écologie qui va avec est voulue. `feedStep` passe avant : une carcasse fraîche à portée vaut mieux qu'une piste. **Place dans `wolfStep`** : la branche « rien sous la dent », **avant** `sortieTravel` et le retour au gîte — une piste vivante bat une destination abstraite.
- **P2 — Prendre la piste : il faut la CROISER.** Une goutte au sol à ≤ `PISTE.FLAIR` du loup ; ou, dans l'eau, une tuile à ≤ `PISTE.FLAIR` couverte par une souillure vivante — **en aval** de son origine pour une rivière (la traînée, jamais l'amont : c'est la loi de `qualite-eau.md` Q6), dans son disque pour une eau dormante. Aucun flair à distance : sans croisement, rien.
- **P3 — La remonter, au sol : le temps donne le sens.** De goutte en goutte, vers la **plus fraîche** (`tick` le plus grand) à ≤ `PISTE.PAS` de la goutte courante **et plus fraîche qu'elle**. Jamais vers une plus vieille. Départage déterministe : `tick`, puis position dans le tableau. Les gouttes ne portent pas l'identité de QUI saigne, seulement de QUOI (`homme`, P1) : deux pistes d'hommes qui se croisent, le loup prend la plus fraîche. **(livré)** Deux hommes qui saignent gouttent au MÊME tick (tous sur `tick % BLOOD_EVERY_TICKS`) : la goutte courante d'un loup, retrouvée par son tick, est **la plus proche de lui** parmi celles de ce tick — pas celle de l'autre piste à l'autre bout du monde.
- **P4 — La remonter, dans l'eau : droit à l'origine.** La souillure croisée dit d'où vient le sang (`s.i`). **L'origine est une tuile où un corps se tenait, donc praticable** : le loup s'y rend par le même déplacement que vers une carcasse, sans suivre le fil pas à pas (le fil est la médiane, en eau profonde, qui bloque). Le fil sert à la **détection** (P2 : suis-je en aval ?), par la loi unique `attacheAuFil`, pas au trajet. À l'origine, les gouttes au sol reprennent la piste s'il y en a.
- **P5 — En silence.** Aucun hurlement pendant la piste. L'acquisition reste celle d'aujourd'hui (`chooseQuarry` + `howlOnce`), donc le hurlement part au contact, une fois. Le fait de domaine `wolf_on_trail` est émis **une fois par prise de piste** (pour les consommateurs — chronique, réputation), et déclaré **`muet`** à l'inventaire audio : c'est l'annonce qu'Alexis a refusée, pas le fait.
- **P6 — La perdre.** Plus de goutte plus fraîche à ≤ `PISTE.PAS`, et aucune souillure qui mène plus loin : le blessé a bandé, la piste a vieilli, ou le loup est au bout. Il reprend sa vie de chasse (la branche normale). **Mémoire (livré, trois champs et non un nombre)** : `monster.piste` = le `tick` de la goutte courante ; `monster.pisteEau` = l'index `i` de l'origine d'eau visée ; `monster.pisteVue` = le `tick` de la goutte la plus fraîche déjà remontée jusqu'au bout. Les deux premiers s'effacent à la perte, à l'acquisition d'une cible, à la fin de la chasse, à la rupture. **Et un mur entre deux gouttes la perd aussi (livré, revue `determinisme-sim`)** : la piste avance par `moveToward` nu, sans chercher de passage (R20 est pour la proie) ; la goutte suivante derrière la palissade que l'homme a contournée, le loup la poussait 170 s (MESURÉ), jusqu'au TTL de la goutte — une impasse muette (`impasse.ts` exige un chemin brut, un corps qui pousse un mur n'en a pas). Désormais la même mesure que `noteBlocked` (n'a-t-il pas gagné `STUCK_PROGRESS` sur son but en `STUCK_TICKS` ?) dans ses propres champs `pisteDepuis`/`pisteD` : il se cogne une seconde, puis il lâche (mesuré : au mur à 2,2 s, la piste lâchée à 3,4 s ; garde P6 avec témoin sans mur). Et le renoncement de l'impasse (`renonce`) efface la piste comme tout autre projet. Le troisième champ survit à la perte et sert à **ne pas reprendre la même piste** : au bout d'une piste perdue, seule une goutte **plus fraîche** que `pisteVue` peut relancer le loup — sinon il rebondirait sur les gouttes qu'il vient de remonter, un `wolf_on_trail` par tick. Et une reprise à moins de `PISTE.REPRISE_TICKS` (10 s) de la dernière fin de piste ne ré-émet pas `wolf_on_trail` : mesuré sur un frère de meute qui saigne (voir Réserves — avant le tri P1, qui éteint ce cas), 9 à 23 faits par 90 s avant la règle, 2 à 3 après.
- **P7 — La roche arrête la piste.** Une goutte sur un autre étage ne se suit que si elle est atteignable (`atteignableEntreEtages`, la garde de `feedStep`). Les souillures sont toujours au sol (l'émission refuse l'étage).
- **P8 — Le Feu tient.** Un avatar au Feu n'est pas acquis (`underFireWard`), donc la piste qui y mène s'arrête au bord de la lumière. **(livré)** Une goutte sous la garde du Feu est **refusée** comme goutte suivante et comme prise de piste (`underFireWard` prend le point de la goutte) : le loup s'arrête à la dernière goutte hors de la lumière, il n'entre pas dans le cercle pour y rester planté sur un sang qu'il ne peut pas acquérir.

## Critères d'acceptation (PA)

- **PA1 — IL VIENT DE LOIN.** Un loup en chasse, un avatar qui saigne et s'éloigne en laissant une piste qui passe à ≤ `FLAIR` du loup, l'avatar à plus de `aggroRange` ET de `PURSUIT_RANGE`. Le loup finit à portée et le prend pour cible. **Témoin** : le même montage, l'avatar ne saigne pas — le loup ne vient pas.
- **PA2 — EN SILENCE.** Pendant la remontée : zéro `wolf_howl`. À l'acquisition : exactement un. Et un `wolf_on_trail` à la prise.
- **PA3 — LA PISTE A UN SENS.** Un loup posé au milieu d'une piste va vers le bout frais : sa distance à la tête décroît, jamais vers la queue.
- **PA4 — ELLE GUIDE, ELLE NE RÉVEILLE PAS.** Un résident non affamé, sans sortie, une piste qui traverse son gîte : il reste dans `DEN_HOME_RADIUS` (la garde L5 tient). **Témoin** : le même loup en sortie la suit. Un loup repu (`satedUntil`) ne la suit pas.
- **PA5 — L'EAU PORTE L'APPEL VERS L'AMONT.** Une souillure dans un gué ; un loup en chasse posé en aval, à ≤ `DILUTION_PAS` pas de fil et hors de sa vue : il gagne l'origine. **Le même loup posé en amont n'est pas appelé.** Et le méandre ne coud pas (banc `carteMeandre` de `qualite-eau.test.ts`).
- **PA6 — ELLE SE PERD.** Le blessé bande : le loup atteint la dernière goutte, puis reprend sa vie de chasse — il ne reste pas planté.
- **PA7 — LE FEU TIENT.** Une piste qui mène à un avatar au Feu : aucune acquisition, aucune morsure.
- **PA8 — LA ROCHE ARRÊTE LA PISTE.** Une piste qui monte sur une terrasse sans chemin atteignable n'est pas suivie au-delà du pied.
- **PA9 — DÉTERMINISME ET COÛT.** Suites vertes. Empreinte `/sim` relevée avant/après : le flux PRNG **bougera** (des loups marchent autrement, d'autres tirages en découlent) — l'écart doit se cantonner aux scénarios où une piste existe, et le haché d'état des autres doit retomber sur l'avant. Coût mesuré par loup en chasse au plafond (256 gouttes + 64 souillures).

## Les nombres (`balance.ts`, bloc `PISTE`)

- **`FLAIR`** — la distance à laquelle un loup « croise » la piste. De l'ordre de 2 à 3 tuiles : il faut marcher dessus, pas la sentir de loin.
- **`PAS`** — la distance maximale entre deux gouttes consécutives de la même piste. **Dérivé, pas posé** : la distance que parcourt un homme au sprint en `BLOOD_EVERY_TICKS`, plus une marge d'une tuile — sinon un blessé qui court casse sa propre piste. (Déclaré **après** `COMBAT` dans `balance.ts` : il en lit `SPRINT_FACTOR`, et un `export const` se lit dans l'ordre.)
- **`REPRISE_TICKS`** (livré) — 10 s : une piste reprise moins de ce délai après la fin de la précédente ne ré-émet pas `wolf_on_trail`. Un délai d'annonce, pas de comportement — le loup suit quand même.

## L'ordre de livraison

1. **Le porteur** (`qualite-eau.md`) — commit `81687bf`.
2. **Q9 — la bête renonce à boire** (`qualite-eau.md`), seule — commit `e9e4751`. Empreinte 12/12 identique à l'avant (aucune bête n'a trouvé d'eau ensanglantée sur les 12 scénarios).
3. **La piste**, seule, suite et empreinte entre les deux. Trois commits, trois coupables désignés.

## Réserves de la livraison

- **Le sang de l'homme seulement — décidé par Alexis le 2026-09-12** (posé en hypothèse à la livraison, confirmé à la reprise, ma reco). La première écriture suivait tout sang (« le sang est le sang ») ; c'est la suite qui a montré ce que ça coûtait (P1, chiffres A26). Réversible en deux lignes. Variante si un jour l'histoire du « loup qui vole la prise du chasseur » est voulue : suivre aussi le sang d'une bête blessée **par un homme** (la flèche) — un `homme` posé par l'attaquant plutôt que par le saigneur ; non fait.
- **Le frère de meute qui saigne** (mesuré avant le tri, quand le sang de bête était une piste) : sonde `__frere-qui-saigne` (3 graines, 90 s, deux rôdeurs sans meute, l'un saignant 60 s) — le second était **sur la piste 1 à 2 % du temps**, finissait à 14-21 tuiles de son départ, ne se collait pas à son frère ; le seul coût était le bégaiement de `wolf_on_trail` (9 à 23 par 90 s), d'où `REPRISE_TICKS`. Le tri par `homme` éteint le cas à la source (garde : zéro prise) ; `REPRISE_TICKS` reste, pour l'homme qui bande puis rouvre sa plaie sous les dix secondes — une reprise, pas une prise.
- **Calibrage à signaler (revue) : l'eau appelle dès UNE goutte.** `souillureCroisee` n'a pas de seuil de force — une souillure à un cran (sous `SEUIL_SOUILLE`, donc invisible à la pêche et à la teinte) appelle déjà un loup à `DILUTION_PAS` pas en aval. Spec P2 au pied de la lettre (« couverte par une souillure vivante ») ; si le loup doit sentir ce que le pêcheur voit, lire `eauSouillee` sur sa tuile à la place. Non tranché.
- **`REPRISE_TICKS` se compare sur les ticks des gouttes**, pas sur l'horloge du loup : une piste d'homme réellement nouvelle mais moins de 10 s plus fraîche que la dernière consommée est suivie sans `wolf_on_trail`. Mineur, voulu comme tel.
- **Le coût (PA9).** Mesuré (`tools/__cout-piste.mts`, 8 000 ticks, un loup en chasse sans cible, plafond 256 gouttes + 64 souillures, aucune prise) : **8,4 µs par loup et par tick**, contre 35,8 µs pour le `wolfStep` sans cible qu'il prolonge. Les gouttes sont balayées en entier (elles sont en ordre de `tick`, pas d'espace) ; un index spatial n'est justifié que si le plafond monte.

## Hors périmètre (et où ça revient)

- **La piste dans l'eau ne se voit pas.** La teinte du sang dans l'eau est un chantier client séparé (`qualite-eau.md`). Conséquence à connaître : **dans l'eau, la traque est silencieuse ET invisible** ; sur la berge, la piste se voit.
- **D'autres prédateurs.** Le loup est le seul `predator: true` du jeu aujourd'hui.
- **Le gibier qui fuit une piste.** Pas demandé.
