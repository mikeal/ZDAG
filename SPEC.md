# ZDAG

ZDAG is a compressed block format for IPLD.

```
[ links | values | structure ]
```

All links in the block are packed into an initial header. This means
the links can be parsed without further reading into the block data.

All string values, byte values, and map keys, are stored only once in their
binary form in a values header. This means de-duplication of common values
across the structure.

The structure of the data is finally written to the last section of the block.

# IPLD_DATA_MODEL

The [IPLD Data Model](https://github.com/ipld/specs/blob/master/data-model-layer/data-model.md)
is a superset of JSON types. It adds two types: bytes and links.

Many non-JSON formats support inline binary and there are large efficiency
gains to be had from using binary without string encoding as currently
required by JSON.

Links are required in order to link between different blocks to create
multi-block data structures. We use the CID format for links so that
blocks can link to any other block using any other codec/format and
hashing function.

To recap, the only available types this format needs to support are:
* Null
* Boolean (true and false)
* Integer
  * Signed and Unsigned (positive and negative)
  * Floating point (positive and negative)
* String (utf8)
* List (arrays)
* Map (deterministic key ordering)
* Bytes
* Link (cids)

ZDAG supports the IPLD Data Model and nothing else. This means that it can
encode anything you'd encode with JSON (or CBOR) and then some.

Even when only encoding JSON types, ZDAG will produce a more compact
binary encoding without losing any fidelity.

Unless you were to specifically craft data to overwhelm the compression
table, a ZDAG encoding is almost guaranteed to be smaller than JSON or CBOR.
If you keep your blocks small, like we tend to do, you'll see compression
gains without re-shaping your data to fit the compression rules.

Also note that, in order to guarantee determinism, the IPLD Data Model requires
deterministic order of some sort for maps. This is not always enforced because
prior formats (`dag-json` and `dag-cbor`) have to contend with a lack of determinism
and end up having to work with data that may have been improperly encoded.

# COMPARISONS_AND_MOTIVATION

The initial motivation for this format was finding a more compact serialization
than CBOR for *most*, but not all, data. The approach I decided to take was
sorting all the links into their own table so that we could have a CID specific
compression routine. That lined all the CID's in-order for a compression table,
which provides de-duplication and also cuts down on the bytes we're using.

At this point, we're already using a compression table, why not build another one
to hold all the map keys, string and byte values. That way we also de-duplicate
common map keys. Then the structure is just a series of tokens that give us type
hints, containers (maps and lists), constants (null, true, false), number values,
and pointers to each compression table.

This is large departure from the approach taken by JSON and CBOR and it is not
entirely without cost.

The compression table for links is "free" when compared against link representations
in other formats. CIDs have existing parsing rules that allow us to compress them
without using extra length encodings or extra delimiter tokens for anything but
closing the header.

But the values table is different, we have to give the length
of every value in the table, and the total size of the header, which could cost
more bytes than just inlining the values when there is no de-duplications.

For instance, when JSON encodes a string it uses a closing and opening delimiter
between the value data which costs 2 bytes. Most often, ZDAG will use 1byte
(read about DELTA compression below to see how we keep this low even
when the values are large in size) for the length of the value in the table
and then *may* need to use both a token for the typing of the value *and* a
VARINT pointer to the table index.

We're able to be reliably be smaller than JSON for small blocks because we cut
many of the separator tokens in containers, so the table ends up not costing us
anything, but CBOR is a bit better than that. CBOR has a few different ways
it encodes data.

CBOR uses a linear tokenization like JSON but it's a binary format and is much
smarter about how it uses tokens to reduce size. There's also optionality in CBOR
(something we have to turn off in `dag-cbor` to ensure determinism) so there
are ways to encode small containers and values that reduce the space required for
CBOR's tokens. However, there's a cost to the approach CBOR takes as well.

In CBOR, only very small numbers (0-32?) can be inlined as values. That means every
number over 32 requires a type hint. This is a necessary tradeoff for CBOR to
inline other information about small values and containers to save token space.

ZDAG takes a different approach that optimizes for storing large numbers without
a typing token, so if you have lots of numbers the token frequence of ZDAG will
be much lower than CBOR and will give a smaller representation even without
hitting other optimizations.

ZDAG uses numbers in the high end of the 1byte VARINT range. This allows us to
inline integers both higher and lower than the token range. Only integers that
conflict with a narrow set of tokens (right now, only 100-127) take a penatly
byte for typing.

Since this format has features we expect developers to contiously leverage it
seems worth it to make this tradeoff. Samples of chain data show, no big surprise,
frequent use of large numbers. Reducing the space used for large numbers is
more important than shaving a delimiter token from small containers and string/byte
values.

Still, you can find plenty of cases where a CBOR representation is slightly smaller
than ZDAG, but by making small alterations to that structure you can consistenly
find a smaller ZDAG representation, sometimes dramatically smaller.

JSON serializations are almost always larger than ZDAG unless you craft an attack against the ZDAG compression
table in order to intentionally create a larger serialization. This is quite
difficult when comparing to JSON because the values are limited to UTF-8 and it follows
a very similar compression scheme to VARINT which is what we use for the table
pointers. However, you can use byte data to craft an attack specifically against
ZDAG that can more easily overwhelm the compression table and produce a larger
serialization, but I see no reason to believe data that is designed for these attacks
is representative of common user data and these are easily avoidable penalties
if you're shaping data for ZDAG.

The rest of the compression techniques in ZDAG are designed fall into two categories:

* Reduce the necessary typing tokens by finding patterns of consistent typing.
* Reduce the overhead of VARINT pointers whenever those pointers occur linearly.
  This is done for data structures that have a guaranteed ordering (map) and
  also for containers that just happen to occur linearly (which you can program/design
  for if you're serializing a list of unorded unique entries).

When data falls into these rules it can dramatically reduce the token
overhead to well below CBOR or any comparable format. And since this tokenization is
in a separate header these compression techniques don't compete with string compression
you may want to apply to the entire block. Just the opposite, all the data
that can benefit from string compression is isolated into its own header so if you
choose to compress it you are handing the string compressor a well sorted
string without the data that would be problematic to compress (hash links and VARINTs).

In short, the approach ZDAG takes is not without tradeoffs. The compression table **is
not necessarily "free"**, especially when there is no de-duplication across the structure
but the gains we make elsewhere tend to make ZDAG serializations smaller anyway without
even designing for them and structures that **are** designed for them can effectively
tool their own forms of application specific compression by altering the shape of their
data to match the compression paths of ZDAG.

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
round-trip problem can cause lots of issues when you're hashing the encoded data.

JSON contains this variability so that you can use it as a flexible string based
format for data structures.

CBOR also has flexibility in its encoding, presented as features the encoder can
choose to use for efficiency. However, these features end up being quite difficult
to leverage since most language libraries for CBOR, and comparable formats, only
provide a single method of encoding native data structures, so developers
can't really leverage these features very effectively in their data structures ***and***
these features are totally off limits to those of us building content
addressed data structures because determinism means only having one encode setting.

ZDAG takes a different approach. Knowing that we need to ensure determinism means
that we can only ever have one way to encode something. We can actually leverage
this constraint to produce more compact representations and reduce the required
tokens.

But the best part is, since the rules we use for compression are based on the
deterministic encoding of a given structure, all the compression techniques
in the format can be leveraged by developers without touching the encoder directly.

Instead of having features in the encoder, like CBOR, our features are determined
by the shape of the given data, which means you can design shapes that excercise
the compression rules.

This means we can create new data structures using widely available simple types
that are also designed to be maximally compressed into the block format. At first,
it will be difficult for a developer to understand how these rules apply and intersect
with each other, but given the right tools to expose where potential savings might
be many developers will be able to find ways to save space by making small design
changes to their data structures.

## VARINT

A VARINT is a variable sized integer. The entire 64b number space is available but
smaller numbers are compressed in to a much smaller binary space than larger numbers.

A few things to keep in mind about VARINTs as you read through the following compression
techniques.

* Smaller numbers use less space.
* Numbers 127 and lower are 1b.

We use low numbers (0, 1) for termination of sequences that are leveraging DELTA
compression so that we can keep the offset small and maximize the effect of DELTA
compression. The one case where we do not use a 0 or 1 for termination is in a normal (untyped)
list because we cannot using DELTA compression (lists are not deterministically sorted)
and we prefer to reserve 0 for inline VARINT's because it's quite common, so
we assign a token for list termination instead.

We use a limited range decreasing from 127 for tokens in the STRUCTURE. This allows the parsing
rules to never use more than a single byte and it allows us to inline VARINTs, both the small
ones below the token range and the large ranges of numbers above this range.
VARINTs that begin with a byte in a reserved token range must be prefixed with STRUCTURE_VARINT
in order to protect the token range, which means that we only take a penalty byte when
the numbers are very large. This penalty only applies when we are parsing a token, there
are many cases where we parse a VARINT and a token is not possible and so we do not take
this penalty for large numbers in those cases.

## VARINT_TABLE

We build two compression tables in this format. One specifically for links and another
for values. We build two tables for a few reasons:

* Since CID's have known VARINT based parsing rules, we can compact them into a linear
header without many delimiters, and we can even compress out common prefixes, which we
wouldn't be able to do if they were in the value table.
* Since we're already going to have a seperate header, we can maximize the address space
in each compression table by keeping them separate.

We will then use VARINT's for pointers to these tables as we parse the STRUCTURE.

When using a VARINT to refer to a table entry we only get 126
addresses in 1b.

But, since we know the full table size before we ever parse the STRUCTURE
we can open up this range to 255 references when the table is below a
particular range. The range of this rule varies by 1 depending on the STRUCTURE_TYPE
since we may need to use 0 for termination. This means that, in all cases,
we get 254 addresses when the table is below 254, and in some cases we get the
whole 255 range when the table is below 255.

This technique effectively doubles the 1 byte address space for
our compresion table if you can keep the number of unique entries in
the table small. Data structures can be designed and re-shaped to fit
well into these tables and since they are both deterministically sorted
the size of the table and the size of references to each entry
can be easily calculated without fully serializing.
By just searching through the data structure for values and links and
applying the sort and de-duplication rules you'll have an exact match
to the table ZDAG will create.

This table idea began as just an efficient way to shave bytes off of
the structure encoding, but what I came to realize after writing it is
that it's much more than that.

These table rules will become variables in application specific
compression algorithms.

You can effectively program for compression using nothing but the
IPLD_DATA_MODEL and you don't need a new format or new compression
scheme in the codec/format, you just fit the data to match the deterministic
compression rules.

For instance:

* You can freely use links and values repeatedly without bearing the
  cost of the value, only a reference to the value or link. This cost
  is reduced even further in some data structures use DELTA compression
  and CONTAINER_TYPING rules.
* You can slice up values in order to put common byte/string ranges
  into the compression table, knowing that smaller values will have
  smaller VARINT pointers.
* You can adjust the chunking/slicing of values using algorithms that
  reduce the occurence of smaller values that might be crowding out
  lower address space in the table
  when they aren't used as often in the data structure by chunking
  them together with adjoining values.

This may be novel, or maybe not, i haven't seen these things plugged
together in this exact way before, but VARINT has been around a long
time so I doubt I'm the first person to build something like this.
I definitely didn't invent compression tables :P

Finally, because these tables have to be parsed into a list of constants
the de-duplication we have in the block is mirrored in savings in-memory
when decompressed with little or no extra work in the parser. Since
values are de-duplicated and referenced with VARINT pointers later
in the STRUCTURE the natural parsing method will be to return references
to those constants as long as they are immutable.

***Side Quest***

Attacking the table.

ZDAG will produce larger encodes of data if you either write a very large
amount of data with string values or you design data specifically to attack
the compression table.

However, this won't occur naturally very often. UTF8's uses a similar
approach to compression as VARINT which means that the number of small
strings is limited to a set that lines up nicely against VARINT compression.
This means that, even with large amounts of data that avoids all other
compression rules you'd still be minimized the size of the table pointers
due to the VARINT compression.

You could craft a more effective attack using binary value data. Then
you'd have the entire 8 byte range of unique values in the table and
could make the pointers cost more than the byte data it refers to.

## DELTA

Delta compression is used heavily across this format.

In the context of this specification, whenever refering to indexes or
lengths in deterministicly iterable structures we write the DELTA
between the prior index/length and the next as a VARINT.

This allows for a 64b number space for any index/length which we then compress
even further by reducing the size of the number we encode. This
means we will almost always keep the length to a single byte.

In some cases we need to reserve 0 and 1 as tokens.
This means that we can't always use 0 and 1 as valid DELTAs. So we store the
DELTA +2 in that specific cases, which reduces the available
compression addresses by the lowest possible amount.

These are the cases where we use DELTA compression:

* HEADER_LINKS: We need 0 for termination of the header and 1 for termination of
  a prefix compression sequence. So when we write the hash digest lengths we use the DELTA +2.
* HEADER_VALUES: The values header begins with the full length of the header as a VARINT.
  This could potentially be reduced in size by using a DELTA +1 sequence instead but we'd lose
  the ability to skip over the values header to the STRUCTURE when parsing so it's probably
  not worth it. So value lengths in the values header are the DELTA (no increment).
* STUCTURE_MAP_KEY_SORTING: since map keys are only a single type reference to the value table
  and the same key can never occur twice, we can safely reserve only 0 for termination of the sequence.
  Furthermore, since empty map is its own token termination of the first key would be impossible
  so we can allow 0 for the first key only. From that point on, 0 is not a valid key and be
  safely used for termination.

## LINKS_HEADER_COMPRESSION

The goal here is to find the most efficient possible way to store CIDs.

All we need to do is parse the CIDs linearly. That will implicitely put them
into a compression table that can be used for representations later on. This
means that if we can find the most efficient sorted parsing algorithm of CIDs
we will have created the smallest possible compression algorithm.

All CIDs begin with a multicodec.

Since multicodecs all begin with a VARINT we're already in the VARINT compression
space. We get that for free.

This means that we are already in an 8 bit compression space. Any sub-byte
compression scheme is already impossible because of decisions that have already
been made in multiformats.

This means that the following 8b compression techniques are the only that are
actually possible over these data structures since the entire 8b space is being
used for necessary fidelity.

So, what we're talking about in this document is the best algorithm we can
ever create for CID data structures. Pretty fun stuff!

First, we need to give CID's a deterministic sorting order.

### CID_SORTING

```
[ v0 , length 10, digest ]
[ v0 , length 11, digest-a ]
[ v1, codec, hashfn ] [ length-0 ]
[ v1, codec-a, hashfn-1 ] [ length-1] [ digest-a ]
[ v1, codec-b, hashfn-1 ] [ length-1] [ digest-a ]
[ v1, codec-b, hashfn-2 ] [ length-1] [ digest-a ]
[ v1, codec-b, hashfn-2 ] [ length-1] [ digest-b ]
[ v1, codec-b, hashfn-2 ] [ length-2] [ digest-b ]
```

CIDs are sorted CIDv0 first and then CIDv1.

CIDv0's are sorted length first, then by digest byte comparison.

CIDv1 is sorted by three consecutive VARINTs: one for the CID version,
one for the codec, and one for the hash function. The CID's are then
sorted by digest length, and finally by digest byte comparison.

The sorting algorithm isn't just for use in the compression, it also
guarantees determinism in the block format.

In fact, since this block format is deterministic you could simply
parse out the compressed links header, hash it, and use that hash to find
any other blocks that link to the same set of blocks as this block if
you have hashes of the other link headers in your block store.

### CIDV0-COMPRESSION

To start, we need a few tokens. One to signal if there are CIDv0's, one for CIDv1, and we need a token
to terminate the link header.

We need to know if the header is terminated under only 2 conditions:

* Reading the first byte of the block (empty links header)
* Reading the subsequent (but not first) byte of hash digest entries
  ( the length of the digest w/ DELTA compression )

0 makes a good token for termination here since reserving smaller tokens
in the upcoming DELTA compression sequence gives us more room for the
DELTA compression.

We use 18 as the token for signaling CIDv0.

Why 18?

First of all, you need a 1b token to signal that there are CIDv0s. You
need a full byte in order to reserve the 0 byte for termination of the
structure later, so you can't even shave bits below a full byte.

This means that we effectively don't have to reserve a byte for this
signal at all. We share this signal byte with the header terminator.

18 is the actual first byte of a CIDv0. An encoder likely has 18 as a
constant in close scope already. A decompressor will need an 18 shortly
in order to materialize the following the digests into complete CIDs.
So there isn't a better byte to reserve.

Once we're in the DELTA compression of the digest lengths we're going to need to
increment to avoid token conflicts and the smaller we make that increment
the better the DELTA compression. Luckily, once we're parsing hash digests
we don't need 18 for the CIDv0 token anymore.

We use 1 to signal a new CIDv1 prefix since it comes after 0 :)

This means that 0 and 1 can't be used as digest length DELTAs, so we write the
DELTA + 2 to avoid token conflicts.

This means that a CIDv0 with a completely truncated hash is encoded as:

[ 18, 2 ]

Hey look, there is a hash you can predict :P

This sorted compaction means that we shave 1byte off of every CIDv0 after the first CIDv0.

```
RAW                COMPRESSED
                   [ 18 ]
[ 18 , 0 ]         [ 0 ]         // CIDv0 fully truncated hash
[ 18 , 1 , 1 ]     [ 3, 1 ]      // CIDv0 truncated single byte hash
[ 18 , 1 , 2 ]     [ 2, 2 ]      // CIDv0 truncated single byte hash
```

### CIDV1-COMPRESSION

One problem with CID's in general is that they contain a lot of duplicate
prefix information. Blocks tend to link to only a few prefixes yet CID's
consume at least 3 bytes worth of prefix per CID ( version, codec, hash function).

The CID sorting algorithm sorts CIDv1's by common prefix. We then use sequencing
rules to parse every subsequent CID's hash digest until we encounter another prefix
or the end of the link header.

We begin each CIDv1 prefix with 1, then the codec VARINT, then the hashing function VARINT, then a
**series** of digests using the same DELTA compression rules for the length
as CIDv0 (DELTA + 2).

Parsing the digest series is as easy as reading a VARINT and:

* if it's 0 the link header is terminated
* if it's 1 this series of digests has ended and a new prefix is next
* if it's 2 or greater then it's the length DELTA +2.

This DELTA compression of the CID length is rarely going to show gains since hashes
lengths are rarely above the 1b VARINT threshold, so outside of whacky inline CID use cases
you won't save much. But we've got the DELTA algorithm around anyway, might as well
use it consistently and shave a few bytes off of large identity multihashes :)

