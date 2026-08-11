/**
 * L'AIDE CONTEXTUELLE DE L'ATELIER (demande d'Alexis, 2026-08-10 : « il manque des
 * explications contextuelles sur les fonctionnalités »).
 *
 * Trois étages, du plus proche au plus complet :
 *   1. LA BANDE D'AIDE (sous le viewport) — elle dit en continu ce qui est SOUS LA MAIN :
 *      l'outil actif par défaut, le contrôle survolé, la pièce de palette survolée — avec
 *      son sens EN JEU (un coffre part au pillage, un âtre survit au feu…), pas seulement
 *      son nom ;
 *   2. les INFOBULLES (title) sur chaque contrôle — le même texte, pour qui s'attarde ;
 *   3. LA RÉFÉRENCE (bouton « ? » ou touche ?) — tout l'éditeur en une page : le geste,
 *      la sélection, la planche, le monde, les brouillons, la carte des raccourcis.
 *
 * Le contenu vit ICI, en un seul endroit — la bande, les bulles et la référence lisent les
 * mêmes textes : pas deux formulations qui divergent.
 */

/** Ce que fait chaque OUTIL — la bande l'affiche quand l'outil est actif. */
export const AIDE_OUTILS: Record<string, string> = {
  peindre: 'PEINDRE (B) — clic ou glisser pose le caractère choisi dans la palette. Alt+clic = pipette (prend le caractère sous le curseur), clic droit = gomme.',
  gommer: 'GOMMER (E, ou clic droit partout) — la case redevient « · » ; si une arête posée (brèche, seuil, passage) est sous le curseur, c’est ELLE qui saute.',
  selection: 'SÉLECTION (M) — tire un rectangle. Ctrl+C copie, Ctrl+X coupe, Suppr efface, Ctrl+V arme le collage (chaque clic estampe, Échap repose). ⇋H ⇅V ⟳90° transforment — les arêtes tournent AVEC.',
  breche: 'BRÈCHE — perce le contour : l’arête cliquée du pourtour n’aura PAS de mur. C’est par là qu’on entre dans une ruine — le pan est écroulé. Recliquer retire.',
  seuil: 'SEUIL — pose un encadrement (huisserie percée) sur l’arête : l’entrée qui se LIT comme une porte. Deux seuils mitoyens fusionnent en porte large.',
  passage: 'PASSAGE — laisse la clôture de la cour OUVERTE sur cette arête : on entre dans l’enclos sans porte. Deux cases valent mieux qu’une (un corps fait une tuile).',
}

