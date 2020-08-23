import createR2D2 from '../../index.js'
import multiformats from 'multiformats/basics'
import base58 from 'multiformats/bases/base58'
import { deepStrictEqual as same } from 'assert'
import Block from '@ipld/block/defaults'
import CAR from 'datastore-car'

multiformats.multibase.add(base58)

const r2d2 = createR2D2(multiformats)

const [,,file] = process.argv

console.log({file})

const fixBuffer = obj => {
  if (obj && typeof obj === 'object') {
    if (Buffer.isBuffer(obj)) return new Uint8Array([...obj])
    if (obj.asCID === obj) return obj
    for (const [i, value] of Object.entries(obj)) {
      obj[i] = fixBuffer(value)
    }
    return obj
  }
  return obj
}

const u = o => new Uint8Array([...o])

const run = async (compress) => {
  const car = await CAR.readFileComplete(file)
  const metrics = {compress}
  const add = (name, i) => {
    if (!metrics[name]) metrics[name] = 0
    metrics[name] += i
  }
  for await (const { key, value } of car.query()) {
    const block = Block.create(value, key)
    const codec = block.codec
    add(codec, 1)
    if (codec !== 'dag-cbor') continue
    const length = block.encodeUnsafe().length
    add(codec + '-data', length)
    add('data', length)
    let start = Date.now()
    const _decode = block.decodeUnsafe()
    add('dag-cbor decode time', Date.now() - start)
    // const obj = fixBuffer(_decode)
    // start = Date.now()
    // Block.encoder(_decode, 'dag-cbor').encodeUnsafe()
    add('dag-cbor encode time', Date.now() - start)
    start = Date.now()
    const encoded = r2d2.encode(_decode, compress)
    add('encode time', Date.now() - start)
    // start = Date.now()
    // const decoded = r2d2.decode(encoded, compress)
    // add('decode time', Date.now() - start)
    add('r2d2', encoded.byteLength)
  }
  console.log(metrics)
}
run(false).then(() => {
  run(true)
})
