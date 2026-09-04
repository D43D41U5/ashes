/**
 * Vraisemblance des inputs — l'anti-triche LÉGER de L1 (roadmap : « validation de
 * vraisemblance des inputs »). Le serveur reçoit des messages bruts du réseau : on
 * en vérifie la FORME, rien de plus. La LÉGALITÉ d'une action (droits, coûts,
 * portée) est déjà tranchée par /sim, qui émet `action_rejected` — on ne recopie pas
 * ses règles ici. Et le mouvement est autoritatif dans `step` : un client ne peut pas
 * mentir sur sa position, donc inonder d'inputs n'achète rien (on ne garde que le
 * dernier par tick), on borne juste la mémoire.
 *
 * ── POURQUOI LA FORME D'UNE ACTION SE VÉRIFIE CHAMP PAR CHAMP ────────────────────
 *
 * Cette frontière ne vérifiait que `typeof action.type === 'string'`, puis castait le
 * reste du JSON en `PlayerAction`. Le type TypeScript devenait un MENSONGE dès la
 * sortie du socket, et /sim, qui a le droit de croire ses types, calculait dessus.
 * Deux conséquences, toutes deux MESURÉES par fuzz (772 payloads) sur cette frontière :
 *
 *   1. `{type:'attack'}` — enveloppe parfaitement bien formée, `dx`/`dy` simplement
 *      absents — mettait **NaN dans `entity.x` et `entity.y`**. Un NaN dans l'état
 *      déterministe ne lève rien, ne se voit pas, et fait diverger le replay POUR
 *      TOUJOURS : c'est exactement le mode d'échec que l'invariant n°2 existe pour
 *      empêcher, et le seul qui soit silencieux.
 *   2. `{type:'attack', dx:{toString:'nope'}}` et `{type:'build', …, material:'or'}`
 *      LEVAIENT une exception dans le tick. Colyseus n'enveloppe le tick que si la
 *      room définit `onUncaughtException` ; sinon l'exception remonte au `process`, où
 *      le `registerGracefulShutdown` du `Server` l'attrape et **éteint tout le
 *      serveur**. Un message, cinquante joueurs dehors. (`zone-room.ts` pose désormais
 *      aussi ce garde-fou : ceinture ET bretelles, car le prochain trou sera inconnu.)
 *
 * On ne durcit donc PAS /sim (ce serait dupliquer la validation dans le cœur pur) :
 * on rend le type honnête à la frontière. Chaque action déclare sa FORME ; on
 * reconstruit un objet neuf ne portant QUE les champs déclarés — ce qui écarte du
 * même geste les clés parasites et `__proto__`.
 *
 * ── CE QUI EMPÊCHE LA TABLE DE DÉRIVER ──────────────────────────────────────────
 *
 * Une table de validation recopiée à la main pourrit : /sim gagne une action, le
 * serveur l'ignore, et le bug est muet. Ici, RIEN n'est recopié :
 *   • `FORMES` est typée `Record<ActionJouable, FormeDe<…>>` — une action ajoutée à
 *     `PlayerAction`, ou un CHAMP ajouté à une action existante, ne compile plus tant
 *     que sa forme n'est pas déclarée. (Vérifié : l'oubli de `transfer` a été trouvé
 *     par le compilateur, pas par relecture.)
 *   • les valeurs légales sont lues sur les tables EXHAUSTIVES de /sim (`ITEM_WEIGHT`,
 *     `RECIPES`, `WALL_TIERS`) ou déclarées en `Record<Union, true>`.
 *
 * PUR — aucune dépendance Colyseus, testé dans `validate.test.ts`.
 */
import {
  CHAT_MAX_LEN,
  EDGE_BITS,
  ITEM_WEIGHT,
  RECIPES,
  WALL_TIERS,
  type AccessLevel,
  BARRIER_TYPES,
  TRACTABLES,
  type BarrierType,
  type FireZone,
  type PlayerAction,
  type SlotRef,
} from '@ashes/sim'

/** L'input assaini que le serveur applique (miroir de `MoveInput` moins l'action). */
export interface SanitizedInput {
  seq: number
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
  sprint: boolean
  sneak: boolean
  block: boolean
}

function isAxis(v: unknown): v is -1 | 0 | 1 {
  return v === -1 || v === 0 || v === 1
}

