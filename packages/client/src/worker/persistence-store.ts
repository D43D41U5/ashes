/**
 * LE COFFRE DE LA VEILLÉE (persistance P1-6) — le disque de l'hôte.
 *
 * IndexedDB, côté Worker : /sim ne connaît ni le disque ni l'horloge (invariant §2),
 * c'est donc l'HÔTE qui écrit et relit. Le contenu jouable est la chaîne `serializeSim`
 * (versionnée dans /sim) ; on l'enveloppe ici avec le peu de métadonnées d'hôte qu'une
 * reprise exige — QUI est l'avatar (`playerId`), le récit déjà vécu (`chronicle`), et
 * quand la partie a été quittée (horloge murale).
 *
 * CINQ CASES depuis le 2026-07-28 (l'écran des mondes). Les clés n'ont pas changé de forme —
 * `slot0`, `slot0:carte` étaient déjà numérotées, elles le sont désormais pour de vrai
 * (`slot{i}`) : une Veillée sauvée AVANT l'écran des mondes se retrouve telle quelle en
 * case 0, sans migration ni perte.
 *
 * TROISIÈME CLÉ PAR CASE : `slot{i}:meta`, une poignée d'octets (seed, jour, horodatages).
 * L'écran des mondes doit dire « jour 14, seed 2026 » de CINQ cases avant que le joueur ne
 * choisisse : sans elle il faudrait relire cinq parties de ~75 ko et les désérialiser — pour
 * afficher deux nombres. Elle s'écrit dans LA MÊME transaction que la partie ; une méta qui
 * pourrait retarder d'une sauvegarde serait un écran qui ment sur le jour atteint.
 */
import { seasonDayAtTick, type SimEvent } from '@braises/sim'
import { SLOT_COUNT, slotValide } from './mondes'

const DB_NAME = 'braises'
const STORE = 'veillee'

const cleSlot = (slot: number): string => `slot${slot}`
/**
 * LA CARTE, DANS SA PROPRE CASE — parce qu'elle ne bouge pas.
 *
 * MESURÉ (2026-07-28, Worker du navigateur) : la carte fait 86,9 % des 69,7 Mo d'une
 * sauvegarde, et sérialiser le tout arrête le monde ~2,5 s toutes les 30 s. Elle naît avec le
 * monde et ne change jamais (garde : `carte-immuable.test.ts`) : on l'écrit UNE FOIS ici, et
 * l'autosave ne réécrit plus que la partie. Une clé à part plutôt qu'un champ du même
 * enregistrement — sinon IndexedDB réécrirait les 60 Mo à chaque `put`, et on n'aurait rien
 * gagné que du travail.
 */
const cleCarte = (slot: number): string => `slot${slot}:carte`
const cleMeta = (slot: number): string => `slot${slot}:meta`

/** Une case hors bornes écrirait une clé que plus rien ne relit ni n'efface. On refuse net. */
function exigeSlot(slot: number): void {
  if (!slotValide(slot)) throw new Error(`case de sauvegarde hors bornes : ${slot}`)
}

/** Ce que l'hôte écrit sur le disque — la sim sérialisée + ce que /sim ne sait pas. */
export interface SaveRecord {
  /**
   * L'état de jeu SANS sa carte, chaîne `serializePartie` (enveloppe versionnée de /sim) —
   * c'est ce que l'autosave réécrit toutes les 30 s. La carte vit dans `slot{i}:carte`.
   *
   * Une sauvegarde d'AVANT la coupe porte ici l'enveloppe entière (`serializeSim`, carte
   * comprise) : `boot()` la relit telle quelle, puis réécrit au format neuf. Une reprise ne
   * se perd pas pour un changement de rangement.
   */
  sim: string
  /** QUELLE entité est l'avatar — sans elle, on reprendrait le monde sans savoir qui l'on est. */
  playerId: number
  /** Le récit déjà vécu (log borné des faits chronique-dignes) : la chronique survit à la reprise. */
  chronicle: SimEvent[]
  /** Horloge MURALE de la dernière sauvegarde (métadonnée d'hôte, pas de /sim). */
  savedAt: number
}

/** Ce que l'ÉCRAN DES MONDES doit savoir d'une case — sans ouvrir la partie. */
export interface SlotMeta {
  /**
   * LE NOM donné à la vallée à sa fondation — le seul texte libre du jeu. `''` quand elle n'en
   * a pas (nommer est facultatif, et les sauvegardes d'avant n'en portent aucun) : l'écran
   * retombe alors sur « VALLÉE N ». Il vit ICI, avec la seed, et pas dans un rangement à part :
   * un nom qui pourrait survivre à l'effacement de son monde irait se recoller au suivant.
   */
  nom: string
  /** La seed semée à la fondation : l'identité de la vallée. 0 = inconnue (voir `metaDepuisSauvegarde`). */
  seed: number
  /** Jour de saison atteint (à partir de 1). 0 = inconnu. */
  seasonDay: number
  /** Horloge murale de la dernière sauvegarde. */
  savedAt: number
  /** Horloge murale de la FONDATION du monde — « commencée il y a trois jours ». */
  createdAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponible'))
  })
}

