/**
 * ═══ LA GARDE STRUCTURELLE D'E-A3 — « un site NOUVEAU rougit aussi » ═══
 *
 * `docs/specs/etages.md` E-A3 le promet mot pour mot : *« les 67 sites sont couverts, et la
 * garde échoue si un site nouveau apparaît sans passer par l'accesseur »*. La garde
 * behaviorale (`etages-etancheite.test.ts`) tient la première moitié — elle pose deux corps de
 * part et d'autre d'un plancher et demande à chaque système s'il les voit. Elle ne peut PAS
 * tenir la seconde : un site qu'on écrirait demain n'a personne pour le mettre en scène.
 *
 * D'où cette règle. Elle ne juge pas le comportement : elle refuse qu'un calcul de DISTANCE
 * ENTRE DEUX POINTS naisse dans `/sim` sans que quelqu'un ait tranché s'il traverse un
 * plancher. Quatre issues, et une seule est silencieuse :
 *
 *  1. la fonction qui l'entoure appelle l'accesseur (`atteignableEntreEtages`, `atteintLeSol`,
 *     `auMemeEtage`) — c'est un site COUVERT, rien à dire ;
 *  2. elle est nommée dans `HORS_REGLE`, avec sa RAISON — c'est un site qui n'a pas de second
 *     corps (un anneau de tuiles, un waypoint de son propre chemin, un test d'appartenance de
 *     zone, un champ échantillonné en un point, du worldgen), ou dont l'étanchéité est déjà
 *     assurée AUTREMENT (`isSheltered`, un filtre de palier, un couple filtré en amont) ;
 *  3. elle est nommée dans `A_TRANCHER` — c'est un vrai site de perception, la réponse change
 *     le JEU, et c'est donc une décision d'Alexis, pas une correction technique. Ces
 *     entrées-là sont énumérées en questions dans `docs/specs/etages.md` §19 ;
 *  4. ni l'un ni l'autre : **le lint rougit**, et il faut trancher.
 *
 * ⚠ **LA LIGNE DE PARTAGE N'EST PAS « TOUT CE QUI CALCULE UNE DISTANCE »** (spec §19). Donner
 * une garde d'étage à un anneau de spawn rendrait le mécanisme muet sans rien protéger : c'est
 * le piège de *« la géographie module, elle n'autorise jamais »*. `HORS_REGLE` n'est donc pas
 * une dette — c'est le résultat d'un tri, et chaque ligne porte pourquoi. `A_TRANCHER`, si.
 *
 * ⚠ La clé est le nom de la FONCTION qui entoure, jamais un numéro de ligne : un numéro se
 * périme au premier edit, et une exemption périmée est une garde morte. **Et une exemption qui
 * ne couvre plus rien rougit AUSSI** (`morte`) : c'est ce qui empêche cette table de pourrir.
 *   — Sa PORTÉE, énoncée : `morte` se rend en `Program:exit`, donc pour les fichiers qu'ESLint
 *     VISITE. Renommer une fonction rougit ; renommer ou supprimer un FICHIER qui porte une
 *     entrée `'*'` ne rougit pas — plus personne ne visite ce fichier, plus personne ne relève
 *     son entrée. C'est le seul trou connu de cette table, et il est petit (onze fichiers).
 *
 * ⚠ **ELLE NE VISE QUE LES DISTANCES COMPARÉES À UN SEUIL**, et c'est la leçon de son premier
 * passage : elle relevait 45 sites, dont l'écrasante majorité étaient des NORMALISATIONS
 * (`const l = Math.sqrt(dx * dx + dy * dy)` pour en tirer une direction unitaire). Normaliser
 * un vecteur n'est pas demander « est-il à portée ? » — le nourrir d'une garde d'étage
 * n'aurait rien protégé et aurait noyé le tri sous du bruit. On ne retient donc que ce qui
 * finit en COMPARAISON : directement (`if (dx * dx + dy * dy > r2)`) ou par une variable
 * comparée plus loin dans la même fonction (`const d2 = …` puis `if (d2 > r2)`).
 *
 * ⚠ **ELLE VOIT `distSq(a, b, c, d)`**, et c'est la leçon du second : bornée à l'idiome écrit à
 * la main, elle était aveugle à 139 des ~163 sites du dépôt — dont `nearestGibier` et le
 * phare-feu de `nearestWarmth`, deux vraies perceptions trouvées par accident en cinq minutes
 * dans le trou. `distSq` EST `dx * dx + dy * dy` (`geometry.ts`) : l'exclure, c'était exclure
 * l'idiome, pas un autre construit.
 *
 * ⚠ **CE QU'ELLE NE PEUT PAS VOIR** : une distance rendue par un helper AUTRE que `distSq` et
 * comparée chez l'appelant. C'est une garde tripwire, pas une preuve.
 */