/**
 * Le message protocole `join` — le client l'envoie APRÈS avoir posé ses handlers,
 * et c'est LUI qui déclenche le spawn + `ready` (comme le worker solo). Répondre à
 * la connexion Colyseus elle-même exposerait à une course : `ready` pourrait devancer
 * l'enregistrement du `onMessage` client et se perdre.
 */
export function isJoinMessage(msg: unknown): boolean {
  return !!msg && typeof msg === 'object' && (msg as { type?: unknown }).type === 'join'
}

/**
 * Les caractères de CONTRÔLE d'un texte de chat (dont `\n`, `\r`, `\t`) deviennent des
 * espaces : le panneau et les bulles sont du texte Phaser sur UNE ligne, qu'un saut de
 * ligne fait déborder par-dessus le reste de l'historique. On remplace au lieu de jeter
 * — un message reste un message. (Pas de risque d'injection : rien de ce flux ne passe
 * par `innerHTML`, vérifié ; c'est une question de mise en page, pas de sécurité.)
 */
function aplatir(texte: string): string {
  let out = ''
  for (const c of texte) {
    const code = c.codePointAt(0)!
    out += code < 0x20 || code === 0x7f ? ' ' : c
  }
  return out
}

/**
 * Un message de chat : `text` est une chaîne, aplatie sur une ligne, coupée aux
 * `CHAT_MAX_LEN` et rognée. Retourne le texte assaini, ou `null` (message vide ou
 * malformé — on ne relaie rien).
 */
export function sanitizeChat(msg: unknown): string | null {
  if (!msg || typeof msg !== 'object') return null
  const m = msg as Record<string, unknown>
  if (m.type !== 'chat' || typeof m.text !== 'string') return null
  const text = aplatir(m.text).trim().slice(0, CHAT_MAX_LEN)
  return text.length > 0 ? text : null
}

/**
 * Un message d'input brut est-il vraisemblable ? Retourne l'input assaini, ou
 * `null` (le message est jeté). Rejette : mauvaise forme, axes hors {-1,0,1},
 * `seq` non fini, et `seq ≤ lastSeq` (rejeu, doublon réseau, ou séquence qui
 * ne croît pas). Les booléens sont coercés — un client space ne casse rien.
 */
export function sanitizeInput(msg: unknown, lastSeq: number): SanitizedInput | null {
  if (!msg || typeof msg !== 'object') return null
  const m = msg as Record<string, unknown>
  if (m.type !== 'input') return null
  if (!isAxis(m.dx) || !isAxis(m.dy)) return null
  if (typeof m.seq !== 'number' || !Number.isFinite(m.seq)) return null
  if (m.seq <= lastSeq) return null
  return { seq: m.seq, dx: m.dx, dy: m.dy, sprint: !!m.sprint, sneak: !!m.sneak, block: !!m.block }
}

// ── LA FORME D'UNE ACTION ──────────────────────────────────────────────────────────

/** Le genre d'une case de payload. Chaque genre sait dire oui ou non, seul. */
type Genre =
  /** Un entier SÛR de `[min, max]` (identifiant, coordonnée de tuile, case, quantité). */
  | { g: 'entier'; min: number; max: number }
  /** Un réel FINI de `[min, max]` — jamais NaN, jamais ±Infinity. */
  | { g: 'reel'; min: number; max: number }
  /** Un booléen strict (on ne coerce pas : une case optionnelle absente vaut « non »). */
  | { g: 'booleen' }
  /** Une clé d'une table exhaustive de /sim — la liste ne peut pas dériver. */
  | { g: 'clef'; table: Readonly<Record<string, unknown>> }
  /** Une valeur NUMÉRIQUE d'une liste exhaustive de /sim. Le pendant de `clef` pour ce qui
   *  n'est pas une chaîne : l'arête d'un mur mince est un bit (1, 2, 4, 8), pas un nom. Un
   *  intervalle `[1, 8]` aurait laissé passer 3 — deux arêtes d'un coup, là où la pose n'en
   *  admet qu'une : /sim le refuse, mais la frontière n'a pas à lui déléguer une FORME. */
  | { g: 'parmi'; valeurs: readonly number[] }
  /** Un objet imbriqué, validé par sa propre forme (une `SlotRef` de `transfer`). */
  | { g: 'objet'; forme: Record<string, Champ> }

interface Champ {
  genre: Genre
  /** Absent = l'action est refusée. C'est CE point qui laissait passer `{type:'attack'}`. */
  requis: boolean
}

