/**
 * ═══ LE CACHE DES CARTES DE TEST — la même carte, générée une fois au lieu de cinquante-neuf ═══
 *
 * ── LE CONSTAT (mesuré le 2026-08-25, compteur posé dans `generateZonedTerrain`) ────────────────
 *
 * La suite `/sim` appelle `generateZonedTerrain` **59 fois pour 21 résultats distincts** : 38
 * appels sur 59 refont, à l'identique, une carte qu'un autre fichier vient de faire.
 *
 *     13 × (2026, 50, vallee)    9 × (7, 50, vallee)    8 × (42, 50, vallee)
 *      6 × (2026, 50, racine)    3 × (2026, 8, racine)  …
 *
 * Une carte `(seed, 50, 'vallee')` pèse 3,75 M de tuiles et coûte **8,5 s** ; la carte du monde
 * joué `(seed, 8, 'racine')` en coûte 1,3. Total : **~445 s de CPU sur les 1 204 s de la suite —
 * 37 %**, corroboré par vitest lui-même (`collect 468 s`, le haut des modules) et par un
 * `vitest list` seul (434 s de CPU rien qu'à charger les fichiers).
 *
 * Ce coût n'est pas celui des tests : c'est le MÊME calcul refait. Les forks de vitest ne
 * partagent pas de mémoire — chaque fichier repart de zéro — d'où un cache sur DISQUE.
 *
 * ── CE QUE ÇA NE CHANGE PAS ────────────────────────────────────────────────────────────────────
 *
 * Rien de ce que les tests éprouvent. La carte rendue est **bit pour bit** celle qu'aurait rendue
 * `generateZonedTerrain` : à la taille de production, sur la vraie carte, comme l'exige la règle
 * de méthode du projet (en-tête de `zonegen.test.ts`). Aucun test n'est retiré, aucun monde n'est
 * rétréci. `carte-cache.test.ts` le PROUVE à chaque exécution de la suite, en comparant une
 * relecture à une génération fraîche, champ par champ, type de tableau compris.
 *
 * Le jeu, lui, ne connaît pas ce fichier : `generateZonedTerrain` est intacte, et la Veillée
 * comme le serveur l'appellent toujours en direct.
 *
 * ── CE QUI INVALIDE LE CACHE ───────────────────────────────────────────────────────────────────
 *
 * L'EMPREINTE DE TOUT `/sim` — le contenu de chaque `.ts` de `packages/sim/src` hors tests, haché.
 * Pas les dates de fichier (une copie de dépôt les remet à zéro), pas une liste écrite à la main
 * des modules du worldgen : `zonegen` atteint `socle`, `noise`, `profondeur`, `connectivity`,
 * `cendre`, `zonegraph`, `poisson`, `racine-relief` et cinq `zonegen-*`, et une liste tenue à la
 * main DÉRIVE. Une empreinte de dossier entier ne peut pas dériver — au pire elle régénère pour
 * rien, jamais elle ne sert un fossile. C'est le seul mode de panne qui compte ici : un cache
 * périmé rendrait 19 fichiers de test VERTS contre un monde qui n'existe plus.
 *
 * `ASHES_SANS_CACHE=1` court-circuite tout : la suite regénère, et doit rendre le même compte.
 *
 * ── OÙ IL VIT, ET POURQUOI PAS DANS /sim ───────────────────────────────────────────────────────
 *
 * Dans `tools/`, comme les profileurs et les sondes, et pour la même raison qu'eux : `/sim` est
 * pur (invariant n°1), le lint y interdit `node:fs` — or c'est de fichiers qu'on a besoin. Le
 * garde-fou n'est pas contourné, il est respecté : ce fichier n'est pas `/sim`.
 *
 * ── PAS UN OCTET DE `Buffer` ───────────────────────────────────────────────────────────────────
 *
 * `Uint8Array`, `DataView`, `TextEncoder`/`TextDecoder` — que du standard. Pas par purisme : ce
 * fichier est compilé par le `tsc` d'`@ashes/sim`, qui n'a `@types/node` que par ricochet (via
 * vitest), et les signatures de `Buffer` y sont un champ de mines de variance
 * (`ArrayBufferLike` vs `ArrayBuffer`). Les types standard traversent, eux, sans rien supposer.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync, existsSync, unlinkSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { generateZonedTerrain, type CarteZonee } from '../packages/sim/src/zonegen'
import { MONDE, type MondeGen } from '../packages/sim/src/zonegraph'

const RACINE = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const SOURCES = `${RACINE}/packages/sim/src`
/** `node_modules/` est déjà ignoré par git : le cache n'a pas à se déclarer quelque part. */
const DOSSIER = `${RACINE}/node_modules/.cache/ashes-cartes`

