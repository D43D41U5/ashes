# Specs par système

Le GDD (`braises-gdd.md`) est la source de vérité de la *vision*. Avant d'implémenter un système, on en extrait ici une spec *travaillable* : assez précise pour coder contre elle, avec des critères d'acceptation testables en headless.

Une tâche d'implémentation bien posée ressemble à : « implémente l'endurance selon `specs/combat.md` §2 ; les critères A1-A4 doivent passer en test ».

## Fichiers prévus (à créer au moment d'attaquer chaque système)

| Fichier | Source GDD | Phase |
|---|---|---|
| `monde.md` — tick, entités, collisions, carte | §9, §11 | Veillée 2 |
| `lieux.md` — POIs chargés : savoir, répit, récit ; la carte s'acquiert | §9, §9bis, §8bis | Veillée — chantier monde 1 |
| `village.md` — Feu, construction, propriété, rangs MVP | §5 | Veillée 3 |
| `pnj.md` — villageois simulés, tâches, simulation dégradée | §10, §11 | Veillée 3 |
| `economie.md` — ressources 3 tiers, stations, usure | §8 | Veillée |
| `combat.md` — endurance, télégraphes, blessures, mort | §7 | Veillée |
| `alignement.md` — deux axes, agrégation, MVP Foyer/Meute | §3 | Veillée |
| `saison.md` — 3 actes, pression par acte, saisons accélérées | §2 | Veillée |
| `raid.md` — 4 phases, offline, alarme | §7 | Vallée |

## Gabarit

```markdown
# <Système>

*Source : GDD §N. Statut : brouillon | actif | implémenté.*

## Objectif de design
(ce que le système doit produire comme expérience, en 2-3 phrases)

## Règles
(les mécaniques, précises, numérotées — les nombres pointent vers balance.ts)

## Critères d'acceptation
- A1 : étant donné <état>, quand <action>, alors <résultat vérifiable>
- A2 : …

## Hors périmètre / plus tard
```
