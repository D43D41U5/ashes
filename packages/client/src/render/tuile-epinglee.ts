/**
 * LA TUILE ÉPINGLÉE AU PIXEL — la couture d'un pixel au zoom fractionnaire (2026-09-02).
 *
 * Au zoom 2,25 (le 1280×720, `zoomForFraming`), toute image de tuile empilée sur sa voisine
 * laissait une LIGNE D'UN PIXEL à la couture — absente aux zooms 2 et 3. Sur une falaise un
 * fil clair, en travers de la gueule d'une cave une rayure. MESURÉ dans le vrai moteur
 * (sonde `seam4c`, SwiftShader, MSAA `antialias: true`) sur des piles témoins :
 *
 *   - deux quads unis qui se touchent à une coordonnée d'écran fractionnaire → le pixel de
 *     bord est un MÉLANGE des deux tuiles (couverture MSAA) : rien ne fuit ;
 *   - deux vraies tuiles de falaise, même géométrie → le pixel de bord vaut 92 entre 59 et 58
 *     (+0,25 px), 51 entre 61 et 59 (+0,5 px) : NI l'une ni l'autre, ni un mélange.
 *
 * La cause est dans Phaser 4 : une texture POT (16×16, 32×32…) est créée en `gl.REPEAT`
 * (`createCanvasTexture`, `pow && !noRepeat`). Or sur un pixel partiellement couvert, le
 * fragment s'évalue AU CENTRE du pixel — hors du quad — avec un UV extrapolé (v < 0 ou > 1)
 * qui, en REPEAT, retombe sur la rangée OPPOSÉE de la texture : le bas d'une tuile montre
 * sa propre rangée du haut. Aux zooms entiers, aucun bord n'est fractionnaire : rien à voir.
 *
 * Le remède : arrondir les sommets de la tuile à l'entier d'écran (`vertexRoundMode = 'full'`).
 * Aucun pixel n'est plus « à moitié » couvert, le fragment ne sort plus du quad. Comme une
 * tuile de 16 px fait 36 px d'écran (entier) à 2,25, toutes les tuiles d'une grille glissent
 * du MÊME quart de pixel : la grille reste contiguë, et le « wobble » que Phaser prête au mode
 * `full` ne touche que ce qui bouge — une tuile ne bouge pas. Le pixel de bord devient net
 * (plus de mélange) : c'est ce que veut un pixel-art.
 *
 * S'applique à ce qui est PLEIN JUSQU'AU BORD et posé sur la grille : falaises, plateaux,
 * caves, pavés, sols et murs bâtis. Un sprite à marges transparentes n'en a pas besoin (la
 * rangée opposée qu'il extrapole est vide), un objet qui bouge n'en veut pas.
 */
export function epinglerLaTuile<T extends { setVertexRoundMode(mode: string): T }>(img: T): T {
  return img.setVertexRoundMode('full')
}
