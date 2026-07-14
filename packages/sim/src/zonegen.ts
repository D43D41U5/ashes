/**
 * LE TERRAIN — le graphe devient un monde.
 *
 * Ce fichier ne DÉCIDE rien : il OBÉIT au graphe (`zonegraph.ts`). C'est tout le sens du
 * renversement (spec `worldgen.md` §1) — l'ancienne vallée dérivait sa structure de son
 * terrain (un champ d'altitude concentrique, puis des bandes de biome). On dérive désormais le
 * terrain de la structure. Un plan d'abord ; des cailloux ensuite.
 *
 * ═══ LES TROIS GESTES ═══
 *
 * 1. **LA FALAISE EST LA FRONTIÈRE.** Là où deux zones se touchent, on lève un mur — pas un
 *    champ de roche amorphe, une PAROI, avec une arête. Le champ de MARGE du graphe (la
 *    distance à la frontière la plus proche) est l'outil, et `pays.ts` l'avait déjà nommé sans
 *    en tirer la conséquence : *« c'est ce champ qu'on sculpte pour lever un mur là où deux
 *    pays se touchent. »*
 *
 * 2. **LE SEUIL EST LA RAMPE.** Le couloir percé dans la falaise MONTE — en escalier, un palier
 *    à la fois. Ça rend l'invariant « on ne monte que par une rampe » (spec R3) vrai *par
 *    construction* plutôt que par vérification, et c'est très alpin : **la porte dit qu'on
 *    monte.** Un seuil qui grimpe quatre paliers depuis les Prés Bas annonce, rien qu'en se
 *    montrant, que ce qu'il y a derrière n'est pas pour aujourd'hui.
 *
 * 3. **UNE ZONE EST UNE TERRASSE.** Un palier entier, plat. L'altitude cesse d'être un flottant
 *    qu'on soulève de trois pixels (illisible, et si fragile qu'une seed sur quatre repliait
 *    l'image et faisait planter le jeu). Elle devient un ENTIER, et la verticalité se voit.
 *
 * Pur et déterministe : `hash2`/`fbm2`, et `+ - * / sqrt` uniquement (invariant n°2).
 */
import {
  TERRAINS,
  TERRAIN_ALPINE_FLOWERS,
  TERRAIN_ALPINE_MEADOW,
  TERRAIN_BOULDERS,
  TERRAIN_BURNT_FOREST,
  TERRAIN_CLIFF,
  TERRAIN_DEEP_WATER,
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_HEATH,
  TERRAIN_LARCH,
  TERRAIN_MARSH,
  TERRAIN_OLD_GROWTH,
  TERRAIN_PEAT_BOG,
  TERRAIN_PINE,
  TERRAIN_REED_MARSH,
  TERRAIN_ROCK,
  TERRAIN_SCREE,
  TERRAIN_SHALLOW_WATER,
  TERRAIN_SNOW,
} from './balance'
import type { WorldMap, Zone as ZoneRect } from './map'
import { calibreLeFront, computeCendreField } from './cendre'
import { distSq } from './geometry'
import { placePois } from './poi'
import { fbm2, hash2 } from './noise'
import {
  catalogueFrontieres,
  deriveGrapheZones,
  echantillonAt,
  MONDE,
  type GrapheZones,
} from './zonegraph'

/** Constantes de FORME — contenu de carte, en tuiles ABSOLUES. */
export const RELIEF = {
  /**
   * Épaisseur du bandeau de falaise à une frontière, en tuiles. La frontière est au MILIEU :
   * une falaise mord donc `EPAISSEUR / 2` de chaque côté.
   *
   * 44 : assez épais pour qu'on ne le franchisse jamais par accident, assez mince pour ne pas
   * dévorer la carte (douze zones, ~15 frontières → ~7 % du marchable). C'est aussi la
   * LONGUEUR d'un seuil, puisque le seuil traverse la falaise : ~44 tuiles, soit un peu plus
   * d'un écran de haut. On la parcourt en onze secondes — assez pour qu'un loup vous rattrape.
   */
  EPAISSEUR_FALAISE: 44,

  /** Demi-largeur du couloir d'un seuil. 7 → 14 tuiles de passage : une gorge, et elle tient
   *  dans la fenêtre de 35 tuiles du jeu — on VOIT ses deux parois à la fois. */
  DEMI_LARGEUR_SEUIL: 7,

  /** Le couloir déborde de la falaise, de chaque côté, pour déboucher franchement dans la zone
   *  au lieu de mourir contre sa paroi. */
  DEBORD_SEUIL: 16,

  /** Amplitude du serpentement d'un couloir de seuil — un seuil droit est un couloir de métro. */
  MEANDRE_SEUIL: 5,
  MEANDRE_ECHELLE: 30,

  /** Anneau bloquant au bord de la carte. La vallée est CLOSE : on n'en sort pas. */
  BORDURE: 12,

  /** Bruit du terrain intérieur d'une zone — la variation qui la rend vivante sans la rendre
   *  illisible (spec R7 : une zone est un thème, reconnaissable en trois secondes). */
  ECHELLE_TERRAIN: 46,
  ECHELLE_TACHES: 120,
}