/** Les fonctions qui répondent « un plancher les sépare-t-il ? » — E-R5 et ses habillages. */
const ACCESSEURS = ['atteignableEntreEtages', 'atteintLeSol', 'auMemeEtage']

/**
 * LES SITES TRIÉS HORS DE LA RÈGLE — `fichier` → { fonction: raison }.
 *
 * `'*'` couvre le fichier entier (le worldgen : aucun corps vivant n'existe encore quand il
 * tourne). Ailleurs, on nomme la fonction, pour qu'une SECONDE distance ajoutée dans le même
 * fichier soit quand même soumise au tri.
 */
const HORS_REGLE = {
  // ══ Aucun corps vivant : la carte se fabrique, personne ne la parcourt encore ══
  'layons.ts': { '*': 'worldgen' },
  'poi.ts': { '*': 'worldgen (placement des lieux)' },
  'poisson.ts': { '*': 'worldgen (échantillonnage de Poisson)' },
  'village-plan.ts': { '*': 'worldgen (plan du bâti)' },
  'zone-content.ts': { '*': 'worldgen (semis)' },
  'zonegen.ts': { '*': 'worldgen' },
  'zonegen-karst.ts': { '*': 'worldgen (c’est lui qui CREUSE les étages)' },
  'zonegen-trace.ts': { '*': 'worldgen' },
  'zonegen-water.ts': { '*': 'worldgen' },
  'clairieres.ts': { tuileDeClairiere: 'worldgen — le rayon normalisé d’un cadre de clairière' },
  'map.ts': { poiClearings: 'worldgen — le disque déboisé d’un lieu' },

  // ══ Ni deux corps, ni une perception ══
  'annales.ts': { '*': 'densité de deux ANNALES entre elles — des faits, pas des corps' },
  'interest.ts': {
    // ⚠ Malgré son nom, ce n'est PAS un helper de portée : c'est l'interest management RÉSEAU.
    // Le filtrer par étage serait un DÉFAUT — le client doit RECEVOIR l'étage voisin pour le
    // composer en une image (E-R10).
    '*': 'interest management réseau — le client doit recevoir l’étage voisin (E-R10)',
  },
  'prediction.ts': { reconcile: 'sa PROPRE position prédite contre l’autoritative — un seul corps' },

  // ══ Un CHAMP échantillonné en un point : c'est E-R13, pas E-R5 ══
  'brume.ts': { dansLaBrumeAu: 'un champ (la brume) lu en un point — E-R13' },
  'fumerolle.ts': { froidDeFumerolle: 'un champ (le souffle froid) lu en un point — E-R13' },
  'temperature.ts': {
    // Et il porte DÉJÀ sa garde : `etage < 0 → 0` (G-R7, « la source est au sol »).
    naturalWarmth: 'un champ (la source chaude) lu en un point, et déjà borné par l’étage',
    // La bulle d'UN feu, mesurée depuis son centre (LG-R17) : la géométrie seule, comme
    // `inStrikeZone`. Le scellement vit à ses deux appels, qui filtrent le feu par `auMemeEtage`
    // AVANT de la lire — `fireBubble` (ici) et `lumiereDuFeu` (`nuit.ts`).
    bulleDuFeu: 'géométrie pure de la bulle d’un feu — le scellement vit aux appels (`fireBubble`, `lumiereDuFeu`), qui font `auMemeEtage`',
  },

  // ══ Appartenance à une ZONE, pas une perception ══
  'bucher.ts': { advanceBuchers: 'appartenance d’un cadavre à la zone charnier' },
  'defriche.ts': { dansEmprise: 'appartenance au carré du feu, pas une perception' },

  // ══ Un seul corps : il mesure sa PROPRE trajectoire, son ancre, son territoire ══
  'cendreux.ts': {
    // Quatre sites : la longueur bornée d'une extrapolation mémoire, l'arrivée sur le dernier
    // lieu vu, le contact d'une cible DÉJÀ élue (par `nearestPrey`, scellé), son waypoint.
    cendreuxStep: 'sa mémoire, son arrivée, sa cible déjà élue, son waypoint — pas d’élection ici',
  },
  'impasse.ts': { advanceImpasse: 'le déplacement NET depuis sa propre ancre' },
  'coulee.ts': {
    // Pas un corps : une TUILE contre les waypoints d'un chemin fixé au worldgen (le fil de SA
    // rivière) — même étagère que `followPath` de `npc.ts`, « waypoint de son propre chemin ».
    attacheAuFil: 'une tuile contre les waypoints du fil de sa rivière — pas de second corps',
    // La même règle, RETOURNÉE : le fil peint son pas sur les tuiles autour de lui (la table
    // d'attache, cuite une fois pour le rendu) — mêmes waypoints, même absence de corps.
    tableDAttache: 'le fil de la rivière contre les tuiles de son lit — la même attache, cuite par le fil ; pas de second corps',
    // La souillure est un champ AU SOL, scellé DEUX fois sans l'accesseur d'étage : ① à
    // l'émission, `souiller` (faune.ts) refuse toute goutte qui porte un étage ; ② à la
    // lecture, tout passe par `terrainAt`, donc par `map.terrain` — la seule strate du sol.
    forceDUneSouillure: 'champ au sol : étage refusé à l’émission, lecture par `map.terrain` seulement',
  },
  'npc.ts': {
    followPath: 'waypoint de son propre chemin — pas de second corps',
    executeBuild: 'choix d’une tuile libre adjacente — la marchabilité tranche',
    // Chebyshev au feu = « suis-je DANS le village ? ». Un test d'appartenance de zone, pas une
    // perception : le rendre étanche exclurait du village celui qui en descend la cave.
    advanceNpcs: 'appartenance au carré du feu, pas une perception',
  },
  'traction.ts': { advanceTraction: 'un corps et SA propre charge — la rupture règle déjà la distance' },
  'npc-errands.ts': { nearestOtherVillage: 'deux feux de village entre eux — deux LIEUX, au sol' },

  // ══ Un anneau / une grille de tuiles qu'on balaie pour CHOISIR une tuile ══
  'worldevents.ts': {
    planifierHorde: 'anneau de tuiles pour choisir un spawn, puis le feu le plus proche',
    spawnHorde: 'le feu le plus proche du plan — élection d’une cible de lieu, pas une vue',
  },
  'pathfinding.ts': { lisserLeChemin: 'raccourci de chemin — c’est `trajetDegage` qui tranche' },

  // ══ La machinerie des étages elle-même, et ce qui est scellé AUTREMENT ══
  'etages.ts': {
    unConnecteurPres: 'c’est la loi d’étage elle-même — elle ne peut pas s’appeler',
    fondDuLieu: 'dérivation du fond d’une salle depuis SES gueules — un seul étage par construction',
  },
  'foudre.ts': { advanceFoudre: 'scellé par `isSheltered`, qui connaît « sous la roche » (G-R5)' },
  'inventory-actions.ts': { poserAuSol: 'scellé par son propre filtre `niveauDuCorps(p) === etage`' },
  'lumiere.ts': {
    // LG-R18 (Alexis, 2026-09-16) : la torche d'un autre corps éclaire « au même étage » — le
    // filtre `niveauDuCorps(e) !== niveau` précède la distance, comme `poserAuSol`. Pas E-R5 :
    // la lumière ne suit pas les rampes, elle suit LG-R14 (la falaise fait écran), et c'est
    // `partVisible`, lu à l'étage du récepteur, qui porte cette règle-là.
    lumiereDesTorches: 'scellé par son propre filtre `niveauDuCorps(e) === niveau` (LG-R18 : au même étage)',
  },
  'ecart.ts': {
    // Les paires arrivent déjà filtrées par `separation.ts`, qui appelle l'accesseur.
    separationPush: 'les paires sont filtrées en amont (`separation.ts`) — ici, de la géométrie',
  },
  'combat.ts': {
    // L'étanchéité de la frappe vit aux APPELS (`combat.ts` ×4), prouvée par la garde « LA FRAPPE ».
    inStrikeZone: 'géométrie pure du cône de frappe — le scellement vit aux appels',
  },
  'morts.ts': {
    densiteDesMorts: 'un champ (la densité) lu en un point — E-R13',
    advanceLieuxBrules: 'appartenance d’un bûcher à la zone charnier',
  },
  'sens.ts': {
    secouerLeSol: 'Q7 tranchée (Alexis, 2026-09-07) : LA ROCHE PORTE LA SECOUSSE. Un choc au sol '
      + 'se propage par la masse — c’est le seul sens du jeu qui traverse un plancher, et c’est '
      + 'voulu : marteler au-dessus d’une salle réveille ce qui y dort. (`eveilDuCendreux` lit '
      + 'déjà `entity.etage`, G-R5 : la chaleur, elle, est bien par étage.)',
  },
  'faune.ts': {
    faunaStep: 'ses SEPT distances restantes sont de la TRAJECTOIRE ou un centroïde : son point '
      + 'de peur, son propre attaquant (déjà au contact), le centre de sa harde, son ancrage de '
      + 'pâture. La seule PERCEPTION du dispatcher — l’alarme de harde — vit depuis le '
      + '2026-09-07 dans `crisFrais`, scellée (Q3) ; elle en est sortie exprès, pour que sceller '
      + 'l’alarme n’exempte pas les sept autres en silence.',
    predatorBias: 'un champ (le biais géographique depuis le Feu) lu en un point — E-R13',
    bloodBias: 'Q4 tranchée (Alexis, 2026-09-07) : le SANG reste un CHAMP lu en un point — E-R13, '
      + 'la même étagère que la brume, les fumerolles et `naturalWarmth`. Un charnier PÈSE sur '
      + 'le tirage de peuplement alentour ; il n’élit personne. (`feedStep`, qui ÉLIT une '
      + 'charogne, est scellé.)',
    isQuiet: 'un champ (les zones apaisées) lu en un point — E-R13',
    advanceEnvols: 'un envol contre les envols récents — le cooldown d’un lieu, pas une vue',
    trySpawnNear: 'anneau de spawn — la marchabilité tranche',
    herdSpot: 'essaimage d’une harde autour de son hôte — un anneau de spawn',
    placeHuntingGrounds: 'espacement de deux COINS entre eux, à la fondation',
    entretienDesCoins: 'espacement de deux coins entre eux',
    nearestGround: 'élection d’un LIEU (son territoire) — le chemin tranche l’accès',
    dortoirEligible: 'espacement d’un dortoir au bâti et aux autres dortoirs',
    elireDortoir: 'choix d’une cellule de dortoir — l’éligibilité tranche',
    dortoirStep: 'son arrivée à SON dortoir',
    bedStep: 'son arrivée à SA couche',
    goHome: 'son arrivée chez elle, et le choix d’une tuile au MÊME palier (déjà filtré)',
    baitStep: 'son arrivée sur un appât déjà élu par `nearestPile`, scellé',
    burrowRun: 'la direction de SON terrier, et une menace déjà élue en amont',
    couleeStep: 'sa progression le long de SA coulée',
    migrationTarget: 'tirage par rejet dans SON propre disque',
    graze: 'cohésion à SA harde, dont les membres partagent son étage par construction',
    pathStep: 'la péremption de SON chemin, et SON waypoint',
    // `boarStep` n'est plus exempté (2026-09-20) : le coup de charge appelle l'accesseur — la
    // menace « déjà élue » l'était à travers le plancher (`nearestThreat` ne filtrait pas).
    wolfStep: 'la distance à une cible déjà élue par `chooseQuarry`, scellé',
    goutteDuTick: 'départage entre deux gouttes d’homme du MÊME tick (deux avatars gouttent au même '
      + 'instant) : la sienne est la plus proche — une goutte déjà ÉLUE atteignable par '
      + '`gouttePlusFraiche` (scellé), on ne fait que la RETROUVER',
    seCogne: 'sa PROGRESSION vers SON but de piste (une goutte élue atteignable, une origine d’eau '
      + 'déjà scellée par `atteintLeSol`) — la mesure de `noteBlocked`, exempté pour la même raison',
    departDuClan: 'élection d’un coin de départ — un LIEU',
    denLife: 'la distance à SON gîte',
    despawnUnwatched: 'la présence d’un joueur pour DÉSPAWNER — un plancher de plus ne fait que garder la bête en vie, le sens sûr',
  },
}

