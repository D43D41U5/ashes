# La torche — la seule lumière qui marche

*(spec extraite du GDD §7 par décision d'Alexis, 2026-08-26. Elle RENVERSE une décision
antérieure : voir « Pourquoi elle avait été abandonnée » ci-dessous.)*

## Le besoin

La nuit d'ASHES est désormais VRAIMENT noire — le voile suit la lune, et à la nouvelle lune
il monte à `VOILE_NOUVELLE_LUNE` (0,97), l'ambiante des sprites descendant avec lui
(`dynamic-lighting.ts`, 2026-08-26). C'était voulu, et c'est réussi. Mais le corollaire n'avait
pas de réponse : **on ne peut plus se déplacer la nuit**. Les seules lumières du monde sont
plantées (les Feux, les lucioles), donc la nuit n'offre que deux conduites — rester au foyer,
ou marcher à l'aveugle. La torche est la troisième, et une seule : **avancer, en payant.**

## Pourquoi elle avait été abandonnée — et ce qui a changé

`docs/decisions.md` (2026-07-12) et `craft-fortune.md` § Hors périmètre donnent DEUX motifs :

1. *« le client n'a aucun système de lumière »* — **mort le 2026-07-24**, quand l'éclairage
   dynamique est devenu le rendu nominal. Les lucioles ont même prouvé le cas exact qui manquait
   (2026-08-26) : une source **mobile** qui n'est pas une structure, avec ses trois branchements.
2. *« une source de chaleur portable saperait le Feu »* — **toujours vrai**, et c'est lui qui
   dicte tout le design ci-dessous. Il ne l'interdit pas ; il le contraint.

S'y ajoute **I3** de `bible-diegetique.md` : *le Feu ne devient jamais un ward — pas de torche
bénie ; toute parade agit parce qu'elle OCCUPE, jamais parce qu'elle est portée.*

## Les trois interdits — le design tient à eux

- **T-A — Elle NE CHAUFFE PAS.** Aucun terme dans `advanceTemperature`, aucune isolation, aucune
  bulle. Le froid se répond par feux, vêtements et abris (GDD §7), et rien d'autre.
- **T-B — Elle NE REPOUSSE RIEN.** Ni loup, ni cendreux, ni meute, ni raid. Aucune règle de
  faune, de combat ou de nighthunt ne consulte la torche. (I3.)
- **T-C — Elle NE S'ALLUME QU'AU FEU.** Le foyer reste l'ORIGINE de toute lumière du jeu ; la
  torche est une **laisse** qui y ramène, jamais une évasion. On ne la craft pas allumée.

## Le contrat

Deux items. `torche` est le fagot **éteint** (bois 1 + fibre 3, `station: null` — sans poste,
dès la première nuit). `torche_vive` est le même objet **en feu**, son combustible restant dans
`Slot.wear`. Ni l'un ni l'autre n'est empilable : une pile ne saurait pas n'allumer qu'un seul
de ses fagots, et une torche vive ne doit jamais fusionner avec une éteinte.

Le coût est une **case de ceinture, EN MAIN** : qui s'éclaire ne tient ni hache, ni arc, ni
canne. La nuit se paie en mains libres. Elle ne pèse presque rien (`ITEM_WEIGHT` 1) — ce n'est
pas un coût de portage.

Elle brûle **~1/3 de nuit** puis retombe en fagot éteint — elle ne disparaît pas : le bois et la
fibre sont toujours là, c'est la flamme qui s'en est allée. On la rallume au foyer, indéfiniment.
**La rareté n'est pas dans la matière, elle est dans le trajet de retour.**

## Critères d'acceptation (headless, `torche.test.ts`)

- **T1** — `craft { recipeId: 'torche' }` **réussit loin de toute structure** (1 bois + 3 fibres →
  1 `torche`), et ce qui sort est **ÉTEINT** : jamais `torche_vive`.
- **T2** — `light_torch` sur un feu ALLUMÉ, torche éteinte en main, à portée : la case tenue
  devient `torche_vive`, `wear` à 0, et `torche_allumee` est émis. **La MÊME case** — ni échange,
  ni nouvelle case (le sac plein ne peut pas faire échouer un allumage).
- **T3** — `light_torch` réussit aussi sur un feu **EN BRAISES** : refuser les braises ferait de
  l'extinction une double peine, à l'heure exacte où l'on a besoin de lumière.
- **T4** — `light_torch` est refusé sur un feu **ÉTEINT**, **hors portée**
  (> `TORCHE.ALLUMAGE_RANGE`), sur une structure qui n'est pas un feu, et **mains nues ou
  torche déjà vive** en main. Chaque refus émet `action_rejected`.
- **T5** — L'allumage **ne coûte RIEN au foyer** : ni bûche consommée, ni `burnAt` déplacé, ni
  `emberUntil` raccourci. Prendre le feu n'en ôte pas.
- **T6** — Une torche vive TENUE s'éteint **exactement** à `TORCHE.BURN_TICKS` ticks : à
  `BURN_TICKS - 1` elle brûle encore, au tick suivant la case est redevenue `torche`, sans `wear`,
  et `torche_eteinte` est émis **une seule fois**.
