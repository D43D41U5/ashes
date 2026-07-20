# Direction de design — BRAISES

> **Nature du document.** Synthèse courte et décantée de la direction vers laquelle BRAISES converge *réellement*, au vu du code existant (`docs/audit-gameplay-phase1.md`) et des axes retenus (`docs/axes-amelioration-phase2.md`). Elle sert de boussole : trois pages qui disent ce que le jeu est aujourd'hui, où il va, et ce qui reste à trancher. Ce n'est ni le GDD (la vision) ni le backlog (le quoi-faire) — c'est le *cap*.
>
> *Rédigée le 2026-07-19, après l'audit gameplay en trois phases.*

---

## 1. L'identité de gameplay, aujourd'hui

Il faut nommer BRAISES tel qu'il est, pas tel qu'il se rêve — les deux sont loin l'un de l'autre, et c'est le fait le plus important à assumer.

**Sous le capot : un moteur de simulation d'exception.** Déterministe au bit près, testé comme un moteur d'échecs, avec plusieurs systèmes d'une qualité rare pour un projet solo à ce stade — la faune (méfiance à trois canaux, hardes, sang, coins de chasse : un vrai chef-d'œuvre), le cœur du combat de mêlée, le geste de récolte, la marée de Cendre, le moteur d'alignement, l'IA villageoise. Rien de tout cela n'est à jeter.

**À l'écran : un survival de subsistance encore mince.** Quand on soustrait tout ce que l'audit trouve débranché — l'alignement (pilier n°1) qui ne se déclenche jamais en solo, la victoire/défaite inexistante, la parade et le bandage injouables, le moral absent, la montée de palier du Feu sans bouton —, la boucle réellement jouée en Veillée se réduit à : **récolter → crafter → bâtir (un décor) → chasser de la viande → manger → tenir le froid près d'un feu.** C'est honnête, c'est même par endroits élégant, mais c'est très loin du pitch, et personne n'a encore vérifié que c'est amusant deux heures d'affilée.

**L'identité réelle de BRAISES aujourd'hui, c'est donc un écart** — un moteur qui sait faire vivre un monde, attaché à un jeu qui n'en montre qu'un tiers au joueur. La disproportion est inhabituelle (d'ordinaire c'est l'inverse : un jeu qui promet plus que son moteur ne tient). Ici, **le jeu existe déjà à 80 % dans `/sim` ; le joueur ne l'atteint qu'à moitié.**

Trois causes structurelles à cet écart, qui sont le diagnostic central :
1. **Le moteur sans transmission** — des systèmes finis et testés ne sont jamais câblés jusqu'à la main du joueur.
2. **Pas d'enjeu terminal** — le Feu est increvable, rien ne meurt à l'échelle d'une saison : un survival sans perte possible.
3. **Une économie de stock déguisée en flux** — sans upkeep, on plafonne et on s'autosuffit.

---

## 2. La trajectoire que les axes lui donnent

Le backlog de Phase 2 ne cherche pas à *compléter* BRAISES en empilant des systèmes. Il cherche à **l'allumer** en refermant l'écart ci-dessus. La direction se résume en un mot d'ordre : **brancher, peupler, rendre mortel — avant d'ajouter.**

Trois mouvements portent toute la trajectoire :

- **Refermer la transmission.** Câbler ce qui existe : la parade, le bandage, la montée de palier du Feu, les recettes sur les fonctions émergentes, les verbes chauds de l'alignement. C'est du recâblage à fort levier et faible coût — le plus fort ratio valeur/effort du projet.

- **Peupler le monde social.** Poser 2 villages voisins dans la Veillée (quelques lignes) allume le pilier n°1 : soudain le Feu prend une couleur, le voisin te pille ou te nourrit, et l'alignement devient un choix joué et non un compteur endormi. C'est le geste unique qui transforme un survival solitaire en drame de voisinage.

- **Rendre le monde mortel.** Un seul scalaire — le combustible du Feu — transforme le totem increvable en organe vital : le Feu se nourrit, donc il peut mourir de faim, donc le village peut tomber en ruine, donc l'économie a enfin un évier permanent et le raid une cible. C'est ce qui fait exister « une vallée de 60 jours qu'on perd ».

**Où cela mène.** Si ces trois mouvements atterrissent, BRAISES cesse d'être « un très bon moteur de simulation » pour devenir ce que le GDD promet : un survival où **ton village est ton personnage**, où **la morale est une mécanique** (accueillir, commercer, piller un voisin sont des builds aux coûts réels), et où **tout est condamné** (le Feu qu'on nourrit ou qu'on perd, la Cendre qui monte, l'arche qu'on embarque). La faune, déjà somptueuse, se met à irriguer l'économie dès qu'on pose une ligne de cuir. Le fil rouge non négociable : **chaque branchement doit rendre une décision *intéressante*** — un dilemme de ressource ou de risque. Un axe qui n'en crée pas attend son prérequis ou se coupe.

**Ce que la trajectoire n'est pas.** Ce n'est pas une fuite en avant vers plus de systèmes. Les grosses mécaniques neuves (charrette, agriculture, non-létal complet, raid en 4 temps) sont explicitement **différées** — la plupart au multi, où leur dilemme s'allume vraiment. La Veillée solo reste le banc d'essai : tout se prouve headless et jouable là avant de traverser vers la LAN.

