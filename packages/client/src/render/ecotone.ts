/**
 * LA LISIÈRE — une frontière de zone s'ANNONCE au lieu de se heurter (spec worldgen R21).
 *
 * Aujourd'hui une frontière est un mur binaire d'UNE tuile : la Vieille Sylve s'arrête net
 * contre la falaise, le Karst commence net de l'autre côté. Il n'y a nulle part une « bordure
 * de forêt qui s'éclaircit », un « éboulis qui annonce la pierre ». Le monde est un damier de
 * pays scellés, et R21 est restée une promesse de spec.
 *
 * CE MODULE NE TOUCHE PAS AU TERRAIN — et c'est un choix, pas une facilité. Teindre le sol
 * d'une lisière en changeant les TUILES ferait bouger l'admission des nœuds (`terrainAdmet`),
 * l'habitat de la faune et les emplacements de village : la géométrie EST l'entrée de ces
 * systèmes, on ne peut pas l'isoler. Or l'identité des zones, dans ce jeu, repose aujourd'hui
 * ENTIÈREMENT sur la couleur (le relief a été retiré au pivot RimWorld). Le dégradé de teinte
 * EST donc la lisière, dans le langage visuel actuel — et il s'obtient côté client, au bake,
 * pour un risque de déterminisme rigoureusement nul.
 *
 * LE CHAMP EST CALCULÉ À LA MAILLE DE LA GRILLE DE ZONES (pas de 16 tuiles), pas à la tuile :
 * un BFS multi-source sur ~10 000 cellules au lieu de 2,5 millions de tuiles. La granularité
 * grossière qui en résulte serait visible en bandes de 16 tuiles — c'est le bruit de dithering,
 * appliqué par le consommateur, qui la casse en bord tramé. C'est aussi la grammaire du jeu :
 * du pixel franc, pas un dégradé lissé.
 */

/**
 * PORTÉE de la lisière, EN CELLULES de la grille de zones (donc × 16 tuiles). 3 → une bande
 * d'environ 48 tuiles : assez large pour qu'on la traverse et qu'on la sente venir, assez
 * courte pour que le cœur du pays reste franchement lui-même. Calibration, à régler à l'œil.
 */
export const LISIERE_PORTEE = 3

/**
 * DÉRIVE MAXIMALE contre la couture : la fraction de la modulation du pays d'en face qu'on
 * mélange à la sienne. 0,32 ANNONCE le voisin sans confondre les deux pays — au-delà, les
 * zones se brouillent et on perd ce que la lisière était censée servir : la lisibilité.
 */
export const LISIERE_MAX = 0.32

/** Le champ de lisière, à la maille de la grille de zones. */
export interface ChampLisiere {
  /** Par cellule : l'id de la zone d'en face la plus proche, ou -1 si la cellule est au cœur. */
  voisin: Int32Array
  /** Par cellule : distance EN CELLULES jusqu'à cette voisine. `portee` si hors d'atteinte. */
  dist: Int32Array
  cols: number
  rows: number
  /** La portée retenue, en cellules — au-delà, on est au cœur d'un pays. */
  portee: number
}

/**
 * Le champ des lisières : pour chaque cellule, à quelle distance est la zone d'en face la plus
 * proche, et laquelle. BFS multi-source depuis toutes les cellules qui TOUCHENT déjà une autre
 * zone — donc une seule passe, quel que soit le nombre de zones.
 *
 * `portee` borne la propagation : au-delà, on est au cœur et la lisière ne dit plus rien.
 */
export function champLisiere(
  zoneGrid: readonly number[],
  cols: number,
  rows: number,
  portee: number,
): ChampLisiere {
  const n = cols * rows
  const voisin = new Int32Array(n).fill(-1)
  const dist = new Int32Array(n).fill(portee)
  const file: number[] = []

  // Amorce : toute cellule dont un voisin de grille appartient à une AUTRE zone est à distance 0.
  // On retient l'id d'en face — c'est vers cette palette que la teinte dérivera.
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const i = gy * cols + gx
      const z = zoneGrid[i]
      if (z === undefined) continue
      let autre = -1
      if (gx > 0 && zoneGrid[i - 1] !== z) autre = zoneGrid[i - 1]!
      else if (gx + 1 < cols && zoneGrid[i + 1] !== z) autre = zoneGrid[i + 1]!
      else if (gy > 0 && zoneGrid[i - cols] !== z) autre = zoneGrid[i - cols]!
      else if (gy + 1 < rows && zoneGrid[i + cols] !== z) autre = zoneGrid[i + cols]!
      if (autre >= 0) {
        dist[i] = 0
        voisin[i] = autre
        file.push(i)
      }
    }
  }

  // Propagation. On ne franchit JAMAIS une frontière de zone : une lisière appartient au pays
  // qui la porte, et dérive vers son vis-à-vis — pas vers un pays qu'on n'a pas encore atteint.
  for (let h = 0; h < file.length; h++) {
    const i = file[h]!
    const d = dist[i]!
    if (d + 1 >= portee) continue
    const gx = i % cols
    const gy = (i - gx) / cols
    const z = zoneGrid[i]
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = gx + dx
      const ny = gy + dy
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
      const j = ny * cols + nx
      if (zoneGrid[j] !== z) continue // on reste chez soi
      if (dist[j]! <= d + 1) continue
      dist[j] = d + 1
      voisin[j] = voisin[i]!
      file.push(j)
    }
  }

  return { voisin, dist, cols, rows, portee }
}

/**
 * Le POIDS de dérive d'une cellule : 0 au cœur du pays, `max` contre la frontière.
 *
 * Rendu volontairement LINÉAIRE : le consommateur y ajoute son grain, et c'est ce grain qui
 * fait la texture. Un lissage ici ne ferait que rendre la bande de 16 tuiles plus douce — donc
 * plus visible en tant que bande.
 */
export function poidsLisiere(champ: ChampLisiere, cellule: number, max: number): number {
  const d = champ.dist[cellule]
  if (d === undefined || d >= champ.portee) return 0
  return (1 - d / champ.portee) * max
}