/**
 * LES SITES QUI SONT DE VRAIES PERCEPTIONS ET QUI ATTENDENT UNE DÉCISION — même forme.
 *
 * Un site atterrit ici quand la distance décide si un corps PERÇOIT, SUBIT ou AGIT SUR autre
 * chose, que rien en amont n'a filtré le couple, et que le corriger CHANGE LE JEU. Ce n'est pas
 * une correction technique : c'est une décision d'Alexis (mémoire « pas de décision de design
 * tout seul »), et elles se posent UNE À LA FOIS. Les questions sont énumérées en clair dans
 * `docs/specs/etages.md` §19 ; la raison ci-dessous dit à laquelle chaque site répond.
 *
 * ✅ **VIDE DEPUIS LE 2026-09-07 — les sept questions ont été posées à Alexis une à une, et les
 * huit décisions sont livrées** (`docs/specs/etages.md` §21). Les 28 sites qu'elle contenait sont
 * scellés ; les deux laissés ouverts par décision (`faune.bloodBias`, `sens.secouerLeSol`) sont
 * passés dans `HORS_REGLE` avec la décision écrite dans leur raison — jamais supprimés, sinon le
 * lint serait vert pour la mauvaise cause. Une table vide N'EST PAS un état transitoire : c'est
 * l'état sain. Un site NOUVEAU qui atterrit ici est une question de plus à poser, pas une dette.
 */
