# Hordes & événements PvE — flow fields, alarme, le robinet à sessions

*Source : GDD §6 (le monde extérieur, source d'objectifs), §7 (le PvE : école de guerre, pression commune), §11 (flow fields), §2 (les hordes migrent au Grand Froid). Statut : **implémenté** (2026-07-05, A1-A8 verts). Jalon : V7.*

## Objectif de design

Donner au monde une pulsation : des menaces qui convergent (les hordes), des opportunités qui apparaissent (les carcasses), et une défense qui **tient ou casse de façon compréhensible**. C'est le générateur de sessions (« un convoi a spawn au nord ») et le théâtre des futurs grands moments inter-villages.

## Règles

### Les structures deviennent mortelles (R1-R2)

- **R1 — Les structures gagnent des PV** (`hp`, max par type : mur 200, porte 150, autres 100, **le Feu est indestructible** en V7). Sans ça, un anneau de murs trivialiserait toute horde. Un zombie dont le chemin est bloqué par une structure **la frappe** (mêmes wind-ups). À 0 : `structure_destroyed`, la structure disparaît. C'est la fondation du siège de Va3.
- **R2 — Réparer** : action `repair { structureId }` — 1 bois → +50 PV, à portée, membre du village, cooldown standard. Le tableau du village poste `réparer` quand une structure passe sous 60 % (les PNJ réparent).

### Le flow field : la horde coule vers le Feu (R3)

- **R3 — Champ de flux par BFS** depuis le Feu ciblé, sur la grille (terrain + structures + nœuds bloquants), recalculé toutes les `FLOW_REFRESH_TICKS` (60). Chaque zombie de horde descend le gradient (égalités départagées par ordre fixe). Chemin bouché → il frappe la structure qui bloque. L'A\* individuel (PNJ) et le flow field (masse) coexistent — deux outils, deux usages.

### L'alarme (R4)

- **R4 — L'alarme est automatique** : premier monstre hostile à `DEFEND_RADIUS` du Feu → événement `alarm_raised` (cooldown 1 cycle-heure, une alarme par vague, pas du spam). Le client flashe et affiche la menace ; les PNJ convergent déjà (V6) et **se réveillent**. La cloche constructible, la portée étendue et l'audio (hiérarchie sonore §15) viendront habiller — le squelette mécanique est là.

### Le catalogue d'événements v1 (R5-R7)

- **R5 — La horde migrante** : la nuit, probabilité croissante par acte (`HORDE_CHANCE_PER_NIGHT`), une horde de `HORDE_SIZE[acte]` zombies (4/8/12) apparaît en bord de carte et cible **le village le plus proche** (flow field). À l'aube, les survivants se dissipent (`horde_dispersed`) — la nuit est le danger, le jour la réparation. Événements : `horde_spawned {size, targetVillageId}`.
- **R6 — La carcasse de convoi** : tous les ~2 jours de saison, un site lootable apparaît **sur la route** (les tuiles route de la carte) : un cadavre spécial riche (lingots de fer, charbon, et les premiers **composants** — item T3, loot-only jusqu'aux recettes de siège) gardé par 2 zombies. Le robinet à sessions : y aller, nettoyer, porter le butin — et croiser les autres en chemin, plus tard.
- **R7 — Le marchand nomade est reporté** (V9/V10) : le troc est un vrai système (offre, échange, refus), pas un placement d'événement. Le catalogue v1 reste sobre : une menace, une opportunité.

### L'ordonnanceur (R8)

- **R8 — L'horloge des événements vit dans `/sim`** (`advanceWorldEvents`), tirée au PRNG de la sim, cadencée par le calendrier (les probabilités croissent avec l'acte — la pression du GDD §2). Tout est rejouable. Les hordes sont des monstres marqués `hordeId` ; la carcasse est un cadavre marqué `special`.

## Critères d'acceptation

- **A1** — Flow field : une horde atteint un Feu situé derrière un couloir en chicane (le gradient contourne) ; champ identique à chaque run.
- **A2** — Un mur sur le chemin : les zombies le frappent, il casse (`structure_destroyed`), la horde passe ; réparé à temps (+50 PV/bois), il tient.
- **A3** — Premier monstre dans le rayon → `alarm_raised` une seule fois par vague ; les PNJ endormis se réveillent et convergent.
- **A4** — La nuit venue, une horde spawn en bord de carte et marche sur le village le plus proche ; à l'aube, les survivants se dissipent.
- **A5** — En acte II la horde est plus grosse qu'en acte I (tailles paramétrées, testé en calendrier accéléré).
- **A6** — Une carcasse apparaît sur une tuile route, gardée ; gardiens tués → son loot (composants, lingots) se ramasse.
- **A7 — LE scénario** : (a) une horde de 4 contre le village PNJ armé → la milice tient, ≤ 1 perte ; (b) une horde de 10 contre 2 PNJ → le village casse (des morts) — les deux issues sont *compréhensibles* et testées.
- **A8** — Déterminisme et replay exacts avec hordes, alarmes et carcasses actives.

## Hors périmètre (et où ça revient)

- Marchand nomade, troc → V9/V10 (avec l'économie d'échange).
- Garnison formelle, postes assignés, rôles de milice → Va2-Va3.
- Cloche constructible, portée d'alarme, audio → habillage (§15).
- Sièges joueurs, béliers, échelles → Va3 (mais les PV de structures posés ici les attendent).
- Méga-horde convergente de la Cendre → V9 (elle réutilise tout ceci en plus gros).
- Scaling du catalogue (ruines, tanières, météo) → contenu continu post-V10.

## Ajouts à `balance.ts`

`STRUCTURE_HP` (mur 200, porte 150, autres 100), `REPAIR_WOOD_COST = 1`, `REPAIR_HP = 50`, `REPAIR_TASK_THRESHOLD = 0.6`, `FLOW_REFRESH_TICKS = 60`, `ALARM_COOLDOWN_TICKS` (1 h de cycle), `HORDE_CHANCE_PER_NIGHT = [0.35, 0.6, 0.9]` (par acte), `HORDE_SIZE = [4, 8, 12]`, `CONVOY_PERIOD_DAYS = 2`, `CONVOY_GUARDS = 2`, `CONVOY_LOOT` (composants 2, lingots 3, charbon 4), item `components`.
