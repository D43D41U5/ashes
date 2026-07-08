# Spec — Jauge Température (thermostat alpin)

**Date** : 2026-07-08 · **Statut** : design validé (brainstorming), à implémenter (TDD).
Sixième jauge du corps (GDD §6bis). Remplace le modèle bricolé actuel « froid = ×faim » par
le vrai levier physiologique. Dépendances aval : la **levée Cendreux** (lore parké) consomme la
cause de mort `cold` ; les **POIs abris/Foyer** deviennent des relais de chaleur.

## Contexte & décision

Le GDD spécifie déjà **Température** comme une des « six jauges » (§6bis, l.245) :
« triviale en acte I, tyrannique au Grand Froid. Réponses : vêtements, feux, abris. » Le code ne
l'avait jamais construite — il modélisait le Grand Froid uniquement comme un multiplicateur de
faim (`HUNGER_ACT_MULT`). Ce spec construit la jauge canon.

**Décision actée (2026-07-08)** : Température est une jauge à part entière, modèle *thermostat*
(dérive vers un ambiant), distincte de la faim. `HUNGER_ACT_MULT` **est conservé** comme pression
*économique* (le Grand Froid double la consommation, §8) — les deux pressions sont complémentaires,
pas redondantes. À consigner dans `docs/decisions.md`.

## Objectif

Une jauge `temperature` (0-100) par humain, qui **dérive vers une température ambiante cible**
propre au lieu et à l'instant : basse en altitude, la nuit, au Grand Froid, sur les biomes froids ;
haute près d'un feu, sous abri. Ignorable au fond de vallée en acte I ; mortelle sur les hauteurs
nocturnes et en fin de saison. Elle donne enfin un **coût à la verticalité** et fait des feux/abris
des refuges littéraux.

## Modèle

### Portée
- **Humains** (joueur + PNJ) : ont et subissent la jauge (le banc PNJ reste fidèle ; les morts de
  froid PNJ alimenteront le critère Cendreux).
- **Cendreux / monstres / faune** : pas de jauge.

### La cible `ambientTemperature(map, state, x, y) → 0..100` (pure)
Somme, puis `clamp(0, 100)` :

| Terme | Valeur de départ (calibrage playtest) | Source |
|---|---|---|
| BASE | `+90` | vallée, jour, acte I = confort |
| Altitude | `− elevation × 70` | `map.elevation` (0..1) |
| Biome | glacier `−15`, neige `−10`, tourbière/roselière `−5`, forêt (dense/claire/vieille/mélèzes) `+5`, reste `0` | table par terrain, parallèle à `TERRAIN` |
| Nuit | `−20` de nuit, rampe linéaire aube/crépuscule (onde trapèze) | `state.tick` + constantes de cycle |
| Acte | I `0` · Grand Froid `−25` · Cendre `−40` | bornes d'actes (`balance.ts`) |
| Blizzard | `−X` transitoire tant que l'événement est actif | événement (si présent ; sinon terme dormant) |

**Feu & abri modifient la cible** (le *lieu* devient plus chaud). Ordre de composition explicite :
```
base    = BASE + Altitude + Acte + Blizzard          // ce qu'un toit ne coupe pas
exposé  = Nuit + Biome                                // pertes que l'abri amortit
ambiant = clamp(0,100, base + SHELTER_FACTOR × exposé)   // SHELTER_FACTOR = 1 à découvert, 0.5 sous toit
cible   = max(ambiant, bulleFeu)                      // le feu est un plancher chaud local
```
- **Feu/Foyer** : `bulleFeu = FIRE_WARMTH` décroissant avec la distance au feu le plus proche (0 hors
  portée). Pris en `max` — un feu ne peut que réchauffer, jamais refroidir. Distance : `sqrt` autorisé.
