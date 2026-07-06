# Prédiction & réconciliation — le netcode de l'avatar local

*Source : GDD §11 (client bête, serveur autoritatif), roadmap Phase LAN. Complète `client.md` R5. Statut : **implémenté** (2026-07-05, cœur pur testé dans `/sim`). Jalon : préparation LAN.*

## Objectif de design

Le client prédit le déplacement de son propre avatar sans jamais posséder la simulation, et se recale sur l'autorité **par rejeu** (replay) plutôt que par une correction heuristique. C'est l'architecture standard des jeux d'action à serveur autoritatif (Quake → Source → Overwatch ; Gambetta, *Fast-Paced Multiplayer*). Braises étant déjà déterministe au bit près (invariant §2), le rejeu retombe *exactement* sur l'état serveur : une correction n'est visible que sur une vraie misprédiction (perte de paquet, désync de phase de tick).

Trois pièces, par-dessus la prédiction à pas fixe déjà en place (`moveAvatarStepped`, voir `client.md` R5) :

## Règles

### Inputs numérotés

- **R1 — Chaque input porte un `seq` croissant.** Le client échantillonne l'input à pas de tick fixe (`TICK_DT_S`), incrémente `seq`, envoie `{type:'input', seq, dx, dy, sprint, block}` **et conserve l'input dans un buffer local** (`pending`).
- **R2 — L'hôte acquitte.** Chaque `snapshot` porte `lastProcessedInput` : le `seq` de l'input du joueur actif au tick produit. L'hôte applique le dernier input reçu à chaque tick (le répète si rien de neuf) et rapporte son `seq`.

### Réconciliation par rejeu

- **R3 — Ancre exacte, rejeu des inputs en attente.** À réception d'un snapshot : (a) purge du buffer les inputs `seq ≤ lastProcessedInput` (acquittés) ; (b) place l'ancre `base` sur la position autoritative ; (c) **rejoue** les inputs restants du buffer, un `moveAvatar(TICK_DT_S)` chacun, avec leur `speedScale` mémorisé. `base` redevient la prédiction, recalée sur l'autorité.
- **R4 — Rejeu = mêmes fonctions pures que l'hôte.** Le rejeu appelle `moveAvatar` de `/sim` à pas fixe : par déterminisme, prédiction parfaite ⇒ `base` inchangée, correction nulle.
- **R5 — Un vrai téléport ne se rejoue pas.** Si l'écart autoritatif dépasse `SNAP_DISTANCE_TILES` (respawn au Feu), l'ancre saute brut et le buffer est vidé — un téléport n'est pas une marche.

### État de sim exact vs. lissage de rendu

- **R6 — La sim est exacte, seul le RENDU est lissé.** Une correction de réconciliation n'est jamais appliquée d'un coup au sprite : l'écart `(ancienne base − nouvelle base)` est versé dans un `renderOffset` visuel qui **décroît** sur les frames suivantes. Au moment du recalage, `nouvelle base + renderOffset = ancienne base` → aucun saut visible ; puis l'offset fond vers 0 et le sprite rejoint la vérité.
- **R7 — Rendu par extrapolation, sans latence.** Le sprite s'affiche à `base` extrapolée du reliquat sous-tick (`moveAvatar` partiel, résolu par collision) **plus** `renderOffset`. On devance de < 1 tick au lieu de retarder (pas d'interpolation prev→courant, cause de la latence révoquée le 2026-07-05).

## Critères d'acceptation (testables dans `/sim`, `prediction.test.ts`)

- **A1 — Prédiction parfaite ⇒ correction nulle.** Client qui prédit K ticks ; l'hôte applique exactement les mêmes inputs ; réconciliation avec l'état autoritatif résultant ⇒ `base` identique au bit près, `renderOffset` nul.
- **A2 — Acquittement.** Après réconciliation à `lastProcessedInput = k`, seuls les inputs `seq > k` restent dans `pending` et sont rejoués.
- **A3 — Parité de rejeu près d'un mur.** Rejouer les inputs bufferisés depuis l'état autoritatif, contre le bout d'un mur, reproduit la trajectoire de l'hôte (pas de divergence de coin).
- **A4 — Misprédiction bornée et collision-safe.** Avec un état autoritatif divergent, `base` se pose sur le résultat rejoué (jamais dans un mur) et `renderOffset` absorbe l'écart (le sprite ne se téléporte pas) ; l'offset décroît vers 0.
- **A5 — Snap dur.** Écart > `SNAP_DISTANCE_TILES` ⇒ `base` saute, `pending` vidé, pas de rejeu à travers le téléport.
- **A6 — Extrapolation de rendu.** Entre deux ticks, la position de rendu devance `base` du reliquat sous-tick et reste collision-safe.

## Hors périmètre (et où ça revient)

- **Command buffering adaptatif / synchro de phase de tick** (le client et l'hôte tickent sur des horloges indépendantes ; l'hôte applique le dernier input reçu, pouvant en sauter un intermédiaire) → affinage LAN, quand la latence réelle existera. La réconciliation + le lissage absorbent le résidu en v1.
- **Lag compensation** (rembobinage serveur à la vue du tireur pour la détection de coup) → quand le combat à distance existera.
- **Prédiction des modificateurs de vitesse** (faim, jambe blessée) : approximés constants sur la courte fenêtre de rejeu ; seule la position est prédite.
