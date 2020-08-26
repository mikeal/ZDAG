# ZDAG

```
[ links | values | structure ]
```

# COMPRESSION

## VARINT

Variable size compressed integer.

## VARINT_TABLE

I use VARINTs throughout this format when referring to entries in a
compression table.

When we use a VARINT to refer to a table entry we only get 126
addresses in 1b.

But, since we know the table size we can open up this range to
255 references when the table is below a particular range. That range
will vary slightly depending on the bytes that might need to be
reserved in the particular compression rule.

This technique effectively doubles the 1 byte address space for
our compresion table if you can keep the number of unique entries in
the table small.

This can be leveraged by application specific algorithms using IPLD.
Once you understand the compression rules for the values that go
into these tables you can design the structure to reduce the table entries
if they can take advantage of the extra address space.

This may be novel, or maybe not, i haven't seen these things plugged
together in this exact way before, but VARINT has been around a long
time so I doubt I'm the first. I definitely didn't invent compression
tables :P

## DELTA

Delta compression is used heavily across this format.

In the context of this specification, whenever refering to indexes or
lengths in deterministicly iterable structures I write the DELTA
between the prior index/length and the next as a VARINT.

This allows for a 64b number space for any index/length which we then compress
even further by reducing the size of the number we encode. This
means we will almost always keep the length to a single byte.

## LINK_COMPRESSION

The goal here is to find the most efficient possible way to store CIDs.

All we need to do is parse the CIDs linearly. That will implicitely put them
into a compression table that can be used for representations later on. This
means that if we can find the most efficient sorted parsing algorithm of CIDs
we will have created the smallest possible compression algorithm.

All CIDs begin with a multicodec.

Since multicodecs all begin with a VARINT we're already in the VARINT compression
space. We get that for free.

Take a pause...

This means that we are already in an 8 bit compression space. Any sub-byte
compression scheme is already impossible because of decisions that have already
been made in multiformats.

This means that the following 8b compression techniques are the only that are
actually possible over these data structures since the entire 8b space is being
used for necessary fidelity.

So, what we're talking about in this document is the best algorithm we can
ever create for CID data structures. Pretty fun stuff!

We CID's have a required deterministic sorting order.

### Sorting

```
[ v0 , length 10, digest ]
[ v0 , length 11, digest-a ]
[ v1, codec, hashfn ] [ digest-a ]
[ v1, codec-a, hashfn-1 ] [ length-1] [ digest-a ]
[ v1, codec-b, hashfn-1 ] [ length-1] [ digest-a ]
[ v1, codec-b, hashfn-2 ] [ length-1] [ digest-a ]
[ v1, codec-b, hashfn-2 ] [ length-1] [ digest-b ]
[ v1, codec-b, hashfn-2 ] [ length-2] [ digest-b ]
```

CIDvs are sorted CIDv0 first and then CIDv2.

CIDv0 is sorting length first, then digest byte comparison.

CIDv0 is sorted by three consequtive VARINTs: one for the CID version,
one for the codec, and one for the hash function. The CID's are then
sorted by digest length, and finally by digest comparison.

The sorting algorithm isn't just for use in the compression, it also
guarantees determinism in the block format.

In fact, since this block format is deterministic you could simply
parse out the compressed links header, hash it, and use to determine
any other blocks that link to the same set of blocks as this block.

Holy shit, I just thought of that. This is thing is fucking amazing.

### CIDv0 Compression

To start, we need a token to signal if there are CIDv0's

Since the 0 byte is reserved for the identity multicodec we know that a CID
of no current or future version can ever begin with it so we can reserve it
for termination of the link header.

We use 18 as the token for signaling CIDv0.

Why 18?

First of all, you need a 1b token to signal that there are CIDv0s. You
need a byte full in order to reserve the 0 byte for termination of the
structure later, so you can't even shave bits below a full byte.

This means that we effectively don't have to reserve a byte for this
signal at all. We share this byte with the header terminator.

