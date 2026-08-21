# La bible diégétique — une physique, pas une histoire

*Document INTERNE et NORMATIF. Le joueur ne le lit jamais ; tout ce qui l'atteint — toponyme, chronique, stèle, nom d'objet, décor, écran — doit s'y conformer, et tout générateur futur y répond à la question « qu'est-ce qui serait vrai ici ? ». Source : session de lore du 2026-08-21 (écrivain et scénariste invités, recherche externe), décisions d'Alexis du même jour (l'arc oscille ; la pression vient de l'environnement ; tranche 1 des propositions actée). Statut : **v1, actée**. Tout AJOUT ou AMENDEMENT est une décision à journaliser dans `docs/decisions.md` — cette bible ne dérive pas en silence.*

---

## §0 — Pourquoi ce document n'est pas une histoire

**Le passé d'ASHES est procédural.** Les annales (`map.annales`) sont régénérées à chaque seed : la ferme fondée pour l'eau dans une vallée est fondée pour la route dans la suivante. Il n'existe pas UN pays d'avant — il en existe un par carte. **Une chronologie écrite serait donc fausse par construction** ; c'est le générateur qui écrit ce qui s'est passé, à chaque saison.

Ce que ce document fixe à la place, c'est le **sous-texte cohérent** sans lequel un mystère ne tient pas (la leçon FromSoftware : les fragments doivent converger pour que chercher paie). ASHES donne à ce sous-texte la forme de **règles**, pas d'événements : la convergence sans la fuite. C'est la division du travail de Caves of Qud — un cadre global jamais expliqué, un passé local régénéré et lisible — appliquée avec une radicalité de plus : notre cadre global n'est pas un événement tu, c'est une physique.

## §1 — La ligne directrice

> **On explique la RÈGLE, jamais l'ORIGINE.**

Le test, à appliquer à toute proposition de lore : *est-ce que ça change ce que le joueur fait ce soir ?* Si oui, c'est une règle du monde et elle doit être lisible en jouant. Si non, c'est du codex, et on n'en écrit pas — pas même ici.

Définition opérante : **une explication est diégétique si le joueur peut se tromper dessus et si le monde peut le corriger.** Une cosmologie ne se falsifie pas en jeu ; une règle, si.

## §2 — Les lois du monde

Chaque loi est ancrée dans du code livré — cette bible ne postule rien, elle lit à voix haute.

**L1 — La Veille.** *On ne meurt pas de mourir. On meurt d'être seul quand on tombe.* Le Feu ne protège pas le corps : il **tient la place**. Tant qu'une braise brûle à portée, ou qu'un des tiens te regarde tomber, il y a quelqu'un pour dire *où* tu reviens. Sans braise et sans personne, tu reviens quand même — mais là où tu es tombé, et sans savoir que c'était toi.
*Ancrage : les deux gardes de la levée (`cendreux.ts` — feu actif à 12 tuiles OU allié vivant du même village à 8) ne sont pas deux règles mais une seule, la **présence** ; et le respawn (`combat.ts`) en est le verso exact — avec village on renaît au Feu, sans village on renaît sur place.*

**L1bis — Le feu qui veille et l'allié qui regarde sont la MÊME chose : la présence.** Le Feu n'a aucune vertu propre. C'est ce qui garde A×C vivant : « le monstre, c'est toi sans ta braise » est un miroir tant que la braise est une métaphore de la présence humaine ; le jour où le feu a un pouvoir, le Cendreux devient une espèce vaincue par un objet.

**L2 — Le Cendreux est un miroir, jamais une espèce** (direction A×C, actée 2026-07-08 et 2026-07-31, non rouvrable). Un seul mort-vivant dans le monde ; les loups restent des bêtes. Ceux qui se lèvent sont des **mal-veillés** — un participe, pas un peuple. Il n'a ni roi, ni voix, ni visage : c'est une *condition*, pas un antagoniste.

