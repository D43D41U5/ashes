# La persistance de la Veillée — 5 veillées qu'on retrouve

*Source : décision d'Alexis (2026-07-19, `docs/decisions.md`), sur la maquette « Ashes UI » (Turn 10A) réconciliée avec le moteur. Statut : **assise pure implémentée** (`packages/sim/src/persistence.ts` + tests) ; **hôte + écran non implémentés**. Jalon : Veillée (pré-GATE 1).*

> **Pourquoi maintenant.** GATE 1 demande « la boucle solo est-elle fun **5 sessions d'affilée** ? ». Jouer *le même monde* sur cinq sessions **exige de le reprendre** : la persistance est un prérequis du gate, pas un plus-tard. Levier : `SimState` est JSON-sérialisable par invariant (§2), donc l'essentiel est déjà là.

---

## 1. Le modèle en une phrase

*La Veillée cesse d'être un mode éphémère : jusqu'à **5 emplacements**, chacun une chaîne sérialisée d'un `SimState` dans IndexedDB ; on **reprend** un monde vivant, on **relit** un monde éteint (« close »), on **allume** un emplacement libre, on **écrase** sur confirmation — et la chronique d'un monde clos **survit**.*

## 2. Le partage des responsabilités (invariant §2)

`/sim` est **pur** : il ne connaît ni le disque ni l'horloge murale. La frontière :

- **`/sim` (pur, implémenté)** — `serializeSim(state) → string` / `deserializeSim(string) → SimState`, enveloppe **versionnée** `{ v, sim }`. Le jour et l'acte d'un slot se **dérivent** de l'état (`seasonDayAtTick`, `actForDay`) ; l'état de fin se lit sur `state.seasonEnded`.
- **L'hôte (le Worker Veillée, à faire)** — écrit/lit la chaîne dans **IndexedDB**, tient les métadonnées d'**horloge murale** (temps de jeu cumulé, « dernière fois vue »), gère les 5 emplacements et leurs gestes (reprendre / allumer / écraser / relire).

L'enregistrement d'un slot (hôte) est donc `{ sim: string (serializeSim), playtimeMs, savedAtMs, name }` — le `name` est le nom du Foyer si fondé, sinon un défaut.

## 3. Les critères — l'assise pure (implémentée, `persistence.test.ts`)

- **R1 — Round-trip fidèle.** `deserializeSim(serializeSim(s))` rend un état **identique au bit près** (`snapshot` égal). ✅
- **R2 — Reprise déterministe.** Sauver au pas K, recharger, avancer jusqu'à N donne le **même état** qu'une partie menée de 0 à N d'un trait — le flux RNG/hordes/convois compris. C'est ce qui fait d'une Veillée un monde *retrouvé*, pas *approximé*. ✅
- **R3 — Format versionné.** `SAVE_FORMAT_VERSION` ; `deserializeSim` **rejette** (jette) une version inconnue ou une enveloppe absente, plutôt que de rendre un état à moitié compris. La migration montante des versions antérieures se greffe dans `deserializeSim` quand il y en aura. ✅

## 4. Les critères — l'hôte & l'écran (à implémenter)

- **R4 — Cinq emplacements.** Le menu solo montre 5 slots (maquette 10A) : occupé (reprendre), close (relire), ou libre (allumer). Le deep-link `?solo` reprend le dernier slot actif, ou en allume un si aucun.
- **R5 — L'état « close ».** À `season_ended`, le slot passe **close** : il se **relit** (chronique + stèle) mais **ne se reprend pas** (le monde s'est éteint). Distinct d'un slot supprimé — un close se **garde**.
- **R6 — La chronique survit.** Un slot close conserve sa chronique lisible (elle « survit au wipe » côté maquette ; en solo, elle survit à la fin de saison). La chronique se recompose de l'état persisté via `chronicleFromEvents` — donc `state.events` devrait rester dans l'état sauvé. ⚠ **Or il n'y reste PAS aujourd'hui** (2026-07-19) : l'hôte **draine** `state.events` à chaque tick (`sim-worker.ts` → `drainEvents`), et la chronique vit côté client (`WorldScene.eventLog`, plafonnée à 500). Un monde repris via `deserializeSim` serait donc **amnésique** (chronique vide). À trancher à l'intégration : soit ne plus drainer `state.events` (persister le flux dans l'état), soit persister le log de chronique à part — **prérequis dur de GATE 1**.
- **R7 — Écraser, geste grave.** Allumer sur un slot occupé, ou supprimer une veillée en cours, demande **confirmation** (maquette 10A) — « cette veillée sera perdue, aucune chronique n'en gardera trace ». Un close, lui, ne se supprime pas par accident.
- **R8 — Autosave.** L'hôte sauve périodiquement et à la sortie (l'état est petit — une chaîne JSON), pour que « reprendre » retrouve la dernière minute jouée.

## 5. Les cartes de slot — d'où vient chaque champ

| Champ (maquette 10A) | Source |
|---|---|
| Nom du Foyer | village du joueur (`state.villages`), sinon défaut hôte |
| ACTE + nom | `actForDay(seasonDayAtTick(tick))` + `ACT_NAMES` |
| Jour X / 60 | `seasonDayAtTick(state.tick, state.calendarScale)` |
| Survivants | **à trancher** (membres vivants du village ? — décision de jeu, hors assise) |
| Temps de jeu | hôte (horloge murale cumulée) |
| « vue il y a 2 h » | hôte (`savedAtMs` vs maintenant) |
| Statut open/close | `state.seasonEnded` |

> Le décompte « survivants » n'est pas dérivé ici : sa définition (qui compte comme survivant du Foyer) est une **décision de jeu** à prendre à l'intégration, pas une propriété de l'assise.

## 6. Ce qui n'est PAS là (garde-fous)

- Pas de sauvegarde côté **multi** (La Vallée) : la persistance serveur (PostgreSQL, write-behind) est un autre chantier (Phase LAN). Ici, IndexedDB, solo, dans le Worker.
- Le commentaire `packages/client/src/scenes/ui/fatal.ts` (« la persistance viendra avec la Phase LAN ») est **caduc** pour le solo : à mettre à jour à l'intégration.
