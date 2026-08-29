/**
 * Rendu du décor cosmétique : sprites POOLÉS, culled à la vue caméra, avec LOD
 * (coupé quand on dézoome trop). Purement visuel — aucune collision (INV-1).
 * La décision « quel prop sur quelle tuile » vit dans render/clutter.ts (pur) ;
 * ici on ne fait que du pooling Phaser et du placement.
 */
import Phaser from 'phaser'
import { poiClearings, VENT, type Structure, type WorldMap } from '@ashes/sim'
import { clutterDepth, GROUND_PROP_DEPTH, TILE_PX } from '../../render/framing'
import { PROP_ASPECT, type PropKind, type SampleTerrain } from '../../render/clutter'
import { MemoireDuDecor } from '../../render/clutter-memo'
import { terrainCendre } from '@ashes/sim'
import { contexteDesButtes, type ButteContexte } from '../../render/buttes'
import { teinteTouffe } from '../../render/clutter-teinte'
import { TERRAIN_COLORS } from '../../render/terrain-colors'
import { CRAN_SAISON, cranDeSaison, teinteDuTerrain, teinter } from '../../render/teinte-saison'
import { LIT_CLUTTER_KINDS, litClutterTextureKey, VARIANT_COUNTS, variantBase } from '../../render/lit-props'
import { SHADOW_PROPS, SHADOW_PROP_GAP, SHADOW_PROP_GAP_LIT, SHADOW_PROP_WIDTH } from '../../render/prop-shadows'
import { windStretch, windSway, WIND_TAKE } from '../../render/wind'
import { TransitionsFlore, retardDe } from '../../render/flore-gel'
import { enFleur } from '../../render/flore-especes'
import type { Warp } from '../../render/warp'
import { createContactShadow, positionShadow } from './contact-shadow'

const CLUTTER_MIN_ZOOM = 1.2 // en-deçà, on coupe le décor (props illisibles) : le canopy prend le relais
/** Props RAMPANTS : des textures de sol, sans hauteur. Ils restent sous la bande
 * de tri — un caillou ne doit pas recouvrir les pieds de qui passe au nord. */
const FLAT_PROPS = new Set<PropKind>(['pebbles', 'lichen', 'sphagnum', 'poussiere'])
/** Le BÂTI qui gomme le décor de SA tuile (décision d'Alexis) : mur, porte, sol,
 *  toit. Un plancher est net, un mur sans fougère qui le traverse. Le feu, les
 *  composants (four, enclume) et le coffre, eux, se posent dans l'herbe : elle reste. */
const DECOR_CLEARING_STRUCTURES = new Set(['wall', 'palissade', 'door', 'floor', 'roof', 'massif', 'roc'])
const CLUTTER_TINT = 0xbfc4bd // léger assombrissement/désaturation (INV-2)
/** LA TOUFFE PREND LA GAMME DE SON BIOME (demande d'Alexis, 2026-07-29) — une teinte par terrain,
 *  dérivée de la palette de sol (`render/clutter-teinte.ts`). Mémoïsée : la règle est une
 *  conversion TSV, on ne la rejoue pas 4 000 fois par frame. Un terrain sans couleur connue
 *  retombe sur la teinte commune. */
const TEINTE_TOUFFE = new Map<number, number>()
/**
 * ⚠ LA CLÉ PORTE LA SAISON (spec `saisons.md` S17), par CRANS. La teinte saisonnière est
 * continue, mais la mémoïsation ne peut pas l'être : une clé au jour près ferait soixante fois
 * plus d'entrées pour un écart invisible, et une teinte recalculée par touffe et par frame
 * paierait la conversion TSV quatre mille fois.
 *
 * ⚠ **LE CRAN NE VIT PLUS ICI.** Il est né dans ce fichier, où il ne commandait qu'une
 * mémoïsation ; il commande aujourd'hui la CUISSON du sol et des cimes (S19), et les trois
 * doivent tourner à la même date — sinon le décor porte l'automne pendant que le sol porte
 * encore l'été, deux jours durant. Une seule écriture : `teinte-saison.ts`.
 *
 * ⚠ **ET LA CLÉ TENAIT SUR QUATRE BITS** (`terrain * 16 + cran`) : elle marchait à douze crans
 * et se serait mise à COLLISIONNER en silence à soixante — deux terrains voisins partageant une
 * teinte, sans qu'aucun test ne le dise. Elle est élargie, avec une garde qui l'affirme.
 */
