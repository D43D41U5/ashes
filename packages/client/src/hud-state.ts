/**
 * Le contrat typé du registry Phaser entre WorldScene (écrivain) et UIScene
 * (lecteur). Le registry de Phaser est stringly-typed (`get` renvoie `any`) :
 * on le canalise ici par une interface exhaustive + deux helpers, pour que
 * toute clé et tout type soient vérifiés à la compilation. Les scènes ne
 * doivent JAMAIS appeler `registry.set/get` directement — uniquement
 * `setHud`/`getHud`.
 */
import type { BarrierType, ChronicleEntry, ChronicleVolume, ComponentType, RecipeId, StationFonction, CraftOrder, Entity, GameTime, Inventory, ItemBag, ItemId, PlayerAction, SkillId, Village, VillageTask, WallMaterial, WorldMap } from '@ashes/sim'
import type Phaser from 'phaser'
import type { Brouillard } from './render/fog'

/**
 * LES PIÈCES STRUCTURELLES du MENU DU MARTEAU (spec construction R20, décision
 * d'Alexis) : les SEULES choses qu'on pose au marteau. Le coffre, le four et
 * l'établi n'en sont PAS — ce sont des objets qu'on tient et pose (flux feu de camp).
 *
 * DÉRIVÉ du registre de /sim depuis le 2026-08-01 (`BarrierType` = les pièces dont le
 * geste de pose est le marteau) : le client ne tient plus sa propre copie de la liste.
 */
export type Buildable = BarrierType

/** Ce qu'un clic gauche peut POSER au sol : une PIÈCE STRUCTURELLE (marteau en main),
 *  le FEU DE CAMP (`'fire'`), un COMPOSANT (enclume, four…) ou le COFFRE qu'on tient.
 *  Le fantôme et le résolveur de clic en dérivent — une notion, deux consommateurs. */
export type Placeable = Buildable | 'fire' | ComponentType | 'chest'

/**
 * CE QUE LE LIEU OFFRE — le meilleur palier de chaque fonction à portée de bras.
 *
 * Remplace la liste `StationId[]` (2026-08-01). Elle nommait des OBJETS (`'workshop'`,
 * `'four_acier'`), donc toute station neuve obligeait à venir l'y inscrire — et la note
 * « stations absentes » de l'écran perso en tenait une SECONDE copie, restée à trois
 * entrées quand la sim en comptait cinq : le four d'acier et l'atelier lourd ne pouvaient
 * structurellement pas être annoncés absents. Ici on publie une CAPACITÉ, que la recette
 * interroge par `requiert` — plus rien à recopier.
 *
 * Absent = aucune station de cette fonction à portée.
 */
export type CapacitesEnPortee = Partial<Record<StationFonction, number>>

/** Les onglets de l'écran personnage : ce qu'on PORTE (sac, artisanat, paperdoll), ce
 *  qu'on MAÎTRISE (métiers), et où l'on EST (la carte, qui s'ouvre aussi à M). */
export type CharacterTab = 'perso' | 'metiers' | 'carte'

/** Le conteneur ouvert, RÉSOLU depuis le snapshot (WorldScene) pour que UIScene
 *  n'ait pas à fouiller structures/cadavres. `null` dès qu'il disparaît (dépouille
 *  vidée → effacée) : c'est le signal qui referme proprement le panneau de loot. */
/** Une ligne du chat de proximité : qui a parlé (entityId), quoi, si c'est MOI, et quand. */
export interface ChatLine {
  from: number
  text: string
  self: boolean
  /** Horloge de rendu à la réception — sert au fondu des vieux messages. */
  at: number
}

export interface OpenContainerView {
  kind: 'structure' | 'corpse'
  id: number
  inv: Inventory
  title: string
}

