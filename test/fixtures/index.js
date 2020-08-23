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
add('int 115', 115)
add('int 116', 116)
add('int 13123123212', 13123123212)
add('int -12', -12)
add('int -123123231232', -123123231232)
add('float 12.12', 12.12)
add('float 1121322.1231232', 1121322.1231232)
add('float -12312.123123', -12312.123123)
add('simple map', { hello: 'world' })
add('dedup map', { hello: 'hello' })
add('dedup nest', { hello: { hello: 'world' } })
add('map with ints', { a: 0, z: 12, x: 10805, c: -1223 })
add('map with constants', { a: true, b: false, c: null, d: null, e: 0, f: 1 })
add('list with ints', [ 0, 12, 10805, -1223 ])
add('list with constants', [ true, false, null, 0, 1 ])
add('nested list', [ [ [ [ [ null, 0, null ] ], [ null ] ] ], null])
add('nested map', { hello: { world: null, nest: { again: 213 } } })

const bin = new Uint8Array([1,2,3,4])
const bin2 = new Uint8Array([5, ...bin])
const bin3 = new Uint8Array([6, ...bin])
add('binary 1,2,3,4', bin)
add('binary in list' , [ bin, bin, bin2, bin3 ])
add('binary with ints in list', [ bin, 0, 1, 2, bin, 123123914342, bin2, bin3 ])
add('binary in lists of lists', [ bin, [ bin2, bin3, 32423423], [ [ bin3 ] ]])

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
  const createHash = s => multiformats.multihash.hash(Buffer.from(s), 'sha2-256')
  const hash = await createHash('abc')
  const cidv0 = CID.create(0, 112, hash)
  const cidv1 = CID.create(1, 0x71, hash)
  const cid2 = CID.create(1, 0x71, await createHash('asdfasdf'))
  add('link cidv0', cidv0)
  add('link cidv1', cidv1)
  add('list with links', [ cidv0, cidv1, cidv0, cidv1, cid2 ])
  add('map with links', { helloV0: cidv0, helloV1: cidv1 })
  const sink = copy(kitchenSink)
  sink.cidv0 = cidv0
  sink.cidv1 = cidv1
  sink.arr.push([cidv0, cidv1])
  sink.map.cidv0 = cidv0
  sink.map.cidvv1 = cidv1
  add('kitchen sink w/ links', sink)

  add('chain-1', [
    new Uint8Array([ 0, 234, 7 ]),
    [ [ bin ] ],
    [ 1, [ bin3 ] ],
    [ [ [ [ bin2 ] ] ] ],
    [ [ 21312321 ] ],
    [ cidv1 ],
    new Uint8Array([ 0, 1, 32, 220, 250]),
    1145,
    CID.from('bafy2bzaceaodj25diqmdntxag4lrm5mdzzuudxh4rsw3ltmbk7ibkmm7mzwwg'),
    CID.from('bafy2bzaceb7htmtblp2wnk556i4hiextoqm2c6y537z3hxsvk5l6q3tk3dijq'),
    CID.from('bafy2bzacea3722ekjft7sfhdz2en2mfnxchyc4hgzaraqd2jmhuk52urs25ok')
  ])

  return fixtures
}

export default create


