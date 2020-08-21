import createR2D2 from '../../index.js'
import createJSON from '@ipld/dag-json'
import createCBOR from '@ipld/dag-cbor'
import multiformats from 'multiformats/basics'
import { deepStrictEqual as same } from 'assert'

const r2d2 = createR2D2(multiformats)
const json = createJSON(multiformats)
const cbor = createCBOR(multiformats)

const fixtures = {}

const add = (name, obj) => { fixtures[name] = obj }

add('null', null)
add('true', true)
add('false', false)
add('empty list', [])
add('empty map', {})
add('int 0', 0)
add('int 1', 1)
add('int 99', 99)
add('int 100', 100)
add('int 112', 112)
add('int 113', 113)
add('int 13123123212', 13123123212)
add('int -12', -12)
add('int -123123231232', -123123231232)
add('simple map', { hello: 'world' })
add('map with ints', { a: 0, z: 12, x: 10805, c: -1223 })
add('list with ints', [ 0, 12, 10805, -1223 ])

const validate = value => {
  const encoded = r2d2.encode(value)
  const decoded = r2d2.decode(encoded)
  same(decoded, value)
  return encoded
}

for (const [key, value] of Object.entries(fixtures)) {
  const encoded = validate(value)
}
