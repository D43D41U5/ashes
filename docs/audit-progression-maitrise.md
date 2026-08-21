# Audit de progression — « facile à apprendre, exigeant à maîtriser »

> **Nature.** Audit de *design de progression*, conduit le 2026-08-20 contre un principe directeur strict
> (peu de règles atomiques, un système maître, des trade-offs réels, une révélation étalée). Ce n'est pas
> un audit technique — les trois audits techniques du même jour (`audit-complet-2026-08-20.md` et ses deux
> annexes) portent sur le code ; celui-ci porte sur les *décisions que le jeu propose au joueur*.
>
> **Méthode.** Lecture du GDD, des 43 specs, et du code réellement exécuté (`packages/sim`,
> `packages/client/src/worker/veillee.ts`). Chaque constat cite sa preuve. Aucun fichier n'a été modifié.
>
> **Rien n'est décidé ici.** Les forks sont posés en §7, un par un, avec ma reco en tête — à trancher par
> Alexis, jamais en session.

---

## Convention de lecture : trois couches, trois remèdes

Un même « système » peut vivre à trois endroits, et **une critique n'a de sens qu'à sa couche**. Le
document étiquette donc chaque verdict :

| Étiquette | Ce que ça veut dire | Remède |
|---|---|---|
| **[JOUÉ]** | Le joueur le rencontre dans la Veillée telle qu'elle est buildée | Design de jeu — ça se corrige en jouant |
| **[SIM]** | Codé, testé, mais jamais atteint par la main du joueur | Transmission — ça se câble |
| **[VISION]** | Écrit au GDD, pas construit | Critique de document — ça se réécrit ou ça s'implémente |

Mélanger les trois est le meilleur moyen de rendre un audit inactionnable. Trois des cinq systèmes que
l'énoncé nomme sont **[VISION]**.

---

## 0. Correction de périmètre — à lire avant tout le reste

Quatre des cinq systèmes nommés dans la commande n'existent pas tels que décrits. Ce n'est pas un détail
de forme : cela déplace la question. On ne peut pas auditer la profondeur d'un arbre à 15 branches qui n'a
jamais été planté.

| Demandé | État réel | Preuve | Couche |
|---|---|---|---|
| **Les 4 archétypes** (Foyer, Meute, Ermitage, Charognard) | **Trois** : `foyer \| meute \| neutre`. Ermitage et Charognard différés à la phase Vallée (MVP §13) | `alignment.ts:15` | [VISION] pour 2 sur 4 |
| **La construction par slots** | **Remplacée** le 2026-07-18 par un builder à composition émergente (amas → fonction → palier). Les slots typés n'existent plus | `docs/specs/construction.md`, GDD §6ter (bandeau de révision) | [JOUÉ] mais autre modèle |
| **L'arbre de maîtrise à 15 branches** | **Quatre compétences** : `woodcutting \| mining \| foraging \| crafting`. Une courbe `√(xp/100)`, trois seuils d'outil, un frein de dispersion. Zéro déblocage nommé | `items.ts:193`, `economy.ts:232-248` | [VISION] pour l'arbre |
| **La saison de 60 jours** | **Supersédée** le 2026-07-31 par « la saison sans fin » (décidée, non implémentée). Le solo ne se termine plus ; la saison devient un réglage de vitesse et une période de wipe en multi | `docs/specs/saison-sans-fin.md` | [VISION], le code tient encore les 60 jours |
| **L'alignement Chaleur/Intensité** | **Implémenté et branché** depuis V1-10 : deux voisins PNJ (un Foyer, une Meute) sont fondés dans la Veillée | `veillee.ts:152-154` | [JOUÉ] — avec une réserve majeure, §3.2 |

**Conséquence pour la suite.** Les sections qui suivent auditent en priorité ce qui *se joue*. L'arbre à 15
branches est traité en §5 comme ce qu'il est : une proposition de document, à juger avant d'être payée.

---

## 1. La thèse : le système maître existe, il est bâti, et ce n'est pas celui que le GDD nomme

Le GDD nomme l'axe Chaleur/Intensité comme le cœur (« la morale est une mécanique », pilier n°2). L'énoncé
de l'audit reprend cette nomination. **Le code dit autre chose, et le code a raison.**

Le vrai système maître d'ASHES est **le Feu**. Un seul objet, sept fonctions, toutes déjà branchées :

| Fonction du Feu | Preuve |
|---|---|
| Il **nourrit** — le cru ne nourrit plus un homme, la cuisson passe par lui | `tension.md` T3, `FIRE.COOK_INPUTS` |
| Il **réchauffe** — la nuit mord dès l'acte I | `tension.md` T4, `TEMPERATURE` |
| Il **protège** — la parade de la nuit qui chasse, c'est un feu ou rentrer | `tension.md` T13, `NIGHT_HUNT` |
| Il **autorise à bâtir** — le carré de privilège, `R` par palier | `construction.md` R1-R2, `FIRE_RADIUS_BY_TIER` |
| Il **débloque** — le palier du Feu plafonne les composants posables | `construction.md` R6, `COMPONENTS.unlockTier` |
| Il **ressuscite** — le respawn | `construction.md` R6 |
| Il **consomme** — le seul évier permanent de l'économie | `FIRE_UPKEEP` |
| Il **affiche l'alignement** — la couleur du Feu *est* l'archétype | `alignement.md` R9 |

Les cinq règles de `tension.md` — le poids, la faim, la pourriture, la repousse, la nuit — convergent
toutes vers lui. **C'est exactement l'architecture que le principe directeur réclame** : un système maître
dont les autres sont des expressions. Elle est là. Elle n'est simplement pas nommée.

L'axe Chaleur/Intensité, lui, n'est pas un système maître : c'est une **lecture** du Feu, un cadran sur le
tableau de bord. Il ne structure aucune décision quotidienne (§3.2 le démontre). Continuer à le nommer
« le cœur » a un coût réel : ça pousse à investir dans le cadran plutôt que dans le moteur.

> **Le critère que j'utiliserai partout** — appelons-le *la règle de l'expression* : **un bon système
> secondaire parle le vocabulaire du système maître.** Le gel n'apprend rien de neuf (il fait froid → le
> Feu). La pourriture n'apprend rien de neuf (ça se gâte → cuis-le au Feu). Le compteur de compétence,
> lui, parle une langue à part. C'est là que se paie l'apprentissage, pas dans le nombre de systèmes.

---

## 2. La carte des systèmes

### (a) Cœur — sert directement l'axe central

| Système | Pourquoi c'est le cœur |
|---|---|
| **Le Feu** (chaleur, cuisson, upkeep, palier, respawn, carré) | *Est* l'axe central |
| **Faim + Température + Endurance** | Trois jauges, une seule réponse : le Feu |
| **Le portage** (4 paliers de charge) | Fait exister le trajet : ramener est le jeu |
| **La fraîcheur / pourriture** | Force le passage par la cuisson, donc par le Feu |
| **La récolte vivante** (repousse 45 min, épuisement local) | Chasse le joueur hors du cercle domestique |
| **La nuit qui chasse + les Cendreux** | La seule machine d'escalade dont la montée soit perceptible (mesuré : 6 nuits/saison, 3 hordes ; la nuit se tire à la minute) |
| **La construction par composition émergente** | Une règle unique (amas → fonction ; amas riche → palier haut) couvre tout le bâti. Le mieux conçu du dépôt contre le principe |
| **Les réfugiés** (recruter / nourrir / dépouiller) | Le **seul** endroit où l'axe moral produit une décision coûteuse, lisible, et qui vient au joueur |

