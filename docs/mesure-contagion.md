# L'anomalie de la contagion — la racine, mesurée

> **Nature.** Réponse à l'anomalie ouverte le 2026-07-31 dans `docs/decisions.md` (« LE PLAFOND DE
> LA CONTAGION NE BORNE RIEN », **MESURÉE, NON TRAITÉE, à arbitrer**). La note s'arrêtait sur un
> raisonnement — *« quel système l'enlève : SUSPECTÉ, non établi… je ne l'ai pas observé, seulement
> raisonné »*. Ce document OBSERVE. Instrument : `tools/diag-contagion.mts`.
>
> *Établi le 2026-07-31, nuit.*

---

## 1. La racine, en une phrase

**Personne ne « retire » les levés : un autre Cendreux les ABAT, dans le tick même de leur levée.**

Un Cendreux frappe à **34**, un Cendreux a **20 PV** (`MONSTER_DEFS.cendreux`) : **un seul coup en
tue un**. Et `resolveStrike` le dit en toutes lettres (`combat.ts:403`) — *« le pipeline de
résolution ne connaît pas les camps et frappe TOUT ce qui est dans la zone »* —, avec la **harde**
(`herdId`) pour seule exception. Or un rôdeur de la nuit et le levé qui sort du cadavre qu'il vient
de faire ne partagent aucune harde, **et le levé sort exactement sous lui** : la levée pose le
Cendreux à `corpse.x, corpse.y`, c'est-à-dire à l'endroit précis où le rôdeur se tient et frappe.

L'ordre du tick achève de refermer le piège : `advanceCendreux` (la levée) court **avant**
`advanceCombat` (la résolution des wind-ups). Le levé naît, puis le coup déjà lancé se résout sur
lui, dans le même tick. Il n'a jamais joué un seul tick vivant.

## 2. Ce que ça explique — les deux défauts n'en font qu'un

La note disait : *« les deux défauts se masquent mutuellement — le plafond ne mord pas parce que
les levés ne vivent pas, et les levés ne font pas de dégâts parce qu'ils ne vivent pas. Corriger
l'un sans l'autre est risqué. »* C'est exact, et **ils ont désormais une seule cause**.

- **`risenAlive` reste à 0** parce qu'aucun levé ne survit à son tick de naissance. Le plafond
  `CENDREUX.MAX_ALIVE = 24` se lit sur ce compteur : il ne peut donc jamais mordre.
- **La contagion est invisible** pour la même raison : le levé ne frappe jamais personne.
- **Les « 662 morts non attribuables »** sont un artefact d'instrument, et le mécanisme est le
  même : une entité **née ET tuée dans le même tick** est invisible à un classificateur qui
  photographie les monstres au DÉBUT du tick. Il faut lire `entity_died.wasMonster`, que `die()`
  évalue à l'instant de la mort. Une fois lu correctement, il ne reste **aucune** mort inexpliquée.

## 3. Les mesures

Toutes au calendrier RÉEL (échelle 300, six cycles), jour 45 (acte III), une nuit entière
(20 399 ticks), seed 2026. `node --import tsx tools/diag-contagion.mts <joueurs> <seed> [options]`.

| Montage | Morts | dont non-monstres | Levées | Sort des levés | `risenAlive` (pic) | Marqués (pic) |
|---|---|---|---|---|---|---|
| banc (6 j.), témoin soigné, loin | 17 | 3 | **0** | — | 0 | 0 |
| banc (6 j.), témoin soigné, **maison** | 4 | 2 | **0** | — | 0 | 0 |
| **production (50 j.)**, témoin soigné, loin | 20 | 0 | **0** | — | 0 | 0 |
| **banc (6 j.), témoin MORTEL, loin** | **828** | 495 (dont **493 le témoin**) | **313** | **313 TUÉS dans leur tick** · 0 retirés | **0** | **180** |

**Le tueur est nommé** : `#32 monstre cendreux (ambient+nightHunter) ×229` et
`#36 monstre cendreux (ambient+nightHunter) ×84` — les deux rôdeurs plantés par la nuit qui chasse.
313 levés, 313 abattus par deux Cendreux. Aucun « retiré sans mourir » : la piste de la dissipation
d'ambiant, que la note soupçonnait sans l'observer, est **écartée par la mesure**.

### Ce que le montage doit à l'instrument, et ce qu'il ne lui doit pas