const CRANS_PAR_AN = 120 / CRAN_SAISON
function teinteDeLaTouffe(terrain: number, jour: number): number {
  const cran = cranDeSaison(jour)
  const cle = terrain * CRANS_PAR_AN + cran
  let t = TEINTE_TOUFFE.get(cle)
  if (t === undefined) {
    const sol = TERRAIN_COLORS[terrain]
    const nue = sol === undefined ? CLUTTER_TINT : teinteTouffe(sol)
    // Le vivant tourne avec l'année, le reste non — `teinteDuTerrain` rend l'identité sur la
    // roche et l'eau, donc la touffe d'un éboulis garde sa couleur toute l'année.
    t = teinter(nue, teinteDuTerrain(terrain, cran * CRAN_SAISON + 1))
    TEINTE_TOUFFE.set(cle, t)
  }
  return t
}
const MARGIN_TILES = 2 // marge de culling pour éviter le pop en bordure d'écran
/** CE QUI DISPARAÎT SOUS LE GEL (spec `flore-froid.md` F8 révisée, demande d'Alexis 2026-08-22) :
 *  l'herbacé — brins et fleurs. Le roseau sec, le lichen, la sphaigne, le buisson ligneux et la
 *  pierre restent : l'hiver ne les efface pas. */
const FLORE_GELIVE = new Set<PropKind>(['grass_tuft', 'flower'])
const MAX_SPRITES = 4000 // borne dure de perf (cap silencieux : on log si dépassé)


