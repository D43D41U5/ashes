# La piste de sang — le loup remonte le sang

*Spec du 2026-09-12. Trois décisions d'Alexis, journalisées le même jour (volet `gameplay-systemes`). Porteur de l'eau : `qualite-eau.md`.*

## Objectif de design

Saigner doit se payer **en distance**, pas seulement en proximité. Aujourd'hui, un loup en chasse n'apprend qu'un homme saigne que s'il le **voit** — 13 tuiles la nuit, environ 6 à midi (`aggroRange × wolfVigor`). Au-delà, le sang ne compte que pour le peuplement (`bloodBias`). La piste allonge la menace dans le temps et dans l'espace : **le sang qu'on laisse derrière soi mène à soi.** La parade est déjà dans le jeu : bander la plaie (la piste cesse de grandir), rejoindre le Feu.

## Ce qui existe déjà, et qu'on ne réécrit pas

- **Les gouttes au sol** — `state.blood[]`, `{ x, y, tick, etage? }`. Une goutte toutes les `HUNT.BLOOD_EVERY_TICKS` (0,8 s) par corps qui saigne, durée `BLOOD_TTL` (180 s), plafond FIFO `BLOOD_CAP` (256). **Le client les dessine** (`sang-sol.ts`) : la piste au sol se voit déjà.
- **Les souillures** — `state.souillures[]` (`qualite-eau.md`) : une origine `i`, un pas d'attache au fil `pas` (−1 en eau dormante), une traînée vers l'aval sur `SANG.DILUTION_PAS` pas de fil, 5 min de vie. **Pas encore dessinées** (voir Hors périmètre).
- **`chooseQuarry`** — la cible qui saigne pèse `WOUNDED_PREFERENCE` de plus (chasse C12) ; l'acquisition se fait à la distance perçue, la poursuite à la distance vraie jusqu'à `PURSUIT_RANGE`.
- **L13** — acquérir une cible qui saigne met le clan en rage. **R13 / `howlOnce`** — la meute hurle une fois quand elle choisit un homme.
- **`feedStep`** — un loup affamé va à une carcasse fraîche jusqu'à `CARCASS_SEEK_FRESH` (40 tuiles).
- **`bloodBias`** — le poids du sang au tirage de peuplement. **Inchangé** : Alexis a choisi la poursuite, pas un terme d'eau au peuplement.

## Les décisions (Alexis, 2026-09-12)

1. **Les loups VIVANTS remontent la piste** — gouttes au sol et souillures de l'eau, une seule règle.
2. **La piste GUIDE, elle ne réveille pas** — seul un loup déjà en chasse la suit. Une meute tranquille ou repue l'ignore (loup.md L5, trêve du repas R15).
3. **En silence jusqu'au contact** — pas de hurlement en prenant la piste ; le hurlement habituel part à l'acquisition. **Dérogation assumée** au GDD §9bis « annoncés, pas surprises », pour ce seul cas.

## Règles

- **P1 — Qui piste.** Un loup adulte qui **chasse** (la condition `hunts` de `wolfStep` : rage, ou non repu ET rôdeur de nuit ou en sortie) et qui **n'a pas de cible**. Jamais le petit (L15), le rompu, ni celui qui mange. `feedStep` passe avant : une carcasse fraîche à portée vaut mieux qu'une piste. **Place dans `wolfStep`** : la branche « rien sous la dent », **avant** `sortieTravel` et le retour au gîte — une piste vivante bat une destination abstraite.
- **P2 — Prendre la piste : il faut la CROISER.** Une goutte au sol à ≤ `PISTE.FLAIR` du loup ; ou, dans l'eau, une tuile à ≤ `PISTE.FLAIR` couverte par une souillure vivante — **en aval** de son origine pour une rivière (la traînée, jamais l'amont : c'est la loi de `qualite-eau.md` Q6), dans son disque pour une eau dormante. Aucun flair à distance : sans croisement, rien.
- **P3 — La remonter, au sol : le temps donne le sens.** De goutte en goutte, vers la **plus fraîche** (`tick` le plus grand) à ≤ `PISTE.PAS` de la goutte courante **et plus fraîche qu'elle**. Jamais vers une plus vieille. Départage déterministe : `tick`, puis position dans le tableau. Les gouttes ne portent pas l'identité de qui saigne : deux pistes qui se croisent, le loup prend la plus fraîche — le sang est le sang.
- **P4 — La remonter, dans l'eau : droit à l'origine.** La souillure croisée dit d'où vient le sang (`s.i`). **L'origine est une tuile où un corps se tenait, donc praticable** : le loup s'y rend par le même déplacement que vers une carcasse, sans suivre le fil pas à pas (le fil est la médiane, en eau profonde, qui bloque). Le fil sert à la **détection** (P2 : suis-je en aval ?), par la loi unique `attacheAuFil`, pas au trajet. À l'origine, les gouttes au sol reprennent la piste s'il y en a.
- **P5 — En silence.** Aucun hurlement pendant la piste. L'acquisition reste celle d'aujourd'hui (`chooseQuarry` + `howlOnce`), donc le hurlement part au contact, une fois. Le fait de domaine `wolf_on_trail` est émis **une fois par prise de piste** (pour les consommateurs — chronique, réputation), et déclaré **`muet`** à l'inventaire audio : c'est l'annonce qu'Alexis a refusée, pas le fait.
- **P6 — La perdre.** Plus de goutte plus fraîche à ≤ `PISTE.PAS`, et aucune souillure qui mène plus loin : le blessé a bandé, la piste a vieilli, ou le loup est au bout. Il reprend sa vie de chasse (la branche normale). **Mémoire** : `monster.piste` = le `tick` de la goutte courante (un nombre, JSON-sérialisable), ou l'index de l'origine d'eau ; effacée à la perte, à l'acquisition d'une cible, à la fin de la chasse.
- **P7 — La roche arrête la piste.** Une goutte sur un autre étage ne se suit que si elle est atteignable (`atteignableEntreEtages`, la garde de `feedStep`). Les souillures sont toujours au sol (l'émission refuse l'étage).
- **P8 — Le Feu tient.** Rien de neuf : un avatar au Feu n'est pas acquis (`underFireWard`), donc la piste qui y mène s'arrête au bord de la lumière.

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
- **`PAS`** — la distance maximale entre deux gouttes consécutives de la même piste. **Dérivé, pas posé** : la distance que parcourt un homme au sprint en `BLOOD_EVERY_TICKS`, plus une marge d'une tuile — sinon un blessé qui court casse sa propre piste.

## L'ordre de livraison

1. **Le porteur** (`qualite-eau.md`, fait, non commité).
2. **Q9 — la bête renonce à boire** (`qualite-eau.md`), seule, suite entre les deux : elle bouge le flux PRNG.
3. **La piste**, seule, suite et empreinte entre les deux. Trois commits, trois coupables désignés.

## Hors périmètre (et où ça revient)

- **La piste dans l'eau ne se voit pas.** La teinte du sang dans l'eau est un chantier client séparé (`qualite-eau.md`). Conséquence à connaître : **dans l'eau, la traque est silencieuse ET invisible** ; sur la berge, la piste se voit.
- **D'autres prédateurs.** Le loup est le seul `predator: true` du jeu aujourd'hui.
- **Le gibier qui fuit une piste.** Pas demandé.
