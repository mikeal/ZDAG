
# ZBL (zdag byte list)

zbl is strict subset of zdag. It's a valid list of bytes or an empty

An empty zbl is encoded as a single 122 byte [STRUCTURE-EMPTY-LIST](#STRUCTURE-EMPTY-LIST).

The only other valid first byte is 0. Denoting an empty links header.

## ZBL_FIRST_BYTE

```js
const [ code ] = READ(1)
if (code === 0) {
  VALUE_TABLE = HEADER_VALUES()
} else if (code === 122) {
  return []
} else {
  throw new Error('ZBL: INVALID FIRST BYTE')
}
ZBL_STRUCTURE()
```

The only valid stucture is a typed byte list, the structure segment
cannot begin with anything other than 119.

## ZBL_STRUCTURE

```js
const [ code ] = READ(1)
if (code !== 119) {
  throw new Error(`ZBL: INVALID STRUCTURE ${code}`)
}
return STRUCTURE_TYPED_LINKS_LIST()
````

## READ_VALUE_INDEX

The value index uses the entire 1 byte range when the value
table is less than 255 in length. Once it's 255 entrires or
larger varints are used.

```js
if (VALUE_TABLE.length < 255) {
  const [ INDEX ] = READ(1)
  return INDEX
} else {
  return READ_VARINT()
}
```

# Typed Lists

When every value

## STRUCTURE_TYPED_LINKS_LIST

Zero length lists are not allowed in order to ensure determinism.

```js
let INDEX = READ_VALUE_TABLE_INDEX()
if (INDEX === 0) {
  throw new Error('STRUCTURE_TYPED_LINKS_LIST: empty typed lists are not allowed')
}
```

[READ_VALUE_INDEX()](#READ_VALUE_INDEX) until a 0 byte.

Every value table index is offset by one in order to use the 0 byte for termination.

```
while (INDEX !== 0 && READ_REMAINING() > 0) {
  // Index is offset by one to use 0 for list termination
  yield VALUE_TABLE[INDEX - 1]
  INDEX = READ_VALUE_INDEX()
}
```

# STRUCTURE

```js
const TOKENS = {
  STRUCTURE_TYPED_BYTE_LIST:   117,
  STRUCTURE_TYPED_LINKS_LIST:  119,
  STRUCTURE_EMPTY_LIST:        122
}
```

### Encoding Single CIDv0

```js
const HashDigest = SHA256(new Uint8Array([1]))
const CIDv0 = [
 18,                      // multihash: sha2-256
 HashDigest.byteLength,   // hash digest length
 ...HashDigest,           // every byte in digest
]
INPUT = CID(CIDv0)
OUTPUT = [
                                                         // HEADER-LINKS
  18,                     // multihash: sha2-256         // HEADER-CIDV0
  32,                     // hash digest length          // HEADER-LINKS-CID-HASH-DIGEST-LENGTH
  ...HashDigest,          // every byte in digest        // HEADER-LINKS-CID-HASH-DIGEST
  0,                      // end of CID header           // HEADER-LINKS-END
  0,                      // 0 length values header      // HEADER-VALUES-LENGTH
                                                         // STRUCTURE
  110,                    // link reference              // STRUCTURE-LINK
  0                       // link index                  // STRUCTURE-LINK-INDEX
]
```

### Encoding Single CIDv1

```js
const HashDigest = SHA256(new Uint8Array([1]))
const CIDv1 = [
  1,                       // CIDv1
  113,                     // mulitcodec: dag-cbor
  18,                      // multihash: sha2-256
  HashDigest.byteLength,   // hash digest length
  ...HashDigest,           // every byte in digest
]

INPUT = CID(CIDv1)
OUTPUT = [
                                                         // HEADER-LINKS
  1,                                                     // HEADER-LINKS-CIDV1
  113,                                                   // HEADER-LINKS-CIDV1-CODEC
  18,                     // multihash: sha2-256         // HEADER-LINKS-CIDV1-HASH
  32,                     // hash digest length          // HEADER-LINKS-CID-HASH-DIGEST-LENGTH
  ...HashDigest,          // every byte in digest        // HEADER-LINKS-CID-HASH-DIGEST
  0,                      // end of CID header           // HEADER-LINKS-END
                                                         // HEADER-VALUES
  0,                      // 0 length values header      // HEADER-VALUES-LENGTH
                                                         // STRUCTURE
  110,                    // link reference              // STRUCTURE-LINK
  0                       // link index                  // STRUCTURE-LINK-INDEX
]
```

### List of CIDv1 and CIDv0

```js
const HashDigest = SHA256(new Uint8Array([1]))
const CIDv0 = [
 18,                      // multihash: sha2-256
 HashDigest.byteLength,   // hash digest length
 ...HashDigest,           // every byte in digest
]
const CIDv1 = [
  1,                       // CIDv1
  113,                     // mulitcodec: dag-cbor
  18,                      // multihash: sha2-256
  HashDigest.byteLength,   // hash digest length
  ...HashDigest            // every byte in digest
]
INPUT = [ CID(CIDv1), CID(CIDv0) ]
OUTPUT = [
                                                         // HEADER-LINKS
  18,                     // multihash: sha2-256         // HEADER-CIDV0
  32,                     // hash digest length          // HEADER-LINKS-CID-HASH-DIGEST-LENGTH
  ...HashDigest,          // every byte in digest        // HEADER-LINKS-CID-HASH-DIGEST
  1,                                                     // HEADER-LINKS-CIDV1
  113,                                                   // HEADER-LINKS-CIDV1-CODEC
  18,                     // multihash: sha2-256         // HEADER-LINKS-CIDV1-HASH
  32,                     // hash digest length          // HEADER-LINKS-CID-HASH-DIGEST-LENGTH
  ...HashDigest,          // every byte in digest        // HEADER-LINKS-CID-HASH-DIGEST
  0,                      // end of CID header           // HEADER-LINKS-END
                                                         // HEADER-VALUES
  0,                      // 0 length values header      // HEADER-VALUES-LENGTH
                                                         // STRUCTURE
  119,                    // link typed list             // STRUCTURE-TYPED-LIST-LINKS
  2                       // link index +1 [1]           // STRUCTURE-LINK-INDEX
  1                       // link index +1 [0]           // STRUCTURE-LINK-INDEX
                                                         // STRUCTURE-OMIT-END
]
```