/** Ce que fait chaque CONTRÔLE, par id — la bande au survol, l'infobulle au repos. */
export const AIDE_CONTROLES: Record<string, string> = {
  lieux: 'Le lieu édité. ● = éditions non sauvées ; (brouillon) = hors-monde, jamais compilé.',
  nouveau: 'Crée un lieu BROUILLON (plans/brouillons/) : éditable et rendu ici, mais il ne naît pas dans le monde tant qu’on ne l’a pas promu — déplacer le fichier + écrire son entrée POI_TYPES.',
  dupliquer: 'Duplique le lieu courant en brouillon hors-monde — la base d’une variante.',
  usure: 'La fraction de PV que gardent murs et pièces (1 = neuf). SOUS 0,8, le monde bascule les textures en RUINE — c’est ce qui fait lire « abandonné » sans lire le nom.',
  fixe: 'Le lieu se pose TEL QU’IL EST ÉCRIT, sans quart de tour : pour les plans dont la lecture dépend de l’orientation (la Ferme : on arrive par l’enclos). Prix : tous les exemplaires se ressemblent.',
  sort: 'Ce que l’histoire a fait au lieu — BRÛLÉ : le feu a pris toit et mobilier (survivent la pierre, l’âtre, l’autel) ; PILLÉ : les contenants sont partis (coffre, tonneau, étagère) ; INTACT : tout est là. En jeu, le sort est dérivé de la carte — ici c’est un aperçu.',
  quart: 'L’orientation d’aperçu (0-3). L’ÉDITION se fait en 0 : les arêtes sont écrites dans le repère du plan. En jeu, l’orientation est tirée de la position — sauf plan fixe.',
  dedans: 'Place l’avatar fictif AU CENTRE de la salle : les vraies règles du jeu jouent — le toit disparaît, la façade tombe en empreinte. Décoché : l’avatar observe depuis le sud.',
  heure: 'L’heure de l’éclairage (le soleil et la lune du jeu). Ne change que le rendu — 2 h pour juger un lieu de nuit, 7 h ou 18 h pour le soleil rasant qui révèle le relief.',
  'c-toits': 'Calque : montre/cache les TOITS. Un filtre d’affichage — la sim d’aperçu les garde (utile pour peindre l’intérieur d’une salle couverte).',
  'c-aretes': 'Calque : les BADGES des arêtes posées — brèche rouge, seuil ambre, passage vert. Sans eux, on gomme à l’aveugle.',
  'c-regions': 'Calque : teinte les cases par RÉGION — salle en ambre, cour en vert, antre en gris roche. Les barrières se dérivent du pourtour de ces régions.',
  'c-grille': 'Calque : le quadrillage des tuiles, par-dessus tout — on vise une case même sous un toit plein.',
  annuler: 'Annuler (Ctrl+Z) — une entrée par GESTE : un trait entier de pinceau, un collage, une transformation se défont d’un coup.',
  refaire: 'Refaire (Ctrl+Y ou Ctrl+Maj+Z) — tant qu’on n’a pas repris une édition ailleurs.',
  recadrer: 'Le plan entier dans la fenêtre. Le zoom (molette, centré sur le curseur) et le pan (Espace ou bouton du milieu) restent à toi pendant l’édition.',
  'miroir-h': 'Miroir HORIZONTAL de la sélection (ou du collage armé) — colonnes retournées, arêtes E↔O échangées avec.',
  'miroir-v': 'Miroir VERTICAL — rangées retournées, arêtes N↔S échangées.',
  'tourner-frag': 'Quart de tour horaire de la sélection (ou du collage armé) — la même convention que le monde (N→E→S→O). Refuse si ça déborderait de la grille.',
  'tampon-plus': 'Mémorise le presse-papier comme TAMPON nommé — réutilisable sur tous les lieux, d’une séance à l’autre (un coin ruiné, un âtre meublé…).',
  tampons: 'Les tampons : cliquer en arme le collage (chaque clic estampe, Échap repose). ✕ pour l’oublier.',
  palette: 'La palette des caractères du plan — 1…9 et 0 choisissent les dix premières, Alt+clic dans la grille fait pipette. Survole une case pour lire son sens en jeu.',
  planche: 'LE LIEU SOUS TOUTES SES FACES : rotations, sorts, nuit — rendus par le vrai pipeline, rafraîchis après l’édition. CLIQUER une vignette applique ses réglages à la vue principale. Le coût est MESURÉ : trop lent → bouton « rafraîchir » seulement.',
  'planche-maj': 'Rafraîchit la planche à la main (toujours possible ; obligatoire si la mesure a coupé l’auto).',
  exporter: 'Compose la vue principale + les six vignettes en un PNG — pour discuter d’un lieu pièce en main.',
  'historique-maj': 'Les derniers commits du .plan ; cliquer une révision montre son diff vers ton brouillon. (Lecture seule — l’hôte a git, le conteneur non.)',
  'voir-diff': 'Le diff entre le fichier sur DISQUE et ton brouillon — ce que « Sauver » écrirait, ligne à ligne.',
  tester: 'Ouvre la Veillée dev TÉLÉPORTÉ au premier exemplaire du lieu — juge en marchant. Sauve d’abord : le jeu montre la version du disque. (Un brouillon hors-monde n’y existe pas.)',
  sauver: 'Réécrit le .plan (ta prose # est préservée — patch chirurgical) puis régénère le module : le jeu en dev recharge tout seul. Bloqué tant qu’une faute de validation reste.',
  copier: 'Copie le texte du .plan au presse-papier — la voie de secours quand le dépôt est en lecture seule (stack Docker).',
  jeu: '',
}