const A_TRANCHER = {}

/** `dx * dx + dy * dy` — le carré de la distance, l'idiome du dépôt (jamais `hypot` dans /sim). */
function estSommeDeCarres(node) {
  if (node.type !== 'BinaryExpression' || node.operator !== '+') return false
  const carre = (n) =>
    n.type === 'BinaryExpression' && n.operator === '*'
    && n.left.type === 'Identifier' && n.right.type === 'Identifier'
    && n.left.name === n.right.name
  return carre(node.left) && carre(node.right)
}

/** `Math.max(Math.abs(a - b), Math.abs(c - d))` — la distance de Chebyshev, écrite à la main. */
function estChebyshev(node) {
  if (node.type !== 'CallExpression') return false
  const m = node.callee
  if (m.type !== 'MemberExpression' || m.object.name !== 'Math') return false
  if (m.property.name === 'hypot') return true
  if (m.property.name !== 'max' || node.arguments.length < 2) return false
  const abs = (a) =>
    a.type === 'CallExpression' && a.callee.type === 'MemberExpression'
    && a.callee.object.name === 'Math' && a.callee.property.name === 'abs'
  return node.arguments.every(abs)
}

/** `distSq(ax, ay, bx, by)` — le MÊME idiome, extrait dans `geometry.ts`. */
function estDistSq(node) {
  return node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'distSq'
}

