# La tension — pouvoir PERDRE

*Source : GDD §8 (économie de flux), §8bis (les trois cercles, la collecte), §9bis (« annoncés, pas surprises »), §2 (la pression par acte). Statut : **en cours** (2026-07-13). Objectif utilisateur : « le jeu doit être fun mais exigeant ; je dois être puni si je fais trop d'erreurs ou de mauvais choix. »*

## Le constat, mesuré (pas supposé)

| | avant |
|---|---|
| Un buisson de baies | **171 minutes de survie**, et il repousse en **5 minutes** — un seul buisson nourrissait 34 joueurs en continu |
| La faim | on pouvait l'ignorer **2h23**… et elle **ne tuait même pas** (elle ralentissait) |
| Le sac | 360 unités = 180 murs, portés en sprintant |
| La géographie | nœuds **uniformes** : le meilleur bois était à dix pas |
| La nuit | une **couleur**. Plus sombre, un peu plus froide, et c'est tout |

**Le monde n'était pas hostile : c'était un jardin avec un timer de cinq minutes.** Aucune erreur ne se payait, donc aucun choix n'existait.

## Les cinq règles

### 1. LE POIDS (spec `portage.md` — levier n°1, déjà livré)

Quatre paliers, la surcharge proportionnelle. Le sac devient un choix, la distance un coût, la route un risque, et **mourir chargé une catastrophe — sans la moindre pénalité de mort ajoutée**.

### 2. LA FAIM TUE, ET LE CRU NE NOURRIT PAS UN HOMME

- **T1 — La faim TUE.** À 0, les PV fondent (`STARVE_HP_PER_MIN`) : ~17 minutes pour mourir. Elle ne faisait que ralentir — ce n'est pas une punition, c'est une remarque. **Un joueur qui ignore sa jauge doit mourir, sinon la nourriture n'est pas une ressource : c'est un décor.**
- **T2 — La faim descend TROIS FOIS plus vite** : une jauge pleine dure ~50 minutes réelles (un cycle), contre 2h23. On mange une à deux fois par jour, comme dans tout jeu de survie qui tient debout.
- **T3 — Le cru ne nourrit pas.** La baie passe de 15 à **6** ; le ragoût monte à **60**. Un buisson entier vaut ~24 minutes de survie (contre 171). **On ne vit plus de cueillette : on cuisine.** Donc il faut un Feu, donc du bois, donc rentrer. C'est la boucle qui manquait.
- **T4 — La nuit MORD dès l'acte I** (`NIGHT_COLD` 20 → 30). Le Feu cesse d'être un établi : il devient un abri.

### 3. LA NOURRITURE POURRIT (l'évier)

- **T5 — Tout ce qui se mange a une FRAÎCHEUR** (`Slot.fresh`, 1 → 0) : frais → **rassis** (moitié moins nourrissant) → **avarié** (presque rien) → **pourri : la pile disparaît**. Modèle de Don't Starve, éprouvé et lisible.
- **T6 — Le coffre n'est pas un congélateur** : ce qu'on range pourrit aussi. Sinon l'évier se viderait de son sens, et le grenier redeviendrait un tas.
- **T7 — AUCUNE microgestion.** Pas de date par objet, pas de tri permanent : deux piles qui fusionnent **moyennent** leur fraîcheur (ni « toutes fraîches » — le coffre serait une machine à remonter le temps —, ni « toutes vieilles » — ça punirait le rangement). Le joueur *voit* la couleur de sa case, et il décide.
- **T8 — La viande crue est une bombe à retardement** (1,5 cycle) : on la cuit, ou on la perd. Le ragoût, lui, tient 5 cycles — la cuisine, c'est aussi de la CONSERVATION.

### 4. LE MONDE NE SE REMPLIT PLUS TOUT SEUL

