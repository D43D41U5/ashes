/**
 * ALLÉGER LA VITRINE — réencoder les images du carrousel, sans ImageMagick.
 *
 * POURQUOI IL EXISTE. L'atelier (`smoke --scenario vitrine`) déclenche en JPEG qualité 82,
 * ce qui est le bon réglage pour JUGER une prise. Mais la vitrine charge TOUTES ses vues d'un
 * coup au montage du menu : la quatrième série (neuf vues, des scènes denses en neige et en
 * pluie) pesait 1 Mo là où les cinq paysages d'avant en pesaient 344 Ko. C'est le premier
 * octet du jeu, avant même l'écran de titre.
 *
 * ET POURQUOI IL PASSE PAR LE NAVIGATEUR : cette machine n'a ni ImageMagick ni encodeur JPEG
 * dans Node. Chromium, lui, en a un — on décode l'image dans un canvas et on relit en
 * `toDataURL('image/jpeg', q)`. Le même navigateur que le smoke, les mêmes arguments (pas de
 * GPU ici, SwiftShader) : aucune dépendance de plus dans le dépôt.
 *
 *   node tools/vitrine-alleger.mjs           # qualité 0,72 (par défaut)
 *   VITRINE_Q=0.6 node tools/vitrine-alleger.mjs
 *
 * ÉCRIT EN PLACE. Le fichier n'est remplacé que s'il MAIGRIT — réencoder un JPEG déjà plus
 * léger que la cible ne ferait que le dégrader une seconde fois.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOSSIER = join(ROOT, 'packages/client/src/assets/vitrine')
const Q = Number(process.env.VITRINE_Q ?? 0.72)

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage()

let avant = 0
let apres = 0
for (const nom of readdirSync(DOSSIER).filter((f) => f.endsWith('.jpg')).sort()) {
  const chemin = join(DOSSIER, nom)
  const taille = statSync(chemin).size
  const dataUrl = `data:image/jpeg;base64,${readFileSync(chemin).toString('base64')}`
  const sortie = await page.evaluate(
    ({ url, q }) =>
      new Promise((ok, ko) => {
        const img = new Image()
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = img.naturalWidth
          c.height = img.naturalHeight
          c.getContext('2d').drawImage(img, 0, 0)
          ok(c.toDataURL('image/jpeg', q))
        }
        img.onerror = () => ko(new Error('image illisible'))
        img.src = url
      }),
    { url: dataUrl, q: Q },
  )
  const octets = Buffer.from(sortie.split(',')[1], 'base64')
  avant += taille
  if (octets.length < taille) {
    writeFileSync(chemin, octets)
    apres += octets.length
    console.log(`   ${nom.padEnd(20)} ${(taille / 1024).toFixed(0).padStart(4)} Ko → ${(octets.length / 1024).toFixed(0).padStart(4)} Ko`)
  } else {
    apres += taille
    console.log(`   ${nom.padEnd(20)} ${(taille / 1024).toFixed(0).padStart(4)} Ko — déjà plus léger que la cible, INCHANGÉ`)
  }
}
console.log(`\nvitrine : ${(avant / 1024).toFixed(0)} Ko → ${(apres / 1024).toFixed(0)} Ko (qualité ${Q})`)
await browser.close()
