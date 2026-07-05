# Roadmap d'implémentation

*Dérivée du GDD §13. Statut : proposition (2026-07-05). Les durées sont des ordres de grandeur pour un dev solo assisté d'agents — à recalibrer après les 2-3 premiers jalons.*

## Principes de séquencement

1. **Sim-first** : chaque système naît dans `/sim`, headless et testé, avant d'être rendu. Le rendu arrive tôt (V2) mais une seule fois — ensuite il *suit* la sim.
2. **Tranche verticale par jalon** : chaque jalon se termine par quelque chose de *jouable ou d'observable* dans la build web, plus ses tests. Pas de chantier ouvert sur deux jalons.
3. **Spec avant système** : chaque jalon commence par écrire/compléter sa spec dans `docs/specs/` (critères d'acceptation testables), conformément au CLAUDE.md.
4. **PvE avant PvP** : le combat s'apprend contre la faune et les hordes (GDD §7 : « l'école de guerre ») ; le PvP n'arrive qu'avec de vrais joueurs en Phase LAN.
5. **Le protocole Worker est la répétition générale du réseau.** Dès V2, le client parle à la sim par messages (inputs → sim, snapshots → client), même dans le Worker local. En Phase LAN, on remplace le transport, pas le protocole.
6. **Chaque jalon a un critère de sortie binaire.** On ne passe pas au suivant tant qu'il n'est pas vert.

---

## Phase Veillée — le jeu solo complet (~6-9 mois)

### V0 — Fondations ✅ (fait, 2026-07-05)
Monorepo, garde-fous de pureté et de déterminisme, noyau tick/entités/PRNG, replay log, bus d'événements de domaine.

