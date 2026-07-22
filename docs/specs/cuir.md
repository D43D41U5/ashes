# La peau et le cuir — de la mise à mort au manteau

> Spec issue d'une session de design avec Alexis (2026-07-22). Prolonge `chasse.md`
> (C6, la mise à mort propre — dont le champ `clean` de `monster_slain` était
> l'ancrage explicite), `economie.md` (le cuir comme évier), et le modèle de
> `temperature.ts` (le manteau comme isolation). À implémenter — rien de ce qui
> suit n'est encore en `/sim`.

## Objectif de design

La chasse est le chef-d'œuvre inexploité du jeu : la plus belle traque du genre
survival ne débouche aujourd'hui que sur `raw_meat`. **Aucun item cuir/peau
n'existe**, l'ancre `slainClean` est lue pour la seule chronique, et toute la
chaîne promise (dépeçage → tannage → couture → tenues d'hiver) n'a pas de
matière. Ce chantier lui en donne une, avec un principe directeur : **la manière
de tuer décide de ce qu'on emporte**, et le haut de gamme se *mérite* — il ne se
farme pas.

## Le choix structurant : LA PEAU EST UN TYPE, PAS UNE QUANTITÉ

La qualité de dépouille se lit en **deux paliers d'objets distincts**, jamais en
volume. C'est la décision qui fait tenir tout le reste : si la mise à mort propre
donnait *plus de peaux*, la rendre difficile serait auto-saboteur (on enchaînerait
des tueries faciles pour le volume) et ré-introduirait la **récompense de STOCK**
que l'économie a explicitement tuée (décisions 2026-07-14 / 07-19, « loin ne veut
plus dire plus »). En TYPE, la peau prime est le **seul** moyen de faire le haut
de gamme : la difficulté devient une **porte**, pas un multiplicateur optionnel.

## Règles

### La mise à mort (le palier se décide ICI)

- **L1 — Trois paliers, tous déduits de faits déjà dans la sim.** À la mort d'une
  bête sauvage, `die()` pose sa peau selon la manière :
  - **PRIME** (`hide_prime`) — un **seul coup propre, de pleine santé, qui la
    couche net**. Condition : `slainClean` vrai (dernier coup démarré sur bête non
    alertée, C6) **ET** PV pleins avant le coup **ET** le coup l'amène à 0. Un
    nouveau drapeau dérivé (`PV plein × ce coup tue × slainClean`) — pas cher,
    déterministe, mais à écrire.
  - **CORRECTE** (`hide`) — approche propre, mais il a fallu **plus d'un coup** ou
    elle s'est **vidée au sang** (`bleedMortal`, chasse II). Le chasseur à l'épieu,
    la charge ratée.
  - **RIEN** (viande seule) — elle t'a vu, bagarre, ou tu l'achèves d'un coup sale
    (`slainClean` faux à la mort).
- **L2 — « Reste dur » est un invariant, pas un réglage.** Le palier prime exige
  la traque (approcher sans être vu, le cœur du métier) **et** un coup qui couche
  de plein PV. Le tableau des armes le montre : un cerf (45 PV) tombe d'une lance
  légère (16 × 3 = 48) ou d'un coup **chargé** (5 ticks immobile, à découvert, la
  bête peut griller pendant le hold — `combat.ts:431`), mais pas d'un épieu léger
  (10 × 3 = 30 → il blesse, elle se vide → CORRECTE au mieux). Le prime couple donc
  la belle peau à **l'arme + l'engagement** : progression assumée (peaux correctes
  → on craft la lance → peaux prime). **Une seule balle, une seule chance** : rater
  les dégâts démote au palier du sang, pas de « je pique, je re-traque, j'achève ».

### La dépouille et le cuir

- **L3 — Pas d'action de dépeçage en v1.** La peau est dans le **loot de la
  carcasse**, à côté de la viande — sa qualité est déjà décidée. Le dilemme « je
  m'expose sur le corps » existe déjà (on fouille à découvert, le sang attire les
  nez, C12). Une action de dépeçage chronométrée au couteau est un second knob,
  gardé pour plus tard.
- **L4 — Le tannage propage le palier.** `hide` → `leather`, `hide_prime` →
  `leather_prime`, au `workshop` (pas de nouvelle station). ⚠ **Ouvert** : l'entrée
  du tannage (le cuir nu suffit, ou un tannin/écorce qui — par la doctrine de
  rareté géographique — créerait un *terroir* de couture et une route de commerce)
  est une décision de design non prise. Défaut minimal proposé : `leather` =
  `{ hide }` au workshop, sans nouvelle ressource.

### Le manteau et le froid

- **L5 — Le manteau porté monte l'isolation.** Le **consommateur** existe et est
  stubbé (`TEMPERATURE.INSULATION_BODY = 1`, commentaire : « la Couture la fera
  monter plus tard » ; la dérive vers l'ambiant est *divisée* par l'isolation). Le
  **producteur n'existe pas** — à écrire en `/sim` : un état « vêtement porté » sur
  l'entité, une action *équiper*, l'agrégation de l'isolation dans le pas de
  température. Deux paliers : `leather` → manteau modeste ; `leather_prime` → le
  manteau qui tient le grand froid. On active **un seul vêtement porté** (le slot
  TORSE, décoratif aujourd'hui) — **pas** le paperdoll à 6 slots (chantier séparé
  garé par décisions.md), mais compatible avec sa venue.
- **L6 — Porté ≠ transporté ; lâché à la mort.** Le manteau ne réchauffe que sur
  toi. Et comme la mort lâche ce qu'on porte, un raider repart avec : le cuir entre
  dans la boucle « la puissance circule, jamais ne s'acquiert » (GDD §7).