```
RAW                COMPRESSED
                               [ 1 ]
[ 1 , 85 , 0,  1 , 1 ]         [ 1 , 85 , 0 ,  // prefix
                                 3 , 1 ]       // digest
[ 1 , 85 , 0,  1 , 2 ]         [ 2 , 2 ]       // next digest
[ 1 , 85 , 0,  2 , 1 , 1 ]     [ 2 , 1 , 1 ]   // next digest
[ 1 , 85 , 0,  2 , 1 , 2 ]     [ 2 , 1 , 2 ]
[ 1 , 85 , 0,  2 , 1 , 3 ]     [ 2 , 1 , 3 ]
```

While the DELTA compression is interesting, by far the best savings we get are
in de-duplication of common prefixes. It's actually the majority use case that
a block will primarily contain links with the same address prefix. In fact,
this is one of the few complaints we've heard about CID's in the past. Now you
pay for the prefix once and all subsequent CID's you get for just 1 byte (hash length
which puts us very close, if not better, than specialized block formats that
only support linking to a single codec and hash function.

And of course, this all ends up in a compression table that makes it very cheap
to refer to these links as often as you like in your structure using VARINT pointres.
We haven't had this kind of de-duplication before so we don't entirely know how well we can
leverage it.

***Side Quest***

The digests are hashes. The only exception is the identity multihash, so you could
in theory find string compression techniques to apply to the digest.

