import varint from 'varint'
import pako from 'pako'

const isFloat = n => Number(n) === n && n % 1 !== 0

const vint = varint.encode
const dvint = b => [ varint.decode(b), varint.decode.bytes ]
const { floor } = Math
const fromString = str => (new TextEncoder()).encode(str)
const toString = b => (new TextDecoder()).decode(b)

const doubleToFloat = ([mantissa, int]) => int / Math.pow(10, mantissa)

const floatToDouble = float => {
  let mantissa = 0
  while (isFloat(float)) {
    float = float * 10
    mantissa += 1
  }
  if (mantissa === 0) throw new Error('Not float')
  return [ ...vint(mantissa), ...vint(float) ]
}

// get multihash length
const mhl = h => {
  const [ , offset ] = dvint(h)
  const [ length ] = dvint(h.subarray(offset))
  return length
}

const entries = obj => Object.keys(obj).sort().map(k => [k, obj[k]])

const compare = (b1, b2) => {
  if (b1.byteLength > b2.byteLength) return -1
  else if (b1.byteLength < b2.byteLength) return 1
  else {
    for (let i = 0;i < b1.byteLength; i++) {
      const c1 = b1[i]
      const c2 = b2[i]
      if (c1 === c2) continue
      if (c1 > c2) return -1
      else return 1
    }
    return 0
  }
}

const compareCIDs = (c1, c2) => {
  if (c1.version > c2.version) return -1
  else if (c1.version > c2.version) return 1
  else {
    if (c1.code > c2.code) return -1
    if (c1.code < c2.code) return 1
    return compare(c1.multihash, c2.multihash)
  }
}