/**
 * Le nom de la fonction TOP-LEVEL qui entoure — la clé des deux tables.
 *
 * ⚠ On remonte jusqu'à la PLUS LARGE, et on ne prend le nom d'un `VariableDeclarator` que
 * s'il porte bien une fonction : sinon la clé serait celle de la variable qu'on assigne
 * (`d`, `d2`, `len`…), c'est-à-dire un nom qui ne dit rien et qui change à chaque edit.
 */
function nomDeLaFonction(node) {
  let nom = null
  for (let n = node; n; n = n.parent) {
    const estFonction = n.type === 'FunctionDeclaration'
      || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression'
    if (!estFonction) continue
    if (n.type === 'FunctionDeclaration' && n.id) { nom = n.id.name; continue }
    const p = n.parent
    if (p?.type === 'VariableDeclarator' && p.id.type === 'Identifier') { nom = p.id.name; continue }
    if (p?.type === 'Property' && p.key.type === 'Identifier') { nom = p.key.name; continue }
    if (p?.type === 'MethodDefinition' && p.key.type === 'Identifier') { nom = p.key.name; continue }
  }
  return nom
}

/** La plus grande fonction qui entoure — celle dont on lit le texte pour y chercher l'accesseur.
 *  On prend la PLUS LARGE (une lambda passée à `some()` n'a pas à répéter l'appel). */