This is the only remaining space we have for compression of CIDs, the identity digest
could theoretically have additional string compression techniques applied to it
and you have a reliable token already in place. Compressing the hashes is useless
but we already have the codec as a token that differentiates identity multihashes from the rest
so you could apply additional string compression selectively.

***Side Quest***

Should we use DELTA + 3 in order to reserve 2 for a future version of CID?

If a new version of CID presents itself before this spec is finished we should,
but once this spec is finalized the parsing/sorting rules won't actually be able
to support a future version without a new version of the spec.

## VALUES_HEADER_COMPRESSION

Every map key, string and byte value in the structure is deterministically
sorted and put in the value header.

The sorting rules are simple: first sort by length, then by byte comparison.

Sorting by length first allows us to compress the table header using DELTA
compression. A length header is:

* A VARINT for the size of the complete value header.
* A series of length DELTAs for each value followed by the value.

Normally it would be costly to create a compression table for every value
knowing almost nothing about that data. But since any format that stores
string and byte values will need at least a length, if not a type hint
and a terminator, we're able to reduce the penalty of the header by using
DELTA compression on the lengths.

Later on, you'll see how we can often drop another byte for the typeing
by using typed collections. Similarly we save a typing byte on map keys
by only allowing one map key type (existing IPLD_DATA_MODEL constraint).
When you add it all up, we can almost always build this table for free
when compared to other formats that would inline these values rather than
creating the compression table.