### (b) Expression secondaire légitime — enrichit sans coût d'apprentissage

| Système | Pourquoi ça passe |
|---|---|
| **Météo, gel, flore-froid, brume, blizzard** | Parlent la langue du Feu (il fait froid → rentre). Coût d'apprentissage ≈ 0 |
| **Forêts vivantes, eau vivante, stratigraphie, toponymes** | Géographie, pas règles. C'est ce qui rend la carte lisible et donc l'économie politique |
| **Les 12 zones + POI + découverte de lieux** | « La carte est l'économie » (GDD §8). Se lit, ne s'apprend pas |
| **La découverte de recettes** (modèle Valheim) | **Le meilleur dispositif de révélation du dépôt.** Le catalogue reste proportionnel à la progression |
| **Le geste de récolte à maîtrise** (abattage / minage / cueillette) | L'incarnation de « actif, jamais AFK », et le seul endroit où la maîtrise se *sent* dans la main. ⚠️ **Trois vocabulaires distincts, et aucun n'est gaté** — voir C9 |
| **La file de craft** | Donne une durée au travail, donc un « pendant ce temps ». ⚠️ Arrive empilée avec trois autres vocabulaires — voir C10 |
| **Le tableau du village + les PNJ** | Fin en solo (3 PNJ), mais c'est le germe du vrai sujet en multi |
| **La chronique** | Sortie, pas entrée. Coût d'apprentissage nul |

### (c) Candidats à simplification / fusion / suppression

| # | Système | Verdict en une ligne | Couche |
|---|---|---|---|
| **C1** | **Les paliers d'archétype** (4 multiplicateurs) | Ne changent aucune décision. La spec porte déjà sa propre réserve | [JOUÉ] |
| **C2** | **L'axe Intensité (engagement)** | N'est pas un axe : c'est un compteur d'activité, et sa moitié « isolée » est vide | [JOUÉ] |
| **C3** | **L'absence de coût d'opportunité au bâti** | Au palier 1, on bâtit **les quatre fonctions**. Il n'y a pas de build | [JOUÉ] |
| **C4** | **Le frein de dispersion des compétences** | Un dispositif d'interdépendance multi appliqué à un solo sans contrepartie | [JOUÉ] |
| **C5** | **La régénération modulée par la chaleur du Feu** | Un multiplicateur caché, illisible, qui contredit une décision actée du GDD | [JOUÉ] |
| **C6** | **L'arbre à 15 branches** | 6 branches sur 15 ne changent aucune décision distincte aujourd'hui | [VISION] |
| **C7** | **L'agriculture (voie A)** | Un vocabulaire parallèle dont l'identité de destination (l'Ermitage) n'existe pas | [JOUÉ] |
| **C8** | **Le double calendrier** (jour de saison ≠ cycle jour/nuit) | Le joueur voit « JOUR 30 » et un seul lever de soleil pour dix jours | [JOUÉ] |
| **C9** | **Les trois gestes de récolte, tous dégatés** | Aucun des trois nœuds de base n'exige d'outil : les trois mini-jeux tombent dans les cinq premières minutes | [JOUÉ] |
| **C10** | **La pile artisanale** (file + découverte + station + palier d'outil) | Quatre vocabulaires livrés d'un bloc avant la première nuit | [JOUÉ] |

---

## 3. Les quatre tests, système par système

### 3.1 — Les quatre archétypes de village

**Test de suppression.** Retirer Ermitage et Charognard : **aucune décision ne change**, ils ne sont pas
codés. Retirer Foyer et Meute *comme paliers d'effet* : aucune décision ne change non plus (voir C1).
Retirer Foyer/Meute *comme identités affichées* : on perd la couleur du Feu, donc la lisibilité politique
— là, quelque chose se perd vraiment, mais c'est de la **lecture**, pas de la mécanique.

**Test de service à l'axe.** Ils *sont* l'axe. Le problème est inverse : l'axe ne sert rien d'autre.

**Test du trade-off.** ⚠️ **Échec.** Le Foyer prend +25 % PV de structure, ×2 régén max, −40 % de
dégâts offensifs contre un non-agresseur. La Meute prend +20 % de dégâts, −25 % de récolte. Dans la
Veillée telle qu'elle est jouée — un joueur, trois PNJ, deux voisins à l'autre bout de la carte — **le
Foyer est un bonus quasi pur.** Son seul malus ne mord que contre un extérieur non-agresseur ; or le seul
extérieur qui vous attaque est la Meute PNJ, marquée agresseur dès qu'elle raide.

*Portée exacte du constat, parce qu'elle n'est pas totale* : `AGGRESSION_MEMORY_TICKS` vaut **un cycle**,
et R13 fait décrocher les raiders à l'aube. Pendant le raid et le cycle qui suit, le malus est levé et le
Foyer frappe à plein. **Il ne mord que sur une expédition punitive lancée plus d'un cycle après le
dernier raid** — c'est-à-dire précisément la seule action que le Foyer n'a aucune raison de faire, la
défense lui étant offerte. Le malus existe, il ne s'oppose à rien qu'un Foyer veuille faire.

**Test de la première heure.** Invisible avant d'avoir fondé un village *et* marché jusqu'à un voisin
placé au maximum de distance (`veillee.ts:152` trie les emplacements par distance **décroissante**). En
pratique : jamais dans la première heure. **C'est bien** — mais c'est aussi pourquoi l'axe ne structure
rien.

> **Constat central.** La décision d'Alexis sur T1 (« le voisin Meute est une pression *distante et
> évitable* ») est cohérente avec le GDD (l'isolement est un build). Mais elle a une conséquence non
> tirée : **elle disqualifie l'axe moral comme système maître en solo.** On ne peut pas à la fois placer
> l'extérieur hors de portée quotidienne et attendre qu'il structure les décisions. Il faut choisir ce que
> l'axe est : *le cœur* (et alors l'extérieur doit venir à vous) ou *une couleur* (et alors le GDD doit
> cesser de le nommer pilier n°2). Voir fork **F1**.

### 3.2 — L'alignement émergent (Chaleur / Intensité)

**Test de suppression — l'axe Chaleur.** Retirer la chaleur : les verbes `give`, `feed_refugees`,
`heal`, `rob_refugees` perdent leur conséquence longue. **Une décision change vraiment** — celle des
réfugiés (nourrir vs recruter vs dépouiller). Elle survit à l'axe : dépouiller donne du butin,
nourrir coûte des vivres. Mais le **poids moral** de ce choix vient de l'axe. Verdict : **garder**, et
noter que sa valeur est presque entièrement portée par UN système (les réfugiés).

**Test de suppression — l'axe Intensité (engagement).** ⚠️ **Échoue.** `ENGAGEMENT_PER_ACT: 8` est
appliqué à **tout** acte, chaud comme froid (`alignment.ts:41`). Il ne mesure donc pas un choix, il mesure
une activité. Son seul usage est un seuil : `engagement ≥ 20` conditionne l'accès à un archétype
(`ARCHETYPE_ENGAGEMENT: 20`). Or les deux archétypes *isolés* — les seuls pour qui un engagement bas
serait une identité, pas une absence — n'existent pas. **Remplacer `engagement ≥ 20` par
`|warmth| ≥ 40` ne changerait aucune décision de joueur, et retirerait un axe à apprendre.**

**Test du trade-off.** L'anti-farm est absent en solo (« l'anti-farm par collusion attend le multi »,
spec R2), mais le plafond par faim *utile* le remplace correctement : gaver un repu ne vaut rien. Bon
design. En revanche l'**inertie** est calibrée pour un monde qui n'existe pas : `DECAY_PER_DAY: 2` en
points par **jour de saison**, et un jour de saison dure **4,8 minutes réelles** en Veillée. Un −60 se
rachète donc en ~2h24 d'inaction — presque une partie entière. Le « paquebot » est en réalité un kayak
lesté par le calendrier compressé. **À mesurer avant de calibrer** (fork **F5**).

