# ZDAG

ZDAG is a format similar to JSON or CBOR. You can encode
and decode all the same types in ZDAG as you would
JSON or CBOR without any additional schema requirements.

ZDAG is designed as a compressor.

ZDAG allows you to write your own compression right into your
data structure.

ZDAG hands you a compression engine for you to program your
data into for structural compression rates far beyond what just a generic string
compression algorithm can give you because you can shape your data to fit.

ZDAG offers you:

* A compression table to de-duplicate string values, byte values, [links](#Linking)
and map keys.
* De-tokenization of well typed maps and lists.
* ZDAG-DEFLATE variant applies additional deflate compression
  to **only** the compressable data values.
* (TODO) ZDAG-BROTLI variant
* Delta compression of map key pointers and well ordered sets.
* Universal hashed based links ([CID](https://github.com/multiformats/cid))
  for linking between encoded structures.

Most data will show a slight compression gain with ZDAG. But data
structures *designed* for ZDAG can achieve structural compression rates
greater than any generic compression algorithm and format. This
compression is serialized to its own header, so you can still use
standard string compression techniques on the string data without
attempting to string compress ZDAG's structural compression **or**
the hash based links.

This means that ZDAG's compression engine does not compete with
string compression at all, it actually complements it.

In fact, even if all you have is a single string or binary value
like a text file, you can use ZDAG to chunk that up for de-duplication using domain
specific logic (like de-duplicating common syntax in a programming
language by chunking around it). You can bank those de-duplication
savings and then apply string compression to the remaining unique
strings using ZDAG-DEFLATE or another string compression variant.

This means you can write domain specific compression algorithms that decompress
with nothing but the standard ZDAG decoder (and INFLATE if using
the ZDAG-DEFLATE variant).

## Compression Table

The entire structure you pass to be encoded by ZDAG is traversed
and every string value, byte value, link, and map key are sorted
and put into a compression table.

This means that you can use the same map key, string, or byte
value as many times over as you like and the serialization will
often cost as low as one byte to refer to it again.

So the following object is 50% the size of JSON when encoded with
ZDAG.

```js
{ "hello": "world", "world", "hello" }
```

The compression table is strictly ordered, so you can *predict*
the table ordering of all the keys and values in your structure.

Smaller strings sort to the low (cheap) end of the compression table, so you can chunk
values into parts and predict the cost of their pointers in order to measure those
costs against any gain you will see from de-duplication of newly common values
that would result from the chunking.

So you can *program* the compression table by shaping the data
even if you can't actually adjust the sort order of the compression
table by hand.

ZDAG is a fully deterministic format. Data can only ever be encoded
one way, so the same structure will always roundtrip to the same
binary representation in every implementation. Most of these
determinism rules don't even have to be handled by expensive validation
code because they are part of the compression algorithms.

## De-tokenization of well typed maps and lists.

When a list or map contains values of all the same type you also
drop the typing token for every value, saving you 1 byte per
entry.

```js
const a = [ 'true', 'false', true ]
const b = [ 'true', 'false', 'true']
```

When serialized, `b` will actually be 2 bytes smaller than `a`. This
is because `a` needs to prefix the strings with a typing token and
`b` does not because the token used to open the list also hinted
the type for every entry.

The same rules are applied when string, link, or byte types are
used consisently.

```js
const a = { 'true': 'true', 'false', false }
const b = { 'true': 'true', 'false', 'false' }
```

This also works for maps, so `b` is 1 byte smaller than `a`.

## Delta compressed map key pointers and well ordered sets.

As the compression table grows pointers to table entries also grow
in size to represent larger numbers.

But map keys are delta compressed. This means that every entry
in the map only has to store the delta from the prior key
in the sort ordering of the compression table. This reliably
keeps map keys much cheaper than other values when the
compression table is large.

The same is true of well typed lists and maps when the values
happen to match the sort order of the compression table.

Also keep in mind that maps don't require a typing token for their key
because we only allow one map key type. This means maps are very cheap in ZDAG
compared to other formats and the keys aren't just de-duplicated across the
structure and the pointers are kept quite small.

If the entries in a list match the sorting order of the compression table then
the same thing happens, the indexes are delta encoded reducing their size.

```js
import varint from 'varint'

const buffers = []

let i = 0
while (0 < 256) {
  buffers.push(varint.encode(i))
  i++
}

const a = buffers
cosnt b = buffers.reverse()
```

In this example `a` will be 126 bytes smaller than `b` because
the entries in its list were sorted in alignment with the table.
That's because the delta compression kept the pointers low
while `b` ends up using 126 2byte pointers (VARINT encoding
of 1byte numbers ends at 126).

## Linking

ZDAG includes a native link type that uses [CIDs. A CID is a hash
based pointer.](https://github.com/multiformats/cid)

This allows you to construct data structures that link between each
other by hash.

With this you can use ZDAG to de-duplicate data shared between
different pieces of encoded data. So if you want two pieces
of encoded data to include a third piece of common data you
can have the those two pieces of ZDAG encoded data link to the third, which
means you've compressed the total structure across differ parts
through another higher form of de-duplication.

Another nice feature of CID links is that, similar to URL schemes
like `ftp://` and `http://`, different pieces of data can
be encoded in different formats. So if there is data
that was already encoded in another format you don't have to
re-encode it with ZDAG in order to link to it from ZDAG.

You can link to any hash based format, like those found in
`git`, `IPFS`, `Bitcoin`, `ETH`, and many more. And of course
you can link different pieces of ZDAG data between each other.

These links are understood by decentalized systems like IPFS too. So
you can actually share these larger graphs of compressed data
in decentralized networks by their CID (you can derive an address
for anything you encode with ZDAG by hashing it) and even link to
your ZDAG compressed data in blockchain transactions.

Finally, the links header is compressed using CID specific parsing
rules to de-duplicate common prefixes and pack the header together without
special tokens or extra length encodings. This puts links in their
own compression table, which means they have their own address
space apart from the values, optimizing the total available address
space.

## ZDAG-DEFLATE & ZDAG-BROTLI

Normally it's a terrible idea to combine compressors as it's
expensive and yields little gain. However, all of ZDAG's compression
is happening in the structure encoding against an isolated compression table that
stores all the string and byte data.

This puts us in an optimal position for additional string
compression as we have already isolated where applying this
compression will be most effective and can apply it there
and nowhere else.

In fact, the delta compression we use on this header inceases
the frequency of common separators between each of your values,
and they are already ordered, so it's actually ideally prepared
for a string compressor.

This is implemented as a separate variant codec because:

* Optionality in choosing the compression would break determinism.
* We don't want to turn it on by default because if the values
  are byte data they may already be compressed or are encrypted.
  This is actually the majority case with blockchain data.
* We want to leave room for improved string compressors to be
  applied to this header in the future.

## Other features

* fully deterministic
* supports the full IPLD data model
* links can be parsed without reading the entire block
* common link prefixes are de-duplicated (link header compression)
* paths can be read without fully parsing most values
* some paths can even be ruled out of being available simply by checking
  the lengths of potential map keys

## Constraints:

* Does not support anything not in the IPLD data model
* Blocks must be written transactionally (no streaming)
* Every serialization must be a single, complete value type

# Experimental

The code base changes daily, breaking changes without notice,
and the spec is still being written.