/** En deçà, un tableau reste dans l'entête JSON : l'encodage binaire ne paierait pas. */
const SEUIL_BINAIRE = 4096

// ═══ L'EMPREINTE DE /sim ══════════════════════════════════════════════════════════════════════

let empreinte: string | null = null

/** Le contenu de tout `/sim` hors tests, haché. Calculé une fois par processus (~20 ms). */
function empreinteDeSim(): string {
  if (empreinte !== null) return empreinte
  const h = createHash('sha1')
  const fichiers = readdirSync(SOURCES, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
    .map((e) => `${e.parentPath}/${e.name}`)
    .sort() // l'ordre de `readdirSync` n'est pas garanti — l'empreinte, si
  for (const f of fichiers) {
    h.update(f.slice(SOURCES.length))
    h.update(readFileSync(f))
  }
  // Les plans du bâti sont compilés dans `/sim` mais vivent à côté : ils changent la carte.
  const plans = `${SOURCES}/plans`
  if (existsSync(plans)) {
    for (const e of readdirSync(plans, { withFileTypes: true, recursive: true })) {
      if (e.isFile() && e.name.endsWith('.plan')) h.update(readFileSync(`${e.parentPath}/${e.name}`))
    }
  }
  empreinte = h.digest('hex').slice(0, 16)
  return empreinte
}

// ═══ L'ENCODAGE ═══════════════════════════════════════════════════════════════════════════════
//
// Une CarteZonee, c'est quelques milliers d'octets de structure et cinq à sept tableaux de
// plusieurs millions d'entrées. `JSON.stringify` sur l'ensemble pèse 171 Mo et *déforme* : les
// `Int32Array` de premier niveau (`zone`, `rampe`) y deviennent des OBJETS à 3,75 M de clés,
// qu'on ne relit pas en tableaux typés. On sépare donc : la structure en JSON, les grands
// tableaux en binaire, chacun dans le type le plus ÉTROIT qui les rend exactement.

type Genre = 'Int8' | 'Uint8' | 'Int16' | 'Uint16' | 'Int32' | 'Float64'

const CONSTRUCTEURS = {
  Int8: Int8Array, Uint8: Uint8Array, Int16: Int16Array,
  Uint16: Uint16Array, Int32: Int32Array, Float64: Float64Array,
} as const
const OCTETS: Record<Genre, number> = { Int8: 1, Uint8: 1, Int16: 2, Uint16: 2, Int32: 4, Float64: 8 }

/** Le marqueur qui remplace un grand tableau dans l'entête JSON. */
interface Marqueur {
  __blob: number
  genre: Genre
  n: number
  /** Le constructeur d'origine — `null` pour un `number[]` ordinaire, qu'on rend tel quel. */
  typee: keyof typeof CONSTRUCTEURS | null
}

const estMarqueur = (v: unknown): v is Marqueur =>
  typeof v === 'object' && v !== null && '__blob' in (v as Record<string, unknown>)

/** Le type le plus étroit qui rend ces valeurs À L'IDENTIQUE. Jamais une approximation. */
function genreDe(a: ArrayLike<number>): Genre {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!
    if (!Number.isInteger(v)) return 'Float64'
    // `-0` est un entier pour `Number.isInteger`, et un tableau d'entiers l'aplatit en `+0`.
    // Seul `Float64Array` porte le bit de signe du zéro. Le test coûte deux comparaisons par
    // élément et ne se déclenche jamais sur les champs d'aujourd'hui (des index, des distances) ;
    // le jour où il se déclenche, il aura évité une corruption muette au prix de huit octets.
    if (v === 0 && 1 / v < 0) return 'Float64'
    if (v < min) min = v
    if (v > max) max = v
  }
  if (a.length === 0) return 'Uint8'
  if (min >= 0 && max <= 255) return 'Uint8'
  if (min >= -128 && max <= 127) return 'Int8'
  if (min >= 0 && max <= 65535) return 'Uint16'
  if (min >= -32768 && max <= 32767) return 'Int16'
  if (min >= -2147483648 && max <= 2147483647) return 'Int32'
  return 'Float64'
}

