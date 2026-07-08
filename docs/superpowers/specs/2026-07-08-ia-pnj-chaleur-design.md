# Spec — IA PNJ de recherche de chaleur

**Date** : 2026-07-08 · **Statut** : design validé (brainstorming), à implémenter (TDD).
Fait suite à la **jauge Température** (spec `2026-07-08-jauge-temperature-design.md`) : les PNJ subissent
maintenant le froid, mais n'ont aucun comportement pour l'éviter. En actes II/III (Grand Froid), un
PNJ qu'une tâche/un raid mène en zone froide peut geler bêtement. Cette IA répare ça — et prépare la
**levée Cendreux** (un PNJ qui *ne peut pas* rejoindre un feu et meurt = un Cendreux légitime, pas un bug).

## Contexte (IA PNJ existante)

IA à deux étages (spec R3) : `advanceNpcs` (npc.ts) enchaîne des **besoins critiques** (npc-needs.ts)
puis des **tâches**. Ordre actuel : `defense → errand → sleep → hunger → tasks`. Deux faits clés :
- **La nuit est déjà couverte** : `handleSleep` marche le PNJ vers `home ?? Foyer` la nuit → il dort
  au chaud. Le risque de gel est donc surtout **de jour en altitude, ou pendant raids/glane en actes froids**.
- **Les besoins utilisent le vrai pathfinding** (`setPathTo`/`followPath`), contrairement au
  `handleDefense` glouton qui a causé le livelock milice ([[milice-livelock]]). On construit dessus.

Rappels chiffrés (jauge Température) : hypothermie (dégâts) `< 20` ; ambiant du fond de vallée en
acte III = `90 − 40 = 50` (engourdissement, non létal). Helpers purs réutilisables :
`fireBubble(state,x,y)` et `isSheltered(state,tx,ty)` (« suis-je déjà au chaud ? »).

## Objectif

**Un seul mécanisme, réactif** — un besoin critique `handleCold` : un PNJ qui a *froid* et n'est *pas
déjà au chaud* abandonne sa tâche et rentre à son feu, **sans jamais se figer** si le feu est
inatteignable. (Un volet *préventif* — éviter d'assigner la glane en zone froide — a été **écarté** :
en grande partie redondant avec ce réactif, calibrage douteux, et risque de brider l'éco par
oisiveté. À ajouter *seulement si* le playtest/l'instrument 60j montre trop de trajets-suicides.)

## Design

### Besoin réactif `handleCold` (npc-needs.ts)

Inséré dans `advanceNpcs`, **après `sleep`, avant `hunger`** :
`defense → errand → sleep → **cold** → hunger → tasks`.
Le froid prime sur manger et travailler (il tue plus vite), mais **pas** sur la défense, un raid/don
déjà engagé, ni la routine de sommeil (qui ramène déjà au feu la nuit). Conséquence *assumée et
thématique* : un raider/défenseur qui gèle en plein Grand Froid peut mourir → futur Cendreux légitime.

Logique (le PNJ ne prend le dessus **que pour se *déplacer* vers la chaleur**) :
```
handleCold(state, village, npc, entity):
  # 1. Assez chaud ? (hystérésis : une fois en recherche, on continue jusqu'au confort)
  if not npc.seekingWarmth and entity.temperature >= NPC_COLD_SEEK:      return false
  if entity.temperature >= NPC_COLD_RESUME:  npc.seekingWarmth = false;  return false

  # 2. Déjà en train de se réchauffer ? → on laisse manger/travailler au coin du feu
  if fireBubble(state, entity.x, entity.y) > 0 or isSheltered(state, floor(x), floor(y)):
      npc.seekingWarmth = false                                          return false

  # 3. On a froid et on est à découvert → on rentre au feu
  npc.seekingWarmth = true
  target = own home (npc.homeId) ?? own village Foyer (fire, villageId === village.id)
  if target is None:                                                     return false
  if npc.path.length == 0:
      if not setPathTo(state, npc, entity, target.tx, target.ty):        return false  # ANTI-LIVELOCK
  followPath(state, npc, entity)
  return true
```

Points de design **non négociables** (leçon [[milice-livelock]]) :
- **Anti-livelock** : si `setPathTo` échoue (aucun chemin vers un feu ami — PNJ piégé dans le froid),
  `handleCold` **rend la main (`return false`)**. Le PNJ retombe sur hunger/tasks et continue à *faire
  quelque chose* au lieu de se figer en yo-yo. Il peut mourir de froid — mais c'est une mort *piégé
  dans le froid* (Cendreux légitime), pas un livelock. C'est l'inverse exact du bug milice.
- **« Déjà au chaud → yield »** : dès qu'il est dans une bulle de feu ou abrité, `handleCold` rend la
  main → il **mange et travaille au coin du feu en se réchauffant**. Effet émergent voulu : au Grand
  Froid, le village **se blottit autour du Foyer, toujours productif**. Donne aussi l'hystérésis (il ne
  re-cherche que s'il redérive sous `NPC_COLD_SEEK` *loin* d'un feu).

