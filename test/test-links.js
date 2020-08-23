import multiformats from 'multiformats/basics'
import base58 from 'multiformats/bases/base58'
import { deepStrictEqual as same } from 'assert'
import main from '../index.js'

const fixtures = {}

const add = (name, obj) => { fixtures[name] = obj }

const { CID } = multiformats
multiformats.multibase.add(base58)

export default async test => {
  const hash = await multiformats.multihash.hash(Buffer.from('abc'), 'sha2-256')
  const cidv0 = CID.create(0, 112, hash)
  const cidv1 = CID.create(1, 0x71, hash)
  add('link cidv0', cidv0)
  add('link cidv1', cidv1)

  const { encode, decode } = main(multiformats)

  test('encode single cidv0', test => {
    const encoded = encode(cidv0)
    const expected = [ ...hash, 0, 0, 110, 0 ]
    same([...encoded], expected)
    test('decode single cidv0', () => {
      const cid = decode(encoded)
      same(cid, cidv0)
    })
  })

  test('encode single cidv1', test => {
    const encoded = encode(cidv1)
    const expected = [ ...cidv1.bytes, 0, 0, 110, 0 ]
    same([...encoded], expected)
    test('decode single cidv1', () => {
      const cid = decode(encoded)
      same(cid, cidv1)
    })
  })

  test('encode cidv0 & cidv1', test => {
    const input = [cidv0, cidv1]
    const encoded = encode(input)
    const expected = [ ...hash, ...cidv1.bytes, 0, 0, 109, 110, 0, 110, 1 ]
    same([...encoded], expected)
    test('decode single cidv1', () => {
      const output = decode(encoded)
      same(output, input)
    })
  })
}
