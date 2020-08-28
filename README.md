# ZAG

ZDAG is a format similar to JSON or CBOR. You can encode
and decode all the same types in ZDAG as you would
JSON or CBOR.

ZDAG is designed as a compressor.

ZDAG allows you to write your own compression right into your
data structure.

ZDAG hands you a compression engine for you to structure your
data into for compression rates far beyond what a generic algorithm
can give you because you can shape your data to fit.

ZDAG offers you:

* A compression table to de-duplicate string values, byte values, links
and map keys.
* De-tokenization of well typed maps and lists.
* ZDAG-DEFLATE variant applies additional deflate compression
  to only the string data.
* Delta compression of map key pointers and well ordered sets.

Most data will show a slight compression gain with ZDAG. But data
structures *designed* for ZDAG can achieve compression rates
greater than any generic compression algorithm and format.

** Compression Table

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

** De-tokenization of well typed maps and lists.

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

** Delta compressed map key pointers and well ordered sets.

As the compression table grows pointers to the table grow
in size as well to represent higher numbered indexes.

Map keys are delta compressed. This means that every entry
in the map only has to store the delta from the prior key
in the sort ordering of the compression table. This reliably
keeps map keys much cheaper than other values when the
compression table is large.

The same is true of well typed lists and maps when the values
happen to match the sort order of the compression table.

## Other featurs

* fully deterministic
* supports the full IPLD data model
* links can be parsed without reading the entire block
* common link prefixes are de-duplicated (compressed)
* paths can be read without fully parsing most values
* some paths can even be ruled out of being available simply by checking
  the lengths of potential map keys

Constraints:

* Does not support anything not in the IPLD data model
* Blocks must be written transactionally (no streaming)
* Every serialization must be a single, complete value type
