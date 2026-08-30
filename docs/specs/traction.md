# La traction — tirer une charge derrière soi

> **CHANTIER OUVERT LE 2026-08-30** — né du Bûcher rituel (`cendre.md` R31, chantier ⑥ des dix),
> et conçu d'emblée comme un SYSTÈME (directive d'Alexis : « travaille bien la partie tirer
> parce qu'on pourra tirer des chariots à l'avenir — pour porter des grandes quantités de
> bûches par exemple, ou des cadavres »). Le cadavre est la première charge ; le chariot est
> nommé, dimensionné, et attendra son chantier.

## L'intention

Le portage a un plafond (la charge du dos) ; la traction est l'étage au-dessus : LENTE,
BRUYANTE, GÉOMÉTRIQUE. On ne tire pas une charge comme on marche — on négocie le terrain avec
elle. C'est un système de ROUTE : ce qui rend les chemins, les pentes douces et les portes
larges précieux.

## Les règles

- **T1 — UNE PRISE, UNE CHARGE.** L'action `atteler { kind, id }` noue l'attelage ; `detacher`
  le rompt. Un tireur n'a qu'une charge, une charge n'a qu'un tireur (le second arrivé est
  refusé « déjà attelée »). L'état vit sur le TIREUR seul : `entity.attelage = { kind, id }` —
  JSON-sérialisable, un champ. S'atteler exige d'être à ≤ `TRACTION.PORTEE` de la charge, et
  les MAINS LIBRES au sens du geste : toute action de combat ou de récolte DÉTACHE d'abord
  (les mains ne font qu'une chose).
- **T2 — LA LONGE.** La charge SUIT : tant que la distance tireur→charge dépasse
  `TRACTION.LONGE` (~1,2 t), la charge avance VERS le tireur, à la vitesse de celui-ci. En
  deçà, elle ne bouge pas (on tourne autour d'une charge posée sans la remuer). Le pas de la
  charge passe par SA collision — déclarée au registre T4 : une charge `fantome` (le cadavre)
  glisse à travers tout ; une charge SOLIDE (le chariot) se cogne, et c'est le JEU — manœuvrer
  un chariot dans une porte est une affaire de géométrie, pas un clic.
- **T2bis — LA RUPTURE.** Si la distance dépasse `TRACTION.RUPTURE` (~3 t — une charge coincée
  derrière un angle pendant que le tireur insiste, un téléport, une chute), l'attelage CASSE :
  `detache`, la charge reste où elle est, l'événement le dit. Jamais de charge téléportée —
  la longe est une corde, pas un lien magique.
- **T3 — LE PRIX.** Attelé : PAS DE SPRINT (l'allure est bornée à la marche), et la vitesse
  est multipliée par le `facteur` de la charge (cadavre 0,6). Le bruit du pas est celui du
  PORTAGE LOURD (`gaitNoise` planché à la marche — le patron « le portage interdit le
  silence ») : on n'approche pas une fosse en silence avec un mort derrière soi.
- **T4 — LE REGISTRE DES TRACTABLES.** Ce qui se tire se DÉCLARE (`TRACTABLES`), avec son
  `facteur` de vitesse et son mode de collision (`fantome` ou `solide`). Aujourd'hui :
  `corpse` (0,6, fantôme). Demain : le chariot (`solide`, facteur selon son chargement, une
  CAPACITÉ de cases — son chantier dira le reste). Ajouter une charge = une entrée, pas
  quinze fichiers (la doctrine du registre).
- **T5 — CE QUI DÉTACHE.** `detacher` (le geste), la rupture (T2bis), la mort du tireur, la
  disparition de la charge (un cadavre qui se décompose ou se consume), et toute action de
  combat ou de récolte du tireur. Le détachage est toujours SILENCIEUX côté sim sauf la
  rupture (`attelage_rompu`) — le geste volontaire n'a pas besoin d'un événement.

## Critères d'acceptation

| # | Critère |
|---|---|
| **A1** | **La longe tire, au pas** : attelé à un cadavre, marcher 10 tuiles le fait suivre à ≤ `LONGE` + un pas ; immobile ou en deçà de la longe, la charge ne bouge pas d'un pixel ; la vitesse du tireur attelé = marche × `facteur` (mesurée sur la distance parcourue), et le sprint attelé n'accélère RIEN. |
| **A2** | **La rupture casse, jamais ne téléporte** : un `debug_teleport` du tireur à 10 tuiles → `attelage_rompu`, la charge n'a pas bougé ; re-atteler fonctionne. |
| **A3** | **Une charge, un tireur, des mains libres** : le second `atteler` sur la même charge est refusé ; un coup porté par le tireur le détache ; la mort du tireur détache ; `atteler` à > `PORTEE` est refusé « trop loin ». |
| **A4** | **Le prix s'entend** : attelé, `gaitNoise` ≥ celui de la marche quel que soit l'allure demandée (la lecture de la chasse et des morts le voit). |

## Hors périmètre, nommé

- **LE CHARIOT** — la charge solide, sa capacité de cases, son facteur fonction du chargement,
  sa fabrication et sa pose : un chantier à lui (il consommera T1-T5 tels quels).
- L'attelage de PNJ (un villageois qui tire), la traction à deux, la pente qui module.