État ajouté : `Npc.seekingWarmth: boolean` (init `false`, JSON-sérialisable).

Cible = **son propre** foyer (comme `handleSleep`), jamais « le feu le plus proche » : se réchauffer
dans un village ennemi serait absurde/suicidaire ; un raider gelé au loin rentre chez lui.

### Constantes (balance.ts, bloc NPC_AI)

| Constante | Départ | Rôle |
|---|---|---|
| `NPC_COLD_SEEK` | 40 | Sous ce seuil, le PNJ cherche la chaleur. **Sous l'ambiant vallée act III (50)** → la vie normale de fin de saison ne le déclenche pas ; **au-dessus de l'hypothermie (20)** avec marge (dérive lente : ~175 s de 40 à 20). |
| `NPC_COLD_RESUME` | 60 | Hystérésis : arrêt de la recherche au retour au confort. |

Ordres de grandeur, calibrage playtest (règle projet).

## Critères d'acceptation (headless)

1. **Déterminisme** : même seed + inputs → comportement PNJ bit à bit identique (garde `npc.test.ts` A8).
2. **Recherche réactive** : un PNJ à `temperature < 40`, à découvert et loin d'un feu, avec un chemin
   vers son Foyer → un `path` est posé vers ce Foyer et il **cesse de glaner** (handleCold prime sur tasks).
3. **Yield si déjà au chaud** : un PNJ à `temperature < 40` mais dans la bulle d'un feu (ou abrité) →
   `handleCold` rend la main (return false) : il peut manger/travailler en se réchauffant.
4. **Anti-livelock** : un PNJ à `temperature < 40`, à découvert, **sans chemin** vers un feu ami →
   `handleCold` rend la main ; le PNJ enchaîne sur hunger/tasks (ne se fige pas). Repro façon milice.
5. **Hystérésis** : une fois `seekingWarmth`, le PNJ continue de viser le feu jusqu'à `temperature ≥ 60`,
   sans re-basculer à 40 (pas de flapping) ; `seekingWarmth` repasse à `false` au confort ou au feu.
6. **Priorité** : la défense et un errand en cours priment toujours sur `handleCold` (ordre respecté).
7. **Non-régression** : `pnpm scenario` reste vert (acte I inchangé — le froid n'y déclenche rien).
   Vérif complémentaire (non bloquante, hors suite) : sur un run 60 jours, les morts de froid PNJ des
   actes II/III chutent nettement (instrument `scratchpad/sdd/instrument-cold-deaths-60d.test.ts.txt`).
8. **Pureté** : `/sim` pur, `pnpm lint` vert (réutilise les helpers purs de température).

## Hors périmètre

- **Préventif** (écarter la glane des tuiles froides) — **coupé** (voir Objectif) ; à ajouter si la
  mesure montre trop de trajets-suicides. Le réactif est le vrai correctif.
- **Chercher un feu ennemi/neutre** en désespoir de cause (on ne vise que son propre Foyer).
- **Vêtements** (l'isolation reste le stub de la jauge Température).
- **Rappeler les raiders** au Grand Froid (le froid ne prime pas sur un errand engagé — assumé).
- **Levée Cendreux** — système séparé, à venir ; cette IA lui fournit des morts de froid *sensées*
  (le PNJ vraiment piégé), pas du bruit.
