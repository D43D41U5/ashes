# Le combat — endurance, télégraphes, blessures, mort

*Source : GDD §7 (combat de coût, lent, positionnel), §6 (l'économie du village est une stat de combat). Statut : **implémenté** (2026-07-05, A1-A8 verts + smoke test navigateur — un zombie chassé et abattu). Jalon : V6. Cible : PvE (faune + zombies) — le PvP arrive avec de vrais joueurs (LAN).*

## Objectif de design

Un combat **gagné avant l'échange** : nombre, terrain, équipement, préparation. Le skill individuel penche un duel, jamais un 1v3. Tout coûte : l'endurance pour agir, les blessures pour encaisser, l'équipement pour mourir. Feel : Rust top-down, Project Zomboid en plus actif — pas Hades.

## Règles

### L'endurance reine (R1-R3)

- **R1 — Une seule barre** (`stamina` 0-100, sur l'Entity) : attaquer (−15), bloquer un coup (−10 −dégâts/2), sprinter (−8/s). Régénération 10/s à l'arrêt, 5/s en marchant, 0 pendant un wind-up ou en posture de blocage. **À 0 : on ne peut plus ni attaquer ni bloquer ni sprinter** — un combattant essoufflé est mort.
- **R2 — L'économie du village est une stat de combat** (GDD §6) : faim > 70 → régénération ×1.25 ; faim 0 → ×0.5. Le village qui nourrit bien sa milice se bat mieux, mécaniquement.
- **R3 — Le sprint entre au jeu** (input `sprint`) : vitesse ×1.5. La poursuite et le décrochage deviennent tactiques.

### L'attaque télégraphiée et directionnelle (R4-R6)

- **R4 — Wind-up, puis résolution dans une ZONE.** Pendant le wind-up : lisible (le client dessine la zone au sol). Le coup se résout ensuite dans la zone du `Strike` porté par le wind-up. Si la cible en est sortie, le coup fend l'air — l'esquive est du positionnement, pas un i-frame. Les BÊTES gardent l'arc historique (90°, portée 1,4, ~400 ms) ; les AVATARS suivent le profil de leur arme (R4bis).
- **R4bis — CHAQUE ARME A SA GÉOMÉTRIE** (décision utilisateur, 2026-07-13). L'identité d'une arme est sa **forme**, pas son chiffre de dégâts. `WEAPON_PROFILES` (balance.ts) donne à chacune : forme, portée, arc, armement, coût d'endurance, récupération, et **pas en avant**. Deux primitives suffisent — un **cône** (demi-angle par `arcCos` ; `-1` = 360°) et un **disque posé devant**. Le wind-up TRANSPORTE sa zone dans le snapshot : le télégraphe du client dessine la zone réelle, jamais un arc supposé.
  - **Les poings** — rapides, courts (1,1), et ils **avancent** : chaque coup fait un pas, en zigzag (gauche/droite/gauche : `swingSide`, alterné par la sim, donc identique chez tous les clients).
  - **La lance** — l'**allonge** (2,3) : un pic étroit. On tient le loup à distance.
  - **La hache** — le gros coup lent qui **balaie** (±60°, portée 1,5) : elle prend plusieurs corps serrés d'un coup. C'est sa réponse à la horde.
  - La portée se mesure **centre à centre**, comme la sim : deux corps qui se touchent ont leurs centres à `AVATAR_HITBOX_TILES` (0,6). Tout s'ancre là.
- **R4ter — DEUX COUPS PAR ARME : le clic bref, et le clic MAINTENU** (décision utilisateur, 2026-07-13). Maintenir **charge** ; relâcher frappe. La sim compte le maintien (`Entity.charge`, dans le snapshot : en multi, on doit VOIR l'autre armer son tourbillon) et décide seule, au relâchement, si le coup sort simple ou lourd. Le coup chargé fait bien plus mal, coûte bien plus d'endurance, et **change de forme** :
  - poings → **overhead à deux mains** sur un disque au sol devant soi ;
  - lance → **une VRAIE CHARGE en avant** : le corps parcourt 3,2 tuiles (8 tuiles/s, le double de la marche). C'est un engagement, pas un pas. Elle **traverse** ce qui est trop proche — le coup se résout à l'arrivée, donc une cible collée finit dans le dos et le pic fend l'air (décision utilisateur : « la lance passe au travers, tant pis »). La charge est une arme de DISTANCE ; mal jugée, elle cloue sur place 1,5 s.
  - hache → **tourbillon 360°** (un cône d'`arcCos: -1`), et une zone **LARGE** : 2,6 tuiles tout autour du corps. Il ne doit pas se confondre avec le disque des poings — ce qui sépare deux coups, c'est ce qu'on VOIT au sol, pas leur nom.
  - Tenir une charge **ne régénère pas** l'endurance, ralentit la marche (`CHARGE_MOVE_FACTOR`) et **interdit le sprint** : on ne charge pas un coup lourd en courant. Une charge qu'on ne peut pas payer retombe sur le coup simple — jamais un bouton mort.
- **R4quater — LA RÉCUPÉRATION PUNIT LE RATÉ, JAMAIS L'ENGAGEMENT.** Chaque `Strike` a deux récupérations : `recoveryHit` (court — toucher rend la main) et `recoveryWhiff` (long — fendre l'air laisse à découvert). C'est ce qui interdit de charger à l'aveugle, et c'est là que le loup trouve sa fenêtre. Elle ne fait que **repousser** le `cooldownUntil` (`max`), jamais l'avancer : les bêtes et les PNJ posent leur propre cadence au début du coup, et une récupération plus courte la raccourcirait.
- **R5 — Les actions `attack_charge`/`attack_release` `{ dx, dy }`** visent une direction (renormalisée côté sim — vraisemblance) ; la visée se rafraîchit pendant la charge. (`attack { dx, dy }` reste le coup simple immédiat : bots, PNJ, tests.) L'arme est celle **tenue** (spec inventaire R9) : mains nues 6 dégâts, **épieu** 10, **hache de fer** 14, **lance** 16. Un outil n'est pas une arme — ce qui n'a pas de profil frappe à mains nues, manche compris.
- **R5bis — L'IA ENGAGE À LA PORTÉE DE SON ARME** (`engageRange` = portée × `ENGAGE_MARGIN`), pas à une constante globale. `MELEE_ENGAGE_RANGE` ne vaut plus que pour les bêtes, qui ne tiennent rien.
- **R6 — Le blocage est une posture directionnelle** (input `block` tenu) : les coups arrivant dans l'arc frontal de 120° sont réduits de 70 % ; de flanc ou de dos, plein pot. Bloquer immobilise (marche ×0.3) et coûte de l'endurance par coup encaissé.

### Les blessures plutôt que les PV secs (R7-R8)

- **R7 — PV 0-100, mais les blessures sont le vrai coût.** Chaque coup qui fait franchir un palier (66, 33) inflige une blessure tirée au PRNG de la sim : **jambe** (vitesse ×0.6), **bras** (dégâts ×0.6), ou **saignement** (−1.5 PV/s jusqu'au soin). Cumulables. Les PV remontent lentement (2/min) si faim > 50 ; les blessures, elles, ne guérissent pas seules.
- **R8 — Le soin est une action** : `bandage` (3 fibres, 1 s) stoppe le saignement et retire une blessure de membre. Le médecin de terrain du GDD naît ici : on peut bander un allié adjacent (`bandage { targetEntityId? }`).

### La mort : chère, pas cruelle (R9-R10)

- **R9 — À 0 PV** : l'inventaire entier tombe dans un **cadavre** lootable par tous (action `loot_corpse`, tout d'un coup, portée 1.5 ; le cadavre se dissipe en ~10 min). On garde ses **compétences** et rien d'autre.
- **R10 — Respawn au Feu de son village** (ou au point d'entrée si sans village), PV 50, faim 50, et **épuisement** : régénération d'endurance ÷2 pendant `EXHAUSTION_TICKS` (~5 min de démo ; le GDD vise ~30 min, à calibrer). Les PNJ, eux, **meurent pour de bon** — la main-d'œuvre est un stock, pas un robinet.

### Les monstres (R11-R12)

- **R11 — Le zombie** (l'école de guerre, GDD §7) : erre, aggro à 6 tuiles, poursuit (A* paresseux), attaque au contact avec un wind-up de 7 ticks — plus lent que le joueur, c'est voulu : on apprend à lire les télégraphes contre lui. PV 40, dégâts 12, vitesse 2.4 t/s. Meurt sans loot en V6.
- **R12 — Le sanglier — la chasse promise en V4 arrive** : neutre, fuit quand on l'attaque (sprint bursts), charge parfois quand blessé. PV 30. Son cadavre donne 3 **viandes crues** ; la **viande cuite** (recette au Feu, +35 faim) enrichit enfin le régime. Les monstres vivent dans `state.monsters` (IA dans `/sim`, PRNG de la sim) et frappent par le même pipeline de résolution que les joueurs.

### La milice émergente (R13)

- **R13 — Tout PNJ défend le village** : un monstre à moins de `DEFEND_RADIUS` (10 tuiles) du Feu devient la priorité absolue (avant les besoins). Les PNJ l'engagent avec les mêmes règles de combat (endurance, wind-up, lance s'ils en portent — le grenier peut en stocker). Les rôles formels de milice et l'alarme arrivent en V7.

## Critères d'acceptation

- **A1** — Attaquer coûte 15 d'endurance ; à 0 l'attaque est refusée ; la régénération est ×1.25 bien nourri et ×0.5 affamé ; le sprint draine et accélère ×1.5.
- **A2** — Le coup ne porte qu'à la fin du wind-up ; une cible sortie de l'arc pendant le wind-up ne prend rien.
- **A3** — Un coup de face sur un bloqueur : −70 % ; le même coup dans le dos : plein dégâts ; chaque blocage coûte de l'endurance.
- **A4** — Franchir 66 puis 33 PV inflige deux blessures distinctes (PRNG) ; la jambe ralentit, le bras affaiblit, le saignement draine puis s'arrête au bandage ; on peut bander un allié.
- **A5** — Mourir lâche tout dans un cadavre, on respawn au Feu épuisé, compétences intactes ; looter le cadavre restitue tout ; le cadavre expire.
- **A6** — Un zombie aggro, poursuit, télégraphe et frappe ; on peut l'esquiver en reculant pendant son wind-up ; on le tue à la lance. Un sanglier fuit, se chasse, sa viande se cuit.
- **A7** — Trois zombies marchent sur un village PNJ : la milice les engage et le village survit (aucun PNJ mort dans le scénario de référence).
- **A8** — Déterminisme et replay tiennent avec combat, blessures (PRNG) et monstres actifs.
- **A13 (géométrie, R4bis)** — L'ALLONGE : la lance touche une cible à 2 tuiles, le poing non. LE BALAYAGE : la hache prend deux corps écartés de part et d'autre de la visée, la lance passe entre les deux. LE TOURBILLON : la hache chargée frappe une cible **dans le dos**, et sa zone est **plus large que le disque des poings** (elle ne s'y confond pas). LE PAS : deux coups de poing d'affilée dévient de côtés opposés, et le corps avance. LA CHARGE : le pic chargé de la lance déplace le corps de plusieurs tuiles, **plus vite que la marche**.
- **A14 (charge, R4ter-R4quater)** — Un clic bref donne le coup simple ; un maintien mûr donne le coup lourd (dégâts et coût du profil chargé). Tenir la charge ne régénère pas l'endurance. Une charge impayable retombe sur le coup simple. Un coup qui **rate** impose une récupération plus longue qu'un coup qui touche (`recoveryWhiff > recoveryHit`).

## Hors périmètre (et où ça revient)

- Non-létal, assommement, capture, rançons → Va3 (c'est du PvP politique).
- Premier sang, marquage agresseur → V8 (alignement) et LAN (il faut deux camps humains).
- Hordes, alarme, garnison, flow fields → V7.
- Dégâts aux structures, siège → Va3.
- Armes de tir, filets, boucliers d'équipement → contenu post-Veillée.
- Loot des zombies (composants T3) → V7 (événements).

## Ajouts à `balance.ts`

`COMBAT` : coûts d'endurance (sprint 8/s, base blocage 10), régén (10/5/0 ×faim), arc et portée **des bêtes** (90°, 1.4, wind-up ~400 ms), blocage 120°/−70 %, paliers de blessure [66, 33], effets (jambe ×0.6, bras ×0.6, saignement 1.5/s), PV regen 2/min si faim > 50, mort (PV/faim 50, `EXHAUSTION_TICKS`, cadavre ~10 min), monstres (zombie 40/12/2.4, sanglier 30/8, aggro 6, `DEFEND_RADIUS` 10), recettes lance/viande cuite. Depuis R4bis : `WEAVE_COS`/`WEAVE_SIN` (le zigzag du pas), `CHARGE_MOVE_FACTOR`, `ENGAGE_MARGIN`.

`WEAPON_PROFILES` : **la seule source des nombres du combat d'avatar**. Pour chaque arme (`unarmed`, `crude_spear`, `spear`, `iron_axe`) : un `Strike` simple, un `Strike` chargé, et le `chargeTicks` qui bascule de l'un à l'autre. `WEAPON_DAMAGE` en **dérive** (une seule source de vérité) et sert de registre : ce qui y figure est une arme.

Un `Strike` : `shape` (`cone` | `disc`), `range`, `arcCos`, `radius`, `damage`, `stamina`, `windupTicks`, `recoveryHit`, `recoveryWhiff`, `lunge`, `weave`.