function nomDuTypee(v: object): (keyof typeof CONSTRUCTEURS) | null {
  for (const [nom, ctor] of Object.entries(CONSTRUCTEURS)) {
    if (v instanceof ctor) return nom as keyof typeof CONSTRUCTEURS
  }
  return null
}

/**
 * Descend l'objet et remplace tout grand tableau de nombres par un marqueur, en poussant ses
 * octets dans `blobs`. **L'ORDRE DES CLÉS EST PRÉSERVÉ** : plusieurs tests comparent des cartes
 * par `JSON.stringify`, qui est sensible à l'ordre — une carte relue doit s'y sérialiser
 * exactement comme une carte fraîche.
 */
function separer(v: unknown, blobs: Uint8Array[]): unknown {
  if (v === null || typeof v !== 'object') return v
  const typee = nomDuTypee(v)
  if (typee !== null) {
    const ta = v as unknown as ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }
    const m: Marqueur = { __blob: blobs.length, genre: typee, n: ta.length, typee }
    blobs.push(new Uint8Array(ta.buffer as ArrayBuffer, ta.byteOffset, ta.byteLength))
    return m
  }
  if (Array.isArray(v)) {
    if (v.length >= SEUIL_BINAIRE && v.every((x) => typeof x === 'number')) {
      const genre = genreDe(v as number[])
      const ta = new CONSTRUCTEURS[genre](v as number[])
      const m: Marqueur = { __blob: blobs.length, genre, n: v.length, typee: null }
      blobs.push(new Uint8Array(ta.buffer, 0, ta.byteLength))
      return m
    }
    return v.map((x) => separer(x, blobs))
  }
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(v)) out[k] = separer((v as Record<string, unknown>)[k], blobs)
  return out
}

/** Le chemin inverse : chaque marqueur redevient le tableau qu'il était, dans son type d'origine. */
function recoller(v: unknown, buf: Uint8Array, offsets: number[]): unknown {
  if (v === null || typeof v !== 'object') return v
  if (estMarqueur(v)) {
    const ctor = CONSTRUCTEURS[v.genre]
    const ta = new ctor(buf.buffer as ArrayBuffer, buf.byteOffset + offsets[v.__blob]!, v.n)
    if (v.typee !== null) return new CONSTRUCTEURS[v.typee](ta) // copie : l'appelant est propriétaire
    const a = new Array<number>(v.n)
    for (let i = 0; i < v.n; i++) a[i] = ta[i]! // boucle plate : 20× plus rapide qu'`Array.from`
    return a
  }
  if (Array.isArray(v)) return v.map((x) => recoller(x, buf, offsets))
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(v)) out[k] = recoller((v as Record<string, unknown>)[k], buf, offsets)
  return out
}