So developers can reasonably assume that ZDAG will give them a compression
gain even when working with arbitrary JSON data. In practice, a lot of
this data contains duplicate map keys and other common patterns where
we show bigger gains. Unless you craft data with the specific intention
of overwhelming the compression table and opting out of other compression
patterns in the format, ZDAG can be a drop-in replacement for JSON, CBOR,
and other formats that don't require external schemas.

### VALUES_HEADER_STRING_COMPRESSION_VARIANTS

It is relatively simple to add string compression in variant codecs like
`zdag-deflate` since all the potential string data is already packed
into its own header. In fact, the initial POC for zdag included
this option and while it didn't show reasonable gains for blockchain
value data it would likely be much more effective when applied
to a block that consists mainly of UTF8 string data.

***Side Quest***

There is an opportunity here for further compression when this is string data.

I ran an experiment with an early version of ZDAG against 8 hours of filecoin
chain data. The format saved 8% compared to the existing `dag-cbor` data. I then ran an experiment
compressing the VALUES_HEADER with DEFLATE and this showed only a 3% gain since
almost none of the value data in the filecoin chain is well suited for compression.

As a final experiment I used DEFLATE on the STRUCTURE section as well and saw
less than 1% compression gain. This is good, it indicates that the format itself is
already very compressed.

