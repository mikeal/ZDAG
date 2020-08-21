import varint from 'varint'

const isFloat = n => Number(n) === n && n % 1 !== 0

const vint = varint.encode
const dvint = b => [ varint.decode(b), varint.decode.bytes ]
const { floor } = Math
const fromString = str => (new TextEncoder()).encode(str)
const toString = b => (new TextDecoder()).decode(b)

const floatToDouble = o => {
  const i = o < 0 ? Math.ceil(o) : Math.floor(o)
  // this is problem for negative floats
  const d = parseInt(o.toString().slice(o.toString().indexOf('.')+1))
  return [ i, d ]
}

const doubleToFloat = ([i, d]) => parseFloat(i + '.' + d)

console.log(floatToDouble(1.5), floatToDouble(-1.5))

const entries = obj => Object.keys(obj).sort().map(k => [k, obj[k]])

export default multiformats => {
  const { CID } = multiformats
  const encode = obj => {
    // TODO: is-circular check
    const cids = []
    const values = []
    const addValue = v => {
      const entry = [ v, () => values.indexOf(entry) ]
      // TODO: sorted add
      values.push(entry)
      return entry[1]
    }
    const addCID = c => {
      const entry = [ c, () => values.indexOf(entry) ]
      // TODO: sorted add
      cids.push(entry)
      return entry[1]
    }
    const format = o => {
      if (o === null) return [ 104 ]
      if (o === true) return [ 105 ]
      if (o === false) return [ 106 ]
      if (typeof o === 'string') {
        return [ 102, addValue(fromString(o)) ]
      }
      if (typeof o === 'number') {
        if (isFloat(o)) {
          return [ 107, ...floatToDouble(o).map(vint).flat() ]
        } else {
          if (o > 99 && o < 111) return [ 101, ...vint(o) ]
          return vint(o)
        }
      }
      if (typeof o === 'object') {
        let cid = CID.asCID(o)
        if (cid) return [ 110, addCID(o) ]
        if (cid instanceof Uint8Array) return [ 103, addValue(o) ]
        if (Array.isArray(o)) {
          return [ 109, ...o.map(v => format(v)).flat(), 100 ]
        }
        const _map = Object.entries(o).map(([k, v]) => {
          return [ addValue(fromString(k)), format(v) ]
        })
        const map = () => {
          return _map.sort(([x], [y]) => x() - y()).map(([index, value]) => {
            return [ ...vint(index+1), ...value ]
          }).flat()
        }

        return [ 108, map, 100 ]
      }
    }
    const structure = format(obj)
    const val = values.map(([bytes]) => [ ...vint(bytes.byteLength), ...bytes ]).flat()
    const enc = x => Array.isArray(x) ? x : vint(x)
    const body = structure.map(i => typeof i === 'number' ? i : enc(i())).flat()
    const links = cids.map(c => [...c.bytes]).flat()
    const encoded = [ ...links, 0, ...vint(val.length), ...val, ...body ]
    return new Uint8Array(encoded)
  }
  const decode = bytes => {
    const cids = []
    const values = []
    let i = 0

    // Parse CIDs
    while (i < bytes.byteLength ) {
      const [ code, offset ] = dvint(bytes.subarray(i))
      i += offset
      if (code === 0) {
        break
      }
      if (code === 18) {
        // CIDv0
        const [ length, offset ] = dvint(bytes.subarray(i))
        const cid = CID.from(bytes.subarray(i, length + offset))
        cids.push(cid)
        i += ( length + offset )
        continue
      }
      if (code > 2) {
        const start = i - offset
        const add = () => {
          const [ val, offset ] = vint(bytes.subarray(i))
          i += offset
          return val
        }
        add()
        add()
        i += add()
        const cid = CID.from(bytes.subarray(start, i))
      }
    }

    // Parse Values
    const [ valuesLength, offset ] = dvint(bytes.subarray(i))
    i += offset
    const endValues = i + valuesLength
    while (i < endValues) {
      const [ length, offset ] = dvint(bytes.subarray(i))
      i += offset
      const value = bytes.subarray(i, length)
      values.push(value)
      i += length
    }
    // Parse Structure

    const read = () => {
      const [ code, offset ] = dvint(bytes.subarray(i))
      i += offset
      return code
    }

    const parse = (parent) => {
      while (i < bytes.byteLength) {
        const code = read()
        if (code < 99 || code > 110) {
          return code
        }
        if (code === 101) {
          return read()
        }
        if (code === 100) {
          if (!parent) throw new Error('Invalid separator')
          return parent
        }
        if (code === 102) {
          return fromString(values[read()])
        }
        if (code === 103) {
          return values[read()]
        }
        if (code === 104) return null
        if (code === 105) return true
        if (code === 106) return false
        if (code === 107) return doubleToFloat([read(), read()])
        if (code === 108) {
          const ret = {}
          let code = read()
          while (code !== 0) {
            const key = fromString(values[code - 1])
            ret[key] = parse()
            code = read()
          }
          return ret
        }
        if (code === 109) {
          const ret = []
          let code = bytes.subarray(i)
          while (code !== 100) {
            ret.push(read())
            code = bytes.subarray(i)
          }
        }
      }
    /*
102 : utf8 string reference
103 : bytes reference
104 : null
105 : true
106 : false
107 : float
108 : map
109 : list
110 : cid reference
*/
    }
  }
  return { encode, decode }
}