/**
 * LES PALIERS — la vallée MONTE, et le palier le dit.
 *
 * `palier = base(tier) + variation`. La racine est au fond (0) ; la ceinture T1 s'élève d'un
 * ou deux crans ; les marges T2 dominent tout (3 à 5). Une zone T2 collée à la racine crée donc
 * un seuil qui grimpe **quatre paliers d'un coup** — et c'est exactement le signal qu'on veut :
 * en voyant cette gorge s'élever en escalier au-dessus de son jardin, le joueur SAIT que ce
 * n'est pas pour aujourd'hui. Aucune UI ne le lui dit ; la géographie le fait.
 */
const PALIER_BASE: Record<0 | 1 | 2, number> = { 0: 0, 1: 1, 2: 3 }
const PALIER_ETENDUE: Record<0 | 1 | 2, number> = { 0: 1, 1: 2, 2: 3 }

export function palierDe(g: GrapheZones, id: number): number {
  const z = g.zones[id]!
  const t = z.def.tier
  return PALIER_BASE[t] + Math.floor(hash2(id, g.seed, 0xa17) * PALIER_ETENDUE[t])
}

/**
 * LA PALETTE D'UNE ZONE — ce qu'on a sous les pieds, et ce qui la fait reconnaître.
 *
 * `sol` domine ; `taches` s'y sème en bosquets basse fréquence ; `accent` est rare. La zone est
 * un THÈME, pas un biome : elle peut mêler des terrains tant qu'elle se lit en trois secondes.
 *
 * RÈGLE DE SÛRETÉ, non négociable : **le sol dominant d'une zone est toujours MARCHABLE.** Une
 * zone dont le fond bloque serait une zone où le seuil débouche sur un mur — et la garde de
 * connexité (A2) le dirait, mais trop tard : on l'aurait construite.
 */
interface Palette {
  sol: number
  taches: number
  accent: number
  /** Fréquence de l'accent, [0,1]. */
  rarete: number
}

const PALETTES: Record<string, Palette> = {
  // ── T0 : la racine. Verte, ouverte, sans une pierre qui menace. ──
  pres_bas: { sol: TERRAIN_GRASS, taches: TERRAIN_FOREST, accent: TERRAIN_FLOWER_MEADOW, rarete: 0.2 },

  // ── T1 : la ceinture. Chacune enseigne une leçon différente. ──
  sylve: { sol: TERRAIN_OLD_GROWTH, taches: TERRAIN_FOREST, accent: TERRAIN_GRASS, rarete: 0.12 },
  karst: { sol: TERRAIN_SCREE, taches: TERRAIN_BOULDERS, accent: TERRAIN_ROCK, rarete: 0.14 },
  tourbiere: { sol: TERRAIN_PEAT_BOG, taches: TERRAIN_REED_MARSH, accent: TERRAIN_SHALLOW_WATER, rarete: 0.16 },
  alpages: { sol: TERRAIN_ALPINE_MEADOW, taches: TERRAIN_ALPINE_FLOWERS, accent: TERRAIN_SCREE, rarete: 0.18 },
  brule: { sol: TERRAIN_BURNT_FOREST, taches: TERRAIN_HEATH, accent: TERRAIN_BOULDERS, rarete: 0.1 },
  ruines: { sol: TERRAIN_HEATH, taches: TERRAIN_GRASS, accent: TERRAIN_BOULDERS, rarete: 0.16 },

  // ── T2 : les marges. ──
  cendriere: { sol: TERRAIN_BURNT_FOREST, taches: TERRAIN_BOULDERS, accent: TERRAIN_ROCK, rarete: 0.16 },
  glacier: { sol: TERRAIN_SNOW, taches: TERRAIN_SCREE, accent: TERRAIN_ROCK, rarete: 0.14 },
  aiguilles: { sol: TERRAIN_SCREE, taches: TERRAIN_BOULDERS, accent: TERRAIN_ROCK, rarete: 0.2 },
  gouffre: { sol: TERRAIN_BOULDERS, taches: TERRAIN_SCREE, accent: TERRAIN_ROCK, rarete: 0.18 },
  // Le Lac Mort : une eau trop claire. Le cœur est PROFOND (donc un mur — l'eau profonde ne se
  // nage pas, spec R5), et il est ceint de marais. On n'y entre pas, on en fait le tour — et
  // c'est très bien : sa case fantastique est réservée, on lui laisse sa forme.
  lac_mort: { sol: TERRAIN_MARSH, taches: TERRAIN_REED_MARSH, accent: TERRAIN_DEEP_WATER, rarete: 0.3 },
}