/** Ce que le MODAL DU FEU affiche (spec feu-station S18), résolu contre le snapshot chaque frame. */
export interface FireView {
  structureId: number
  /** Le titre du panneau : « FEU DE CAMP » (feu libre) ou « FOYER » (feu d'un village). */
  title: string
  /** allumé / braises / éteint — dérivé du combustible + tick (source unique : `fireStateAt` du sim). */
  state: import('@ashes/sim').FireState
  /** COMBUSTIBLE : 3 slots de bois, le TEMPS restant (ticks) avant extinction, la progression de
   *  consommation de la bûche EN COURS (0..1) et l'index de la case qui brûle (l'indicateur). */
  fuel: ({ item: import('@ashes/sim').ItemId; count: number } | null)[]
  fuelTimeRemaining: number
  fuelBurnProgress: number
  fuelBurnSlot: number
  /** CUISSON : 3 ENTRÉES (STACK d'aliments — `count` — + progression 0..1 de l'unité qui cuit + prêt)
   *  et 3 SORTIES (cuit + sous-produit, avec compte). Ce sont de vraies cases-conteneurs (glisser). */
  cookIn: ({ item: import('@ashes/sim').ItemId; count: number; progress: number; ready: boolean } | null)[]
  cookOut: ({ item: import('@ashes/sim').ItemId; count: number } | null)[]
  /** Le bouton contextuel : fonder un Foyer ici, ou monter le palier du Foyer — ou rien (spec S19). */
  action:
    | { kind: 'found'; label: string; /** La raison qui l'interdit, ou `null`. Voir `empechementDeFonder`. */ empeche: string | null }
    | { kind: 'upgrade'; label: string; affordable: boolean }
    | null
}

/** Le verdict d'un village à la fin de la saison (spec saison R4, événement `season_ended`). */
export interface SeasonVerdict {
  villageId: number
  name: string
  archetype: 'foyer' | 'meute' | 'neutre'
  score: number
  outcome: string
}