**L3 — La Cendre est une chose qui avance, et son cortège la précède.** Devant la ligne de feu marchent la stérilité (le sol cesse de rendre — encore là, encore vert, et il ne redonne plus), puis le froid (*une terre brûlée n'a plus de couvert : le froid vient d'où plus rien ne pousse*) ; derrière elle, la hantise (le vieux brûlé porte plus de morts que le neuf). Le vent de cendre souffle du sud — il pousse le froid devant lui, puis passe, et le front n'a pas bougé. **Le front ne recule jamais de lui-même** ; si un jour quelque chose le repousse, ce sera parce qu'on *occupe* le terrain, jamais parce qu'un objet est sacré (voir I3).
*Ancrage : spec `cortege-cendre.md`, livrée 2026-08-21.*

**L4 — Le feu réchauffe les hommes, pas la terre** (décision d'Alexis, 2026-08-19). Aucune structure ne lève le froid du monde pour une plante ; la réponse au froid d'une culture est un TYPE de bâtiment (la serre), jamais un rayonnement. *Ancrage : `flore-froid` F1bis, `climatFlore`.*

**L5 — L'hiver revient, et il revient plus dur** (décision d'Alexis, 2026-08-21 : l'arc oscille). Il n'y a pas de dernier acte. L'acte NOMME, il ne chiffre pas (saison-sans-fin R2) ; ce qui compte les années, c'est le **tour** — et ce qui distingue l'hiver N de l'hiver N−1 se lit sur la carte, pas dans un multiplicateur : la pression vient de l'environnement.

**L6 — Le pays d'avant vivait sous les MÊMES lois que le joueur.** C'est la clef de voûte de toute cohérence, et chaque générateur de ruine l'encode déjà : ils veillaient leurs morts, ils guettaient le sud, ils bornaient leurs portes, ils s'installaient pour l'eau ou pour la route, ils ont fui vers le nord. **Les ruines ont du sens parce que ces gens sont morts par les règles auxquelles le joueur joue.** Corollaire pour tout générateur futur : avant d'émettre un fait du pays d'avant, demander « qu'aurait fait quelqu'un qui connaît L1-L5 ? ».

**L7 — Le monde prévient, il ne guide pas** (worldgen R21) — et **le monde ne ment jamais.** Aucune annale fausse, aucun texte trompeur : toute la doctrine d'inférence (*loin des routes = intact = riche*) entraîne le joueur à faire confiance à sa lecture — un seul mensonge empoisonne cet entraînement. La contradiction est permise, mais elle vient de la **juxtaposition de faits vrais** (« ils guettaient le sud » + « brûlée » = ils ont vu venir, et sont restés), jamais d'un faux.

**L8 — Les trois devises sont le lexique complet de ce que le monde donne** : le savoir (la carte), le répit (les trajets), le récit (ce qu'on racontera). Aucun lieu ne paie en butin (lieux.md A9). Apprendre, souffler, se souvenir — le monde n'a pas d'autre verbe envers le joueur.

## §3 — La langue

**T1 — Les temps verbaux SONT la stratigraphie.** L'imparfait appartient au pays d'avant (« Trois routes s'y répondaient ») ; le passé composé au joueur (« le Gué a été foulé »). Aucune date absolue, jamais : le pays d'avant n'a pas de calendrier connu.

**T2 — Le « nous » est réservé aux stèles.** Une stèle a un **auteur mort** — c'est la seule première personne légitime du jeu (« Nous guettions le sud »). L'impératif y est admis : une inscription s'adresse au passant, ce n'est pas le narrateur qui parle au joueur. Partout ailleurs : **pas de narrateur** — pas de « vous », pas de conseil, pas d'impératif.

**T3 — La chronique a trois poids, et chacun sa discipline** (`chronicle.ts`) : le *battement* frappe (le monde), le *récit* est le corps courant, l'*intime* chuchote — et sa sobriété EST son poids, donc il reste **rare**. La chronique constate, elle ne juge jamais : aucun adjectif moral (« Quelqu'un est tombé. » est la meilleure ligne du jeu parce qu'elle ne conclut rien).

**T4 — Jamais de vocabulaire de moteur.** Pas de « sont apparus », pas de passif sans agent (« a été signalé » — par qui ?), pas de compteur entre parenthèses « (5) », pas d'étiquette de mécanique dans la fiction (« a viré au bleu **: un Foyer** » nomme le système ; le fait visible est la couleur). Le mot *goule* n'existe plus (le Cendreux a absorbé le zombie).

**T5 — Les formules interpolées sont insensibles à l'accord PAR CONSTRUCTION**, ou le genre est une donnée de table. « Le seuil de le Karst » et « le Clan du Levant est partie » sont la même faute ; on préfère la tournure qui ne peut pas se tromper (« On a atteint la Ferme brûlée » plutôt que « la Ferme brûlée a été atteint~e~ »).

**T6 — Un nom est court, prononçable, et sans explication accolée.** Un toponyme porte UN spécifique (« la Ferme brûlée », « le Gué Noir ») — jamais un inventaire. La numérotation romaine (« le Belvédère II ») est un placeholder assumé, pas une doctrine.

## §4 — Les interdits

La moitié de la bible. Un interdit écrit garantit la cohérence au même titre qu'une loi.

- **I1 — Aucune origine de la Cendre.** Ni in-game, ni dans ce document, ni ailleurs. C'est la seule chose dont l'explication détruit l'objet : une cause rend la Cendre combattable en imagination, donc finie.
- **I2 — Aucun nom propre de personne, de dieu, de peuple, d'empire.** Le pays d'avant a des **lieux** nommés, jamais une identité. Le jour où on sait qui ils étaient, les ruines cessent d'être des ruines.
- **I3 — Le Feu ne devient jamais un ward.** Pas de torche bénie, pas de terre consacrée, pas d'objet ni de rite qui protège *à la place* de la présence (L1bis). Toute parade — y compris la future braise anti-cendre — agit parce qu'elle **occupe**, jamais parce qu'elle est sacrée ; et elle repousse un SEUIL, jamais ne réchauffe un CLIMAT (L4).
- **I4 — La vallée est close et ne se justifie pas.** La justifier ouvre « et si on sortait ». Les réfugiés arrivent ; on ne dit pas d'où.
- **I5 — Aucun clin d'œil, aucune ironie.** Un jeu dont un pilier est « tout est condamné » ne porte pas un objet drôle — l'ironie est rétroactive.
- **I6 — Pas de mémoire du monde simulée.** Le passé du pays d'avant vit dans les annales (faits estampillés à la génération, méthode Qud — jamais d'agents simulés, S-R16) ; le passé du joueur vit dans la chronique et dans les objets qu'il laisse. Jamais de registre magique, jamais de PNJ qui « se souvient ».
- **I7 — Le grand mystère ne se comble pas par accumulation.** Si un jour la somme des fragments locaux commence à dessiner une réponse globale (une cause, un peuple, une date), c'est un défaut à corriger, pas une richesse émergente.

## §5 — Ce que cette bible laisse délibérément ouvert

- **Le nom du rite** (le feu de veille) et le nom de ceux qui se lèvent (les mal-veillés) : proposés, non actés — décision d'Alexis à journaliser.
- **La grammaire toponymique complète** (options A « le nom dit le fait » vs B « le pays qui ne répond pas », et la doctrine mixte « le nom dit la FIN, le lieu dit le COMMENCEMENT ») : en cours de discussion.
- **Les noms des actes/tours** au-delà des trois existants (`ACT_NAMES`), et le scellement des chroniques d'hiver.
- **Le vocabulaire élargi des annales** (11 types proposés) et ses garde-fous (saillance, lacune salée, deux témoins) : proposition P1+P4, non actée.