/** Le Névé : les hauteurs de la Tourbière et de la Sylve gardent leurs mélèzes et leurs pins —
 *  un thème n'est pas un aplat. On y reviendra à la passe d'ambiance. */
const HAUT_BOIS = [TERRAIN_PINE, TERRAIN_LARCH]

export interface CarteZonee {
  map: WorldMap
  graphe: GrapheZones
  /** Id de zone par tuile. C'est L'ÉTIQUETTE : les ressources, la faune et le climat la lisent. */
  zone: Int32Array
  /** Palier (entier) par tuile. */
  palier: Int32Array
  /** Cette tuile est-elle une rampe ? (le couloir d'un seuil) — l'exemption de l'invariant R3. */
  rampe: Uint8Array
}

/**
 * LA GÉNÉRATION. Un balayage, trois passes, et rien qui remonte le temps.
 */
export function generateZonedTerrain(seed: number, joueurs = MONDE.JOUEURS_CIBLE): CarteZonee {
  const g = deriveGrapheZones(seed, joueurs)
  const { width, height } = g
  const N = width * height

  const terrain = new Array<number>(N).fill(TERRAIN_GRASS)
  const zone = new Int32Array(N)
  const palier = new Int32Array(N)
  const rampe = new Uint8Array(N)
  const paliers = g.zones.map((z) => palierDe(g, z.id))

  // ── PASSE 1 : les zones, les falaises, et le sol de chacune ───────────────
  const demi = RELIEF.EPAISSEUR_FALAISE / 2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const e = echantillonAt(g, x, y)
      zone[i] = e.zone
      palier[i] = paliers[e.zone]!

      if (e.marge < demi) {
        // LA FALAISE. On ne la lisse pas au bruit : une paroi a une ARÊTE, et c'est l'arête
        // qu'on suit pour trouver la porte. Un bord flou serait un bord qu'on ne peut pas
        // longer — exactement le défaut des anciens murs de roche.
        terrain[i] = TERRAIN_CLIFF
        continue
      }
      terrain[i] = solDe(g, e.zone, x, y)
    }
  }

  // ── PASSE 2 : les seuils — on perce, et ça MONTE ──────────────────────────
  for (const s of g.seuils) {
    percerSeuil(g, s, terrain, zone, palier, rampe, paliers, width, height)
  }

  // ── PASSE 3 : l'anneau de bordure. La vallée est CLOSE ────────────────────
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= RELIEF.BORDURE && y >= RELIEF.BORDURE && x < width - RELIEF.BORDURE && y < height - RELIEF.BORDURE) {
        continue
      }
      const i = y * width + x
      terrain[i] = TERRAIN_CLIFF
      rampe[i] = 0
    }
  }

  /**
   * L'ALTITUDE, DÉRIVÉE DU PALIER — et elle survit exprès.
   *
   * Le champ continu est mort comme objet de RENDU (le faux-relief est abrogé : il était
   * illisible et il faisait planter une seed sur quatre). Mais il reste une SÉMANTIQUE : « on est
   * haut » veut dire quelque chose pour la température (il fait froid en altitude), pour la
   * neige, pour la faune. On le redonne donc à la carte, dérivé du palier : `palier / PALIER_MAX`.
   *
   * Ça évite une réécriture inutile de `temperature.ts` — et surtout, ça garde la vérité en UN
   * seul endroit : l'altitude n'est plus un champ indépendant qui pourrait diverger du terrain,
   * c'est une LECTURE du palier.
   */
  const elevation = new Array<number>(N)
  for (let i = 0; i < N; i++) elevation[i] = palier[i]! / PALIER_MAX

  /**
   * LE CHAMP DE CENDRE — la distance de chaque tuile à la frontière de la Cendrière.
   *
   * On le dérive du diagramme de puissance, exactement comme la marge des frontières : `puissance
   * = distance² − poids`, et l'écart de puissance entre deux sites, divisé par `2 × d(sites)`, EST
   * une distance en tuiles. Le front épouse donc la **forme réelle** de la Cendrière — frontière
   * tordue par le bruit comprise. Il avance comme une MARÉE, pas comme une explosion.
   *
   * C'est de la donnée STATIQUE : ce qui bouge est un scalaire dans le `SimState` (spec R31).
   */
  const cendriere = g.zones.find((z) => z.def.slug === 'cendriere')!
  const champCendre = computeCendreField(width, height, (x, y) => {
    const e = echantillonAt(g, x, y)
    if (e.zone === cendriere.id) return -e.marge // DEDANS : elle brûle depuis le premier jour
    // Dehors : la distance à la frontière de la Cendrière. Si la tuile ne la touche pas, on prend
    // la distance à son propriétaire PLUS ce qui reste à traverser — une borne inférieure honnête,
    // et le front s'arrêtera de toute façon bien avant les zones lointaines.
    if (e.voisin === cendriere.id) return e.marge
    const d = Math.sqrt(distSq(x, y, cendriere.x, cendriere.y))
    return d // très au-delà du front : la valeur exacte ne sert à rien, seul l'ordre compte
  })

  // On vise une PART des Prés Bas (60 %), pas une distance : la forme des zones varie trop d'une
  // seed à l'autre pour qu'un nombre de tuiles fixe tienne la promesse. On calibre donc ICI.
  const cendreMax = calibreLeFront(champCendre, (i) => zone[i] === g.racine && rampe[i] === 0)

  const map: WorldMap = {
    width, height, terrain, zones: toponymes(g), elevation, cendre: champCendre, cendreMax,
  }
  const carte: CarteZonee = { map, graphe: g, zone, palier, rampe }

  // ── PASSE 4 : LES LIEUX — et ils ont désormais une ADRESSE ────────────────
  // La Grotte au Karst, le Champ de crevasses au Glacier, l'Arbre remarquable dans la Vieille
  // Sylve. `poi.ts` ne connaît pas le graphe de zones : il reçoit un accesseur, rien de plus.
  placePois(map, seed, (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return undefined
    return g.zones[zone[ty * width + tx]!]!.def.slug
  })

  return carte
}

