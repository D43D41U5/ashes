# Les Cendreux — la pression croissante (brainstorm du 2026-08-21)

*Statut : **LIVRÉ le 2026-08-21** (même journée — sim + client + tests + spec `cendreux.md`
amendée ; panel adversarial avant codage, workflow d'écart après, 4 écarts corrigés ; gate
final : 2 301 tests verts sur 4 suites). Décisions d'Alexis prises en séance, en QCM séquentiel. Cap donné : **« je veux que les Cendreux
apportent une pression croissante au fur et à mesure de la partie »**. Ce document est le PLAN ;
il amende `docs/specs/cendreux.md`, qu'il ne remplace pas — la réécriture de la spec est une passe
à part (voir « Ce que ça périme » en fin de document).*

---

## Le principe qui tombe de la séance

**La température locale devient le cadran unique du Cendreux**, et la saison refroidit la vallée.
La montée n'est donc décrétée nulle part : elle tombe de la table du froid, qui existe déjà.

`baselineTemperature` (hors feu, hors source chaude) rend aujourd'hui, à découvert :

| plaine | jour | nuit |
|---|---|---|
| acte I | 90 | 60 |
| acte II | 65 | 35 |
| acte III | 40 | 10 |

…décalée par le biome (forêt +5, marais −5, **neige −40**, **glacier −75**) puis par la brume, le
front météo et le froid de cendre du cortège. Autrement dit : acte I la plaine est tiède même la
nuit, acte III elle est froide **en plein midi**, et le Névé comme le Glacier sont froids dès le
premier jour. C'est la rampe, et elle est gratuite.

---

## Les décisions

### Étape 1 — le comportement d'un Cendreux

1. **Le levé marche, et de plus en plus loin.** La nuit, sans proie en vue ni chaleur à portée, il
   rejoint le feu allumé le plus proche par le **champ de flux partagé** (celui de la horde, indexé
   par tuile de Feu, déjà en cache) — jamais par un A\* par bête (R5). La portée de convergence
   **croît par acte** (I : 20 tuiles, statu quo · II : la ceinture · III : toute la vallée).
   *Aujourd'hui* : `risen: true`, ni `ambient` ni `expiresAt` ni `huntTargetId`, `wanderChance: 0`,
   vue 5, chaleur cherchée à 20 — soit jusqu'à 24 statues plantées où des gens sont morts.
   *Conséquence acceptée* : le butin du joueur mort marche avec son levé.

2. **La température locale est le cadran unique.** Un Cendreux est **presque amorphe quand il fait
   chaud**. Remplace le binaire jour/nuit et le seuil `COLD_ATTRACT_THRESHOLD` (55), qui n'en était
   que la moitié.

3. **Pente continue, plus un cran de fureur.** La torpeur est une **pente**, sans palier : elle
   module vitesse, vue et cadence de décision par le même facteur. Le froid ne le rend **jamais**
   plus rapide que ses 1,3 tuile/s nominaux — on le distance toujours (R10). Sous un froid extrême
   (< 10 : la plaine de nuit en acte III, le Glacier, le cœur du vieux brûlé), il passe **un cran
   franc**.

4. **Le cran, c'est qu'ils s'appellent.**

5. **L'appel réveille LE SOL**, pas les voisins. Le cri plante des réveils — tertres, 4 s, parade au
   feu : le mécanisme est déjà livré (`state.reveils`, `advanceReveils`, `reveil-fx.ts`).

6. **La borne du cri est un plafond qui monte EN CONTINU** avec le jour de saison, pas une table par
   acte. Corrige au passage le défaut que la spec nomme elle-même (« une table de trois valeurs, et
   une table est plate » : montée mesurée ×1,6 quand le taux quadruple).

