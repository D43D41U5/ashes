# Le combat — endurance, télégraphes, blessures, mort

*Source : GDD §7 (combat de coût, lent, positionnel), §6 (l'économie du village est une stat de combat). Statut : **brouillon — proposition à valider**. Jalon : V6. Cible : PvE (faune + zombies) — le PvP arrive avec de vrais joueurs (LAN).*

## Objectif de design

Un combat **gagné avant l'échange** : nombre, terrain, équipement, préparation. Le skill individuel penche un duel, jamais un 1v3. Tout coûte : l'endurance pour agir, les blessures pour encaisser, l'équipement pour mourir. Feel : Rust top-down, Project Zomboid en plus actif — pas Hades.

## Règles

### L'endurance reine (R1-R3)

- **R1 — Une seule barre** (`stamina` 0-100, sur l'Entity) : attaquer (−15), bloquer un coup (−10 −dégâts/2), sprinter (−8/s). Régénération 10/s à l'arrêt, 5/s en marchant, 0 pendant un wind-up ou en posture de blocage. **À 0 : on ne peut plus ni attaquer ni bloquer ni sprinter** — un combattant essoufflé est mort.
- **R2 — L'économie du village est une stat de combat** (GDD §6) : faim > 70 → régénération ×1.25 ; faim 0 → ×0.5. Le village qui nourrit bien sa milice se bat mieux, mécaniquement.
- **R3 — Le sprint entre au jeu** (input `sprint`) : vitesse ×1.5. La poursuite et le décrochage deviennent tactiques.

### L'attaque télégraphiée et directionnelle (R4-R6)

- **R4 — Wind-up de 5 ticks (~417 ms**, dans la fourchette 300-500 ms du GDD, tolérante à la latence). Pendant le wind-up : immobile, lisible (le client l'affiche). Le coup se résout ensuite dans un **arc de 90°** face à la direction visée, portée 1.4 tuile. Si la cible est sortie de l'arc pendant le wind-up, le coup fend l'air — l'esquive est du positionnement, pas un i-frame.
- **R5 — L'action `attack { dx, dy }`** vise une direction (renormalisée côté sim — vraisemblance). L'arme = le meilleur outil d'arme porté : mains nues 6 dégâts, **lance** 16 (nouvelle recette atelier : bois 4, pierre 2, fibre 1 ; usure comme les outils). La hache de fer dépanne (10) — l'outil n'est pas une arme.
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

## Hors périmètre (et où ça revient)

- Non-létal, assommement, capture, rançons → Va3 (c'est du PvP politique).
- Premier sang, marquage agresseur → V8 (alignement) et LAN (il faut deux camps humains).
- Hordes, alarme, garnison, flow fields → V7.
- Dégâts aux structures, siège → Va3.
- Armes de tir, filets, boucliers d'équipement → contenu post-Veillée.
- Loot des zombies (composants T3) → V7 (événements).

## Ajouts à `balance.ts`

`COMBAT` : coûts d'endurance (attaque 15, sprint 8/s, base blocage 10), régén (10/5/0 ×faim), wind-ups (joueur 5, zombie 7), arc 90°/portée 1.4, blocage 120°/−70 %, dégâts (mains nues 6, lance 16, hache de fer 10), paliers de blessure [66, 33], effets (jambe ×0.6, bras ×0.6, saignement 1.5/s), PV regen 2/min si faim > 50, mort (PV/faim 50, `EXHAUSTION_TICKS`, cadavre ~10 min), monstres (zombie 40/12/2.4, sanglier 30/8, aggro 6, `DEFEND_RADIUS` 10), recettes lance/viande cuite.