/** Le palier le plus haut que la table puisse produire — le diviseur de l'altitude dérivée. */
export const PALIER_MAX = PALIER_BASE[2] + PALIER_ETENDUE[2] - 1 // 3 + 3 − 1 = 5

/** Le sol d'une tuile dans sa zone : le thème, semé de bosquets et d'accents. */
function solDe(g: GrapheZones, id: number, x: number, y: number): number {
  const z = g.zones[id]!
  const p = PALETTES[z.def.slug]!
  const n = fbm2(x, y, RELIEF.ECHELLE_TERRAIN, (g.seed ^ (id * 0x9e37)) | 0)
  const t = fbm2(x, y, RELIEF.ECHELLE_TACHES, (g.seed ^ (id * 0x2545)) | 0)

  if (n < p.rarete) return p.accent
  if (t > 0.58) {
    // Les BOSQUETS. Dans les zones hautes, le bois qui pousse est un pin ou un mélèze — un
    // thème n'est pas un aplat.
    if (p.taches === TERRAIN_FOREST && z.def.tier > 0) {
      return HAUT_BOIS[Math.floor(hash2(x, y, g.seed ^ 0x5b) * HAUT_BOIS.length)]!
    }
    return p.taches
  }
  return p.sol
}

/**
 * PERCER UN SEUIL — et il MONTE.
 *
 * Le couloir traverse la falaise perpendiculairement à la frontière (c'est-à-dire dans l'axe
 * des deux sites), sur `ÉPAISSEUR + 2 × DÉBORD` tuiles. Il **serpente** : un seuil droit est un
 * couloir de métro, et on ne veut pas voir la sortie depuis l'entrée.
 *
 * ET C'EST UN ESCALIER. Le palier passe de celui de la zone `a` à celui de la zone `b`, **une
 * marche à la fois**, réparties le long du couloir. Chaque marche est une rampe. L'invariant
 * « une rampe ne relie que deux paliers consécutifs » (spec R3) devient donc vrai *par
 * construction*, et non par vérification — et un seuil qui grimpe quatre paliers ANNONCE, rien
 * qu'en se montrant, ce qui l'attend derrière.
 *
 * Toutes les tuiles du couloir sont marquées `rampe` : c'est ce qui les exempte de la règle
 * « pas de saut de palier entre deux marchables voisines », qu'elles violent par métier.
 */