- **Abri/intérieur** : `SHELTER_FACTOR = 0.5` amortit **nuit + biome seulement** (le toit coupe le
  rayonnement nocturne et le vent, pas l'altitude ni la saison). Jour 1, « sous abri » = sur
  l'empreinte d'un bâtiment ; les abris-sous-roche POI marqueront des tuiles abritées plus tard.

### La dérive (thermostat)
Chaque tick, pour chaque humain :
```
temperature += (ambient − temperature) × K_DRIFT / insulation
```
- `K_DRIFT` : taux de base, **calibrage**. Feel visé : nu sur sol à `ambient ≈ 0` → *engourdissement
  en ~2 min de cycle, hypothermie en ~plusieurs min* (bien plus rapide que la faim, qui est en jours ;
  mais une traversée de col reste jouable). Exprimé relativement au cycle, pas en dur.
- `insulation` = **vêtements → ralentit la dérive** (isolation, ralentit l'échange dans les deux sens).
  **Stubbé** : constante de corps de base (`INSULATION_BODY`, ex. 1.0) pour l'instant. Hook :
  `insulation` sera dérivé de l'équipement porté quand la Couture atterrira. Levier câblé, dormant.

### Bandes & effets
- **Confort** `temperature ≥ 60` : aucun effet.
- **Engourdissement** `20 ≤ temperature < 60` : malus **linéaire** (0 à 60, plein à 20) sur la
  **régén d'endurance** et la **vitesse de déplacement**. Pas d'effet PV. Zone d'alerte visible.
- **Hypothermie** `temperature < 20` : **dégâts PV par tick**, de 0 (à `temp=20`) au max (à `temp=0`).
  Mort par ce biais → **cause de mort `cold`**.

La tyrannie de l'acte vient de l'**ambiant abaissé**, pas des bandes (fixes) : en acte I on plafonne
au-dessus des bandes basses au fond de vallée ; le Grand Froid/la Cendre poussent l'ambiant si bas
qu'on les atteint.

## Forme dans le code

- Champ `temperature: number` sur `Entity` (init 100 ; ajouté au snapshot pour le client).
- Helper **pur** `ambientTemperature(map, state, x, y): number`.
- Étape de tick `advanceTemperature(state)` (dérive → bandes → malus/dégâts → cause `cold`), à côté
  de l'avance des autres jauges.
- Bloc `TEMPERATURE` dans `balance.ts` (BASE, ALT_COLD, NIGHT_COLD, ACT_COLD par acte, FIRE_WARMTH,
  rayon/portée feu, SHELTER_FACTOR, K_DRIFT, INSULATION_BODY, seuils 60/20, dégâts hypothermie).
  Offsets de biome en table parallèle au `TERRAIN`.
- **Pur & déterministe** (invariant #2) : sommes, `elevation` précalculé, onde de nuit linéaire,
  au pire `sqrt`. **Aucune** fonction transcendante.
- Ces constantes de gameplay vivent dans `balance.ts` (équilibrage), pas dans le générateur de carte.

## Critères d'acceptation (headless)

1. **Déterminisme** : même seed + mêmes inputs → suite de `temperature` bit à bit identique
   (vérifié comme les autres contrats de `sim.test.ts` / `replay.test.ts`).
2. **Trivialité acte I** : humain immobile au fond de vallée, jour, acte I → `temperature` reste
   `≥ 60` indéfiniment (aucun malus).
3. **Létalité des hauteurs** : humain nu sur glacier, nuit → atteint l'hypothermie (`< 20`) en
   `≤ N` cycle-minutes, puis perd des PV chaque tick.
4. **Réchauffement au feu** : placé près d'un feu, `temperature` remonte (tend vers la bulle) ;
   éloigné, elle rechute vers l'ambiant.
5. **Abri** : sous toit, le refroidissement nocturne est ~la moitié de celui à découvert (même lieu).
6. **Isolation** : `insulation` forcée plus haute → temps-jusqu'à-hypothermie proportionnellement
   plus long (test avec la valeur stub surchargée).
7. **Tyrannie de l'acte** : même lieu/heure, `ambientTemperature` strictement décroissant
   acte I → Grand Froid → Cendre.
8. **Mort de froid** : `temperature` maintenue à 0 → mort de l'entité avec cause `cold`.
9. **Pureté** : `pnpm lint` vert (aucune transcendante, aucun import interdit).

## Hors périmètre

- **Système de vêtements / Couture** — seul le hook `insulation` est posé ; la valeur reste la
  constante de corps de base.
- **Vent & humidité** (mouillé après rivière/pluie) — termes différés, à ajouter plus tard.
- **Levée Cendreux** — système parké ; ce spec ne fait que **poser la cause de mort `cold`**.
- **Rendu UI de la jauge** — le client lira le champ `temperature` du snapshot (travail client).