18 is the actual first byte of a CIDv0. An encoder likely has 18 as a
a constant in the close scope. A decompressor will need an 18 shortly
in order to start creating new memory allocations starting with 18
for each CIDv0 in the block. So there isn't a better byte to reserve.

Why the DELTA from 2?

Since we have identity multihashes the hash length can be literally
any number, even 0.

But a CIDv0 is never an identity multihash so we don't have to worry about conflicting with
0.

However, after we write one digest we'll need to write another, and 1 would
be both a valid increment **and** a valid length. So we write the DELTA
for the subsequent lengths +2 which means we lose 2 bytes in the 1byte DELTA
compression space.

***Side Quest**

This isn't relevant as we lose the zero byte for increasing by 2 in order to reserve
1, but it is interesting to think about.

You can have a zero byte truncated SHA2-256 hash. Luckily, a 0 byte read is also
zero bytes, so we don't even have to lose a single reserved byte in the DELTA compression
table of our VARINT compression space. That's right, congradulations, you just shaved
a single bit.

This means that a CIDv0 with a completely truncated hash is:

[ 18, 0 ]

Hey look, there is a hash you can predict.

This means that we shave 1byte off of every CIDv0 after the first CIDv0.

```
RAW                COMPRESSED
                   [ 18 ]
[ 18 , 0 ]         [ 0 ]         // CIDv0 fully truncated hash
[ 18 , 1 , 1 ]     [ 3, 1 ]      // CIDv0 truncated single byte hash
[ 18 , 1 , 2 ]     [ 2, 2 ]      // CIDv0 truncated single byte hash
```

## CIDv1

Now you write the first CID prefix. The following VARINT is the codec. The
one after is the hash function. Now, every digest is grouped together and sorted
length first.

The length of each digest is the DELTA from the prior length.

We can't shave any bytes by not writing the subsequent lengths because we wouldn't
have anything for termination. We need 1 for termination of the sequence anyway
so we might as well use DELTA + 2 again in order to compress down the length
as well.

This last one will rarely be used outside of whacky inline CID use cases, but it's
nice to know that we squeezed as much as possible. We've got the DELTA algorithm
around anyway, might as well use it consistently :)

While the DELTA compression is interesting, by far the best savings we get are
on de-duplication of common prefixes. It's actually the majority use case that
a block will primarily contain links with the same address prefix. In fact,
this is one of the few complaints we've heard about CID's in the past. Now you
pay 3 bytes, ever, for the prefix and all subsequent CID's shave a byte.

```
RAW                COMPRESSED
                               [ 1 ]
[ 1 , 85 , 0,  1 , 1 ]         [ 1 , 85 , 0 , 3 , 1 ]   // CIDv1 raw identity single byte
[ 1 , 85 , 0,  1 , 2 ]         [ 2 , 2 ]
[ 1 , 85 , 0,  2 , 1 , 1 ]     [ 2 , 1 , 1 ]
[ 1 , 85 , 0,  2 , 1 , 2 ]     [ 2 , 1 , 2 ]
[ 1 , 85 , 0,  2 , 1 , 3 ]     [ 2 , 1 , 3 ]
```

***Side Quest***

The digests are hashes. The only exception is the identity multihash, so you could
in theory find string compression techniques to apply to the digest.

This is the only remaining space we have for compression of CIDs, the identity digest
could theoretically have additional string compression techniques applied to it
and you have a reliable token already in place

# CONSTANTS

```js
const STRUCTURE_TOKEN_TYPED_BYTE_LIST   = 117
const STRUCTURE_TOKEN_TYPED_LINKS_LIST  = 119
const STRUCTURE_TOKEN_EMPTY_LIST        = 122
```

# DECODE

Decode requires the following globals to be provided.

 * `DATA` is the encoded zdag data to be parsed.

