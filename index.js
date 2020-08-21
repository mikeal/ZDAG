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


export default multiformats => {
  const { CID } = multiformats
  const encode = obj => {
    const cids = []
    const values = []
    const addValue = v => {
      const entry = [ v, () => values.indexOf(entry) ]
      for (let i = 0; i < values.length; i++) {
        const value = values[i][0]
        if (value.byteLength < v.byteLength) continue
        else if (value.byteLength > v.byteLength) {
          values.splice(i, 0, entry)
          return entry[1]
        } else {
          // equal length
          let cont = false
          for (let i = 0; i < value.byteLength; i++) {
            const int = value[i]
            const comp = v[i]
            if (int < comp) {
              cont = true
              break
            } else if (int > comp) {
              values.splice(i, 0, entry)
              return entry[1]
            }
          }
          if (!cont) {
            // matched
            return values[i][1]
          }
        }
      }
      values.push(entry)
      return entry[1]
    }
    const addCID = c => {
      const entry = [ c, () => values.indexOf(entry) ]
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
          p(108, map, 100)
        }
      }
    }
    format(obj, structure)
    const encoded = []
    cids.forEach(c => encoded.push(...c.bytes))
    encoded.push(0)
    let len = 0
    const val = []
    for (const [bytes] of values) {
      if (len === bytes.byteLength) {
        val.push(0, ...bytes)
      } else {
        const increase = bytes.byteLength - len
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
    let i = 0

    // Parse CIDs
    while (i < bytes.byteLength ) {
      const [ code, offset ] = dvint(bytes.subarray(i))
      const start = i
      i += offset
      if (code === 0) {
        break
      }
      if (code === 18) {
        // CIDv0
        const [ length, offset ] = dvint(bytes.subarray(i))
        i += ( length + offset )
        const cid = CID.from(bytes.subarray(start, i))
        cids.push(cid)
        continue
      }
      if (code > 2) {
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
    let len = 0
    while (i < endValues) {
      const [ increase, offset ] = dvint(bytes.subarray(i))
      len += increase
      i += offset
      const value = bytes.subarray(i, i + len)
      values.push(value)
      i += len
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
          if (!parent) throw new Error('Invalid separator')
          return parent
        }
        if (code === 102) {
          return toString(values[read()])
        }
        if (code === 103) {
          return values[read()]
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
          while (code !== 0 && i < bytes.byteLength) {
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
          let [ code ] = vint(bytes.subarray(i))
          while (code !== 100 && i < bytes.byteLength) {
            ret.push(parse())
            code = vint(bytes.subarray(i))[0]
          }
          return ret
        }
      }
      throw new Error('parsing error')
    }
    return parse()
  }
  return { encode, decode }
}