/**
 * ═══ LES NOMBRES QUE JSON NE SAIT PAS DIRE ════════════════════════════════════════════════════
 *
 * **`JSON.stringify(-0)` rend `"0"`.** Ce n'est pas une subtilité d'école : la carte de la vallée
 * porte des seuils dont la normale vaut `ax: -0` (une arête verticale : `-1 * 0`), et le zéro
 * négatif est repassé en zéro positif au premier aller-retour. `toEqual` de vitest, lui,
 * DISTINGUE `-0` de `0` — `A12 — le terrain est DÉTERMINISTE` l'a attrapé, en rouge, sur la
 * suite complète. C'est le seul écart qu'a produit tout ce cache, et il valait la peine :
 * il dit exactement ce qu'un format doit garantir.
 *
 * `NaN` et les infinis sont du même bois — JSON les rend `null`, en silence. Ils ne se
 * présentent pas aujourd'hui dans une `CarteZonee`, mais un champ flottant de plus les
 * amènerait, et une conversion muette en `null` serait pire qu'un plantage.
 *
 * Les grands tableaux, eux, ne passent PAS par là : leur binaire est fidèle par construction
 * (un `Float64Array` porte le bit de signe du zéro et les motifs de `NaN`).
 */
const MARQUE_NOMBRE = '__ashes_num'

function remplacant(_cle: string, v: unknown): unknown {
  if (typeof v === 'number') {
    if (Object.is(v, -0)) return { [MARQUE_NOMBRE]: '-0' }
    if (Number.isNaN(v)) return { [MARQUE_NOMBRE]: 'NaN' }
    if (v === Infinity) return { [MARQUE_NOMBRE]: 'Inf' }
    if (v === -Infinity) return { [MARQUE_NOMBRE]: '-Inf' }
  }
  return v
}

function raviveur(_cle: string, v: unknown): unknown {
  if (v === null || typeof v !== 'object' || !(MARQUE_NOMBRE in v)) return v
  switch ((v as Record<string, unknown>)[MARQUE_NOMBRE]) {
    case '-0': return -0
    case 'NaN': return NaN
    case 'Inf': return Infinity
    default: return -Infinity
  }
}

/** Concatène en un seul `Uint8Array` — l'équivalent standard de `Buffer.concat`. */
function coller(morceaux: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const m of morceaux) total += m.length
  const out = new Uint8Array(total)
  let off = 0
  for (const m of morceaux) { out.set(m, off); off += m.length }
  return out
}

export function encoderCarte(c: CarteZonee): Uint8Array {
  const blobs: Uint8Array[] = []
  const entete = separer(c, blobs)
  const j0 = new TextEncoder().encode(JSON.stringify(entete, remplacant))
  // Chaque blob commence sur un multiple de 8 : un Float64Array ne se lit pas de travers.
  const bourre = (8 - ((4 + j0.length) % 8)) % 8
  const j = coller([j0, new Uint8Array(bourre).fill(0x20)]) // des ESPACES : JSON.parse les tolère
  const tete = new Uint8Array(4)
  new DataView(tete.buffer).setUint32(0, j.length, true)
  const morceaux: Uint8Array[] = [tete, j]
  for (const b of blobs) {
    morceaux.push(b)
    const reste = (8 - (b.length % 8)) % 8
    if (reste > 0) morceaux.push(new Uint8Array(reste))
  }
  return coller(morceaux)
}