/** Une propriété par clé du registry — la seule source de vérité des clés. */
export interface HudState {
  /** La vallée est-elle générée ? Posé à `false` au boot de WorldScene, à `true`
   *  quand l'hôte a livré son `ready` (carte, spawn, calendrier) et que les couches
   *  de rendu sont montées. C'est le drapeau qui garde le HUD : tant qu'il est faux,
   *  UIScene ne montre QUE son écran de chargement. */
  worldReady: boolean
  /** Où en est la naissance du monde — `done` passes achevées sur `total`, et le nom
   *  de celle qui commence. `done/total` EST la barre de l'écran de chargement (on ne
   *  la brode pas) ; `phase`, elle, ne s'affiche jamais — l'écran raconte autre chose
   *  (ui/loading.ts). Absent tant que l'hôte n'a rien dit. */
  loadProgress: { phase: string; done: number; total: number }
  /** Heure de jeu du dernier snapshot. */
  time: GameTime
  /** Nom de la zone où se trouve l'avatar (undefined hors zone nommée). */
  zone: string | undefined
  /** Nombre de membres de mon village (0 = pas de village). */
  village: number
  /** Tableau des tâches de mon village. */
  tasks: VillageTask[]
  /** Archétype de mon village (null = pas de village). */
  archetype: Village['archetype'] | null
  /** Chaleur du Feu de mon village. */
  villageWarmth: number
  inv: Inventory
  /** Case tenue en main (`-1` = mains nues) — surligne la ceinture (spec inventaire R8). */
  activeSlot: number
  /** LA FILE DE CRAFT de mon avatar (spec craft-file F15-F16). Elle vient du
   *  snapshot, TELLE QUELLE : le client n'a aucun décompte local — un timer client
   *  divergerait de la sim, et c'est exactement ce que la file dans `SimState`
   *  est là pour empêcher. */
  craftQueue: CraftOrder[]
  /** Les stations à portée d'interaction. MIROIR du client (comme le surlignage de
   *  visée) : il grise les recettes qu'on ne peut pas lancer ici. La sim reste seule
   *  juge — si elle refuse malgré le miroir, c'est elle qui a raison. */
  stationsInRange: CapacitesEnPortee
  /**
   * LES RECETTES DÉCOUVERTES (D2) — lues du snapshot, jamais calculées ici. Le catalogue
   * n'affiche que ça : ce qu'on n'a jamais rencontré n'existe pas encore pour le joueur.
   */
  seen: RecipeId[]
  hunger: number
  /** Température du corps de l'avatar (0-100 ; sous 20, le froid mord). */
  temperature: number
  skills: Partial<Record<SkillId, number>>
  hp: number
  stamina: number
  wounds: Entity['wounds']
  /** Pièce structurelle armée dans le MENU DU MARTEAU (spec construction R20) —
   *  `null` = DÉSARMÉ, et c'est l'état de départ : le clic nu ne bâtit jamais. Posé
   *  à `null` dès qu'on range le marteau (R21). */
  selected: Buildable | null
  /** Le palier de matériau choisi pour mur/porte (spec construction R8) : bois par
   *  défaut. La pose neuve le prend ; cliquer un mur existant l'améliore vers lui. */
  buildMaterial: WallMaterial
  /**
   * LE MODE DÉMOLIR du menu du marteau (décision d'Alexis, 2026-08-01). Armé, le clic
   * DÉTRUIT au lieu de poser — et seulement MES constructions (`demolishTargetAt`).
   *
   * EXCLUSIF de `selected` : armer une pièce éteint la démolition, et l'inverse. On ne
   * peut donc jamais être « en train de poser un mur » et « en train de casser » à la
   * fois — le fantôme et le surlignage rouge ne se disputent pas le clic. Éteint dès
   * qu'on range le marteau (R21), comme la pièce armée.
   */
  demolir: boolean
  /**
   * LE MARTEAU EST-IL EN MAIN ? (demande d'Alexis, 2026-08-04.)
   *
   * DISTINCT de `selected`, qui ne vaut que si une PIÈCE est armée : on tient le marteau
   * bien avant d'avoir choisi quoi poser, et c'est précisément à ce moment-là qu'on se
   * demande jusqu'où le domaine va. C'est ce drapeau qui allume la frontière du carré
   * (`carre-village.ts`) — pas la pièce armée, qui n'allume que le tapis.
   *
   * Il vaut la MÊME condition que l'ouverture du menu du marteau (UIScene) : outil en
   * main, hors menu personnage, hors carte. Une seconde condition écrite ailleurs
   * laisserait le liseré allumé sous la carte ouverte.
   */
  marteau: boolean
  /**
   * L'ARÊTE ARMÉE (spec construction R23) : le bit N/E/S/O sur lequel le prochain mur ou la
   * prochaine porte se posera, que `A`/`E` font tourner. Sol et toit l'ignorent — ils prennent
   * la tuile.
   *
   * ELLE VIT ICI ET PAS DANS `WorldScene` parce qu'elle a DEUX lecteurs qui ne se parlent pas :
   * le fantôme (qui la dessine) et le résolveur de clic (qui l'envoie). Deux copies dériveraient
   * le jour où l'une se remet à zéro et pas l'autre — on poserait alors un mur ailleurs que là
   * où on le voit, et rien à l'écran ne dirait pourquoi.
   *
   * Elle PERSISTE d'une pose à l'autre : on bâtit un mur droit en cliquant plusieurs fois, sans
   * retoucher au clavier. C'est le comportement de Rust, et c'est ce qui rend la rotation
   * supportable — sinon chaque segment demanderait de la re-viser.
   */
  buildEdge: number
  /** Un feu de camp LIBRE à portée qu'on pourrait promouvoir en foyer (un `fire`
   *  villageId 0 que JE possède, et je n'ai pas encore de village), ou `null`. Posé
   *  par WorldScene chaque frame ; lu par UIScene, qui affiche alors la fenêtre du
   *  bas « Fonder un village ici ? ». Le clic Oui envoie `found_village`. */
  foundableFire: { structureId: number } | null
  /** LES RÉFUGIÉS À PORTÉE (V2-25, GDD §520) : le groupe le plus proche à portée. WorldScene
   *  le pose ; UIScene en tire la fenêtre à trois gestes (recruter/nourrir/dépouiller).
   *  `null` = aucun groupe à portée. */
  refugeesNearby: { groupId: number; count: number } | null
  /** LE FEU AMÉLIORABLE (V0-3) : je suis Chef, à portée de MON Feu, palier < max.
   *  Posé par WorldScene chaque frame ; UIScene en tire la fenêtre « Améliorer le
   *  Feu ». `affordable` grise le bouton et fait APPRENDRE le coût (on le voit avant
   *  de pouvoir payer). `null` = pas ici, ou pas Chef, ou palier maximal. */
  upgradableFire: { villageId: number; tier: number; nextCost: ItemBag; affordable: boolean } | null
  /** LE JOUEUR VIENT DE MOURIR (audit UI/UX P1) — un ONE-SHOT horodaté (patron de
   *  `error`) : UIScene lève le voile de mort quand `at` change. `cause` : froid/faim/
   *  null (combat) ; `byEntityId` + `killerType` (le monstre du snapshot, ou null)
   *  résolvent la ligne exacte. `null` = pas de mort en attente. */
  deathMoment: { cause: 'cold' | 'hunger' | 'lightning' | null; byEntityId: number; killerType: string | null; hadLoot: boolean; at: number } | null
  /**
   * LE VOILE DE MORT EST-IL ENCORE LEVÉ ? (décision d'Alexis, 2026-08-20, question ⑥)
   *
   * Depuis que le voile attend un GESTE — « SE RELEVER » — et non plus un minuteur, la main
   * du joueur doit attendre la même chose. Elle lui était rendue à `DEATH_VEIL_MS`, pile
   * quand le voile se retirait : les deux étaient le même instant. Si l'un devient un geste
   * et pas l'autre, le joueur se remet à marcher DERRIÈRE un voile opaque qui couvre tout.
   * UIScene le pose (elle possède le voile), WorldScene le lit.
   */
  deathVeilOpen: boolean
  /** LE TRAQUEUR DE DÉPOUILLE (mort-suite 2) : le repère d'écran vers le sac tombé — position
   *  (px écran, HUD non zoomé), angle de la flèche, `onScreen` (la dépouille est visible →
   *  cacher la flèche), et le compte à rebours avant décantation. `null` = rien à suivre. */
  corpseHint: { onScreen: boolean; x: number; y: number; angle: number; secs: number } | null
  /** LE MENU PERSONNAGE (TAB) est-il ouvert ? C'est l'écran qui rassemble ce que le
   *  personnage EST et ce qu'il PEUT : son sac, sa ceinture, son artisanat — et
   *  demain ses vêtements et ses maîtrises. Il s'appelait « inventaire » quand il
   *  n'y avait qu'une grille dedans (décision utilisateur, 2026-07-13). */
  characterMenuOpen: boolean
  /** QUEL ONGLET de l'écran personnage est ouvert. C'est l'ENTRÉE (TAB pose `perso`,
   *  M pose `carte`, un clic d'en-tête pose le sien) ; `mapOpen` en est la SORTIE,
   *  dérivée chaque frame par UIScene. Une seule vérité : impossible que la carte
   *  soit ouverte sans son onglet, ou l'inverse. */
  characterTab: CharacterTab
  /** LE CHAMP DE RECHERCHE DU CRAFT A LE CLAVIER. Tant qu'il l'a, plus une touche
   *  ne part au jeu : taper « hache » ferait sinon MARCHER le personnage (Z, Q, S,
   *  D sont des lettres) et « journal » ouvrirait le journal. Un champ de saisie
   *  qui ne prend pas le clavier n'est pas un champ de saisie. */
  uiTyping: boolean
  /** LA BARRE DE CHAT A LE CLAVIER (chat de proximité). Même garde que `uiTyping`
   *  mais posée par WorldScene (le chat vit là) : tant qu'on tape un message, plus
   *  aucune touche ne part au jeu. Séparée d'`uiTyping` car UIScene écrase ce dernier
   *  depuis le champ de craft — les deux drapeaux se lisent côte à côte. */
  chatTyping: boolean
  /** L'HISTORIQUE du chat de proximité (façon WoW) — WorldScene POSE, le panneau
   *  d'UIScene LIT et affiche. Borné (les vieux messages tombent). */
  chatLog: ChatLine[]
  /** Le message EN COURS de saisie, ou `null` si la ligne de saisie est fermée.
   *  WorldScene le tient (il a le clavier et l'hôte) ; le panneau d'UIScene l'affiche. */
  chatDraft: string | null
  /** Le conteneur ouvert à côté du sac (coffre/cadavre), ou null. Posé par
   *  input-bindings à l'ouverture de TAB (le plus proche à portée). */
  openContainer: { kind: 'structure' | 'corpse'; id: number } | null
  /** Son contenu, résolu chaque snapshot par WorldScene (null s'il a disparu). */
  openContainerView: OpenContainerView | null
  /** LE FEU OUVERT au modal (spec feu-station S17) — posé par E (feu visé, à portée), null sinon. */
  openFire: { structureId: number } | null
  /** Sa vue résolue chaque snapshot par WorldScene (état, combustible, cuisson, bouton) ;
   *  null quand le feu disparaît ou que le joueur s'en éloigne (le modal se referme seul). */
  openFireView: FireView | null
  /** File des récoltes reçues de la sim (WorldScene POSE, UIScene draine) : les
   *  toasts « +2 BOIS (14) ». Une file, pas une valeur — deux récoltes peuvent
   *  tomber dans le même snapshot. */
  pickups: { item: ItemId; count: number }[]
  /** File des FABRICATIONS achevées (event `item_crafted` sur moi) : un bandeau à part,
   *  plus lourd qu'une récolte. Même canal POSE/draine que `pickups`. */
  crafts: { item: ItemId }[]
  /** File des MONTÉES DE MÉTIER (event `skill_level_up` sur moi) : le plus gros toast. */
  levelUps: { skill: SkillId; level: number }[]
  /** COMPTEUR DE DÉVOILEMENT du brouillard (spec R19). WorldScene l'incrémente quand la marche
   *  a découvert du neuf ; l'écran de carte s'en sert pour ne repeindre son calque QUE là —
   *  repeindre 40 000 cellules à chaque frame pour un pas qui ne révèle rien serait absurde. */
  fogVersion: number
  /** Le brouillard lui-même, publié PAR RÉFÉRENCE (l'objet est muté en place par la marche).
   *  L'écran de carte le lit pour peindre son calque ; `fogVersion` lui dit quand le relire. */
  fog: Brouillard | null
  /** DERNIÈRE SAUVEGARDE de l'hôte — une valeur, pas une file (seul le dernier état compte).
   *  `at` = horloge murale (pour dater), `shownAt` = horloge Phaser (pour le fondu),
   *  `ok` = false si l'écriture a ÉCHOUÉ, ce qu'il faut dire et non taire. */
  saveState: { at: number; ok: boolean; shownAt: number } | null
  /** File d'actions posées par UIScene (l'écran d'inventaire) — WorldScene la
   *  draine et parle seule à l'hôte (l'UI ne connaît pas le transport). */
  pendingActions: PlayerAction[]
  /** Journal (J) ouvert à la demande. */
  journalOpen: boolean
  /** La carte plein écran est-elle à l'écran ? DÉRIVÉE (UIScene, chaque frame) de
   *  `characterMenuOpen && characterTab === 'carte'` — la carte est un ONGLET de l'écran
   *  personnage. Personne d'autre ne l'écrit ; tout le reste du jeu (fantômes de
   *  construction, molette, clic monde) continue de la LIRE comme avant. */
  mapOpen: boolean
  /** Le menu PAUSE (ESC) : ouvert = le monde solo se fige (l'hôte est mis en pause) et
   *  le menu (reprendre / contrôles / son / nouvelle Veillée) couvre l'écran. */
  menuOpen: boolean
  /** QUEL MONDE SOLO on joue — la case du disque et sa seed, publiées au `ready`. UIScene en a
   *  besoin pour les deux sorties : « rouvrir la vallée » (stèle) et « retour au menu principal »
   *  (menu pause). Absent en multi : le monde n'est pas sur ce disque. */
  veillee: { slot: number; seed: number }
  /** LE JOUEUR DEMANDE À QUITTER vers le menu principal (menu pause). WorldScene la sert :
   *  il fait ÉCRIRE la partie, puis recharge la page (voir `quitEnCours`). Sens unique — rien
   *  ne la remet à faux, la page part. */
  quitMondes: boolean
  /** Le curseur de VOLUME maître (0..1) — posé par WorldScene depuis le moteur audio, réglé
   *  par le curseur du menu pause. WorldScene l'observe et l'applique à `audioFx` (le moteur
   *  vit là ; le menu, dans UIScene, passe par le registre). */
  audioVolume: number
  /** La carte du monde, publiée une fois au `ready` — sert au rendu de la carte
   * plein écran et au lookup de zone/POI sous le curseur (`zoneAt`). */
  mapData: WorldMap
  /** Les lieux que MON joueur connaît (spec lieux R1) — index dans `mapData.zones`.
   *  La carte plein écran ne montre que ceux-là : le terrain est offert, les lieux se gagnent. */
  knownPois: number[]
  /** Position LOGIQUE de l'avatar (tuiles) — le marqueur « tu es ici » de la carte. */
  playerPos: { x: number; y: number }
  /** La chronique de la saison — entrées structurées `{ jour, texte, poids }`
   *  (le rendu à 3 poids s'y appuie ; voir chronicle.ts côté /sim). Les entrées PLATES du
   *  flux vif — la stèle de fin de saison (multi) y lit encore. */
  chronicle: ChronicleEntry[]
  /**
   * LA MÉMOIRE DES HIVERS (saison-sans-fin T5) : les années RÉVOLUES, scellées par l'hôte (des
   * textes, relisibles à jamais), et les années VIVES, partitionnées par le client depuis son
   * flux — la même fonction pure des deux côtés. Le journal les lit à la suite, avec un
   * en-tête par an. Disjointes par construction : l'hôte scelle ce qui précède le flux.
   */
  volumesScelles: ChronicleVolume[]
  volumesVifs: ChronicleVolume[]
  /**
   * LES DEUX FILES DES BANDEAUX (audit UX 2026-08-20, P0.2 — défaut cardinal).
   *
   * `alertes` (le refus, le danger) et `conseils` (l'apprentissage) sont des FILES, plus des
   * cases uniques. Le patron est celui de `publishPickup`, et son commentaire disait déjà
   * pourquoi : « une FILE, pas une valeur — aucune ne doit être écrasée ». Le canal d'alerte
   * ne l'avait jamais eu : HUIT émetteurs se partageaient une case de 2,5 s, et le second
   * message effaçait le premier — y compris le départ de l'Arche derrière un refus de pose.
   */
  alertes: string[]
  conseils: string[]
  /**
   * LA DERNIÈRE ALERTE, EN MIROIR — pour le DIAGNOSTIC, jamais pour l'affichage.
   *
   * Elle n'est plus la source du bandeau (c'est `alertes` qui l'est) mais elle reste écrite,
   * et c'est délibéré : HUIT sondes du banc lisent `registry.get('error').reason` pour savoir
   * pourquoi la sim vient de refuser — dont six dans le scénario `construction`. Une file
   * DRAINÉE ne peut pas les servir : à l'instant où elles regardent, le bandeau l'a déjà
   * consommée. Un loquet de diagnostic à côté d'un transport, ce n'est pas deux vérités —
   * c'est une trace, et elle est nommée comme telle.
   */
  error: { reason: string; at: number }
  /** LE CONSEIL (audit UI/UX P2-7) : le canal d'apprentissage, distinct de l'alerte
   *  rouge. Encre neutre, posé en haut, tenue longue — on APPREND un verbe, on n'est pas
   *  réprimandé. Ne partage PLUS la bulle rouge des refus/dangers/récit : quatre registres
   *  sémantiques, un seul canal, aucune hiérarchie — c'était le défaut. */
  hint: { text: string; at: number }
  /** LA RUPTURE : l'hôte est mort (exception du Worker, transport rompu, protocole
   *  désaccordé). Plus aucun snapshot n'arrivera — ce message-là ne s'efface JAMAIS et
   *  ouvre l'écran de rupture (ui/fatal.ts), avec son bouton de rechargement. */
  fatal: { reason: string }
  /** Dernière alarme de mon village (flash rouge). */
  alarm: { at: number }
  /** Les VERDICTS de fin de saison + l'id de MON village (pour couronner le mien). `null` tant
   *  que la saison n'est pas finie — sa non-nullité EST le signal « saison finie ». Lu par
   *  l'écran de fin de saison (ui/season-veil). */
  seasonVerdicts: { verdicts: SeasonVerdict[]; myVillageId: number | null } | null