---

## 3. Les tensions de design encore à trancher

Certaines directions sont **incompatibles entre elles** ou heurtent une décision actée du GDD. Elles ne se résolvent pas par la technique — c'est à Alexis de choisir. Les voici, les plus structurantes d'abord. *(Le détail des options est dans le backlog Phase 2, §6.)*

**T1 — Le solo doit-il subir des raids ? (la tension la plus fondamentale)**
Le GDD acte que le joueur solo joue *mécaniquement* un Ermitage, et que l'isolement est « un choix de tranquillité et de sécurité » — ses pressions sont **PvE et environnementales**, pas le harcèlement. Or *allumer l'alignement* exige un extérieur, et le plus lisible des extérieurs est une Meute qui vient te piller la nuit. Peupler la Veillée de raiders contredit frontalement « personne n'est forcé au jeu social ». **À trancher :** le voisin Meute est-il une menace réelle (et alors la Veillée n'est plus un Ermitage tranquille) ou une pression lointaine et évitable (et alors le pilier reste tiède en solo) ? Le curseur est la *distance*, mais le principe est un choix d'identité.

**T2 — Le froid gèle-t-il la vallée, ou seulement les hauteurs ?**
Aujourd'hui les nombres disent que la plaine n'est jamais létale au froid (elle plafonne pile au seuil), alors que le discours promet « froid létal en acte III ». Deux modèles incompatibles : soit **la Cendre porte un froid qui rend la plaine mortelle** et referme la vallée pour de bon (le monde condamné, à la lettre), soit **le froid ne gate que l'altitude** et l'acte III se joue par la faim, les monstres et la ruine. *Ce choix décide si la chaîne du cuir/tenue d'hiver a une raison d'être* — donc il se tranche **avant** d'investir dedans.

**T3 — L'économie de flux vs la règle anti-corvée.**
Le GDD veut une économie de flux (tout se consomme, l'upkeep du Feu) *et* qu'« un village survive à 3-4 jours d'abandon », sans quotas quotidiens ni anxiété d'abandon. L'upkeep est précisément un timer permanent. La tension est de **calibrage**, mais elle est réelle : trop mou, pas d'évier (retour au plafonnement) ; trop mordant, la Veillée solo devient une corvée anti-fun. Le fil : la corvée ne doit avoir de sens qu'à *plusieurs* — un joueur seul tient, un village prospère se coordonne.

**T4 — La régén passive et l'existence du médecin.**
Le code répare les PV tout seuls ; le GDD l'interdit pour que le médecin et le lit existent. Retirer la régén *fait naître le métier de médecin* — mais casse la survie solo (et les PNJ spiralent à mort) tant qu'il n'y a pas de soin jouable et un comportement de soin PNJ. **À trancher :** 0 strict (le médecin naît, mais tout dépend du soin livré d'abord) vs une régén résiduelle (plus doux, médecin plus faible).

**T5 — Les maîtrises : identité coûteuse ou compteur simple ?**
Le GDD veut des **déblocages nommés** (une capacité/recette par palier) + un budget de spécialisation avec érosion — c'est ce qui fait qu'« on *est* la trappeuse de l'Est ». Le code n'a qu'un compteur de rendement. Livrer le vrai modèle est coûteux (15 branches) ; **à trancher :** combien de branches méritent un déblocage réel maintenant (reco : commencer par le seul fer/acier, valider le modèle, puis étendre), et quand poser l'érosion (reco : différée au peuplement PNJ).

**T6 — Jusqu'où brancher le pivot Rust de construction.**
Le moteur d'émergence (amas → fonction → palier) est beau mais ne transmet rien. Le brancher entièrement (chaque fonction paie, agriculture réelle, upkeep des murs) est un gros chantier ; **à trancher :** le minimum vital (recettes sur fonction+tier + palier du Feu + un payoff acier) suffit-il pour la Veillée, en différant l'agriculture et la dégradation des structures ?

**T7 — Écarts GDD/MVP à acter explicitement.**
Deux archétypes codés (Foyer/Meute) sur les quatre du GDD (Ermitage/Charognard différés) ; le serveur substantiellement codé alors que la doc le dit « placeholder ». Ce ne sont pas des bugs, mais des **cadrages à confirmer** pour que la doc cesse de mentir dans un sens (survendre) ou dans l'autre (sous-estimer).

---

## 4. Le cap, en une phrase

**BRAISES n'a pas besoin de plus de systèmes — il a besoin qu'on finisse de connecter son excellent moteur à un jeu qui existe déjà, en s'assurant que chaque connexion rende une décision intéressante et qu'à la fin, la vallée puisse vraiment se perdre.**

---

*Pour le détail : `docs/audit-gameplay-phase1.md` (l'état des lieux), `docs/axes-amelioration-phase2.md` (le backlog priorisé et les décisions à trancher). La synchronisation de la documentation `.md` du projet à cette direction est journalisée dans `docs/decisions.md` (entrée 2026-07-19).*
