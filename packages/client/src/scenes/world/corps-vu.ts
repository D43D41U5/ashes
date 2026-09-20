/**
 * ═══ UN CORPS SE VOIT-IL DEPUIS LÀ OÙ LE REGARD SE TIENT ? (spec `grottes.md` §4, `etages.md`) ═══
 *
 * *« Depuis dehors, une cave n'existe pas à l'écran »* — et les CORPS non plus. Les structures de
 * salle se cachent à la bascule du regard (`SnapshotView.montrerLaRoche`), les nœuds suivent
 * `noeudVu` ; les sprites d'acteurs, eux, n'avaient aucune règle : un souterrain se peint dans la
 * strate 2 000 000, au-dessus de tout, et la roche qui devrait le couvrir n'est dessinée que sous
 * terre. MESURÉ le 2026-09-20 (Grotte I) : le sanglier de tanière à −2 se dessinait sur la
 * prairie à côté du joueur (101 images sur 101), et depuis la salle à −2 le sanglier d'une salle
 * voisine à −1 se dessinait dans le cadre, par-dessus la roche.
 *
 * La règle, écrite une fois et pure :
 *  - un corps AU SOL (sans étage, ou à un palier ≥ 0) se voit toujours — sous la roche, c'est la
 *    ROCHE qui le couvre par la profondeur là où elle est dessinée, et le dehors à ciel nu se voit
 *    depuis la salle (§4ter) ;
 *  - un corps SOUS LA ROCHE (étage < 0) ne se voit que si le regard est sous la roche, À SON étage.
 *
 * Elle ne dit rien de la portée ni de la visée : la visée passe par E-R5 (`atteignableDuJoueur`).
 */
export function corpsVu(etage: number | undefined, sousRoche: boolean, etageDuRegard: number): boolean {
  if (etage === undefined || etage >= 0) return true
  return sousRoche && etage === etageDuRegard
}
