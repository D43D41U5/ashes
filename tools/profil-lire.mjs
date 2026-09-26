/**
 * Sonde JETABLE — LIRE UN LOT DE `.cpuprofile` DU BUNDLE, ET LES COMPARER.
 *
 * Quatre différences avec `tools/__cpuprof.mts`, chacune payée par une leçon :
 *  1. Le profil vient d'un BUNDLE esbuild : sans la carte de source, toutes les fonctions
 *     partagent `sonde.mjs` et aucune ligne n'est citable. On remonte donc par `node:module`
 *     `SourceMap.findEntry`, et on le PROUVE (`--prouver`) contre un `grep -n`.
 *  2. Le temps propre d'un BUILTIN (`find`, `sort`, `filter`) et d'une FLÈCHE ANONYME est replié
 *     sur le plus proche ancêtre NOMMÉ de /sim. Sans ça, `state.nodes.find(...)` s'affiche comme
 *     un `find` orphelin : on ne peut ni l'accuser ni l'innocenter.
 *  3. `--parligne` : le temps propre d'un nœud est RÉPARTI sur ses `positionTicks`, donc sur des
 *     LIGNES de source. C'est ce qui récupère les ~20 % du tick que V8 laisse dans le cadre de
 *     `step` — non pas parce que `step` travaille, mais parce qu'il a INLINÉ ses appelés.
 *  4. Deux LOTS se comparent (`--vs`), normalisés en ms/tick : c'est l'écart qui nomme le
 *     villageois, le lot témoin étant celui où son code ne peut pas s'exécuter.
 *
 *   node tools/__prof-lire.mjs --carte <sonde.mjs.map> --bundle <sonde.mjs> --ticks <parTranche> \
 *        [--sous advanceNpcs] [--parligne] [--combien 30] <lotA...> --vs <lotB...>
 */
import { readFileSync } from 'node:fs'
import { SourceMap } from 'node:module'

const argv = process.argv.slice(2)
const drapeau = (nom) => {
  const i = argv.indexOf(nom)
  if (i < 0) return false
  argv.splice(i, 1)
  return true
}
const opt = (nom, def) => {
  const i = argv.indexOf(nom)
  if (i < 0) return def
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}
const carteFichier = opt('--carte')
const bundleFichier = opt('--bundle')
const ticksParTranche = Number(opt('--ticks', '600'))
const sous = opt('--sous', null)
const combien = Number(opt('--combien', '30'))
const prouver = drapeau('--prouver')
const parLigne = drapeau('--parligne')
const iVs = argv.indexOf('--vs')
const lotA = iVs < 0 ? argv.slice() : argv.slice(0, iVs)
const lotB = iVs < 0 ? [] : argv.slice(iVs + 1)

