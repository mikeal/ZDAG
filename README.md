# ZDAG

ZDAG is a format similar to JSON or CBOR. You can encode
and decode all the same types in ZDAG as you would
JSON or CBOR without any additional schema requirements.

ZDAG is designed as a compressor.

ZDAG allows you to write your own compression right into your
data structure.

ZDAG hands you a compression engine for you to structure your
data into for compression rates far beyond what just a generic string
compression algorithm can give you because you can shape your data to fit.

ZDAG offers you:

* A compression table to de-duplicate string values, byte values, [links](#Linking)
and map keys.
* De-tokenization of well typed maps and lists.
* ZDAG-DEFLATE variant applies additional deflate compression
  to **only** the compressable data values.
* Delta compression of map key pointers and well ordered sets.

Most data will show a slight compression gain with ZDAG. But data
structures *designed* for ZDAG can achieve compression rates
greater than any generic compression algorithm and format.

## Compression Table

The entire structure you pass to be encoded by ZDAG is traversed
and every string value, byte value, link, and map key are sorted
and put into a delta compressed table.

This means that you can use the same map key, string, or byte
value as many times over as you like and the serialization will
often cost as low as one byte to refer to it again.

So the following object is 50% the size of JSON when encoded with
ZDAG.

```js
{ "hello": "world", "world", "hello" }
```

The compression table is deterministically ordered, so you can predict
the ordering of all the keys and values in your structure but
you can't alter the sort order programmatically.

ZDAG is a fully deterministic format. Data can only ever be encoded
one way, so the same structure will always roundtrip to the same
binary representation in every implementation. Most of these
determinism rules don't even have to be handled by validation
code because they are part of the compression algorithm.

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
b does not because the token used to open the list also hinted
the type for every entry.

The same rules are applied for link, string, and byte values.

```js
const a = { 'true': 'true', 'false', false }
const b = { 'true': 'true', 'false', 'false' }
```

This also works for maps, so `b` is 1 byte smaller than `a`.

## Delta compressed map key pointers and well ordered sets.

As the compression table grows pointers to table entries also grow
in size as well to represent larger numbers.

But map keys are delta compressed. This means that every entry
in the map only has to store the delta from the prior key
in the sort ordering of the compression table. This reliably
keeps map keys much cheaper than other values when the
compression table is large.

The same is true of well typed lists and maps when the values
happen to match the sort order of the compression table.

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

In this example `a` will be 126 bytes smaller than b because
the entries in its list were sorted in alignment with the table.
That's because the delta compression kept the pointers low
while `b` ends up using 126 2byte pointers.

## Linking

ZDAG includes a native link type that uses CID. A CID is a hash
based pointer.

This allows you to construct data structures that link between each
other by hash.

That means you can use ZDAG to de-duplicate data shared between
different pieces of encoded data. So if you want two pieces
of encoded data to include a third piece of common data you
can have the first two pieces of data link to the third which
means you've compressed the total structure across differ parts
through another higher form of de-duplication.

Another nice feature of links is that, similary to URL schemes
like `ftp://` and `http://`, different pieces of data can
be encoded in different formats. So if there is data
that was already encoded in another format you don't have to
re-encode it with ZDAG in order to de-duplicate it.

You can link to any hash based format, like those found in
`git`, `IPFS`, `Bitcoin`, `ETH`, and many more. And of course
you can link different pieces of ZDAG data between each other.

## Other features

* fully deterministic
* supports the full IPLD data model
* links can be parsed without reading the entire block
* common link prefixes are de-duplicated (compressed)
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