This indicates that if further compression is to be applied to the VALUES_HEADER
it should be done as a variant codec and **only** the VALUES_HEADER should be
compressed.

Since the VALUES_HEADER is already determinstically sorted with low numbers for separators
due to the DELTA compression, there is probably a string compression algorithm
specific to this header that is yet-to-be-discovered.

## STRUCTURE_COMPRESSION

The STRUCTURE section is a linear sequence of tokens and inline VARINT values. These
tokens are used to materialize the IPLD_DATA_MODEL types.

At this point it's important to note some constraints of the IPLD_DATA_MODEL again
since we're going to be leveraging them for additional compression.

* Fully Deterministic
  * There can only be one way, ever, to encode the given data.
  * String map keys only
  * No duplicate map keys
  * Deterministic map key ordering

The full tokenization rules are detailed far below this section (TODO),
but it's useful to know a little bit about them in order to understand
how these compression techniques work.

* null, true and false are constants with their own reserved token.
* signed ints and floats are prefixed with a type token
* ints are mostly inlined, only the largest ints take a penalty byte for typing
* empty maps and lists have a reserved token, saving a terminator byte

### STRUCTURE_MAP_KEY_DELTAS

This is a very effiicent structure for map encoding.

Here we leverage the requirement that map keys are all strings in the IPLD data model
and the fact that they have to be deterministically sorted.