/** Un `get` isolé, en lecture seule — le motif se répétait quatre fois. */
async function lire<T>(cle: string, quoi: string): Promise<T | null> {
  const db = await openDb()
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(cle)
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
      req.onerror = () => reject(req.error ?? new Error(`lecture ${quoi} échouée`))
    })
  } finally {
    db.close()
  }
}

/** Relit la Veillée sauvée d'une case, ou `null` s'il n'y en a pas. */
export function loadSlot(slot: number): Promise<SaveRecord | null> {
  exigeSlot(slot)
  return lire<SaveRecord>(cleSlot(slot), 'du slot')
}

/** Relit la méta d'une case, ou `null` — l'hôte s'en sert pour ne pas perdre `createdAt` à la reprise. */
export function loadMeta(slot: number): Promise<SlotMeta | null> {
  exigeSlot(slot)
  return lire<SlotMeta>(cleMeta(slot), 'de la méta')
}

/** Relit LA CARTE sauvée d'une case (chaîne `serializeCarte`), ou `null` s'il n'y en a pas. */
export function loadCarte(slot: number): Promise<string | null> {
  exigeSlot(slot)
  return lire<string>(cleCarte(slot), 'de la carte')
}

/**
 * Écrit LA CARTE, LA PARTIE ET SA MÉTA **d'un seul geste** — la carte la première fois seulement.
 *
 * Une transaction, pas deux. Deux écritures séparées laissaient une fenêtre où le disque
 * portait la carte d'un monde et la partie d'un autre : fermer l'onglet là-dedans (~790 ms,
 * le temps d'écrire 60 Mo) coûtait la Veillée entière. IndexedDB sait poser trois clés
 * atomiquement — il suffisait de le lui demander, exactement comme `clearSlot` en efface trois.
 */
export async function saveCarteEtSlot(slot: number, carte: string, record: SaveRecord, meta: SlotMeta): Promise<void> {
  exigeSlot(slot)
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      store.put(carte, cleCarte(slot))
      store.put(record, cleSlot(slot))
      store.put(meta, cleMeta(slot))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('écriture de la carte et du slot échouée'))
    })
  } finally {
    db.close()
  }
}

/**
 * ⚠ INVARIANT : `clearSlot` ne s'appelle QUE hors partie — au boot, ou depuis l'écran des
 * mondes, où aucun Worker ne vit.
 *
 * Les appelants sont `MenuScene` (deep-link `?solo&fresh`, et le bouton EFFACER de l'écran des
 * mondes, monté avant qu'une partie n'existe) et `reopenFreshVeillee` — qui RECHARGE la page
 * pour y arriver. C'est ce qui rend l'appel sûr : effacer les clés pendant qu'un Worker tourne
 * laisserait son `carteEcrite` à `true` alors que l'enregistrement de naissance a disparu du
 * disque, et **chaque autosave suivant écrirait une partie sans sa carte** — au boot d'après,
 * plus rien ne serait relisible. Ce n'est pas une fenêtre d'une seconde comme celle des deux
 * transactions : ce serait une sauvegarde durablement morte. C'est aussi POURQUOI changer de
 * monde depuis le menu pause recharge la page (`reopenMondes`) au lieu de redémarrer la scène :
 * un Worker vivant garde en mémoire l'identité du monde précédent.
 *
 * EFFACE la Veillée sauvée d'une case — « effacer ce monde ». Ne jette pas si la case est vide.
 */
export async function clearSlot(slot: number): Promise<void> {
  exigeSlot(slot)
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(cleSlot(slot))
      // La carte part AVEC la partie : effacer un monde veut dire effacer la vallée, et une
      // carte orpheline serait recollée au prochain état — donc un monde qui ne serait le sien.
      tx.objectStore(STORE).delete(cleCarte(slot))
      tx.objectStore(STORE).delete(cleMeta(slot))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('effacement du slot échoué'))
    })
  } finally {
    db.close()
  }
}

/** Écrit (remplace) la Veillée et sa méta dans une case — même transaction, toujours. */
export async function saveSlot(slot: number, record: SaveRecord, meta: SlotMeta): Promise<void> {
  exigeSlot(slot)
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(record, cleSlot(slot))
      tx.objectStore(STORE).put(meta, cleMeta(slot))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('écriture du slot échouée'))
    })
  } finally {
    db.close()
  }
}

/**
 * Écrit LA SEULE MÉTA — sans toucher à la partie.
 *
 * Le rattrapage des vieilles sauvegardes passe par ici et PAS par `saveSlot` : une Veillée
 * d'avant la coupe carte/partie porte sa carte dans `record.sim`, soit ~70 Mo. La réécrire
 * pour poser une méta de cent octets gèlerait l'écran d'accueil plusieurs secondes — le gel
 * qu'on vient justement de tuer. On ne réécrit que ce qui manquait.
 */