const ID = { g: 'entier', min: 0, max: 2 ** 31 } as const
/** Une coordonnée de TUILE. Très au-delà de toute carte : /sim tranche le hors-carte. */
const TUILE = { g: 'entier', min: 0, max: 1e6 } as const
/** Une quantité d'objets. Au moins 1 : un `count` nul ou négatif n'a aucun sens de jeu. */
const QUANTITE = { g: 'entier', min: 1, max: 1e6 } as const
/** Une case d'inventaire (les sacs font quelques dizaines de cases). */
const CASE = { g: 'entier', min: 0, max: 4095 } as const
/** Une composante de direction (visée, frappe). Bornée mais LARGE : /sim normalise. */
const AXE = { g: 'reel', min: -1e6, max: 1e6 } as const
/** Une position de visée en tuiles réelles (récolte dirigée). */
const VISEE = { g: 'reel', min: -1e6, max: 1e6 } as const

const req = (genre: Genre): Champ => ({ genre, requis: true })
const opt = (genre: Genre): Champ => ({ genre, requis: false })
const clef = (table: Readonly<Record<string, unknown>>): Genre => ({ g: 'clef', table })

/**
 * `Record<Union, true>` plutôt qu'un tableau de littéraux : si `AccessLevel`, `FireZone`
 * ou le `side` d'une `SlotRef` gagne un membre, CE fichier ne compile plus. Une liste
 * recopiée, elle, aurait laissé passer le nouveau membre en silence — et le silence est
 * le défaut qu'on corrige ici.
 *
 * Les BARRIÈRES vont plus loin depuis le registre (2026-08-01) : elles se DÉRIVENT de
 * `pieces.ts` (les pièces dont le geste de pose est le marteau). Une barrière neuve entre
 * ici toute seule — il n'y a plus rien à ne pas oublier.
 */
const BARRIERES = Object.fromEntries(BARRIER_TYPES.map((t) => [t, true])) as Record<BarrierType, true>
const ACCES: Record<AccessLevel, true> = { private: true, village: true, public: true }
const ZONES_FEU: Record<FireZone, true> = { fuel: true, cookIn: true, cookOut: true }
const COTES: Record<SlotRef['side'], true> = { player: true, container: true }
/** Le `kind` d'un `transfer`, lu SUR L'UNION — pas recopié, comme tout le reste ici. */
const CONTENANTS: Record<Extract<PlayerAction, { type: 'transfer' }>['kind'], true> = { structure: true, corpse: true }

/** Une `SlotRef` — l'objet imbriqué que `transfer` porte deux fois. */
const SLOT_REF: Genre = {
  g: 'objet',
  forme: { side: req(clef(COTES)), slot: req(CASE), zone: opt(clef(ZONES_FEU)) },
}

/** Les actions de DÉBOGAGE, refusées en bloc (voir `FORMES`). */
type ActionDebug = `debug_${string}`
/** Toute action de jeu — l'ensemble que le serveur doit savoir valider. */
type ActionJouable = Exclude<PlayerAction['type'], ActionDebug>
/** Une forme déclare UN champ par propriété de l'action (hors `type`). `-?` : même les
 *  optionnelles doivent être déclarées — c'est leur `requis: false` qui les rend facultatives. */
type FormeDe<A> = { [K in Exclude<keyof A, 'type'>]-?: Champ }

/**
 * La forme de CHAQUE action du protocole. Une action absente de cette table est
 * refusée — y compris les `debug_*` : la zone tourne avec `debug: false` (voir
 * `scenario.ts`), donc elles sont déjà inertes, et un serveur de partie n'a aucune
 * raison d'exposer sa surface de débogage au réseau.
 */
