# ZDAG

ZDAG is a compressed block format for IPLD.

```
[ links | values | structure ]
```

All links in the block are packing into an initial header. This means
the links can be parsed without further reading into the block data.

All string values, byte values, and map keys, are stored only once in their
binary form in a values header. This means de-duplication of common values
across the structure.

The structure of the data is finally written to the last section of the block.

# IPLD_DATA_MODEL

The IPLD Data Model is a superset of JSON types. It adds two types: bytes
and links.

Many non-JSON formats support inline binary and there are large efficiency
gains to be had from using binary without string encoded as currently
required by JSON.

Links are required in order to link between different blocks to create
multi-block data structures. We use the CID format for links so that
blocks can link to any other block using any other codec/format and
hashin function.

To recap, the only available types this format needs to support are:
* Null
* Boolean (true and false)
* Integer
  * Signed and Unsigned (positive and negative)
  * Floating point (positive and negative)
* String (utf8)
* List (arrays)
* Map
* Bytes
* Link (cids)

ZDAG supports the IPLD Data Model and nothing else. This means that it can
encode anything you'd encode with JSON (or CBOR) and then some.

Even when only encoding JSON types, ZDAG will produce a more compact
binary encoding without losing any fidelity.

Unless you were to specifically craft data to overwhelm the compression
table, a ZDAG encoding is almost guaranteed to be smaller than JSON or CBOR.

# COMPRESSION

## DETERMINISM

A requirement we already have in IPLD, and in fact in nearly all
content addressed data structures, is determinism.

In `dag-cbor` and `dag-json` this has been difficult to guarantee and
enforce because these formats are indeterministic. For example, the following
JSON documents are both valid JSON that decode to the same in-memory
representation of the data structure

```json
{"hello":"world"}
{ "hello" : "world" }
```

If you parse both of these JSON objects with a JSON parser you'll end up with the
same in-memory data, but if you then re-encode those objects to JSON at least one
of them is going to produce a different string than you originally parsed. This
round-trip problem can cause lots of problems when you're hashing the encoded data.

JSON contains this variability so that you can use it as a flexible string based
format for data structures.

CBOR also has flexibility in its encoding, presented as features the encoder can
choose to use for efficiency. However, these feature end up being quite difficult
to leverage since most language libraries for CBOR, and comparable formats, only
provide a single method of encoding native data structures to CBOR, so developers
can't really leverage these features very effectively in their data structures ***and***
these features features are totally off limits to those of us building content
addressed data structures.

ZDAG takes a different approach. Knowing that we need to ensure determinism means
that we can only ever have one way to encode something. We can actually leverage
this constraints to produce more compact representations and reduce the required
tokens.

But the best part is, since the rules we use for compression are based on rules
ragarding the deterministic encoding of the given structure all the compression techniques
in the format can be leveraged by developers.

Instead of having features in the encode, like CBOR, our features are determined
by the shape of the given data, which means you can design shapes that excercise
the compression rules.

This means we can create new data structures using widely available simple types
that are also designed to be maximally compressed into the block format. At first,
it will difficult for a developer to understand how these rules apply and intersect
with each other, but given the right tools to expose where potential savings might
be many developers will be able to find way to save space by make small design
changes to data structures.

## VARINT

A VARINT is a variable sized integer. The entire 64b number space is available but
smaller numbers are compressed in to a much smaller binary space than larger numbers.

A few things to keep in mind about VARINTs as you read through the following compression
techniques.

* Smaller numbers use less space.
* Numbers 127 and lower are 1b.

We always use numbers 127 or below for termination and tokens. This allows the parsing
rules to never use more than a single byte and it allows us to inline VARINT as values
whenever necessary, greatly reduce the potential number space.

We use 0 for termination in almost every case so that we can use a DELTA offset. Other
than that, we tend to keep our tokens in the top of the 1b range so that we can inline
VARINT values below the token range since smaller integer values occur more often
in user data.

## VARINT_TABLE

We build two compression tables in this format. One specifically for links and another
for values. We build two tables for a few reasons:

* Since CID's have known VARINT based parsing rules, we can compact them into a linear
header without many delimiters, and we can even compress out common prefixes, which we
wouldn't be able to do if they were in the value table.
* Since we're already going to have seperate header, we can maximize the address space
in each compression table by keeping them separate.

We will then use VARINT's to point to these tables as we parse the STRUCTURE.

When using a VARINT to refer to a table entry we only get 126
addresses in 1b.

But, since we know the full table size before we ever parse the STRUCTURE
we can open up this range to 255 references when the table is below a
particular range. The range of this rule varies by 1 depending on the type
since we may need to use 0 for termination. This means that, in all cases,
we get 255 addresses when the table is below 255, and in some cases only
254 if the table is below 254 in size.

