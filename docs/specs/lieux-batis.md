# Les lieux bâtis — étage 1 : les POI humains creux deviennent des constructions

*Spec du 2026-08-10. Périmètre validé par Alexis (« go ») après audit de l'état réel.
Étend le patron livré par `poi-batis.ts` (commit 29d0cae : « la Ferme ruinée EST ses murs »)
aux sept POI humains qui ne sont encore que des sprites traversants.*

## Le constat (audit du 2026-08-10)

Sur 36 types de POI, seuls `ferme_ruinee` et `cabane` ont un corps réel. Les sept types
humains suivants sont des sprites sans collision, sans fouille, sans sort : **ruines, abri,
mine, oratoire, bivouac, charrette, epave**. Aucun POI ne bloque par lui-même
(`collision.ts` ignore `map.zones`) : on marche à travers les Ruines comme à travers l'Épave.

## Le périmètre — et ce qui est DIFFÉRÉ

**Étage 1 (cette spec)** : corps en structures + sort brûlé/pillé/intact + fouille `rubble`,
pour les sept types ci-dessus. Plus les deux dettes qu'il faut payer avant de monter en
volume : la parité d'amorce (LAN/banc) et la mesure perf client.

**Différé, chaque point étant une décision d'Alexis à part** :
- le corps solide des POI *naturels* (erratique, arche, sanctuaire… — S-R13 les garde au
  semis neutre, et leur grammaire actée est le sprite/terrain) ;
- les coffres garnis, les dangers attachés aux ruines, tout « lieu qui donne » (lieux.md A9
  reste la loi : la fouille passe par des NŒUDS, jamais par le lieu) ;
- le démontage des ruines par le joueur (rouvrirait la décision du 2026-08-01 « le marteau
  défait ce qu'il a fait ») ;
- l'effet d'abri (`isSheltered`) sur les nouveaux lieux couverts — à VÉRIFIER et rapporter
  (si le toit abrite déjà, c'est dérivé et gratuit ; sinon, question de design à poser).

## Le contrat

### Pièces nouvelles (registre `pieces.ts` — commitées avec cette spec)

| pièce | fam | pose | bloque | pv | usage |
|---|---|---|---|---|---|
| `charrette` | vestige | monde | oui | 80 | la Charrette abandonnée, l'Épave |
| `autel` | mobilier | monde | oui | 250 | l'Oratoire |

`pose: 'monde'` = naturelle, non reproductible : aucune recette, aucune route joueur.
C'est le régime existant (D1) — rien d'autre à inventer.

### Légende étendue (`poi-batis.ts`)

Les plans des petits lieux posent des pièces **hors région** (pas de salle, pas de murs
dérivés — le précédent est `x`/friche). Caractères à ajouter, au choix de l'implémentation,
documentés dans `LEGENDE` : charrette, autel, mur_bas, poutre hors salle, âtre hors salle,
paillasse hors salle, tonneau hors salle, nœud `rubble` hors cour.

### Empreintes (`POI_TYPES`) — élargies, sous garde de recensement

Les empreintes actuelles (2-4) sont dimensionnées pour des sprites. Proposition de départ :
ruines 4→6, abri 2→4, mine 3→5, oratoire 2→3, bivouac 2→3, charrette 2→3, epave 2→4.
Réglage worldgen = se calibre EN REGARDANT LA CARTE : le recensement multi-seeds tranche,
pas le goût. Si un type cesse de naître (A19) ou s'effondre en effectif, on resserre.

### Les sept plans — intentions

| kind | intention | pièces pressenties |
|---|---|---|
| `ruines` | pans de murs très usés (usure ≈ 0,25), deux brèches, à ciel ouvert | salle + brèches, poutre, mur_bas, rubble ×2 |
| `abri` | un couvert minéral adossé, ouvert au sud | salle 2×2 couverte, brèches côté ouvert, paillasse |
| `mine` | l'entrée condamnée — le carreau de mine, pas le souterrain (différé) | petite salle pierre, seuil, poutres, rubble ×3 (la fouille la plus riche) |
| `oratoire` | l'édicule alpin : la pierre dressée et son enclos ruiné | autel, mur_bas, rubble ×1 |
| `bivouac` | le feu froid de ceux qui sont partis | âtre, paillasse, tonneau, rubble ×1 |
| `charrette` | échouée sur le bord du chemin | charrette, tonneau, rubble ×1 |
| `epave` | le convoi pris par l'avalanche (aiguilles/glacier) | charrette, poutres, rubble ×2 |

Orientation : `tourne` par défaut (seule la ferme est `fixe`, décision 2026-07-27).
Toponymes : `NOMS_PAR_SORT` étendu là où le sort a un sens (la charrette née près d'une
sente sera presque toujours « pillée » — c'est voulu, c'est la règle de lecture S-R17).

## Critères d'acceptation

- **A1** — chaque kind du périmètre a un `Plan` validé par `verifierPlans` ; côté = empreinte `POI_TYPES`.
- **A2** — collision : la garde de traversabilité (flood-fill dedans↔dehors) passe sur TOUS les plans ; garde exhaustive de non-pénétration (patron `wall-solid`) sur au moins un plan muré neuf.
- **A3** — fouille : chaque plan sème ≥ 1 nœud `rubble` ; stock modulé par le sort (S-R18, plancher 1) ; A9 intact — le lieu ne DONNE rien, l'inventaire ne change qu'en fouillant.
- **A4** — sort + toponyme + annales : `sortDuLieu` s'applique aux sept ; `nomSelonSort` couvre les kinds déclarés ; annales ere 1/ere 3 écrites (dérivé de `BUILT_KINDS`, automatique).
- **A5** — parité d'amorce : le serveur LAN (`createZone`) et le banc (`scenario.ts`) appellent `buildPoiStructures` comme la Veillée — même seed, même ordre. Un monde LAN porte les mêmes murs qu'un monde solo.
- **A6** — déterminisme : double génération identique sur TOUS les plans ; aucun tirage sur le PRNG partagé dans `poi-batis` (hash positionnel seulement).
- **A7** — recensement : sur ≥ 4 seeds, chaque type du périmètre naît (A19) et les effectifs avant/après élargissement d'empreinte sont rapportés MESURÉS.
- **A8** — rendu : `charrette` et `autel` ont leur art `bati-art` (albédo + `_lit`) ; aucun sprite-corps ne double un `BUILT_KIND` (dérivé, automatique).
- **A9** — perf : coût client (syncStructures, clone snapshot) MESURÉ au décompte projeté (~1 000-1 500 structures), pire seconde et pas moyenne ; le pooling/culling (patron des nœuds) ne s'implémente QUE si la mesure le justifie.
- **A10** — le banc avant/après (≥ 3 seeds) : deltas rapportés, famine jugée au seuil absolu.
