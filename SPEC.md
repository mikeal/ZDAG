
# PARSING

The following logic requires a few constants to be defined.

 * `DATA` is the encoded zdag data to be parsed.
 * `READ(int)` return `int` number of bytes and then truncates the remaining
   data to be read by that amount.
 * `DATA_REMAINING()` returns the length of the remaing data.
 * `READ_VARINT()` return an `int` decoded as a varint and truncates the remaining
   data to be read by the size of the varint.
 * `LINKS_TABLE` is initialized as an empty list.
 * `VALUES_TABLE` is initialized as an empty list.
 * `ITERATOR` iterates over an array of integers or byte array (implementation dependent)
   and yields the index and value of every element in the array.

This parse specification in written in a spec friendly code style but it
is valid JavaScript that is parsed and turning into a running library
compliance tests can be run against.

In order to make it easier to implement in other languages this spec
abstracts all JavaScript data structure  operations into methods and constants that
can be implemented in any langauge. The JS implementation of these
methods is below for reference (and for builds).

```js
READ = ( int ) => {
  const SLICE = DATA.subarray(0, int)
  DATA = DATA.subarray(int)
  return SLICE
}

DATA_REMAINING = ( ) => {
  return DATA.length
}

READ_VARINT = ( ) => {
  const [ CODE, LENGTH ] = varint.decode(DATA)
  DATA = DATA.subarray(LENGTH)
  return CODE
}

LINKS_TABLE = []
VALUES_TABLE = []

PUSH_VALUE ( VALUE ) => {
  VALUES_TABLE.push(VALUE)
}

ITERATOR = function * ( array ) {
  let i = 0
  for (const value of array) {
    yield [ i, value ]
    i++
  }
}
```

# HEADER_VALUES

The values header begins with the length of the entire header.

The header data is a series of varint's for the length of every value followed
by the value. In order to compress the space used for the lengths, the offset
from the prior length is used rather than the full length.

Every entry in the value header has to have its order validated in order
to ensure determinism.

```
const LENGTH = READ_VARINT()

const END = DATA_REMAINING() - LENGTH

const VALID_VALUE_ORDER = ( XX, YY ) => {
  for (const [ INDEX, INT ] of ITERATOR(XX)) {
    if (INT < YY[i]) return
    if (INT > YY[i]) throw new Error('VALID_VALUE_ORDER: values out of order')
  }
}

let SIZE = 0
let PREV
while (DATA_REMAINING() > END) {
  INCEASE = READ_VARINT()
  SIZE += INCREASE

  if (SIZE === 0 && PREV) {
    // Allowing duplicate 0 byte entries would violate determinism
    throw new Error('HEAD_VALUES: cannot encode two zero byte values in header')
  }

  const VALUE = READ(SIZE)

  // if there was any increase then we already know the order was correct
  if (INCREASE === 0 && PREV) {
    VALID_VALUE_ORDER(PREV, VALUE)
  }
  PUSH_VALUE(VALUE)
  PREV = VALUE
}
STRUCTURE()
```

# ZBL (zdag byte list)

zbl is a strict subset of zdag. It's a valid list of bytes or an empty

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
while (INDEX !== 0 && DATA_REMAINING() > 0) {
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
