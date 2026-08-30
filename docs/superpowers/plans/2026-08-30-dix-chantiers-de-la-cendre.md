# Les dix chantiers de la Cendre — brainstorm du 2026-08-30

> **DÉCISION D'ALEXIS (2026-08-30) : « on suit tes recos »** — les dix chantiers sont actés,
> les questions ouvertes sont tranchées sur les recos du texte, l'ordre de construction est
> celui du bas de page. Consigné dans `docs/decisions.md`.
>
> ⚠ **DEUX PRÉMISSES CORRIGÉES à la reconnaissance** (le backlog est optimiste aussi dans
> l'autre sens) : ① le SÉCHÉ et la PÉREMPTION existaient déjà (`DRY_SLOT`, `SPOIL_CYCLES`,
> peche.md D13) — le chantier 3 est donc devenu **la claie salée** (S4bis de `peche.md`) : le
> sel se pose dans le séchoir, l'unité qui finit de sécher sort SALÉE (pleine valeur du cuit,
> ne pourrit jamais) et consomme UN sel. **Construit le 2026-08-30** ; reste la corvée PNJ
> « saler les réserves » (tranche 2). ② l'AGRICULTURE existe déjà (`agriculture.md`, potager
> voie A, cultures de saison S16) — le chantier 2 n'introduit pas l'agriculture, il lui ajoute
> les **cultures de cendre** (l'orge-de-braise…), seules à pousser l'hiver, sur le sol chaud
> et sans neige ; « cendre-exclusif » se relit : ces variétés-là ne poussent QUE dans la
> cendre, le potager vivant garde les siennes.

*(Demande d'Alexis : « la cendre manque cruellement de features… 10 propositions nouvelles et
sans te limiter par les règles que j'ai éditées ». Rien ici n'est acté — chaque chantier sera
tranché UN PAR UN, et passera par sa spec avant son code. Ce document est le complément du
catalogue `2026-08-27-ecosysteme-de-la-cendre.md` : les six pistes qui y restent ouvertes
(colonisatrices ③, nécrophage ⑤, fosse ouverte ⑦, retombées ⑧, eau morte ⑨, trouvailles ⑩)
ne sont PAS recopiées ici — les dix propositions ci-dessous sont neuves, même quand elles
frôlent une piste (la différence est notée à chaque fois).)*

**L'état des lieux qui motive tout** (inventaire du 2026-08-30, vérifié dans le code) : la
cendre AGIT énormément — froid R22, hantise R23, mur et morsure de faune R25, neige bue G7bis,
succession R20, caractères R21, fumerolles, charbonnières — mais le joueur, lui, n'a que
**trois verbes** : récolter le sel, récolter le charbon, brûler un charnier (R16). Et deux de
ses produits n'ont **aucun consommateur** : `salt` et `ash` ne servent à rien. Le système est
une pompe qui tourne à vide côté joueur. Les dix chantiers attaquent ça par quatre axes :
**l'agence** (1, 5), **l'économie** (2, 3, 4), **le monde vivant** (6, 7, 8) et **le sens**
(9, 10).

---

## 1. LA BRAISE-MÈRE — la parade qui se nourrit *(reco n° 1)*

**La promesse.** La première structure qui négocie avec la cendre. « Tenir la ligne » devient
un projet de village — pas un talent, un BUDGET.

**Le mécanisme.** Une pièce T3 du registre `PIECES` (une seule entrée, comme tout le bâti),
posable n'importe où mais utile près d'une frange. Elle porte un `fuel` comme le Feu de
village — mais elle mange du **charbon**, pas des bûches. Tant qu'elle brûle,
`avancerLaCendre` traite le foyer de sa cellule (`foyerDeLaTuile`) comme une fosse brûlée
R16 : `cendreAge[foyer]` ne monte pas. Éteinte, le foyer reprend sa marche — **sans
rattrapage** (reco ferme : comme R16, le temps gagné est acquis ; un rattrapage punirait
l'oubli d'une absence par la perte de tout le travail, c'est un piège à abandon).

**Pourquoi c'est architecturalement propre.** Zéro octet d'état cendre ajouté : le `fuel`
vit dans la structure (mécanisme existant du Feu), et `avancerLaCendre` — appelé une fois
par bascule de jour — demande « une braise-mère active existe-t-elle dans la cellule de ce
foyer ? », une lecture des structures. R3ter est respecté au mot : elle repousse le SEUIL
(l'avancée), jamais le CLIMAT (le froid R22 de ce qui est déjà cendré reste).

**Les ordres de grandeur** (à calibrer au banc). Le charbon est rare : 1 par 4 bûches
consumées + les charbonnières (gisement fini, ~36 fûts × 5 au jour 240). Une braise-mère qui
mange ~8-12 charbons par jour de jeu fait de « tenir UN foyer » un vrai métier de village —
et tenir les ~9 foyers de la carte est hors de portée d'un joueur seul : la vallée entière ne
se sauve pas, on choisit CE qu'on sauve.

**La contrepartie obligatoire.** Les Cendreux doivent la HAÏR : cible prioritaire des sièges,
au même rang que les feux (les buveurs de foyer existent déjà — même grammaire). Et le
`vent_de_cendre` la frappe au portefeuille : son `FEU_CONSO` 1,8 s'applique. Sans ces deux
morsures, c'est une défense sans drame.

**Liens.** Le chantier 4 peut l'exiger comme receveuse d'un composant d'amorçage (un cœur de
braise pour l'allumer) ; le chantier 5 s'appuie sur le même verbe « le feu contre la fosse ».

**Questions.**
- **Q1a** — Gate de progression : Forge N2 + plan trouvé ? Ou débloquée par le premier
  `cendre_prend` vécu (le village a VU la cendre prendre un village PNJ) ?
- **Q1b** — Une seule par foyer (l'emplacement devient un choix de territoire) ou empilables
  sans effet cumulé (poser la deuxième est une erreur lisible) ?
- **Q1c** — Confirmes-tu « sans rattrapage » ?

---

## 2. LE JARDIN DE SUIE — la cendre est un sol

**La promesse.** La nature ne revient jamais (R15 tient) — mais ce que le joueur PLANTE dans
la cendre pousse. L'ironie fondatrice du jeu : la terre qui a tout tué est la seule qui se
cultive en hiver.

**Pourquoi la cendre, précisément.** Deux mécanismes DÉJÀ construits la prédestinent : la
cendre est chaude (R11quinquies, 30 jours de refroidissement) et **il n'y neige jamais**
(G7bis — la cendre boit la neige). C'est objectivement le seul sol du jeu qui travaille en
plein Grand Froid.

**Le mécanisme.** L'agriculture n'existe pas dans ASHES — ce chantier l'introduit PAR la
cendre, et ma reco est qu'elle y RESTE : pas de champs dans les prés (le monde vivant se
récolte, il ne se cultive pas — c'est la cendre morte qui se laisse écrire). Deux ou trois
variétés, pas plus :
- **l'orge-de-braise** — la calorie. Pousse partout en cendre, rendement multiplié sur
  cendre FRAÎCHE (< 30 j — suivre `ancienneteDeCendre`) : la meilleure terre est la plus
  proche du front. Le jardin optimal est un jardin en danger.
- **le bulbe salin** — pousse à ≤ `FUMEROLLE.RAYON` d'une bouche. Condiment/composant des
  salaisons (chantier 3) : la Salée devient un potager.
- *(le champignon de souche reste à la piste ③ des colonisatrices — le jardin est le versant
  DOMESTIQUÉ, la piste ③ le versant sauvage ; les deux peuvent coexister sans se doubler.)*

**La semence.** Premier plant trouvé, pas fabriqué : une colonisatrice sauvage à
domestiquer, ou une trouvaille de vieille cendre (piste ⑩). L'agriculture se DÉCOUVRE.

**Le contrepoids.** Jardiner au cœur = dormir près de la hantise (0,82 en vieille cendre,
rôdeurs au sommeil déjà branchés) et exposer une richesse fixe aux longues marches des
Cendreux. Le jardin est un aimant à drame nocturne — c'est voulu, c'est son prix.

**Ce que ça casse.** R15, pour le domestiqué seul — l'amendement s'écrit en une ligne : « la
cendre ne fait rien repousser ; elle laisse pousser ce qu'on y sème ».

**Questions.**
- **Q2a** — L'agriculture reste-t-elle cendre-exclusive (ma reco) ou est-ce le pilote d'un
  système général ?
- **Q2b** — Entretien (arroser, sarcler — des corvées PNJ possibles) ou plante-et-attends ?
- **Q2c** — Les PNJ de village jardinent-ils leur propre parcelle de frange (l'économie
  villageoise d'hiver en profiterait — la thermogenèse les affame déjà) ?

---

## 3. LES SALAISONS — le sel trouve sa bouche

**La promesse.** Le trou le plus pur de l'inventaire : `salt` n'a AUCUN consommateur
(vérifié — un nœud, un poids de table, rien d'autre). Les salaisons le branchent sur la
survie d'hiver, fraîchement re-tarifée par la thermogenèse.

**Le mécanisme.** Une recette de feu/atelier : viande crue + sel → **salaison** ; poisson +
sel → **poisson salé**. Effet (sans système de pourrissement, qui n'existe pas) : la
**ration dense** — valeur nutritive ~×1,5 et pile ×2 par case de sac. C'est la nourriture
d'expédition et de réserve : le voyage au cœur, la cache d'hiver, le garde-manger de siège.

**La boucle géographique.** Le sel vit aux fumerolles — donc AU CŒUR (`auCoeurDeLaCendre`,
jamais la frange). La chaîne s'écrit toute seule : l'automne on pêche (la pêche ferme à la
glace — règle du 2026-08-30), on descend au cœur chercher le sel (danger), on sale, l'hiver
on mange. Le caractère **la Salée** (sel ×3) devient un site stratégique de carte, connu et
disputé.

**Les PNJ.** Une corvée d'automne « saler les réserves » (village-board) : l'économie du
village en hiver — que la thermogenèse vient de rendre coûteuse — gagne son amortisseur, et
le joueur peut VOIR un village prévoyant.

**Coût.** Le plus petit chantier des dix : deux items, deux recettes, une corvée. Aucune
règle cassée.

**Questions.**
- **Q3a** — La version « ration dense » te va, ou tu veux d'abord un vrai système de
  péremption (chantier bien plus lourd, qui donnerait au sel son sens profond de CONSERVE) ?
- **Q3b** — Poisson seulement pour commencer (lie les deux chantiers du jour), ou toute
  viande d'emblée ?

---

## 4. LE CŒUR DE BRAISE — les Ouvrages de la Cendre

**La promesse.** Le cœur comme donjon à ciel ouvert : on n'y fuit pas, on y va CHERCHER. Le
GDD nomme des « Ouvrages de la Cendre » (composants T3, §463/§678/§735) jamais raccordés —
ce chantier les raccorde.

**Le mécanisme.** Un Cendreux tué **au-delà de la bande croûte** (profondeur > 15 tuiles —
chez lui, pas sous vos murs) laisse parfois un **cœur de braise** (tirage au PRNG d'état,
~1/3). La condition de profondeur est la serrure anti-farm : les sièges qui viennent à vous
ne paient rien, seule l'expédition paie.

**Les Ouvrages** (dans l'ordre où je les construirais) :
1. **La tenue cendrée** — suspend le froid R22 et divise la « chaleur perçue » à la traque
   thermique (~×0,5) : l'infiltration du cœur devient un style de jeu. (Le DoT R25 est
   faune-seul — la tenue n'a pas à s'en occuper.)
2. **La lanterne de braise** — lumière sans bois, insensible au `FEU_CONSO` du vent de
   cendre : la lumière d'expédition.
3. **L'amorce de la Braise-mère** (chantier 1) — un cœur pour l'allumer : la défense du
   village se paie d'abord en courage.

**Questions.**
- **Q4a** — Le tirage 1/3 ou le drop garanti au premier de chaque nuit (moins de variance,
  plus lisible) ?
- **Q4b** — Valides-tu l'ordre tenue → lanterne → amorce ?

---

## 5. LE BÛCHER RITUEL — la seule inversion

**La promesse.** Le plus gros interdit de la liste, cassé en conscience : l'avancée RECULE.
Pas d'éradication — une ligne qu'on regagne, à prix exorbitant. Sisyphe assumé.

**Le mécanisme.** Sur une fosse déjà tenue par R16 (le feu de jour — le prérequis est le
verbe existant), on **rend les morts à la fosse** : y traîner N cadavres (le traînage de
cadavre est justement un hors-périmètre nommé de `cendreux.md` — ce chantier l'apporte),
puis un rituel de jour d'une journée. Effet : `cendreAge[foyer] −= X` — la loi racine relue
avec un âge réduit rend des tuiles, la frange recule.

**Ce que le recul REND — et c'est le garde-fou du thème.** Un désert, pas une forêt : les
nœuds tombés ne se relèvent pas (R15 intact), le terrain redevient marchable et
constructible, c'est tout. On reconquiert du SOL, jamais du vivant. La cendre reste une
perte ; le bûcher en borne l'étendue.

**Ordres de grandeur.** ~10 cadavres + 1 journée = −3 jours d'âge (≈ le plafond P × 3 : trois
jours d'avancée effacés). Borné : jamais sous `R0` (la tache d'origine est éternelle), un
rituel par fosse et par lune ?

**Ce que ça casse.** La monotonie de R7 (« elle ne recule jamais »). Contention : le recul
n'existe que par la grammaire R16 déjà actée (le feu, le jour, la fosse), il est local,
borné, et hors de prix.

**Questions.**
- **Q5a** — Les morts de QUI ? N'importe quel cadavre (pragmatique), ou des Cendreux
  seulement (thème pur : rendre à la fosse ce qui en est sorti) ?
- **Q5b** — Le recul en une fois au bout du rituel (le moment se VOIT — ma reco) ou étalé ?
- **Q5c** — Le plafond de cadence (une lune par fosse) te va ?

---

## 6. LES COULÉES DE SUIE — l'eau raconte l'amont

**La promesse.** Première interaction cendre-eau du jeu — sans casser R12 : l'eau ne brûle
pas, elle se SALIT. Et la carte gagne un système d'annonce : la rivière grise en aval dit
qu'un foyer grandit en amont, des tuiles avant qu'on le voie.

**Le mécanisme.** Pur, sans état : un point du fil de rivière est « souillé » si le fil
passe à ≤ D tuiles d'une tuile cendrée en AMONT (l'ordre du fil donne l'amont/aval), avec
une **dilution** : la souillure s'éteint à ~40 tuiles de fil sans nouvelle source. Fonction
de l'avancée du jour, comme tout le reste de la cendre.

**Les effets, du doux au fort.**
- *Rendu* : teinte grise du `water-layer` sur le bief souillé, berges tachées — gratuit à
  lire, c'est le cœur du chantier.
- *Pêche* : la table du bief souillé perd ses espèces claires ; une seule y mord,
  **l'ombre-de-suie** — chair amère (nourrit peu), mais huile/cuir gris (composants
  cendrés, lie au 4).
- *Faune* (le cran fort) : un coin de chasse dont l'eau est souillée perd son organe eau →
  re-choix ou extinction (mécanisme R27 existant). La cendre tuerait alors À DISTANCE, par
  l'eau — magnifique et brutal.

**Questions.**
- **Q6a** — La dilution à ~40 tuiles, ou la rivière entière condamnée dès qu'une source la
  touche (plus dur, moins lisible) ?
- **Q6b** — Le cran faune (fort) d'emblée, ou pêche+rendu d'abord et la faune en second
  temps ?
- **Q6c** — Nouvelle espèce (ombre-de-suie) ou simple malus des espèces existantes ?

---

## 7. LES BÊTES CENDREUSES — la faune corrompue

**La promesse.** Le cœur cesse d'être vide : il est corrompu. Et par CONVERSION, pas par
semis — ce qui la distingue nettement du nécrophage (piste ⑤, une espèce semée) : ici c'est
la faune du monde, celle qu'on a rabattue ou laissée mourir dans la cendre, qui revient.

**Le mécanisme.** La cause de mort `'cendre'` existe déjà (R25). Un animal mort par cendre a
~1/3 (PRNG d'état) de se relever après quelques heures — tertre gris, la grammaire du réveil
Cendreux réutilisée. La variante : grise, immunisée au DoT (évidemment), et son habitat est
le PRÉDICAT « tuile cendrée » — elle ne franchit JAMAIS la lisière vers le vivant. Le mur
R25 devient une frontière à double sens, parfaitement lisible : le vivant ne rentre pas, le
corrompu ne sort pas.

**Les espèces.** Le cerf-de-cendre (chassable — viande amère qui nourrit peu, **cuir
cendré** : le composant de la tenue du chantier 4 qui ne vient pas des Cendreux), le
sanglier cendreux (agressif, le danger de jour du cœur — aujourd'hui le cœur de jour est
sûr, c'est un trou de tension).

**La landmine, connue et à respecter.** Tout `MonsterType` ajouté décale le flux RNG seedé
et casse des tests sans rapport — chemin RNG isolé, commit isolé (la leçon est déjà écrite
deux fois dans le dépôt).

**Questions.**
- **Q7a** — Chassables pour ressources (boucle éco, ma reco) ou pure menace ?
- **Q7b** — Le joueur qui rabat VOLONTAIREMENT du gibier dans la cendre pour le convertir et
  récolter du cuir gris : feature (un élevage noir, cohérent avec le pacte du 9) ou exploit
  à fermer ?

---

## 8. LES MURMURES — la cendre se souvient

**La promesse.** La couche narrative, presque gratuite en sim : la vieille cendre est pleine
de morts (le champ `densiteDesMorts` existe, la hantise y monte à 0,82) — la nuit, ils se
REJOUENT.

**Le mécanisme.** La nuit, en bande vieille, des apparitions se lèvent aux pics de densité
(tirage PRNG d'état, événement `murmure_apparu`) : silhouettes floues, non hostiles, qui
rejouent une scène de 5-10 secondes — deux qui se battent, un qui creuse, une procession
vers la fosse. S'approcher **sans courir** (l'allure est déjà lue par la traque thermique —
même lecture) : le murmure « se donne » — une phrase à la chronique de veillée, et un pan de
carte ou une trouvaille (piste ⑩ si elle se construit).

**Le piment.** Un Cendreux qui approche dissipe le murmure — et courir vers un murmure
attire les vrais. Le risque nocturne du cœur gagne une RAISON d'être couru.

**Deux versions, du simple au vertigineux.**
- *(a)* Une banque d'une douzaine de scènes écrites — coût minimal, rendu fantôme côté
  client (alpha sur le pion), aucune persistance.
- *(b)* Les scènes dérivées des événements RÉELS de la partie : le murmure rejoue la vraie
  mort d'un PNJ tombé là (la chronique inversée — le monde vous raconte votre propre
  histoire). Magnifique, mais exige de persister les lieux de mort : de l'état.

**Questions.**
- **Q8a** — Version (a) d'abord, (b) en horizon ? Ou (b) directement ?
- **Q8b** — Récompense matérielle (carte/trouvaille) ou purement narratif ?

---

## 9. LE PACTE DE LA CENDRE — le troisième camp

**La promesse.** Jouer AVEC la cendre. Le jeu le suggère partout (la traque thermique, la
hantise, les caractères) sans jamais le permettre. Un axe d'alignement émergent, consommateur
du flux d'événements — exactement la doctrine du projet (« l'alignement est un consommateur,
on n'instrumente jamais après coup »).

**Le mécanisme.** Un score par joueur, nourri par les `SimEvent` existants et ceux des
chantiers ci-dessus : MONTE en nourrissant une fosse (cadavre jeté hors bûcher), en
éteignant le feu d'autrui, en tuant la nuit près d'un charnier ; DESCEND aux brûlages R16,
à la Braise-mère, au bûcher rituel. Par paliers :
- la traque thermique vous lit plus FROID (les Cendreux vous tolèrent — au palier haut, ils
  vous ignorent sauf provocation) ;
- la hantise cesse de vous coûter des rôdeurs au sommeil (dormir au cœur devient VOTRE
  privilège) ;
- en face : la réputation villageoise chute (les PNJ vous fuient, le tableau du village vous
  refuse) — le pacte a un prix social, pas un prix mécanique.

**Le tell — non négociable en multi.** Un joueur pacté doit se LIRE : le pion grisonne, les
yeux prennent la braise. Un camp invisible serait un outil de griefing ; un camp visible est
un rôle.

**Questions.**
- **Q9a** — Réversible (le pacte se lave, lentement, au feu et aux actes) ou un engagement
  de saison ?
- **Q9b** — Un troisième pôle du système d'alignement officiel (specs alignement — MVP à 2
  axes aujourd'hui) ou un statut à part, plus simple, qui n'attend pas l'alignement complet ?
- **Q9c** — Jusqu'où le tell : lisible à l'écran seulement, ou aussi dans la chronique et le
  tableau du village (« untel sent la cendre ») ?

---

## 10. LA LONGUE NUIT — la dramaturgie d'année

**La promesse.** La cendre a une pente, pas d'ACTE. Le GDD nomme un « objectif final de la
Cendre » (§537, « design détaillé à trancher ») jamais raccordé à la mécanique actuelle. La
Longue Nuit le raccorde : un événement-siège à l'échelle de l'année, annoncé, préparable,
survivable.

**Le déclencheur — géographique, pas abstrait.** Quand deux foyers se TOUCHENT (leurs
champs de coût se rencontrent — calculable, et VISIBLE sur la carte des mois à l'avance) :
« la Jonction ». Au rythme actuel (46 % de vallée à j720), première jonction quelque part en
l'an 2 — le milieu de vie d'une partie longue.

**L'annonce.** Des jours avant : les Vents de cendre élus plus souvent, les murmures qui se
multiplient, la chronique qui compte, le ciel qui charge. Personne ne doit pouvoir dire
« je ne savais pas ».

**L'événement.** Trois jours : part de jour écrasée (la mécanique saisonnière S6 sait déjà
faire), `CENDREUX.GLOBAL` relevé, sièges coordonnés chaque nuit, et — exception assumée,
temporaire, à R3ter — le froid R22 déborde de la cendre : le climat mord, trois jours.

**La résolution.** Survivre (le Feu tient trois nuits) → **tous les foyers gèlent une
saison** — l'année d'après respire, et la chronique s'en souvient. Perdre son Feu → la
vallée bascule : bonus d'âge à tous les foyers. Pas de game over — une vallée qui a perdu sa
Longue Nuit est simplement plus grise, plus dure, plus cendrée.

**Questions.**
- **Q10a** — Le déclencheur « Jonction » (géographique, lisible) te va, ou tu préfères un
  seuil de pourcentage / un jour d'année fixe ?
- **Q10b** — Récurrente (chaque jonction suivante — l'an 4, l'an 6…) ou unique par partie ?
- **Q10c** — En solo, la défaite « la vallée bascule » suffit-elle, ou veux-tu un enjeu plus
  personnel (le village PNJ allié tombe, un compagnon meurt…) ?

---

## Dépendances et ordre de construction (si tout était retenu)

```
3 salaisons ──────────────── autonome, le moins cher, livrable en premier
6 coulées (rendu+pêche) ──── autonome
8 murmures (a) ───────────── autonome
1 braise-mère ◄─── 4 cœur de braise (l'amorce) ◄─── 7 bêtes cendreuses (le cuir)
5 bûcher ◄──────── R16 (existant) + traînage de cadavre (nouveau verbe)
2 jardin ◄──────── piste ⑩ trouvailles (la semence) — ou une colonisatrice ③
9 pacte ◄───────── les événements de 1/5 (les actes anti-cendre à compter)
10 longue nuit ──── le capstone : après 1 (défendre) et 9 (choisir son camp)
```

Landmines transverses : tout `MonsterType` ou entité nouvelle décale le flux RNG seedé
(chemins isolés, commits isolés) ; l'art des trois terrains cendrés reste « les deux tiers
du travail » d'après `cendre.md` — les chantiers visuels (6, 7, 8) l'aggravent.
