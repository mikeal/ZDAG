import varint from 'varint'

const isFloat = n => Number(n) === n && n % 1 !== 0

const vint = varint.encode
const dvint = b => [ varint.decode(b), varint.decode.bytes ]
const { floor } = Math
const fromString = str => (new TextEncoder()).encode(str)
const toString = b => (new TextDecoder()).decode(b)

const doubleToFloat = ([i, d]) => parseFloat(i + '.' + d)

const entries = obj => Object.keys(obj).sort().map(k => [k, obj[k]])

/* Table
100 : delimiter
101 : varint
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

export default multiformats => {
  const { CID } = multiformats
  const encode = obj => {
    const cids = []
    const values = []
    const addValue = v => {
      const entry = [ v, () => values.indexOf(entry) ]
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
        const comp = compare(cid.bytes, c.bytes)
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
          const s = o.toString()
          if (o < 0) {
            const [ left, right ] = s.split('.').map(s => parseInt(s))
            p(112)
            p(...vint(-left), ...vint(right))
          } else {
            p(107)
            s.split('.').forEach(s => p(...vint(parseInt(s))))
          }
        } else {
          if (o < 0) p(111, ...vint(-o))
          else if (o > 99 && o < 113) p(101, ...vint(o))
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
    cids.forEach(([c]) => encoded.push(...c.bytes))
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
    encoded.push(...vint(val.length))
    encoded.push(...val)
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
      structure.pop()
    }
    return new Uint8Array(encoded)
  }

  const decode = bytes => {
    const cids = []
    const values = []

    // Parse CIDs
    while (bytes.byteLength) {
      let cid
      const [ code, offset ] = dvint(bytes)
      if (code === 0) {
        bytes = bytes.subarray(offset)
        break
      }
      if (code === 18) {
        // CIDv0
        const [ length, _offset ] = dvint(bytes.subarray(offset))
        const size = length + offset + _offset
        cid = CID.from(bytes.subarray(0, size))
        bytes = bytes.subarray(size)
      } else {
        if (code > 1) throw new Error('nope!')
        let i = offset
        const add = () => {
          const [ val, offset ] = dvint(bytes.subarray(i))
          i += offset
          return val
        }
        add()
        add()
        i += add()
        i += 1
        cid = CID.from(bytes.subarray(0, i))
        bytes = bytes.subarray(i)
      }
      cids.push(cid)
    }

    const [ valuesLength, offset ] = dvint(bytes)
    let section = bytes.subarray(offset, offset + valuesLength)
    bytes = bytes.subarray(offset + valuesLength)

    let len = 0
    while (section.byteLength) {
      const [ increase, offset ] = dvint(section)
      len += increase
      section = section.subarray(offset)
      values.push(section.subarray(0, len))
      section = section.subarray(len)
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
        return read()
      }
      if (code === 111) {
        return -read()
      }
      if (code === 100) {
        throw new Error('Invalid separator')
      }
      if (code === 102) {
        return toString(values[read()])
      }
      if (code === 103) {
        return values[read()]
      }
      if (code === 110) {
        const i = read()
        return cids[i]
      }
      if (code === 104) return null
      if (code === 105) return true
      if (code === 106) return false
      if (code === 107) return doubleToFloat([read(), read()])
      if (code === 112) return doubleToFloat([-read(), read()])
      if (code === 108) {
        const ret = {}
        let code = read()
        let index = 0
        while (code !== 0 && bytes.byteLength > 1) {
          code = code - 1
          index += code
          const key = toString(values[index])
          ret[key] = parse()
          code = read()
        }
        return ret
      }
      if (code === 109) {
        const ret = []
        let [ code ] = dvint(bytes)
        while (code !== 100 && bytes.byteLength > 1) {
          ret.push(parse())
          code = dvint(bytes)[0]
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