  // ─── Mode debug (DEV uniquement — voir scenes/world/debug-bindings.ts) ───
  /** P : le mode debug est-il armé ? (rien d'autre ne s'affiche ni ne répond sans lui) */
  debugOn: boolean
  /** État courant des leviers, pour l'affichage (l'autorité, elle, est dans /sim). */
  debugGod: boolean
  debugSpeed: number
  /** F5 : essai éclairage dynamique — arbres normal-mappés (decisions.md 2026-07-20). */
  debugLighting: boolean
  /** Ce que l'overlay affiche — publié par WorldScene, seule à connaître le relief. */
  debugInfo: {
    tick: number
    fps: number
    /** Tuile sous le curseur (après correction du relief) et ce qu'on y trouve. */
    hover: { tx: number; ty: number; terrain: string; zone: string } | null
  }
  /** Demande de TP posée par UIScene (clic sur la carte) — consommée par WorldScene. */
  debugTeleport: { x: number; y: number; at: number }
}

type Registry = Phaser.Data.DataManager

export function setHud<K extends keyof HudState>(registry: Registry, key: K, value: HudState[K]): void {
  registry.set(key, value)
}

/** `undefined` tant que WorldScene n'a pas encore écrit la clé. */
export function getHud<K extends keyof HudState>(registry: Registry, key: K): HudState[K] | undefined {
  // Seule coercition autorisée sur le registry : le point de passage typé.
  return registry.get(key) as HudState[K] | undefined
}

