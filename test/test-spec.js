import { readFileSync as read } from 'fs'
import multiformats from 'multiformats/basics'
import base58 from 'multiformats/bases/base58'
import { deepStrictEqual as same } from 'assert'
import { createContext as mkcontext, runInContext as run } from 'vm'
import { createHash } from 'crypto'
import main from '../index.js'

const { CID, multihash } = multiformats
const { hash } = multihash
multiformats.multibase.add(base58)

const { encode, decode } = main(multiformats)

const SHA256 = b => createHash('sha256').update(b).digest()
const MKCID = arr => CID.from(new Uint8Array(arr))

const env = { CID: MKCID, SHA256, INPUT: null, OUTPUT: null }

export default test => {
  const markdown = read(new URL('../SPEC.md', import.meta.url))
  const lines = markdown.toString().split('\n')
  let chunks = []
  let title
  const add = parts => {
    const code = parts.join('\n')
    test(title, () => {
      const context = mkcontext({ ...env })
      run(code, context)
      const { INPUT, OUTPUT } = context
      if (!INPUT || !OUTPUT) {
        throw new Error('INPUT and OUTPUT are required')
      }
      const data = encode(INPUT)
      same([...data], [...OUTPUT])
    })
  }
  let inpart = false
  while (lines.length) {
    const line = lines.shift()
    if (title && line === '```js') {
      inpart = true
      continue
    }
    if (title && line === '```') {
      if (!inpart) throw new Error('Spec parser Error')
      add(chunks)
      chunks = []
      inpart = false
    }
    if (inpart) chunks.push(line)
    else {
      if (line.startsWith('### ')) {
        title = line.slice('### '.length)
      } else if (line.startsWith('#')) {
        title = null
      }
    }
  }
  if (chunks.length) throw new Error('Spec parser Error')
}
