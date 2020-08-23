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

const time = () => process.hrtime.bigint()

const run = async (compress) => {
  const car = await CAR.readFileComplete(file)
  const metrics = {compress}
  const add = (name, i) => {
    if (!metrics[name]) metrics[name] = 0n
    metrics[name] += BigInt(i)
  }
  for await (const { key, value } of car.query()) {
    const block = Block.create(value, key)
    const codec = block.codec
    add(codec, 1)
    if (codec !== 'dag-cbor') continue
    const length = block.encodeUnsafe().length
    add(codec + '-data', length)
    add('data', length)
    let start = time()
    const _decode = block.decodeUnsafe()
    add('dag-cbor decode time', time() - start)
    // start = time()
    // Block.encoder(_decode, 'dag-cbor').encodeUnsafe()
    // add('dag-cbor encode time', time() - start)
    start = time()
    const encoded = r2d2.encode(_decode, compress)
    add('encode time', time() - start)
    add('r2d2', encoded.byteLength)
    /*
    start = time()
    const decoded = r2d2.decode(encoded, compress)
    add('decode time', time() - start)
    try {
      same(decoded, fixBuffer(_decode))
    } catch (e) {
      console.log({ decode: _decode})
      console.log({ decoded })
    }
    */
  }
  console.log(metrics)
  console.log(`r2d2 is ${Number(metrics.r2d2 * 100n / metrics.data) / 100 } of dag-cbor`)
}
run(false).then(() => {
  run(true)
})
