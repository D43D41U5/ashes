# BRAISES *(ashes)*

> Un survival top-down persistant où ton village est ton personnage principal — et où les autres joueurs sont la meilleure et la pire chose qui puisse lui arriver.

Dans un monde qui meurt en soixante jours, des villages prospèrent, commercent, se pillent et se trahissent. Au centre de chacun brûle **le Feu** — et sa couleur, visible de loin, dit ce que le village a choisi d'être. La vision complète : [`braises-gdd.md`](braises-gdd.md).

**État : Phase Veillée (V0-V10) complète** — le jeu solo tourne dans le navigateur, la simulation entière vit dans un Web Worker. Phase LAN en cours (Colyseus) : le serveur tourne, deux navigateurs se voient et se battent ; reste à valider la boucle à plusieurs (GATE 2).

## Jouer (dev)

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

ZQSD/flèches/WASD bouger · SHIFT sprinter · C avancer discrètement · G jeter ce qu'on tient · 1-6 armer une case de ceinture · clic interagir selon ce qu'on tient (récolter, attaquer, allumer le Feu, bâtir, bander, donner, réparer, manger) · TAB le sac & l'artisanat · M la carte · J la chronique.

## Développer

```bash
pnpm check        # tsc strict sur tout le monorepo
pnpm test         # 100+ tests headless (déterminisme, replay, systèmes, cadrage)
pnpm lint         # dont les garde-fous : /sim pur et déterministe, imposés par ESLint
pnpm build        # build web statique → packages/client/dist
pnpm scenario     # le banc de test : joue des jours simulés, imprime le rapport
                  # (SCENARIO_DAYS=60 pnpm scenario pour une saison entière)
```

## Architecture

```
packages/sim      ← TOUTE la logique. TypeScript pur, déterministe au bit près,
                    zéro dépendance (ni Phaser, ni réseau, ni Node) — imposé par lint.
packages/client   ← Phaser 4 + Vite. Rendu, input, interpolation. La sim tourne
                    dans un Web Worker ; le client envoie des intentions.
packages/server   ← Node + Colyseus (Phase LAN, L1 livré). Même sim, autre transport ; persistance PostgreSQL encore à venir (Vallée).
docs/             ← specs par système, roadmap, journal des décisions.
```

Le pari : **on ne développe pas un jeu solo puis un jeu multi — on développe une simulation, puis on la déplace.** Même seed + mêmes inputs = même monde, partout ; le replay log est là depuis le premier jour.

Voir [`CLAUDE.md`](CLAUDE.md) (invariants, règles de travail) et [`docs/roadmap.md`](docs/roadmap.md) (jalons, gates).