/**
 * TOUTES LES CLÉS DU HUD — exhaustive PAR CONSTRUCTION, et c'est tout l'intérêt du type :
 * ajouter un champ à `HudState` sans l'ajouter ici ne compile pas. Une liste tenue à la main
 * aurait dérivé au premier champ suivant, et `resetHud` aurait laissé fuiter précisément
 * celui-là — en silence.
 */
export const CLES_HUD: Record<keyof HudState, true> = {
  worldReady: true, loadProgress: true, time: true, zone: true, village: true,
  tasks: true, archetype: true, villageWarmth: true, inv: true, activeSlot: true,
  craftQueue: true, stationsInRange: true, seen: true, hunger: true, temperature: true, skills: true,
  hp: true, stamina: true, wounds: true, selected: true, buildMaterial: true, buildEdge: true, demolir: true,
  marteau: true,
  foundableFire: true, refugeesNearby: true, upgradableFire: true, deathMoment: true, deathVeilOpen: true, corpseHint: true,
  alertes: true, conseils: true,
  characterMenuOpen: true, characterTab: true, uiTyping: true, chatTyping: true, chatLog: true,
  chatDraft: true, openContainer: true, openContainerView: true, openFire: true, openFireView: true,
  pickups: true, crafts: true, levelUps: true, fogVersion: true, fog: true,
  saveState: true, pendingActions: true, journalOpen: true, mapOpen: true, menuOpen: true,
  veillee: true, quitMondes: true, audioVolume: true, mapData: true, knownPois: true,
  playerPos: true, chronicle: true, volumesScelles: true, volumesVifs: true, error: true, hint: true, fatal: true,
  alarm: true, seasonVerdicts: true, debugOn: true, debugGod: true, debugSpeed: true,
  debugLighting: true, debugInfo: true, debugTeleport: true,
}

/**
 * EFFACE tout ce que la partie précédente a écrit — à appeler quand on revient au menu.
 *
 * Le registry est celui du JEU, pas de la scène : il survit à l'arrêt de WorldScene comme il
 * survivait autrefois… à rien, puisque quitter rechargeait la page. Depuis que le retour aux
 * vallées se fait SANS rechargement (2026-07-29), c'est lui la mémoire qui traverse, et une
 * vallée neuve héritait sinon du savoir de l'ancienne (`worldReady` déjà vrai, la chronique,
 * la carte, le brouillard).
 *
 * On EFFACE les clés au lieu de leur poser une valeur de repos : `undefined` est déjà l'état
 * documenté par `getHud` (« tant que WorldScene n'a pas écrit »), c'est exactement celui d'une
 * page fraîche, et ça évite d'inventer une valeur vide à `mapData` — qui n'en a pas.
 */
export function resetHud(registry: Registry): void {
  for (const cle of Object.keys(CLES_HUD)) registry.remove(cle)
}