export function decoderCarte(vue: Uint8Array): CarteZonee {
  // `readFileSync` peut rendre une vue sur un buffer MUTUALISÉ (Node met en commun les petites
  // lectures) : son `byteOffset` n'est alors pas un multiple de 8, et `new Float64Array(...)`
  // jette « start offset should be a multiple of 8 ». On recopie plutôt que de se fier à la
  // taille du fichier — le mode de panne est trop discret pour se jouer à ça.
  const buf = vue.byteOffset % 8 === 0 ? vue : new Uint8Array(vue)
  if (buf.length < 4) throw new Error('carte-cache : fichier tronqué (pas même son entête)')
  const n = new DataView(buf.buffer as ArrayBuffer, buf.byteOffset).getUint32(0, true)
  if (4 + n > buf.length) throw new Error(`carte-cache : entête tronquée (${4 + n} > ${buf.length})`)
  const entete = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + n)), raviveur) as unknown
  // Les offsets se rejouent dans l'ordre d'écriture — les marqueurs portent leur index.
  const tailles: { i: number; octets: number }[] = []
  const recenser = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return
    if (estMarqueur(v)) { tailles.push({ i: v.__blob, octets: v.n * OCTETS[v.genre] }); return }
    if (Array.isArray(v)) { v.forEach(recenser); return }
    for (const k of Object.keys(v)) recenser((v as Record<string, unknown>)[k])
  }
  recenser(entete)
  tailles.sort((a, b) => a.i - b.i)
  const offsets: number[] = []
  let off = 4 + n
  for (const t of tailles) {
    offsets[t.i] = off
    off += t.octets + ((8 - (t.octets % 8)) % 8)
  }
  // ⚠ LA LONGUEUR SE VÉRIFIE, ELLE NE SE DEVINE PAS. Compter sur le `RangeError` de
  // `new Int32Array(buffer, offset, n)` ne suffit PAS : une `Uint8Array` est une VUE, et son
  // `.buffer` peut être plus long qu'elle (c'est le cas de tout ce qui sort d'un `subarray`).
  // Le tableau se construirait alors sur des octets HORS du fichier — une carte tronquée rendue
  // sans un mot. Trouvé par A5, qui ne rougissait pas à 99,9 % de troncature.
  if (off > buf.length) throw new Error(`carte-cache : fichier tronqué (${off} octets attendus, ${buf.length} lus)`)
  return recoller(entete, buf, offsets) as CarteZonee
}

// ═══ L'API DES TESTS ══════════════════════════════════════════════════════════════════════════

/**
 * La carte de production, générée une fois pour toutes les suites — **bit pour bit** celle que
 * rendrait `generateZonedTerrain(seed, joueurs, monde)`.
 *
 * ⚠ À NE PAS EMPLOYER dans un test qui éprouve la GÉNÉRATION elle-même : un test de déterminisme
 * (« deux appels rendent la même carte ») ou de budget (A13, « une carte naît en moins de 15 s »)
 * doit appeler `generateZonedTerrain` en direct, sinon il ne mesure plus que ce cache.
 */
export function carteDeTest(
  seed: number,
  joueurs?: number,
  monde?: MondeGen,
): CarteZonee {
  if (process.env.ASHES_SANS_CACHE === '1') return generateZonedTerrain(seed, joueurs ?? JOUEURS_DEFAUT, monde ?? MONDE_DEFAUT)
  // Les défauts sont RÉSOLUS dans la clé : `(2026, undefined, 'racine')` et `(2026, 50, 'racine')`
  // sont le même monde, ils doivent être le même fichier. (Si un défaut changeait dans `/sim`,
  // l'empreinte change avec lui — la clé ne peut pas se retrouver à mentir.)
  const cle = `${seed}_${joueurs ?? JOUEURS_DEFAUT}_${monde ?? MONDE_DEFAUT}_${empreinteDeSim()}`
  const chemin = `${DOSSIER}/${cle}.bin`
  try {
    if (existsSync(chemin)) return decoderCarte(readFileSync(chemin))
  } catch {
    // Un cache illisible (écriture interrompue, disque plein, format d'une autre version) n'est
    // JAMAIS une panne : on le jette et on régénère. Le cache est une accélération, pas une source.
    try { unlinkSync(chemin) } catch { /* déjà parti */ }
  }
  const c = generateZonedTerrain(seed, joueurs ?? JOUEURS_DEFAUT, monde ?? MONDE_DEFAUT)
  try {
    mkdirSync(DOSSIER, { recursive: true })
    // Écriture ATOMIQUE : cinq forks de vitest peuvent générer la même carte en même temps, et
    // un fichier à moitié écrit serait lu par le sixième. `rename` sur le même volume est atomique.
    const temp = `${chemin}.${process.pid}.tmp`
    writeFileSync(temp, encoderCarte(c))
    renameSync(temp, chemin)
    balayerLesVieillesEmpreintes()
  } catch {
    /* pas de cache écrit : tant pis, la carte est bonne */
  }
  return c
}