export class ClutterLayer {
  private readonly pool: Phaser.GameObjects.Image[] = []
  /** La teinte RÉELLEMENT posée sur chaque sprite du pool — pour n'appeler `setTint` qu'au
   *  changement (le décor d'un même biome garde la sienne d'une frame à l'autre). */
  private readonly poolTint: number[] = []
  /** LA TEXTURE réellement posée sur chaque sprite du pool — même patron que `poolTint`, et
   *  pour la même raison : un `setTexture` réarme la frame, invalide le crop et retouche le
   *  batch, alors qu'un sprite poolé garde très généralement la sienne d'une image à l'autre
   *  (la fenêtre glisse, elle ne se réattribue pas). */
  private readonly poolTex: string[] = []
  /** Pool d'ombres de contact — POOL SÉPARÉ, servi par son PROPRE compteur (`shadowsUsed`), car
   *  tous les props n'en portent pas (cf. `SHADOW_PROPS`) : un caillou entre deux buissons
   *  désynchroniserait un index partagé et laisserait une ombre orpheline allumée. */
  private readonly shadowPool: Phaser.GameObjects.Image[] = []
  private readonly sample: SampleTerrain
  /** Les clairières des lieux — MÊME fonction que celle qui bannit les nœuds côté
   *  sim (`poiClearings`). Une source unique : deux calculs divergents feraient
   *  pousser des touffes dans une clairière vide d'arbres. */
  private readonly cleared: Set<number>
  /** Les tuiles portant un mur/sol/porte/toit — le décor y est gommé (voir
   *  `DECOR_CLEARING_STRUCTURES`). Rafraîchi par `setBarriers` à chaque snapshot,
   *  car on bâtit et on démolit en jeu : c'est un état vivant, pas figé à la génération. */
  private barriers: Set<number> = new Set()
  /** Les tuiles de coulée (forêts-vivantes §4) : la terre battue ne porte pas de décor. */
  private coulees: Set<number> = new Set()
  /** Le CONTEXTE des buttes d'affleurement (§2sexies) — cœur/sommet/frange par tuile, dérivé
   *  de `map.affleurements` une fois à l'amorce. Vide sur une carte sans buttes : coût nul. */
  private readonly buttes: Map<number, ButteContexte>
  /** Le décor retenu à la tuile — voir `render/clutter-memo.ts` : c'est là que vivent la
   *  raison, la borne et la règle d'invalidation (le terrain change quand la cendre arrive). */
  private readonly memoire: MemoireDuDecor
  private warned = false

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
    private readonly seed: number,
    private readonly warp: Warp,
  ) {
    this.sample = (tx, ty) => {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return -1
      return map.terrain[ty * map.width + tx] ?? -1
    }
    this.memoire = new MemoireDuDecor(seed, this.sample)
    this.cleared = poiClearings(map)
    this.coulees = new Set((map.coulees ?? []).filter((i) => i >= 0))
    this.buttes = contexteDesButtes(map)
  }

  /** LE VENT DE LA SIM (spec chasse C17) : les herbes se couchent dans SON sens —
   *  c'est ce qui rend la règle de l'odorat lisible sans une seule ligne d'UI. */
  wind: { x: number; y: number } = { x: 1, y: 0 }
  /** La FORCE du vent de la sim (`state.windForce`) : les brins plient d'autant plus qu'il
   *  souffle fort. `VENT.AMBIANT` par défaut — le décor d'avant, inchangé. */
  windForce: number = VENT.AMBIANT

  /** LA VÉGÉTATION FRÔLÉE (spec eau-vivante R16) : les marcheurs de la frame, chacun avec
   *  sa FORCE (1 en marche, fond en ~0,5 s après l'arrêt — l'enveloppe des waders : le brin
   *  se REDRESSE, il ne claque pas). Un brin à moins d'une tuile s'écarte du passage,
   *  roseaux de la berge comme herbe du pré — on traverse la végétation, elle le sait. */
  agitateurs: { x: number; y: number; force: number }[] = []

  /** Éclairage dynamique (couche 1) — le rendu par défaut : le décor est éclairé par le
   *  LightsManager (normale plate) — la lumière module son albédo peint sans le déformer.
   *  Piloté par WorldScene (armé sauf coupure via le panneau debug DEV). */
  lighting = false

  /** LE BÂTI GOMME LE DÉCOR (décision d'Alexis) : mur/sol/porte/toit effacent le
   *  décor cosmétique de leur tuile ; feu, composants et coffre le laissent. Appelé
   *  au fil des snapshots — pose comme démolition rouvrent la tuile au décor. */
  setBarriers(structures: readonly Structure[]): void {
    this.barriers.clear()
    for (const s of structures) {
      if (DECOR_CLEARING_STRUCTURES.has(s.type)) this.barriers.add(s.ty * this.map.width + s.tx)
    }
  }

  /** La flore de cette tuile est-elle gelée ? Posé par WorldScene sur la couche du gel
   *  (`GelLayer.floreGeleeAt` : une lecture de signature). Absent : rien ne gèle. */
  floreGeleeAt: ((tx: number, ty: number) => boolean | null) | null = null
  /** La hauteur de neige en un point, continue dans [0, 2] (`GelLayer.hauteurNeige`). */
  hauteurNeigeAt: ((x: number, y: number) => number) | null = null
  /** La gerbe de givre (ou de sève au dégel) — `RecolteFx.givre`, posée par WorldScene. */
  onGivre: ((x: number, y: number, hauteur: number, now: number, graine: number, degel: boolean) => void) | null = null
  /** Les bascules gel/dégel du fouillis, par tuile (voir `render/flore-gel.ts`). */
  private readonly transitions = new TransitionsFlore()
  /** LE JOUR DE SAISON, posé par `WorldScene` — la touffe prend la couleur de son année
   *  (S17). Un jour par défaut plutôt qu'un `null` : la couche doit savoir peindre avant
   *  d'avoir reçu son premier snapshot. */
  jourDeLAnnee = 1
  /** Vrai dès que `jourDeLAnnee` vient d'un VRAI snapshot. Les fenêtres de floraison ne
   *  s'arment qu'alors : juger le défaut (jour 1, l'Éclosion) inscrirait de fausses bascules,
   *  rejouées en gestes à l'arrivée du vrai jour. La teinte, elle, peut se tromper une image
   *  sans mémoire — pas la transition. */
  jourConnu = false

  /** Posé par `WorldScene` : « cette tuile est-elle cendrée ? », la fonction de /sim, pas une
   *  copie. Absente tant que la carte n'a pas de champ de cendre — rien ne se tait alors. */
  tuileCendree: ((tx: number, ty: number) => boolean) | null = null
  /** « Y a-t-il une fumerolle sur CETTE tuile ? » — la fonction de /sim, pas une copie. */
  fumerolleIci: ((tx: number, ty: number) => boolean) | null = null
  /** LE CAP DE LA SIM, par crans de 45° — celui le long duquel l'ONDE se propage (`windSway`).
   *  `wind`, lui, porte le cap RALLIÉ : c'est l'assiette. Voir l'en-tête de `windSway`. */
  ventSim: { x: number; y: number } = { x: 1, y: 0 }

  update(camera: Phaser.Cameras.Scene2D.Camera, now: number): void {
    let used = 0
    let shadowsUsed = 0
    this.transitions.image()
    if (camera.zoom >= CLUTTER_MIN_ZOOM) {
      const v = camera.worldView
      const x0 = Math.max(0, Math.floor(v.x / TILE_PX) - MARGIN_TILES)
      const y0 = Math.max(0, Math.floor(v.y / TILE_PX) - MARGIN_TILES)
      const x1 = Math.min(this.map.width - 1, Math.ceil((v.x + v.width) / TILE_PX) + MARGIN_TILES)
      // Carte plate : plus de lift, donc une simple marge de pop symétrique suffit.
      const y1 = Math.min(
        this.map.height - 1,
        Math.ceil((v.y + v.height) / TILE_PX) + MARGIN_TILES,
      )
      for (let ty = y0; ty <= y1 && used < MAX_SPRITES; ty++) {
        for (let tx = x0; tx <= x1 && used < MAX_SPRITES; tx++) {
          const idx = ty * this.map.width + tx
          if (this.cleared.has(idx)) continue // la clairière d'un lieu : rien n'y pousse
          if (this.barriers.has(idx)) continue // un mur/sol posé ici : la tuile est nette
          if (this.coulees.has(idx)) continue // la terre battue d'une coulée : le pas a tout usé
          // ═══ LA CENDRE CHANGE LE DÉCOR, ELLE NE L'EFFACE PAS (spec `cendre.md` R11/R15) ═══
          //
          // Le sol n'est PAS muté (tout se dérive) : on convertit donc l'id ici, pour cette
          // lecture seulement, et `clutterAt` fait le reste avec la table des cendres. Ce qui
          // pousse s'en va — plus une touffe, plus un buisson —, ce qui a brûlé reste : chicots,
          // fûts calcinés, poussière.
          //
          // ⚠ La première version TAISAIT tout : le sol devenait parfaitement lisse au milieu d'un
          //   monde dense, ce qui se lit comme un bug d'affichage, pas comme une terre morte.
          const brut = this.map.terrain[idx] ?? -1
          const cendree = this.tuileCendree?.(tx, ty) === true
          const terrain = cendree ? (terrainCendre(brut) ?? brut) : brut
          // ⚠ LA FUMEROLLE N'EST PAS DU DÉCOR : c'est un NŒUD (on y récolte du sel), donc
          //   `SnapshotView` la dessine. On se contente de TAIRE le décor de sa tuile — un chicot
          //   planté dans le trou n'aurait aucun sens, et les deux sprites se superposaient.
          if (cendree && this.fumerolleIci?.(tx, ty)) continue
          // LE DÉCOR DE CETTE TUILE, RETENU (`clutter-memo.ts`) : pure fonction du terrain,
          // rejouée pour rien soixante fois par seconde. Elle se recalcule quand le TERRAIN
          // change — c'est-à-dire quand la cendre arrive —, et pas autrement.
          const props = this.memoire.props(idx, tx, ty, terrain, this.map.profondeur?.[idx] ?? 0, this.buttes.get(idx))
          // LE GEL DE LA FLORE, relevé une fois par tuile (la couche du gel l'a déjà calculé).
          // `null` : la couche du gel n'a pas encore relevé cette tuile — on dessine tel quel, sans
          // inscrire de bascule (sinon chaque arrivée jouerait un gel sur un pré déjà gelé).
          const gele = this.floreGeleeAt === null ? null : this.floreGeleeAt(tx, ty)
          let rang = 0
          for (const p of props) {
            if (used >= MAX_SPRITES) break
            // L'HERBACÉ DISPARAÎT SOUS LE GEL — et repousse au dégel. La pose (échelle, visibilité)
            // vient de la mémoire des bascules ; la gerbe part sur l'image où le geste commence.
            let echX = 1
            let echY = 1
            if (FLORE_GELIVE.has(p.kind)) {
              const r = rang++
              // LA FENÊTRE DE FLORAISON (calendrier floral, `flore-especes.ts`) : une fleur hors
              // fenêtre est absente comme sous le gel — même mémoire de bascules, même geste, et
              // le prédicat se compose : `gelé ∨ hors-fenêtre`. La fenêtre ne s'arme que le jour
              // CONNU (voir `jourConnu`) ; l'herbe, elle, n'a pas de fenêtre.
              const fenetreArmee = p.kind === 'flower' && p.espece !== undefined && this.jourConnu
              const floraison = fenetreArmee ? enFleur(p.espece!, this.jourDeLAnnee, tx, ty, p.nappe) : true
              if (gele !== null || fenetreArmee) {
                const absent = gele === true || !floraison
                const pose = this.transitions.pose(idx * 4 + r, absent, now, retardDe(tx, ty, r + 1))
                if (pose.eclat) {
                  // La gerbe : GIVRE quand c'est le gel qui prend, SÈVE dans tous les autres
                  // sens — une colchique qui se ferme aux Pluies ne givre pas.
                  this.onGivre?.((tx + 0.5 + p.ox) * TILE_PX, (ty + 1 + p.oy) * TILE_PX - this.warp.lift(tx + 0.5 + p.ox, ty + 1 + p.oy),
                    TILE_PX * p.scale, now, idx * 31 + r + 1, gele !== true)
                }
                if (!pose.visible) continue
                echX = pose.sx
                echY = pose.sy
              }
            }
            // LE RAMPANT SOUS LA PROFONDE (caillou, lichen, sphaigne) : une texture de sol, la neige
            // la recouvre entière — on ne la dessine pas.
            const hauteur = this.hauteurNeigeAt?.(tx + 0.5 + p.ox, ty + 1 + p.oy) ?? 0
            if (FLAT_PROPS.has(p.kind) && hauteur >= 1.5) continue
            const slot = used++
            const sprite = this.acquire(slot)
            // LA GAMME DU BIOME (demande d'Alexis, 2026-07-29) : la touffe se teinte du sol qui la
            // porte ; le reste du décor garde la teinte commune. Réarmé comme la texture — un
            // sprite poolé sert des tuiles de biomes différents d'une frame à l'autre. On n'appelle
            // `setTint` que si elle CHANGE : elle ne bouge pas pour la grande majorité des sprites.
            const teinte = p.kind === 'grass_tuft' ? teinteDeLaTouffe(terrain, this.jourDeLAnnee) : CLUTTER_TINT
            if (this.poolTint[slot] !== teinte) {
              sprite.setTint(teinte)
              this.poolTint[slot] = teinte
            }
            const feetY = ty + 1 + p.oy
            const feetX = tx + 0.5 + p.ox
            // Masse pâteuse : quand éclairé, on passe sur l'albédo APLATI `_lit` (+ sa normal map) ;
            // les autres props gardent leur art peint (la lumière plate les module sans les déformer).
            const useLit = this.lighting && LIT_CLUTTER_KINDS.has(p.kind)
            // Les FAMILLES à variétés (fleur, cailloux) ont N textures : l'ESPÈCE de la nappe
            // choisit celle d'une fleur (calendrier floral — l'indice `FLOWERS` est l'espèce),
            // le `variant` (hash de la tuile) celle du reste. Un seul stem sinon (leur `kind`).
            const count = VARIANT_COUNTS[p.kind]
            const base = count !== undefined
              ? variantBase(p.kind, Math.min(count - 1, p.espece ?? Math.floor(p.variant * count)))
              : p.kind
            const cle = useLit ? litClutterTextureKey(base, p.mirror) : `cl-${base}`
            if (this.poolTex[slot] !== cle) {
              sprite.setTexture(cle)
              this.poolTex[slot] = cle
            }
            sprite.setLighting(this.lighting) // pooled : réarmé chaque frame (couche 1)
            // Les pieds se posent sur le sol DÉFORMÉ, comme le maillage du sol et
            // les acteurs. Sans ce lift, un prop est dessiné à sa position PLATE :
            // sur un versant à 0,8 d'élévation il glisse de 120 px vers le bas —
            // les touffes de la berge finissent par flotter sur l'eau.
            const sy = feetY * TILE_PX - this.warp.lift(feetX, feetY)
            sprite.setPosition(feetX * TILE_PX, sy)
            // LE STRETCH DU VENT NORD-SUD (essai, 2026-08-25) : une rotation ne sait pencher
            // qu'à gauche ou à droite, la HAUTEUR APPARENTE dit le reste. Il se multiplie à
            // l'échelle du gel plutôt que de la remplacer — les deux gestes se composent.
            // ⚠ POSÉ CHAQUE IMAGE, comme la rotation : le sprite est POOLÉ, et une prise nulle
            // doit rendre 1 pour effacer le facteur du voisin qui occupait la case avant.
            echY *= windStretch(WIND_TAKE[p.kind] ?? 0, this.wind, this.windForce)
            // Les textures hautes (le chicot : 16×32) déclarent leur aspect — sans lui, le
            // carré par défaut ÉCRASERAIT l'aiguille en moellon.
            sprite.setDisplaySize(TILE_PX * p.scale * echX, TILE_PX * p.scale * (PROP_ASPECT[p.kind] ?? 1) * echY)
            // LA NEIGE MONTE SUR LE PIED DU PROP (gel.md G9) : le bas se coupe de sa hauteur — la
            // découpe révèle le manteau —, l'ombre remonte d'autant. Le rampant (caillou, lichen)
            // disparaît sous la profonde : c'est une texture de sol, la neige la recouvre.
            const coupeNeige = hauteur <= 0.01 ? 0
              : Math.min(hauteur <= 1 ? 2 * hauteur : 2 + 4 * (hauteur - 1), sprite.displayHeight * (FLAT_PROPS.has(p.kind) ? 0.9 : 0.45))
            if (coupeNeige > 0) {
              const frame = sprite.frame
              sprite.setCrop(0, 0, frame.width, Math.max(1, frame.height - coupeNeige / Math.max(1e-6, sprite.scaleY)))
            } else if (sprite.isCropped) sprite.setCrop()
            // Un flip Phaser N'inverse PAS la composante X de la normal map (il tourne les normales,
            // pas le miroir) → un prop `_lit` miroité par flip s'éclairerait à l'ENVERS sur X. La
            // variété par miroir passe donc par une texture `_lit_m` PRÉ-RETOURNÉE (normale juste par
            // construction, cf. `litClutterTextureKey`) ; le flip Phaser reste éteint en mode `_lit`.
            sprite.setFlipX(useLit ? false : p.mirror)
            // Le vent. L'origine est aux PIEDS (0.5, 1) : une rotation fait donc
            // plier le brin depuis sa base, comme une tige — et non tourner comme
            // une aiguille d'horloge. Le rocher a un `take` de 0 : il ne bouge pas.
            const take = WIND_TAKE[p.kind] ?? 0
            // ⚠ DEUX CAPS (voir `windSway`) : l'assiette prend le cap RALLIÉ que `WorldScene` pose
            //   dans `wind`, l'ONDE prend celui de la sim, qui saute par crans — sa phase dépend de
            //   la position, donc la faire tourner en douceur ferait trembler tout le lointain.
            let sway = windSway(feetX, feetY, now, take, this.wind, this.windForce, this.ventSim)
            // LA VÉGÉTATION FRÔLÉE (eau-vivante R16) : un marcheur à moins d'une tuile
            // pousse le brin du côté opposé — pente continue sur la distance, bornes
            // exactes (pleine au contact, nulle à 1 tuile). Ce qui ne prend pas le vent
            // (take 0 : cailloux) ne prend pas non plus le passage.
            if (take > 0 && this.agitateurs.length > 0) {
              for (const a of this.agitateurs) {
                const dx = feetX - a.x
                const dy = feetY - a.y
                const d2 = dx * dx + dy * dy
                if (d2 >= 1) continue
                const prox = 1 - Math.sqrt(d2)
                sway += (dx >= 0 ? 1 : -1) * 0.38 * prox * a.force * Math.min(1, take * 3)
              }
            }
            sprite.setRotation(sway)
            // Un conifère trie avec les acteurs — on passe derrière, puis devant.
            // Le tri se fait sur les pieds RÉELS : deux props d'une même rangée
            // s'ordonnent par leur décalage sub-tuile, pas par l'ordre du pool.
            // (INV-2 : ce qui distingue le décor des nœuds est la teinte, pas la
            // couche ; à pieds égaux le nœud passe devant.)
            sprite.setDepth(FLAT_PROPS.has(p.kind) ? GROUND_PROP_DEPTH : clutterDepth(feetY, TILE_PX))
            sprite.setVisible(true)
            // L'OMBRE DE CONTACT — même flaque, même règle (grand diamètre sur le pixel le plus bas)
            // et même depth-under que nœuds/acteurs, mais pool et compteur À PART (tous les props
            // n'en portent pas). Non tournée par le vent : le buisson plie, sa flaque au sol ne bouge
            // pas. Au sol DÉFORMÉ (`sy`, post-lift).
            if (SHADOW_PROPS.has(p.kind)) {
              let shadow = this.shadowPool[shadowsUsed]
              if (!shadow) {
                shadow = createContactShadow(this.scene)
                this.shadowPool[shadowsUsed] = shadow
              }
              // Gap de la variante RENDUE : `_lit` (défaut) quand `useLit`, sinon l'art peint.
              const litGap = SHADOW_PROP_GAP_LIT[p.kind]
              const gapTexels = useLit && litGap !== undefined ? litGap : (SHADOW_PROP_GAP[p.kind] ?? 2)
              const gapWorld = gapTexels * sprite.scaleY + coupeNeige
              // LARGEUR sur l'emprise RÉELLE de l'art (texels × échelle du sprite) pour les props DEBOUT
              // qui ne remplissent pas leur tuile — sinon `displayWidth` (tuile pleine) surdimensionne
              // la flaque d'un prop mince. Les props pleins (absents de la table) gardent `displayWidth`.
              const artW = SHADOW_PROP_WIDTH[p.kind]
              const widthBasis = artW !== undefined ? artW * sprite.scaleX : sprite.displayWidth
              positionShadow(shadow, feetX * TILE_PX, sy, widthBasis, clutterDepth(feetY, TILE_PX), gapWorld)
              shadowsUsed++
            }
          }
        }
      }
      if (used >= MAX_SPRITES && !this.warned) {
        console.warn(`[clutter] cap de ${MAX_SPRITES} sprites atteint — décor tronqué à la vue`)
        this.warned = true
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i]!.setVisible(false)
    // Les ombres suivent le sort de leurs props (même logique que le pool de sprites) : dézoomé
    // ou culled, `shadowsUsed` retombe à 0 et aucune flaque ne reste allumée sous une tuile vide.
    for (let i = shadowsUsed; i < this.shadowPool.length; i++) this.shadowPool[i]!.setVisible(false)
  }

  private acquire(i: number): Phaser.GameObjects.Image {
    let sprite = this.pool[i]
    if (!sprite) {
      sprite = this.scene.add.image(0, 0, 'cl-grass_tuft').setOrigin(0.5, 1).setTint(CLUTTER_TINT)
      this.pool[i] = sprite
      this.poolTint[i] = CLUTTER_TINT
      this.poolTex[i] = 'cl-grass_tuft' // le miroir démarre SUR la texture posée, sinon il ment
    }
    return sprite
  }

  destroy(): void {
    for (const s of this.pool) s.destroy()
    this.pool.length = 0
    this.poolTint.length = 0
    this.poolTex.length = 0
    this.memoire.vider()
    for (const s of this.shadowPool) s.destroy()
    this.shadowPool.length = 0
  }
}