Since we don't have type variance we don't need a typing token. This already effecively
eliminates the performance difference of different key types in other formats.

Since maps MUST be deterministically sorted and all map keys are already in a deterministically
sorted value index we can write all map keys using DELTA compression.

We reserve 0 for termination of the sequence. Since we have a separate token for empty
maps, the 0 is available for parsing the first key reference. Here 0 is a valid reference
to the first values table entry.

Every subsequent index MUST increase by at least 1 because the map is determisitically
sorted against the value compression table. If you were to try and re-use a key index
the map would terminate.

```
Value Compression Table
___________
| 0 | "a" |
| 1 | "b" |
| 2 | "c" |
‾‾‾‾‾‾‾‾‾‾‾

{    "a"      9,  "b":     9,  "c":    9   }     <-- INPUT
OPEN KEY      VAL KEY      VAL KEY     VAL CLOSE <-- SYNTAX
119  0        9   1        9   1       9   0     <-- BINARY
MAP  DELTA        DELTA        DELTA             <-- DELTA_MAP_ALGO
```

When you combine the savings of the DELTA encoding here and in the creation of the
value compression table itself we can likely create this entire stucture against
a compression table for less space than most formats can encode a map even
if we never see any benefit from de-duplication.

Not only does this compress the size of the key references, it makes it **IMPOSSIBLE**
to encode an indeterministic map.

### STRUCTURE_CONTAINER_TYPING

First of all, since empty maps and lists have their own token we don't need to worry
about differentiating empty typed containers from empty untyped containers.
In fact, it's best to not think of this container typing as anything but
a compression optimization as it is likely to
conflict with typing rules you may be used to in your programming language.

It's fairly common to have containers (maps and lists) that only contain entries
of a single type. Since these containers must prefix every value with a token
for their type there's a compression gain to be had if we add tokens for maps and
lists that only contain a single type. This means that every value type we optimize
for will need to reserve two tokens, one for list and one for map.