Additionally, the following language specific constants must be defined.

 * `READ(int)` return `int` number of bytes and then truncates the remaining
   data to be read by that amount.
 * `DATA_REMAINING()` returns the length of the remaing data.
 * `READ_VARINT()` return an `int` decoded as a varint and truncates the remaining
   data to be read by the size of the varint.
 * `LINKS_TABLE` is initialized as an empty list.
 * `VALUES_TABLE` is initialized as an empty list.
 * `ITERATOR([Int])` iterates over an array of integers
   and yields the index and value of every element in the array.

This parse specification in written in a spec friendly code style but it
is valid JavaScript that is parsed and turning into a running library
compliance tests can be run against.

In order to make it easier to implement in other languages this spec
abstracts all JavaScript data structure  operations into methods and constants that
can be implemented in any langauge. The JS implementation of these
methods is below for reference (and for builds).

**JavaScript Implementation**

The JS implementation uses a Uint8Array for DATA as an optimization. The following
methods abstract this difference away so that the rest of the spec can treat DATA
as an array of integers.

```js
const READ_POS = 0
const READ = ( int ) => {
  const slice = DATA.subarray(READ_POS, int)
  READ_POS += int
  return slice
}

const DATA_REMAINING = ( ) => {
  return DATA.byteLength
}

const READ_VARINT = ( ) => {
  const [ code, length ] = varint.decode(DATA)
  READ_POS += length
  return code
}

const LINKS_TABLE = []
const VALUES_TABLE = []

const PUSH_VALUE = ( value ) => {
  VALUES_TABLE.push(value)
}

const ITERATOR = function * ( array ) {
  let i = 0
  for (const value of array) {
    yield [ i, value ]
    i++
  }
}

DECODE_FIRST_BYTE()
```

## HEADER_VALUES

The values header begins with the length of the entire header.

The header data is a series of varint's for the length of every value followed
by the value. In order to compress the space used for the lengths, the offset
from the prior length is used rather than the full length.

Every entry in the value header has to have its order validated in order
to ensure determinism.

```js
const length = READ_VARINT()
const end = DATA_REMAINING() - length

let size = 0
let prev
while (DATA_REMAINING() > end) {
  const increase = READ_VARINT()
  size += increase

  if (size === 0 && prev) {
    // Allowing duplicate 0 byte entries would violate determinism
    throw new Error('HEAD_VALUES: cannot encode two zero byte values in header')
  }

  const value = READ(SIZE)

  // if there was any increase then we already know the order was correct
  if (increase === 0 && prev) {
    VALID_VALUE_ORDER(prev, value)
  }
  PUSH_VALUE(value)
  prev = value
}
STRUCTURE()
```

### HEADER_VALUE_ORDER_VALIDATE

```js
for (const [ i, int ] of ITERATOR(XX)) {
  if (int < YY[i]) return
  if (int > YY[i]) throw new Error('VALID_VALUE_ORDER: values out of order')
}
```

# STRUCTURE

Tokens

### READ_VALUE_INDEX

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

## STRUCTURE_TYPED_LINKS_LIST

Zero length lists are not allowed in order to ensure determinism.

```js
let INDEX = READ_VALUE_TABLE_INDEX()
if (INDEX === 0) {
  ERROR(550)
}
```

[READ_VALUE_INDEX()](#READ_VALUE_INDEX) until a 0 byte.

Every value table index is offset by one in order to use the 0 byte for termination.

```js
while (INDEX !== 0 && DATA_REMAINING() > 0) {
  // Index is offset by one to use 0 for list termination
  yield VALUE_TABLE[INDEX - 1]
  INDEX = READ_VALUE_INDEX()
}
```

# ZBL_DECODER

zbl (zdag byte list) is a strict subset of zdag. It's a valid list of bytes or an empty

An empty zbl is encoded as a single 122 byte [STRUCTURE-EMPTY-LIST](#STRUCTURE-EMPTY-LIST).

The only other valid first byte is 0. Denoting an empty links header.

## ZBL_DECODE_FIRST_BYTE

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
```

# LINK_TESTS

#### Encoding Single CIDv0

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

#### Encoding Single CIDv1

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
````

#### List of CIDv1 and CIDv0

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