Les trois premières lignes du tableau ne produisent **aucune** levée : l'anomalie ne se reproduit
que si le témoin **meurt** — 493 fois en une nuit, parce qu'il respawne à l'endroit même où le
rôdeur l'attend et se fait retuer aussitôt. **Ce chiffre-là est un artefact**, personne ne joue
comme ça.

**Mais le mécanisme, lui, ne l'est pas.** Il ne demande qu'**une seule** mort : un joueur (ou un
PNJ) tué seul, loin d'un feu, par un Cendreux qui reste planté sur le corps. C'est *exactement* le
cas nominal que la spec R6-R7 décrit — la contagion, « le lore pris au mot ». Le montage mortel ne
fabrique pas le défaut : il le rend **statistiquement visible** en le répétant.

## 4. Une conséquence de design, pas seulement un bug

La levée est **la** promesse du monstre qui donne son nom au jeu : *on veille ses morts au feu, ou
ils reviennent*. Aujourd'hui, dans le cas le plus dramatique — mourir seul, dans le noir, sous les
coups d'un Cendreux — **ce qui se relève est détruit avant d'avoir bougé d'un pixel**, par son
propre meurtrier. Le joueur ne voit rien, n'apprend rien, et la vallée ne garde aucune trace.

## 5. Ce qui reste à TRANCHER (Alexis)

Le correctif change le jeu : une vallée qui comptait **0 levé vivant** peut en compter **jusqu'à
24**. Ce n'est pas une décision technique. Trois questions, dans l'ordre où elles se posent.

**Q1 — Les Cendreux se frappent-ils entre eux ?** C'est la racine, et elle a une réponse déjà
écrite ailleurs dans le code : la **harde** existe précisément pour ça (« les loups se placent de
part et d'autre de la proie ; l'arc attrapait le frère d'en face, et la meute se décimait toute
seule »). Le même remède s'applique — mais faut-il l'appliquer à **l'espèce** (aucun Cendreux ne
blesse un Cendreux : ils deviennent une faction) ou seulement au **couple tueur→levé** (le
meurtrier épargne ce qu'il vient de créer, le reste continue de se gêner) ? *Ma recommandation :
l'espèce.* Les morts-vivants qui s'entretuent ne racontent rien, et la version étroite laisserait
le défaut revenir dès qu'un TROISIÈME Cendreux passe par là.

**Q2 — Le plafond compte-t-il la promesse ou la consommation ?** (la question déjà posée par la
note). `risenAlive` compte les levés VIVANTS ; on a mesuré **180 cadavres marqués simultanément**
contre un plafond de 24. **MAIS CE 180 NE PROUVE RIEN AUJOURD'HUI** : il est fabriqué par les 493
morts du témoin, et ce montage n'existera plus une fois Q1 corrigée — un levé qui survit occupe
une place, donc le plafond se refermera de lui-même bien avant d'accumuler 180 promesses. **Q2 se
re-mesure APRÈS Q1**, elle ne se trancie pas sur le chiffre de cette nuit. *Ma recommandation :
ne rien changer maintenant*, relancer `diag-contagion` une fois Q1 posée, et ne compter la
promesse que si le pic de marqués dépasse encore le plafond dans un montage nominal.

**Q3 — Faut-il un dégât de zone entre monstres du tout ?** Hors sujet immédiat, mais c'est la
généralisation : aujourd'hui, deux zombies d'une même horde « se gênent » par conception assumée.
Rien à changer sans une raison de jeu — je le signale pour que Q1 ne l'ouvre pas par accident.

## 6. Le garde

`cendreux.test.ts` — **A34** verrouille le fait mesuré : dans un tick COMPLET, le levé meurt à son
tick de naissance sous le coup de son meurtrier.

**Pourquoi la suite ne l'avait pas vu, compté :** avant A34, le fichier appelait `advanceCendreux`
**seul, hors du tick, à sept endroits**, et ne jouait un tick complet qu'à **deux**. Hors du tick,
aucun wind-up ne se résout — le levé survit toujours. Ce n'est pas un oubli de cas, c'est un banc
d'essai qui ne pouvait structurellement pas produire le phénomène.

**Contre-épreuve jouée** (pour que le test ne passe pas par accident) : à `hp` 100 au lieu de 20,
le levé encaisse les 34 et survit — A34 échoue. Il mesure donc bien « un coup, un mort », pas une
coïncidence d'ordonnancement.

Le jour où Q1 est tranchée, **l'assertion s'inverse** : c'est le même test qui prouvera le
correctif.
