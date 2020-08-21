# r2r2

Really Reliable De-Deplucation (<-- stretching!)

This is an experimental block format for IPLD. It leverages the
constraints of the IPLD data model to reduce the bytes required
in the format.

Features:

* fully deterministic
* deduplicates common values (strings and bytes)
* supports the full IPLD data model
* links can be parsed without reading the entire block
* paths can be read without fully parsing most values

Constraints:

* Does not support anything not in the IPLD data model
  * Map keys can only be strings
* Blocks must be written transactionally (no streaming)
* Every serialization must be a single, complete value type

# block structure

```
links | values | structure
```

## table

```
0 - delimiter
1 - varint
2 - utf8 string reference
3 - bytes reference
4 - null
5 - true
6 - false
7 - float
8 - map
9 - list
10 + inline varint
```

### parsing a table entry

We use `read()` to refer to the next read after this varint is read

* 1 - If it's a varint then the next `read()` is the full varint value
* 2 - The next `read()` is a varint for the index of the value and this value is a string value.
* 3 - The next `read()` is a varint for the index of the value and this value is a bytes value.
* 4 - This is null
* 5 - This is true
* 6 - This is false
* 7 - The next two `read()`s are varints parsed into a float value.
* 8 - All of the following `read()`s are in this `map` until a null byte
  * The first `read()` is a reference to the value index and should be represented by a string key.
  * The next `read()` is the map value and is a table entry table entry
  * recursively until you hit a null byte
* 9 - All of the following `read()`s are in this `map` until a null byte
  * Every `read()` is a table entry you hit a null byte
* 10 + this `read()` is a varint value

## cids and values

```
| ...cids | null byte |
| ...values(len | data) | null byte |
| structure |
```

## structure

```
| table entry |
| [ 8, ...(string reference varint, table entry) ] | null byte // map
| [ 9, ...(table entry) ] | null byte // list
```

## value sorting algorithm

* only the binary form is stored
* sorted length first
* then sorted by byte comparison

## map sorting algorithm

* map keys are sorted by their string value reference number
* this means the map sorting naturally corresponds to the value sorting algorithm