- **T9 — La repousse passe de 5 à 45 minutes** (≈ un cycle), modulée par l'acte. Une clairière qu'on rase reste vide pour la journée : **on va voir ailleurs**, et c'est là que tout commence (GDD §8bis : la collecte met le joueur sur les routes, donc dans les rencontres).
- **T10 — ÉPUISEMENT LOCAL** : chaque passage à vide rallonge la repousse suivante (`DEPLETION_REGROW_PENALTY`), borné, et **oublié** après un cycle sans y toucher. On ne campe pas une clairière : on l'use, elle se ferme, on tourne. C'est la rotation des filons du GDD §8bis — « les points de friction se DÉPLACENT ».
- **T11 — LES TROIS CERCLES** (`CIRCLES`) : autour du point de départ, la récolte est **médiocre** (« un village y survit, n'y prospère jamais ») ; la richesse est au loin, avec ce qui y vit. *C'est pourquoi la géographie vient APRÈS le poids : maintenant que s'éloigner coûte, il faut que ça rapporte.*

### 5. LA NUIT CHASSE

- **T12 — « La nuit, loin d'un feu, on est chassé. »** Une règle, qui se dit en une phrase.
- **T13 — Elle a une PARADE** que le joueur possède dès la minute 0 : un Feu, ou rentrer. **Une punition sans parade n'est pas une punition, c'est un impôt.** La parade réutilise une règle qu'il connaît déjà (la bulle de chaleur du feu) : on ne lui apprend pas un deuxième langage.
- **T14 — Elle s'ANNONCE** : un hurlement, avant que les loups ne se placent (GDD §9bis : « annoncés, pas surprises »).
- **T15 — Elle est BORNÉE** (`NIGHT_HUNT.MAX_ALIVE`) : on peut **perdre**, on ne doit pas être **submergé**. Une meute infinie n'est pas de la tension, c'est une porte fermée.

### 6. LE JOUEUR DOIT COMPRENDRE (sinon ce n'est pas exigeant, c'est injuste)

- **T16 — Tout danger a son signe, AVANT d'être fatal** : le médaillon de charge change de couleur au palier ; le bandeau de fraîcheur jaunit puis rougit dans la case ; la faim et le froid préviennent en deux crans (« la faim vous tenaille » → « VOUS MOUREZ DE FAIM ») ; la nuit s'annonce chaque soir ; le hurlement précède les loups.
- **T17 — Aucun seuil n'est recopié côté client.** Les crans viennent de `/sim` (`carryTier`, `spoilTier`) : deux jeux de seuils divergeraient, et le joueur verrait « frais » en mangeant du rassis.

## Le piège nommé (pour ne pas s'y jeter)

**Ralentir la récolte ne crée pas de tension : ça crée du GRIND.** Allonger les cooldowns, baisser les rendements, augmenter les coûts — tout ça allonge le *temps*, pas la *pression*. La tension, c'est **un choix sous contrainte, avec un risque**. Le bon réflexe n'est jamais « il y a trop de bois », c'est « **le bon bois est ailleurs, et le rapporter t'expose** ».

## Critères d'acceptation (`tension.test.ts`)

- **A1** — La faim à 0 fait fondre les PV, et **on en meurt** ; la mort **dit son nom** (`cause: 'hunger'`).
- **A2** — Un buisson entier vaut < 30 minutes de survie ; le ragoût vaut > 5 baies.
- **A3** — Les baies deviennent rassies (nutrition ÷2), puis **disparaissent**.
- **A4** — **Le coffre pourrit aussi.**
- **A5** — Deux piles fusionnées **moyennent** leur fraîcheur.
- **A6** — La repousse ≥ 40 minutes ; **raser deux fois le même nœud allonge la repousse**.
- **A7** — Les nœuds du cercle domestique sont **plus pauvres** que ceux du cercle sauvage.
- **A8** — La nuit, loin d'un feu : des loups viennent, **ils hurlent d'abord**, et jamais plus de `MAX_ALIVE`.
- **A9** — **Au feu, aucun loup.** Le jour, aucun loup.

## Ce qui reste (dans l'ordre)

1. **Les PNJ et le village** : leur IA est calibrée sur l'ancien monde généreux (ils mangeaient des baies…). Deux tests sont **en pause** (`npc.test.ts`), avec la liste de ce qu'il faudra reprendre. Décision utilisateur : on verra plus tard.
2. **L'entretien des bâtiments** (GDD §6ter) : l'évier du village. Sans public avant les PNJ.
3. **La charrette** (GDD §8bis) : le premier vrai objet de logistique — et une cible.