/** Le sens EN JEU de chaque caractère de palette — par pièce/région, pas par lettre. */
export const AIDE_PALETTE: Record<string, string> = {
  '·': 'RIEN — l’absence. Dans une ruine, l’absence est la moitié du sujet.',
  '.': 'DALLAGE de salle — les murs se DÉRIVENT de son pourtour : dessine le sol, l’enceinte suit.',
  ':': 'DALLAGE COUVERT — un seul « : » suffit : TOUTE la salle porte alors un toit, mobilier compris.',
  ',': 'TERRE BATTUE de cour — l’enclos plein air ; sa clôture se dérive du pourtour, percée par les PASSAGES.',
  A: 'ÂTRE (en salle) — le foyer froid. Il SURVIT au feu : c’est lui qui raconte la maison brûlée.',
  T: 'TABLE (en salle) — du mobilier qui se regarde ; plaqué au mur, il s’appuie ; au centre, il flotte.',
  b: 'BANC (en salle).',
  L: 'PAILLASSE (en salle) — quelqu’un a dormi ici. S’enjambe.',
  E: 'ÉTAGÈRE (en salle) — un CONTENANT : les pillards l’emportent (sort pillé).',
  o: 'TONNEAU (en salle) — contenant : part au pillage.',
  K: 'COFFRE (en salle) — contenant : part au pillage.',
  P: 'POUTRE (en salle) — ce qui reste d’une charpente.',
  M: 'MEULE (en cour).',
  a: 'ABREUVOIR (en cour).',
  g: 'GRAVATS (en cour) — LA FOUILLE : un nœud minable (pioche), le seul contenu qu’on EMPORTE. Le sort module son stock.',
  x: 'FRICHE — le champ retourné au sauvage. HORS RÉGION : aucun mur ne s’en dérive.',
  C: 'CHARRETTE — le corps du lieu : elle BLOQUE, on la contourne. Naturelle, non reproductible.',
  U: 'AUTEL — la pierre dressée d’un oratoire. Debout, il survit au feu.',
  m: 'MUR BAS — le pan écroulé : on l’ENJAMBE, il raconte l’enclos disparu.',
  p: 'POUTRE tombée (hors salle) — le chevalement, la charpente éparse.',
  l: 'PAILLASSE à la belle étoile (hors salle) — le couchage d’un camp.',
  F: 'ÂTRE froid d’un camp (hors salle) — s’il est brûlé, le feu ne laisse que lui.',
  t: 'TONNEAU abandonné dehors — contenant : part au pillage.',
  G: 'GRAVATS hors cour — la fouille des petits lieux (ruines, mine, épave).',
  r: 'ROC — le sol d’ANTRE : la troisième région. RIEN ne se dérive de son pourtour : sa clôture se PEINT en MASSIF (H), et la garde exige qu’il ceigne tout — massif ou passage. Jamais de toit.',
  H: 'MASSIF — la roche en masse, INCASSABLE : rien ne l’entame, les hordes la contournent. C’est l’épaisseur qui clôt un antre (≥ 1 tuile pleine) — rendue à l’art de la falaise, plate.',
  R: 'ROCHER — un bloc plein-tuile : il BLOQUE, on le contourne. La pierre posée là depuis toujours.',
  e: 'ÉBOULIS — la pierraille : on l’ENJAMBE, elle raconte l’effondrement sans jamais barrer le pas.',
  Y: 'ARBRE — un VRAI nœud (hache) : bois réel, silhouette d’essence du jeu. À poser HORS des régions : dans une salle, il troue le dallage et le pourtour se referme — l’arbre finit EMMURÉ, irrécoltable.',
  B: 'BUISSON À BAIES — un VRAI nœud (cueillette) : des baies qu’on mange. Hors des régions, comme l’arbre — emmuré s’il troue une salle.',
  // ── Le vocabulaire minier (étage 3 revu : « tout en pièces, partout ») ──
  D: 'CHEVALEMENT — la tour du puits, qui dit « mine » de loin. BLOQUE sa tuile ; du bois d’œuvre : il vieillit, et le feu le prend.',
  n: 'ENTRÉE DE GALERIE — la bouche boisée, MOLLE : c’est un porche, on le franchit. À poser devant le PASSAGE d’un antre : l’entrée qu’on lit comme une porte.',
  I: 'ÉTAI — le poteau de boisage et son chapeau. On ENJAMBE ses calages ; il raconte le toit qui menaçait.',
  w: 'WAGONNET — la berline échouée sur son bout de voie. BLOQUE, on la contourne — la charrette du sous-sol.',
}