- **T7** — Une torche vive **AU SAC** (case non active) ne brûle pas : `wear` inchangé après
  `BURN_TICKS` ticks. Ce qui brûle est ce qu'on voit brûler.
- **T8** — `partDeFlamme` descend de 1 à 0 **monotone** sur toute la combustion — c'est de là que
  le client tire l'agonie de la flamme, et les deux côtés lisent la même courbe.
- **T9 (les interdits, prouvés)** — À torche vive en main : la température du porteur est
  **identique** à celle du même porteur mains nues (T-A), et l'agression d'une bête proche est
  **identique** (T-B). Une garde, pas une intention.
- **T10 (déterminisme)** — Une partie où l'on craft, allume et laisse mourir une torche **rejoue
  au bit près** (`replay.test.ts` patron) : aucun tirage n'est touché — l'horloge est un compteur
  entier, et allumer une torche ne décale pas le flux seedé du monde (invariant n°2).

## Le rendu (client)

Le trois-branchements des lucioles, à la lettre (`ambient-life.ts` / `firefly-ground-glow.ts`) —
et il en faut **trois**, parce que le sol n'est pas sur la pipeline Light2D :

1. **Un point light** dans le `LightsManager` (`dynamic-lighting.ts`) — il allume ce qui a une
   carte de normales : fûts, décor volumique, corps.
2. **Une flaque au sol** additive et PIXELLISÉE (grain 4 px, NEAREST) — c'est elle, et elle
   seule, qui met la terre en lumière.
3. **Un trou dans le voile de nuit** (`night-veil.ts`) — c'est lui qui porte la PORTÉE, et il ne
   peut pas inventer de teinte (effacer un multiplicateur rend au sol sa propre couleur).

**La flaque n'est PAS quantifiée sur sa grille de texels**, et c'est mesuré, pas supposé : un
texel de lumière vaut `LIGHT_PX × zoom` pixels d'écran, relevé à **9 exactement** dans le vrai jeu
(zoom 2,25, dérivé du cadrage). Les texels sont donc tous de même largeur et un déplacement
sous-texel décale toutes leurs frontières de la même fraction — un glissement d'ensemble, pas un
battement. Quantifier aurait échangé ce glissement contre un à-coup de 9 px sur la seule lumière
accrochée à une main qui marche. *(Réserve honnête : le facteur n'est entier que si la hauteur de
fenêtre est un multiple de 80 — et hors de ces hauteurs il concerne les TROIS flaques du jeu, pas
celle-ci seule. Non mesuré.)*

Le trou de la torche reste **en deçà** de celui d'un Feu : la leçon du 2026-08-03 (un trou qui
suivait le rayon « effaçait la nuit à 25 tuiles ») vaut ici d'autant plus que la source marche.
**Révision du 2026-08-26** (« doubler le diamètre de lumière de la torche et diminuer l'intensité
de sa lumière », Alexis) : les trois portées ont doublé (trou 2 → 4 tuiles, flaque 3 → 6, point
light 5 → 10) et les trois intensités ont été divisées par deux (creusement du voile 1 → 0,5 de
`HOLE_ERASE_PEAK`, alpha de la flaque 0,55 → 0,28, intensité du point light 0,85 → 0,45). Ce qui
protège désormais la nuit noire n'est plus le rayon mais la **profondeur** du creusement : le
trou a deux leviers indépendants, et l'un paie l'autre. Un Feu reste, à distance égale, la
lumière la plus franche du monde — c'est le critère testé (`render/torche.test.ts`).
Elle **vacille**, et elle **agonise** : `partDeFlamme` fait faiblir la lumière avant qu'elle
meure — le joueur doit voir venir le noir, pas le subir.

## Nombres (à calibrer)

`TORCHE.BURN_TICKS = ticksForCycles(0.13)` (~1/3 de nuit), `TORCHE.ALLUMAGE_RANGE = 2`,
`RECIPES.torche = { requiert: null, inputs: { wood: 1, fiber: 3 }, seconds: 3 }`,
`ITEM_WEIGHT.torche = ITEM_WEIGHT.torche_vive = 1`. Portée/intensité/vacillement du rendu :
`packages/client/src/render/torche.ts`, calibrés **à l'œil sur planche rendue**, à la NOUVELLE
LUNE (le défaut sans snapshot est la PLEINE lune — c'est la nuit la plus facile, donc le mauvais
étalon).

## Hors périmètre

- **Pas de torche posée au sol / au mur.** Ce serait une structure, donc un Feu au rabais, donc
  T-C contourné. Le jour où l'on voudra éclairer un lieu, ce sera une PIÈCE du registre.
- **Pas de PNJ porteur de torche.** `equipBestTool` classe des outils au rang ; la torche n'a pas
  de rang, et un PNJ qui s'éclaire n'a aucun besoin de jeu (il ne voit pas — le joueur, oui).
- **Pas d'allumage à une autre source** (foudre, fumerolle, cendreux ardent). Une seule origine,
  c'est ce qui fait la laisse.
