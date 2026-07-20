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

### V5 — Les PNJ ✅ (fait, 2026-07-05 — voir `specs/pnj.md`)
- Villageois simulés jouant par le même pipeline d'actions validées que les joueurs (aucune triche PNJ), IA à deux étages (besoins → tableau), tableau du village piloté par seuils sur le grenier, maisons (sommeil ×2 vs Feu), A* déterministe, `foundNpcVillage`, 3 PNJ à la fondation joueur.
- Sortie vérifiée : un village de 4 PNJ tient 10 cycles jour/nuit headless sans que personne tombe à 0 de faim, au bit près à chaque run ; villageois observés au travail en navigateur. Deux bugs de mouvement attrapés par les tests (orbite de waypoint, arrêt hors de portée).

### V6 — Le combat ✅ (fait, 2026-07-05 — voir `specs/combat.md`)
- Endurance reine (attaque/blocage/sprint, régén modulée par la faim — l'économie EST une stat de combat), wind-up 5 ticks immobile, arc 90°, blocage directionnel 120°/−70 %, blessures aux paliers (jambe/bras/saignement, bandage y compris sur allié), mort = cadavre lootable + respawn au Feu épuisé (compétences gardées, PNJ morts pour de bon), zombie (école de guerre) + sanglier (la chasse : viande cuite), milice émergente (tout PNJ défend à 10 tuiles du Feu, villages PNJ armés de lances).
- Sortie vérifiée : 3 zombies sur le village PNJ → milice victorieuse sans perte ; replay exact avec combat/blessures/monstres ; un zombie chassé et abattu au navigateur.

### V7 — Hordes & événements PvE ✅ (fait, 2026-07-05 — voir `specs/evenements.md`)
- Structures avec PV (les zombies frappent ce qui bloque — en horde via flow field ET en chasse), réparation (action + tâche de tableau PNJ), flow field BFS pur (jamais sérialisé), alarme automatique une-par-vague qui réveille la milice, hordes nocturnes (taille par acte 4/8/12, dissipation à l'aube), carcasses de convoi sur la route (composants T3, gardées). Marchand nomade reporté (le troc est un système).
- Sortie vérifiée : horde 4 vs milice 4 → tient sans perte ; horde 10 vs 2 PNJ → le village casse en ~50 s, zombies campés au Feu — les deux issues lisibles et testées.

### V8 — L'alignement ✅ (fait, 2026-07-05 — voir `specs/alignement.md`)
- Deux axes par avatar (actes envers l'extérieur seulement, pondérés par la faim utile ×besoin ×acte), premier sang par mémoire d'agression (riposte presque gratuite), inertie linéaire (paquebot), agrégation au Feu plafonnée par tête, archétypes Foyer/Meute avec effets (régén ×chaleur, Foyer retenu/solide, Meute mordante/anémique). Le don existe (`give` + dépôts ouverts à tous — la boîte aux dons). Villages PNJ à disposition : la Meute raide la nuit (casse le grenier, un coffre détruit répand son contenu, butin rapporté), le Foyer porte des baies au voisin. Alarme et milice réagissent aussi aux raiders.
- Sortie vérifiée : nourrir ses voisins vire le Feu au bleu ; le raid Meute complet (alarme, grenier cassé, butin, chaleur en baisse) ; replay exact.

### V9 — La saison ✅ (fait, 2026-07-05 — voir `specs/saison.md`)
- Courbe de pression complète (faim ×acte V4 ✓, hordes ×acte V7 ✓, + repousse des nœuds ralentie ×1/1.5/2), méga-horde de 16 au premier crépuscule de la Cendre, point d'évacuation au jour 55 sur la route, verdicts par archétype au jour 61 (le Foyer en vies sauvées, la Meute en valeur de butin, le neutre en survie), villages nommés, **chronique v1** : fonction pure transformant le bus d'événements (posé en V0 pour cela) en récit daté.
- Sortie vérifiée : saisons accélérées de bout en bout, verdicts émis une fois, chronique datée croissante nommant les villages, déterminisme au bit près.

### V10 — Veillée jouable : polish & calibrage ✅ (fait, 2026-07-05)
- **Le banc de test** : `pnpm scenario` (et `SCENARIO_DAYS=60` pour une saison) joue des mondes à 3 villages et imprime le rapport (populations, greniers, morts, chronique) — il a déjà payé : le meurtre défensif coûtait comme un meurtre gratuit (les défenseurs viraient Meute !), les raiders se battaient à mort (villages exterminés en 6 jours). Corrigés : riposte létale à −4, décrochage des raiders blessés, don du Foyer déclenché plus tôt.
- Onboarding : écran d'accueil (pitch + touches), journal de chronique (J), README.
- **⚠ Reste humain** : brancher Cloudflare Pages (`pnpm build` → `packages/client/dist`) pour la démo publique, et surtout **le GATE 1 — la boucle solo est-elle fun 5 sessions d'affilée ?** — se joue à la main, pas en test. La Phase LAN ne commence qu'après un GATE 1 positif.

---

## Phase LAN — le multi minimal (~2-3 mois)

### L1 — Le serveur (~4-6 sem) — 🟡 substantiellement fait (2026-07-18)
- `/server` Node + Colyseus, une seule zone, la même `/sim`. Transport réseau derrière le protocole de V2. Prédiction locale du déplacement + réconciliation, interpolation ~100 ms. Replay log côté serveur. Validation de vraisemblance des inputs.
- **État (2026-07-18)** : serveur Colyseus, tick-driver, validation d'inputs et replay-log (en mémoire) **livrés** ; deux navigateurs se voient, se battent, se parlent. Reste : réconciliation/interpolation éprouvées à 3 clients, persistance PostgreSQL (Vallée), puis GATE 2. Voir `docs/decisions.md`.
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