/** LA RÉFÉRENCE — le contenu du panneau « ? », par sections. */
const REFERENCE: readonly { titre: string; lignes: readonly string[] }[] = [
  {
    titre: 'Le principe',
    lignes: [
      'Le rendu est LE JEU : chaque édition rebâtit le lieu par le vrai moteur, et ce que tu vois (murs dérivés, toits levés, sorts, lumière) est ce que le jeu montrera.',
      'Le plan est une grille de caractères + des arêtes (brèches, seuils, passages). Les murs ne se posent pas : ils se DÉRIVENT du pourtour des régions.',
      'Le fichier .plan porte ta prose (lignes #) — « Sauver » la préserve, seules les données changent.',
    ],
  },
  {
    titre: 'Le geste',
    lignes: [
      'B peindre · E gommer · M sélection · 1…9, 0 la palette · Alt+clic pipette · clic droit gomme.',
      'Ctrl+Z / Ctrl+Y annuler-refaire — une entrée par GESTE (trait entier, collage, transformation).',
      'Molette zoom (centré curseur) · Espace ou bouton du milieu pan · « ajuster » recadre.',
    ],
  },
  {
    titre: 'La sélection',
    lignes: [
      'M puis tirer un rectangle. Ctrl+C / Ctrl+X / Suppr. Ctrl+V arme le collage : chaque clic ESTAMPE, Échap repose l’outil.',
      '⇋H ⇅V ⟳90° transforment la sélection ou le fragment armé — les arêtes (brèches, seuils, passages) se transforment AVEC.',
      '« + tampon » garde le presse-papier sous un nom, pour tous les lieux.',
    ],
  },
  {
    titre: 'La planche et le monde',
    lignes: [
      'La planche montre rotations, sorts et nuit — rendus réels ; cliquer une vignette applique ses réglages. Le coût est mesuré : trop lent, l’auto se coupe.',
      '« voir le diff » : ce que Sauver écrirait. « historique » : les commits du .plan, cliquables.',
      '« tester en jeu » : la Veillée dev s’ouvre téléporté au lieu — sauve d’abord, le jeu lit le disque.',
    ],
  },
  {
    titre: 'Les brouillons (hors-monde)',
    lignes: [
      '« + nouveau » et « dupliquer » créent dans plans/brouillons/ : éditables ici, JAMAIS compilés dans le monde.',
      'La promotion est un acte de code : déplacer le fichier dans plans/ et écrire l’entrée POI_TYPES (empreinte, effectifs, pres) — puis repasser le recensement.',
    ],
  },
  {
    titre: 'La validation',
    lignes: [
      'La même loi que la suite de tests, à chaque frappe : plan carré à l’empreinte, régions jamais au bord (leurs murs vivent sur la tuile extérieure), arêtes qui percent un vrai contour, côté salle.',
      '« ENFERMÉE » : une case que le dehors ne peut pas rejoindre en marchant (les vraies règles de passage du jeu).',
      'Une faute BLOQUE la sauvegarde ; l’enfermement avertit seulement.',
    ],
  },
]

let bandeEl: HTMLElement | null = null
let outilActifFn: () => string = () => 'peindre'

/** Afficher un texte dans la bande (le survol d'une case de palette passe par là). */
export function montrerAide(texte: string): void {
  if (bandeEl) bandeEl.textContent = texte
}

/** Revenir au texte de REPOS : l'explication de l'outil actif. */
export function reposAide(): void {
  if (bandeEl) bandeEl.textContent = AIDE_OUTILS[outilActifFn()] ?? ''
}

/** Brancher toute l'aide : bande + bulles + panneau. `outilActif` rend l'outil du moment
 *  (le texte de repos de la bande). */
export function brancherAide(outilActif: () => string): void {
  const bande = document.getElementById('aide')!
  bandeEl = bande
  outilActifFn = outilActif
  const repos = reposAide
  repos()

  // Les contrôles : la bande au survol, l'infobulle pour qui s'attarde — le MÊME texte.
  for (const [id, texte] of Object.entries(AIDE_CONTROLES)) {
    const el = document.getElementById(id)
    if (!el || !texte) continue
    if (!el.title) el.title = texte
    el.addEventListener('mouseenter', () => { bande.textContent = texte })
    el.addEventListener('mouseleave', repos)
  }
  // Les OUTILS : au survol du radio, l'explication de CET outil ; au choix, elle reste.
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="outil"]')) {
    const label = radio.closest('label')
    if (!label) continue
    label.title = AIDE_OUTILS[radio.value] ?? ''
    label.addEventListener('mouseenter', () => { bande.textContent = AIDE_OUTILS[radio.value] ?? '' })
    label.addEventListener('mouseleave', repos)
    radio.addEventListener('change', repos)
  }

  // Le panneau « ? » — construit une fois, montré/caché.
  const panneau = document.getElementById('aide-panneau')!
  for (const section of REFERENCE) {
    const h = document.createElement('h3')
    h.textContent = section.titre
    panneau.appendChild(h)
    for (const l of section.lignes) {
      const p = document.createElement('p')
      p.textContent = l
      panneau.appendChild(p)
    }
  }
  const basculer = (): void => {
    panneau.style.display = panneau.style.display === 'none' ? 'block' : 'none'
  }
  document.getElementById('aide-btn')!.addEventListener('click', basculer)
  panneau.addEventListener('click', () => { panneau.style.display = 'none' })
  window.addEventListener('keydown', (e) => {
    const a = document.activeElement
    if (a instanceof HTMLInputElement || a instanceof HTMLSelectElement || a instanceof HTMLTextAreaElement) return
    if (e.key === '?') basculer()
    else if (e.key === 'Escape' && panneau.style.display !== 'none') panneau.style.display = 'none'
  })
}

/** L'aide d'une case de PALETTE — la bande au survol (appelée par `construirePalette`). */
export function aidePalette(car: string): string {
  return AIDE_PALETTE[car] ?? ''
}