We have typed containers for the following value types:

* strings
* bytes
* links

This means we're taking 6 more bytes from the high inline VARINT range in order to compress
these containers, which is totally worth it since single typed containers for these value
types are far more common than very high numbers in user data.

There's no bytes to be gained by typing the container for constants since they are already
only use a single byte. Same for ints, since they are mostly inlined. You could theoretically add signed ints,
floats, signed floats, and zero point floats to this list but you'd end up
increasing the necessary tokens for each case. Each token you reserve reduces the
available range of inline VARINTs, so there's a question here about how common
these are typed containers are compared to integer values in the high ranges.

The compression rule is simple:

* Any non-empty list that only contains entries of the same supported type MUST be encoded as a typed
  list.
  * You must encode this way, and validate this rule on parsing, in order to ensure
    determinism. Again, this does not necessarily align with the typing rules you may
    have in schemas you apply to this data or the types in your programming language, this rule
    is always applied when the data matches a specific criteria because that's the only way to
    ensure determinism.
* Any non-empty map that only contains values of the same supported type MUST be encoded as a typed
  map.
  * Again, determinism.
  * Note that the key type isn't a factor since we only allow one key type already.

Since all the types we support here contain references to a compression table we can use
zero for termination of both lists and maps. (In other words, we don't use the same terminator
as regular lists use).

TYPED_LIST indexes are offset by +1 in order to avoid conficting with the terminator.

TYPED_MAP values aren't offset since maps are only terminated when looking for the next KEY and
never when parsing the next value.
DELTA compression rules are applied to TYPED_MAPS in the same was they are to all other MAPs.