**Test de la première heure.** Absent, et c'est bien (voir §6).

### 3.3 — La construction

**Test de suppression.** Retirer la règle d'émergence (amas → fonction → palier) et revenir à
« je bâtis une forge » : on perdrait le placement libre, le débit parallèle, le bonus d'enceinte. En solo,
le débit parallèle ne change rien (un artisan). Le bonus d'enceinte, lui, est un **vrai** trade-off :
murer + toiter coûte des matériaux, contraint la navigabilité (R7) et rapporte durabilité / vitesse /
conservation. **Verdict : garder, c'est le système le mieux aligné du dépôt sur le principe.** Une règle
apprise en dix secondes couvre tout le bâti et se dévoile toute seule (le fantôme prédictif annonce
« → Forge N2 » avant la pose). C'est l'exemplarité même.

**Test de service à l'axe.** Excellent : le carré vient du Feu, le palier vient du Feu, l'upkeep vient du
Feu. Zéro règle parallèle.

**Test du trade-off.** ⚠️ **Échec, et c'est le plus gros du dépôt.** Trois faits mesurés :

1. Les quatre composants primaires ont `unlockTier: 1` (`pieces.ts` : `enclume`, `workshop`, `silo`,
   `parcelle`). **Les quatre fonctions sont donc disponibles dès le palier 1.**
2. Leurs coûts sont dérisoires : établi 6 bois + 4 pierre, silo 8 bois + 4 fibre, parcelle 4 bois +
   4 fibre. Un sac plein finance l'ensemble.
3. `FIRE_UPKEEP.DRAIN_PER_TICK` est **plat** — modulé par l'acte (`ACT_FACTOR: [1, 1.5, 2]`) et par rien
   d'autre. **Posséder plus ne coûte rien de récurrent.**

Le modèle à slots que le pivot a remplacé portait une propriété que le nouveau a perdue sans la
remplacer : *« moins de slots que de bâtiments désirables — chaque village a un build qui exprime sa
philosophie »* (GDD §6ter). Aujourd'hui, il n'y a **pas de build** : il y a un ordre de construction dicté
par la disponibilité des matériaux, et tout le monde finit avec les quatre mêmes fonctions. La « rareté
organique » promise par R3 (« ce qui limite : le palier, les matériaux, le temps, la pression de saison »)
ne limite qu'au T2/T3, où `iron_ingot` et `cut_stone` mordent enfin. **L'acte I du bâti est un checklist.**

**Test de la première heure.** Le marteau et le feu de camp arrivent tôt, et c'est juste — c'est le
système maître. Mais les quatre fonctions arrivent aussi tôt, ce qui grille en une heure ce qui aurait dû
être l'arc du bâti.

### 3.4 — L'arbre de maîtrise

Traité en §5.

### 3.5 — Le mode Veillée et le paquet `/sim`

**Test de suppression.** Aucun : c'est de l'architecture, pas une règle de jeu. Le joueur n'apprend rien
de `/sim`. Le principe de l'énoncé ne s'y applique pas.

**Un mot quand même, parce qu'il a un effet de design réel.** L'invariant « une simulation, pas deux
jeux » (CLAUDE.md §7) est excellent techniquement et a un coût de design non facturé : **il fait hériter
au solo des mécanismes conçus pour le multi.** Trois exemples relevés dans cet audit — le frein de
dispersion des compétences (C4), l'axe Intensité (C2), le budget de spécialisation à 15 branches (C6) —
sont des dispositifs d'**interdépendance entre joueurs**. Appliqués à un joueur seul avec trois PNJ qui
ne font que ramasser et mijoter, ils deviennent des taxes sans contrepartie. Le remède n'est pas de casser
l'invariant : c'est de **paramétrer** ces dispositifs par l'hôte, comme `faunaCap` et `meteoActive` le sont
déjà (`veillee.ts:129-131`). Le précédent existe dans le code.

---

## 4. Catégorie (c) — propositions concrètes

Chaque proposition est chiffrée en **deux monnaies** : ce qu'elle fait à la profondeur stratégique, et ce
qu'elle coûte en risque de déterminisme (tout changement qui déplace le *nombre* ou l'*ordre* des entités
décale le flux RNG seedé et casse des tests sans rapport).

---

### C1 — Les paliers d'archétype : quatre multiplicateurs qui ne décident de rien

**Constat.** `FOYER_STRUCTURE_HP_BONUS: 1.25`, `FOYER_OFFENSE_MALUS: 0.6`, `MEUTE_DAMAGE_BONUS: 1.2`,
`MEUTE_HARVEST_MALUS: 0.75`. Aucun ne change *quelle action le joueur choisit* — seulement un chiffre à
l'intérieur d'une action qu'il aurait faite de toute façon. La décision actée n°3 du GDD dit exactement le
contraire : « continu pour les stats passives, **paliers pour les capacités débloquées** ». `alignement.md`
R8 porte déjà sa propre réserve sur ce point.

**Proposition (reco).** Remplacer les quatre multiplicateurs par **une capacité nommée par archétype**,
avec une adresse physique raidable (R6 de `construction.md` le prévoit déjà) :

- **Foyer → le Marché franc** (déjà au catalogue, différé) : une zone où le premier sang est impossible.
  En solo : une zone où les réfugiés s'arrêtent d'eux-mêmes au lieu de traverser. Une décision — *où* je
  la pose, *qui* j'y laisse entrer.
- **Meute → le Serrage inversé, dit « la Curée »** : ce qui est déposé au Feu de la Meute dans les N ticks
  suivant un raid ne pourrit pas. Une décision — raider *avant* la pourriture de mon stock, ou après.

**Impact profondeur.** ➕➕ Deux décisions là où il y en avait zéro. Et surtout : les identités cessent
d'être des coefficients invisibles pour devenir des **objets qu'on voit dans le village d'un autre** — ce
qui est le fondement de la lisibilité à trois couches du GDD §3.

**Coût déterminisme.** ⚠️ Moyen. Retirer les multiplicateurs de combat/récolte change les issues de
combat au banc, donc rebaseline les scénarios ; ne déplace **pas** le compte d'entités, donc le flux RNG
tient. Ajouter une structure « marché » **ajoute une entité** → à isoler sur un chemin neuf.

