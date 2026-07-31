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

## 4. Une conséquence de design, pas seulement un bug *(corrigé — voir §5)*

La levée est **la** promesse du monstre qui donne son nom au jeu : *on veille ses morts au feu, ou
ils reviennent*. Dans le cas le plus dramatique — mourir seul, dans le noir, sous les coups d'un
Cendreux — **ce qui se relevait était détruit avant d'avoir bougé d'un pixel**, par son propre
meurtrier. Le joueur ne voyait rien, n'apprenait rien, et la vallée ne gardait aucune trace.
C'est ce qui fait que ce n'était pas un bug de comptage, et que la réponse d'Alexis — *« TOUS les
cendreux sont alliés entre eux »* — est une règle de jeu, pas un rustinage.

## 5. L'arbitrage — Q1 tranchée et livrée, Q2 re-mesurée

**Q1 — Les Cendreux se frappent-ils entre eux ? → TRANCHÉE (Alexis, 2026-07-31) : « TOUS les
cendreux sont alliés entre eux », par ESPÈCE.** Livré : spec `cendreux.md` **R23**, critères **A34**
et **A35**, une garde dans `resolveStrike`. Le levé sort désormais intact du coup en cours de son
meurtrier, et `CENDREUX.MAX_ALIVE` peut enfin mordre.

*Quatre effets de bord, tous mesurés :*

1. **Aucune régression de déterminisme.** `replay`, `events` et `sim` — les trois contrats —
   passent. C'était le vrai risque : un coup qui ne porte plus est un tirage de blessure qui n'est
   plus tiré, donc un flux seedé décalé. **966 verts** ; seuls les tests de nuit ci-dessous ont
   bougé.
2. **Aucun coût par tick mesurable.** Trois relevés du code livré (**0,761 · 0,771 · 0,852
   ms/tick**, `profil-tick 8 4000`) encadrent le témoin sans l'alliance (**0,810**) : l'écart entre
   deux relevés du MÊME code dépasse l'écart au témoin. La garde fait même *moins* de `find`
   qu'avant — un seul relevé du monstre-cible sert les deux alliances et la mise à mort propre, et
   il n'est payé que sur ce qui est réellement dans l'arc.
3. **Le montage des tests A13 était contaminé, et ça s'est vu.** Ils laissaient leur proie mourir —
   or une proie morte **n'est plus une proie** (`preys()` filtre `hp > 0`) : ils mesuraient une nuit
   éteinte, et chaque mort semait un cadavre qui se levait (jusqu'à **119 levés**, d'où leur
   débordement des 30 s). Proie maintenue en vie — comme le fait déjà `recensement-cendreux.mts`,
   pour la même raison —, le nouvel étalon est **22 hurlements / 0 raclements → 29 / 6 → 0 / 16**.
4. **Et ça a découvert un fait de calibrage** (§7).

**Q2 — Le plafond compte-t-il la promesse ou la consommation ? → RE-MESURÉE, TOUJOURS OUVERTE, et
je recommande de NE RIEN FAIRE aujourd'hui.**

Le plafond est lu **à la mort** (`willRiseAsCendreux`) et **jamais à la levée** : une rafale de
morts marque plus de promesses que le plafond n'en autorise, et toutes se lèvent. Post-Q1, dans le
montage à témoin mortel : **184 levés vivants pour un plafond de 24**, pic de 161 cadavres marqués.

**Mais ce chiffre n'est pas une raison d'agir, et voici le critère exact.** Déborder exige **plus de
24 morts à l'intérieur d'une seule fenêtre `RISE_DELAY`** — soit **5 minutes de jeu**. Or la vallée
de la Veillée porte **une quinzaine de vivants au total** : le débordement est **inatteignable en
solo aujourd'hui**, et les 184 ne sortent que d'un témoin qui meurt 493 fois dans la nuit. Toucher
au plafond maintenant, ce serait régler un nombre sur un montage.

**Ce qui le rendra atteignable — quand rouvrir Q2 :**
- **`saison-sans-fin`** : la pression monte sans borne, donc le taux de mortalité aussi. C'est le
  premier chantier qui peut franchir les 24 morts / 5 minutes.
- **La LAN** : n × joueurs, donc n × le rythme des morts, sur la même fenêtre.

Le test à relancer le jour venu est écrit : `node --import tsx tools/diag-contagion.mts`, colonnes
« levées » et « marqués (pic) ».

**Q3 — Faut-il généraliser l'alliance aux autres espèces ? → NON, et Q1 ne l'a pas ouverte.**
R23 nomme les Cendreux et rien d'autre ; la harde (spec faune R11) reste l'alliance LOCALE des bêtes
qui chassent ensemble. Deux loups de meutes différentes continuent de se gêner, et A35 le garde.
À rouvrir seulement sur une raison de jeu.

## 6. Les gardes

`cendreux.test.ts` — **A34** joue des ticks **COMPLETS** et affirme que le levé sort **intact** du
coup en cours de son meurtrier (`risenAlive` vaut 1). Il a d'abord été écrit à l'ENVERS, verrouillant
le défaut ; la décision d'Alexis l'a inversé — c'est donc le même test qui a mesuré le mal puis
prouvé le remède. **A35** en balaye les bords : sous le coup d'un Cendreux, le Cendreux est intact
*et le vivant encaisse* (le coup porte, il n'est pas annulé) ; sous le coup d'un **loup**, le même
Cendreux encaisse ; et le joueur l'abat à la hache comme avant — l'alliance n'est pas un bouclier.

**Pourquoi la suite ne l'avait pas vu, compté :** avant A34, le fichier appelait `advanceCendreux`
**seul, hors du tick, à sept endroits**, et ne jouait un tick complet qu'à **deux**. Hors du tick,
aucun wind-up ne se résout — le levé survit toujours. Ce n'est pas un oubli de cas, c'est un banc
d'essai qui ne pouvait structurellement pas produire le phénomène.

**Contre-épreuve jouée** (pour qu'A34 ne passe pas par accident) : à `hp` 100 au lieu de 20, le levé
encaisse les 34 et survit **même sans l'alliance** — le test échoue alors. Il mesure donc bien
« un coup, un mort », pas une coïncidence d'ordonnancement.

## 7. Un fait de calibrage tombé du correctif (pour Alexis)

En décontaminant A13, la montée acte I → acte III cesse d'être ce que le test affirmait. L'ancienne
assertion opposait les *raclements* d'acte III aux *hurlements* d'acte I — deux événements que deux
espèces n'émettent pas au même rythme — et elle ne passait (38 > 19) que grâce à la fontaine à
cadavres. Sur une proie qui SURVIT, elle s'inverse : **16 raclements contre 22 hurlements**.

La montée existe quand on la mesure sur ce qui se compare, **les chasseurs envoyés : 10 → 11 → 16**
— c'est ce qu'affirme désormais le test. Mais c'est **×1,6**, quand le taux par minute, lui,
**quadruple** (0,12 → 0,55) : le plafond `UNDEAD_MAX_ALIVE` de l'acte mange toute la différence.

C'est exactement le défaut nommé en ouvrant `saison-sans-fin` — *« l'escalade est une table de trois
valeurs, et une table est plate »*. Le voici chiffré **sur la nuit**, qui est pourtant le canal
censé porter la tension (R11). **Décision d'Alexis, pas la mienne** : c'est posé là comme chiffre
d'entrée pour la loi qui remplacera la table.