const carte = carteFichier ? new SourceMap(JSON.parse(readFileSync(carteFichier, 'utf8'))) : null
// La PREMIÈRE COLONNE NON BLANCHE de chaque ligne du bundle : `findEntry(ligne, 0)` rendrait la
// correspondance de la ligne PRÉCÉDENTE (elle choisit la plus grande ≤ (ligne, colonne)).
const lignesBundle = bundleFichier ? readFileSync(bundleFichier, 'utf8').split('\n') : null
const colDe = (ligne0) => {
  const t = lignesBundle?.[ligne0]
  if (t === undefined) return 0
  const m = /\S/.exec(t)
  return m ? m.index : 0
}
const cacheCarte = new Map()
/** `sonde.mjs:33560` → `packages/sim/src/npc.ts:269`. 0-based en entrée comme en sortie de V8. */
const situer = (ligne0, col0) => {
  const cle = `${ligne0}:${col0}`
  const vu = cacheCarte.get(cle)
  if (vu !== undefined) return vu
  let r = null
  if (carte) {
    const e = carte.findEntry(ligne0, col0)
    if (e && e.originalSource !== undefined) {
      const f = String(e.originalSource).replace(/^.*\/(packages|tools|node_modules)\//, '$1/')
      r = `${f}:${e.originalLine + 1}`
    }
  }
  cacheCarte.set(cle, r)
  return r
}

/** Les passes du tick — le plus proche ancêtre reconnu paie. `step` n'est que le filet. */
const SYSTEMES = new Set([
  'advanceAlignment', 'advanceBraiseMeres', 'advanceBrume', 'advanceBuchers', 'advanceCendreux',
  'advanceCombat', 'advanceCraft', 'advanceCultures', 'advanceDecouverte', 'advanceDegel',
  'advanceDens', 'advanceEau', 'advanceEconomy', 'advanceEncyclopedie', 'advanceEnvols',
  'advanceFire', 'advanceFoudre', 'advanceImpasse', 'advanceLieuxBrules', 'advanceMeteo',
  'advanceMonsters', 'advanceMurmures', 'advanceNasses', 'advanceNightHunt', 'advanceNpcs',
  'advancePois', 'advanceReveils', 'advanceSeparation', 'advanceSpoilage', 'advanceTemperature',
  'advanceTime', 'advanceTorches', 'advanceTraction', 'advanceUpkeep', 'advanceVent',
  'advanceVillageGrowth', 'advanceWorldEvents', 'drainEvents',
])

// ── RETROUVER LA PASSE D'UN APPELÉ INLINÉ ──
// V8 laisse le temps d'un appelé inliné dans le cadre de son appelant, à la LIGNE de l'appel.
// `step › sim.ts:1257` n'est donc pas « step travaille » : c'est `advanceEconomy(state)`, inliné.
// On relit la ligne de source et on rend le temps à la passe qu'elle nomme.
const cacheSource = new Map()
const ligneSource = (ref) => {
  const m = /^(.*):(\d+)$/.exec(ref)
  if (!m) return ''
  const f = m[1]
  if (!cacheSource.has(f)) {
    try { cacheSource.set(f, readFileSync(f, 'utf8').split('\n')) } catch { cacheSource.set(f, null) }
  }
  const l = cacheSource.get(f)
  return l === null ? '' : (l[Number(m[2]) - 1] ?? '')
}
const passeDeLaLigne = (ref) => {
  const m = /\b(advance[A-Z][A-Za-z]*)\s*\(/.exec(ligneSource(ref))
  return m && SYSTEMES.has(m[1]) ? m[1] : null
}
/**
 * LA FONCTION APPELÉE SUR CETTE LIGNE — pour rendre à l'appelé le temps que l'inlining a laissé
 * chez l'appelant. On n'accepte qu'un appel par IDENTIFIANT NU (`handleDefense(...)`) : un appel
 * de MÉTHODE (`state.nodes.find(...)`) porte un nom ambigu à l'échelle du dépôt, et la table PAR
 * LIGNE le situe déjà exactement. Les mots-clés du langage ne sont pas des appels.
 */
const MOTS = new Set(['if', 'for', 'while', 'switch', 'return', 'catch', 'typeof', 'new', 'await', 'function', 'else', 'do'])
const appeleDeLaLigne = (ref) => {
  const src = ligneSource(ref)
  for (const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!MOTS.has(m[2])) return m[2]
  }
  return null
}

function lireLot(fichiers) {
  const propre = new Map()
  const passe = new Map()
  const propreSous = new Map()
  const ligne = new Map() // `fonction @ fichier:ligne` → µs, via positionTicks
  const ligneSous = new Map()
  const arbre = new Map() // nom → µs de SOUS-ARBRE (fragments inlinés rendus à l'appelé)
  let totalUs = 0
  let totalSousUs = 0
  let totalLigneUs = 0
  let totalLigneSousUs = 0
  let overheadUs = 0 // `post` de l'inspecteur : MON écriture de profil, pas le jeu
  const preuves = []

  for (const f of fichiers) {
    const p = JSON.parse(readFileSync(f, 'utf8'))
    const parId = new Map()
    for (const n of p.nodes) parId.set(n.id, n)
    const parent = new Map()
    for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id)

    const frameDe = (id) => parId.get(id)?.callFrame
    const estSim = (fr) => fr !== undefined && fr.url !== '' && !fr.url.startsWith('node:')

    const cacheCle = new Map()
    const ancetreNomme = (id) => {
      let a = parent.get(id)
      while (a !== undefined) {
        const fa = frameDe(a)
        if (estSim(fa) && fa.functionName !== '') return fa
        a = parent.get(a)
      }
      return null
    }
    const cleDe = (id) => {
      const vu = cacheCle.get(id)
      if (vu !== undefined) return vu
      const fr = frameDe(id)
      let cle
      if (fr === undefined) cle = '(inconnu)'
      else if (fr.functionName.startsWith('(')) cle = fr.functionName
      else if (!estSim(fr)) {
        const fa = ancetreNomme(id)
        const anc = fa ? `${fa.functionName}@${situer(fa.lineNumber, fa.columnNumber) ?? 'bundle'}` : '(hors /sim)'
        cle = `[${fr.functionName || fr.url || 'natif'}] dans ${anc}`
      } else {
        const ou = situer(fr.lineNumber, fr.columnNumber) ?? `bundle:${fr.lineNumber + 1}`
        if (fr.functionName !== '') {
          cle = `${fr.functionName}@${ou}`
          if (prouver && preuves.length < 60) preuves.push(`${fr.functionName}  →  ${ou}`)
        } else {
          const fa = ancetreNomme(id)
          cle = `(flèche)@${ou} dans ${fa?.functionName ?? '?'}`
        }
      }
      cacheCle.set(id, cle)
      return cle
    }

    const cachePasse = new Map()
    const passeDe = (id) => {
      const vu = cachePasse.get(id)
      if (vu !== undefined) return vu
      const chaine = []
      let c = id
      let trouve = '(hors passe)'
      while (c !== undefined) {
        const deja = cachePasse.get(c)
        if (deja !== undefined) { trouve = deja; break }
        chaine.push(c)
        const nom = frameDe(c)?.functionName ?? ''
        if (SYSTEMES.has(nom)) { trouve = nom; break }
        c = parent.get(c)
      }
      for (const x of chaine) cachePasse.set(x, trouve)
      return trouve
    }

    const cacheSous = new Map()
    const dansSous = (id) => {
      if (sous === null) return false
      const vu = cacheSous.get(id)
      if (vu !== undefined) return vu
      const chaine = []
      let c = id
      let r = false
      while (c !== undefined) {
        const deja = cacheSous.get(c)
        if (deja !== undefined) { r = deja; break }
        chaine.push(c)
        if ((frameDe(c)?.functionName ?? '') === sous) { r = true; break }
        c = parent.get(c)
      }
      for (const x of chaine) cacheSous.set(x, r)
      return r
    }

    // temps propre par nœud
    const propreNoeud = new Map()
    for (let i = 0; i < p.samples.length; i++) {
      const id = p.samples[i]
      const dt = p.timeDeltas[i] ?? 0
      if (dt < 0) continue
      propreNoeud.set(id, (propreNoeud.get(id) ?? 0) + dt)
    }
    for (const [id, us] of propreNoeud) {
      const c = cleDe(id)
      if (c.startsWith('[post]') || c.startsWith('[writeFileSync]')) { overheadUs += us; continue }
      propre.set(c, (propre.get(c) ?? 0) + us)
      totalUs += us
      const dSous = dansSous(id)
      if (dSous) { propreSous.set(c, (propreSous.get(c) ?? 0) + us); totalSousUs += us }

      // ── SOUS-ARBRE PAR NOM : chaque fonction de la pile reçoit ce temps, une seule fois ──
      const chaineNoms = new Set()
      {
        let c = id
        while (c !== undefined) {
          const fc = frameDe(c)
          if (fc !== undefined && fc.functionName !== '' && !fc.functionName.startsWith('(')) chaineNoms.add(fc.functionName)
          c = parent.get(c)
        }
      }
      for (const nm of chaineNoms) arbre.set(nm, (arbre.get(nm) ?? 0) + us)

      const n = parId.get(id)
      const pts = n?.positionTicks ?? []
      const nom = frameDe(id)?.functionName || '(anon)'
      const sBrut = passeDe(id)
      if (pts.length === 0 || !estSim(frameDe(id))) {
        passe.set(sBrut, (passe.get(sBrut) ?? 0) + us)
        if (parLigne) {
          const k = `${c}  «sans positionTicks»`
          ligne.set(k, (ligne.get(k) ?? 0) + us)
          totalLigneUs += us
          if (dSous) { ligneSous.set(k, (ligneSous.get(k) ?? 0) + us); totalLigneSousUs += us }
        }
        continue
      }
      let tot = 0
      for (const pt of pts) tot += pt.ticks
      for (const pt of pts) {
        const l0 = pt.line - 1 // PositionTickInfo.line est 1-based
        const ref = situer(l0, colDe(l0))
        const part = (us * pt.ticks) / tot
        // La passe : celle de la pile, sinon — si la ligne est un appel `advanceX(` inliné —
        // celle que la ligne nomme.
        const s = sBrut !== '(hors passe)' ? sBrut : (ref !== null ? passeDeLaLigne(ref) ?? '(hors passe)' : '(hors passe)')
        passe.set(s, (passe.get(s) ?? 0) + part)
        // L'APPELÉ INLINÉ récupère son temps : sans ça, `handleDefense` inliné dans `advanceNpcs`
        // n'apparaît nulle part sous son nom, et on classe l'appelant à sa place.
        if (ref !== null) {
          const g = appeleDeLaLigne(ref)
          if (g !== null && !chaineNoms.has(g)) arbre.set(g, (arbre.get(g) ?? 0) + part)
        }
        if (parLigne) {
          const k = `${nom} › ${ref ?? `bundle:${pt.line}`}`
          ligne.set(k, (ligne.get(k) ?? 0) + part)
          totalLigneUs += part
          if (dSous) { ligneSous.set(k, (ligneSous.get(k) ?? 0) + part); totalLigneSousUs += part }
        }
      }
    }
  }
  const ticks = fichiers.length * ticksParTranche
  return { propre, passe, propreSous, ligne, ligneSous, arbre, totalUs, totalSousUs, totalLigneUs, totalLigneSousUs, overheadUs, ticks, fichiers: fichiers.length, preuves }
}