export default multiformats => {
  const { CID } = multiformats
  const encode = (obj, compress=false) => {
    const cids = []
    const values = []
    const addValue = v => {
      const entry = [ v, () => values.indexOf(entry) ]
      if (values.length > 1) {
        // compare against the last value, it's rather common
        // that values are incrementing naturally over the course
        // of a data structure
        const last = values[values.length -1]
        const comp = compare(last[0], v)
        if (comp === 1) {
          values.push(entry)
          return entry[1]
        }
        if (comp === 0) {
          return last[1]
        }
      }
      for (let i = 0; i < values.length; i++) {
        const value = values[i][0]
        const comp = compare(value, v)
        if (comp === 0) {
          return values[i][1]
        }
        if (comp === -1) {
          values.splice(i, 0 , entry)
          return entry[1]
        }
        if (comp === 1) {
          continue
        }
        throw new Error('Parser error')
      }
      values.push(entry)
      return entry[1]
    }
    const addCID = c => {
      const entry = [ c, () => cids.indexOf(entry) ]
      for (let i = 0; i < cids.length; i++) {
        const cid = cids[i][0]
        const comp = compareCIDs(cid, c)
        if (comp === 0) {
          return cids[i][1]
        }
        if (comp === -1) {
          cids.splice(i, 0 , entry)
          return entry[1]
        }
        if (comp === 1) {
          continue
        }
        throw new Error('Parser error')
      }
      // TODO: sorted add
      cids.push(entry)
      return entry[1]
    }
    const structure = []

    const format = (o, container, seen=new Set()) => {
      const p = (...args) => container.push(...args)
      if (o === null) p(104)
      else if (o === true) p(105)
      else if (o === false) p(106)
      else if (typeof o === 'string') {
        p(102, addValue(fromString(o)))
      }
      else if (typeof o === 'number') {
        if (isFloat(o)) {
          if (o < 0) {
            p(112)
            p(...floatToDouble(o * -1))
          } else {
            p(107)
            p(...floatToDouble(o))
          }
        } else {
          if (o < 0) p(111, ...vint(-o))
          else if (o > 99 && o < 116) p(101, ...vint(o))
          else p(...vint(o))
        }
      }
      else if (typeof o === 'object') {
        let cid = CID.asCID(o)
        if (cid) p(110, addCID(o))
        else if (o instanceof Uint8Array) p(103, addValue(o))
        else if (Array.isArray(o)) {
          if (seen.has(o)) throw new Error('Circular reference')
          seen.add(o)
          p(109)
          const ret = []
          o.forEach(v => format(v, ret, seen))
          p(...ret)
          p(100)
        } else {
          if (seen.has(o)) throw new Error('Circular reference')
          seen.add(o)
          const _map = Object.entries(o).map(([k, v]) => {
            const ret = []
            format(v, ret, seen)
            return [ addValue(fromString(k)), ret ]
          })
          const map = () => {
            let len = 0
            const m = _map.map(x => [x[0](), x[1]]).sort(([x], [y]) => x - y)
            const ret = []
            for (const [index, value] of m) {
              if (index === len) ret.push(1, ...value)
              else {
                const increase = index - len
                ret.push(...vint(increase + 1), ...value)
                len += increase
              }
            }
            return ret
          }
          p(108, map, 0)
        }
      }
    }
    format(obj, structure)
    const encoded = []
    let prefix = [ 0, 112, 18 ]
    /* i think the vm does something fancy here because this is faster
     * than it should be.
     */
    const match = (a1, a2) => JSON.stringify(a1) === JSON.stringify(a2)
    const shouldCompress = cid => {
      const [ hashfn ] = dvint(cid.multihash)
      const pre = [ cid.version, cid.code, hashfn ]
      if (match(prefix, pre)) {
        return true
      }
      prefix = pre
      return false
    }
    if (cids.length && cids[0][0].version === 0) {
      encoded.push(18)
    }
    for (const [ cid ] of cids) {
      if (mhl(cid.multihash) < 4) {
        encoded.push(...cid.bytes)
        continue
      }
      if (shouldCompress(cid)) {
        const [ , offset ] = dvint(cid.multihash)
        encoded.push(...cid.multihash.subarray(offset))
      } else {
        encoded.push(...cid.bytes)
      }
    }
    encoded.push(0)
    let len = 0
    const val = []
    for (const [bytes] of values) {
      if (len === bytes.byteLength) {
        val.push(0, ...bytes)
      } else {
        const increase = bytes.byteLength - len
        if (increase < 0) throw new Error('Parser error: values out of order')
        len = bytes.byteLength
        val.push(...vint(increase), ...bytes)
      }
    }
    if (compress && val.length) {
      const compressed = pako.deflate(val)
      encoded.push(...vint(compressed.byteLength))
      encoded.push(...compressed)
    } else {
      encoded.push(...vint(val.length))
      encoded.push(...val)
    }
    let inline
    if (encoded.length === 2) {
      encoded.splice(0, 2)
      inline = true
    }
    const build = container => {
      for (const i of container) {
        if (typeof i === 'number') encoded.push(i)
        else {
          const x = i()
          if (typeof x === 'number') encoded.push(...vint(x))
          else {
            if (!Array.isArray(x)) throw new Error('Parser error')
            build(x)
          }
        }
      }
    }
    build(structure)
    const [ code ] = structure
    if (code === 108 || code == 109) {
      // remove delimiter when structure is map or list
      encoded.pop()
    }
    if (inline) {
      const [ code ] = encoded
      if (code < 19) {
        encoded.splice(0, 0, 101)
      }
    }
    return new Uint8Array(encoded)
  }

  const decode = (bytes, compress=false) => {
    const cids = []
    const values = []

    const parseLinks = () => {
      // Parse CIDs
      let inV0 = true
      let prefix = [ ]
      while (bytes.byteLength) {
        let cid
        let length
        let [ code, offset ] = dvint(bytes)
        if (code === 3) throw new Error('sdf')
        if (code === 0) {
          bytes = bytes.subarray(offset)
          break
        }

        bytes = bytes.subarray(offset)
        if (code === 18) {
          ;[ length, offset ] = dvint(bytes)
          while (length > 4) {
            const digest = bytes.subarray(0, offset + length)
            const cid = CID.create(0, 112, new Uint8Array([18, ...digest]))
            bytes = bytes.subarray(offset + length)
            ;[length, offset] = dvint(bytes)
            cids.push(cid)
          }
        }
        if (code === 1) {
          const version = 1
          const [ codec, offset1 ] = dvint(bytes)
          bytes = bytes.subarray(offset1)
          const [ hashfn, offset2 ] = dvint(bytes)
          let [ length, offset3 ] = dvint(bytes.subarray(offset2))
          const size = offset2 + length + offset3
          const multihash = bytes.subarray(0, size)
          bytes = bytes.subarray(size)
          const cid = CID.create(version, codec, multihash)
          cids.push(cid)

          ;[ length, offset ] = dvint(bytes)
          while (length > 4) {
            const digest = bytes.subarray(0, offset + length)
            const cid = CID.create(version, codec, new Uint8Array([...vint(hashfn), ...digest]))
            bytes = bytes.subarray(offset + length)
            ;[length, offset] = dvint(bytes)
            cids.push(cid)
          }
        }
      }
    }

    const parseValues = () => {
      const [ valuesLength, offset ] = dvint(bytes)
      let section = bytes.subarray(offset, offset + valuesLength)
      bytes = bytes.subarray(offset + valuesLength)

      if (compress && section.byteLength) {
        section = pako.inflate(section)
      }

      let len = 0
      while (section.byteLength) {
        const [ increase, offset ] = dvint(section)
        len += increase
        section = section.subarray(offset)
        values.push(section.subarray(0, len))
        section = section.subarray(len)
      }
    }

    const [ code ] = bytes
    let inline = false
    if (code > 19) {
      inline = true
    } else {
      parseLinks()
      parseValues()
    }

    const read = () => {
      const [ code, offset ] = dvint(bytes)
      bytes = bytes.subarray(offset)
      return code
    }

    const parse = () => {
      const [ code, offset ] = dvint(bytes)
      bytes = bytes.subarray(offset)
      if (code < 100 || code > 112) {
        return code
      }
      if (code === 101) {
        /* 101 is for inline varints that fall in a required range
         * the acceptable uses are limited to ensure determinism and
         * must be validated.
         */
        const i = read()

        if (i < 100 || i > 115) {
          if (inline) {
            if (i > 18) {
              const errMsg = 'Parser error: can only use 101 when structure is inline varint below 19'
              throw new Error(errMsg)
            }
            inline = false // this can only be used to open the structure
            return i
          }
          throw new Error('Can only use 101 to inline inters in the protected range')
        } else {
        }
        return i
      }
      if (code === 111) {
        return -read()
      }
      if (code === 100) {
        throw new Error('Invalid separator')
      }
      if (code === 102 || code === 103) {
        const i = read()
        const bin = values[i]
        if (typeof bin === 'undefined') {
          throw new Error(`Parser error: missing value ref ${i}, valueLength(${values.length})`)
        }
        if (code === 102) return toString(bin)
        return bin
      }
      if (code === 110) {
        const i = read()
        const c = cids[i]
        if (typeof c === 'undefined') {
          throw new Error(`Parser error: missing value ref ${i}, linksLength(${cids.length})`)
        }
        return c
      }
      if (code === 104) return null
      if (code === 105) return true
      if (code === 106) return false
      if (code === 107) return doubleToFloat([read(), read()])
      if (code === 112) return -doubleToFloat([read(), read()])
      if (code === 108) {
        if (!bytes.byteLength) return {}
        const ret = {}
        let code = read()
        let index = 0
        while (code !== 0 && bytes.byteLength) {
          code = code - 1
          index += code
          const key = toString(values[index])
          ret[key] = parse()
          if (bytes.byteLength) code = read()
        }
        return ret
      }
      if (code === 109) {
        if (!bytes.byteLength) return []
        const ret = []
        let [ code ] = dvint(bytes)
        while (code !== 100 && bytes.byteLength) {
          ret.push(parse())
          if (bytes.byteLength) {
            code = dvint(bytes)[0]
          }
        }
        if (code === 100) {
          bytes = bytes.subarray(1)
        }
        return ret
      }
      throw new Error('parser error')
    }
    const ret = parse()
    if (bytes.byteLength) {
      throw new Error('parser error')
    }

    return ret
  }
  return { encode, decode }
}