- **L7 — LA PORTE DURE : le manteau achète la MOBILITÉ hivernale.** Sans vêtement
  chaud, **rôder** dans le Grand Froid / la Cendre loin d'un feu tue (`ACT_COLD`
  retire `[0, 25, 40]` de l'ambiant par acte, hypothermie à 20). Près du feu, tout
  le monde va bien ; c'est *arpenter* la vallée gelée qu'un bon manteau t'achète.
  Échelle à trois barreaux : **nu** = attaché au feu ; **manteau correct** =
  sorties courtes ; **manteau prime** = on arpente. La chasse devient la colonne
  vertébrale de la survie de saison — ce qui donne tout son poids au palier dur.
- **L8 — L'usure, réparable au cuir.** Le manteau se **dégrade à l'usage** (il
  s'use en te protégeant du froid : plus l'hiver est dur, plus il coûte) et se
  **rapièce au cuir**. Obligatoire, pas optionnel : un manteau éternel est un item
  de STOCK — l'hiver résolu pour toujours, le cuir bouché dès que tout le monde est
  vêtu, la porte dure sans dents dès la semaine 2 (le péché que l'audit nomme). La
  réparation est l'**évier permanent** de cuir que réclame l'économie de flux. Le
  *rythme* d'usure est un nombre de calibrage (playtest), pas une décision de spec.

### Rythme de saison

- **L9 — Silence en Acte I.** `ACT_COLD[0] = 0` : le premier acte n'a pas de froid.
  La chaîne n'a donc aucun **enjeu** de survie au premier tiers de saison — son rôle
  y est la **préparation** : chasser et stocker peaux/manteaux *avant* le Grand Froid
  annoncé. Rythme voulu (on prépare l'hiver qu'on voit venir), pas un oubli.

## Critères d'acceptation

- **AL1 (les trois paliers)** — Un cerf couché d'un coup propre de plein PV laisse
  `hide_prime` ; le même cerf approché proprement mais tué en deux coups, ou vidé au
  sang, laisse `hide` ; le même vu puis tué en bagarre ne laisse que `raw_meat`.
  Mesuré headless, seed + inputs fixes.
- **AL2 (dur = arme + engagement)** — Un épieu léger sur un cerf de plein PV ne
  produit **jamais** `hide_prime` (il blesse → `hide` via le sang) ; la lance légère
  ou le coup chargé, oui. Le prime exige `slainClean` : un cerf alerté tué ne donne
  jamais prime.
- **AL3 (une seule chance)** — Une bête déjà blessée puis achevée d'un coup propre
  ne donne **pas** `hide_prime` (PV non pleins au coup mortel) : la peau est déjà
  entamée.
- **AL4 (le tannage propage)** — `hide` → `leather`, `hide_prime` → `leather_prime`
  au workshop ; les paliers ne se mélangent pas (pas de `leather_prime` depuis
  `hide`).
- **AL5 (l'isolation)** — Un avatar portant un manteau dérive vers l'ambiant froid
  **plus lentement** qu'un avatar nu, à ambiant égal ; le manteau prime plus
  lentement que le correct. Un manteau **dans le sac** (non porté) ne change rien.
- **AL6 (la porte dure)** — À ambiant Grand Froid, loin de tout feu : le nu passe
  sous l'hypothermie et prend des dégâts en un temps mesurable ; le manteau prime
  tient assez pour traverser une distance de trajet ; le correct tient une sortie
  courte, pas la traversée.
- **AL7 (lâché à la mort)** — Un avatar qui meurt manteau sur le dos laisse le
  manteau sur sa dépouille (loot), et respawn nu (froid à nouveau plein — cf.
  `RESPAWN_TEMPERATURE`).
- **AL8 (l'usure)** — Le manteau perd de la durabilité en protégeant du froid ; à
  zéro, il ne réchauffe plus (ou se détruit) ; une réparation au cuir la remonte.
- **AL9 (déterminisme)** — Même seed + mêmes inputs = même état ET même flux
  d'événements, sim et replay, chaîne du cuir active.

## Ce qui reste ouvert (décisions de design non prises)

1. **L'entrée du tannage** (L4) — cuir nu seul, ou un tannin/écorce à récolter qui
   crée un terroir de couture. Touche worldgen/économie → décision d'Alexis.
2. **L'action de dépeçage** (L3) — gardée pour un palier ultérieur (couteau, geste
   chronométré, la dépouille qui s'affine ou se gâche au geste).
3. **Le paperdoll** (L5) — les 5 autres slots, le layering, l'armure comme réduction
   de dégâts : chantier séparé, ce chantier n'active que le manteau.
4. **Les nombres** — dégâts/PV déjà en place ; isolation par palier, rythme d'usure,
   coût de réparation : ordres de grandeur à caler en playtest.

## Points d'ancrage dans le code

- `combat.ts` `die()` — la branche qui pose la peau selon le palier ; le drapeau
  dérivé du prime (PV plein × coup mortel × `slainClean`).
- `balance.ts` — `MONSTER_DEFS[*].loot` (aujourd'hui `{ raw_meat: N }`) ; nouveaux
  `ItemId` `hide`/`hide_prime`/`leather`/`leather_prime`/manteau(s) ; recettes
  tannage + couture (`workshop`) ; `TEMPERATURE.INSULATION_BODY` (le stub à
  consommer) ; durabilité du manteau.
- `temperature.ts` — l'agrégation « isolation portée » dans la dérive.
- `sim.ts` `Entity` — l'état « vêtement porté » ; l'action *équiper* dans le
  protocole ; le lâcher-porté déjà porté par la logique de dépouille (à étendre au
  porté).