const FORMES: { [T in ActionJouable]: FormeDe<Extract<PlayerAction, { type: T }>> } = {
  // ── Village / construction ──
  light_fire: {},
  place_campfire: { tx: req(TUILE), ty: req(TUILE) },
  found_village: { structureId: req(ID) },
  light_torch: { structureId: req(ID) },
  repair: { structureId: req(ID) },
  plant: { structureId: req(ID) },
  harvest_crop: { structureId: req(ID) },
  give: { targetEntityId: req(ID), item: req(clef(ITEM_WEIGHT)), count: req(QUANTITE) },
  build: {
    structure: req(clef(BARRIERES)),
    tx: req(TUILE),
    ty: req(TUILE),
    // `WALL_TIERS` est indexé par `WallMaterial` : un matériau inconnu y déréférençait
    // `undefined[structure]` et LEVAIT — c'est le second crash mesuré.
    material: opt(clef(WALL_TIERS)),
    // L'ARÊTE VISÉE (spec construction R23) : UN des quatre bits, lus sur /sim — jamais
    // recopiés. Absent = pose pleine tuile (sol, toit, et tout le bâti d'avant).
    edges: opt({ g: 'parmi', valeurs: EDGE_BITS }),
  },
  place_component: { tx: req(TUILE), ty: req(TUILE) },
  // POUSSER UNE PORTE (spec construction R26) : une bascule, rien de plus qu'un identifiant.
  toggle_door: { structureId: req(ID) },
  upgrade_fire: {},
  feed_fire: { structureId: opt(ID) },
  upgrade_structure: { structureId: req(ID) },
  demolish: { structureId: req(ID) },
  deposit: { structureId: req(ID), item: req(clef(ITEM_WEIGHT)), count: req(QUANTITE) },
  withdraw: { structureId: req(ID), item: req(clef(ITEM_WEIGHT)), count: req(QUANTITE) },
  set_access: { structureId: req(ID), access: req(clef(ACCES)) },
  invite: { targetEntityId: req(ID) },
  banish: { targetEntityId: req(ID) },

  // ── Économie ──
  harvest: { nodeId: req(ID), aimX: opt(VISEE), aimY: opt(VISEE), whole: opt({ g: 'booleen' }) },
  harvest_charge_start: { nodeId: req(ID), hold: opt({ g: 'booleen' }) },
  harvest_release: {},
  // LE LANCER DE LIGNE (spec `peche.md` D9/E1) : une TUILE, pas un nœud — on pêche l'eau.
  // Bornée comme toute coordonnée reçue du réseau : `TUILE` refuse le hors-carte.
  cast_line: { tx: req(TUILE), ty: req(TUILE) },
  // LA TRACTION (spec `traction.md` T1) : le registre des tractables tient la clef — une
  // charge ajoutée demain (le chariot) valide sans une ligne d'ici.
  atteler: { kind: req({ g: 'clef', table: TRACTABLES }), id: req(ID) },
  detacher: {},
  // LE DÉPEÇAGE (spec `depecage.md` G1/G4) : le maintien porte `hold`, comme la jauge.
  butcher_start: { corpseId: req(ID), hold: opt({ g: 'booleen' }) },
  butcher_stop: {},
  craft: { recipeId: req(clef(RECIPES)) },
  cancel_craft: { index: req(CASE) },
  eat: { item: req(clef(ITEM_WEIGHT)), slot: opt(CASE) },

  // ── Combat ──
  attack: { dx: req(AXE), dy: req(AXE) },
  attack_charge: { dx: req(AXE), dy: req(AXE), hold: opt({ g: 'booleen' }) },
  attack_release: { dx: req(AXE), dy: req(AXE) },
  // RENONCER À LA CHARGE (spec `tir.md` T2) : sans charge utile — on ne renonce pas
  // « dans une direction ». Le client l'émet à chaque perte de focus, la sim est muette
  // s'il n'y a rien d'armé.
  attack_cancel: {},
  bandage: { targetEntityId: opt(ID) },
  loot_corpse: { corpseId: req(ID) },
  // JE ME RELÈVE : sans champ. La sim refuse elle-même un vivant (`respawn`), donc rien
  // à valider ici — le pire qu'un client mal intentionné en tire est un `action_rejected`.
  respawn: {},

  // ── Inventaire ──
  set_active_slot: { slot: req(CASE) },
  move_slot: { from: req(CASE), to: req(CASE) },
  split_slot: { from: req(CASE), to: req(CASE), count: req(QUANTITE) },
  drop_held: {},
  pick_up: { pileId: req(ID) },
  transfer: {
    kind: req(clef(CONTENANTS)),
    containerId: req(ID),
    from: req(SLOT_REF),
    to: req(SLOT_REF),
    count: req(QUANTITE),
  },
}

/**
 * Ce message SE PRÉTEND-IL une action ? Retourne le `type` annoncé, ou `null` si ce n'est
 * pas une enveloppe d'action du tout.
 *
 * Sert à distinguer les deux `null` de `sanitizeAction` — « ce n'était pas une action » et
 * « c'était une action, mais mal formée ». Sans ça, le mur qu'on vient de bâtir avalerait
 * les preuves : un bug de NOTRE client (un `count: 0` parti d'un glisser sur une case vide)
 * disparaîtrait sans laisser de trace, là où il produisait avant un `action_rejected` visible
 * au HUD. La room journalise donc les refus de FORME (voir `ZoneRoom.tick`).
 */
