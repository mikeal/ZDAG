# r2d2

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
0 - 100 : inline varint
100 : delimiter
101 : varint (100-110 only)
102 : utf8 string reference
103 : bytes reference
104 : null
105 : true
106 : false
107 : float
108 : map
109 : list
110 : cid reference
111+ : inline varint
```

### parsing a table entry

We use `read()` to refer to the next read after this varint is read

* 100 - Reserved seperator
* 101 - If it's a varint then the next `read()` is the full varint value
* 102 - The next `read()` is a varint for the index of the value and this value is a string value.
* 103 - The next `read()` is a varint for the index of the value and this value is a bytes value.
* 104 - This is null
* 105 - This is true
* 106 - This is false
* 107 - The next two `read()`s are varints parsed into a float value.
* 108 - All of the following `read()`s are in this `map` until a null byte
  * The first `read()` is a reference to the value index and should be represented by a string key. The index is offset by one here so that a null byte can be used to end the map.
  * The next `read()` is the map value and is a table entry table entry
  * recursively until you hit a null byte
* 109 - All of the following `read()`s are in this `list` until a 100 delimiter
  * Every `read()` is a table entry you hit a null byte
* 110 - The next `read()` is a varint for the index of the cid value.
* 111 + this `read()` is a varint value

## cids and values

```
| ...cids | null byte |
| length | ...values(len | data) |
| structure |
```

## structure

```
| table entry |
| [ 108, ...(string reference varint, table entry) ] | null byte // map
| [ 109, ...(table entry) ] | null byte // list
```

## value and cid sorting algorithm

* only the binary form is stored
* sort length first
* then sort by byte comparison

## map sorting algorithm

* map keys are sorted by their string value reference number
* this means the map sorting naturally corresponds to the value sorting algorithm