This means that a list of only bytes or strings costs only 1 byte to open, 1 to close
( unless the structure is at the root, then it's omitted) and a VARINT for
every index in the compression table it references, effectively shortening the list encoding
by a byte for every entry greater than zero. The same efficiency gain is made with typed maps
which adds to the efficiency gains map already has from STRUCTURE_MAP_KEY_DELTAS.

```
Value Compression Table
_______________
| 0 | "hello" |
| 1 | "world" |
‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾

{     "hello": "world", "world": "hello" }     <-- INPUT
OPEN  KEY      VAL      KEY      VAL     CLOSE <-- SYNTAX
113   0        1        1        0       0     <-- BINARY
STR   DELTA    INDEX    DELTA  INDEX           <-- MAP_ALGO
TYPED
MAP
```

### STRUCTURE_TYPED_SET **NEW!**

The IPLD data model does not have a Set. However, if a collection is offered to ZDAG that:

* Has more than one entry
* Has no duplicate entries
* Is ordered such that the pointer references only increase.

We can apply this to both lists and map values when these cases occur.

You MUST encode the list as a typed LIST_SET or LIST_MAP instead of the regular typed
version.

Note: the data will still decode to a regular list as far as the IPLD Data Model is concerned
this is strictly a compression rule that must be enforced reliably at encode and decode time
to ensure determinism.

We can then follow the same rules as DELTA compressed Maps, encoding the DELTA from the
prior key +1 and terminating with 0.

This means that when you have a unique un-ordered list all you need to do is apply the sorting
rules before passing the list to ZDAG and you'll get DELTA compression of the table pointers.

It's doubtful you can find a way to align your values to sort neatly against the keys, but
it may happen and it's very easy to detect since we already have to iterate over the encoded
form in order to check for list and map typing rules already.

## ROOT_COMPRESSION

A few final rules shave off the last unnecessary bytes.

1. When a container type (map or list) is the root structure the final terminator of the container MUST
   be omitted.
2. When the final encoded data contains no links or values the two null bytes for those empty headers
   (0 to terminate the links header, 0 for the size of an empty values header) must be omitted.
   * When encoding an inline VARINT as the root structure you MUST prefix a 0, 1, or 18 value with
     the STRUCTURE_VARINT token.


# BEWARE! DRAGONS!




From here onward the spec is very incomplete. Commits are being pushed every day
to this spec and the tooling for it and nothing below here has been edited or potentially
even read once after writing.




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
// only used for varints that conflict with reserved tokens
const STRUCTURE_VARINT                  = 127

const STRUCTURE_LIST_CLOSE              = 126

const STRUCTURE_STRING                  = 125
const STRUCTURE_BYTE                    = 124
const STRUCTURE_LINK                    = 123

const STRUCTURE_NUll                    = 122
const STRUCTURE_BOOLEAN_TRUE            = 121
const STRUCTURE_BOOLEAN_FALSE           = 120

const STRUCTURE_FLOAT                   = 119
const STRUCTURE_SIGNED_VARINT           = 118
const STRUCTURE_SIGNED_FLOAT            = 117
const STRUCTURE_ZERO_POINT_FLOAT        = 116

const STRUCTURE_MAP_START               = 115
const STRUCTURE_LIST_START              = 114

const STRUCTURE_EMPTY_MAP               = 113
const STRUCTURE_EMPTY_LIST              = 112

const STRUCTURE_STRING_TYPED_MAP        = 111
const STRUCTURE_BYTE_TYPED_MAP          = 110
const STRUCTURE_LINK_TYPED_MAP          = 109

const STRUCTURE_STRING_TYPED_LIST       = 108
const STRUCTURE_BYTE_TYPED_LIST         = 107
const STRUCTURE_LINK_TYPED_LIST         = 106

const STRUCTURE_BYTE_DELTA_LIST         = 105
const STRUCTURE_LINK_DELTA_LIST         = 104
const STRUCTURE_STRING_DELTA_LIST       = 103

const STRUCTURE_BYTE_DELTA_MAP          = 102
const STRUCTURE_LINK_DELTA_MAP          = 101
const STRUCTURE_STRING_DELTA_MAP        = 100
```

Special tokens for first byte parsing to support
inline structures when no links or cids are present.
In order to inline these numbers you must prefix them
with STRUCTURE_VARINT.

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

### NOTES ON ENCODING

We have specific tokens for empty maps and lists because:

* It saves us a token to close the structure
* We need to ensure determinism and having typed and untyped list
  opens us up to potential bugs in empty types vs untyped collections.
  Instead, we make the valdation and encoding a little more straightforward
  by just requiring that empty maps and lists be encoded with their own
  token.


While developing this algorithm, one place to look for savings is any place
data *happens* to also follow the sorting of one of the tables. That's a
place we can use DELTA compression if we give it its own type token.

Another place to find savings is anywhere that we're encoding type
information in a collection. We can detect if the items in the collection
are of that type and assign it a typed collection token.


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

ZBL (zdag byte list) is a strict subset of zdag. It's a valid list of bytes or an empty

ZBL is then a generic compression format for that can be used by application specific
compression algorithms to leverage de-duplication and construct a byte list.

This can then be combined with ZDAG_DEFLATE to apply further string compression to the
string data.

```
Value Compression Table
___________
| 0 | "a" |
| 1 | "b" |
| 2 | "c" |
‾‾‾‾‾‾‾‾‾‾‾

[     "a",   "c",   "b"    ]        <-- INPUT
OPEN  VAL    VAL    VAL    CLOSE    <-- SYNTAX
107   0      2      1      126      <-- BINARY
BTL   INDEX  INDEX  INDEX  END LIST <-- BYTE_TYPED_LIST
```

If the bytes happen to be in the order of the index table
a delta list is used.

```
Value Compression Table
___________
| 0 | "a" |
| 1 | "b" |
| 2 | "c" |
‾‾‾‾‾‾‾‾‾‾‾

[     "a",   "b",   "c"    ]        <-- INPUT
OPEN  VAL    VAL    VAL    CLOSE    <-- SYNTAX
107   0      1      1      0        <-- BINARY
BDL   DELTA  DELTA  DELTA  END LIST <-- BYTE_TYPED_LIST
```

A ZBL can also be a regular LIST as long as it only contains
other LISTs, BYTEs, BDLs or BTLs. This is so that an encoder
can leverage segments of the byte list that are well ordered
with high indexes and would benefit from delta compression
if the list was chunked into typed parts.


## ZBL_DECODE_FIRST_BYTE

An empty zbl is encoded as a single 122 byte [STRUCTURE-EMPTY-LIST](#STRUCTURE-EMPTY-LIST).

The only other valid first byte is 0. Denoting an empty links header.

```js
const [ code ] = READ(1)
if (code === 0) {
  VALUE_TABLE = HEADER_VALUES()
} else if (code === STRUCTURE_BYTE_TYPED_LIST || code === STRUCTURE_BYTE_DELTA_LIST) {
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
if (code !== STRUCTURE || ) {
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