function percerSeuil(
  g: GrapheZones,
  s: { a: number; b: number; x: number; y: number },
  terrain: number[],
  zone: Int32Array,
  palier: Int32Array,
  rampe: Uint8Array,
  paliers: number[],
  width: number,
  height: number,
): void {
  // ON PERCE ENTRE DEUX POINTS DE SOL RÉEL, PAS DANS UNE DIRECTION THÉORIQUE.
  //
  // LA FAUTE DE LA PREMIÈRE ÉCRITURE : le couloir était creusé dans l'AXE DES DEUX SITES, sur
  // une longueur fixe (épaisseur de la falaise + débord). C'est juste au milieu de la
  // frontière — et faux partout ailleurs. Car le seuil est posé n'importe où sur une frontière
  // **qui serpente** : loin de l'axe des sites, la normale à la falaise n'est plus cette
  // direction-là. Le couloir traversait donc le mur **en biais**, la longueur ne suffisait plus,
  // et il mourait DANS la paroi. Mesuré : la Tourbière de la seed 2026 était injoignable.
  //
  // On cherche donc, de part et d'autre du seuil, la première tuile de SOL de chaque zone — et
  // on creuse de l'une à l'autre. Le couloir débouche alors par construction, quelle que soit
  // l'orientation de la frontière à cet endroit.
  const A = solLePlusProche(s, s.a, terrain, zone, width, height)
  const B = solLePlusProche(s, s.b, terrain, zone, width, height)
  if (!A || !B) return

  let dx = B.x - A.x
  let dy = B.y - A.y
  const brut = Math.sqrt(dx * dx + dy * dy)
  if (brut < 1) return
  dx /= brut
  dy /= brut
  const px = -dy // la perpendiculaire : l'épaisseur du couloir, et le méandre
  const py = dx

  const pa = paliers[s.a]!
  const pb = paliers[s.b]!
  const marches = Math.abs(pb - pa)
  const sens = pb > pa ? 1 : -1

  // Le couloir DÉBORDE dans les deux zones. Sans ce débord, il s'arrête pile sur la première
  // tuile de sol venue — qui peut être un caillou isolé au pied de la paroi, sans lien avec le
  // corps de la zone. Seize tuiles de mieux, et il débouche dans le VRAI pays.
  const d0 = -RELIEF.DEBORD_SEUIL
  const d1 = brut + RELIEF.DEBORD_SEUIL
  const len = d1 - d0

  for (let t = d0; t <= d1; t += 0.5) {
    // Le méandre : le couloir serpente. Un seuil droit est un couloir de métro — on ne doit pas
    // voir la sortie depuis l'entrée. Il s'annule aux deux BOUTS (le facteur `bord`).
    const u = (t - d0) / len
    const bord = Math.min(1, Math.min(u, 1 - u) * 6)
    const m = bord * RELIEF.MEANDRE_SEUIL *
      (fbm2(A.x + t * dx, A.y + t * dy, RELIEF.MEANDRE_ECHELLE, (g.seed ^ 0x5e17) | 0) * 2 - 1)
    const cx = A.x + dx * t + px * m
    const cy = A.y + dy * t + py * m

    // L'ESCALIER. Les marches se répartissent sur la longueur du couloir ; les deux bouts
    // raccordent EXACTEMENT les paliers des deux zones — donc aucune marche ne traîne au bord.
    const marche = marches === 0 ? 0 : Math.min(marches, Math.floor(u * (marches + 1)))
    const pal = pa + sens * marche

    for (let w = -RELIEF.DEMI_LARGEUR_SEUIL; w <= RELIEF.DEMI_LARGEUR_SEUIL; w += 0.5) {
      const x = Math.round(cx + px * w)
      const y = Math.round(cy + py * w)
      if (x < RELIEF.BORDURE || y < RELIEF.BORDURE || x >= width - RELIEF.BORDURE || y >= height - RELIEF.BORDURE) {
        continue
      }
      const i = y * width + x

      // ON DÉGAGE TOUT CE QUI BLOQUE — pas seulement la falaise.
      //
      // LA FAUTE DE LA DEUXIÈME ÉCRITURE, et elle était sournoise : on ne repeignait que les
      // tuiles de FALAISE. Un rocher (l'accent bloquant d'une zone) tombé au milieu du passage
      // restait donc en place et **bouchait la porte** — mesuré : le Glacier de la seed 42
      // était injoignable, alors que le couloir était bel et bien creusé. **Une porte est une
      // porte** : ce qui la traverse est franchissable, sans exception.
      if (TERRAINS[terrain[i]!]?.walkable !== true) {
        // Le sol du couloir est celui de la zone vers laquelle on va : **la porte a déjà la
        // couleur de ce qu'elle garde.** On voit ce qui attend avant d'y être (spec R10.2).
        const vers = u < 0.5 ? s.a : s.b
        terrain[i] = solMarchableDe(g, vers, x, y)
        zone[i] = vers
      }
      // La RAMPE couvre tout le couloir : c'est elle qui PORTE le saut de palier, et c'est elle
      // qui l'exempte de l'invariant « on ne monte que par une rampe ».
      palier[i] = pal
      rampe[i] = 1
    }
  }
}