const A = lireLot(lotA)
const B = lotB.length > 0 ? lireLot(lotB) : null
const ms = (us, ticks) => us / 1000 / ticks

if (prouver) {
  console.log('── PREUVE DE LA CARTE DE SOURCE (à confronter au grep -n) ──')
  for (const l of [...new Set(A.preuves)].slice(0, 30)) console.log('  ' + l)
  console.log()
}
console.log(
  `surcoût de MA sonde exclu du total (écriture des profils par l'inspecteur) : ` +
    `A ${ms(A.overheadUs, A.ticks).toFixed(3)} ms/tick${B ? ` · B ${ms(B.overheadUs, B.ticks).toFixed(3)}` : ''}`,
)

const titre = (t) => console.log(`\n${'═'.repeat(104)}\n${t}\n${'═'.repeat(104)}`)

function tableau(nom, mapA, totA, mapB, totB) {
  titre(nom)
  const cles = new Set([...mapA.keys(), ...(mapB ? mapB.keys() : [])])
  const lignes = [...cles].map((c) => {
    const a = ms(mapA.get(c) ?? 0, A.ticks)
    const b = mapB ? ms(mapB.get(c) ?? 0, B.ticks) : 0
    return { c, a, b, d: a - b }
  })
  lignes.sort((x, y) => (mapB ? y.d - x.d : y.a - x.a))
  if (mapB) {
    const dTot = ms(totA, A.ticks) - ms(totB, B.ticks)
    console.log(`  A = ${A.fichiers} tranches / ${A.ticks} ticks · B TÉMOIN = ${B.fichiers} / ${B.ticks} · Δ = A − B`)
    console.log(`${'A ms/t'.padStart(9)}${'B ms/t'.padStart(9)}${'Δ ms/t'.padStart(9)}${'part Δ'.padStart(8)}   fonction`)
    for (const l of lignes.slice(0, combien)) {
      console.log(`${l.a.toFixed(3).padStart(9)}${l.b.toFixed(3).padStart(9)}${l.d.toFixed(3).padStart(9)}${`${((100 * l.d) / dTot).toFixed(1)}%`.padStart(8)}   ${l.c}`)
    }
    console.log(`${ms(totA, A.ticks).toFixed(3).padStart(9)}${ms(totB, B.ticks).toFixed(3).padStart(9)}${dTot.toFixed(3).padStart(9)}${'100%'.padStart(8)}   ═ TOTAL`)
  } else {
    console.log(`${'ms/tick'.padStart(9)}${'part'.padStart(8)}   fonction`)
    for (const l of lignes.slice(0, combien)) {
      console.log(`${l.a.toFixed(3).padStart(9)}${`${((100 * l.a) / ms(totA, A.ticks)).toFixed(1)}%`.padStart(8)}   ${l.c}`)
    }
    console.log(`${ms(totA, A.ticks).toFixed(3).padStart(9)}${'100%'.padStart(8)}   ═ TOTAL (${A.fichiers} tranches, ${A.ticks} ticks)`)
  }
}

tableau('PAR PASSE — temps TOTAL de sous-arbre (qui paie)', A.passe, A.totalUs, B?.passe, B?.totalUs)
tableau('PAR FONCTION — temps de SOUS-ARBRE (elle et ses appelés, inlinés rendus)', A.arbre, A.totalUs, B?.arbre, B?.totalUs)
tableau('PAR FONCTION — temps PROPRE (où le CPU brûle)', A.propre, A.totalUs, B?.propre, B?.totalUs)
if (parLigne) tableau('PAR LIGNE — temps propre réparti sur les positionTicks (l\'inliné retrouvé)', A.ligne, A.totalLigneUs, B?.ligne, B?.totalLigneUs)
if (sous !== null) {
  tableau(`DANS LE SOUS-ARBRE ${sous} — temps propre`, A.propreSous, A.totalSousUs, B?.propreSous, B?.totalSousUs)
  if (parLigne) tableau(`DANS LE SOUS-ARBRE ${sous} — par ligne`, A.ligneSous, A.totalLigneSousUs, B?.ligneSous, B?.totalLigneSousUs)
}