export function actionEnvelopeType(msg: unknown): string | null {
  if (!msg || typeof msg !== 'object') return null
  const m = msg as Record<string, unknown>
  if (m.type !== 'action') return null
  const brut = m.action
  if (!brut || typeof brut !== 'object') return '(sans action)'
  const t = (brut as Record<string, unknown>).type
  return typeof t === 'string' ? t : '(sans type)'
}

/**
 * La table des formes, EXPOSÉE pour le corpus de fuzz de `validate.test.ts` : il en dérive
 * un payload VALIDE par action, puis n'en corrompt qu'un champ à la fois. Un corpus écrit à
 * la main n'aurait pas trouvé le crash de `build` (il demandait une action valide PLUS un
 * `material` illégal — deux conditions), et surtout il aurait vieilli. Celui-ci suit la table.
 */
export const ACTION_FORMES: Readonly<Record<string, Readonly<Record<string, Champ>>>> = FORMES
export type { Champ, Genre }

/**
 * Vérifie une valeur brute contre un genre. Retourne la valeur RETENUE (identique, sauf
 * pour un objet imbriqué qui est reconstruit propre), ou `undefined` si elle ne convient
 * pas. Aucune coercition : on juge ce qui arrive.
 */
function retenir(v: unknown, genre: Genre): unknown {
  switch (genre.g) {
    case 'entier':
      return typeof v === 'number' && Number.isSafeInteger(v) && v >= genre.min && v <= genre.max ? v : undefined
    case 'reel':
      return typeof v === 'number' && Number.isFinite(v) && v >= genre.min && v <= genre.max ? v : undefined
    case 'booleen':
      return typeof v === 'boolean' ? v : undefined
    case 'clef':
      // `hasOwn` et pas `in` : `'__proto__' in table` est VRAI sur tout objet.
      return typeof v === 'string' && Object.hasOwn(genre.table, v) ? v : undefined
    case 'parmi':
      return typeof v === 'number' && genre.valeurs.includes(v) ? v : undefined
    case 'objet':
      return v && typeof v === 'object' && !Array.isArray(v)
        ? selonForme(v as Record<string, unknown>, genre.forme)
        : undefined
  }
}

/**
 * Reconstruit un objet ne portant QUE les champs déclarés par `forme`, chacun vérifié.
 * `undefined` si un champ requis manque ou qu'une valeur ne convient pas.
 */
function selonForme(brut: Record<string, unknown>, forme: Record<string, Champ>): Record<string, unknown> | undefined {
  const propre: Record<string, unknown> = {}
  for (const [nom, champ] of Object.entries(forme)) {
    const v = Object.hasOwn(brut, nom) ? brut[nom] : undefined
    if (v === undefined) {
      if (champ.requis) return undefined
      continue // `exactOptionalPropertyTypes` : une case absente reste ABSENTE.
    }
    const retenu = retenir(v, champ.genre)
    if (retenu === undefined) return undefined
    propre[nom] = retenu
  }
  return propre
}

/**
 * Une action venue du réseau : enveloppe `{type:'action', action:{…}}`, dont le fond est
 * vérifié champ par champ contre `FORMES`. Retourne une action NEUVE — ne portant que les
 * champs déclarés, donc ni clé parasite ni `__proto__` — ou `null` si quoi que ce soit
 * cloche (type inconnu, champ requis absent, valeur du mauvais genre ou hors bornes).
 *
 * Le cast final est le SEUL de la frontière, et il est mérité : à cet endroit précis,
 * chaque champ a été vu.
 */
export function sanitizeAction(msg: unknown): PlayerAction | null {
  if (!msg || typeof msg !== 'object') return null
  const m = msg as Record<string, unknown>
  if (m.type !== 'action') return null
  const brut = m.action
  if (!brut || typeof brut !== 'object') return null
  const a = brut as Record<string, unknown>
  const type = a.type
  if (typeof type !== 'string' || !Object.hasOwn(FORMES, type)) return null

  const champs = selonForme(a, FORMES[type as ActionJouable])
  if (champs === undefined) return null
  return { ...champs, type } as unknown as PlayerAction
}
