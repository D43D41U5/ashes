/**
 * ═══ QUELLE CARTE SE DESSINE ICI — l'accesseur d'étage du RENDU ═══
 *
 * *Alexis, 2026-08-31 : « je tiens au fait que chaque "étage" soit une carte à part entière
 * (l'ensemble est une superposition) » — puis, le 2026-09-07 : « traite la gestion d'une carte
 * par niveau ».*
 *
 * `/sim` a déjà le sien : `atteignableEntreEtages` (E-R5), « la règle s'écrit UNE FOIS et les
 * sites l'APPELLENT », dix-huit appelants au 2026-09-02. **Le RENDU n'en avait pas.** Chaque loi
 * qui traduit écran ↔ tuile énumérait à la main ce qui se dresse — le chapeau d'une mesa, la
 * rampe — et deux d'entre elles ont oublié la GUEULE le jour où les grottes sont arrivées :
 *
 *  - `deplierLeLift` — viser l'arche noire d'une grotte tombait 1 à 4 tuiles DANS la masse
 *    (« l'entrée sort d'une case par rapport au sprite, murs invisibles dehors », 2026-09-06) ;
 *  - `niveauDuCorps` — franchir un seuil dessinait le corps sur le TOIT de la terrasse, 32 px
 *    plus haut, le temps que l'autorité rattrape (« mon personnage fait un saut d'un étage »).
 *
 * Deux fois le même défaut, à deux endroits, parce que la règle était écrite deux fois. Le type
 * `Connecteur` en déclare d'ailleurs un troisième — `'escalier'` — que **rien ne construit
 * encore** : le jour où il naîtra, aucune de ces lois ne le connaîtrait.
 *
 * ⚠ **LA LOI NE REGARDE JAMAIS LE TYPE D'UN CONNECTEUR. Elle regarde le palier de sa TUILE.**
 * Un connecteur est posé sur la tuile d'où on l'ATTEINT : le pied d'une rampe est au palier bas
 * (`min(de, vers)`), le seuil d'une gueule est au palier de sa butte (`de`, la salle étant à
 * `vers = −(de + 1)`, G-R1). Les deux se disent d'un seul mot — `relief.palier(c.x, c.y)` — et
 * c'est ce mot-là qui rend un escalier, un pont ou une trappe gratuits. `palierDAcces` porte la
 * garde de sa propre prémisse (`strates.test.ts`) : elle vaut `min(de, vers)` sur une rampe et
 * `de` sur une gueule, sur les montages de laboratoire ET sur le monde joué.
 *
 * Pure, sans Phaser, en rangées de TUILES (pas en pixels) : `deplier-etage.ts` l'habille en
 * pixels pour se glisser à la place d'`unproject`, les couches la lisent telle quelle.
 */
import { connecteurAt, type Connecteur } from '@ashes/sim'
import { LIFT_TUILES } from './framing'
import type { Relief } from './relief'

/**
 * LE PALIER D'OÙ L'ON ATTEINT CE CONNECTEUR — celui de sa propre tuile, jamais son type.
 *
 * C'est de ce palier que son dessin se lève : `LIFT_TUILES` rangées d'écran au-dessus de lui,
 * l'entaille d'une rampe ou l'arche d'une gueule occupent la paroi.
 */
export function palierDAcces(relief: Relief, c: Connecteur): number {
  return relief.palier(c.x, c.y)
}

/**
 * LA STRATE DESSINÉE À CETTE RANGÉE D'ÉCRAN, sur cette colonne — la tuile qu'on VOIT là, et
 * l'étage auquel elle appartient.
 *
 * L'ordre est celui dans lequel l'écran est peint (les strates, `strateDEtage`), du plus haut au
 * plus bas — la première tuile qui se dessine à cette rangée est celle qu'on voit :
 *
 *  1. la tuile `ligne + h × LIFT_TUILES` a la hauteur `h` : c'est elle, à l'étage `h` ;
 *  2. un CONNECTEUR accessible depuis le palier `h − 1` se dessine sur les `LIFT_TUILES` rangées
 *     au-dessus de sa propre rangée (son tablier, au sol, étant pris par la règle 1) : ces
 *     rangées-là ne tombent sous aucune tuile de hauteur `h` — elles sont le connecteur, et
 *     l'étage qu'on y touche est celui d'où on l'atteint ;
 *  3. sinon la rangée est le sol tel quel, à la hauteur de sa propre tuile.
 *
 * ⚠ L'ambiguïté est assumée dans le même sens que le rendu : au nord d'un mur, la surface levée
 * recouvre `LIFT_TUILES` rangées de vrai sol par étage de dénivelé — on ne les voit pas, on ne
 * les vise donc pas.
 */
export function strateDessineeA(relief: Relief, tx: number, ligne: number): { ty: number; etage: number } {
  if (!relief.actif) return { ty: ligne, etage: 0 }
  const L = LIFT_TUILES
  for (let h = relief.hauteurMax; h >= 1; h--) {
    if (relief.hauteur(tx, ligne + h * L) === h) return { ty: ligne + h * L, etage: h }
    const bas = h - 1
    for (let d = L; d >= 1; d--) {
      const ty = ligne + bas * L + d
      const c = connecteurAt(relief.map, tx, ty)
      if (c !== undefined && palierDAcces(relief, c) === bas) return { ty, etage: bas }
    }
  }
  return { ty: ligne, etage: relief.hauteur(tx, ligne) }
}