7. **Le feu REPOUSSE, il n'annule plus.** L'émergence se plante **au bord** de la bulle au lieu
   d'être étouffée : le feu achète de la **distance** et de l'**avertissement**, jamais l'immunité.
   ⚠ **Renverse A27** (« une parade qui ne fait que retarder n'est pas une parade »). La veillée du
   **cadavre** au feu (R9 / S4) ne bouge pas d'un iota.

8. **La riposte du joueur : on brûle le charnier.** De jour, au feu : la densité du champ des morts
   tombe autour, pour un temps. Donne enfin leur raison d'être aux charniers, posés sur la carte
   (semis propre, espacement 160, `cap` 80) et aujourd'hui sans aucune interaction.

9. **Mémoire : le dernier LIEU vu, pas la personne.** Il va où il vous a vu, n'y trouve rien, puis
   reprend sa marche. Deux nombres, aucune traque surnaturelle — et la fuite devient un geste (rompre
   *et* s'éloigner). Se combine tout seul avec le cri : il crie là où il vous a vu, le sol se lève LÀ.

10. **Ils dévorent le gibier.** ⚠ Ceci **rouvre `faune.ts`**, déclaré fini (« on n'y touche pas ») :
    c'est un choix, pas un oubli. Implique que le gibier les craigne (sinon un cerf broute pendant
    qu'on le mange). *Vérifié* : une bête tuée **ne se relève pas** — le critère de levée exclut déjà
    les monstres (`!monster && willRiseAsCendreux(...)`).

11. **Le Repaire respire, de plus en plus fort.** Cadence de relâche croissante avec la saison,
    bornée par son `cap` ; il se repeuple ; il s'assainit comme un charnier (verbe de la décision 8).
    *Aujourd'hui* : 9 repaires, UN occupant, jamais remplacé.

### Étape 2 — les hordes

12. **Elle naît du SOL LE PLUS MORT.** Plus une tuile anonyme du champ de flux : elle se lève là où
    la densité des morts culmine dans la couronne d'approche — aux marges, sous la cendre, dans le
    vieux brûlé. L'origine se déplace donc avec le front, d'acte en acte.

13. **Elle vise le feu le plus PROCHE**, village ou camp de joueur. Ferme le trou « pas de village =
    jamais de horde » (`spawnHorde` renonce aujourd'hui sur `villages.length === 0` et ne vise que
    `village.fireTx/fireTy`). L'**emplacement** du camp devient la décision — dormir loin du vieux
    brûlé.

14. **Cadence ET taille en pente continue** sur le jour de saison, au lieu de deux tables de trois
    valeurs (`HORDE_CHANCE_PER_NIGHT` 0,35/0,6/0,9 et `HORDE_SIZE` 4/8/12).

15. **L'aube n'efface plus rien : la chaleur les FIGE.** Le jour réchauffe, donc la torpeur les fige
    où ils sont ; le joueur nettoie au matin ce qui reste devant sa palissade ; ce que plus personne
    ne regarde s'enfouit et s'en va (règle de clearance déjà appliquée aux gardes de convoi).
    Corrige un **défaut** : `advanceWorldEvents` supprime aujourd'hui les membres de horde au tick de
    l'aube **sans condition**, y compris sous les yeux du joueur, alors que vingt lignes plus bas le
    balayage des gardes attend explicitement qu'on ne regarde plus.
    **Portée réelle** : les Cendreux nés d'un réveil portent `ambient` et s'effacent déjà seuls dès
    que personne n'est à `DESPAWN_RADIUS`. Le « on nettoie au matin » ne vaut donc que pour les
    **membres de horde** et les **levés** — et c'est le bon partage : ce qui reste au matin, c'est ce
    qui est venu en masse ou ce qui vous a tué. *(Proposition de ma part, non contredite.)*

16. **« Ils boivent la chaleur »** *(idée d'Alexis : « les cendreux cherchent ardemment la chaleur —
    feu ou vie — ils veulent CONSOMMER cette chaleur »)*. Deux branches, aucun système neuf :
    - **sur un feu** : tant qu'un Cendreux est au contact, le combustible se consume beaucoup plus
      vite — `fireState` se dérive déjà du bois restant (`countOf(s.fuel, 'wood')`) et la combustion
      sait déjà s'accélérer ;
    - **sur un vivant** : le coup ne fait pas que blesser, il **prend la chaleur** — la température
      du corps chute. Tout l'aval est écrit : engourdissement (`coldSpeedFactor`), endurance qui ne
      remonte plus (`coldStaminaRegenFactor`), puis dégâts continus sous 20 (`coldDamagePerTick`).
    **Plancher proposé** : on boit **jusqu'aux braises, jamais jusqu'à l'extinction**. Sans lui, un
    feu vidé n'est plus actif, donc le rayon qui repousse les réveils (décision 7) tombe à zéro, donc
    le suivant se plante à vos pieds au moment précis où vous ne pouvez plus rien : une spirale sans
    geste de joueur. La braise garde son pouvoir ; il faut un acte pour l'achever.
    *(Proposition de ma part, non contredite.)*

17. **Rassasié, il s'affaisse.** La chaleur bue le réchauffe, donc sa torpeur monte : il s'écroule sur
    les braises qu'il vient d'éteindre. Le système se régule tout seul — et le joueur y gagne une
    **tactique** : un feu abandonné est un **leurre** qui immobilise une partie de la horde pendant
    qu'on tient la porte.

18. **Préavis de la VEILLE.** Les signes tombent le jour d'avant — charniers qui travaillent, faune
    en fuite, tertres qui affleurent : on PRÉPARE la nuit (rentrer du bois, fermer la porte, poster
    les PNJ). Le renseignement devient un verbe. *(GDD §9bis : « annoncés, pas surprises ».)*

19. **Plus de méga-horde.** La pente continue suffit ; la dernière nuit de saison est naturellement
    la pire. `SEASON.MEGA_HORDE_SIZE` et `state.megaHordeSpawned` sortent.

---

## LA DÉCISION QUI RESTE OUVERTE — le plafond global

Trois sources montent désormais ensemble (le cri, la horde, le Repaire) et **deux populations ne
meurent plus toutes seules** (les levés marchent au lieu de rester plantés, les hordes ne s'effacent
plus à l'aube). Or le seul plafond existant, `CENDREUX.MAX_ALIVE` (24), ne compte **que les levés** —
par décision explicite (R8, A8bis). **Rien ne borne la somme.** T15 (« on peut perdre, on ne doit pas
être submergé ») est la règle du projet, et chacune des dix-neuf décisions pousse contre elle.

Quatre formes possibles, posées mais **non tranchées** :

- **un plafond GLOBAL qui monte** avec le jour de saison — toutes les sources puisent dans la même
  réserve ; pleine, plus rien ne se lève nulle part ; abattre rouvre une place partout ;
- **un plafond global mais LOCAL** (compté autour de chaque vivant) — ce qui dort au loin ne consomme
  rien, la vallée peut se remplir vraiment ; plus cher, et un plafond qui dépend d'où l'on est se
  raconte moins bien ;
- **un plafond par source** — chacun réglable en playtest, personne ne borne la somme ;
- **un plafond de PRESSION** — on borne ce qui est simultanément engagé sur un même vivant, pas la
  population ; le plus fidèle au ressenti, le plus difficile à tenir sans que ça se voie.

**Ma recommandation : le plafond global qui monte.** Un seul nombre, une seule vérité, T15 tenue par
construction. **Hypothèse de travail retenue tant que ce n'est pas tranché.**

---

## Ce que ça coûte, et ce qu'il faudra MESURER avant de croire quoi que ce soit

- **Le cri crée des entités** → il déplace le flux du PRNG seedé. Chantier sur un **chemin neuf**,
  jamais en modifiant le décompte d'un chemin existant.
- **La prédation du gibier** (10) : la faune a ses propres plafonds ; une prédation de plus peut
  l'éteindre pour de bon. À mesurer au banc (`pnpm scenario`, `tools/diag-loup`, `diag-recolte`).
- **Le coût par tick** : convergence des levés + hordes + réveils, et l'écart de horde est en **n²**
  par horde (16 membres = 256 tests par tick, déjà « le moment le plus chargé du jeu »). La taille
  continue de la décision 14 aggrave ce carré. `tools/profil-tick`, `profil-banc`.
- **La température du corps n'existe pas pour les monstres** (le code l'exclut explicitement) :
  « boire la chaleur » se lit **chez la victime**, jamais chez le buveur. La satiété du Cendreux
  (17) est donc un état à lui, pas une température.
- **Le plafond continu** (6, 14) demande sa contre-épreuve : une pente qui monte de 0 à N sur
  60 jours doit se voir au banc jour par jour, pas seulement aux trois actes.

## Ce que ça périme dans `docs/specs/cendreux.md`

- **A27** — renversé par la décision 7 (le feu repousse, il n'annule plus).
- **R11 / `NIGHT_HUNT.UNDEAD_SHARE`** — la bascule d'espèce par acte est **remplacée** par le cadran
  de température (décisions 2-3) : ce n'est plus l'acte qui décide qui vient, c'est le froid du lieu.
- **R2 / la méga-horde** — supprimée (décision 19).
- **R12** (naissance de la horde tirée du champ de flux) — la contrainte « un sol qui mène au Feu »
  reste ; le **choix** du point passe à la densité des morts (décision 12).
- **R20** — la ligne « Étape 2 — non livré » est **caduque** : `poi.ts` pose les charniers avec leur
  propre semis de Poisson (espacement 160, `cap` 80). Ce qui manque, c'est leur **interaction**
  (décision 8).
- **Hors périmètre** de la spec (« un occupant parti ne rentre jamais ») — rouvert par la décision 11.