function fonctionEnglobante(node) {
  let dernier = null
  for (let n = node; n; n = n.parent) {
    if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
      dernier = n
    }
  }
  return dernier
}

/**
 * Une comparaison de SEUIL — `<`, `<=`, `>`, `>=` contre autre chose que zéro.
 *
 * ⚠ **`l > 0` N'EST PAS UNE PORTÉE**, c'est la garde de division d'une normalisation (« ne
 * divise pas par un vecteur nul »). Elle est partout dans `faune.ts`, et la compter noierait
 * le tri sous des sites qui ne perçoivent rien.
 */
const EPS_GARDE = 0.01
function estComparaison(n) {
  if (n?.type !== 'BinaryExpression' || !['<', '<=', '>', '>='].includes(n.operator)) return false
  const zero = (o) => o.type === 'Literal' && typeof o.value === 'number' && Math.abs(o.value) <= EPS_GARDE
  return !zero(n.left) && !zero(n.right)
}

/** Le nœud, ou le `Math.sqrt(...)` qui l'enveloppe : c'est lui qu'on voit dans la comparaison. */
function enveloppeSqrt(node) {
  const p = node.parent
  const estSqrt = p?.type === 'CallExpression' && p.callee.type === 'MemberExpression'
    && p.callee.object.name === 'Math' && p.callee.property.name === 'sqrt'
  return estSqrt ? p : node
}

/**
 * CETTE DISTANCE EST-ELLE COMPARÉE À UN SEUIL ? — la seule forme qui soit une PORTÉE.
 * Directement, ou via la variable qui la reçoit (l'idiome `const d2 = …` puis `if (d2 > r2)`).
 */
function estUnePortee(node, source) {
  const v = enveloppeSqrt(node)
  if (estComparaison(v.parent)) return true
  const decl = v.parent
  if (decl?.type !== 'VariableDeclarator' || decl.id.type !== 'Identifier') return false
  const portee = source.getScope(decl.id)
  const variable = portee.variables.find((k) => k.name === decl.id.name)
    ?? portee.through.map((r) => r.resolved).find((k) => k?.name === decl.id.name)
  if (!variable) return false
  return variable.references.some((r) => estComparaison(r.identifier.parent))
}