**Alternative moins chère si le fork n'est pas mûr.** Retirer les quatre multiplicateurs *sans* les
remplacer, et laisser la couleur du Feu comme seul effet. On perd zéro décision (il n'y en avait pas) et
on retire quatre nombres à calibrer. C'est le geste le moins cher du document.

---

### C2 — L'axe Intensité : un axe qui n'en est pas un

**Constat.** `engagement` monte de 8 à chaque acte, quel qu'il soit. Il ne se choisit pas. Sa seule
fonction est un seuil (`ARCHETYPE_ENGAGEMENT: 20`) dont la moitié utile — les archétypes isolés — n'est
pas codée. Le joueur voit donc deux axes annoncés et n'en pilote qu'un.

**Proposition (reco).** **Ne pas supprimer le champ** (il porte la moitié isolée de la matrice, qui
arrivera avec l'Ermitage en phase Vallée) mais **cesser de le présenter comme un axe** tant que ses deux
archétypes n'existent pas :

- Le HUD et le profil n'affichent plus qu'**une** dimension : la chaleur du Feu.
- Le seuil d'archétype devient `|warmth| ≥ ARCHETYPE_WARMTH` seul.
- `engagement` reste calculé, muet, prêt pour la Vallée.

**Impact profondeur.** ➖ Zéro perte (aucune décision n'y était attachée). ➕ Un axe de moins à apprendre
dans le premier tiers — exactement le budget que le principe demande d'économiser.

**Coût déterminisme.** ✅ Faible. Un seuil de comparaison change ; le champ reste sérialisé, donc les
sauvegardes tiennent ; le flux d'événements ne change que si un village bascule d'archétype à un tick
différent → une seule garde à rebaseliner (`alignment.test.ts` A5, `scenario`).

---

### C3 — Le bâti sans coût d'opportunité : rendre l'upkeep proportionnel

**Constat.** §3.3 : quatre fonctions au palier 1, coûts dérisoires, upkeep plat. Il n'existe aucun moment
où le joueur se demande « laquelle ? ».

**Proposition (reco).** **Ne pas ressusciter les slots.** Faire porter la rareté par le système maître,
qui existe déjà : **la consommation du Feu croît avec ce qu'il entretient.**

```
DRAIN = DRAIN_BASE × ACT_FACTOR(acte) × (1 + DRAIN_PAR_FONCTION × nbFonctionsDISTINCTES)
```

`recognizeFunctions()` rend déjà la liste, pure et déterministe (`construction.ts:508`). Il n'y a rien à
inventer : la question devient « **qu'est-ce que je garde allumé cet hiver ?** », posée dans le vocabulaire
que le joueur connaît depuis la minute 20 (nourrir le Feu). Zéro règle neuve.

> ⚠️ **Compter les `functionId` DISTINCTS, pas les fonctions reconnues.** R11 supprime l'unicité : deux
> enclumes espacées font **deux** Forges. Compter les entrées taxerait doublement le joueur qui a bâti une
> redondance défensive — laquelle ne lui rapporte rien en solo (le débit parallèle exige un second
> artisan). Le coût doit suivre *ce qu'on sait faire*, pas *combien de fois on sait le faire*.

Corollaire naturel et gratuit : **démonter devient un geste de jeu** (l'action `demolish` existe en /sim et
n'est pas câblée — le clic droit est débranché, cf. l'audit de transmission de `gate1-finition.md`). Le
village qui pivote démonte sa ferme pour tenir sa forge. C'est exactement le storytelling que le GDD §6ter
attendait du « démolir/remplacer ».

**Impact profondeur.** ➕➕➕ **La plus forte du document.** Elle crée le premier vrai coût d'opportunité
du bâti, elle le fait sans ajouter de vocabulaire, et elle donne enfin un sens au geste de démolition.
Elle rend aussi l'acte III réellement dangereux : `ACT_FACTOR` ×2 sur un village étalé devient une
décision de repli.

**Coût déterminisme.** ⚠️ Moyen. Aucun changement de compte d'entités → RNG intact. Mais tous les bancs
de scénario changent de trajectoire (les greniers, les populations PNJ). Prévoir un rebaseline complet de
`scenario.test.ts` et des sondes.

**Tension à arbitrer.** C'est frontalement la tension **T3** de `direction-design.md` (économie de flux vs
« un village survit à 3-4 jours d'abandon »). Un multiplicateur trop raide transforme la Veillée en
corvée. **Ma reco : calibrer `DRAIN_PAR_FONCTION` pour qu'un village complet à l'acte I tienne encore
~2,5 cycles** (contre 3,5 aujourd'hui) et laisser l'acte III faire le reste. À mesurer au banc, pas à
décider ici.

---

### C4 — Le frein de dispersion : une taxe sans contrepartie en solo

**Constat.** `SKILL_SPREAD_PENALTY: 0.5` freine le gain d'XP proportionnellement à la somme des niveaux
des **autres** métiers (`economy.ts:241`). L'intention est le GDD §6 : « personne ne maîtrise tout », donc
le village est une nécessité. En solo, le joueur **doit** pratiquer les quatre métiers — il n'y a personne
à qui déléguer (les PNJ ramassent et mijotent le ragoût ; ils ne forgent pas). Le frein ne crée donc pas un
choix : il allonge la courbe.

**Nuance honnête.** Il *reste* une décision de séquençage : pousser `mining` vers `GATE_IRON_LEVEL: 5`
plus tôt que `crafting`. C'est mince, mais ce n'est pas nul.

**Proposition (reco).** Faire de la pénalité un **réglage d'hôte**, comme `faunaCap` et `meteoActive` :
`spreadPenalty` passé à `createSim()`, à ~0,15 en Veillée, à 0,5 en LAN/Vallée. Le solo garde une pente
de spécialisation lisible ; le multi garde son interdépendance.

**Impact profondeur.** ➕ en solo (la courbe cesse de punir un choix qui n'existe pas), ➖ zéro en multi.

**Coût déterminisme.** ✅ Faible — même patron que `faunaCap`, un champ d'options. ⚠️ Mais l'XP change,
donc les niveaux franchis à des ticks différents → `skill_level_up` se déplace dans le flux d'événements.
Isoler et rejouer toute la suite sim.

---

### C5 — La régénération modulée par la chaleur : un multiplicateur illisible

**Constat.** `regenFactor()` module la régén de PV de ×0,75 à ×2 selon la chaleur du Feu
(`alignment.ts:110`). Le joueur ne peut ni la voir, ni la déduire, ni la choisir. Et le GDD §6bis
interdit explicitement la régénération passive (« sinon le médecin et le lit ne servent à rien ») — l'écart
est déjà signalé dans le GDD lui-même (`<!-- écart code -->`) et ouvert comme fork **T4**.

**Proposition (reco).** Faire porter le bénéfice de la chaleur par un **objet**, pas par un coefficient :
le lit de soin (composant `Infirmerie`, catalogué et différé). Un Foyer soigne parce qu'il a une
infirmerie, pas parce qu'un nombre est haut. La chaleur devient alors un **prérequis d'accès** au
composant, pas un multiplicateur.

**Impact profondeur.** ➕ Une décision (bâtir l'infirmerie, la murer pour le bonus) remplace un
coefficient. ➕➕ Et ça déverrouille le fork T4 : retirer la régén passive devient jouable, parce qu'une
parade construite existe.

**Coût déterminisme.** ⚠️ Élevé si couplé à T4 (la survie des PNJ change de régime — c'est ce que T4
craint). ✅ Faible si on ne fait que *déplacer* le facteur sur la présence d'un composant.

---

### C6 — L'arbre à 15 branches

Traité en §5 (proposition chiffrée branche par branche).

---

### C7 — L'agriculture voie A

**Constat.** `graine` → `parcelle` → `legume`. Quatre nouveaux mots (semer, parcelle, mûrir, récolter) pour
un aliment « au niveau des baies » (commentaire de `items.ts:47`). Le GDD place l'agriculture dans le
cercle domestique, qui doit être « médiocre — un village y survit, n'y prospère jamais » (§8bis). Sa
destination de design est l'**Ermitage** (« là où le Foyer prospère par le flux, l'Ermitage prospère par le
rendement », GDD §4) — un archétype qui n'existe pas.

**Test du trade-off.** Non résolu, et **il se mesure** : le potager bat-il, par minute de joueur, une
tournée de cueillette ? Si oui, il casse la doctrine du cercle domestique. Si non, personne ne le
construira. Je n'ai pas lancé la mesure — c'est une passe `pnpm scenario`, pas une lecture de code.

**Proposition (reco).** Ne rien supprimer — le mécanisme est bâti et propre. **Le déplacer dans la courbe
de révélation** : la `graine` ne se craft qu'à partir de baies (déjà le cas) ; faire que la recette
`graine` ne se **découvre** qu'à l'acte II, quand la cueillette sauvage se ferme sous le gel
(`flore-froid` suspend déjà la pousse). L'agriculture cesse d'être une cinquième chose à apprendre au
jour 1 pour devenir **la réponse à un problème qu'on vient de rencontrer**. C'est la meilleure forme de
révélation : on n'apprend jamais aussi bien qu'après avoir manqué.

**Impact profondeur.** ➕ Aucun gain de règle, gros gain de *rythme*.

**Coût déterminisme.** ✅ Très faible — c'est une condition de découverte (`decouverte.ts`), pas un
comportement de sim.

---

### C8 — Le double calendrier

**Constat.** Le HUD affiche `JOUR 30 — ACTE II — 14H` (`UIScene.ts:731`). Or en Veillée,
`VEILLEE_SEASON_CYCLES = 6` compresse 60 jours de saison en 6 cycles jour/nuit :

- 1 cycle jour/nuit = **48 minutes réelles** (`CYCLE_REAL_MINUTES`), dont 30 min de jour et 18 de nuit.
- 1 **jour de saison** = 4,8 minutes réelles.
- Le compteur du HUD avance donc de **10 jours par lever de soleil**.

Le joueur voit « JOUR 12 » puis « JOUR 14 » sans que le soleil ait bougé. Le calendrier qui porte toute
l'escalade (actes, `ACT_FACTOR`, gel, hordes) est **désynchronisé de la seule horloge qu'il perçoit**.

**Proposition (reco).** Ne plus afficher le jour de saison en solo. Afficher **l'acte** (qui est un
marqueur de fiction — c'est précisément ce que `saison-sans-fin` R2 en fait) et **le cycle** :
`3ᵉ NUIT — LE GRAND FROID`. Le nombre de nuits survécues est la mesure que le joueur *vit* ; c'est aussi
celle qui a du sens quand la saison n'a plus de fin (O6).

**Impact profondeur.** ➕ Lisibilité pure. Aucune règle touchée.

**Coût déterminisme.** ✅ Nul — client seul.

---

### C9 — Les trois gestes de récolte arrivent tous dans les cinq premières minutes

**Constat.** Les trois verbes de `recolte-maitrise.md` sont trois mini-jeux **différents** : l'abattage
(jauge à remplir, relâcher dans le vert), le minage (lire le flanc faible et le frapper), la cueillette
(les coins riches). Trois grammaires, trois lectures d'écran, trois échecs possibles. Et les trois nœuds
de base sont **tous à `minTool: 'none'`** (`balance.ts:1032-1038` : `tree`, `rock`, `berry_bush`,
`fiber_plant`). **Rien ne les étale.** Un joueur qui sort du spawn peut rencontrer les trois avant sa
première nuit — je l'avais supposé étalé par l'outil, c'est faux.

**Test de suppression.** Retirer un geste : la décision (*quoi récolter*) ne change pas — le geste est de
l'**expression**, pas du choix. C'est légitime : sans lui, la récolte serait une barre de progression, ce
que le GDD interdit (§8bis, les deux interdits). Donc on ne supprime rien.

**Test de service à l'axe.** ✅ Tous les trois alimentent le Feu (bois → combustible, pierre → composants,
baies → cuisson). Aucune règle parallèle.

**Test du trade-off.** Neutre : les trois sont complémentaires, aucun ne domine.

**Test de la première heure.** ⚠️ **C'est là qu'il échoue** : trois vocabulaires simultanés, au moment où
le joueur apprend aussi à se déplacer, à lire quatre jauges et à survivre à une nuit.

**Proposition (reco).** Ne pas toucher aux gestes. **Gater le geste, pas le nœud** : à mains nues, la
récolte reste le coup baseline (elle l'est déjà — le geste à maîtrise est « purement additif »,
`economy.ts`) ; **le mini-jeu ne s'arme que quand on tient l'outil de la famille.** La cueillette (sans
outil) reste donc le geste du jour 1, l'abattage arrive avec le hachereau de fortune, le minage avec le
pic. L'étalement devient une conséquence de la progression au lieu d'un vœu.

**Impact profondeur.** ➕➕ Zéro perte de profondeur (les trois gestes survivent intacts), un gain de
rythme net, et un **micro-payoff supplémentaire à fabriquer son premier outil** : l'outil ne rend pas
seulement plus, il ouvre un *geste*.

**Coût déterminisme.** ⚠️ Moyen. Le geste change le rendement (`isCleanFell` / `isCleanMine`) → les bancs
de scénario bougent. Aucun changement de compte d'entités → flux RNG intact.

---

### C10 — La pile artisanale : quatre vocabulaires livrés d'un bloc

**Constat.** Avant sa première nuit, le joueur qui ouvre TAB rencontre d'un coup :

1. **La file de craft** (`craftQueue`, 6 lignes, le travail a une durée) ;
2. **La découverte** (`seen` — le catalogue s'ouvre quand on touche la matière) ;
3. **L'exigence de station** (`requiert.fonction` — cette recette veut une Forge N2) ;
4. **Le palier d'outil effectif** (`effectiveTier` — ta hache de fer rend comme un atelier tant que ton
   niveau ne la « maîtrise » pas).

Quatre règles, dont la quatrième est **silencieuse** : rien à l'écran ne dit pourquoi la hache de fer
rend moins que promis.

**Test de suppression.** La file : ➕ (crée le « pendant ce temps »). La découverte : ➕➕ (c'est la
meilleure courbe de révélation du dépôt). L'exigence de station : ➕➕ (c'est ce qui fait que le bâti
compte). **Le palier d'outil effectif : ⚠️ il ne change aucune décision** — le joueur ne choisit pas son
niveau, et il n'a de toute façon qu'une hache. Il ne fait que retarder un rendement, invisiblement.

**Test de service à l'axe.** Les trois premiers servent le Feu (les stations sont des amas du Feu). Le
quatrième est une règle à part, qui parle la langue des compétences.

**Test du trade-off.** L'exigence de station en crée un vrai (bâtir la Forge N2 ou continuer au fer de
récup). Les trois autres, non.

**Test de la première heure.** ⚠️ Échec sur le point 4, qui n'a rien à y faire.

**Proposition (reco).** Garder 1-3 tels quels. Pour le point 4, **une ligne d'interface, pas un
changement de règle** : afficher dans l'infobulle de l'outil « *rend comme : atelier (niveau requis :
5)* ». Le gate devient un **objectif lisible** au lieu d'une déception muette — et il rejoint alors la
famille des déblocages nommés que §5.1 défend.

**Impact profondeur.** ➕ Le gate le plus élégant du système de compétences cesse d'être invisible.

**Coût déterminisme.** ✅ Nul — client seul (`effectiveTier` est déjà exporté par `/sim`, le HUD lit la
règle, il ne la refait pas).

---

## 5. Focus : l'arbre à 15 branches

### 5.1 — L'état réel

Ce qui est **codé** : 4 compétences, une courbe `√(xp/100)`, et — ce que le GDD n'admet pas et qui est
pourtant le point intéressant — **quatre déblocages réels, pas des multiplicateurs** :

| Déblocage codé | Effet | Constante |
|---|---|---|
| Palier d'outil effectif | Un outil trop bon pour son niveau rend comme le meilleur palier maîtrisé | `GATE_BASIC_LEVEL: 2`, `GATE_IRON_LEVEL: 5`, `GATE_STEEL_LEVEL: 8` |
| Cueillette experte | Les champignons ne se récoltent qu'au-dessus d'un niveau | `NODE_DEFS.champignon.minForageLevel` |
| Marge du geste | La zone verte de l'abattage et la tolérance du flanc au minage s'élargissent | `fellGreenWidth`, `mineTolerance` |
| Micro-marche de rendement | +1 tous les 8 niveaux, entière — elle survit au `floor` | `SKILL_YIELD_STEP: 8` |

**Ce système est meilleur que sa réputation dans les docs.** Il fait exactement ce que l'Annexe A promet
— des seuils qui ouvrent des choses, une maîtrise qui se *sent* dans la main (le geste devient plus
tolérant) — avec quatre branches au lieu de quinze.

Le fork **T5** de `direction-design.md` le décrit comme « un compteur de rendement ». Ce n'était pas faux
à l'écriture : **T5 date du 2026-07-19, et les gates d'outil ont atterri le jour même** — commit
`30e8aa2`, « LA RÉCOLTE VIVANTE — la ressource dérive, **la compétence ouvre l'outil** ». T5 n'est pas une
erreur, c'est une note **périmée le jour de sa rédaction**. Il faut la redater avant de décider quoi que
ce soit, sinon on paiera la réimplémentation d'un modèle qui tourne déjà.

### 5.2 — Les 15 branches passées au test de suppression

Le discriminant : **retirer cette branche change-t-il quelle action un joueur choisit, ou seulement un
chiffre à l'intérieur d'une action qu'il aurait faite ?** Les paliers 1-2 étant déclarés « hors budget »
(tout le monde peut savoir un peu de tout), je juge sur les paliers 3-4, ceux qui coûtent.

| Branche | Décision distincte qu'elle ouvre | Verdict |
|---|---|---|
| **Mêlée** | La *Frappe assommante* (P3) ouvre la capture → rançon → politique. C'est le verbe qui rend le choix létal/non-létal jouable | ✅ **Garder** — porte à elle seule le cœur moral du combat |
| **Défense** | *Sous le pavois* (P3) : protéger un allié qui porte/soigne/crochète. Une décision de position en groupe | ✅ Garder — **mais 100 % multi.** Sans allié, elle n'existe pas |
| **Tir** | *Munitions spéciales* (P3, feu/filet) : utilitaire, pas DPS | ⚠️ **Fusionner** — voir 5.3 |
| **Forge** | L'**acier** (P3). Le seul palier du jeu qui soit déjà « un événement de village » | ✅ **Garder** — c'est le modèle |
| **Menuiserie** | Machines de siège (P3) : la décision d'entrer en guerre a un coût matériel | ✅ Garder (multi) |
| **Mécanique** | Serrures **et** crochetage (P3) : la course serrurier/voleur, interne à la branche | ✅ Garder (multi). Vide avant l'acte II — **par design**, et c'est bien |
| **Couture/cuir** | Tenues d'hiver (P3) : la parade au Grand Froid | ⚠️ **Suspendue au fork T2.** Si le froid ne gèle que l'altitude, cette branche n'a pas de raison d'être. *Ce fork se tranche avant d'investir un jour dessus* |
| **Agriculture** | Serres (P3) → le Terroir (Ermitage) | ⚠️ Dépend d'un archétype inexistant (voir C7) |
| **Chasse/pêche** | *Traque* (P4) : suivre les traces de joueurs. Une décision d'enquête | ✅ Garder (multi). P3 (lecture des migrations) recoupe Exploration P3 |
| **Cuisine** | *Table ouverte* (P4) : les repas servis à des étrangers pèsent plus en Chaleur | ❌ **Fusionner.** P1-P2 (cuire, conserver) sont des règles de base déjà codées et **obligatoires** — le GDD reconnaît lui-même ce piège pour Médecine 1. P4 est un modificateur de coefficient sur l'axe chaleur : *aucune décision distincte* |
| **Médecine** | Bandage (P1) — universel, obligatoire, déjà hors budget de l'aveu du GDD. *Triage* (P4) est le vrai déblocage | ⚠️ **Amputer par le bas** : P1-P2 doivent être des mécaniques de base, pas une branche. Le GDD le dit en note de vigilance ; il faut en tirer la conséquence |
| **Herboristerie** | Stimulants (P3, endurance temporaire contre fatigue) : un vrai trade-off | ✅ Garder — **mais fusionner avec Médecine.** Deux branches pour « soigner » alors que la décision (traiter maintenant vs plus tard) est la même |
| **Exploration** | *Cartographie* (P2) : l'information devient un objet échangeable et volable. *Passes* (P4) : franchissements exclusifs | ✅ **Garder** — l'une des plus fortes, et la seule qui fabrique un **objet** échangeable |
| **Furtivité** | *Déguisement* (P3) : porter les couleurs d'un autre village. Une décision politique entière | ✅ Garder (multi, et c'est du drama pur) |
| **Portage** | *Colonne* (P3) : le convoi. *Intendance* (P4) : le camp avancé | ✅ Garder — « la branche méprisée qui gagne les guerres », et le GDD a raison |

**Décompte.** Sur 15 : **9 ouvrent une décision distincte**, 3 sont suspendues à un fork non tranché
(Couture/T2, Agriculture/Ermitage, Tir), **2 sont à fusionner** (Cuisine dans Subsistance, Herboristerie
dans Médecine), et **1 est à amputer par le bas** (Médecine P1-P2 → mécaniques de base).

**Et une observation qui vaut plus que le décompte : sur les 9 à garder, 7 ne produisent leur décision
qu'en multijoueur.** Sous le pavois protège *un allié*. Le déguisement trompe *quelqu'un*. La cartographie
s'échange. La colonne dirige *un convoi*. **L'arbre des maîtrises est un système multijoueur.** L'auditer
contre la boucle solo, c'est mesurer un instrument sur le mauvais banc.

### 5.3 — Ce que je recommande

**15 branches n'est pas justifiable maintenant. 8-9 le sont, à terme. 5-6 suffisent pour la Vallée.**

**Reco (l'ordre compte) :**

1. **Ne rien étendre avant GATE 1.** Les 4 compétences codées, avec leurs seuils d'outil et leur marge de
   geste, sont un modèle *qui fonctionne*. Le fork T5 recommandait déjà de « commencer par le seul
   fer/acier, valider le modèle, puis étendre » — cet audit confirme, avec une correction : **le modèle est
   déjà validé**, il n'est simplement pas documenté comme tel.
2. **Corriger la doc.** `direction-design.md` T5 dit « le code n'a qu'un compteur de rendement ». Faux.
   Réécrire, sinon on paiera une réimplémentation d'un système qui existe.
3. **Fusionner avant d'ajouter.** Cible : **5 familles → 9 branches** au lieu de 15.
   - Combat : **Mêlée**, **Défense**, **Tir** → fusionner Tir dans Mêlée sous **« Armes »** ? *Non* —
     l'arc est déjà codé avec son propre profil (`tir.md`) et sa décision est distincte (distance vs
     mêlée). **Garder trois.**
   - Artisanat : **Forge**, **Menuiserie**, **Mécanique** → garder trois (chaînes de matériaux distinctes).
     **Couture** → fusionner dans Menuiserie sous « Ouvrage », ou geler jusqu'au fork T2.
   - Subsistance : **Chasse**, **Agriculture**, ~~Cuisine~~ → **Cuisine devient une mécanique de base**
     (cuire est déjà obligatoire — `tension.md` T3 en a fait une règle du monde, pas une compétence).
   - Soin : **Médecine** (absorbe Herboristerie ; le bandage descend en mécanique de base).
   - Terrain : **Exploration**, **Furtivité**, **Portage** → garder trois. C'est la famille la plus saine
     de l'arbre : trois décisions vraiment distinctes, aucun recouvrement.
4. **Le budget de spécialisation (2 branches P4 + 2-3 P2, avec érosion) : le différer explicitement au
   multi.** En solo il n'a pas de contrepartie (C4). Le poser en solo, c'est punir un joueur d'être seul.

**Impact profondeur.** ➕ Passer de 15 à 9 ne retire **aucune** décision distincte (les fusions
recouvrent des décisions identiques) et retire six vocabulaires à apprendre. C'est le principe directeur
appliqué à la lettre.

**Coût déterminisme.** ✅ Nul aujourd'hui — rien de tout cela n'est codé. C'est précisément pourquoi c'est
le meilleur moment pour trancher.

---

## 6. La courbe de révélation

### 6.1 — Le problème avant la proposition : la saison dure quatre heures et quarante-huit minutes

L'énoncé demande une courbe sur 60 jours. Voici ce que 60 jours **valent réellement** dans une Veillée
neuve (une sauvegarde fige son `calendarScale` — `MenuScene.ts:77` — donc ces nombres valent pour une
partie démarrée à neuf, ce qui est le cas de GATE 1) :

```
CYCLE_REAL_MINUTES = 48          VEILLEE_SEASON_CYCLES = 6
→ une saison entière = 6 × 48 min = 288 min = 4 h 48
→ un « jour de saison » = 4,8 min réelles
→ ACT_BOUNDARIES = [21, 42] :
     Acte I   (j. 1-20)  = 96 min   = 1 h 36
     Acte II  (j. 21-41) = 101 min  = 1 h 41
     Acte III (j. 42-60) = 91 min   = 1 h 31
```

Une courbe étalée sur 60 jours qui s'effondre en une soirée n'est pas implémentable. **Il faut exprimer la
révélation en actes et en heures de joueur, puis mapper vers les jours** — et pas l'inverse. Ce qui suit
le fait. (Et c'est doublement nécessaire : `saison-sans-fin` supprime le point d'arrivée. Une courbe
ancrée sur « le jour 60 » n'aurait plus de sol.)

**Le repère qui compte pour GATE 1** : « la boucle est-elle fun 5 sessions d'affilée ? ». Une session de
45 min (GDD §6) ≈ **un cycle jour/nuit** ≈ **10 jours de saison**. La bonne unité de la courbe, c'est
donc **le cycle** — et cinq sessions couvrent 240 des 288 minutes, soit presque la saison entière.

**Ce n'est pas une reconstruction de ma part : le code raisonne déjà ainsi.** L'en-tête de
`VEILLEE_SEASON_CYCLES` dit « une saison d'environ 6 × `CYCLE_REAL_MINUTES` (≈ 5 h) à jouer EN PLUSIEURS
SÉANCES — le format « 5 sessions » de GATE 1 ». Le raisonnement en cycles est donc déjà celui de
l'implémentation ; ce sont les **documents de design** qui parlent encore en jours de saison, et c'est là
qu'est le décalage.

### 6.2 — La courbe proposée

| Repère | Cycle | Ce que le joueur **voit et utilise** | Ce qui reste **invisible** |
|---|---|---|---|
| **J1** — les 5 premières minutes | c1, matin | **Trois choses.** Ramasser (baies, fibres — *le geste de cueillette seul*, cf. C9) · La faim · La nuit qui vient | Tout le reste. Zéro menu obligatoire. *Aujourd'hui : l'abattage et le minage tombent ici aussi, et c'est le défaut que C9 corrige* |
| **J1-J3** — la première nuit | c1, soir | Le **feu de camp** — et il fait *quatre* choses d'un coup : il chauffe, il cuit, il éloigne les loups, il éclaire. **Le système maître se présente entier, en un objet.** Le hurlement annonce | L'alignement, le bâti, les métiers, le calendrier |
| **J4-J10** | c1 fin → c2 | **Le village** (fonder le Foyer) · Le **marteau** et *une* fonction · Les **outils de fortune** — et avec eux **l'abattage puis le minage à maîtrise** (C9) · Le poids qui contraint le retour | Les paliers du Feu. Le fer. Les voisins |
| **J10-J20** — fin de l'acte I | c2 | L'**upkeep** (le Feu faiblit — le conseil se dit à cet instant, `onboarding.ts`) · Le geste à maîtrise récompense enfin (les seuils d'outil à niveau 2) · Les **premiers PNJ** et le tableau | L'acier. Le froid létal |
| **J21** — bascule acte II | c3 | **Le Grand Froid s'annonce.** La consommation double, le gel ferme la cueillette, les Cendreux prennent une nuit sur deux (`UNDEAD_SHARE: [0, 0.5, 1]`) | — |
| **J21-J30** | c3 | La **réponse au froid** — et elle doit arriver *après* le problème : agriculture (C7), tenues, murs+toit (le bonus d'enceinte) · Le **palier 2 du Feu** (40 bois + 30 pierre) · Le **fer** | L'acier. Le Terroir |
| **J30-J41** | c4 | La **rencontre** : réfugiés sur les routes, marchand, et — pour qui va les chercher — **les deux voisins**. C'est ici que l'axe moral doit s'allumer, pas avant | Les capacités d'archétype |
| **J42** — bascule acte III | c5 | **La Cendre.** Le monde ne rend plus rien de neuf : on vit sur ce qu'on a bâti | — |
| **J42-J55** | c5 | L'**acier** (palier 3 du Feu : 30 pierre de taille + 8 lingots) · Les **capacités d'archétype** (C1) · La méga-horde télégraphiée | — |
| **J55-J60** | c6 | Le **verdict** : l'Arche, la chronique, la stèle de fin | — |

### 6.3 — Les trois principes qui font tenir cette courbe

1. **Un système ne se révèle qu'après le problème qu'il résout.** L'agriculture après le gel. Les tenues
   après la première nuit qui fait mal. Le grenier après la première pourriture. C'est déjà le patron de
   l'onboarding par état (`onboarding.ts`) — il suffit de l'appliquer aux *systèmes*, pas seulement aux
   conseils. **C'est le levier le plus rentable du document : il ne coûte que des conditions de
   découverte.**
2. **Le dispositif existe déjà et il est bon.** La découverte de recettes par la matière (modèle Valheim,
   `decouverte.ts`) fait précisément ça : le catalogue reste proportionnel à la progression. **Il suffit
   de l'étendre des recettes aux *fonctions*** (la Ferme ne s'affiche au marteau qu'à l'acte II ; le four
   d'acier quand on tient un lingot). Un `unlockAct` à côté de `unlockTier` dans `pieces.ts` — quelques
   lignes, aucun risque de déterminisme, l'infrastructure est là.
3. **Étaler par le palier du Feu, pas par le niveau.** Le palier du Feu est déjà la porte
   (`COMPONENTS.unlockTier`) : il est **cher, visible, collectif et raidable**. C'est le meilleur
   régulateur de rythme du jeu. Aujourd'hui il ne régule presque rien parce que les quatre fonctions
   primaires sont toutes au palier 1 (C3). **Répartir les quatre fonctions primaires sur les trois
   paliers** ferait à lui seul la moitié de la courbe ci-dessus.

---

## 7. Les forks — à trancher, un par un, jamais en session

Posés par ordre de blocage. Ma reco est en tête de chaque, comme demandé.

**F1 — L'axe moral est-il le cœur, ou une couleur ?**
*Reco : une couleur en solo, le cœur en multi — et le dire.* La décision T1 (voisin distant, évitable) est
bonne et cohérente avec le GDD §4. Mais elle disqualifie l'axe comme structure de décision solo. Le seul
porteur crédible du moral en Veillée, ce sont **les réfugiés** — parce qu'ils *viennent à vous*. Les
promouvoir (plus fréquents, avec un vrai coût des trois verbes) coûte peu et allume le pilier n°2 sans
contredire T1. *Conséquence si l'on tranche l'inverse* : il faut rapprocher la Meute, et la Veillée cesse
d'être un Ermitage tranquille.

**F2 — Les paliers d'archétype : capacités nommées, ou rien ?** (C1)
*Reco : rien, tout de suite ; capacités quand le multi arrive.* Retirer quatre multiplicateurs qui ne
décident de rien est gratuit. Les remplacer par le Marché franc / la Curée est un vrai chantier, dont le
public est multi.

**F3 — L'upkeep devient-il proportionnel au bâti ?** (C3)
*Reco : oui, et c'est ma proposition la plus forte.* Mais c'est frontalement T3 (l'anti-corvée). À
calibrer au banc avant de trancher — je peux instruire, je ne tranche pas un nombre.

**F4 — Combien de branches de maîtrise, et quand ?** (§5)
*Reco : zéro extension avant GATE 1 ; viser 9 et non 15 ; différer le budget de spécialisation au multi.*
Amende T5, qui sous-évalue l'existant.

**F5 — L'inertie de l'alignement est-elle calibrée pour le calendrier réel ?**
*Reco : à mesurer, pas à décider.* `DECAY_PER_DAY: 2` par jour de saison = 2 points toutes les 4,8 minutes
réelles. Le « paquebot » du GDD tourne peut-être comme un kayak. Une passe `pnpm scenario` répond.

**F6 — Le froid gèle-t-il la plaine ?** (T2, déjà ouvert)
Non rouvert ici, mais **il bloque deux items de cet audit** : la branche Couture (§5.2) et le placement de
l'agriculture dans la courbe (C7). Il gagnerait à passer devant.

**F7 — Le mini-jeu de récolte s'arme-t-il à mains nues ?** (C9)
*Reco : non — le geste vient avec l'outil.* C'est une décision de *feel* autant que de rythme (un joueur
peut trouver frustrant de perdre l'expression du geste jusqu'au premier outil), donc elle t'appartient. Je
signale la conséquence : en l'état, les trois grammaires de récolte tombent dans les cinq premières
minutes, et le premier outil ne récompense que par un chiffre.

---

## 8. Le verdict, en une page

**ASHES a déjà le système maître que le principe directeur réclame — le Feu — et il ne le sait pas.** Il en
nomme un autre (l'axe moral) qui, dans le mode réellement jouable, ne structure aucune décision
quotidienne parce qu'une décision de design cohérente l'a placé à l'autre bout de la carte.

Là où la simplicité a été sacrifiée sans gain de profondeur, c'est en trois endroits précis :

1. **Le bâti n'a plus de coût d'opportunité.** Le pivot de 2026-07-18 a gagné en élégance (une règle
   couvre tout le bâti) et perdu, sans le remplacer, ce que les slots achetaient : « moins de slots que de
   bâtiments désirables ». Au palier 1, on bâtit les quatre fonctions. Il n'y a pas de build, donc pas de
   village qui exprime une philosophie. **C3 le répare dans le vocabulaire du Feu, sans ajouter une règle.**
2. **L'identité d'archétype est un jeu de coefficients.** Quatre multiplicateurs invisibles là où le GDD
   avait acté des capacités nommées. Le Foyer domine trivialement en solo parce que son malus ne s'applique
   jamais au seul ennemi qu'on a.
3. **Un arbre de 15 branches est budgété pour un jeu multijoueur, et on l'évalue contre un solo.** 7 des 9
   branches qui survivent au test de suppression ne produisent leur décision qu'avec d'autres joueurs. En
   attendant, les 4 compétences codées font déjà, en petit, ce que l'Annexe A promet en grand — et le seul
   document qui en parle (T5) est périmé du jour de sa rédaction.
4. **La première heure est saturée, et pas des bonnes choses.** Trois mini-jeux de récolte sans aucun
   gate (C9), quatre vocabulaires d'artisanat livrés d'un bloc (C10), quatre jauges plus la charge plus la
   fraîcheur. Pendant ce temps, ce qui *devrait* occuper l'heure une — le Feu et ses quatre fonctions en un
   objet — passe au milieu de ce bruit. Le remède ne coûte presque rien : **gater le geste par l'outil**,
   et **répartir les fonctions sur les paliers du Feu** au lieu de les ouvrir toutes au palier 1.

Et là où le jeu est **exemplaire** contre le principe, il faut le dire aussi, parce que c'est le modèle à
étendre : le Feu qui fait sept choses avec un seul mot ; la composition émergente qui couvre tout le bâti
avec une règle ; la découverte de recettes par la matière, qui est déjà une courbe de révélation qui
marche ; et `tension.md`, qui a nommé le piège (« ralentir la récolte ne crée pas de tension, ça crée du
grind ») avant d'y tomber.

**Le geste unique qui rapporterait le plus : rendre l'upkeep du Feu proportionnel à ce qu'il entretient.**
Il crée le premier vrai trade-off du bâti, il n'ajoute aucun vocabulaire, il donne un sens au geste de
démolition qui dort déjà dans `/sim`, et il rend l'acte III réellement dangereux. Une ligne de formule,
un rebaseline de bancs, et le village redevient une suite de choix.

---

*Aucune décision n'est actée par ce document. Les forks sont en §7, à prendre un par un.*