### V1 — Le monde ✅ (fait, 2026-07-05)
- **Spec à écrire** : `specs/monde.md` — inclut le **temps de jeu paramétrable** (ticks → heures → jours → actes, facteur d'accélération dans `balance.ts` ; un test doit pouvoir jouer une saison en secondes).
- Grille de collision AABB, format de carte interne à `/sim` (indépendant de Tiled) + importeur Tiled, cycle jour/nuit, zones (préparation multi-rooms : la carte est déjà découpée logiquement, même si tout tourne dans un seul Worker).
- **Sortie** : test headless — une entité traverse une carte Tiled importée en évitant les obstacles ; une « saison » de 60 jours simulés tourne en < 60 s.

### V2 — Le rendu ✅ (fait, 2026-07-05 — voir `specs/client.md`)
- `/client` Phaser 4 + Vite : la sim tourne dans un **Web Worker**, le client envoie des inputs et interpole des snapshots (protocole défini une fois, réutilisé en réseau). Caméra, avatar, prédiction locale via `moveAvatar` partagé, UIScene (pattern Manif). Placeholders générés par code ; le lighting normal-mapped de Manif attend les vrais tilesets (V3+).
- ⚠️ Reste à faire par Alexis : brancher Cloudflare Pages (`pnpm build` → `packages/client/dist`) pour ouvrir le canal de playtest continu.
- Sortie vérifiée : promenade au clavier dans la vallée de démo, collisions, caméra, PNJ interpolés, HUD jour/acte/heure — smoke test Playwright headless avec captures.

### V3 — Le village ✅ (fait, 2026-07-05 — voir `specs/village.md`)
- Actions validées côté sim (protocole `move + action`), inventaire + coûts réels (acquisition stubbée jusqu'à V4), Feu/fondation semi-libre, structures 1×1 avec collision conditionnelle (portes = serrures par membership), accès privé/village/public, Chef invite/bannit, démolition remboursée. Maison reportée à V5 (avec les PNJ). Client : mode construction (F/1-4/clic), toasts d'erreur.
- Sortie vérifiée : 11 tests headless (A1-A5) + replay avec actions (A6) + smoke test navigateur (fondation, enceinte, porte, coffre, rejets).

### V4 — Survie & économie T1/T2 ✅ (fait, 2026-07-05 — voir `specs/economie.md`)
- Nœuds épuisables/repoussants générés procéduralement (la « chair », T2 dans les zones `gisement`), récolte à coups avec outils multiplicateurs et usure agrégée, faim simple modulée par l'acte (le Grand Froid mord), chaînes Feu/four/atelier, spécialisation émergente (4 métiers, XP freinée par la dispersion). `grantItems` retiré du gameplay — on commence les mains vides. Gibier reporté à V6 (chasse = combat).
- Sortie vérifiée : bot headless jouant la boucle complète en pur /sim (A7), rejouable au bit près ; récolte au clic vérifiée en navigateur. Bonus : le contrat de replay a attrapé un vrai bug (options de sim partagées par référence).

### V5 — Les PNJ (~4-5 sem, le cœur du mode Veillée)
- **Spec** : `specs/pnj.md`. Villageois simulés RimWorld-light : besoins, file de tâches, métiers ; le **tableau du village** (tâches système : grenier bas, mur endommagé) ; les PNJ y répondent.
- **Sortie** : un village 100 % PNJ *survit* 10 jours simulés sans intervention (test headless) ; le joueur voit ses villageois vivre.

### V6 — Le combat (~4-5 sem)
- **Spec** : `specs/combat.md`. Endurance commune (attaque/blocage/sprint), télégraphes 300-500 ms, engagement directionnel, blessures localisées + saignement, mort (perte du porté, respawn au Feu avec fatigue), loot de cadavre. Cible PvE : faune + premiers zombies. L'assommement/capture attend le PvP (LAN).
- **Sortie** : un combat contre 3 zombies est lisible, tendu, gagné par le positionnement ; les PNJ miliciens tiennent une ligne.

### V7 — Hordes & événements PvE (~3-4 sem)
- **Spec** : `specs/evenements.md`. Flow fields pour les hordes, alarme (les PNJ convergent), garnison, catalogue d'événements v1 : horde migrante, carcasse de convoi, marchand nomade PNJ.
- **Sortie** : une horde attaque le village la nuit ; la défense architecturale + milice PNJ tient ou casse de façon compréhensible.

### V8 — L'alignement (~3-4 sem)
- **Spec** : `specs/alignement.md`. Deux axes (Chaleur × Intensité) alimentés par le bus d'événements, pondération par coût réel, premier sang, agrégation au Feu (moyenne pondérée, plafond par tête), couleur du Feu, MVP **Foyer/Meute** (stats continues + 1-2 capacités paliers chacun). **Villages PNJ alignés** : des Meutes PNJ qui raident, des Foyers PNJ qui commercent.
- **Sortie** : test headless — un village qui nourrit ses voisins vire au bleu, un village qui pille vire au rouge, avec l'inertie « paquebot » du GDD ; en jeu, une Meute PNJ monte un raid.

### V9 — La saison (~3-4 sem)
- **Spec** : `specs/saison.md`. Trois actes avec courbe de pression (robinets/éviers par acte), Grand Froid (consommation ×2), Cendre + objectif final v1 (simple : un point d'évacuation, condition de victoire par archétype), Mémoires + **chronique v1** (consommateur du bus d'événements : les 10 grands moments de la saison en texte).
- **Sortie** : une saison accélérée complète (60 jours en ~2 h réelles) se joue de bout en bout, se termine, et produit une chronique.

### V10 — Veillée jouable : polish & calibrage (~4-6 sem)
- Harnais de **bots headless** (`pnpm sim:scenario`) : jouer N saisons en batch, sortir des stats (économie, morts, alignements) — l'outil de calibrage de `balance.ts`.
- Onboarding minimal, UI/UX de la boucle 45 min, équilibrage, **démo publique** sur Cloudflare.
- **🚧 GATE 1 : la boucle solo est-elle fun 5 sessions d'affilée ?** On ne construit pas le multi au-dessus d'un solo ennuyeux. C'est ici qu'on itère tant que non.

---

## Phase LAN — le multi minimal (~2-3 mois)

### L1 — Le serveur (~4-6 sem)
- `/server` Node + Colyseus, une seule zone, la même `/sim`. Transport réseau derrière le protocole de V2. Prédiction locale du déplacement + réconciliation, interpolation ~100 ms. Replay log côté serveur. Validation de vraisemblance des inputs.
- **Sortie** : 3 joueurs se voient, se suivent, se battent — combat acceptable à 80 ms de ping.

### L2 — Comptes & coexistence (~3-4 sem)
- Auth magic link, un compte = un personnage vivant, rejoindre un village = prendre la place d'un PNJ (maison, poste), chat proximité + village, invitations (Hôte → Résident).
- **🚧 GATE 2 : à 3-5 humains dans un village PNJ, le jeu est-il meilleur qu'en solo ?** (C'est la promesse §10 du GDD.)

---

## Phase Vallée — le serveur persistant (~3-4 mois)

### Va1 — Échelle & persistance (~4-6 sem)
- Multi-zones (rooms = zones, migration transparente), interest management (anti-ESP), PNJ hors zone en simulation dégradée, PostgreSQL write-behind + sauvegardes/WAL, staging.
- **Sortie** : 50 bots + 10 humains traversent les zones sans couture ; kill -9 du serveur → reprise avec ≤ 60 s de perte.

### Va2 — Gouvernance réelle (~3-4 sem)
- Rangs complets (Hôte/Résident/Gardien/Doyen), la Charte (Chef d'abord, **Conseil** ensuite ; la Commune peut attendre la Saison 1), réputation locale visible, la **Scission**, profil public (alignement, Cicatrices, historique).

### Va3 — Le raid (~4-5 sem)
- **Spec** : `specs/raid.md`. Les 4 phases (repérage, préparation/matériel de siège, assaut/alarme, extraction/poids du butin), fenêtres de vulnérabilité déclarées, garnison offline, loot réduit hors présence, bridage des raids en Acte I. Non-létal/capture arrive ici (rançons = gameplay inter-villages).
- **Sortie** : un raid complet entre deux villages de playtesteurs, intercept de colonne possible, défense offline testée.

### Va4 — Opérations (~2-3 sem)
- Outils modération (téléport, freeze, ban, rejeu d'accusation via replay), outillage admin, mute/report, charte de serveur, tests de charge (200+ bots), Ermitage/Charognard (les deux archétypes restants + Effacement/Serrage).
- **🚧 GATE 3 : un week-end de stress-test à ~30 humains + bots tient sans intervention.**

---

## Saison 0 — le vrai test (~1 mois + préparation)

- Carte artisanale complète (squelette Tiled : 5-6 landmarks nommables, goulots), 30 jours au lieu de 60, ~50 joueurs recrutés via Discord/démo, wipe assumé.
- On observe : les archétypes émergent-ils ? Les Foyers survivent-ils ? Y a-t-il des histoires ? La chronique finale est le livrable.
- **Après S0** : bilan → itération des systèmes cassés → décision early access Steam (GDD §12).

---

## Chantiers transverses (en continu, pas des jalons)

| Chantier | Quand | Note |
|---|---|---|
| Art (Aseprite, tilesets, animations) | dès V2, en continu | Placeholder d'abord ; style final peut attendre V10 |
| Cartes Tiled | V1 (test), V9 (saison), S0 (vraie carte) | Le squelette artisanal est un travail de design, pas de code |
| CI GitHub Actions (check+test+lint) | dès le premier push distant | Même garde-fou que le lint, qui survit aux oublis |
| Audio | après GATE 1 | Direction en suspens (GDD §15) ; la hiérarchie sonore (alarme/cor/cloche) se prototype en V7 |
| Docker Compose + VPS Hetzner | L1 (staging), Va1 (prod) | Résister à Kubernetes |

## Ce qu'on ne fait PAS avant la Saison 0 (rappel des MVP du GDD)

Commune (charte 3), tribunaux/impôts (jamais), marché global (jamais), Ermitage/Charognard complets avant Va4, capture/rançon avant Va3, cosmétiques payants, Steam. Chaque envie d'en avancer un = relire GDD §5 et §13.

## Risques identifiés et où ils se paient

- **Le feel du combat top-down à 12 Hz** → levé en V6 (PvE) et re-testé en L1 (latence réelle). Plan B : monter le tick (15 Hz) coûte ~25 % de CPU serveur, pas une réécriture.
- **Des PNJ crédibles sans y engloutir un an** → V5 est borné par sa sortie (« survivre 10 jours »), pas par l'ambition RimWorld.
- **La boucle solo pas assez riche** → c'est le rôle du GATE 1 ; tout ce qui suit est suspendu à lui.
- **50 joueurs pour la S0** → la démo Cloudflare + Discord se construisent dès V10, pas au dernier moment.