export async function saveMeta(slot: number, meta: SlotMeta): Promise<void> {
  exigeSlot(slot)
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(meta, cleMeta(slot))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('écriture de la méta échouée'))
    })
  } finally {
    db.close()
  }
}

/**
 * DÉDUIRE la méta d'une sauvegarde qui n'en a pas — les Veillées d'avant l'écran des mondes.
 *
 * Fonction PURE (testée sans IndexedDB) : elle ne fait qu'ouvrir l'enveloppe JSON et y lire
 * trois nombres. Elle connaît les DEUX formats d'enveloppe — `{v, partie, …}` (la coupe
 * carte/partie) et `{v, sim}` (avant elle) — parce qu'une sauvegarde d'avant la coupe se
 * reprend encore (`boot()` la relit puis la réécrit au format neuf).
 *
 * NE JETTE JAMAIS : une case illisible doit s'afficher comme occupée (donc effaçable), pas
 * faire échouer l'écran entier. Ce qu'on n'a pas su lire vaut 0, et l'écran dit « jour ? ».
 */
export function metaDepuisSauvegarde(record: SaveRecord): SlotMeta {
  // Une Veillée d'avant l'écran des vallées n'a jamais eu de nom à donner : `''`, et l'écran
  // dira « VALLÉE N ». On n'en invente pas un depuis la seed — un nom est un choix, pas un dérivé.
  const inconnu: SlotMeta = { nom: '', seed: 0, seasonDay: 0, savedAt: record.savedAt ?? 0, createdAt: record.savedAt ?? 0 }
  let parsed: unknown
  try {
    parsed = JSON.parse(record.sim)
  } catch {
    return inconnu
  }
  if (typeof parsed !== 'object' || parsed === null) return inconnu
  const env = parsed as { partie?: unknown; sim?: unknown }
  const etat = (env.partie ?? env.sim) as { seed?: unknown; tick?: unknown; calendarScale?: unknown } | undefined
  if (typeof etat !== 'object' || etat === null) return inconnu
  const nombre = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const tick = nombre(etat.tick)
  const echelle = nombre(etat.calendarScale)
  return {
    nom: '',
    seed: nombre(etat.seed),
    // Sans échelle de calendrier, le jour ne se calcule pas : on dit « inconnu » plutôt que
    // d'inventer un jour 1 sur une saison bien avancée.
    seasonDay: echelle > 0 ? seasonDayAtTick(tick, echelle) : 0,
    savedAt: record.savedAt ?? 0,
    createdAt: record.savedAt ?? 0,
  }
}

/**
 * L'ÉTAT DES CINQ CASES pour l'écran des mondes — `null` = case vide.
 *
 * Une seule transaction de lecture pour les cinq métas, et `getKey` (pas `get`) pour savoir
 * si une case est occupée : on ne charge PAS les parties, dont chacune pèse ~75 ko.
 *
 * RATTRAPAGE : une case occupée sans méta est une Veillée d'avant l'écran des mondes. On la
 * déduit de la sauvegarde (`metaDepuisSauvegarde`) et on l'ÉCRIT — pour que la relecture de
 * ~75 ko n'ait lieu qu'une fois dans la vie de cette sauvegarde. Si l'écriture échoue (disque
 * plein, mode privé), tant pis : on affiche quand même, on recommencera au prochain passage.
 */
export async function listSlots(): Promise<(SlotMeta | null)[]> {
  const db = await openDb()
  let metas: (SlotMeta | null)[]
  let occupees: boolean[]
  try {
    ;({ metas, occupees } = await new Promise<{ metas: (SlotMeta | null)[]; occupees: boolean[] }>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const m: (SlotMeta | null)[] = new Array<SlotMeta | null>(SLOT_COUNT).fill(null)
      const o: boolean[] = new Array<boolean>(SLOT_COUNT).fill(false)
      for (let i = 0; i < SLOT_COUNT; i++) {
        const slot = i
        const rm = store.get(cleMeta(slot))
        rm.onsuccess = () => {
          m[slot] = (rm.result as SlotMeta | undefined) ?? null
        }
        const rk = store.getKey(cleSlot(slot))
        rk.onsuccess = () => {
          o[slot] = rk.result !== undefined
        }
      }
      tx.oncomplete = () => resolve({ metas: m, occupees: o })
      tx.onerror = () => reject(tx.error ?? new Error('lecture des cases échouée'))
    }))
  } finally {
    db.close()
  }

  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    // Une méta orpheline (case effacée à la main, ou effacement partiel) ne fait pas un monde :
    // c'est la PARTIE qui dit qu'une case est occupée.
    if (!occupees[slot]) {
      metas[slot] = null
      continue
    }
    if (metas[slot]) continue
    const rec = await loadSlot(slot)
    if (!rec) {
      metas[slot] = null
      continue
    }
    const meta = metaDepuisSauvegarde(rec)
    metas[slot] = meta
    try {
      await saveMeta(slot, meta) // la méta SEULE — surtout pas la partie (§ `saveMeta`)
    } catch {
      /* le rattrapage est un confort, pas une promesse : on rejouera au prochain passage */
    }
  }
  return metas
}