This technique effectively doubles the 1 byte address space for
our compresion table if you can keep the number of unique entries in
the table small. Data structures can be designed and re-shaped to fit
well into these tables and since they are both deterministically sorted
the size of the table can be easily calculated without fully serializing
by just searching through the data structure for values and links and
apply the sort and de-duplication rules.

This table idea began as just an efficient way to shave bytes off of
the structure encoding, but what I came to realize after writing it is
that it's much more than that.

These table rules will become variables in application specific algorithms.
You can effectively program a datastructure algorithm for compression
using nothing but the IPLD_DATA_MODEL.

For instance:

* You can freely use links and values 
* You can slice up values in order to put common byte/string ranges
  into the compression table.
* You can adjust these chunking and slicing algorithms to reduce smaller
  values that might be crowding out lower address space in the table
  when they aren't used as often in the data structure.

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

We have need a token for ending the entire header 0.

We need another token that says we are now going to write CIDv1, so we reserve
1. That means that 0 and 1 can't be used as length tokens, so we write the
DELTA + 1.

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

CID Header compression constants

```js
const CID_HEADER_TERMINATOR             = 0
const CID_HEADER_CIDV0_START            = 18
const CID_HEADER_CIDV1_START            = 1
const CID_DIGEST_LENGTH_DELTA_OFFSET    = 2
```

Value Header compression constant

```js
const VALUE_LENGTH_DELTA_OFFSET         = 0
```

Structure compression tokens

```js
const MAP_KEY_DELTA_OFFSET              = 1
const MAP_KEY_VALUE_TABLE_1B_MAX        = 254
const TYPED_LIST_DELTA_OFFSET           = 1
const TYPED_LIST_TABLE_1B_MAX           = 254
```

Structure tokens.

Since smaller numbers occur more often in user data we put
all structure tokens at the top end of the VARINT 1b range.

```js
const STRUCTURE_LIST_CLOSE              = 127

// only used for varints that conflict with reserved tokens
const STRUCTURE_VARINT                  = 126

const STRUCTURE_STRING_INDEX            = 125
const STRUCTURE_BYTE_INDEX              = 124
const STRUCTURE_NUll                    = 123
const STRUCTURE_BOOLEAN_TRUE            = 122
const STRUCTURE_BOOLEAN_FALSE           = 121
const STRUCTURE_FLOAT                   = 120
const STRUCTURE_MAP_START               = 119
const STRUCTURE_LIST_START              = 118
const STRUCTURE_LINK_INDEX              = 117
const STRUCTURE_SIGNED_VARINT           = 116
const STRUCTURE_SIGNED_FLOAT            = 115
const STRUCTURE_ZERO_POINT_FLOAT        = 114
const STRUCTURE_STRING_TYPED_MAP        = 113
const STRUCTURE_BYTE_TYPED_MAP          = 112
const STRUCTURE_LINK_TYPED_MAP          = 111
const STRUCTURE_STRING_TYPED_LIST       = 110
const STRUCTURE_BYTE_TYPED_LIST         = 109
const STRUCTURE_LINK_TYPED_LIST         = 108
const STRUCTURE_EMPTY_MAP               = 107
const STRUCTURE_EMPTY_LIST              = 106

const STRUCTURE_MAX_INLINE_VARINT       = 105
``

Special tokens for first byte parsing to support
inline structures when no links or cids are present.
In order to inline these numbers you must prefix them
with 126.

```
const STRUCTURE_FIRST_BYTE_RESERVED_INTS = [ 0, 1, 18 ]
```

# ENCODE

```
const OUTPUT = []

const WRITE = int => {
  output.push(int)
}

const WRITE_VARINT = int => {
  output.push(varint.encode(int)
}

const WRITE_REF = (arr) => {
  OUTPUT.push(arr)
}

const ADD_VALUE = VALUE => {
  const ref = []
  VALUES.push([ VALUE, ref ])
  WRITE_REF(ref)
}

const COMPARE_REF = (XX, YY) {
  const [ value ] = XX
  const [ comp ] = YY
  if (value.length < comp.length) return -1
  if (length > value.length) return 1
  let i = 0
  for (const int of value) {
    if (int < comp[i]) return -1
    if (comp[i] > int) return 1
    i++
  }
  return 0
}

const SET_REFERENCES = () => {
  // iterate over values
  // remove duplicates
  // push index into the second array of each entry
}

const SORT_VALUES = () => {
  VALUES.sort(COMPAR_REF)
  SET_REFERENCES()
}

const SERIALIZE = () => {
  return VALUES.flat(Infinity)
}
```

### ADD_VALUE





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
    ERROR('HEAD_VALUES: cannot encode two zero byte values in header')
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