/** Le sol d'une zone, mais GARANTI marchable : dans un couloir de seuil, l'accent bloquant
 *  d'une zone (le rocher, l'eau profonde) n'a rien à faire — il boucherait la porte. */
function solMarchableDe(g: GrapheZones, id: number, x: number, y: number): number {
  const t = solDe(g, id, x, y)
  if (TERRAINS[t]?.walkable === true) return t
  return PALETTES[g.zones[id]!.def.slug]!.sol
}

/**
 * La première tuile de SOL de la zone `id`, en partant du seuil — une spirale carrée qui
 * s'élargit. C'est ce qui garantit qu'un couloir DÉBOUCHE : on ne vise pas une direction, on
 * vise une tuile où l'on peut poser le pied.
 */
function solLePlusProche(
  s: { x: number; y: number },
  id: number,
  terrain: number[],
  zone: Int32Array,
  width: number,
  height: number,
): { x: number; y: number } | null {
  for (let r = 1; r < 160; r++) {
    let best: { x: number; y: number } | null = null
    let bestD = Infinity
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Seulement l'anneau : l'intérieur a déjà été vu aux rayons précédents.
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
        const x = s.x + dx
        const y = s.y + dy
        if (x < RELIEF.BORDURE || y < RELIEF.BORDURE || x >= width - RELIEF.BORDURE || y >= height - RELIEF.BORDURE) {
          continue
        }
        const i = y * width + x
        if (zone[i] !== id || terrain[i] === TERRAIN_CLIFF) continue
        const d = dx * dx + dy * dy
        // Départage par distance puis par coordonnées : déterministe.
        if (d < bestD) { bestD = d; best = { x, y } }
      }
    }
    if (best) return best
  }
  return null
}

/**
 * LES TOPONYMES — de PETITES étiquettes au cœur de chaque zone, pas des rectangles qui la
 * couvriraient. `zoneAt` rend la PREMIÈRE zone contenant le point : une étiquette à la taille
 * du pays masquerait tous les lieux qu'il contient (on survolerait une Grotte et on lirait
 * « le Karst »). Un nom de zone est une étiquette d'état-major, posée en son centre.
 *
 * Et les SEUILS en portent un aussi : ils ont un nom, et ils se montrent.
 */
function toponymes(g: GrapheZones): ZoneRect[] {
  const out: ZoneRect[] = []
  const r = 7
  for (const z of g.zones) {
    out.push({
      name: z.def.nom,
      x: Math.max(0, Math.min(g.width - 2 * r - 1, Math.round(z.x) - r)),
      y: Math.max(0, Math.min(g.height - 2 * r - 1, Math.round(z.y) - r)),
      w: 2 * r + 1,
      h: 2 * r + 1,
    })
  }
  const rs = 5
  for (const s of g.seuils) {
    const vers = g.zones[s.b]!
    out.push({
      name: s.secours ? `l'autre passage vers ${vers.def.nom}` : `le seuil de ${vers.def.nom}`,
      x: Math.max(0, Math.min(g.width - 2 * rs - 1, s.x - rs)),
      y: Math.max(0, Math.min(g.height - 2 * rs - 1, s.y - rs)),
      w: 2 * rs + 1,
      h: 2 * rs + 1,
    })
  }
  return out
}

/** Le catalogue des frontières, réexporté : les tests destructifs en ont besoin pour reboucher
 *  les seuils et vérifier qu'une zone devient bien une île (A5). */
export { catalogueFrontieres, deriveGrapheZones }