export const regleEtage = {
  meta: {
    type: 'problem',
    docs: { description: 'Un calcul de distance dans /sim doit passer par l’accesseur d’étage (E-A3).' },
    schema: [],
    messages: {
      aveugle:
        'E-A3 — `{{fichier}}` › `{{fonction}}` : cette distance ne demande jamais si un PLANCHER '
        + 'sépare les deux points. '
        + 'Soit la fonction appelle l’accesseur ({{accesseurs}}), soit ce site est trié — HORS_REGLE '
        + 's’il n’a pas de second corps (anneau de tuiles, waypoint de son propre chemin, champ lu '
        + 'en un point, appartenance de zone, worldgen) ou s’il est déjà scellé autrement ; '
        + 'A_TRANCHER si c’est une vraie perception dont la réponse change le jeu. Les deux tables '
        + 'sont dans `tools/eslint-regle-etage.mjs`, ET CHAQUE ENTRÉE PORTE SA RAISON. '
        + 'Voir docs/specs/etages.md §19.',
      morte:
        'E-A3 — `{{fichier}}` : l’exemption `{{cle}}` ({{table}}) ne couvre plus aucun site. '
        + 'Une exemption périmée est une garde morte : la retirer de `tools/eslint-regle-etage.mjs`.',
    },
  },
  create(context) {
    const chemin = context.filename ?? context.getFilename()
    if (!chemin.includes('/packages/sim/src/')) return {}
    if (chemin.endsWith('.test.ts')) return {}
    const fichier = chemin.slice(chemin.lastIndexOf('/') + 1)
    const exempt = HORS_REGLE[fichier]
    const ouvert = A_TRANCHER[fichier]
    if (exempt === undefined && ouvert === undefined) {
      // Rien à amortir : on juge, sans avoir à tenir de compte.
      const source0 = context.sourceCode ?? context.getSourceCode()
      return visiteur(context, source0, fichier, undefined, undefined, null)
    }
    const source = context.sourceCode ?? context.getSourceCode()
    const utilisees = new Set()
    const v = visiteur(context, source, fichier, exempt, ouvert, utilisees)
    return {
      ...v,
      'Program:exit': (node) => {
        const mortes = (table, nom) => {
          for (const cle of Object.keys(table ?? {})) {
            if (!utilisees.has(nom + cle)) {
              context.report({ node, messageId: 'morte', data: { fichier, cle, table: nom === '!' ? 'A_TRANCHER' : 'HORS_REGLE' } })
            }
          }
        }
        mortes(exempt, '')
        mortes(ouvert, '!')
      },
    }
  },
}

/** La visite proprement dite — partagée par les deux chemins de `create`. */
function visiteur(context, source, fichier, exempt, ouvert, utilisees) {
  const juger = (node) => {
    const enveloppe = fonctionEnglobante(node)
    if (enveloppe) {
      const texte = source.getText(enveloppe)
      if (ACCESSEURS.some((a) => texte.includes(a))) return
    }
    const nom = nomDeLaFonction(node)
    if (exempt) {
      if (exempt['*'] !== undefined) { utilisees?.add('*'); return }
      if (nom !== null && exempt[nom] !== undefined) { utilisees?.add(nom); return }
    }
    if (ouvert) {
      if (ouvert['*'] !== undefined) { utilisees?.add('!*'); return }
      if (nom !== null && ouvert[nom] !== undefined) { utilisees?.add('!' + nom); return }
    }
    context.report({
      node,
      messageId: 'aveugle',
      data: { accesseurs: ACCESSEURS.join(', '), fichier, fonction: nom ?? '(hors fonction)' },
    })
  }
  return {
    BinaryExpression: (node) => { if (estSommeDeCarres(node) && estUnePortee(node, source)) juger(node) },
    CallExpression: (node) => { if ((estChebyshev(node) || estDistSq(node)) && estUnePortee(node, source)) juger(node) },
  }
}

export default { rules: { 'distance-aveugle-a-l-etage': regleEtage } }