let balaye = false

/**
 * ═══ LE BALAYAGE — sans quoi ce cache serait une fuite de disque ══════════════════════════════
 *
 * Le jeu de cartes d'une empreinte pèse **493 Mo**. L'empreinte change à CHAQUE modification de
 * `/sim` — c'est tout le principe — donc sans balayage, une journée de travail sur le worldgen
 * laisserait dix jeux complets, cinq gigaoctets, et personne pour s'en apercevoir avant que le
 * disque soit plein. Le nettoyage doit vivre ici, pas dans une commande qu'on penserait à lancer.
 *
 * ON EN GARDE **DEUX** : la courante et la précédente. Pas par prudence vague — pour une raison
 * précise : le dépôt est parfois travaillé par deux sessions à la fois, et une suite qui tourne
 * sur l'empreinte d'avant lirait ses cartes disparaître sous elle. Elles se régénéreraient (le
 * chemin de secours de `carteDeTest` tient, A5 le garde), mais on lui aurait fait payer dix
 * minutes pour rien. Deux jeux plafonnent le disque à ~1 Go et laissent l'autre travailler.
 *
 * Une fois par processus, et seulement APRÈS une écriture : une exécution qui ne fait que lire
 * ne touche à rien. Les `.tmp` orphelins d'un processus tué partent avec.
 */
function balayerLesVieillesEmpreintes(): void {
  if (balaye) return
  balaye = true
  const courante = empreinteDeSim()
  const fichiers = readdirSync(DOSSIER, { withFileTypes: true, recursive: false }).filter((e) => e.isFile())
  // La plus récente des AUTRES empreintes survit : sa date est celle du fichier le plus frais
  // qui la porte. (`.tmp` : pas d'empreinte lisible, donc jamais épargnée.)
  const dateDe = (nom: string): number => { try { return statSync(`${DOSSIER}/${nom}`).mtimeMs } catch { return 0 } }
  const empreinteDe = (nom: string): string | null => {
    const m = /_([0-9a-f]{16})\.bin$/.exec(nom)
    return m ? m[1]! : null
  }
  let survivante: string | null = null
  let laPlusFraiche = -1
  for (const e of fichiers) {
    const emp = empreinteDe(e.name)
    if (emp === null || emp === courante) continue
    const d = dateDe(e.name)
    if (d > laPlusFraiche) { laPlusFraiche = d; survivante = emp }
  }
  for (const e of fichiers) {
    const emp = empreinteDe(e.name)
    if (emp === courante || (emp !== null && emp === survivante)) continue
    try { unlinkSync(`${DOSSIER}/${e.name}`) } catch { /* un autre fork l'a déjà pris */ }
  }
}

/**
 * LES DÉFAUTS DE `generateZonedTerrain`, RECOPIÉS ICI — et c'est volontaire, pas une duplication
 * qui dort. Ils servent à deux choses qui doivent s'accorder : résoudre la clé du cache (sans
 * quoi `(s, undefined, 'racine')` et `(s, 50, 'racine')` seraient deux fichiers pour un seul
 * monde) et faire l'appel. Les faire diverger de `/sim` est SANS DANGER : l'empreinte du dossier
 * source change dès que la signature change, donc tout cache écrit avec l'ancien défaut est
 * jeté — au pire on régénère, jamais on ne sert un monde qui n'est plus.
 */
const JOUEURS_DEFAUT = MONDE.JOUEURS_CIBLE
const MONDE_DEFAUT: MondeGen = 'vallee'
