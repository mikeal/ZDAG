import multiformats from 'multiformats/basics'

const fixtures = {}

const add = (name, obj) => { fixtures[name] = obj }

const { CID } = multiformats

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
add('dedup map', { hello: 'hello' })
add('dedup nest', { hello: { hello: 'world' } })
add('map with ints', { a: 0, z: 12, x: 10805, c: -1223 })
add('map with constants', { a: true, b: false, c: null, d: null, e: 0, f: 1 })
add('list with ints', [ 0, 12, 10805, -1223 ])
add('list with constants', [ true, false, null, 0, 1 ])
add('nested list', [ [ [ [ [ null, 0, null ] ], [ null ] ] ], null])
add('nested map', { hello: { world: null, nest: { again: 213 } } })

const kitchenSink = {
  arr: [ true, [ false, {}, null ] ],
  map: { x: 'x', y: 'y', z: 'z', hello: { world: 'test' } },
  n: null,
  t: true,
  f: false
}
add('kitchen sink', kitchenSink)

const copy = o => JSON.parse(JSON.stringify(o))

const create = async () => {
  const hash = await multiformats.multihash.hash(Buffer.from('abc'), 'sha2-256')
  const cidv0 = CID.create(0, 112, hash)
  const cidv1 = CID.create(1, 0x71, hash)
  add('link cidv0', cidv0)
  add('link cidv1', cidv1)
  add('list with links', [ cidv0, cidv1, cidv0, cidv1 ])
  add('map with links', { helloV0: cidv0, helloV1: cidv1 })
  const sink = copy(kitchenSink)
  sink.cidv0 = cidv0
  sink.cidv1 = cidv1
  sink.arr.push([cidv0, cidv1])
  sink.map.cidv0 = cidv0
  sink.map.cidvv1 = cidv1
  add('kitchen sink w/ links', sink)
  return fixtures
}

export default create


